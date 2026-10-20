'use strict';

/* Ses efektleri ve masaüstü bildirimleri.
 * Olaylar: gol, kırmızı kart, hedef tuttu / yattı, isabetli şut, korner, basketbol çeyrek sonu.
 * Ses: assets/sounds/<olay>.mp3 varsa o çalınır; yoksa Web Audio ile üretilen kısa bir ses (yedek).
 * Bildirim: uygulama arka plandayken (ya da her zaman, ayara göre) işletim sistemi bildirimi;
 * tıklanınca uygulama öne gelir ve maç gösterilir. */

const NOTIFY_EVENTS = {
  goal: { label: 'Gol', sound: true, notify: true },
  red: { label: 'Kırmızı kart', sound: true, notify: false },
  targetWon: { label: 'Hedef tuttu', sound: true, notify: false },
  targetLost: { label: 'Hedef yattı', sound: true, notify: false },
  sot: { label: 'İsabetli şut', sound: false, notify: false },
  corner: { label: 'Korner', sound: false, notify: false },
  quarter: { label: 'Basketbol çeyrek sonu', sound: true, notify: false },
};
const SOUND_DEFAULTS = {
  sound: true, volume: 0.7, notify: true, onlyBackground: true,
  events: Object.fromEntries(Object.entries(NOTIFY_EVENTS).map(([k, v]) => [k, { sound: v.sound, notify: v.notify }])),
};

// v2: masaüstü bildirimi varsayılan olarak yalnız golde; eski kayıtlardaki diğer bildirimler bir kez kapatılır.
const SOUND_SETTINGS_VERSION = 2;

function soundSettings() {
  const saved = load('soundSettings', null) || {};
  if (saved.events && (saved.v || 1) < SOUND_SETTINGS_VERSION) {
    for (const [k, e] of Object.entries(saved.events)) if (k !== 'goal' && e) e.notify = false;
    saved.v = SOUND_SETTINGS_VERSION;
    save('soundSettings', saved);
  }
  return { ...SOUND_DEFAULTS, ...saved,
    events: Object.fromEntries(Object.keys(NOTIFY_EVENTS).map((k) => [k, { ...SOUND_DEFAULTS.events[k], ...(saved.events?.[k] || {}) }])) };
}

function saveSoundSettings(s) { save('soundSettings', { ...s, v: SOUND_SETTINGS_VERSION }); }

// ---- ses ----
// assets/sounds/ klasörüne eklenen dosyalar (olay adı). Listede olmayan olay için Web Audio yedeği çalar.
const SOUND_FILES = new Set([]);
const soundFiles = new Map(); // olay -> HTMLAudioElement | false (dosya yok)
let audioCtx = null;

function synth(kind, volume) {
  // Dosya yoksa kısa, ayırt edilebilir sesler (yer tutucu)
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  audioCtx = audioCtx || new AC();
  const notes = {
    goal: [[523, 0, .14], [659, .13, .14], [784, .26, .32]],
    red: [[196, 0, .22], [147, .2, .34]],
    targetWon: [[660, 0, .12], [990, .11, .24]],
    targetLost: [[440, 0, .14], [330, .13, .26]],
    sot: [[880, 0, .07]],
    corner: [[740, 0, .07], [740, .1, .07]],
    quarter: [[1568, 0, .18], [1568, .24, .18], [1568, .48, .4]],
  }[kind] || [[600, 0, .1]];
  const now = audioCtx.currentTime;
  for (const [freq, start, dur] of notes) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = kind === 'quarter' ? 'square' : 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.25 * volume, now + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  }
}

function playSound(kind, volume) {
  if (kind === 'goal') {
    playBoardSound(GOAL_SOUND, volume, GOAL_SOUND_MAX_MS).then((ok) => { if (!ok) playBuiltin(kind, volume); });
    return;
  }
  playBuiltin(kind, volume);
}

function playBuiltin(kind, volume) {
  let file = SOUND_FILES.has(kind) ? soundFiles.get(kind) : false;
  if (file === undefined) {
    file = new Audio(`assets/sounds/${kind}.mp3`);
    file.addEventListener('error', () => soundFiles.set(kind, false), { once: true });
    soundFiles.set(kind, file);
  }
  if (file) {
    file.volume = volume;
    file.currentTime = 0;
    file.play().catch(() => { soundFiles.set(kind, false); synth(kind, volume); });
  } else {
    synth(kind, volume);
  }
}

