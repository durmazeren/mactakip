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

  function providerEventId(identity) {
    if (identity == null) return null;
    if (typeof identity === 'number' && Number.isSafeInteger(identity)) return String(identity);
    const text = String(identity);
    try {
      const parsed = JSON.parse(text);
      const id = parsed?.providerEventId ?? parsed?.eventId ?? parsed?.id;
      if (id != null) return String(id);
    } catch { /* Older callers may still pass a delimiter identity. */ }
    return text.split('|')[0] || null;
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
    // Scraper payloads may separate the market family from the period label.
    return [market?.marketName, market?.name, market?.title, market?.market, market?.marketGroup,
      market?.periodName, market?.marketPeriod]
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

  function nextGoalSide(choiceName, homeAliases = [], awayAliases = []) {
    const name = normalize(choiceName);
    if (/^(home|home team|1|ev|ev sahibi)(?:\s|$)/.test(name)) return 'home';
    if (/^(away|away team|2|deplasman)(?:\s|$)/.test(name)) return 'away';
    if (/^(no goal|no more goals|none|no more scoring|gol yok)(?:\s|$)/.test(name)) return 'none';
    if (homeAliases.some((alias) => name === normalize(alias))) return 'home';
    if (awayAliases.some((alias) => name === normalize(alias))) return 'away';
    return null;
  }

  function teamAliases(team) {
    if (!team || typeof team !== 'object') return [];
    return [team.name, team.shortName, team.nameCode, team.slug]
      .filter((value) => typeof value === 'string' && value.trim());
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
    // No-goal is a real outcome in next-goal markets. Mixing a two-outcome
    // home/away quote with a three-outcome market distorts no-vig consensus.
    if (kind === 'next-goal') return ['home', 'away', 'none'].every((side) => sides.has(side));
    return false;
  }

  function fairValues(prices) {
    const implied = Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, 1 / value]));
    const total = Object.values(implied).reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    return Object.fromEntries(Object.entries(implied).map(([key, value]) => [key, value / total]));
  }

  function sourceKey(identity) {
    // Without all three source identifiers a quote cannot be safely linked
    // across snapshots or counted as an independent bookmaker observation.
    const bookmaker = identity.bookmakerId != null ? `id:${identity.bookmakerId}`
      : identity.bookmakerName ? `name:${normalize(identity.bookmakerName)}` : null;
    if (bookmaker == null || identity.marketId == null || identity.sourceEventId == null) return null;
    return `event:${identity.sourceEventId}|${bookmaker}|market:${identity.marketId}`;
  }

  function missingIdentityFields(identity, selectionIds) {
    const missing = ['marketId', 'bookmakerId', 'sourceEventId', 'liveFlag']
      .filter((field) => identity?.[field] == null);
    if (!selectionIds || Object.values(selectionIds).some((value) => value == null)) missing.push('selectionId');
    return missing;
  }

  function quote(prices, updatedAt, timestampStatus, observedAt, identity, eventIdentity, selections) {
    const fair = fairValues(prices);
    if (!fair || Object.keys(prices).length < 2) return null;
    const implied = Object.fromEntries(Object.entries(prices).map(([side, price]) => [side, 1 / price]));
    const missing = missingIdentityFields(identity, selections);
    const fairOdds = Object.fromEntries(Object.entries(fair).map(([side, probability]) => [side, 1 / probability]));
    return {
      prices, implied, fair, marketFairProbability: fair, fairOdds, marketFairOdds: fairOdds,
      identity: { ...identity }, eventIdentity,
      updatedAt, sourceTimestampKnown: timestampStatus === 'known', timestampStatus,
      observedAt, movement: null, liveEvent: true, selectionIds: selections || {},
      outcomeSet: Object.keys(prices).sort(),
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

  function robustFairConsensus(bookQuotes) {
    const compatible = consensusGroup(bookQuotes);
    if (!compatible.length) return {};
    const outcomeSet = compatible[0].outcomeSet || Object.keys(compatible[0].fair || {}).sort();
    if (!compatible.length || outcomeSet.some((side) => compatible.some((book) => !(book.fair?.[side] > 0)))) return {};

    // The Aitchison center built from median log-ratios is a coherent,
    // outlier-resistant consensus for two-way and multi-way no-vig books.
    const reference = outcomeSet[0];
    const logits = { [reference]: 0 };
    for (const side of outcomeSet.slice(1)) {
      logits[side] = median(compatible.map((book) => Math.log(book.fair[side] / book.fair[reference])));
    }
    const maxLogit = Math.max(...Object.values(logits));
    const weights = Object.fromEntries(Object.entries(logits).map(([side, value]) => [side, Math.exp(value - maxLogit)]));
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    return total > 0 ? Object.fromEntries(Object.entries(weights).map(([side, value]) => [side, value / total])) : {};
  }

  function consensusGroup(bookQuotes) {
    const groups = new Map();
    for (const book of bookQuotes || []) {
      const sides = book.outcomeSet || Object.keys(book.fair || {}).sort();
      const key = [...sides].sort().join('|');
      groups.set(key, [...(groups.get(key) || []), book]);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
  }

  function distinctBookmakers(books) {
    const groups = new Map();
    const unidentified = [];
    for (const book of books || []) {
      const bookmaker = book.identity?.bookmakerId != null ? `id:${book.identity.bookmakerId}`
        : book.identity?.bookmakerName ? `name:${normalize(book.identity.bookmakerName)}` : null;
      if (bookmaker == null) {
        unidentified.push(book);
        continue;
      }
      groups.set(bookmaker, [...(groups.get(bookmaker) || []), book]);
    }
    // A single bookmaker with multiple matching market IDs is ambiguous. It
    // must not get multiple votes or contribute a synthetic best price.
    return [...[...groups.values()].filter((group) => group.length === 1).map((group) => group[0]), ...unidentified];
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

  function aggregateBooks(bookQuotes, observedAt, volatile = false) {
    const usableBooks = bookQuotes.filter((item) => quoteFresh(item, observedAt, volatile));
    const consensusBooks = distinctBookmakers(consensusGroup(usableBooks));
    const best = {};
    for (const item of consensusBooks) {
      for (const [side, price] of Object.entries(item.prices || {})) {
        if (!best[side] || price > best[side].price
          || (price === best[side].price && item.updatedAt > best[side].updatedAt)) {
          best[side] = { price, updatedAt: item.updatedAt, item };
        }
      }
    }
    const prices = Object.fromEntries(Object.entries(best).map(([side, value]) => [side, value.price]));
    const fair = robustFairConsensus(consensusBooks);
    const selectedBook = Object.values(best)[0]?.item || bookQuotes[0] || null;
    const missing = missingIdentityFields(selectedBook?.identity, selectedBook?.selectionIds);
    const fairOdds = Object.fromEntries(Object.entries(fair).map(([side, probability]) => [side, 1 / probability]));
    return {
      ...(selectedBook || {}), prices,
      implied: Object.fromEntries(Object.entries(prices).map(([side, price]) => [side, 1 / price])),
      fair, marketFairProbability: fair, fairOdds, marketFairOdds: fairOdds,
      bookQuotes, bestQuotes: Object.fromEntries(Object.entries(best).map(([side, value]) => [side, value.item])),
      priceProvenanceBySelection: Object.fromEntries(Object.entries(best).map(([side, value]) => [side, {
        price: value.price,
        bookmakerId: value.item.identity?.bookmakerId ?? null,
        bookmakerName: value.item.identity?.bookmakerName ?? null,
        marketId: value.item.identity?.marketId ?? null,
        sourceEventId: value.item.identity?.sourceEventId ?? null,
        sourceUpdatedAt: value.item.updatedAt,
      }])),
      consensusBookCount: new Set(consensusBooks.map((book) => book.identity?.bookmakerId ?? book.identity?.bookmakerName).filter((value) => value != null)).size,
      identityScope: !consensusBooks.length ? 'unavailable'
        : consensusBooks.length > 1 ? 'cross-book-consensus' : 'single-book',
      quoteCount: usableBooks.length,
      incompatibleOutcomeQuoteCount: usableBooks.length - consensusBooks.length,
      consensusMethod: 'median-log-ratio-no-vig',
      identityCompleteness: missing.length ? 'partial' : 'complete', missingIdentityFields: missing,
      observedAt, movement: null,
    };
  }

  function addPair(target, key, prices, timestampInfo, observedAt, identity, eventIdentity, selections, volatile = false) {
    const pair = quote(prices, timestampInfo.value, timestampInfo.status, observedAt, identity, eventIdentity, selections);
    if (!pair) return;
    target[key] = mergePair(target[key], pair, observedAt, volatile);
  }

  function mergePair(existing, pair, observedAt, volatile = false) {
    const books = existing?.bookQuotes ? [...existing.bookQuotes] : existing ? [existing] : [];
    const same = pair.sourceKey == null ? -1 : books.findIndex((item) => item.sourceKey === pair.sourceKey);
    if (same >= 0) {
      const old = books[same];
      if (pair.updatedAt != null && (old.updatedAt == null || pair.updatedAt >= old.updatedAt)) books[same] = pair;
    } else books.push(pair);
    return aggregateBooks(books, observedAt, volatile);
  }

  function marketMetadata(market, payload) {
    const provider = market?.provider || market?.bookmaker || {};
    const explicitLive = market?.isLive ?? market?.live ?? market?.inPlay;
    return {
      marketId: market?.marketId ?? market?.id ?? null,
      marketInstanceId: market?.id ?? market?.marketId ?? null,
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
    eventLive = false, observedAt = Date.now(), eventIdentity = null, volatile = false, event = null,
  } = {}) {
    if (!eventLive || !payload || typeof payload !== 'object') return null;
    const markets = {
      matchTotals: {}, firstHalfTotals: {}, matchBtts: null, firstHalfBtts: null,
      nextGoal: null, remainingResult: null,
    };
    const availability = {};
    const rawMarkets = allMarkets(payload);
    if (!hasMarketContainer(payload)) return null;
    const diagnostics = {
      marketsSeen: rawMarkets.length, supportedMarkets: 0, notLiveMarkets: 0,
      eventMismatches: 0, suspendedMarkets: 0, pricedChoices: 0,
      completeOutcomePairs: 0, incompleteOutcomePairs: 0,
      recognizedKinds: { totalGoals: 0, btts: 0, nextGoal: 0, remainingResult: 0 },
    };
    const homeAliases = teamAliases(event?.homeTeam);
    const awayAliases = teamAliases(event?.awayTeam);

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
      const isTotal = /\b(over under|total goals|total goal|match goals?|goals over|goal line)\b/.test(normalizedTitle)
        || /\bo\/u\b/.test(normalizedTitle);
      const period = isNextGoal ? 'next' : isRemaining ? 'remaining'
        : half ? 'first-half' : secondHalf ? 'second-half' : 'match';
      if (!isBtts && !isNextGoal && !isRemaining && !isTotal) continue;
      diagnostics.supportedMarkets++;
      if (isTotal) diagnostics.recognizedKinds.totalGoals++;
      if (isBtts) diagnostics.recognizedKinds.btts++;
      if (isNextGoal) diagnostics.recognizedKinds.nextGoal++;
      if (isRemaining) diagnostics.recognizedKinds.remainingResult++;
      if (metadata.liveFlag === false) {
        diagnostics.notLiveMarkets++;
        const line = isTotal ? canonicalLine(numberFromText(title)) || '' : '';
        const kind = isBtts ? 'btts' : isNextGoal ? 'next-goal'
          : isRemaining ? 'remaining-result' : 'total-goals';
        availability[[kind, period, line].join('|')] = 'not-live';
        continue;
      }

      const expectedRawEventId = providerEventId(eventIdentity);
      if (metadata.sourceEventId != null && expectedRawEventId != null
        && String(metadata.sourceEventId) !== expectedRawEventId) {
        diagnostics.eventMismatches++;
        const line = numberFromText(title);
        const kind = isBtts ? 'btts' : isNextGoal ? 'next-goal'
          : isRemaining ? 'remaining-result' : isTotal ? 'total-goals' : null;
        if (kind) availability[[kind, period, kind === 'total-goals' ? canonicalLine(line) || '' : ''].join('|')] = 'event-mismatch';
        continue;
      }
      const validChoices = choices.filter((choice) => !suspended(choice) && priceOf(choice) != null);
      const closed = suspended(market);
      diagnostics.pricedChoices += validChoices.length;
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
      if (closed) {
        diagnostics.suspendedMarkets++;
        continue;
      }

      if (isBtts || isNextGoal || isRemaining) {
        if (validChoices.length < 2) continue;
        const prices = {};
        const selectionIds = {};
        let duplicateSide = false;
        for (const choice of validChoices) {
          const label = choice.name ?? choice.label ?? choice.selectionName;
          const side = isBtts ? yesNoSide(label)
            : isNextGoal ? nextGoalSide(label, homeAliases, awayAliases) : resultSide(label);
          if (side) {
            if (Object.hasOwn(prices, side)) {
              duplicateSide = true;
              break;
            }
            prices[side] = priceOf(choice);
            selectionIds[side] = choice?.choiceId ?? choice?.selectionId ?? choice?.sourceId ?? choice?.id ?? null;
          }
        }
        const kind = isBtts ? 'btts' : isNextGoal ? 'next-goal' : 'remaining-result';
        if (duplicateSide || !requiredSelections(kind, prices)) {
          diagnostics.incompleteOutcomePairs++;
          availability[[kind, period, ''].join('|')] = 'partial';
          continue;
        }
        const identity = {
          market: kind, period, line: null, ...metadata,
        };
        const parsed = quote(prices, updatedAt.value, updatedAt.status, observedAt, identity, eventIdentity, selectionIds);
        if (parsed) {
          diagnostics.completeOutcomePairs++;
          if (isBtts) {
            const field = half ? 'firstHalfBtts' : 'matchBtts';
            markets[field] = mergePair(markets[field], parsed, observedAt, volatile);
          } else if (isNextGoal) markets.nextGoal = mergePair(markets.nextGoal, parsed, observedAt, volatile);
          else markets.remainingResult = mergePair(markets.remainingResult, parsed, observedAt, volatile);
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
        const lineNumber = numberFromText(choiceName)
          ?? numberFromText(market?.choiceGroup)
          ?? numberFromText(market?.line)
          ?? numberFromText(market?.handicap)
          ?? numberFromText(title);
        if (lineNumber == null || !Number.isFinite(lineNumber)) continue;
        const line = canonicalLine(lineNumber);
        if (!lines.has(line)) lines.set(line, { prices: {}, selectionIds: {}, duplicateSide: false });
        const entry = lines.get(line);
        if (Object.hasOwn(entry.prices, side)) {
          entry.duplicateSide = true;
          continue;
        }
        entry.prices[side] = priceOf(choice);
        entry.selectionIds[side] = choice?.choiceId ?? choice?.selectionId ?? choice?.sourceId ?? choice?.id ?? null;
      }
      const destination = half ? markets.firstHalfTotals : markets.matchTotals;
      for (const [line, entry] of lines) {
        const kind = 'total-goals';
        availability[[kind, period, line].join('|')] = 'partial';
        if (entry.duplicateSide || !requiredSelections(kind, entry.prices)) {
          diagnostics.incompleteOutcomePairs++;
          continue;
        }
        addPair(destination, line, entry.prices, updatedAt, observedAt, {
          market: kind, period, line, ...metadata,
        }, eventIdentity, entry.selectionIds, volatile);
        if (destination[line]) availability[[kind, period, line].join('|')] = 'open';
        if (destination[line]) diagnostics.completeOutcomePairs++;
      }
    }

    const hasParsedQuotes = Object.keys(markets.matchTotals).length + Object.keys(markets.firstHalfTotals).length
      + Number(!!markets.matchBtts) + Number(!!markets.firstHalfBtts)
      + Number(!!markets.nextGoal) + Number(!!markets.remainingResult) > 0;
    for (const line of Object.keys(markets.matchTotals)) availability[['total-goals', 'match', line].join('|')] = 'open';
    for (const line of Object.keys(markets.firstHalfTotals)) availability[['total-goals', 'first-half', line].join('|')] = 'open';
    if (markets.matchBtts) availability['btts|match|'] = 'open';
    if (markets.firstHalfBtts) availability['btts|first-half|'] = 'open';
    if (markets.nextGoal) availability['next-goal|next|'] = 'open';
    if (markets.remainingResult) availability['remaining-result|remaining|'] = 'open';
    if (!hasParsedQuotes && eventIdentity == null) return null;
    return {
      observedAt, liveEvent: true, eventIdentity, markets, availability,
      feedStatus: 'complete', volatile, rawMarketCount: rawMarkets.length, diagnostics,
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
      const oldBySource = new Map(oldBooks.filter((item) => item.sourceKey != null).map((item) => [item.sourceKey, item]));
      const deltaBySide = {};
      const priceDeltaBySide = {};
      for (const currentBook of quoteValue.bookQuotes || [quoteValue]) {
        if (currentBook.sourceKey == null) continue;
        const oldBook = oldBySource.get(currentBook.sourceKey);
        if (!oldBook || !sameMarketIdentity(currentBook, oldBook)
          || !currentBook.sourceTimestampKnown || !oldBook.sourceTimestampKnown
          || currentBook.updatedAt <= oldBook.updatedAt
          || currentBook.updatedAt - oldBook.updatedAt > MOVEMENT_MAX_GAP_MS
          || !quoteFresh(currentBook, now, !!current.volatile)
          || !quoteFresh(oldBook, oldBook.observedAt, !!previous?.volatile)) continue;
        for (const [side, probability] of Object.entries(currentBook.fair || {})) {
          if (!Number.isFinite(oldBook.fair?.[side])) continue;
          (deltaBySide[side] ||= []).push(probability - oldBook.fair[side]);
          if (Number.isFinite(currentBook.prices?.[side]) && Number.isFinite(oldBook.prices?.[side]))
            (priceDeltaBySide[side] ||= []).push(currentBook.prices[side] - oldBook.prices[side]);
        }
      }
      const movement = Object.fromEntries(Object.entries(deltaBySide).map(([side, values]) => [side, median(values)]));
      quoteValue.movement = Object.keys(movement).length ? movement : null;
      const priceMovement = Object.fromEntries(Object.entries(priceDeltaBySide).map(([side, values]) => [side, median(values)]));
      quoteValue.priceMovement = Object.keys(priceMovement).length ? priceMovement : null;
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
    return robustFairConsensus(books);
  }

  function expectedIdentityMatches(identity, expected = {}) {
    const fields = [
      ['marketId', 'marketId'], ['bookmakerId', 'bookmakerId'], ['bookmakerName', 'bookmakerName'],
      ['period', 'period'], ['line', 'line'], ['market', 'market'],
      ['eventId', 'sourceEventId'], ['liveFlag', 'liveFlag'],
    ];
    return fields.every(([expectedKey, actualKey]) => expected[expectedKey] == null
      || String(expected[expectedKey]) === String(identity?.[actualKey]));
  }

  function sameMarketIdentity(left, right) {
    const a = left?.identity || {};
    const b = right?.identity || {};
    const fields = ['marketId', 'bookmakerId', 'bookmakerName', 'sourceEventId', 'liveFlag', 'market', 'period', 'line'];
    if (!fields.every((field) => String(a[field] ?? '') === String(b[field] ?? ''))) return false;
    if (left.eventIdentity !== right.eventIdentity) return false;
    const leftSides = left.outcomeSet || Object.keys(left.prices || {}).sort();
    const rightSides = right.outcomeSet || Object.keys(right.prices || {}).sort();
    if (leftSides.length !== rightSides.length || !leftSides.every((side, index) => side === rightSides[index])) return false;
    return leftSides.every((side) => String(left.selectionIds?.[side] ?? '') === String(right.selectionIds?.[side] ?? ''));
  }

  function expectedBaseModelId(market) {
    return ({
      'next-goal': 'live-xg-hazard-v1',
      'total-goals': 'live-xg-poisson-total-v1',
      btts: 'live-xg-poisson-btts-v1',
      'remaining-result': 'live-xg-state-result-v1',
    })[market] || null;
  }

  function validatedCalibration(calibration, selectedIdentity, rawProbability, now, requestedBaseModelId) {
    const requiredBaseModelId = expectedBaseModelId(selectedIdentity.market);
    if (!calibration || calibration.status !== 'validated' || calibration.method !== 'platt'
      || !calibration.modelId || !calibration.version
      || !requiredBaseModelId || calibration.baseModelId !== requiredBaseModelId
      || (requestedBaseModelId != null && requestedBaseModelId !== requiredBaseModelId)
      || !Number.isFinite(calibration.slope) || calibration.slope <= 0
      || !Number.isFinite(calibration.intercept)
      || calibration.market !== selectedIdentity.market
      || calibration.period !== selectedIdentity.period
      || String(calibration.line ?? '') !== String(selectedIdentity.line ?? '')
      || !Number.isInteger(calibration.outcomeCount) || calibration.outcomeCount < 1_000
      || !Number.isFinite(calibration.brierScore) || calibration.brierScore < 0 || calibration.brierScore > 0.30) return null;
    const validatedAt = calibration.validatedAt;
    const expiresAt = calibration.expiresAt;
    const suppliedProbability = Number(calibration.probability);
    if (!Number.isFinite(validatedAt) || validatedAt > now || !Number.isFinite(expiresAt)
      || expiresAt <= now || expiresAt <= validatedAt || !Number.isFinite(suppliedProbability)
      || suppliedProbability <= 0 || suppliedProbability >= 1) return null;
    if (!Number.isFinite(rawProbability) || rawProbability <= 0 || rawProbability >= 1) return null;
    const logit = Math.log(rawProbability / (1 - rawProbability));
    const calibratedProbability = 1 / (1 + Math.exp(-(calibration.slope * logit + calibration.intercept)));
    if (!Number.isFinite(calibratedProbability) || calibratedProbability <= 0 || calibratedProbability >= 1
      || Math.abs(suppliedProbability - calibratedProbability) > 1e-9) return null;
    return { ...calibration, validatedAt, expiresAt, probability: calibratedProbability };
  }

  function settlementModelSupported(identity) {
    if (identity?.market !== 'total-goals') return true;
    const line = Number(identity.line);
    if (!Number.isFinite(line)) return false;
    // The goal model supplies event probabilities, not push/half-win settlement
    // probabilities. Whole and quarter Asian lines need a score-distribution
    // settlement layer before their EV can be interpreted.
    return Math.abs((line - Math.floor(line)) - 0.5) < 1e-9;
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
      quoteEligible: false, theoreticalValueCandidate: false, calibrated: false,
      analysisDirectionEvidence: { available: false, supported: false, probability: null },
      bookmakerValueEvidence: { status: 'unavailable', quoteEligible: false, valueEligible: false },
    });
    if (!quoteValue) {
      const availability = snapshot?.availability?.[selected.availabilityKey];
      if (availability == null) return null;
      const reason = availability === 'closed' ? 'market-closed'
        : availability === 'disappeared' ? 'market-disappeared'
          : availability === 'event-mismatch' ? 'event-mismatch'
            : availability === 'partial' ? 'market-incomplete'
              : availability === 'not-live' ? 'not-live-market' : 'market-unavailable';
      return failure(reason, availability === 'closed' ? 'CLOSED' : null, null);
    }
    const allBooks = quoteValue.bookQuotes || [quoteValue];
    const freshBooks = allBooks.filter((book) => quoteFresh(book, now, volatile));
    const eventContextIdentity = expectedEventIdentity ?? snapshot?.eventIdentity;
    const expectedRawEventId = providerEventId(eventContextIdentity);
    const eventMatches = expectedEventIdentity == null || snapshot.eventIdentity === expectedEventIdentity;
    const eventBooks = freshBooks.filter((book) => book.identity?.sourceEventId == null
      || expectedRawEventId == null || String(book.identity.sourceEventId) === expectedRawEventId);
    const semanticBooks = eventBooks.filter((book) => ['market', 'period', 'line'].every((field) =>
      String(book.identity?.[field] ?? '') === String(selected.identity[field] ?? '')));
    const identityBooks = semanticBooks.filter((book) =>
      expectedIdentityMatches(book.identity, options.expectedIdentity || {})
      && (options.expectedIdentity?.selection == null || options.expectedIdentity.selection === selected.side)
      && (options.expectedIdentity?.selectionId == null
        || String(options.expectedIdentity.selectionId) === String(book.selectionIds?.[selected.side] ?? '')));
    const identifiedBooks = identityBooks.filter((book) => {
      const missing = missingIdentityFields(book.identity, book.selectionIds);
      return missing.length === 0 && book.identity?.liveFlag === true
        && book.identity?.sourceEventId != null
        && book.selectionIds?.[selected.side] != null
        && expectedRawEventId != null
        && String(book.identity.sourceEventId) === expectedRawEventId;
    });
    const directionBooks = identityBooks.filter((book) => Number.isFinite(book.prices?.[selected.side]));
    const quoteBooks = distinctBookmakers(consensusGroup(identifiedBooks));
    const usableDirectionBooks = distinctBookmakers(consensusGroup(directionBooks));
    const bestFrom = (books) => books.reduce((best, book) => {
      const price = book.prices?.[selected.side];
      return Number.isFinite(price) && (!best || price > best.prices[selected.side]
        || (price === best.prices[selected.side] && book.updatedAt > best.updatedAt)) ? book : best;
    }, null);
    const bestBook = bestFrom(quoteBooks) || bestFrom(usableDirectionBooks);
    const consensusBooks = quoteBooks.length ? quoteBooks : usableDirectionBooks;
    const fairProbability = consensusForBooks(consensusBooks)[selected.side];
    const price = bestBook?.prices?.[selected.side];
    const rawProbability = Number.isFinite(price) ? 1 / price : null;
    const bands = allBooks.map((book) => freshnessBand(book, now, volatile));
    const band = bestBook ? freshnessBand(bestBook, now, volatile)
      : bands.includes('FUTURE') ? 'FUTURE'
        : bands.includes('UNKNOWN') ? 'UNKNOWN'
          : volatile ? 'VOLATILE_STALE' : 'STALE';
    if (!eventMatches || (!eventBooks.length && freshBooks.length)) return failure('event-mismatch', band, bestBook?.identity || null);
    if (freshBooks.length && !identityBooks.length) return failure('market-identity-mismatch', band, quoteValue.identity);
    if (!bestBook) {
      const reason = band === 'FUTURE' ? 'future-timestamp'
        : band === 'UNKNOWN' ? 'source-timestamp-missing' : 'stale-price';
      return failure(reason, band, quoteValue.identity);
    }
    if (!Number.isFinite(fairProbability) || !Number.isFinite(rawProbability))
      return failure('market-incomplete', band, bestBook.identity);

    const identityMissing = missingIdentityFields(bestBook.identity, bestBook.selectionIds);
    const quoteEligible = quoteBooks.length > 0 && identityMissing.length === 0
      && expectedEventIdentity != null && eventMatches;
    const calibration = validatedCalibration(
      options.modelCalibration, selected.identity, modelProbability, now, options.baseModelId,
    );
    const effectiveProbability = calibration?.probability ?? modelProbability;
    const settlementSupported = settlementModelSupported(selected.identity);
    const edge = effectiveProbability - fairProbability;
    const expectedValue = effectiveProbability * price - 1;
    const theoreticalEdge = modelProbability - fairProbability;
    const theoreticalExpectedValue = modelProbability * price - 1;
    const theoreticalValueCandidate = settlementSupported && theoreticalEdge >= 0.03 && theoreticalExpectedValue >= 0.02;
    const valueEligible = quoteEligible && settlementSupported && !!calibration && edge >= 0.03 && expectedValue >= 0.02;
    const directionTopProbability = Math.max(...Object.values(consensusBooks.length ? consensusForBooks(consensusBooks) : {}));
    const directionIsFavorite = fairProbability >= directionTopProbability - 1e-12;
    const analysisDirectionEvidence = {
      available: true, probability: fairProbability,
      topProbability: Number.isFinite(directionTopProbability) ? directionTopProbability : null,
      isMarketFavorite: directionIsFavorite,
      supported: directionIsFavorite && fairProbability >= MARKET_DIRECTION_FLOOR,
      source: 'fresh-market-consensus',
    };
    const missing = identityMissing;
    return {
      verified: true, quoteEligible, identityVerified: quoteEligible,
      provider: bestBook.identity.bookmakerName || null,
      bookmakerId: bestBook.identity.bookmakerId ?? null,
      marketId: bestBook.identity.marketId ?? null,
      identity: {
        ...bestBook.identity, selection: selected.side,
        selectionId: bestBook.selectionIds?.[selected.side] ?? null,
      },
      identityCompleteness: missing.length ? 'partial' : 'complete',
      missingIdentityFields: missing,
      eventIdentityVerified: expectedEventIdentity != null && eventMatches && eventBooks.length > 0
        && String(bestBook.identity?.sourceEventId ?? '') === expectedRawEventId,
      liveFlagVerified: bestBook.identity.liveFlag === true,
      liveFlagSource: bestBook.identity.liveFlag == null ? 'parent-event-context' : 'scraper',
      price, bestAvailablePrice: price, bestAvailableBookmaker: bestBook.identity.bookmakerName || null,
      impliedProbability: rawProbability, marketImpliedProbability: rawProbability,
      fairMarketProbability: fairProbability, marketFairOdds: 1 / fairProbability,
      consensusBookCount: new Set(consensusBooks.map((book) => book.identity?.bookmakerId
        ?? book.identity?.bookmakerName).filter((value) => value != null)).size,
      rawModelProbability: modelProbability,
      modelProbability: effectiveProbability, modelFairOdds: 1 / effectiveProbability,
      calibratedModelProbability: calibration?.probability ?? null,
      calibrated: !!calibration,
      settlementModelSupported: settlementSupported,
      probabilityInterpretation: settlementSupported ? 'market-outcome-probability' : 'price-share-only-settlement-unsupported',
      probabilitySource: calibration ? 'validated-platt-calibration' : 'uncalibrated-heuristic',
      calibrationModelId: calibration?.modelId ?? null,
      calibrationVersion: calibration?.version ?? null,
      edge, expectedValue,
      theoreticalEdge, theoreticalExpectedValue,
      theoreticalValueCandidate,
      valueEligible,
      theoreticalValue: true,
      analysisDirectionEvidence,
      bookmakerValueEvidence: {
        status: !quoteEligible ? 'quote-unverified'
          : !settlementSupported ? 'unsupported-settlement-model'
          : !calibration ? 'uncalibrated-theoretical-only'
            : valueEligible ? 'calibrated-candidate' : 'calibrated-no-edge',
        quoteEligible, valueEligible, calibrated: !!calibration,
      },
      updatedAt: bestBook.updatedAt, observedAt: bestBook.observedAt,
      oddsAgeMs: now - bestBook.updatedAt, freshnessBand: band,
      movement: quoteValue.movement?.[selected.side] ?? null,
      priceMovement: quoteValue.priceMovement?.[selected.side] ?? null,
    };
  }

  function confirmation(snapshot, key, now = Date.now(), options = {}) {
    const selected = marketForSignal(snapshot, key);
    if (!selected?.quote) return null;
    const volatile = !!(options.volatile ?? snapshot?.volatile);
    const allFreshBooks = (selected.quote.bookQuotes || [selected.quote])
      .filter((book) => quoteFresh(book, now, volatile));
    const books = distinctBookmakers(consensusGroup(allFreshBooks));
    const fair = consensusForBooks(books);
    const fairProbability = fair[selected.side];
    const prices = books.map((book) => book.prices?.[selected.side]).filter(Number.isFinite);
    const timestamps = books.map((book) => book.updatedAt).filter(Number.isFinite);
    const verified = books.length > 0 && Number.isFinite(fairProbability);
    const topProbability = verified ? Math.max(...Object.values(fair)) : null;
    const directionSupported = verified && fairProbability >= topProbability - 1e-12
      && fairProbability >= MARKET_DIRECTION_FLOOR;
    return {
      verified, supported: directionSupported,
      quoteEligible: false,
      analysisDirectionEvidence: {
        available: verified, probability: Number.isFinite(fairProbability) ? fairProbability : null,
        topProbability, isMarketFavorite: directionSupported, supported: directionSupported,
        source: 'fresh-market-consensus',
      },
      bookmakerValueEvidence: { status: 'not-evaluated-no-model-probability', quoteEligible: false, valueEligible: false },
      price: prices.length ? Math.max(...prices) : null,
      fairProbability: Number.isFinite(fairProbability) ? fairProbability : null,
      consensusBookCount: new Set(books.map((book) => book.identity?.bookmakerId
        ?? book.identity?.bookmakerName).filter((value) => value != null)).size,
      quoteCount: allFreshBooks.length,
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
