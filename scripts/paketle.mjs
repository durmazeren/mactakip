// Maç Takip paketleme: kaynak dosyaları okunmaz hâle getirip (obfuscation) paketi öyle derler.
// Kaynak kod (src/) olduğu gibi kalır; yalnız `.paket/src` içindeki kopya karıştırılır ve paket ondan derlenir.
// Kullanım: node scripts/paketle.mjs <electron-builder argümanları>   (örn. --mac --win --publish never)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paket = path.join(kok, '.paket');
const builderArgs = process.argv.slice(2);

// Renderer kodu Chromium içinde çalışır; ağır ayarlar (self-defending, control-flow) orada sorun çıkarabilir.
// main süreci (Node) daha sıkı karıştırılır. Her ikisinde de yorumlar ve okunur adlar kaybolur.
const MAIN = new Set(['main.js', 'preload.js', 'app-gate.js', 'box-sources.js', 'sofa-client.js',
  'sofa-diagnostics.js', 'sofa-page-readiness.js', 'sofa-recovery.js', 'sofa-site-visit.js']);

function ayar(main) {
  return {
    compact: true, controlFlowFlattening: main, controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: false, selfDefending: main, simplify: true,
    stringArray: true, stringArrayThreshold: 0.75, stringArrayEncoding: main ? ['base64'] : [],
    identifierNamesGenerator: 'mangled', numbersToExpressions: false,
    renameGlobals: false, transformObjectKeys: false, unicodeEscapeSequence: false,
  };
}

function temizle(d) { fs.rmSync(d, { recursive: true, force: true }); }

function kopyala(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ad of fs.readdirSync(src)) {
    const s = path.join(src, ad), d = path.join(dst, ad);
    const st = fs.statSync(s);
    if (st.isDirectory()) kopyala(s, d);
    else if (ad.endsWith('.js')) {
      const kod = fs.readFileSync(s, 'utf8');
      const sonuc = JavaScriptObfuscator.obfuscate(kod, ayar(MAIN.has(ad))).getObfuscatedCode();
      fs.writeFileSync(d, sonuc);
    } else fs.copyFileSync(s, d);
  }
}

console.log('[paketle] kaynak karıştırılıyor…');
temizle(paket);
fs.mkdirSync(paket);
// Paket kök dosyaları
for (const ad of ['package.json', 'LICENSE', 'README.md']) {
  if (fs.existsSync(path.join(kok, ad))) fs.copyFileSync(path.join(kok, ad), path.join(paket, ad));
}
if (fs.existsSync(path.join(kok, 'build'))) kopyalaDuz(path.join(kok, 'build'), path.join(paket, 'build'));
fs.symlinkSync(path.join(kok, 'node_modules'), path.join(paket, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
kopyala(path.join(kok, 'src'), path.join(paket, 'src'));

function kopyalaDuz(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ad of fs.readdirSync(src)) {
    const s = path.join(src, ad), d = path.join(dst, ad);
    fs.statSync(s).isDirectory() ? kopyalaDuz(s, d) : fs.copyFileSync(s, d);
  }
}

console.log('[paketle] electron-builder çalışıyor…', builderArgs.join(' '));
// npx yerine electron-builder'ın kendi CLI dosyası node ile çalıştırılır: Windows'ta kabuksuz `npx` bulunamıyordu.
execFileSync(process.execPath, [path.join(kok, 'node_modules', 'electron-builder', 'cli.js'), ...builderArgs,
  '-c.directories.output', path.join(kok, 'dist')], { cwd: paket, stdio: 'inherit', env: process.env });
console.log('[paketle] bitti.');