// ---- olay ----
function appInBackground() {
  return typeof document === 'undefined' || document.hidden || !document.hasFocus();
}

// Maç bazında ses: kartlardaki 🔊 (varsayılan açık, %100). Sessize alınan maçta ses çalmaz; bildirim ayarı ayrı.
function matchVolume(matchId) {
  const m = (load('matchVolume', {}) || {})[matchId];
  return { vol: typeof m?.vol === 'number' ? m.vol : 1, muted: !!m?.muted };
}

function setMatchVolume(matchId, change) {
  const all = load('matchVolume', {}) || {};
  const next = { ...matchVolume(matchId), ...change };
  if (next.vol === 1 && !next.muted) delete all[matchId]; else all[matchId] = next;
  save('matchVolume', all);
  refreshSpeakers(matchId);
}

function effectiveVolume(s, matchId) {
  if (!s.sound) return 0;
  if (matchId == null) return s.volume;
  const m = matchVolume(matchId);
  return m.muted ? 0 : s.volume * m.vol;
}

function alertEvent(kind, title, body, matchId) {
  const s = soundSettings();
  const e = s.events[kind];
  if (!e) return;
  const vol = effectiveVolume(s, matchId);
  if (e.sound && vol > 0) playSound(kind, vol);
  if (s.notify && e.notify && (!s.onlyBackground || appInBackground()) && window.appNotify) {
    window.appNotify.show({ title, body, matchId }).catch(() => {});
  }
}

function matchLine(ev) {
  if (!ev) return '';
  const minute = typeof minuteText === 'function' ? minuteText(ev) : '';
  return `${teamName(ev.homeTeam)} ${ev.homeScore?.current ?? 0}–${ev.awayScore?.current ?? 0} ${teamName(ev.awayTeam)}${minute ? ` · ${minute}` : ''}`;
}

// ---- ikonlar: koyu arka planda net görünen çizgi ikonlar (emoji yerine) ----
const SPEAKER = '<path d="M4 9v6h4l5 4V5L8 9H4z"/>';
const BELL = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const SOUND_ICONS = {
  on: SPEAKER + '<path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19.4 5.6a9 9 0 0 1 0 12.8"/>',
  low: SPEAKER + '<path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  off: SPEAKER + '<path d="M17 9.5l5 5"/><path d="M22 9.5l-5 5"/>',
  board: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  bell: BELL,
  bellOff: BELL + '<path d="M3 3l18 18"/>',
};

