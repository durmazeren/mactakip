'use strict';

/* Defensive parser for live odds returned by the app's existing event scraper.
 * Only timestamped, active-event prices can confirm an analysis direction. */
(function attachOddsEngine(root, factory) {
  const engine = factory();
  root.OddsEngine = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
}(globalThis, () => {
  const MAX_SOURCE_AGE_MS = 90_000;
  const MAX_FUTURE_SKEW_MS = 30_000;
  const MARKET_DIRECTION_FLOOR = 0.52;
  const TIMESTAMP_FIELDS = [
    'lastUpdatedAt', 'lastUpdatedTimestamp', 'lastUpdateTimestamp',
    'updatedAt', 'updateTimestamp', 'lastUpdate', 'timestamp',
  ];

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('en')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9.]+/g, ' ').trim();
  }

  function decimal(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 1 && value <= 1000 ? value : null;
    if (typeof value !== 'string') return null;
    const fraction = value.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (fraction && Number(fraction[2]) > 0) {
      const fractionalOdds = 1 + Number(fraction[1]) / Number(fraction[2]);
      return fractionalOdds > 1 && fractionalOdds <= 1000 ? fractionalOdds : null;
    }
    const parsed = Number.parseFloat(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 1 && parsed <= 1000 ? parsed : null;
  }

  function americanDecimal(value) {
    const american = Number(value);
    if (!Number.isFinite(american) || american === 0 || Math.abs(american) > 100_000) return null;
    const odds = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
    return odds > 1 && odds <= 1000 ? odds : null;
  }

  function timestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const time = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
      return Number.isFinite(time) ? time : null;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function sourceTimestamp(market, payload, now) {
    const times = [];
    for (const object of [market, ...choicesOf(market), payload?.odds]) {
      if (!object || typeof object !== 'object') continue;
      for (const field of TIMESTAMP_FIELDS) {
        const parsed = timestamp(object[field]);
        if (parsed != null && parsed <= now + MAX_FUTURE_SKEW_MS) times.push(parsed);
      }
    }
    return times.length ? Math.max(...times) : null;
  }

  function suspended(object) {
    return object?.suspended === true || object?.isSuspended === true
      || object?.active === false || ['suspended', 'closed', 'inactive'].includes(normalize(object?.status));
  }

  function choicesOf(market) {
    const choices = market?.choices || market?.outcomes || market?.selections;
    return Array.isArray(choices) ? choices : [];
  }

  function priceOf(choice) {
    return decimal(choice?.decimalValue ?? choice?.decimalOdds ?? choice?.odds ?? choice?.price)
      ?? decimal(choice?.fractionalValue ?? choice?.fractionalOdds)
      ?? americanDecimal(choice?.americanValue ?? choice?.americanOdds)
      ?? decimal(choice?.value);
  }

  function marketTitle(market) {
    return [market?.marketName, market?.name, market?.title, market?.market, market?.periodName]
      .filter((part) => typeof part === 'string').join(' ');
  }

  function isFirstHalf(title) {
    return /\b(first half|1st half|half time|1st period|first period)\b/.test(normalize(title));
  }

  function numberFromText(text) {
    const matches = [...String(text || '').replace(',', '.').matchAll(/(?:^|\D)(\d{1,2}\.\d)(?=$|\D)/g)];
    return matches.length ? Number(matches[matches.length - 1][1]) : null;
  }

  function totalSide(choiceName) {
    const name = normalize(choiceName);
    if (/^(over|o|above|more|ust)(?:\s|$)/.test(name)) return 'over';
    if (/^(under|u|below|less|alt)(?:\s|$)/.test(name)) return 'under';
    return null;
  }

  function yesNoSide(choiceName) {
    const name = normalize(choiceName);
    if (/^(yes|y|evet)(?:\s|$)/.test(name)) return 'yes';
    if (/^(no|n|hayir)(?:\s|$)/.test(name)) return 'no';
    return null;
  }

  function nextGoalSide(choiceName) {
    const name = normalize(choiceName);
    if (/^(home|home team|1|ev|ev sahibi)(?:\s|$)/.test(name)) return 'home';
    if (/^(away|away team|2|deplasman)(?:\s|$)/.test(name)) return 'away';
    if (/^(no goal|no more goals|none|no more scoring|gol yok)(?:\s|$)/.test(name)) return 'none';
    return null;
  }

  function resultSide(choiceName) {
    const name = normalize(choiceName);
    if (/^(home|home team|1|ev|ev sahibi)(?:\s|$)/.test(name)) return 'home';
    if (/^(draw|x|tie|beraberlik)(?:\s|$)/.test(name)) return 'draw';
    if (/^(away|away team|2|deplasman)(?:\s|$)/.test(name)) return 'away';
    return null;
  }

  function fairValues(prices) {
    const implied = Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, 1 / value]));
    const total = Object.values(implied).reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    return Object.fromEntries(Object.entries(implied).map(([key, value]) => [key, value / total]));
  }

  function quote(prices, updatedAt, observedAt, identity, eventIdentity) {
    const fair = fairValues(prices);
    if (!fair || Object.keys(prices).length < 2) return null;
    const implied = Object.fromEntries(Object.entries(prices).map(([side, price]) => [side, 1 / price]));
    return {
      prices, implied, fair,
      fairOdds: Object.fromEntries(Object.entries(fair).map(([side, probability]) => [side, 1 / probability])),
      identity: { ...identity }, eventIdentity,
      updatedAt, sourceTimestampKnown: updatedAt != null,
      observedAt, movement: null, liveEvent: true,
    };
  }

  function addPair(target, key, prices, updatedAt, observedAt, identity, eventIdentity) {
    const pair = quote(prices, updatedAt, observedAt, identity, eventIdentity);
    if (pair) target[key] = pair;
  }

  function marketMetadata(market) {
    const provider = market?.provider || market?.bookmaker || {};
    return {
      marketId: market?.marketId ?? market?.id ?? null,
      bookmakerId: market?.bookmakerId ?? market?.providerId ?? provider?.id ?? null,
      bookmakerName: market?.bookmakerName ?? market?.providerName ?? provider?.name ?? null,
    };
  }

  function allMarkets(payload) {
    const raw = payload?.markets || payload?.odds?.markets || payload?.eventOdds?.markets
      || payload?.data?.markets;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  }

  function parseSnapshot(payload, { eventLive = false, observedAt = Date.now(), eventIdentity = null } = {}) {
    if (!eventLive || !payload || typeof payload !== 'object') return null;
    const markets = {
      matchTotals: {}, firstHalfTotals: {}, matchBtts: null, firstHalfBtts: null,
      nextGoal: null, remainingResult: null,
    };

    for (const market of allMarkets(payload)) {
      if (!market || suspended(market) || market.isLive === false || market.live === false || market.inPlay === false) continue;
      const title = marketTitle(market);
      const normalizedTitle = normalize(title);
      const half = isFirstHalf(title);
      const updatedAt = sourceTimestamp(market, payload, observedAt);
      const metadata = marketMetadata(market);
      const choices = choicesOf(market).filter((choice) => !suspended(choice) && priceOf(choice) != null);
      if (choices.length < 2) continue;

      if (/\b(both teams to score|both teams score|btts)\b/.test(normalizedTitle)) {
        const prices = {};
        for (const choice of choices) {
          const side = yesNoSide(choice.name ?? choice.label ?? choice.selectionName);
          if (side) prices[side] = priceOf(choice);
        }
        const pair = quote(prices, updatedAt, observedAt, {
          market: 'btts', period: half ? 'first-half' : 'match', line: null, ...metadata,
        }, eventIdentity);
        if (pair) {
          if (half) markets.firstHalfBtts = pair;
          else markets.matchBtts = pair;
        }
        continue;
      }

      if (/\b(next goal|next team to score|next scorer)\b/.test(normalizedTitle)) {
        const prices = {};
        for (const choice of choices) {
          const side = nextGoalSide(choice.name ?? choice.label ?? choice.selectionName);
          if (side) prices[side] = priceOf(choice);
        }
        const parsed = quote(prices, updatedAt, observedAt, {
          market: 'next-goal', period: 'next', line: null, ...metadata,
        }, eventIdentity);
        if (parsed) markets.nextGoal = parsed;
        continue;
      }

      if (/\b(rest of match|remaining match|remaining time)\b/.test(normalizedTitle)) {
        const prices = {};
        for (const choice of choices) {
          const side = resultSide(choice.name ?? choice.label ?? choice.selectionName);
          if (side) prices[side] = priceOf(choice);
        }
        const parsed = quote(prices, updatedAt, observedAt, {
          market: 'remaining-result', period: 'remaining', line: null, ...metadata,
        }, eventIdentity);
        if (parsed) markets.remainingResult = parsed;
        continue;
      }

      const isTotal = /\b(over under|total goals|total goal|goals over|goal line)\b/.test(normalizedTitle)
        || /\bo\/u\b/.test(normalizedTitle);
      if (!isTotal) continue;
      const lines = new Map();
      for (const choice of choices) {
        const choiceName = choice.name ?? choice.label ?? choice.selectionName;
        const side = totalSide(choiceName);
        if (!side) continue;
        const line = numberFromText(choiceName) ?? numberFromText(title);
        if (line == null || !Number.isFinite(line)) continue;
        const key = line.toFixed(1);
        if (!lines.has(key)) lines.set(key, {});
        lines.get(key)[side] = priceOf(choice);
      }
      const destination = half ? markets.firstHalfTotals : markets.matchTotals;
      for (const [line, prices] of lines) addPair(destination, line, prices, updatedAt, observedAt, {
        market: 'total-goals', period: half ? 'first-half' : 'match', line, ...metadata,
      }, eventIdentity);
    }

    const count = Object.keys(markets.matchTotals).length + Object.keys(markets.firstHalfTotals).length
      + Number(!!markets.matchBtts) + Number(!!markets.firstHalfBtts)
      + Number(!!markets.nextGoal) + Number(!!markets.remainingResult);
    return count ? { observedAt, liveEvent: true, eventIdentity, markets } : null;
  }

  function eachQuote(snapshot, callback) {
    if (!snapshot?.markets) return;
    for (const key of ['matchTotals', 'firstHalfTotals']) {
      for (const quoteValue of Object.values(snapshot.markets[key] || {})) callback(quoteValue);
    }
    for (const key of ['matchBtts', 'firstHalfBtts', 'nextGoal', 'remainingResult']) {
      if (snapshot.markets[key]) callback(snapshot.markets[key]);
    }
  }

  function sourceFresh(quoteValue, now) {
    if (!quoteValue?.liveEvent || !quoteValue.sourceTimestampKnown) return false;
    const age = now - quoteValue.updatedAt;
    return age >= -MAX_FUTURE_SKEW_MS && age <= MAX_SOURCE_AGE_MS;
  }

  function withMovement(current, previous) {
    if (!current?.markets) return current;
    const next = {
      ...current,
      markets: {
        ...current.markets,
        matchTotals: { ...current.markets.matchTotals },
        firstHalfTotals: { ...current.markets.firstHalfTotals },
      },
    };
    const pairs = [
      ['matchTotals', previous?.markets?.matchTotals],
      ['firstHalfTotals', previous?.markets?.firstHalfTotals],
    ];
    for (const [key, oldGroup] of pairs) {
      for (const [line, quoteValue] of Object.entries(next.markets[key])) {
        const old = oldGroup?.[line];
        if (!quoteValue.sourceTimestampKnown || !old?.sourceTimestampKnown
          || quoteValue.updatedAt <= old.updatedAt || quoteValue.updatedAt - old.updatedAt > 120_000) continue;
        quoteValue.movement = Object.fromEntries(Object.keys(quoteValue.fair).map((side) =>
          [side, quoteValue.fair[side] - (old.fair?.[side] ?? quoteValue.fair[side])]));
      }
    }
    for (const key of ['matchBtts', 'firstHalfBtts', 'nextGoal', 'remainingResult']) {
      const quoteValue = next.markets[key];
      const old = previous?.markets?.[key];
      if (!quoteValue || !old || !quoteValue.sourceTimestampKnown || !old.sourceTimestampKnown
        || quoteValue.updatedAt <= old.updatedAt || quoteValue.updatedAt - old.updatedAt > 120_000) continue;
      quoteValue.movement = Object.fromEntries(Object.keys(quoteValue.fair).map((side) =>
        [side, quoteValue.fair[side] - (old.fair?.[side] ?? quoteValue.fair[side])]));
    }
    return next;
  }

  function marketForSignal(snapshot, key) {
    let match = key.match(/^(match|half)-(?:(over|under)-([0-9_]+))$/);
    if (match) {
      const line = match[3].replace('_', '.');
      return {
        quote: match[1] === 'half' ? snapshot?.markets?.firstHalfTotals?.[line] : snapshot?.markets?.matchTotals?.[line],
        side: match[2],
        identity: { market: 'total-goals', period: match[1] === 'half' ? 'first-half' : 'match', line, selection: match[2] },
      };
    }
    match = key.match(/^(half-)?btts-(yes|no)$/);
    if (match) return {
      quote: match[1] ? snapshot?.markets?.firstHalfBtts : snapshot?.markets?.matchBtts,
      side: match[2],
      identity: { market: 'btts', period: match[1] ? 'first-half' : 'match', line: null, selection: match[2] },
    };
    match = key.match(/^next-goal-(home|away)$/);
    if (match) return {
      quote: snapshot?.markets?.nextGoal, side: match[1],
      identity: { market: 'next-goal', period: 'next', line: null, selection: match[1] },
    };
    match = key.match(/^rest-result-(home|away|draw)$/);
    if (match) return {
      quote: snapshot?.markets?.remainingResult, side: match[1],
      identity: { market: 'remaining-result', period: 'remaining', line: null, selection: match[1] },
    };
    return null;
  }

  function marketAssessment(snapshot, key, modelProbability, now = Date.now(), expectedEventIdentity) {
    const selected = marketForSignal(snapshot, key);
    if (!selected?.quote || !Number.isFinite(modelProbability) || modelProbability <= 0 || modelProbability >= 1) return null;
    const quoteValue = selected.quote;
    const price = quoteValue.prices?.[selected.side];
    const fairProbability = quoteValue.fair?.[selected.side];
    const rawProbability = quoteValue.implied?.[selected.side];
    const identityMatches = selected.identity && quoteValue.identity
      && ['market', 'period', 'line'].every((name) => quoteValue.identity[name] === selected.identity[name])
      && Object.prototype.hasOwnProperty.call(quoteValue.prices || {}, selected.side);
    const eventMatches = expectedEventIdentity == null || snapshot.eventIdentity === expectedEventIdentity;
    const verified = sourceFresh(quoteValue, now) && identityMatches && eventMatches
      && Number.isFinite(price) && Number.isFinite(fairProbability) && Number.isFinite(rawProbability);
    if (!verified) return {
      verified: false, reason: !eventMatches ? 'event-mismatch' : !identityMatches ? 'market-identity-mismatch' : 'stale-or-incomplete',
      identity: quoteValue.identity || null,
    };
    const edge = modelProbability - fairProbability;
    const expectedValue = modelProbability * price - 1;
    return {
      verified: true, provider: quoteValue.identity.bookmakerName || null,
      marketId: quoteValue.identity.marketId ?? null,
      identity: quoteValue.identity,
      price, impliedProbability: rawProbability, fairMarketProbability: fairProbability,
      marketFairOdds: quoteValue.fairOdds?.[selected.side] ?? null,
      modelProbability, modelFairOdds: 1 / modelProbability,
      edge, expectedValue,
      valueEligible: edge >= 0.03 && expectedValue >= 0.02,
      updatedAt: quoteValue.updatedAt, observedAt: quoteValue.observedAt,
      movement: quoteValue.movement?.[selected.side] ?? null,
    };
  }

  function confirmation(snapshot, key, now = Date.now()) {
    const selected = marketForSignal(snapshot, key);
    if (!selected?.quote) return null;
    const quoteValue = selected.quote;
    const fairProbability = quoteValue.fair?.[selected.side];
    const verified = sourceFresh(quoteValue, now) && Number.isFinite(fairProbability);
    return {
      verified,
      supported: verified && fairProbability >= MARKET_DIRECTION_FLOOR,
      price: quoteValue.prices?.[selected.side] ?? null,
      fairProbability: Number.isFinite(fairProbability) ? fairProbability : null,
      updatedAt: quoteValue.updatedAt,
      observedAt: quoteValue.observedAt,
      movement: quoteValue.movement?.[selected.side] ?? null,
    };
  }

  function summary(snapshot, now = Date.now()) {
    if (!snapshot?.markets) return { key: 'missing', label: 'Oran verisi yok', count: 0 };
    let count = 0;
    let verified = 0;
    let unknownTime = 0;
    eachQuote(snapshot, (quoteValue) => {
      count++;
      if (sourceFresh(quoteValue, now)) verified++;
      else if (!quoteValue.sourceTimestampKnown && snapshot.liveEvent) unknownTime++;
    });
    if (verified) return { key: 'verified', label: `Canlı oran teyidi · ${verified} market`, count, verified };
    if (unknownTime) return { key: 'unverified', label: `Oran alındı · kaynak zamanı belirsiz`, count, verified: 0 };
    return { key: 'stale', label: 'Oran güncellemesi eski', count, verified: 0 };
  }

  return {
    MAX_SOURCE_AGE_MS, MARKET_DIRECTION_FLOOR,
    parseSnapshot, withMovement, confirmation, marketAssessment, summary, sourceFresh,
  };
}));
