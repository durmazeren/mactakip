'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Electron aynı kanala ikinci ipcMain.handle kaydında ana süreçte çöker (uygulama açılmaz)
test('ana süreçte her IPC kanalı bir kez kaydedilir', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const channels = [...source.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(channels.length > 5);
  const dup = channels.filter((c, i) => channels.indexOf(c) !== i);
  assert.deepEqual(dup, []);
});

test('preload\'un çağırdığı her kanalın ana süreçte karşılığı var', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const handled = new Set([...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]));
  for (const [, channel] of preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)) assert.ok(handled.has(channel), channel);
});
