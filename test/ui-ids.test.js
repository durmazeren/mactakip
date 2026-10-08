'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');

function idCounts(source) {
  const counts = new Map();
  for (const match of source.matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)) {
    counts.set(match[2], (counts.get(match[2]) || 0) + 1);
  }
  return counts;
}

test('renderer has no duplicate static IDs and every DOM ID selector resolves once', () => {
  const counts = idCounts(html);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  assert.deepEqual(duplicates, [], `duplicate HTML IDs: ${duplicates.join(', ')}`);

  const rendererFiles = ['src/app.js', 'src/js/analysis.js', 'src/js/coupon.js', 'src/js/picker.js', 'src/js/shots.js'];
  const dynamicIdSelectors = new Set(['playerTargets']);
  for (const file of rendererFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/\$\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g)) {
      const id = match[1];
      if (dynamicIdSelectors.has(id)) {
        assert.match(source, new RegExp(`\\.id\\s*=\\s*['"]${id}['"]`), `${file} must create #${id} explicitly`);
      } else {
        assert.equal(counts.get(id), 1, `${file} selector #${id} must resolve to exactly one static element`);
      }
    }
  }
});

test('shots and analysis have one dedicated view and feed telemetry panel', () => {
  const counts = idCounts(html);
  for (const id of ['toggleSide', 'addShot', 'periodSeg', 'couponBar', 'shotList', 'shotsView', 'analysisView', 'feedHealth']) {
    assert.equal(counts.get(id), 1, `expected one #${id}`);
  }
  assert.match(html, /<div id="feedHealth" class="feed-health"/);
  assert.match(html, /<div id="shotsView" class="side-view"[\s\S]*?<div id="shotList"/);
  assert.match(html, /<div id="analysisView" class="side-view"[\s\S]*?<div id="analysisList"/);
});
