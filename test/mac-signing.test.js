const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const mac = pkg.build.mac;

test('Mac derlemesi hardened runtime ve Electron entitlements ile imzalanmaya hazır', () => {
  assert.equal(mac.hardenedRuntime, true);
  assert.notEqual(mac.notarize, false);
  for (const file of [mac.entitlements, mac.entitlementsInherit]) {
    const plist = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(plist, /com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  }
});

test('Mac güncellemesi için iki mimaride zip üretilir ve dosya adı mimariyi içerir', () => {
  const zip = mac.target.find((t) => t.target === 'zip');
  assert.deepEqual(zip?.arch, ['arm64', 'x64']);
  assert.match(mac.artifactName, /\$\{arch\}/); // electron-updater arm64/x64 dosyasını addan seçer
});

test('Mac otomatik güncelleme bayrağı depoda kapalı, yalnız imzalı CI derlemesi açar', () => {
  assert.equal(pkg.macAutoUpdate, undefined);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /-c\.extraMetadata\.macAutoUpdate=true/);
});