function setSoundIcon(btn, name, size = 18) {
  if (btn.dataset.icon === name) return;
  btn.dataset.icon = name;
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"`
    + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOUND_ICONS[name]}</svg>`;
}

// ---- ayar menüsü (üst bardaki 🔔) ----
function initSoundSettings() {
  const btn = document.getElementById('soundBtn');
  const pop = document.getElementById('soundPop');
  if (!btn || !pop) return;
  const render = () => {
    const s = soundSettings();
    pop.replaceChildren();
    const board = el('button', 'btn btn-sm snd-board-open', 'Ses panosunu aç');
    board.type = 'button';
    board.title = 'Ses panosu ayrı pencerede açılır, uygulamayı kapatmaz';
    board.addEventListener('click', () => { pop.hidden = true; openSoundBoard(); });
    pop.append(board);
    const row = (labelText, input) => { const l = el('label', 'snd-row'); l.append(input, el('span', null, labelText)); return l; };
    const check = (on, fn) => { const i = el('input'); i.type = 'checkbox'; i.checked = !!on; i.addEventListener('change', () => fn(i.checked)); return i; };
    const update = (fn) => { const cur = soundSettings(); fn(cur); saveSoundSettings(cur); render(); };
    pop.append(el('div', 'snd-title', 'Ses ve bildirimler'));
    pop.append(row('Ses efektleri', check(s.sound, (v) => update((c) => { c.sound = v; }))));
    const vol = el('input'); Object.assign(vol, { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) });
    vol.addEventListener('change', () => update((c) => { c.volume = Number(vol.value); }));
    const volRow = el('div', 'snd-row snd-vol'); volRow.append(el('span', null, 'Ses seviyesi'), vol);
    pop.append(volRow);
    pop.append(row('Masaüstü bildirimi', check(s.notify, (v) => update((c) => { c.notify = v; }))));
    pop.append(row('Bildirim yalnız uygulama arka plandayken', check(s.onlyBackground, (v) => update((c) => { c.onlyBackground = v; }))));
    const tryBtn = el('button', 'btn btn-sm snd-board-open', 'Masaüstü bildirimini dene (3 sn sonra)');
    tryBtn.type = 'button';
    tryBtn.title = 'Başka bir uygulamaya geç: 3 saniye sonra sağ altta örnek gol bildirimi çıkar';
    tryBtn.addEventListener('click', () => {
      pop.hidden = true;
      setTimeout(() => window.appNotify?.show({ title: 'GOL!', body: 'Örnek: Fenerbahçe 2–1 Slavia Praha · 67\'', matchId: null }), 3000);
    });
    pop.append(tryBtn);
    const table = el('div', 'snd-table');
    table.append(el('span', 'snd-h', 'Olay'), el('span', 'snd-h', 'Ses'), el('span', 'snd-h', 'Bildirim'));
    for (const [k, meta] of Object.entries(NOTIFY_EVENTS)) {
      const test = el('button', 'snd-test', '▶');
      test.type = 'button';
      test.title = 'Sesi dinle';
      test.addEventListener('click', () => playSound(k, soundSettings().volume || 0.7));
      const name = el('span', 'snd-name'); name.append(test, meta.label);
      table.append(name, check(s.events[k].sound, (v) => update((c) => { c.events[k].sound = v; })),
        check(s.events[k].notify, (v) => update((c) => { c.events[k].notify = v; })));
    }
    pop.append(table);
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) render(); });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
  // Bildirime tıklanınca maçı göster
  window.appNotify?.onClick((matchId) => {
    const card = matchId != null ? (shotCards.get(matchId)?.el || state.tiles.get(matchId)?.el) : null;
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('notify-focus');
      setTimeout(() => card.classList.remove('notify-focus'), 2500);
    }
  });
  render();
}

// ---- üst bar 🔊: bütün sesleri aç / kapat ----
function initMasterSpeaker() {
  const btn = document.getElementById('masterSoundBtn');
  if (!btn) return;
  const paint = () => {
    const on = soundSettings().sound;
    setSoundIcon(btn, on ? 'on' : 'off');
    btn.title = on ? 'Sesler açık · tıkla: hepsini kapat' : 'Sesler kapalı · tıkla: aç';
    btn.classList.toggle('off', !on);
  };
  btn.addEventListener('click', () => { const c = soundSettings(); c.sound = !c.sound; saveSoundSettings(c); paint(); refreshSpeakers(); });
  paint();
}

// ---- kartlardaki 🔊 ----
const speakers = new Map(); // maç -> Set(button)

function speakerIcon(matchId) {
  const m = matchVolume(matchId);
  return !soundSettings().sound || m.muted || m.vol === 0 ? 'off' : m.vol < 0.5 ? 'low' : 'on';
}

function speakerButton(matchId) {
  const b = el('button', 'icon-btn snd-card');
  setSoundIcon(b, speakerIcon(matchId), 15);
  b.type = 'button';
  b.title = 'Bu maçın sesi';
  b.addEventListener('click', (e) => { e.stopPropagation(); openMatchVolume(matchId, b); });
  b.addEventListener('pointerdown', (e) => e.stopPropagation()); // animasyon başlığında sürüklemeyi başlatmasın
  b.classList.toggle('off', speakerIcon(matchId) === 'off');
  if (!speakers.has(matchId)) speakers.set(matchId, new Set());
  speakers.get(matchId).add(b);
  return b;
}

function refreshSpeakers(matchId) {
  for (const [id, set] of speakers) {
    if (matchId != null && id !== matchId) continue;
    for (const b of set) {
      if (!b.isConnected) { set.delete(b); continue; }
      setSoundIcon(b, speakerIcon(id), 15);
      b.classList.toggle('off', speakerIcon(id) === 'off');
    }
  }
}

let volPop = null;
function openMatchVolume(matchId, anchor) {
  volPop?.remove();
  const m = matchVolume(matchId);
  const pop = el('div', 'snd-match-pop');
  const slider = el('input');
  Object.assign(slider, { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(m.vol * 100)) });
  const pct = el('span', 'snd-pct', `%${Math.round(m.vol * 100)}`);
  slider.addEventListener('input', () => { pct.textContent = `%${slider.value}`; setMatchVolume(matchId, { vol: Number(slider.value) / 100, muted: false }); mute.checked = false; });
  const mute = el('input'); mute.type = 'checkbox'; mute.checked = m.muted;
  mute.addEventListener('change', () => setMatchVolume(matchId, { muted: mute.checked }));
  const muteRow = el('label', 'snd-row'); muteRow.append(mute, el('span', null, 'Bu maçın sesini tamamen kapat'));
  const volRow = el('div', 'snd-row snd-vol'); volRow.append(el('span', null, '🔊'), slider, pct);
  pop.append(el('div', 'snd-title', 'Maç sesi'), volRow, muteRow);
  if (!soundSettings().sound) pop.append(el('div', 'snd-note', 'Üst bardaki 🔇 ile bütün sesler kapalı.'));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - 268, r.right - 260)))}px`;
  volPop = pop;
  const close = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); volPop = null; document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true));
}

