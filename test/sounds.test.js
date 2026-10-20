'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function ctx(hidden) {
  const sent = [];
  const store = {};
  const context = vm.createContext({
    load: (k, d) => (k in store ? store[k] : d), save: (k, v) => { store[k] = v; },
    document: { hidden, hasFocus: () => !hidden },
    window: { appNotify: { show: async (p) => { sent.push(p); return true; } } },
    Audio: class { constructor() { this.listeners = {}; } addEventListener() {} play() { return Promise.resolve(); } },
    teamName: (t) => t?.name || '', minuteText: () => "34'",
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sounds.js'), 'utf8'), context);
  return { context, sent, store };
}

test('gol bildirimi yalnız uygulama arka plandayken gider', () => {
  const bg = ctx(true);
  vm.runInContext("alertEvent('goal', '⚽ GOL! A', 'A 1–0 B', 5)", bg.context);
  assert.equal(bg.sent.length, 1);
  assert.equal(bg.sent[0].matchId, 5);
  const fg = ctx(false);
  vm.runInContext("alertEvent('goal', '⚽ GOL! A', 'A 1–0 B', 5)", fg.context);
  assert.equal(fg.sent.length, 0);
});

test('kapalı olay ve kapalı bildirim ayarı bildirim göndermez', () => {
  const c = ctx(true);
  vm.runInContext("alertEvent('corner', 'Korner', '', 1)", c.context);  // varsayılan: korner bildirimi kapalı
  assert.equal(c.sent.length, 0);
  vm.runInContext("const s = soundSettings(); s.notify = false; saveSoundSettings(s); alertEvent('goal', 'GOL', '', 1)", c.context);
  assert.equal(c.sent.length, 0);
  vm.runInContext("const s2 = soundSettings(); s2.notify = true; s2.onlyBackground = false; saveSoundSettings(s2)", c.context);
  assert.equal(vm.runInContext('soundSettings().events.goal.notify', c.context), true, 'eski kayıtla yeni olaylar varsayılanı korur');
});

test('maç sesi: kart ayarı ana ses seviyesiyle çarpılır, sessize alınan maç ve ana kapatma sıfırlar', () => {
  const c = ctx(true);
  const vol = (id) => vm.runInContext(`effectiveVolume(soundSettings(), ${id})`, c.context);
  vm.runInContext('speakers.clear()', c.context);
  assert.equal(vol(7), 0.7);                                   // varsayılan: açık, %100 × ana %70
  vm.runInContext('setMatchVolume(7, { vol: 0.5 })', c.context);
  assert.equal(vol(7), 0.35);
  vm.runInContext('setMatchVolume(7, { muted: true })', c.context);
  assert.equal(vol(7), 0);
  assert.equal(vol(8), 0.7, 'diğer maçlar etkilenmez');
  vm.runInContext('setMatchVolume(7, { vol: 1, muted: false })', c.context);
  assert.equal(JSON.stringify(c.store.matchVolume), '{}', 'varsayılana dönen maç kaydı silinir');
  vm.runInContext('const s = soundSettings(); s.sound = false; saveSoundSettings(s)', c.context);
  assert.equal(vol(8), 0, 'üst bar 🔇 bütün sesleri kapatır');
});

test('hazır sesler: dosyalar uygulamada, gol olunca Gol sesi çalar, ad değişikliği kaydedilir', async () => {
  const c = ctx(true);
  const played = [];
  c.context.Audio = class { constructor(src) { played.push(src); } addEventListener() {} pause() {} play() { return Promise.resolve(); } };
  const list = JSON.parse(vm.runInContext('JSON.stringify(BUILTIN_SOUNDS)', c.context));
  assert.equal(list.length, 23);
  for (const b of list) assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', b.file)), b.file);
  assert.ok(!list.some((b) => /bet/i.test(b.name + b.file)), 'site adı geçmez');
  vm.runInContext("playSound('goal', 0.5)", c.context);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(played, ['assets/sounds/board/gol.mp3']);
  c.store.soundNames = { 'b-haaland': 'Erling' };
  assert.equal(vm.runInContext("builtinSound('b-haaland').name", c.context), 'Erling');
});

test('bildirim varsayılanı yalnız gol; eski kayıtlarda diğer bildirimler bir kez kapatılır', () => {
  const c = ctx(true);
  const ev = () => JSON.parse(vm.runInContext('JSON.stringify(soundSettings().events)', c.context));
  assert.deepEqual(Object.entries(ev()).filter(([, e]) => e.notify).map(([k]) => k), ['goal']);
  c.store.soundSettings = { volume: 0.4, events: { goal: { sound: true, notify: true }, red: { sound: true, notify: true } } };
  assert.equal(ev().red.notify, false);
  assert.equal(ev().red.sound, true, 'ses ayarı korunur');
  assert.equal(c.store.soundSettings.v, 2);
  vm.runInContext("const s = soundSettings(); s.events.red.notify = true; saveSoundSettings(s)", c.context);
  assert.equal(ev().red.notify, true, 'kullanıcı sonradan açarsa açık kalır');
});

test('ses panosu: kendi ses seviyesiyle çalar, çalan butona tekrar basınca durur', async () => {
  const c = ctx(true);
  const made = [];
  c.context.Audio = class {
    constructor(src) { this.src = src; this.paused = true; this.l = {}; made.push(this); }
    addEventListener(k, f) { (this.l[k] ||= []).push(f); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; (this.l.pause || []).forEach((f) => f()); }
  };
  c.store.boardVolume = 0.4;
  vm.runInContext("toggleBoardSound('b-haaland')", c.context);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(made.length, 1);
  assert.equal(made[0].volume, 0.4);
  assert.equal(vm.runInContext('boardPlayingId', c.context), 'b-haaland');
  vm.runInContext("toggleBoardSound('b-haaland')", c.context);
  assert.equal(made[0].paused, true, 'ikinci basış durdurur');
  assert.equal(made.length, 1, 'yeniden çalmaz');
  assert.equal(vm.runInContext('boardPlayingId', c.context), null);
  vm.runInContext("toggleBoardSound('b-haaland')", c.context);
  await new Promise((r) => setTimeout(r, 0));
  vm.runInContext("toggleBoardSound('b-porto')", c.context);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(made[1].paused, true, 'başka butona basınca önceki susar');
  assert.equal(vm.runInContext('boardPlayingId', c.context), 'b-porto');
});
