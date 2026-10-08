'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BacktestEngine = require('../src/js/backtest-engine.js');

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write('Usage: npm run backtest:analysis -- <dataset.json>\n');
  process.exitCode = 2;
} else {
  try {
    const absolutePath = path.resolve(process.cwd(), inputPath);
    const dataset = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    const report = BacktestEngine.evaluateDataset(dataset);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Backtest failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