// ---- ses panosu (🎵): uygulamayla gelen sesler + kullanıcının eklediği sesler (yalnız bu bilgisayarda, IndexedDB) ----
const GOAL_SOUND_MAX_MS = 8000; // gol sesi en fazla 8 sn çalar
const BOARD_COLORS = ['#e53935', '#43a047', '#fb8c00', '#1e88e5', '#fdd835', '#8e24aa', '#00acc1', '#6d4c41', '#d81b60', '#7cb342'];
const MAX_SOUND_BYTES = 6 * 1024 * 1024;
// Uygulamayla gelen sesler: assets/sounds/board/<dosya>.mp3. Adları kullanıcı değiştirebilir (soundNames), silinmez.
const BUILTIN_SOUNDS = [
  ['gol', 'Gol', 'gol'], ['haaland', 'Haaland', 'gol'], ['benfica', 'Benfica', 'gol'], ['euro2008', 'Euro 2008', 'gol'],
  ['manutd', 'Manchester United', 'gol'], ['porto', 'Porto', 'gol'], ['penguins', 'Penguins', 'gol'], ['gooool', 'Gooool', 'gol'],
  ['yabadabadoo', 'Yabadabadoo', 'gol'], ['ucl-intro', 'Şampiyonlar Ligi', 'gol'],
  ['ceddin-deden', 'Ceddin Deden', 'eglence'], ['hileli', 'Manifest – Hileli', 'eglence'], ['haram-ball', 'Haram Ball', 'eglence'],
  ['mbappe-aglar', 'Mbappe dokunsalar ağlıycak', 'eglence'], ['kongo', 'Demokratik Kongo', 'eglence'],
  ['ramiz-dayi', 'Ramiz Dayı: uyan yeğen', 'eglence'], ['lamine-yamal', 'Lamine Yamal', 'eglence'],
  ['banliyorum', 'Seni banlıyorum', 'eglence'], ['dictator-mbappe', 'Dictator Mbappe', 'eglence'], ['kabede-hacilar', "Kabe'de Hacılar", 'eglence'],
  ['fahhh', 'Fahhh', 'eglence'], ['minik-dualar', 'Minik Dualar: teşekkür ederim', 'eglence'], ['sergen-dingidi', 'Sergen Yalçın: dingidi', 'eglence'],
].map(([file, name, group], i) => ({ id: `b-${file}`, file: `assets/sounds/board/${file}.mp3`, name, group, color: BOARD_COLORS[i % BOARD_COLORS.length] }));
const GOAL_SOUND = 'b-gol'; // maçta gol olunca çalan ses
const BOARD_GROUPS = [['gol', '⚽ Spor'], ['eglence', '😄 Eğlence'], ['benim', '📁 Benim seslerim']];
let boardDb = null;
let boardPlaying = null;
let boardPlayingId = null;

// Ses panosunun kendi ses seviyesi (maç seslerinden ayrı)
function boardVolume() { return load('boardVolume', 0.8); }

// Çalan butonu işaretle (■ durdur)
function markBoardPlaying() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  for (const b of document.querySelectorAll('.sb-btn[data-id]')) b.classList.toggle('playing', b.dataset.id === boardPlayingId);
}

function stopBoardSound() { boardPlaying?.pause(); }

