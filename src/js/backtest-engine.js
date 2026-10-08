'use strict';

/* Offline scoring for chronologically separated, labeled model observations. */
(function attachBacktestEngine(root, factory) {
  const engine = factory();
  root.LiveAnalysisBacktest = engine;
  if (typeof module === 'object' && module.exports) module.exports = engine;
}(globalThis, () => {
  const EPSILON = 1e-15;

  function validateRecords(records, { selected = false, resolvedAt = false } = {}) {
    if (!Array.isArray(records)) throw new TypeError('Observations must be an array.');
    const unique = new Set();
    records.forEach((row, index) => {
      if (!row || typeof row !== 'object' || typeof row.marketKey !== 'string' || !row.marketKey.trim()) {
        throw new TypeError(`Observation ${index} needs a marketKey.`);
      }
      if (!(typeof row.matchId === 'string' && row.matchId.trim())
        && !(typeof row.eventId === 'string' && row.eventId.trim())) {
        throw new TypeError(`Observation ${index} needs a stable matchId or eventId.`);
      }
      if (!Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) {
        throw new TypeError(`Observation ${index} probability must be between 0 and 1.`);
      }
      if (typeof row.outcome !== 'boolean') throw new TypeError(`Observation ${index} outcome must be boolean.`);
      if (!Number.isFinite(row.timestamp)) throw new TypeError(`Observation ${index} needs a numeric prediction timestamp.`);
      if (selected && typeof row.selected !== 'boolean') throw new TypeError(`Observation ${index} needs a boolean selected flag.`);
      if (resolvedAt && (!Number.isFinite(row.resolvedAt) || row.resolvedAt < row.timestamp)) {
        throw new TypeError(`Training observation ${index} needs a resolvedAt timestamp after its prediction.`);
      }
      if (row.price != null && (!Number.isFinite(row.price) || row.price <= 1 || row.price > 1000)) {
        throw new TypeError(`Observation ${index} has an invalid decimal price.`);
      }
      for (const ageKey of ['dataAgeMs', 'oddsAgeMs', 'signalLatencyMs']) {
        if (row[ageKey] != null && (!Number.isFinite(row[ageKey]) || row[ageKey] < 0)) {
          throw new TypeError(`Observation ${index} has an invalid ${ageKey}.`);
        }
      }
      const matchId = row.matchId ?? row.eventId;
      const key = `${matchId}\u0000${row.timestamp}\u0000${row.marketKey}`;
      if (unique.has(key)) throw new TypeError(`Duplicate match/market/timestamp observation at index ${index}.`);
      unique.add(key);
    });
    return records;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  }

  function wilson(successes, total, z = 1.959963984540054) {
    if (!total) return null;
    const p = successes / total;
    const z2 = z * z;
    const denominator = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / denominator;
    const radius = z * Math.sqrt((p * (1 - p) / total) + z2 / (4 * total * total)) / denominator;
    return [Math.max(0, center - radius), Math.min(1, center + radius)];
  }

  function aucRoc(rows) {
    const positives = rows.filter((row) => row.outcome).length;
    const negatives = rows.length - positives;
    if (!positives || !negatives) return null;
    const sorted = [...rows].sort((a, b) => a.probability - b.probability);
    let rankSum = 0;
    for (let index = 0; index < sorted.length;) {
      let end = index + 1;
      while (end < sorted.length && sorted[end].probability === sorted[index].probability) end++;
      const averageRank = ((index + 1) + end) / 2;
      for (let cursor = index; cursor < end; cursor++) if (sorted[cursor].outcome) rankSum += averageRank;
      index = end;
    }
    return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
  }

  function averagePrecision(rows) {
    const positives = rows.filter((row) => row.outcome).length;
    if (!positives) return null;
    const sorted = [...rows].sort((a, b) => b.probability - a.probability);
    let seen = 0;
    let truePositives = 0;
    let area = 0;
    for (let index = 0; index < sorted.length;) {
      let end = index + 1;
      while (end < sorted.length && sorted[end].probability === sorted[index].probability) end++;
      for (let cursor = index; cursor < end; cursor++) {
        seen++;
        if (sorted[cursor].outcome) truePositives++;
      }
      area += (truePositives / positives) * (truePositives / seen);
      index = end;
    }
    return area;
  }

  function calibration(rows, requestedBins = 10) {
    const count = Math.max(2, Math.min(20, Math.floor(requestedBins)));
    const bins = Array.from({ length: count }, (_, index) => ({
      lower: index / count, upper: (index + 1) / count, count: 0, predicted: 0, observed: 0,
    }));
    for (const row of rows) {
      const index = Math.min(count - 1, Math.floor(row.probability * count));
      bins[index].count++;
      bins[index].predicted += row.probability;
      bins[index].observed += Number(row.outcome);
    }
    const populated = bins.filter((bin) => bin.count).map((bin) => ({
      lower: bin.lower, upper: bin.upper, count: bin.count,
      meanPredicted: bin.predicted / bin.count, observedRate: bin.observed / bin.count,
    }));
    const ece = rows.length ? populated.reduce((sum, bin) =>
      sum + bin.count / rows.length * Math.abs(bin.meanPredicted - bin.observedRate), 0) : null;
    const mce = populated.length ? Math.max(...populated.map((bin) => Math.abs(bin.meanPredicted - bin.observedRate))) : null;
    return { bins: populated, expectedCalibrationError: ece, maximumCalibrationError: mce };
  }

  function metrics(records, { bins = 10 } = {}) {
    const rows = validateRecords(records, { selected: true });
    if (!rows.length) return { observations: 0 };
    const positives = rows.filter((row) => row.outcome).length;
    const negatives = rows.length - positives;
    const selected = rows.filter((row) => row.selected);
    const selectedWins = selected.filter((row) => row.outcome).length;
    const truePositives = selectedWins;
    const falsePositives = selected.length - truePositives;
    const falseNegatives = rows.filter((row) => !row.selected && row.outcome).length;
    const trueNegatives = rows.length - truePositives - falsePositives - falseNegatives;
    const brier = mean(rows.map((row) => (row.probability - Number(row.outcome)) ** 2));
    const baseRate = positives / rows.length;
    const baselineBrier = baseRate * (1 - baseRate);
    const priced = selected.filter((row) => Number.isFinite(row.price));
    const unitProfit = priced.reduce((sum, row) => sum + (row.outcome ? row.price - 1 : -1), 0);
    const latency = rows.filter((row) => Number.isFinite(row.signalLatencyMs)).map((row) => row.signalLatencyMs);
    const dataAge = rows.filter((row) => Number.isFinite(row.dataAgeMs)).map((row) => row.dataAgeMs);
    const oddsAge = rows.filter((row) => Number.isFinite(row.oddsAgeMs)).map((row) => row.oddsAgeMs);
    const theoreticalEv = priced.map((row) => row.probability * row.price - 1);
    const freshOdds = selected.filter((row) => Number.isFinite(row.price)
      && Number.isFinite(row.oddsAgeMs) && row.oddsAgeMs >= 0 && row.oddsAgeMs <= 10_000).length;
    const selectedCount = selected.length;
    return {
      observations: rows.length,
      prevalence: baseRate,
      confusion: { truePositive: truePositives, falsePositive: falsePositives, falseNegative: falseNegatives, trueNegative: trueNegatives },
      precision: selected.length ? truePositives / selected.length : null,
      hitRate: selected.length ? truePositives / selected.length : null,
      recall: positives ? truePositives / positives : null,
      specificity: negatives ? trueNegatives / negatives : null,
      accuracy: (truePositives + trueNegatives) / rows.length,
      f1: truePositives * 2 + falsePositives + falseNegatives
        ? 2 * truePositives / (2 * truePositives + falsePositives + falseNegatives) : null,
      rocAuc: aucRoc(rows),
      averagePrecision: averagePrecision(rows),
      brierScore: brier,
      brierSkillScore: baselineBrier > 0 ? 1 - brier / baselineBrier : null,
      logLoss: mean(rows.map((row) => {
        const probability = Math.max(EPSILON, Math.min(1 - EPSILON, row.probability));
        return -(row.outcome ? Math.log(probability) : Math.log(1 - probability));
      })),
      calibration: calibration(rows, bins),
      selected: selectedCount,
      odds: {
        selectedWithPrice: priced.length,
        selectedWithoutPrice: selectedCount - priced.length,
        availability: selectedCount ? priced.length / selectedCount : null,
        freshWithin10s: freshOdds,
        freshCoverage: selectedCount ? freshOdds / selectedCount : null,
        meanTheoreticalEv: mean(theoreticalEv),
        unitStakeProfit: priced.length ? unitProfit : null,
        unitStakeYield: priced.length ? unitProfit / priced.length : null,
        hitRateWithPrice: priced.length ? priced.filter((row) => row.outcome).length / priced.length : null,
      },
      latencyMs: latency.length ? { mean: mean(latency), p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), samples: latency.length } : null,
      dataAgeMs: dataAge.length ? { mean: mean(dataAge), p95: percentile(dataAge, 0.95) } : null,
      oddsAgeMs: oddsAge.length ? { mean: mean(oddsAge), p95: percentile(oddsAge, 0.95) } : null,
      selectedHitRateWilson95: wilson(truePositives, selected.length),
    };
  }

  function fitIsotonicByMarket(trainingRecords, { minimumSamples = 50, minimumMatches = 30 } = {}) {
    if (!Number.isInteger(minimumSamples) || minimumSamples < 2
      || !Number.isInteger(minimumMatches) || minimumMatches < 2) {
      throw new TypeError('minimumSamples and minimumMatches must be integers of at least 2.');
    }
    const rows = validateRecords(trainingRecords, { resolvedAt: true });
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.marketKey)) groups.set(row.marketKey, []);
      groups.get(row.marketKey).push(row);
    }
    const models = {};
    for (const [marketKey, marketRows] of groups) {
      const matchCount = new Set(marketRows.map((row) => row.matchId ?? row.eventId)).size;
      if (marketRows.length < minimumSamples || matchCount < minimumMatches) continue;
      const sorted = [...marketRows].sort((a, b) => a.probability - b.probability);
      const blocks = [];
      for (const row of sorted) {
        const last = blocks[blocks.length - 1];
        if (last && last.maxProbability === row.probability) {
          last.count++;
          last.positives += Number(row.outcome);
        } else {
          blocks.push({ maxProbability: row.probability, count: 1, positives: Number(row.outcome) });
        }
      }
      for (let index = 1; index < blocks.length;) {
        const left = blocks[index - 1];
        const right = blocks[index];
        if (left.positives / left.count <= right.positives / right.count) {
          index++;
          continue;
        }
        blocks.splice(index - 1, 2, {
          maxProbability: right.maxProbability,
          count: left.count + right.count,
          positives: left.positives + right.positives,
        });
        index = Math.max(1, index - 1);
      }
      models[marketKey] = {
        samples: marketRows.length,
        distinctMatches: matchCount,
        knots: blocks.map((block) => ({ maxProbability: block.maxProbability, probability: block.positives / block.count })),
      };
    }
    return { method: 'per-market-isotonic-pava', minimumSamples, markets: models };
  }

  function applyIsotonic(model, marketKey, probability) {
    const knots = model?.markets?.[marketKey]?.knots;
    if (!Array.isArray(knots) || !knots.length || !Number.isFinite(probability)) return null;
    const knot = knots.find((item) => probability <= item.maxProbability) || knots[knots.length - 1];
    return knot.probability;
  }

  function evaluateDataset(dataset, options = {}) {
    if (!dataset || dataset.schemaVersion !== 1) throw new TypeError('Backtest dataset must use schemaVersion 1.');
    const evaluation = validateRecords(dataset.evaluation, { selected: true });
    const training = dataset.calibrationTraining || [];
    validateRecords(training, { resolvedAt: true });
    const trainingMatches = new Set(training.map((row) => row.matchId ?? row.eventId));
    const leakedMatch = evaluation.find((row) => trainingMatches.has(row.matchId ?? row.eventId));
    if (leakedMatch) throw new TypeError(`Calibration leakage: match ${leakedMatch.matchId ?? leakedMatch.eventId} appears in both data splits.`);
    const calibrationModel = training.length ? fitIsotonicByMarket(training, options) : null;
    if (calibrationModel && evaluation.length) {
      const firstTestAt = Math.min(...evaluation.map((row) => row.timestamp));
      for (const row of training) {
        if (row.resolvedAt > firstTestAt) {
          throw new TypeError('Calibration leakage: every training outcome must be resolved before the evaluation period begins.');
        }
      }
    }
    const byMarket = {};
    const marketKeys = [...new Set(evaluation.map((row) => row.marketKey))].sort();
    for (const marketKey of marketKeys) {
      const rows = evaluation.filter((row) => row.marketKey === marketKey);
      const calibrated = calibrationModel
        ? rows.filter((row) => applyIsotonic(calibrationModel, marketKey, row.probability) != null)
          .map((row) => ({ ...row, probability: applyIsotonic(calibrationModel, marketKey, row.probability) }))
        : [];
      byMarket[marketKey] = {
        raw: metrics(rows, options),
        calibrated: calibrated.length ? metrics(calibrated, options) : null,
        calibrationSamples: calibrationModel?.markets?.[marketKey]?.samples || 0,
      };
    }
    const calibratedRows = calibrationModel ? evaluation
      .filter((row) => applyIsotonic(calibrationModel, row.marketKey, row.probability) != null)
      .map((row) => ({ ...row, probability: applyIsotonic(calibrationModel, row.marketKey, row.probability) })) : [];
    return {
      schemaVersion: 1,
      modelCalibration: calibrationModel ? {
        method: calibrationModel.method,
        minimumSamples: calibrationModel.minimumSamples,
        minimumMatches: calibrationModel.minimumMatches,
        trainedMarkets: Object.keys(calibrationModel.markets).length,
        trainingSamples: training.length,
        calibrationTrainingEnd: training.reduce((max, row) => Math.max(max, row.resolvedAt), -Infinity),
      } : { method: 'none', reason: 'No calibration training sample supplied.' },
      raw: metrics(evaluation, options),
      calibrated: calibratedRows.length ? metrics(calibratedRows, options) : null,
      calibratedCoverage: evaluation.length ? calibratedRows.length / evaluation.length : null,
      byMarket,
      caveat: 'Offline labeled-sample metrics only. Calibration is per-market isotonic PAVA and is valid only when training outcomes precede evaluation. Metrics are not a guarantee of future performance.',
    };
  }

  return { validateRecords, metrics, fitIsotonicByMarket, applyIsotonic, evaluateDataset };
}));
