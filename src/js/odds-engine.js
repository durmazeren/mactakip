'use strict';

/* Defensive parser for live odds returned by the app's existing event scraper.
 * Only timestamped, active-event prices can confirm an analysis direction. */
(function attachOddsEngine(root, factory) {
  const engine = factory();
  root.OddsEngine = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
}(globalThis, () => {
  // A quote older than ten seconds is never eligible for live value. 5/10s
  // bands are visible to callers so an aging price cannot look current.
  const LIVE_SOURCE_AGE_MS = 5_000;
  const MAX_SOURCE_AGE_MS = 10_000;
  const VOLATILE_MAX_SOURCE_AGE_MS = 2_500;
  const MAX_FUTURE_SKEW_MS = 0;
  const MOVEMENT_MAX_GAP_MS = 120_000;
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
      if (/^\d{10,13}(?:\.\d+)?$/.test(value.trim())) {
        const numeric = Number(value.trim());
        const epoch = numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : NaN;
        return Number.isFinite(epoch) ? epoch : null;
      }
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function timestampsOf(object) {
    if (!object || typeof object !== 'object') return [];
    return TIMESTAMP_FIELDS.map((field) => timestamp(object[field])).filter(Number.isFinite);
  }

  function sourceTimestamp(market, payload, choices, observedAt) {
    // Use the market update time when available. If the scraper only stamps
    // selections, the pair is as fresh as its oldest leg, never its newest.
    const marketTimes = timestampsOf(market);
    const payloadTimes = timestampsOf(payload?.odds || payload);
    const choiceTimes = choices.map(timestampsOf);
    const hasAnyChoiceTime = choiceTimes.some((values) => values.length);
    const times = marketTimes.length
      ? [...marketTimes, ...(choiceTimes.length && choiceTimes.every((values) => values.length)
        ? choiceTimes.flat() : [])]
      : choiceTimes.length && choiceTimes.every((values) => values.length)
        ? choiceTimes.flat()
        : hasAnyChoiceTime ? [] : payloadTimes;
    if (!times.length) return { value: null, status: 'unknown' };
    const value = Math.min(...times);
    if (value > observedAt + MAX_FUTURE_SKEW_MS) return { value, status: 'future' };
    return { value, status: 'known' };
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
    return /\b(first half|1st half|half time|1st period|first period|1h|ht)\b/.test(normalize(title));
  }

  function isSecondHalf(title) {
    return /\b(second half|2nd half|2h|second period|2nd period)\b/.test(normalize(title));
  }

  function numberFromText(text) {
    const cleaned = String(text || '').replace(/\b\d+(?:st|nd|rd|th)\b/gi, '').replace(',', '.');
    const matches = [...cleaned.matchAll(/(?:^|\D)(\d{1,2}(?:\.\d{1,2})?)(?=$|\D)/g)];
    return matches.length ? Number(matches[matches.length - 1][1]) : null;
  }

  function canonicalLine(value) {
    return Number.isFinite(value) ? String(value) : null;
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

  function requiredSelections(kind, prices) {
    const sides = new Set(Object.keys(prices || {}));
    if (kind === 'total-goals') return sides.has('over') && sides.has('under');
    if (kind === 'btts') return sides.has('yes') && sides.has('no');
    if (kind === 'remaining-result') return ['home', 'draw', 'away'].every((side) => sides.has(side));
    if (kind === 'next-goal') return sides.has('home') && sides.has('away');
    return false;
  }

  function fairValues(prices) {
    const implied = Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, 1 / value]));
    const total = Object.values(implied).reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    return Object.fromEntries(Object.entries(implied).map(([key, value]) => [key, value / total]));
  }

  function sourceKey(identity) {
    const provider = identity.bookmakerId != null ? `id:${identity.bookmakerId}`
      : identity.bookmakerName ? `name:${normalize(identity.bookmakerName)}` : 'provider:unknown';
    const market = identity.marketId != null ? `market:${identity.marketId}` : 'market:unknown';
    return `${provider}|${market}`;
  }

  function missingIdentityFields(identity) {
    return ['marketId', 'bookmakerId', 'sourceEventId', 'liveFlag']
      .filter((field) => identity?.[field] == null);
  }

  function quote(prices, updatedAt, timestampStatus, observedAt, identity, eventIdentity, selections) {
    const fair = fairValues(prices);
    if (!fair || Object.keys(prices).length < 2) return null;
    const implied = Object.fromEntries(Object.entries(prices).map(([side, price]) => [side, 1 / price]));
    const missing = missingIdentityFields(identity);
    const fairOdds = Object.fromEntries(Object.entries(fair).map(([side, probability]) => [side, 1 / probability]));
    return {
      prices, implied, fair, marketFairProbability: fair, fairOdds, marketFairOdds: fairOdds,
      identity: { ...identity }, eventIdentity,
      updatedAt, sourceTimestampKnown: timestampStatus === 'known', timestampStatus,
      observedAt, movement: null, liveEvent: true, selectionIds: selections || {},
      identityCompleteness: missing.length ? 'partial' : 'complete', missingIdentityFields: missing,
      sourceKey: sourceKey(identity),
    };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function freshnessBand(quoteValue, now, volatile = false) {
    if (!quoteValue?.sourceTimestampKnown) return quoteValue?.timestampStatus === 'future' ? 'FUTURE' : 'UNKNOWN';
    const age = now - quoteValue.updatedAt;
    if (age < 0) return 'FUTURE';
    if (volatile) {
      if (age <= 1_000) return 'LIVE';
      if (age <= VOLATILE_MAX_SOURCE_AGE_MS) return 'AGING';
      return 'VOLATILE_STALE';
    }
    if (age <= LIVE_SOURCE_AGE_MS) return 'LIVE';
    if (age <= MAX_SOURCE_AGE_MS) return 'AGING';
    return 'STALE';
  }

  function quoteFresh(quoteValue, now, volatile = false) {
    return ['LIVE', 'AGING'].includes(freshnessBand(quoteValue, now, volatile));
  }

  function aggregateBooks(bookQuotes, observedAt) {
    const best = {};
    const fairBySide = {};
    const usableBooks = bookQuotes.filter((item) => quoteFresh(item, observedAt));
    for (const item of usableBooks) {
      for (const [side, price] of Object.entries(item.prices || {})) {
        if (!best[side] || price > best[side].price
          || (price === best[side].price && item.updatedAt > best[side].updatedAt)) {
          best[side] = { price, updatedAt: item.updatedAt, item };
        }
      }
      for (const [side, probability] of Object.entries(item.fair || {})) (fairBySide[side] ||= []).push(probability);
    }
    const prices = Object.fromEntries(Object.entries(best).map(([side, value]) => [side, value.price]));
    const rawFair = Object.fromEntries(Object.entries(fairBySide).map(([side, values]) => [side, median(values)]));
    const total = Object.values(rawFair).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    const fair = total > 0
      ? Object.fromEntries(Object.entries(rawFair).map(([side, probability]) => [side, probability / total]))
      : (bookQuotes[0]?.fair || {});
    const selectedBook = Object.values(best)[0]?.item || bookQuotes[0] || null;
    const missing = missingIdentityFields(selectedBook?.identity);
    const fairOdds = Object.fromEntries(Object.entries(fair).map(([side, probability]) => [side, 1 / probability]));
    return {
      ...(selectedBook || {}), prices,
      implied: Object.fromEntries(Object.entries(prices).map(([side, price]) => [side, 1 / price])),
      fair, marketFairProbability: fair, fairOdds, marketFairOdds: fairOdds,
      bookQuotes, bestQuotes: Object.fromEntries(Object.entries(best).map(([side, value]) => [side, value.item])),
      consensusBookCount: usableBooks.length,
      identityCompleteness: missing.length ? 'partial' : 'complete', missingIdentityFields: missing,
      observedAt, movement: null,
    };
  }

  function addPair(target, key, prices, timestampInfo, observedAt, identity, eventIdentity, selections) {
    const pair = quote(prices, timestampInfo.value, timestampInfo.status, observedAt, identity, eventIdentity, selections);
    if (!pair) return;
    target[key] = mergePair(target[key], pair, observedAt);
  }

  function mergePair(existing, pair, observedAt) {
    const books = existing?.bookQuotes ? [...existing.bookQuotes] : existing ? [existing] : [];
    const same = books.findIndex((item) => item.sourceKey === pair.sourceKey);
    if (same >= 0) {
      const old = books[same];
      if (pair.updatedAt != null && (old.updatedAt == null || pair.updatedAt >= old.updatedAt)) books[same] = pair;
    } else books.push(pair);
    return aggregateBooks(books, observedAt);
  }

  function marketMetadata(market, payload) {
    const provider = market?.provider || market?.bookmaker || {};
    const explicitLive = market?.isLive ?? market?.live ?? market?.inPlay;
    return {
      marketId: market?.marketId ?? market?.id ?? null,
      bookmakerId: market?.bookmakerId ?? market?.providerId ?? provider?.id ?? null,
      bookmakerName: market?.bookmakerName ?? market?.providerName ?? provider?.name ?? null,
      sourceEventId: market?.eventId ?? market?.event?.id ?? payload?.eventId ?? payload?.event?.id ?? null,
      liveFlag: typeof explicitLive === 'boolean' ? explicitLive : null,
    };
  }

  function allMarkets(payload) {
    const raw = payload?.markets || payload?.odds?.markets || payload?.eventOdds?.markets
      || payload?.data?.markets;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  }

  function hasMarketContainer(payload) {
    return payload?.markets != null || payload?.odds?.markets != null
      || payload?.eventOdds?.markets != null || payload?.data?.markets != null;
  }

  function parseSnapshot(payload, {
    eventLive = false, observedAt = Date.now(), eventIdentity = null, volatile = false,
  } = {}) {
    if (!eventLive || !payload || typeof payload !== 'object') return null;
    const markets = {
      matchTotals: {}, firstHalfTotals: {}, matchBtts: null, firstHalfBtts: null,
      nextGoal: null, remainingResult: null,
    };
    const availability = {};
    const rawMarkets = allMarkets(payload);
    if (!hasMarketContainer(payload)) return null;

    for (const market of rawMarkets) {
      if (!market || typeof market !== 'object') continue;
      const title = marketTitle(market);
      const normalizedTitle = normalize(title);
      const half = isFirstHalf(title);
      const secondHalf = isSecondHalf(title);
      const metadata = marketMetadata(market, payload);
      const choices = choicesOf(market);
      const updatedAt = sourceTimestamp(market, payload, choices, observedAt);
      const isBtts = /\b(both teams to score|both teams score|btts)\b/.test(normalizedTitle);
      const isNextGoal = /\b(next goal|next team to score|next scorer)\b/.test(normalizedTitle);
      const isRemaining = /\b(rest of match|remaining match|remaining time)\b/.test(normalizedTitle);
      const isTotal = /\b(over under|total goals|total goal|goals over|goal line)\b/.test(normalizedTitle)
        || /\bo\/u\b/.test(normalizedTitle);
      const period = isNextGoal ? 'next' : isRemaining ? 'remaining'
        : half ? 'first-half' : secondHalf ? 'second-half' : 'match';
      if (!isBtts && !isNextGoal && !isRemaining && !isTotal) continue;
      if (metadata.liveFlag === false) continue;

      const expectedRawEventId = eventIdentity == null ? null : String(eventIdentity).split('|')[0];
      if (metadata.sourceEventId != null && expectedRawEventId != null
        && String(metadata.sourceEventId) !== expectedRawEventId) {
        const line = numberFromText(title);
        const kind = isBtts ? 'btts' : isNextGoal ? 'next-goal'
          : isRemaining ? 'remaining-result' : isTotal ? 'total-goals' : null;
        if (kind) availability[[kind, period, kind === 'total-goals' ? canonicalLine(line) || '' : ''].join('|')] = 'event-mismatch';
        continue;
      }
      const validChoices = choices.filter((choice) => !suspended(choice) && priceOf(choice) != null);
      const closed = suspended(market);
      const markAvailability = (kind, line = '') => {
        availability[[kind, period, line].join('|')] = closed ? 'closed' : 'partial';
      };
      if (isBtts) markAvailability('btts');
      if (isNextGoal) markAvailability('next-goal');
      if (isRemaining) markAvailability('remaining-result');
      if (isTotal) {
        const titleLine = numberFromText(title);
        if (titleLine != null) markAvailability('total-goals', canonicalLine(titleLine));
      }
      if (period === 'second-half' && !isNextGoal && !isRemaining) continue;
      if (closed) continue;

      if (isBtts || isNextGoal || isRemaining) {
        if (validChoices.length < 2) continue;
        const prices = {};
        const selectionIds = {};
        for (const choice of validChoices) {
          const label = choice.name ?? choice.label ?? choice.selectionName;
          const side = isBtts ? yesNoSide(label) : isNextGoal ? nextGoalSide(label) : resultSide(label);
          if (side) {
            prices[side] = priceOf(choice);
            selectionIds[side] = choice?.choiceId ?? choice?.selectionId ?? choice?.id ?? null;
          }
        }
        const kind = isBtts ? 'btts' : isNextGoal ? 'next-goal' : 'remaining-result';
        if (!requiredSelections(kind, prices)) {
          availability[[kind, period, ''].join('|')] = 'partial';
          continue;
        }
        const identity = {
          market: kind, period, line: null, ...metadata,
        };
        const parsed = quote(prices, updatedAt.value, updatedAt.status, observedAt, identity, eventIdentity, selectionIds);
        if (parsed) {
          if (isBtts) {
            const field = half ? 'firstHalfBtts' : 'matchBtts';
            markets[field] = mergePair(markets[field], parsed, observedAt);
          } else if (isNextGoal) markets.nextGoal = mergePair(markets.nextGoal, parsed, observedAt);
          else markets.remainingResult = mergePair(markets.remainingResult, parsed, observedAt);
          availability[[kind, period, ''].join('|')] = 'open';
        }
        continue;
      }

      if (!isTotal) continue;
      const lines = new Map();
      for (const choice of validChoices) {
        const choiceName = choice.name ?? choice.label ?? choice.selectionName;
        const side = totalSide(choiceName);
        if (!side) continue;
        const lineNumber = numberFromText(choiceName) ?? numberFromText(title);
        if (lineNumber == null || !Number.isFinite(lineNumber)) continue;
        const line = canonicalLine(lineNumber);
        if (!lines.has(line)) lines.set(line, { prices: {}, selectionIds: {} });
        const entry = lines.get(line);
        entry.prices[side] = priceOf(choice);
        entry.selectionIds[side] = choice?.choiceId ?? choice?.selectionId ?? choice?.id ?? null;
      }
      const destination = half ? markets.firstHalfTotals : markets.matchTotals;
      for (const [line, entry] of lines) {
        const kind = 'total-goals';
        availability[[kind, period, line].join('|')] = 'partial';
        if (!requiredSelections(kind, entry.prices)) continue;
        addPair(destination, line, entry.prices, updatedAt, observedAt, {
          market: kind, period, line, ...metadata,
        }, eventIdentity, entry.selectionIds);
        if (destination[line]) availability[[kind, period, line].join('|')] = 'open';
      }
    }

    const hasParsedQuotes = Object.keys(markets.matchTotals).length + Object.keys(markets.firstHalfTotals).length
      + Number(!!markets.matchBtts) + Number(!!markets.firstHalfBtts)
      + Number(!!markets.nextGoal) + Number(!!markets.remainingResult) > 0;
    if (!hasParsedQuotes && eventIdentity == null) return null;
    return {
      observedAt, liveEvent: true, eventIdentity, markets, availability,
      feedStatus: 'complete', volatile, rawMarketCount: rawMarkets.length,
    };
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

  function sourceFresh(quoteValue, now, options = {}) {
    if (!quoteValue?.liveEvent) return false;
    const volatile = typeof options === 'boolean' ? options : !!options.volatile;
    return quoteFresh(quoteValue, now, volatile);
  }

  function withMovement(current, previous, now = current?.observedAt ?? Date.now()) {
    if (!current?.markets) return current;
    const next = {
      ...current,
      availability: { ...(current.availability || {}) },
      markets: {
        ...current.markets,
        matchTotals: { ...current.markets.matchTotals },
        firstHalfTotals: { ...current.markets.firstHalfTotals },
      },
    };
    const pairs = [];
    for (const group of ['matchTotals', 'firstHalfTotals']) {
      for (const [line, quoteValue] of Object.entries(next.markets[group] || {}))
        pairs.push({ key: group + '|' + line, quoteValue, old: previous?.markets?.[group]?.[line] });
    }
    for (const field of ['matchBtts', 'firstHalfBtts', 'nextGoal', 'remainingResult'])
      pairs.push({ key: field, quoteValue: next.markets[field], old: previous?.markets?.[field] });
    for (const pair of pairs) {
      const { quoteValue, old } = pair;
      if (!quoteValue || !old) continue;
      const oldBooks = old.bookQuotes || [old];
      const oldBySource = new Map(oldBooks.map((item) => [item.sourceKey, item]));
      const deltaBySide = {};
      for (const currentBook of quoteValue.bookQuotes || [quoteValue]) {
        const oldBook = oldBySource.get(currentBook.sourceKey);
        if (!oldBook || currentBook.identity?.marketId !== oldBook.identity?.marketId
          || currentBook.eventIdentity !== oldBook.eventIdentity
          || !currentBook.sourceTimestampKnown || !oldBook.sourceTimestampKnown
          || currentBook.updatedAt <= oldBook.updatedAt
          || currentBook.updatedAt - oldBook.updatedAt > MOVEMENT_MAX_GAP_MS
          || !quoteFresh(currentBook, now) || !quoteFresh(oldBook, oldBook.observedAt)) continue;
        for (const [side, probability] of Object.entries(currentBook.fair || {})) {
          if (!Number.isFinite(oldBook.fair?.[side])) continue;
          (deltaBySide[side] ||= []).push(probability - oldBook.fair[side]);
        }
      }
      const movement = Object.fromEntries(Object.entries(deltaBySide).map(([side, values]) => [side, median(values)]));
      quoteValue.movement = Object.keys(movement).length ? movement : null;
    }
    if (previous?.markets) {
      const absent = [];
      for (const line of Object.keys(previous.markets.matchTotals || {}))
        if (!next.markets.matchTotals?.[line]) absent.push('total-goals|match|' + line);
      for (const line of Object.keys(previous.markets.firstHalfTotals || {}))
        if (!next.markets.firstHalfTotals?.[line]) absent.push('total-goals|first-half|' + line);
      if (previous.markets.matchBtts && !next.markets.matchBtts) absent.push('btts|match|');
      if (previous.markets.firstHalfBtts && !next.markets.firstHalfBtts) absent.push('btts|first-half|');
      if (previous.markets.nextGoal && !next.markets.nextGoal) absent.push('next-goal|next|');
      if (previous.markets.remainingResult && !next.markets.remainingResult) absent.push('remaining-result|remaining|');
      for (const key of absent) if (!Object.hasOwn(next.availability, key)) next.availability[key] = 'disappeared';
    }
    return next;
  }

  function marketForSignal(snapshot, key) {
    let match = key.match(/^(match|half)-(?:(over|under)-([0-9_]+))$/);
    if (match) {
      const line = match[3].replace('_', '.');
      const period = match[1] === 'half' ? 'first-half' : 'match';
      return {
        quote: match[1] === 'half' ? snapshot?.markets?.firstHalfTotals?.[line] : snapshot?.markets?.matchTotals?.[line],
        side: match[2],
        identity: { market: 'total-goals', period, line, selection: match[2] },
        availabilityKey: 'total-goals|' + period + '|' + line,
      };
    }
    match = key.match(/^(half-)?btts-(yes|no)$/);
    if (match) return {
      quote: match[1] ? snapshot?.markets?.firstHalfBtts : snapshot?.markets?.matchBtts,
      side: match[2],
      identity: { market: 'btts', period: match[1] ? 'first-half' : 'match', line: null, selection: match[2] },
      availabilityKey: 'btts|' + (match[1] ? 'first-half' : 'match') + '|',
    };
    match = key.match(/^next-goal-(home|away)$/);
    if (match) return {
      quote: snapshot?.markets?.nextGoal, side: match[1],
      identity: { market: 'next-goal', period: 'next', line: null, selection: match[1] },
      availabilityKey: 'next-goal|next|',
    };
    match = key.match(/^rest-result-(home|away|draw)$/);
    if (match) return {
      quote: snapshot?.markets?.remainingResult, side: match[1],
      identity: { market: 'remaining-result', period: 'remaining', line: null, selection: match[1] },
      availabilityKey: 'remaining-result|remaining|',
    };
    return null;
  }

  function consensusForBooks(books) {
    const sides = new Set(books.flatMap((book) => Object.keys(book.fair || {})));
    const raw = {};
    for (const side of sides) raw[side] = median(books.map((book) => book.fair?.[side]));
    const total = Object.values(raw).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    return total > 0
      ? Object.fromEntries(Object.entries(raw).map(([side, value]) => [side, value / total]))
      : {};
  }

  function expectedIdentityMatches(identity, expected = {}) {
    const fields = [
      ['marketId', 'marketId'], ['bookmakerId', 'bookmakerId'], ['period', 'period'],
      ['line', 'line'], ['eventId', 'sourceEventId'],
    ];
    return fields.every(([expectedKey, actualKey]) => expected[expectedKey] == null
      || String(expected[expectedKey]) === String(identity?.[actualKey]));
  }

  function marketAssessment(snapshot, key, modelProbability, now = Date.now(), expectedEventIdentity, options = {}) {
    const selected = marketForSignal(snapshot, key);
    if (!selected || !Number.isFinite(modelProbability) || modelProbability <= 0 || modelProbability >= 1) return null;
    const quoteValue = selected.quote;
    const volatile = !!(options.volatile ?? snapshot?.volatile);
    const failure = (reason, band = null, identity = quoteValue?.identity || null) => ({
      verified: false, valueEligible: false, reason, freshnessBand: band, identity,
      availability: selected.availabilityKey ? snapshot?.availability?.[selected.availabilityKey] ?? null : null,
      identityCompleteness: quoteValue?.identityCompleteness || 'partial',
      missingIdentityFields: quoteValue?.missingIdentityFields || [], theoreticalValue: false,
    });
    if (!quoteValue) {
      const availability = snapshot?.availability?.[selected.availabilityKey];
      if (availability == null) return null;
      const reason = availability === 'closed' ? 'market-closed'
        : availability === 'disappeared' ? 'market-disappeared'
          : availability === 'event-mismatch' ? 'event-mismatch'
            : availability === 'partial' ? 'market-incomplete' : 'market-unavailable';
      return failure(reason, availability === 'closed' ? 'CLOSED' : null, null);
    }
    const allBooks = quoteValue.bookQuotes || [quoteValue];
    const freshBooks = allBooks.filter((book) => quoteFresh(book, now, volatile));
    const books = freshBooks.filter((book) =>
      expectedIdentityMatches(book.identity, options.expectedIdentity || {}));
    if (!books.length && freshBooks.length) return failure('market-identity-mismatch', 'LIVE');
    const bestBook = books.reduce((best, book) => {
      const price = book.prices?.[selected.side];
      if (!Number.isFinite(price)) return best;
      return !best || price > best.prices[selected.side]
        || (price === best.prices[selected.side] && book.updatedAt > best.updatedAt) ? book : best;
    }, null);
    const fairProbability = consensusForBooks(books)[selected.side];
    const price = bestBook?.prices?.[selected.side];
    const rawProbability = Number.isFinite(price) ? 1 / price : null;
    const expectedRawEventId = expectedEventIdentity == null ? null : String(expectedEventIdentity).split('|')[0];
    const sourceEventId = bestBook?.identity?.sourceEventId;
    const eventMatches = expectedEventIdentity == null || snapshot.eventIdentity === expectedEventIdentity;
    const sourceEventMatches = sourceEventId == null || expectedRawEventId == null
      || String(sourceEventId) === expectedRawEventId;
    const identityMatches = !!bestBook && ['market', 'period', 'line'].every((field) =>
      String(bestBook.identity?.[field]) === String(selected.identity[field]))
      && expectedIdentityMatches(bestBook.identity, options.expectedIdentity || {})
      && (options.expectedIdentity?.selection == null
        || options.expectedIdentity.selection === selected.side)
      && (options.expectedIdentity?.selectionId == null
        || String(options.expectedIdentity.selectionId) === String(bestBook.selectionIds?.[selected.side]));
    const bands = allBooks.map((book) => freshnessBand(book, now, volatile));
    const band = bestBook ? freshnessBand(bestBook, now, volatile)
      : bands.includes('FUTURE') ? 'FUTURE'
        : bands.includes('UNKNOWN') ? 'UNKNOWN'
          : volatile ? 'VOLATILE_STALE' : 'STALE';
    if (!eventMatches || !sourceEventMatches) return failure('event-mismatch', band, bestBook?.identity || null);
    if (!bestBook) {
      const reason = band === 'FUTURE' ? 'future-timestamp'
        : band === 'UNKNOWN' ? 'source-timestamp-missing' : 'stale-price';
      return failure(reason, band, quoteValue.identity);
    }
    if (!identityMatches) return failure('market-identity-mismatch', band, bestBook.identity);
    if (!bestBook || !Number.isFinite(fairProbability) || !Number.isFinite(rawProbability)) {
      const reason = band === 'FUTURE' ? 'future-timestamp'
        : band === 'UNKNOWN' ? 'source-timestamp-missing'
          : books.length ? 'selection-unavailable' : 'stale-price';
      return failure(reason, band, bestBook?.identity || quoteValue.identity);
    }

    const edge = modelProbability - fairProbability;
    const expectedValue = modelProbability * price - 1;
    const missing = missingIdentityFields(bestBook.identity);
    return {
      verified: true, provider: bestBook.identity.bookmakerName || null,
      bookmakerId: bestBook.identity.bookmakerId ?? null,
      marketId: bestBook.identity.marketId ?? null,
      identity: {
        ...bestBook.identity, selection: selected.side,
        selectionId: bestBook.selectionIds?.[selected.side] ?? null,
      },
      identityCompleteness: missing.length ? 'partial' : 'complete',
      missingIdentityFields: missing, eventIdentityVerified: eventMatches && sourceEventMatches,
      liveFlagVerified: bestBook.identity.liveFlag === true,
      liveFlagSource: bestBook.identity.liveFlag == null ? 'parent-event-context' : 'scraper',
      price, bestAvailablePrice: price, bestAvailableBookmaker: bestBook.identity.bookmakerName || null,
      impliedProbability: rawProbability, marketImpliedProbability: rawProbability,
      fairMarketProbability: fairProbability, marketFairOdds: 1 / fairProbability,
      consensusBookCount: books.length,
      modelProbability, modelFairOdds: 1 / modelProbability,
      edge, expectedValue,
      valueEligible: edge >= 0.03 && expectedValue >= 0.02
        && missing.length === 0 && eventMatches && sourceEventMatches,
      theoreticalValue: true,
      updatedAt: bestBook.updatedAt, observedAt: bestBook.observedAt,
      oddsAgeMs: now - bestBook.updatedAt, freshnessBand: band,
      movement: quoteValue.movement?.[selected.side] ?? null,
    };
  }

  function confirmation(snapshot, key, now = Date.now(), options = {}) {
    const selected = marketForSignal(snapshot, key);
    if (!selected?.quote) return null;
    const volatile = !!(options.volatile ?? snapshot?.volatile);
    const books = (selected.quote.bookQuotes || [selected.quote])
      .filter((book) => quoteFresh(book, now, volatile));
    const fairProbability = consensusForBooks(books)[selected.side];
    const prices = books.map((book) => book.prices?.[selected.side]).filter(Number.isFinite);
    const timestamps = books.map((book) => book.updatedAt).filter(Number.isFinite);
    const verified = books.length > 0 && Number.isFinite(fairProbability);
    return {
      verified, supported: verified && fairProbability >= MARKET_DIRECTION_FLOOR,
      price: prices.length ? Math.max(...prices) : null,
      fairProbability: Number.isFinite(fairProbability) ? fairProbability : null,
      consensusBookCount: books.length,
      updatedAt: timestamps.length ? Math.max(...timestamps) : null,
      observedAt: snapshot.observedAt,
      movement: selected.quote.movement?.[selected.side] ?? null,
      freshnessBand: verified ? 'LIVE_OR_AGING' : 'STALE',
    };
  }

  function summary(snapshot, now = Date.now()) {
    if (!snapshot?.markets) return { key: 'missing', label: 'Canl\u0131 market fiyat\u0131 yok', count: 0, verified: 0 };
    let count = 0;
    let live = 0;
    let aging = 0;
    let stale = 0;
    let unknown = 0;
    let future = 0;
    eachQuote(snapshot, (quoteValue) => {
      for (const book of quoteValue.bookQuotes || [quoteValue]) {
        count++;
        const band = freshnessBand(book, now, !!snapshot.volatile);
        if (band === 'LIVE') live++;
        else if (band === 'AGING') aging++;
        else if (band === 'FUTURE') future++;
        else if (band === 'UNKNOWN') unknown++;
        else stale++;
      }
    });
    if (live) return { key: 'live', label: 'Canl\u0131 oranlar (0-5 sn)', count, verified: live, aging, stale };
    if (aging) return { key: 'aging', label: 'Oranlar ya\u015Flan\u0131yor (5-10 sn)', count, verified: 0, aging, stale };
    if (unknown) return { key: 'unverified', label: 'Kaynak zaman damgas\u0131 yok', count, verified: 0 };
    if (future) return { key: 'future', label: 'Sa\u011Flay\u0131c\u0131 zaman\u0131 gelecekte', count, verified: 0 };
    if (stale) return { key: 'stale', label: 'Oranlar eski; de\u011Fer hesab\u0131 kapal\u0131', count, verified: 0 };
    if (Object.values(snapshot.availability || {}).includes('closed'))
      return { key: 'closed', label: 'Market kapal\u0131 veya ask\u0131da', count: 0, verified: 0 };
    if (Object.values(snapshot.availability || {}).includes('disappeared'))
      return { key: 'disappeared', label: 'Market ak\u0131\u015Ftan kayboldu', count: 0, verified: 0 };
    return { key: 'missing', label: 'Canl\u0131 market fiyat\u0131 yok', count: 0, verified: 0 };
  }
  return {
    LIVE_SOURCE_AGE_MS, MAX_SOURCE_AGE_MS, VOLATILE_MAX_SOURCE_AGE_MS, MARKET_DIRECTION_FLOOR,
    parseSnapshot, withMovement, confirmation, marketAssessment, summary, sourceFresh,
  };
}));