// Panodaki butona basınca: aynı ses çalıyorsa durdurur, değilse çalar
function toggleBoardSound(id) {
  if (boardPlayingId === id && boardPlaying && !boardPlaying.paused) { stopBoardSound(); return; }
  playBoardSound(id, boardVolume());
}

function builtinSound(id) {
  const b = BUILTIN_SOUNDS.find((x) => x.id === id);
  return b && { ...b, name: (load('soundNames', {}) || {})[id] || b.name };
}

function boardStore(mode) {
  const open = boardDb || new Promise((resolve, reject) => {
    const req = indexedDB.open('mactakip-sounds', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  boardDb = open;
  return open.then((db) => db.transaction('sounds', mode).objectStore('sounds'));
}
const idb = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const boardAll = () => boardStore('readonly').then((st) => idb(st.getAll())).then((list) => list.sort((a, b) => a.created - b.created));
const boardPut = (item) => boardStore('readwrite').then((st) => idb(st.put(item)));
const boardDelete = (id) => boardStore('readwrite').then((st) => idb(st.delete(id)));

async function playBoardSound(id, volume, maxMs) {
  try {
    const builtin = builtinSound(id);
    const item = builtin || await boardStore('readonly').then((st) => idb(st.get(id)));
    if (!item) return false;
    boardPlaying?.pause();
    const audio = new Audio(builtin ? builtin.file : URL.createObjectURL(item.blob));
    audio.volume = Math.max(0, Math.min(1, volume));
    boardPlaying = audio;
    boardPlayingId = id;
    const done = () => { if (boardPlaying === audio) { boardPlaying = null; boardPlayingId = null; markBoardPlaying(); } };
    audio.addEventListener('pause', done);
    audio.addEventListener('ended', done);
    await audio.play();
    markBoardPlaying();
    if (maxMs) setTimeout(() => { if (boardPlaying === audio) { audio.pause(); } }, maxMs);
    if (!builtin) audio.addEventListener('ended', () => URL.revokeObjectURL(audio.src), { once: true });
    return true;
  } catch { boardPlayingId = null; markBoardPlaying(); return false; }
}

// Uygulamada ayrı pencere (yanda açık kalır, ana pencereyi kapatmaz); pencere desteği yoksa (tarayıcı) aynı sayfada açılır.
function openSoundBoard() {
  if (typeof window !== 'undefined' && window.appSoundBoard) { window.appSoundBoard.open(); return; }
  let overlay = document.getElementById('soundBoard');
  if (!overlay) {
    overlay = el('div', 'sb-overlay');
    overlay.id = 'soundBoard';
    const hide = () => { overlay.hidden = true; boardPlaying?.pause(); };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) hide(); });
    document.body.append(overlay);
  }
  overlay.hidden = false;
  renderSoundBoard(overlay);
}

// Favoriler (en üstte, kendi sıralarıyla), gizlenen hazır sesler ve bölüm içi sıralama (sürükle-bırak)
const boardFavs = () => load('soundFavs', []) || [];
const boardHidden = () => load('soundHidden', []) || [];
function boardOrder(section, items) {
  const order = (load('soundOrder', {}) || {})[section] || [];
  const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1e6 : i; };
  return items.map((x, i) => [x, i]).sort((a, b) => pos(a[0].id) - pos(b[0].id) || a[1] - b[1]).map((x) => x[0]);
}
let boardDrag = null; // {section, id}
function makeSortable(cell, section, ids, overlay) {
  cell.draggable = true;
  cell.addEventListener('dragstart', (e) => { boardDrag = { section, id: cell.dataset.id }; e.dataTransfer.effectAllowed = 'move'; cell.classList.add('dragging'); });
  cell.addEventListener('dragend', () => { boardDrag = null; cell.classList.remove('dragging'); });
  cell.addEventListener('dragover', (e) => { if (boardDrag?.section === section) { e.preventDefault(); cell.classList.add('drop'); } });
  cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
  cell.addEventListener('drop', (e) => {
    e.preventDefault(); cell.classList.remove('drop');
    if (!boardDrag || boardDrag.section !== section || boardDrag.id === cell.dataset.id) return;
    const list = ids.filter((x) => x !== boardDrag.id);
    list.splice(list.indexOf(cell.dataset.id), 0, boardDrag.id);
    if (section === 'fav') save('soundFavs', list);
    else { const all = load('soundOrder', {}) || {}; all[section] = list; save('soundOrder', all); }
    renderSoundBoard(overlay);
  });
}

