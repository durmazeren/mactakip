# Live analysis backtest dataset

The evaluator is an offline scoring and calibration utility. It does not fetch historical fixtures or invent labels. Supply provider snapshots converted into resolved per-market observations, then run:

```sh
npm run backtest:analysis -- ./path/to/dataset.json
```

The JSON input uses schema version 1:

```json
{
  "schemaVersion": 1,
  "calibrationTraining": [
    {
      "matchId": "historical-match-001",
      "timestamp": 1780000000000,
      "resolvedAt": 1780005400000,
      "marketKey": "total-goals/match/over/2.5",
      "probability": 0.61,
      "outcome": true
    }
  ],
  "evaluation": [
    {
      "matchId": "held-out-match-001",
      "timestamp": 1781000000000,
      "marketKey": "total-goals/match/over/2.5",
      "probability": 0.58,
      "outcome": false,
      "selected": true,
      "price": 1.92,
      "dataAgeMs": 1400,
      "oddsAgeMs": 2400,
      "signalLatencyMs": 1650
    }
  ]
}
```

Timestamps are Unix milliseconds. Each opportunity is uniquely identified by match, timestamp, and market key; duplicates are rejected. `outcome` is the settled binary result for the exact selection represented by `marketKey`. `selected` records whether the engine emitted a signal for that opportunity. Include both selected and unselected eligible opportunities if recall, false-negative, and confusion-matrix metrics are required. Do not repeat every unchanged poll as a separate opportunity; choose a documented market horizon and one consistent sampling rule to avoid overweighting long matches.

Calibration uses per-market isotonic regression (PAVA) and requires at least 50 training observations from at least 30 distinct matches per market by default. Calibration outcomes must resolve before the evaluation period starts, and a match cannot appear in both splits. Calibrated metrics are reported only for held-out markets with a fitted calibrator. The evaluator reports Brier score/skill, log loss, ROC AUC, average precision, reliability bins, confusion metrics, a Wilson interval for selected-signal hit rate, feed/odds age, latency percentiles, odds coverage, theoretical mean EV, and flat one-unit realized yield when a price is available.

These statistics are meaningful only when the input labels, candidate universe, sampling horizon, price timing, and chronological split are correct. The repository does not include a historical snapshot archive, settlement labels, or a fitted model; no empirical success rate or ROI is claimed. Use a later, match-disjoint evaluation window and retain dataset/model versions when comparing engine changes.