function boardCell(item, overlay, builtin) {
  const cell = el('div', 'sb-cell');
  cell.dataset.id = item.id;
  const btn = el('button', 'sb-btn'); btn.type = 'button'; btn.style.setProperty('--c', item.color); btn.title = 'Çal';
  btn.dataset.id = item.id;
  btn.classList.toggle('playing', item.id === boardPlayingId);
  btn.addEventListener('click', () => toggleBoardSound(item.id));
  const name = el('div', 'sb-name', item.name);
  name.title = 'Adı değiştirmek için çift tıkla';
  const rename = () => {
    const input = el('input', 'sb-name-in'); input.value = item.name; input.maxLength = 40;
    let closed = false;
    const done = async (ok) => {
      if (closed) return; closed = true;
      const v = input.value.trim();
      if (ok && v && v !== item.name) {
        if (builtin) { const names = load('soundNames', {}) || {}; names[item.id] = v; save('soundNames', names); }
        else { item.name = v; await boardPut(item); }
      }
      renderSoundBoard(overlay);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    input.addEventListener('blur', () => done(true));
    name.replaceWith(input); input.focus(); input.select();
  };
  name.addEventListener('dblclick', rename);
  const acts = el('div', 'sb-acts');
  const favs = boardFavs();
  const isFav = favs.includes(item.id);
  const fav = el('button', 'sb-act sb-fav' + (isFav ? ' on' : ''), isFav ? '★' : '☆');
  fav.title = isFav ? 'Favorilerden çıkar' : 'Favorilere ekle (en üstte görünür)';
  fav.addEventListener('click', () => { save('soundFavs', isFav ? favs.filter((x) => x !== item.id) : [...favs, item.id]); renderSoundBoard(overlay); });
  const edit = el('button', 'sb-act', '✎'); edit.title = 'Adı değiştir'; edit.addEventListener('click', rename);
  acts.append(fav, edit);
  const del = el('button', 'sb-act', '🗑');
  if (builtin) {  // hazır ses silinemez, gizlenir; alttaki bağlantıyla geri getirilir
    del.title = 'Panodan kaldır';
    del.addEventListener('click', () => {
      save('soundHidden', [...boardHidden(), item.id]);
      save('soundFavs', boardFavs().filter((x) => x !== item.id));
      renderSoundBoard(overlay);
    });
  } else {
    del.title = 'Sil';
    del.addEventListener('click', async () => {
      if (!confirm(`"${item.name}" silinsin mi?`)) return;
      save('soundFavs', boardFavs().filter((x) => x !== item.id));
      await boardDelete(item.id); renderSoundBoard(overlay);
    });
  }
  acts.append(del);
  cell.append(btn, name, acts);
  return cell;
}

async function renderSoundBoard(overlay, standalone = overlay.dataset.standalone === '1') {
  const box = el('div', 'sb-box');
  const head = el('div', 'sb-head');
  let tool;
  if (standalone) { // ayrı pencere: kapatma pencerenin kendisinde; 📌 her zaman üstte tutar
    tool = el('button', 'icon-btn sb-pin' + (load('soundBoardPinned', false) ? ' on' : ''), '📌');
    tool.title = 'Her zaman üstte tut';
    tool.addEventListener('click', () => { const on = !load('soundBoardPinned', false); save('soundBoardPinned', on); window.appSoundBoard?.pin(on); tool.classList.toggle('on', on); });
  } else {
    tool = el('button', 'icon-btn', '✕'); tool.title = 'Kapat'; tool.addEventListener('click', () => { overlay.hidden = true; boardPlaying?.pause(); });
  }
  // ses seviyesi: kaydırınca çalan sese de anında uygulanır
  const vol = el('div', 'sb-vol');
  const ico = el('span', 'sb-vol-ico');
  const slider = el('input');
  Object.assign(slider, { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(boardVolume() * 100)) });
  slider.title = 'Ses panosunun ses seviyesi';
  const pct = el('span', 'snd-pct');
  const paintVol = () => { const v = Number(slider.value); pct.textContent = `%${v}`; setSoundIcon(ico, v === 0 ? 'off' : v < 50 ? 'low' : 'on', 16); };
  slider.addEventListener('input', () => { save('boardVolume', Number(slider.value) / 100); if (boardPlaying) boardPlaying.volume = Number(slider.value) / 100; paintVol(); });
  paintVol();
  vol.append(ico, slider, pct);
  head.append(el('div', 'sb-title', '🎵 Ses panosu'), tool);
  box.append(head, vol, el('div', 'sb-sub', 'Butona bas, dinle; çalarken tekrar basarsan durur. ☆ ile favorilere ekle; sesleri sürükleyerek sırala.'));
  let mine = [];
  try { mine = await boardAll(); } catch { /* IndexedDB yoksa yalnız hazır sesler */ }
  const hidden = new Set(boardHidden());
  const favIds = boardFavs();
  const byId = new Map([...BUILTIN_SOUNDS.filter((b) => !hidden.has(b.id)).map((b) => [b.id, { item: builtinSound(b.id), builtin: true }]),
    ...mine.map((m) => [m.id, { item: m, builtin: false }])]);
  const favList = favIds.filter((id) => byId.has(id));
  const isFav = new Set(favList);
  const section = (key, entries, grid) => {
    const ids = entries.map((x) => x.item.id);
    for (const x of entries) { const c = boardCell(x.item, overlay, x.builtin); makeSortable(c, key, ids, overlay); grid.append(c); }
  };
  if (favList.length) {
    const grid = el('div', 'sb-grid');
    section('fav', favList.map((id) => byId.get(id)), grid);
    box.append(el('div', 'sb-section sb-fav-title', '★ Favoriler'), grid);
  }
  for (const [group, title] of BOARD_GROUPS) {
    const grid = el('div', 'sb-grid');
    if (group === 'benim') {
      section(group, boardOrder(group, mine.filter((m) => !isFav.has(m.id))).map((m) => ({ item: m, builtin: false })), grid);
      const add = el('div', 'sb-cell sb-add');
      const file = el('input'); file.type = 'file'; file.accept = 'audio/*'; file.multiple = true; file.hidden = true;
      const addBtn = el('button', 'sb-btn sb-plus', '+'); addBtn.type = 'button'; addBtn.title = 'Bilgisayardan ses ekle (mp3, wav, ogg)';
      addBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        let n = mine.length;
        for (const f of file.files) {
          if (!f.type.startsWith('audio/') || f.size > MAX_SOUND_BYTES) continue;
          const name = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 40);
          await boardPut({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, color: BOARD_COLORS[n++ % BOARD_COLORS.length],
            blob: f, created: Date.now() });
        }
        renderSoundBoard(overlay);
      });
      add.append(addBtn, el('div', 'sb-name', 'Ses ekle'), file);
      grid.append(add);
    } else {
      const list = BUILTIN_SOUNDS.filter((x) => x.group === group && !hidden.has(x.id) && !isFav.has(x.id)).map((b) => builtinSound(b.id));
      if (!list.length) continue;
      section(group, boardOrder(group, list).map((item) => ({ item, builtin: true })), grid);
    }
    box.append(el('div', 'sb-section', title), grid);
  }
  if (hidden.size) {
    const back = el('button', 'sb-restore', `Kaldırılan ${hidden.size} hazır sesi geri getir`);
    back.type = 'button';
    back.addEventListener('click', () => { save('soundHidden', []); renderSoundBoard(overlay); });
    box.append(back);
  }
  box.append(el('div', 'sb-foot', 'Kendi eklediğin sesler yalnız bu bilgisayarda saklanır (en fazla 6 MB).'));
  overlay.replaceChildren(box);
}

// soundboard.html (ayrı pencere) açılışı
function initSoundBoardWindow() {
  const host = document.getElementById('soundBoard');
  host.dataset.standalone = '1';
  window.appSoundBoard?.pin(!!load('soundBoardPinned', false));
  renderSoundBoard(host, true);
}

function initSoundBoard() {
  const btn = document.getElementById('soundBoardBtn');  // eski üst bar düğmesi (artık ses menüsünde)
  if (btn) { setSoundIcon(btn, 'board'); btn.addEventListener('click', openSoundBoard); }
}

if (typeof module !== 'undefined') module.exports = { NOTIFY_EVENTS, SOUND_DEFAULTS, BUILTIN_SOUNDS };
