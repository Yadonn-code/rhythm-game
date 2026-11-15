'use strict';
/* ============================================================
   ゆきあかりリズム — 雪国のリズム・ミニゲーム集
   画像・音声ファイルは使わない。絵は Canvas、音は Web Audio でその場で作る
   ============================================================ */

// ---------- 画面 ----------
const W = 960, H = 540;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const ui = document.getElementById('ui');
const VERSION = '1.2';
const IS_SP = document.body.dataset.platform === 'sp';
const KEY_LABEL = IS_SP ? 'タップ' : 'スペース';
let portrait = false;

// メニュー・結果は画面いっぱい（はみ出しOK）、プレイ中は全体が見えるように収める。
// スマホを縦に持っているときは、ゲーム画面を上に置いて下をタップ面にする
function resize() {
  const vw = innerWidth, vh = innerHeight;
  const playing = S.scene === 'play' || S.scene === 'calib';
  portrait = IS_SP && vh > vw;
  document.body.classList.toggle('portrait', portrait);
  const s = !playing ? Math.max(vw / W, vh / H) : portrait ? vw / W : Math.min(vw / W, vh / H);
  const cw = W * s, ch = H * s;
  const top = portrait && playing ? Math.max(vh * 0.1, 24) : (vh - ch) / 2;
  Object.assign(cv.style, { width: cw + 'px', height: ch + 'px', left: (vw - cw) / 2 + 'px', top: top + 'px' });
  document.documentElement.style.setProperty('--cv-bottom', top + ch + 'px');
  const dpr = Math.min(window.devicePixelRatio || 1, 2, 2400 / cw);
  cv.width = Math.round(cw * dpr);
  cv.height = Math.round(ch * dpr);
}
addEventListener('resize', () => resize());

// ---------- 便利関数 ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = t => Math.pow(clamp(t, 0, 1), 2);
const easeBack = t => { t = clamp(t, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) { return null; }
}

function ell(x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, TAU); }
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fill(c) { ctx.fillStyle = c; ctx.fill(); }
function stroke(c, w) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); }
function glow(x, y, r, color, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('A', a)); g.addColorStop(1, color.replace('A', 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ============================================================
//  音（Web Audio で全部合成）
// ============================================================
let AC = null, master = null, verb = null, musicBus = null, sfxBus = null, noiseBuf = null;

function initAudio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master = AC.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    verb = AC.createConvolver(); verb.buffer = makeImpulse(2.4, 3.2);
    const wet = AC.createGain(); wet.gain.value = 0.22;
    verb.connect(wet); wet.connect(master);
    makeBuses();
    // iPhone：マナーモードでも鳴らす（対応している Safari のみ）
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 非対応 */ }
  }
  if (AC.state !== 'running') AC.resume();
}
function makeImpulse(sec, decay) {
  const len = Math.floor(AC.sampleRate * sec), b = AC.createBuffer(2, len, AC.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}
function makeBuses() {
  musicBus = AC.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
  const ms = AC.createGain(); ms.gain.value = 0.5; musicBus.connect(ms); ms.connect(verb);
  sfxBus = AC.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  const ss = AC.createGain(); ss.gain.value = 0.3; sfxBus.connect(ss); ss.connect(verb);
}
// 予約済みの音ごと止める（バスを切り離して作り直す）
function hushAudio() {
  if (!AC) return;
  const m = musicBus, s = sfxBus, t = AC.currentTime;
  m.gain.setTargetAtTime(0, t, 0.03); s.gain.setTargetAtTime(0, t, 0.03);
  setTimeout(() => { m.disconnect(); s.disconnect(); }, 250);
  makeBuses();
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function osc(t, freq, dur, o = {}) {
  const v = AC.createOscillator(), g = AC.createGain();
  v.type = o.type || 'sine';
  v.frequency.setValueAtTime(freq, t);
  if (o.glide) v.frequency.exponentialRampToValueAtTime(o.glide, t + dur);
  if (o.detune) v.detune.value = o.detune;
  env(g, t, o.attack || 0.004, o.vol || 0.3, dur);
  v.connect(g); g.connect(o.bus || musicBus);
  v.start(t); v.stop(t + (o.attack || 0.004) + dur + 0.05);
}
function noise(t, dur, o = {}) {
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf;
  f.type = o.filter || 'highpass'; f.frequency.value = o.freq || 6000; f.Q.value = o.q || 0.8;
  env(g, t, 0.002, o.vol || 0.3, dur);
  s.connect(f); f.connect(g); g.connect(o.bus || musicBus);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}

// --- 楽器 ---
const kick = t => osc(t, 150, 0.3, { vol: 0.9, glide: 42 });
const snare = t => { noise(t, 0.16, { vol: 0.3, filter: 'bandpass', freq: 1900, q: 0.7 }); osc(t, 230, 0.07, { type: 'triangle', vol: 0.2, glide: 150 }); };
const rim = t => { osc(t, 1750, 0.03, { type: 'triangle', vol: 0.12 }); noise(t, 0.03, { vol: 0.12, filter: 'bandpass', freq: 3000 }); };
const hat = (t, open) => noise(t, open ? 0.14 : 0.035, { vol: open ? 0.08 : 0.1, freq: 8500 });
const crash = t => noise(t, 1.4, { vol: 0.14, freq: 5000 });
const bass = (t, m, dur) => osc(t, mtof(m), dur, { type: 'triangle', vol: 0.34, attack: 0.008 });
const bell = (t, m, dur, vol = 0.07) => { osc(t, mtof(m), dur, { vol }); osc(t, mtof(m) * 3, dur * 0.4, { vol: vol * 0.25 }); };
const lead = (t, m, dur) => { osc(t, mtof(m), dur, { type: 'triangle', vol: 0.09, attack: 0.02 }); osc(t, mtof(m), dur, { type: 'sine', vol: 0.05, attack: 0.02, detune: 7 }); };
function pad(t, notes, dur) {
  for (const m of notes) for (const dt of [-9, 9]) {
    const v = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
    v.type = 'sawtooth'; v.frequency.value = mtof(m); v.detune.value = dt;
    f.type = 'lowpass'; f.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.022, t + 0.12);
    g.gain.setValueAtTime(0.022, t + dur - 0.15); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    v.connect(f); f.connect(g); g.connect(musicBus);
    v.start(t); v.stop(t + dur + 0.05);
  }
}

// --- 効果音（合図・操作） ---
const SFX = {
  toss: t => { osc(t, 950, 0.06, { vol: 0.38, glide: 520, bus: sfxBus }); noise(t, 0.02, { vol: 0.2, filter: 'bandpass', freq: 2200, bus: sfxBus }); },
  bigToss: t => { osc(t, 210, 0.2, { type: 'triangle', vol: 0.55, glide: 95, bus: sfxBus }); noise(t, 0.1, { vol: 0.3, filter: 'lowpass', freq: 700, bus: sfxBus }); },
  tick: (t, p = 1) => osc(t, 1300 * p, 0.05, { vol: 0.3, bus: sfxBus }),
  swish: t => noise(t, 0.09, { vol: 0.16, filter: 'bandpass', freq: 3600, bus: sfxBus }),
  chop: (t, p) => {
    noise(t, 0.13, { vol: 0.5 * p, filter: 'bandpass', freq: 2300, q: 1.2, bus: sfxBus });
    osc(t, 1750, 0.05, { type: 'triangle', vol: 0.2 * p, bus: sfxBus });
    osc(t, 170, 0.16, { vol: 0.6 * p, glide: 55, bus: sfxBus });
  },
  bonk: t => { osc(t, 290, 0.1, { vol: 0.4, glide: 170, bus: sfxBus }); noise(t, 0.06, { vol: 0.2, filter: 'lowpass', freq: 900, bus: sfxBus }); },
  hoot: (t, p = 1, vol = 0.4) => {
    osc(t, 470 * p, 0.2, { vol, glide: 430 * p, attack: 0.02, bus: sfxBus });
    osc(t, 940 * p, 0.14, { vol: vol * 0.12, glide: 860 * p, attack: 0.02, bus: sfxBus });
  },
  squawk: t => osc(t, 520, 0.08, { type: 'square', vol: 0.07, glide: 340, bus: sfxBus }),
  chime: (t, m) => bell(t, m, 0.6, 0.1),
  click: (t, hi) => osc(t, hi ? 1700 : 1150, 0.04, { vol: 0.35, bus: sfxBus }),
};
function jingle(stars) {
  const t = AC.currentTime + 0.05;
  const seq = stars >= 3 ? [72, 76, 79, 84, 88] : stars >= 1 ? [72, 76, 79, 84] : [72, 70, 67];
  seq.forEach((m, i) => bell(t + i * 0.11, m, 0.7, 0.12));
}

// --- 曲：コード進行とエネルギー段階から伴奏を組み立てる ---
const CHORD = { maj: [0, 4, 7], min: [0, 3, 7] };
function scheduleSong(song, t0, spb, push) {
  for (let b = 0; b < song.bars; b++) {
    const tb = t0 + b * 4 * spb;
    const [root, q] = song.prog[b % song.prog.length];
    const tones = CHORD[q].map(i => root + 24 + i);
    const e = song.energy(b);
    const at = (beat, fn) => push(tb + beat * spb, fn);
    if (e === 3) { // 締めの一発
      at(0, t => { kick(t); crash(t); pad(t, tones, spb * 4); bass(t, root, spb * 2); });
      continue;
    }
    at(0, t => pad(t, tones, spb * 4));
    for (let i = 0; i < 4; i++) at(i, hat);
    at(0, kick);
    if (e >= 1) {
      at(2, kick);
      at(1, song.rim ? rim : snare); at(3, song.rim ? rim : snare);
      for (let i = 0; i < 4; i++) at(i + 0.5, hat);
      [[0, 0], [1, 0], [1.5, 12], [2.5, 7], [3, 0]].forEach(([bt, iv]) => at(bt, t => bass(t, root + iv, spb * 0.45)));
    }
    if (e >= 2) {
      at(2.5, kick); at(3.5, t => hat(t, true));
      const arp = [0, 1, 2, 3, 2, 1, 2, 1];
      arp.forEach((k, i) => at(i * 0.5, t => bell(t, (k === 3 ? root + 36 : tones[k] + 12), spb * 0.9, song.rim ? 0.06 : 0.035)));
      if (song.lead) song.lead[b % song.lead.length].forEach(([bt, m, d]) => at(bt, t => lead(t, m, d * spb)));
    }
  }
}

// ============================================================
//  時間（実際に耳に届いている時刻で判定する）
// ============================================================
let offsetMs = store('yr_offset') ?? 0;
function heardAt(perfMs) {
  if (AC.getOutputTimestamp) {
    const ts = AC.getOutputTimestamp();
    if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  }
  return AC.currentTime - (AC.outputLatency || AC.baseLatency || 0) + (perfMs - performance.now()) / 1000;
}
function evtTime(e) {
  const t = e.timeStamp, now = performance.now();
  return (t > 0 && Math.abs(now - t) < 1000) ? t : now;
}

// ============================================================
//  背景（共通パーツ）
// ============================================================
let clock = 0;
const STARS = Array.from({ length: 110 }, () => ({ x: Math.random() * W, y: Math.random() * 320, r: Math.random() * 1.3 + 0.3, p: Math.random() * TAU }));
const FLAKES = Array.from({ length: 130 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2.2 + 0.6, s: Math.random() * 30 + 25, p: Math.random() * TAU }));
function makeRidge(seed, baseY, amp, step) {
  const r = rng(seed), pts = [];
  for (let x = -60; x <= W + 60; x += step) pts.push([x + r() * step * 0.4, baseY - r() * amp]);
  return pts;
}
const RIDGE_FAR = makeRidge(7, 330, 130, 85), RIDGE_NEAR = makeRidge(23, 385, 70, 60);
const PINES = (() => { const r = rng(5), a = []; for (let i = 0; i < 26; i++) a.push({ x: r() * W, h: 60 + r() * 70, back: r() < 0.55 }); return a.sort((p, q) => q.back - p.back); })();

function drawSky(stops) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawStars(a) {
  for (const s of STARS) {
    ctx.globalAlpha = a * (0.45 + 0.55 * Math.sin(clock * 1.7 + s.p) ** 2);
    ell(s.x, s.y, s.r, s.r); fill('#fff');
  }
  ctx.globalAlpha = 1;
}
function auroraY(x, k) { return 120 + k * 26 + Math.sin(x * 0.006 + clock * 0.22 + k * 1.7) * 36 + Math.sin(x * 0.017 - clock * 0.37 + k) * 10; }
function drawAurora(a, hue) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const g = ctx.createLinearGradient(0, 40, 0, 250);
    g.addColorStop(0, `hsla(${hue + 60},90%,70%,0)`);
    g.addColorStop(0.5, `hsla(${hue + k * 18},90%,62%,${a * (0.32 - k * 0.06)})`);
    g.addColorStop(1, `hsla(${hue},90%,55%,0)`);
    ctx.fillStyle = g; ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 20) { const y = auroraY(x, k) - 70; x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    for (let x = W + 20; x >= -20; x -= 20) ctx.lineTo(x, auroraY(x, k) + 45);
    ctx.fill();
  }
  ctx.restore();
}
function drawRidge(pts, base, snow, top, bottom) {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, snow); g.addColorStop(0.35, base); g.addColorStop(1, base);
  ctx.beginPath(); ctx.moveTo(-60, H);
  pts.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(W + 60, H); ctx.closePath(); fill(g);
}
function drawPine(x, y, h, col, snow) {
  const w = h * 0.42;
  ctx.fillStyle = col; ctx.fillRect(x - h * 0.04, y - h * 0.22, h * 0.08, h * 0.22);
  for (let k = 0; k < 3; k++) {
    const top = y - h + k * h * 0.24, bot = top + h * 0.48, hw = w * (0.5 + k * 0.27);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + hw, bot); ctx.lineTo(x - hw, bot); ctx.closePath(); fill(col);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + hw * 0.5, top + h * 0.22);
    ctx.quadraticCurveTo(x, top + h * 0.3, x - hw * 0.5, top + h * 0.22); ctx.closePath(); fill(snow);
  }
}
function drawForest(col, snow, groundY) {
  for (const p of PINES) drawPine(p.x, groundY - (p.back ? 18 : 0), p.h * (p.back ? 0.75 : 1), p.back ? col[0] : col[1], snow);
}
function drawGround(y, c1, c2) {
  const g = ctx.createLinearGradient(0, y, 0, H);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.beginPath(); ctx.moveTo(0, y + 8);
  ctx.bezierCurveTo(W * 0.3, y - 10, W * 0.65, y + 14, W, y - 2);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); fill(g);
}
function drawSnow(dt, a = 1) {
  ctx.fillStyle = '#fff';
  for (const f of FLAKES) {
    f.y += f.s * dt; f.x += Math.sin(clock * 0.8 + f.p) * 12 * dt - 6 * dt;
    if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
    if (f.x < -4) f.x = W + 4;
    ctx.globalAlpha = a * (0.35 + f.r / 4);
    ell(f.x, f.y, f.r, f.r); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function vignette() {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, 'rgba(0,0,20,0)'); g.addColorStop(1, 'rgba(0,0,20,.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ============================================================
//  キャラクター
// ============================================================
// クマ（左向き）。axe = 斧の角度（-1.2 で構え、-3.6 で振り下ろし）
function drawBear(x, y, s, o) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (1 + o.bob * 0.035), s * (1 - o.bob * 0.035));
  ell(0, 4, 72, 12); fill('rgba(20,30,70,.25)');
  rr(-48, -34, 36, 36, 14); fill('#6a422c'); rr(10, -34, 36, 36, 14); fill('#6a422c');
  ell(0, -82, 64, 72); fill('#8a5a3c');
  ell(-12, -72, 38, 46); fill('#c99a6e');
  // マフラー
  rr(-52, -142, 92, 22, 11); fill('#d8463f');
  ctx.beginPath(); ctx.moveTo(18, -126); ctx.quadraticCurveTo(40, -110, 34, -88); ctx.lineTo(18, -92); ctx.closePath(); fill('#c23a35');
  // 頭
  ell(-12, -168, 46, 44); fill('#8a5a3c');
  ell(-46, -202, 15, 15); fill('#8a5a3c'); ell(20, -204, 15, 15); fill('#8a5a3c');
  ell(-46, -202, 7, 7); fill('#c99a6e'); ell(20, -204, 7, 7); fill('#c99a6e');
  ell(-36, -154, 21, 16); fill('#e6c49b');
  ell(-47, -160, 7.5, 5.5); fill('#2b1a12');
  ell(-12, -158, 8, 5); fill('rgba(255,120,120,.35)');
  if (o.mood === 'oops') {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-36, -180); ctx.lineTo(-26, -174); ctx.lineTo(-36, -168); stroke('#2b1a12', 3);
    ctx.beginPath(); ctx.moveTo(4, -180); ctx.lineTo(-6, -174); ctx.lineTo(4, -168); ctx.stroke();
    ell(18, -190, 5, 8); fill('rgba(140,200,255,.9)');
  } else {
    const bl = o.blink ? 0.15 : 1;
    ell(-31, -177, 4.8, 4.8 * bl); fill('#1b120c'); ell(-3, -178, 4.8, 4.8 * bl); fill('#1b120c');
    if (o.mood === 'happy') { ctx.beginPath(); ctx.arc(-38, -150, 7, 0.2, Math.PI - 0.2); stroke('#2b1a12', 2.5); }
  }
  // 腕と斧
  ctx.save(); ctx.translate(-20, -106); ctx.rotate(o.axe);
  rr(28, -5, 108, 10, 5); fill('#a8743f');
  ctx.beginPath(); ctx.moveTo(112, -4); ctx.lineTo(138, -4); ctx.lineTo(152, -36);
  ctx.quadraticCurveTo(124, -46, 98, -36); ctx.closePath(); fill('#a9b6c9');
  ctx.beginPath(); ctx.moveTo(152, -36); ctx.quadraticCurveTo(124, -46, 98, -36); stroke('#eef4ff', 3);
  rr(116, 4, 20, 9, 3); fill('#7d8798');
  rr(0, -12, 50, 24, 12); fill('#7b4f34');
  ell(50, 0, 13, 13); fill('#6a422c');
  ctx.restore();
  ctx.restore();
}

// キツネ（右向き）。arm = 腕の角度、hold = 丸太を持っているか
function drawFox(x, y, s, o) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (1 + o.bob * 0.05), s * (1 - o.bob * 0.05));
  ell(0, 3, 46, 9); fill('rgba(20,30,70,.25)');
  // しっぽ
  const sw = Math.sin(clock * 3) * 6;
  ctx.beginPath(); ctx.moveTo(-18, -26);
  ctx.bezierCurveTo(-70, -10 + sw, -92, -70 + sw, -56, -92 + sw);
  ctx.bezierCurveTo(-46, -60, -30, -46, -8, -44); ctx.closePath(); fill('#e07a2e');
  ell(-58, -86 + sw, 12, 10, -0.6); fill('#fff6ea');
  rr(-20, -22, 14, 24, 6); fill('#3b2416'); rr(8, -22, 14, 24, 6); fill('#3b2416');
  ell(0, -46, 30, 36); fill('#ec8a3c');
  ell(9, -42, 16, 25); fill('#fff6ea');
  // 頭
  ell(6, -96, 30, 26); fill('#ec8a3c');
  ctx.beginPath(); ctx.moveTo(18, -108); ctx.quadraticCurveTo(48, -96, 50, -88); ctx.quadraticCurveTo(36, -78, 14, -80); ctx.closePath(); fill('#fff6ea');
  ell(50, -89, 5, 4); fill('#20140c');
  for (const [ex, tilt] of [[-12, -0.25], [18, 0.2]]) {
    ctx.save(); ctx.translate(ex, -116); ctx.rotate(tilt);
    ctx.beginPath(); ctx.moveTo(-11, 8); ctx.lineTo(0, -22); ctx.lineTo(11, 8); ctx.closePath(); fill('#ec8a3c');
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, -21); ctx.lineTo(5, 0); ctx.closePath(); fill('#3b2416');
    ctx.restore();
  }
  ell(22, -100, 4, o.blink ? 0.8 : 4.4); fill('#20140c');
  ell(14, -88, 6, 4); fill('rgba(255,110,110,.35)');
  // 腕
  ctx.save(); ctx.translate(14, -62); ctx.rotate(o.arm);
  rr(0, -6, 30, 12, 6); fill('#d9732c');
  if (o.hold) drawLog(34, 0, 44, 11, 0.3);
  ctx.restore();
  ctx.restore();
}

// フクロウ。eye = 目の開き(0..1)、hoot = 鳴いている強さ(0..1)
function drawOwl(x, y, s, o) {
  ctx.save(); ctx.translate(x, y);
  ctx.scale(s * (1 + o.hoot * 0.07 + o.bob * 0.03), s * (1 - o.hoot * 0.06 - o.bob * 0.03));
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 30, -82); ctx.lineTo(sx * 40, -112); ctx.lineTo(sx * 12, -92); ctx.closePath(); fill(o.dark); }
  ell(0, -52, 44, 54); fill(o.body);
  ell(-38, -46, 14, 34, 0.25); fill(o.dark); ell(38, -46, 14, 34, -0.25); fill(o.dark);
  ell(0, -36, 29, 34); fill(o.belly);
  ctx.strokeStyle = o.dark; ctx.lineWidth = 2;
  for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c++) {
    ctx.beginPath(); ctx.arc(c * 12 + (r % 2) * 6 - 3, -46 + r * 13, 5, 0.2, Math.PI - 0.2); ctx.stroke();
  }
  ell(-16, -72, 18, 18); fill(o.face); ell(16, -72, 18, 18); fill(o.face);
  for (const ex of [-16, 16]) {
    if (o.eye > 0.1) {
      ell(ex, -72, 12, 12 * o.eye); fill('#ffd24a');
      ell(ex + (o.look || 0), -72, 6.5, 6.5 * o.eye); fill('#1a1020');
      ell(ex + 3, -76, 2.2, 2.2 * o.eye); fill('#fff');
    } else { ctx.beginPath(); ctx.arc(ex, -74, 9, 0.3, Math.PI - 0.3); stroke('#3a2a20', 3); }
  }
  if (o.glasses) { ctx.beginPath(); ctx.arc(-16, -72, 15, 0, TAU); ctx.moveTo(31, -72); ctx.arc(16, -72, 15, 0, TAU); ctx.moveTo(-1, -73); ctx.lineTo(1, -73); stroke('#c9a24a', 2.5); }
  if (o.brow) { ctx.beginPath(); ctx.moveTo(-30, -92); ctx.quadraticCurveTo(-16, -98, -4, -90); ctx.moveTo(30, -92); ctx.quadraticCurveTo(16, -98, 4, -90); stroke('#f3eee6', 4); }
  const op = o.hoot * 7;
  ctx.beginPath(); ctx.moveTo(-6, -62 - op * 0.3); ctx.lineTo(6, -62 - op * 0.3); ctx.lineTo(0, -52 - op * 0.3); ctx.closePath(); fill('#e8a23a');
  if (op > 1) { ctx.beginPath(); ctx.moveTo(-5, -56 + op * 0.4); ctx.lineTo(5, -56 + op * 0.4); ctx.lineTo(0, -50 + op * 0.6); ctx.closePath(); fill('#c9832a'); }
  for (const fx of [-14, 14]) { ctx.beginPath(); ctx.arc(fx, -2, 7, Math.PI, 0); stroke('#e8a23a', 4); }
  ctx.restore();
}

function drawLog(x, y, len, r, rot, cut) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  rr(-len / 2, -r, len, r * 2, r * 0.45); fill('#9b6438');
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) { ctx.moveTo(-len / 2 + 6, i * r * 0.5); ctx.lineTo(len / 2 - 8, i * r * 0.5 + 1); }
  stroke('rgba(90,50,25,.55)', 2);
  for (const side of cut === 'both' ? [-1, 1] : cut === 'left' ? [-1] : [1]) {
    ell(side * (len / 2 - 2), 0, r * 0.42, r); fill('#ecc58e');
    ell(side * (len / 2 - 2), 0, r * 0.22, r * 0.55); stroke('#c99a5c', 1.5);
  }
  ctx.restore();
}

// ============================================================
//  演出（パーティクル・判定文字）
// ============================================================
const FX = [], POPS = [];
function burst(type, x, y, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = o.angle !== undefined ? o.angle + rand(-o.spread, o.spread) : rand(0, TAU);
    const sp = rand(o.speed * 0.4, o.speed);
    FX.push({ type, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(o.life * 0.6, o.life), size: rand(o.size * 0.6, o.size), color: o.color, rot: rand(0, TAU), vr: rand(-10, 10) });
  }
}
function ring(x, y, color, size = 70) { FX.push({ type: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.45, size, color }); }
function pop(text, x, y, color) { POPS.push({ text, x, y, color, age: 0 }); }
function drawFx(dt) {
  for (let i = FX.length - 1; i >= 0; i--) {
    const p = FX[i]; p.life += dt;
    if (p.life >= p.max) { FX.splice(i, 1); continue; }
    const k = p.life / p.max;
    if (p.type === 'chip') { p.vy += 1100 * dt; } else if (p.type === 'feather') { p.vy = 30; p.vx = Math.sin(p.life * 6 + p.rot) * 40; } else if (p.type === 'smoke') { p.vy -= 20 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    ctx.globalAlpha = 1 - k;
    if (p.type === 'chip') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8); ctx.restore(); }
    else if (p.type === 'spark') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ell(p.x, p.y, p.size * (1 - k * 0.5), p.size * (1 - k * 0.5)); fill(p.color); ctx.restore(); }
    else if (p.type === 'star') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalCompositeOperation = 'lighter';
      const s = p.size * (1 - k * 0.6); ctx.beginPath();
      for (let j = 0; j < 8; j++) { const rr2 = j % 2 ? s * 0.3 : s; ctx.lineTo(Math.cos(j * Math.PI / 4) * rr2, Math.sin(j * Math.PI / 4) * rr2); }
      ctx.closePath(); fill(p.color); ctx.restore();
    }
    else if (p.type === 'smoke') { ell(p.x, p.y, p.size * (0.6 + k), p.size * (0.6 + k)); fill(p.color); }
    else if (p.type === 'feather') { ell(p.x, p.y, p.size, p.size * 0.4, p.rot); fill(p.color); }
    else if (p.type === 'ring') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * easeOut(k), 0, TAU); stroke(p.color, 6 * (1 - k)); }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = POPS.length - 1; i >= 0; i--) {
    const p = POPS[i]; p.age += dt;
    if (p.age > 0.7) { POPS.splice(i, 1); continue; }
    const s = easeBack(p.age / 0.18);
    ctx.save(); ctx.translate(p.x, p.y - p.age * 40); ctx.scale(s, s);
    ctx.globalAlpha = clamp((0.7 - p.age) / 0.25, 0, 1);
    ctx.font = `800 ${portrait ? 50 : 30}px "M PLUS Rounded 1c", sans-serif`;
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(15,20,50,.85)'; ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
}

// ============================================================
//  ゲーム1：まき割りベア
//  キツネが丸太を放る →（小は1拍、大は2拍後）着地の瞬間に A で割る
// ============================================================
const STUMP = { x: 560, y: 422 };
const LUMBER = {
  id: 'lumber', icon: '🪓', adviser: '🦊', title: 'まき割りベア',
  sub: 'キツネが「ポン」と放った丸太を、着地の瞬間にパッカーン！',
  bpm: 116,
  popAt: { x: 560, y: 300 },
  song: {
    bars: 32,
    prog: [[41, 'maj'], [38, 'min'], [46, 'maj'], [36, 'maj']],
    energy: b => b < 2 ? 0 : b === 31 ? 3 : b === 27 || b === 30 ? 1 : b >= 15 ? 2 : 1,
    lead: [
      [[0, 72, 1], [1, 69, 0.5], [1.5, 72, 0.5], [2, 77, 1], [3, 76, 0.5], [3.5, 74, 0.5]],
      [[0, 74, 1.5], [1.5, 69, 0.5], [2, 65, 1], [3, 69, 1]],
      [[0, 70, 1], [1, 74, 0.5], [1.5, 77, 0.5], [2, 74, 1], [3, 72, 0.5], [3.5, 70, 0.5]],
      [[0, 72, 1.5], [1.5, 67, 0.5], [2, 76, 1], [3, 72, 1]],
    ],
  },
  // 1文字 = 8分音符。l = 小さい丸太（1拍後に着地）、b = 大きい丸太（2拍後。途中で タ・タ と合図）
  chart: [
    '........', '........', 'l...l...', 'l...l...', 'l...l...', 'l.l.l...', 'l...l...', 'l.l.l.l.',
    '........', 'll......', 'l...ll..', 'll..ll..', 'l.l.ll..', 'l...l...',
    '........', 'b.......', 'b...l...', 'l.l.b...', '....l.l.', 'b...ll..', 'l.ll..b.', '..l.l.l.',
    'll.ll.l.', 'b...b...', 'l.l.ll..', 'll.ll.ll', 'l.l.l.b.', '........', 'l.l.l.l.', 'l.......',
  ],
  banners: [
    [0, 'キツネが「ポン」と放ったら…', 4],
    [4, `1拍あと、着地の瞬間に${KEY_LABEL}！`, 4],
    [32, '2本つづけて「ポポン」→「パカパカン」', 4],
    [56, 'でっかい丸太は「ドン…タ・タ・パッカーン！」', 4],
    [108, 'ラストスパート！', 3],
  ],
  setup(c) {
    this.logs = []; this.pile = 0; this.pileT = -9; this.swing = -9; this.mood = null; this.moodT = -9;
    this.chart.forEach((row, bar) => {
      for (let i = 0; i < 8; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        const toss = bar * 4 + i * 0.5, big = ch === 'b';
        const pair = !big && (row[i - 1] === 'l' || row[i + 1] === 'l');
        const log = { toss, land: toss + (big ? 2 : 1), big, state: 'fly', tHit: 0, spin: big ? 1 : 2 };
        c.addTarget(log.land, big ? 'big' : pair ? 'pair' : 'small', log);
        this.logs.push(log);
        c.at(toss, big ? SFX.bigToss : SFX.toss);
        if (big) { c.at(toss + 1, t => SFX.tick(t, 1)); c.at(toss + 1.5, t => SFX.tick(t, 1.25)); }
      }
    });
    this.banners.forEach(b => c.banner(...b));
  },
  onPress(beat) { this.swing = beat; SFX.swish(AC.currentTime); },
  onHit(tg, grade, beat) {
    const log = tg.obj, t = AC.currentTime;
    log.tHit = beat;
    if (grade === 'near') {
      log.state = 'bonk'; SFX.bonk(t); this.setMood('oops', beat);
      return;
    }
    log.state = 'split'; this.pile++; this.pileT = beat;
    SFX.chop(t, grade === 'just' ? 1 : 0.7);
    const y = STUMP.y - (log.big ? 20 : 14);
    burst('chip', STUMP.x, y, log.big ? 18 : 10, { speed: 420, life: 0.8, size: 5, color: '#e7bd86', angle: -Math.PI / 2, spread: 1.2 });
    burst('spark', STUMP.x, y, grade === 'just' ? 12 : 5, { speed: 300, life: 0.35, size: 4, color: '#fff2b0' });
    ring(STUMP.x, y, grade === 'just' ? 'rgba(255,230,140,.9)' : 'rgba(200,240,255,.7)', log.big ? 110 : 70);
    if (log.big) S.shake = grade === 'just' ? 9 : 5;
    this.setMood('happy', beat);
  },
  onWhiff(beat) { SFX.bonk(AC.currentTime); this.setMood('oops', beat); },
  onMiss(tg, beat) {
    tg.obj.state = 'bounce'; tg.obj.tHit = tg.beat;
    SFX.bonk(AC.currentTime); this.setMood('oops', beat);
  },
  setMood(m, beat) { this.mood = m; this.moodT = beat; },
  comments(st) {
    const out = [], k = st.byKind;
    if (failRate(k.big) > 0.34) out.push('でっかい丸太は「タ・タ」の次がパッカーン。合図の音をよく聞こう');
    if (failRate(k.pair) > 0.3) out.push('2本つづけての、2本目がずれやすいみたい');
    if (failRate(k.small) > 0.3) out.push('「ポン」から ちょうど1拍。手拍子で数えてみよう');
    return out;
  },
  draw(beat) {
    const spb = S.spb, pulse = Math.pow(1 - (((beat % 1) + 1) % 1), 3) * (beat > 0 ? 1 : 0);
    drawSky([[0, '#16204e'], [0.45, '#4a3f86'], [0.72, '#d98a8a'], [0.85, '#f6c79a']]);
    drawStars(0.6); drawAurora(0.6, 150);
    drawRidge(RIDGE_FAR, '#6b6aa8', '#f2e8ff', 190, 340);
    drawRidge(RIDGE_NEAR, '#4b4f8c', '#d9dcff', 300, 400);
    drawForest(['#33406e', '#253058'], '#e8eeff', 425);
    drawGround(415, '#eef3ff', '#b9c6ea');
    // たき火
    const fx = 92, fy = 452;
    glow(fx, fy - 30, 150 + Math.sin(clock * 11) * 6, 'rgba(255,170,80,A)', 0.35);
    drawLog(fx, fy, 60, 7, 0.35, 'both'); drawLog(fx, fy, 60, 7, -0.35, 'both');
    for (let k = 0; k < 3; k++) {
      const h = 48 - k * 12 + Math.sin(clock * (9 + k * 3)) * 6;
      ctx.beginPath(); ctx.moveTo(fx - 16 + k * 5, fy - 4);
      ctx.quadraticCurveTo(fx - 18 + k * 4, fy - h * 0.6, fx + Math.sin(clock * 7 + k) * 4, fy - h);
      ctx.quadraticCurveTo(fx + 18 - k * 4, fy - h * 0.6, fx + 16 - k * 5, fy - 4); ctx.closePath();
      fill(['#ff7a2a', '#ffb43a', '#fff0a0'][k]);
    }
    // 薪の山
    const shown = Math.min(this.pile, 21), popK = easeBack((beat - this.pileT) * spb / 0.25);
    let n = 0;
    for (let row = 0; row < 6 && n < shown; row++) for (let i = 0; i < 6 - row && n < shown; i++, n++) {
      const px = 812 + i * 22 + row * 11, py = 452 - row * 19, sc = n === shown - 1 ? popK : 1;
      ell(px, py, 11 * sc, 10 * sc); fill('#8a5530');
      ell(px, py, 8 * sc, 7.5 * sc); fill('#ecc58e');
      ell(px, py, 4 * sc, 3.5 * sc); stroke('#c99a5c', 1.2);
    }
    // 切り株
    ell(STUMP.x, STUMP.y + 40, 70, 12); fill('rgba(30,40,80,.22)');
    rr(STUMP.x - 56, STUMP.y, 112, 40, 8); fill('#7a4a28');
    ell(STUMP.x, STUMP.y, 56, 13); fill('#e3b97f');
    ell(STUMP.x, STUMP.y, 34, 7.5); stroke('#c4925a', 1.5); ell(STUMP.x, STUMP.y, 16, 3.5); ctx.stroke();
    // 丸太
    const from = { x: 262, y: 360 };
    let holding = false;
    for (const log of this.logs) {
      const len = log.big ? 108 : 68, r = log.big ? 22 : 14, restY = STUMP.y - r + 2;
      if (beat < log.toss) { if (log.toss - beat < 0.5) holding = true; continue; }
      if (log.state === 'fly' || (log.state !== 'fly' && beat < log.tHit)) {
        const p = clamp((beat - log.toss) / (log.land - log.toss), 0, 1);
        const x = lerp(from.x, STUMP.x, p), y = lerp(from.y, restY, p) - (log.big ? 330 : 200) * 4 * p * (1 - p);
        drawLog(x, y, len, r, (1 - p) * log.spin * TAU, 'right');
        continue;
      }
      const s = (beat - log.tHit) * spb;
      if (s > 1.4) continue;
      ctx.globalAlpha = clamp((1.4 - s) / 0.4, 0, 1);
      if (log.state === 'split') {
        for (const d of [-1, 1]) drawLog(STUMP.x + d * (len / 4 + 260 * s), restY - 380 * s + 1100 * s * s, len / 2, r, d * s * 9, d < 0 ? 'right' : 'left');
      } else if (log.state === 'bounce') {
        drawLog(STUMP.x + 200 * s, restY - 160 * s + 900 * s * s, len, r, s * 8, 'right');
      } else {
        drawLog(STUMP.x - 120 * s, restY - 420 * s + 1000 * s * s, len, r, -s * 12, 'right');
      }
      ctx.globalAlpha = 1;
    }
    // キツネ
    const lastToss = this.logs.reduce((a, l) => (l.toss <= beat ? l.toss : a), -9);
    const ts = (beat - lastToss) * spb;
    const arm = ts < 0.07 ? lerp(0.9, -2.3, easeOut(ts / 0.07)) : ts < 0.4 ? lerp(-2.3, 0.9, easeOut((ts - 0.07) / 0.33)) : 0.9 - (holding ? 0.6 : 0);
    drawFox(230, 452, 1, { bob: pulse, arm, hold: holding && ts > 0.12, blink: (clock % 3.3) < 0.12 });
    // クマ（大きい丸太が飛んでいるあいだは高く振りかぶる）
    const windup = this.logs.some(l => l.big && l.state === 'fly' && beat > l.toss + 0.4 && beat < l.land + 0.1);
    const rest = windup ? -0.55 : -1.2;
    const sw = (beat - this.swing) * spb;
    const axe = sw < 0.06 ? lerp(rest, -3.62, easeIn(sw / 0.06)) : sw < 0.36 ? lerp(-3.62, rest, easeOut((sw - 0.06) / 0.3)) : rest + pulse * 0.05;
    const moodOn = (beat - this.moodT) * spb < 0.6 ? this.mood : null;
    drawBear(706, 454, 1, { bob: pulse, axe, mood: moodOn, blink: (clock % 4.1) < 0.12 });
  },
};

// ============================================================
//  ゲーム2：ふくろうの灯り
//  長老が1小節ぶん鳴いたリズムを、次の小節でそっくりまねする
// ============================================================
const ROPE = [{ x0: 40, x1: 440 }, { x0: 520, x1: 920 }];
function lanternPos(side, slot) {
  const r = ROPE[side], x = r.x0 + 30 + slot * 48.5, t = (x - r.x0) / (r.x1 - r.x0);
  return { x, y: 92 + 70 * t * (1 - t) + 26 };
}
const OWLS = {
  id: 'owl', icon: '🦉', adviser: '🦉', title: 'ふくろうの灯り',
  sub: '長老ふくろうの「ホー」のリズムを、次の小節でまねして灯をともそう',
  bpm: 100,
  popAt: { x: 720, y: 250 },
  song: {
    bars: 33, rim: true,
    prog: [[45, 'min'], [41, 'maj'], [48, 'maj'], [43, 'maj']],
    energy: b => b < 2 ? 0 : b === 32 ? 3 : b === 31 || b === 14 ? 1 : b >= 15 ? 2 : 1,
  },
  // [長老が鳴く小節, 8分音符の位置(0〜7)] → 次の小節がプレイヤーの番
  calls: [
    [2, [0, 2, 4]], [4, [0, 2, 4, 6]], [6, [0, 2, 4]], [8, [0, 1, 2]], [10, [0, 2, 3, 4]], [12, [0, 2, 4, 6]],
    [15, [0, 3, 4]], [17, [0, 1, 2, 4]], [19, [0, 3, 6]], [21, [2, 4, 6]], [23, [0, 1, 2, 3, 4]],
    [25, [0, 2, 3, 5, 6]], [27, [1, 3, 5]], [29, [0, 2, 4, 5, 6]],
  ],
  banners: [
    [0, '長老ふくろうが「ホー」と鳴いたリズムを…', 4],
    [4, `次の小節で、そっくりまねして${KEY_LABEL}！`, 4],
    [56, 'ここからリズムがひねってくるぞ', 4],
  ],
  setup(c) {
    this.list = []; this.young = -9; this.squawk = -9;
    this.calls.forEach(([bar, slots], ci) => {
      const call = { bar, slots, mine: {} };
      slots.forEach(s => {
        c.at(bar * 4 + s * 0.5, t => SFX.hoot(t, 1, 0.42));
        c.addTarget((bar + 1) * 4 + s * 0.5, ci < 6 ? 'basic' : 'tricky', { call, slot: s });
      });
      this.list.push(call);
    });
    this.banners.forEach(b => c.banner(...b));
  },
  onPress(beat) { this.young = beat; },
  onHit(tg, grade, beat) {
    const { call, slot } = tg.obj, t = AC.currentTime, p = lanternPos(1, slot);
    call.mine[slot] = grade;
    if (grade === 'near') { SFX.hoot(t, 1.3, 0.25); burst('smoke', p.x, p.y, 4, { speed: 30, life: 0.8, size: 8, color: 'rgba(180,190,220,.5)' }); return; }
    SFX.hoot(t, 1.4, 0.4);
    if (grade === 'just') SFX.chime(t, 84 + slot);
    burst('star', p.x, p.y, grade === 'just' ? 7 : 4, { speed: 120, life: 0.6, size: 7, color: grade === 'just' ? '#ffe28a' : '#bff4ff' });
    ring(p.x, p.y, grade === 'just' ? 'rgba(255,220,130,.9)' : 'rgba(190,240,255,.7)', 44);
  },
  onWhiff(beat) {
    this.squawk = beat; SFX.squawk(AC.currentTime);
    burst('feather', 720, 330, 3, { speed: 60, life: 1.2, size: 6, color: '#d8c3a5' });
  },
  onMiss(tg) {
    const { call, slot } = tg.obj, p = lanternPos(1, slot);
    call.mine[slot] = 'miss';
    burst('smoke', p.x, p.y, 5, { speed: 30, life: 0.9, size: 9, color: 'rgba(160,170,200,.45)' });
  },
  comments(st) {
    const out = [], k = st.byKind;
    if (failRate(k.basic) > 0.25) out.push('長老と同じ数だけ、同じ間隔で鳴くのがコツ');
    if (failRate(k.tricky) > 0.3) out.push('拍と拍のあいだ（ウラ拍）のリズムは、頭の中で「1と2と…」と数えよう');
    return out;
  },
  draw(beat) {
    const pulse = Math.pow(1 - (((beat % 1) + 1) % 1), 3) * (beat > 0 ? 1 : 0);
    drawSky([[0, '#060a24'], [0.5, '#111c4a'], [0.85, '#24346e']]);
    drawStars(1); drawAurora(1, 165);
    glow(480, 70, 120, 'rgba(255,245,210,A)', 0.35);
    ell(480, 70, 34, 34); fill('#fff6dc');
    ell(470, 62, 7, 7); fill('rgba(220,205,170,.6)'); ell(492, 80, 5, 5); ctx.fill();
    drawRidge(RIDGE_FAR, '#1d2a5c', '#9fb3e8', 190, 340);
    drawForest(['#16214a', '#0f1838'], '#b8c8f0', 440);
    drawGround(432, '#c9d6f5', '#8193c8');
    // 枝
    for (const [x0, x1, y] of [[-20, 330, 392], [980, 620, 400]]) {
      ctx.beginPath(); ctx.moveTo(x0, y + 10); ctx.quadraticCurveTo((x0 + x1) / 2, y - 6, x1, y);
      ctx.lineCap = 'round'; stroke('#4a3324', 18);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.quadraticCurveTo((x0 + x1) / 2, y - 16, x1 - (x1 - x0) * 0.04, y - 9); stroke('#eef3ff', 7);
    }
    // いまの出題
    let cur = null;
    for (const c of this.list) if (c.bar * 4 - 0.5 <= beat) cur = c;
    const myTurn = cur && beat >= (cur.bar + 1) * 4 - 0.25 && beat < (cur.bar + 2) * 4;
    const fade = cur ? clamp(((cur.bar + 2) * 4 + 1 - beat) / 1, 0, 1) : 0;
    // ロープとちょうちん
    for (let side = 0; side < 2; side++) {
      const r = ROPE[side];
      ctx.beginPath(); ctx.moveTo(r.x0, 92); ctx.quadraticCurveTo((r.x0 + r.x1) / 2, 162, r.x1, 92);
      stroke(side === 1 && myTurn ? 'rgba(191,244,255,.9)' : 'rgba(230,220,200,.55)', side === 1 && myTurn ? 3 : 2);
      for (let s = 0; s < 8; s++) {
        const p = lanternPos(side, s);
        let lit = 0, color = '255,200,110', dead = false;
        if (cur && fade > 0) {
          if (side === 0 && cur.slots.includes(s)) {
            const eb = cur.bar * 4 + s * 0.5;
            if (beat >= eb) lit = fade * (0.85 + 0.15 * easeOut(1 - (beat - eb) * 2));
          }
          if (side === 1) {
            const g = cur.mine[s];
            if (g === 'just' || g === 'good') { lit = fade; color = g === 'just' ? '255,226,140' : '191,244,255'; }
            else if (g) dead = true;
          }
        }
        drawLantern(p.x, p.y, lit, color, dead, s % 2 === 1, beat);
      }
    }
    // フクロウ
    const elderHoot = cur ? Math.max(0, ...cur.slots.map(s => { const d = (beat - (cur.bar * 4 + s * 0.5)) * S.spb; return d >= 0 && d < 0.25 ? 1 - d / 0.25 : 0; })) : 0;
    const yd = (beat - this.young) * S.spb, youngHoot = yd >= 0 && yd < 0.25 ? 1 - yd / 0.25 : 0;
    const elderTurn = cur && beat >= cur.bar * 4 - 0.5 && beat < (cur.bar + 1) * 4 - 0.25;
    drawOwl(250, 392, 1.25, { body: '#8d7b6a', dark: '#6a5a4c', belly: '#d9cbb6', face: '#c9b8a2', eye: elderTurn || elderHoot ? 1 : 0.15, hoot: elderHoot, bob: pulse, glasses: true, brow: true, look: 3 });
    const sq = (beat - this.squawk) * S.spb < 0.4;
    drawOwl(720, 400, 1, { body: '#b98f63', dark: '#946c48', belly: '#f1e2c8', face: '#e3cfae', eye: sq ? 0 : myTurn || youngHoot ? 1 : 0.7, hoot: Math.max(youngHoot, sq ? 0.5 : 0), bob: pulse, look: -3 });
    if (myTurn) {
      ctx.globalAlpha = 0.5 + 0.5 * pulse;
      ctx.font = `800 ${portrait ? 30 : 18}px "M PLUS Rounded 1c", sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#bff4ff';
      ctx.fillText('きみの番！', 720, portrait ? 262 : 270);
      ctx.globalAlpha = 1;
    }
  },
};
function drawLantern(x, y, lit, color, dead, small, beat) {
  ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 14); stroke('rgba(230,220,200,.5)', 1.5);
  const sway = Math.sin(clock * 1.5 + x * 0.05) * 0.06;
  ctx.save(); ctx.translate(x, y - 14); ctx.rotate(sway); ctx.translate(-x, -(y - 14));
  if (lit > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(x, y, 58, `rgba(${color},A)`, 0.8 * lit); ctx.restore();
  }
  const w = small ? 15 : 19, h = small ? 21 : 26;
  rr(x - w / 2 - 2, y - h / 2 - 3, w + 4, 4, 2); fill('#3a2a20');
  rr(x - w / 2 - 2, y + h / 2 - 1, w + 4, 4, 2); fill('#3a2a20');
  ell(x, y, w / 2 + 2, h / 2);
  fill(lit > 0 ? `rgba(${color},${0.5 + 0.5 * lit})` : dead ? 'rgba(60,62,84,.95)' : 'rgba(40,34,56,.75)');
  if (lit > 0) { ell(x - w * 0.15, y - h * 0.12, w * 0.22, h * 0.25); fill(`rgba(255,255,240,${0.7 * lit})`); }
  ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y); stroke('rgba(60,40,30,.35)', 1);
  if (dead) { ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.lineCap = 'round'; stroke('#ff8a96', 2.5); }
  ctx.restore();
}

const GAMES = { lumber: LUMBER, owl: OWLS };
function failRate(k) { return k && k.n ? k.fail / k.n : 0; }

// ============================================================
//  進行管理（スケジュール・判定・採点）
// ============================================================
const WIN = { just: 0.045, good: 0.09, near: 0.14 };
const GRADE = {
  just: { label: 'ジャスト！', color: '#ffd76a', pts: 100 },
  good: { label: 'ナイス', color: '#bff4ff', pts: 75 },
  near: { label: 'おしい', color: '#a9b8de', pts: 30 },
  miss: { label: 'ミス', color: '#ff8a96', pts: 0 },
};
const S = { scene: 'title', def: null, t0: 0, spb: 0.5, items: [], idx: 0, targets: [], banners: [], extras: 0, endBeat: 0, frozen: 0, shake: 0, fade: 0 };

function beginSchedule(bpm) {
  initAudio(); hushAudio();
  S.spb = 60 / bpm; S.t0 = AC.currentTime + 0.5;
  S.items = []; S.idx = 0;
}
function pushAt(time, fn) { S.items.push({ time, fn }); }
function pump() {
  if (!AC) return;
  const horizon = AC.currentTime + 0.2;
  while (S.idx < S.items.length && S.items[S.idx].time < horizon) {
    const it = S.items[S.idx++];
    it.fn(Math.max(it.time, AC.currentTime));
  }
}
setInterval(() => { if (S.scene === 'play' || S.scene === 'calib') pump(); }, 20);
const nowBeat = () => (heardAt(performance.now()) - S.t0) / S.spb;

function startGame(def) {
  beginSchedule(def.bpm);
  S.def = def; S.targets = []; S.banners = []; S.extras = 0;
  FX.length = 0; POPS.length = 0;
  scheduleSong(def.song, S.t0, S.spb, pushAt);
  def.setup({
    at: (beat, fn) => pushAt(S.t0 + beat * S.spb, fn),
    addTarget: (beat, kind, obj) => { const tg = { beat, time: S.t0 + beat * S.spb, kind, obj, grade: null }; S.targets.push(tg); return tg; },
    banner: (beat, text, dur) => S.banners.push({ beat, text, dur }),
  });
  S.items.sort((a, b) => a.time - b.time);
  S.targets.sort((a, b) => a.time - b.time);
  S.endBeat = (def.song.bars - 1) * 4 + 3;
  S.scene = 'play'; S.fade = 1;
  ui.innerHTML = '';
}

function press(perfMs) {
  if (S.scene === 'calib') { S.calTaps.push(heardAt(perfMs)); ring(W / 2, 290, 'rgba(191,244,255,.9)', 120); return; }
  if (S.scene !== 'play') return;
  const heard = heardAt(perfMs) - offsetMs / 1000;
  const beat = (heard - S.t0) / S.spb;
  let best = null, bd = 0;
  for (const tg of S.targets) {
    if (tg.grade) continue;
    const d = heard - tg.time;
    if (Math.abs(d) <= WIN.near && (!best || Math.abs(d) < Math.abs(bd))) { best = tg; bd = d; }
    if (tg.time > heard + WIN.near) break;
  }
  S.def.onPress(beat);
  if (!best) { S.extras++; S.def.onWhiff(beat); pop('からぶり', S.def.popAt.x, S.def.popAt.y, '#a9b8de'); return; }
  const ad = Math.abs(bd);
  best.grade = ad <= WIN.just ? 'just' : ad <= WIN.good ? 'good' : 'near';
  best.d = bd;
  if (IS_SP && navigator.vibrate) navigator.vibrate(best.grade === 'just' ? 18 : 8);
  S.def.onHit(best, best.grade, beat);
  pop(GRADE[best.grade].label, S.def.popAt.x, S.def.popAt.y, GRADE[best.grade].color);
}

function checkMisses() {
  const heard = heardAt(performance.now()) - offsetMs / 1000;
  for (const tg of S.targets) {
    if (tg.time > heard) break;
    if (!tg.grade && heard - tg.time > WIN.near) {
      tg.grade = 'miss';
      S.def.onMiss(tg, (heard - S.t0) / S.spb);
      pop(GRADE.miss.label, S.def.popAt.x, S.def.popAt.y, GRADE.miss.color);
    }
  }
}

function finish() {
  const st = { n: S.targets.length, just: 0, good: 0, near: 0, miss: 0, extras: S.extras, byKind: {} };
  let pts = 0, dSum = 0, dN = 0;
  for (const tg of S.targets) {
    const g = tg.grade || 'miss';
    st[g]++; pts += GRADE[g].pts;
    const k = st.byKind[tg.kind] || (st.byKind[tg.kind] = { n: 0, fail: 0 });
    k.n++; if (g === 'near' || g === 'miss') k.fail++;
    if (g !== 'miss') { dSum += tg.d; dN++; }
  }
  const score = Math.round(clamp(pts / st.n - S.extras * 1.5, 0, 100));
  const meanD = dN ? dSum / dN : 0;
  const comments = S.def.comments(st);
  if (meanD < -0.022) comments.push('ちょっと先走りぎみ。音を聞いてから、ひと呼吸ぶん落ち着いて');
  else if (meanD > 0.022) comments.push('少し遅れぎみ。もうちょっとだけ早めに押してみよう');
  if (S.extras >= 5) comments.push('からぶりが多め。合図が鳴るまでガマン！');
  if (!comments.length) comments.push(score >= 90 ? 'リズム感、ばっちり！ 雪国じゅうに評判が広まった' : 'なかなかの腕前。もう一回でさらに上を目指そう');
  const stars = score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0;
  const label = ['もう一回！', 'まずまず', '上手！', '名人級！'][stars];
  const key = 'yr_best_' + S.def.id, prev = store(key) || 0;
  if (score > prev) store(key, score);
  S.frozen = S.endBeat; S.scene = 'result'; S.resultAt = performance.now();
  showResult({ score, stars, label, comments: comments.slice(0, 3), st, best: Math.max(prev, score), newBest: score > prev && prev > 0 });
  jingle(stars);
}

function quitToMenu() { hushAudio(); showTitle(); }

// ---------- タイミング調整 ----------
function startCalib() {
  beginSchedule(100);
  S.calTaps = [];
  for (let i = 0; i < 16; i++) pushAt(S.t0 + i * S.spb, t => SFX.click(t, i % 4 === 0));
  S.scene = 'calib'; S.fade = 0;
  ui.innerHTML = '';
}
function finishCalib() {
  const ds = [];
  for (const h of S.calTaps) {
    const k = Math.round((h - S.t0) / S.spb);
    const d = h - (S.t0 + k * S.spb);
    if (k >= 4 && k < 16 && Math.abs(d) < 0.25) ds.push(d);
  }
  if (ds.length >= 5) {
    ds.sort((a, b) => a - b);
    offsetMs = Math.round(ds[Math.floor(ds.length / 2)] * 1000);
    store('yr_offset', offsetMs);
    showSettings(`${ds.length}回ぶんのタップから調整しました`);
  } else showSettings('タップが少なかったので、もう一度試してください');
}

// ============================================================
//  描画ループ
// ============================================================
function drawTitleScene(dt) {
  drawSky([[0, '#070b28'], [0.55, '#18245a'], [0.9, '#3b4b8e']]);
  drawStars(1); drawAurora(1.2, 155);
  drawRidge(RIDGE_FAR, '#26336a', '#b4c4f2', 190, 340);
  drawRidge(RIDGE_NEAR, '#1b2656', '#8ea2dc', 300, 400);
  drawForest(['#18234e', '#111a3c'], '#c4d2f4', 440);
  drawGround(430, '#d6e1fa', '#8c9dd0');
  const b = Math.pow(1 - (clock * 1.6 % 1), 3);
  ctx.globalAlpha = 0.95;
  drawFox(150, 500, 0.8, { bob: b, arm: 0.9, blink: (clock % 3.1) < 0.12 });
  drawBear(830, 505, 0.72, { bob: b, axe: -1.2, blink: (clock % 3.7) < 0.12 });
  ctx.globalAlpha = 1;
}
function drawCalibScene() {
  drawSky([[0, '#070b28'], [1, '#202d66']]);
  drawStars(0.8); drawAurora(0.8, 190);
  const beat = nowBeat(), k = Math.floor(beat), ph = beat - k;
  const pulse = beat >= 0 && k < 16 ? Math.pow(1 - ph, 3) : 0;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4f8ff';
  ctx.font = '800 26px "M PLUS Rounded 1c", sans-serif';
  ctx.fillText(k < 4 ? '音を聞いて…' : `カチッに合わせて${KEY_LABEL}`, W / 2, 120);
  ell(W / 2, 290, 60 + pulse * 26, 60 + pulse * 26); fill(`rgba(191,244,255,${0.15 + pulse * 0.5})`);
  ell(W / 2, 290, 54, 54); fill('rgba(20,30,70,.8)');
  ctx.font = '800 44px "M PLUS Rounded 1c", sans-serif'; ctx.fillStyle = '#ffd76a';
  ctx.fillText(beat < 0 ? '…' : k < 4 ? String(k + 1) : k < 16 ? '♪' : '✓', W / 2, 292);
  ctx.font = '500 16px "M PLUS Rounded 1c", sans-serif'; ctx.fillStyle = 'rgba(244,248,255,.7)';
  ctx.fillText(`タップ ${S.calTaps.length} 回`, W / 2, 400);
  if (beat > 16.5) { S.scene = 'title'; finishCalib(); }
}
// 縦持ちのスマホでは、案内はゲーム画面ではなく下のタップ面に大きく出す
const bannerEl = document.getElementById('banner');
function drawBanner(beat) {
  let cur = null, a = 0;
  for (const b of S.banners) {
    if (beat < b.beat || beat > b.beat + b.dur) continue;
    cur = b; a = clamp(Math.min((beat - b.beat) * 3, (b.beat + b.dur - beat) * 3), 0, 1);
  }
  if (portrait && bannerEl) {
    const text = cur ? cur.text : '';
    if (bannerEl.textContent !== text) bannerEl.textContent = text;
    bannerEl.style.opacity = a;
    return;
  }
  if (cur) {
    const b = cur;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, 46 - (1 - a) * 10);
    ctx.font = '800 21px "M PLUS Rounded 1c", sans-serif';
    const w = ctx.measureText(b.text).width + 48;
    rr(-w / 2, -22, w, 44, 22); fill('rgba(12,18,50,.72)');
    rr(-w / 2, -22, w, 44, 22); stroke('rgba(191,244,255,.35)', 1.5);
    ctx.fillStyle = '#f4f8ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.text, 0, 1);
    ctx.restore();
  }
}

const padBtn = document.querySelector('.abtn');
let lastT = performance.now(), lastScene = '';
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; clock += dt;
  if (S.scene !== lastScene) { lastScene = S.scene; document.body.dataset.scene = S.scene; resize(); }
  const k = cv.width / W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (S.shake > 0.1) { ctx.translate(rand(-S.shake, S.shake), rand(-S.shake, S.shake)); S.shake *= Math.pow(0.002, dt); }
  if (S.scene === 'play') {
    pump(); checkMisses();
    const beat = nowBeat();
    S.def.draw(beat);
    drawSnow(dt, 0.8); drawFx(dt); drawBanner(beat); vignette();
    ctx.fillStyle = 'rgba(191,244,255,.5)'; ctx.fillRect(0, H - 3, W * clamp(beat / S.endBeat, 0, 1), 3);
    if (!IS_SP) {
      ctx.font = '500 13px "M PLUS Rounded 1c", sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(244,248,255,.5)'; ctx.fillText('Esc：やめる', W - 14, 12);
    }
    if (padBtn && portrait) padBtn.style.setProperty('--pulse', beat > 0 ? Math.pow(1 - (beat % 1), 3) : 0);
    if (beat >= S.endBeat) finish();
  } else if (S.scene === 'result') {
    S.def.draw(S.frozen); drawSnow(dt, 0.8); drawFx(dt); vignette();
    ctx.fillStyle = 'rgba(5,8,30,.45)'; ctx.fillRect(0, 0, W, H);
  } else if (S.scene === 'calib') {
    pump(); drawCalibScene(); drawFx(dt);
  } else {
    drawTitleScene(dt); drawSnow(dt); vignette();
  }
  if (S.fade > 0) { ctx.fillStyle = `rgba(5,8,30,${S.fade})`; ctx.fillRect(-20, -20, W + 40, H + 40); S.fade = Math.max(0, S.fade - dt * 2); }
  requestAnimationFrame(frame);
}

// ============================================================
//  画面UI（HTML）
// ============================================================
const CAN_FS = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
function toggleFullscreen() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {});
  }
}
const SEP = '<span class="sep">・</span>';
const HINT = IS_SP
  ? `画面のどこをタップしてもOK${SEP}<span class="only-portrait">横向きにすると大きな画面で遊べます${SEP}</span>音が出ないときはマナーモードを解除`
  : `操作：スペース / Enter / Z / クリック${SEP}1・2 キーでスタート${SEP}F で全画面${SEP}Esc でメニューへ`;

function showTitle() {
  S.scene = 'title';
  const cards = Object.values(GAMES).map((g, i) => {
    const best = store('yr_best_' + g.id);
    return `<button class="card" data-act="play" data-game="${g.id}">
      <span class="ico">${g.icon}</span><b>${g.title}</b><small>${g.sub}</small>
      <em>${best != null ? `ベスト ${best}点` : 'まだ遊んでいません'}</em><kbd class="key">${i + 1}</kbd></button>`;
  }).join('');
  ui.innerHTML = `<div class="menu">
    <h1 class="logo">ゆきあかりリズム<small>SNOWLIGHT RHYTHM</small></h1>
    <p class="tag">雪国のリズム・ミニゲーム集　— 音をよく聞いて、ぴったりの瞬間に！</p>
    <div class="cards">${cards}</div>
    <div class="row">
      <button class="btn ghost" data-act="settings">タイミング調整（${offsetMs >= 0 ? '+' : ''}${offsetMs}ms）<kbd>S</kbd></button>
      ${CAN_FS ? '<button class="btn ghost" data-act="fs">全画面<kbd>F</kbd></button>' : ''}
    </div>
    <p class="hint">${HINT}</p>
    <p class="ver">ver ${VERSION}</p>
  </div>`;
}
function showResult(r) {
  const stars = '★'.repeat(r.stars) + `<i>${'★'.repeat(3 - r.stars)}</i>`;
  ui.innerHTML = `<div class="panel">
    <h2>${S.def.icon} ${S.def.title}</h2>
    <div class="score"><b id="scoreNum">0</b><span>点</span></div>
    <div class="stars">${stars}</div>
    <div class="rank">${r.label}</div>
    <ul class="comments">${r.comments.map(c => `<li>${S.def.adviser} ${c}</li>`).join('')}</ul>
    <div class="stats">ジャスト ${r.st.just}　ナイス ${r.st.good}　おしい ${r.st.near}　ミス ${r.st.miss}　からぶり ${r.st.extras}</div>
    <div class="best">${r.newBest ? '🎉 ベスト更新！ ' : ''}ベスト ${r.best}点</div>
    <div class="row"><button class="btn" data-act="retry">もう一回<kbd>Enter</kbd></button><button class="btn ghost" data-act="menu">メニュー<kbd>Esc</kbd></button></div>
  </div>`;
  const el = document.getElementById('scoreNum'), t0 = performance.now();
  (function count(now) {
    const k = clamp((now - t0) / 900, 0, 1);
    el.textContent = Math.round(r.score * easeOut(k));
    if (k < 1 && document.body.contains(el)) requestAnimationFrame(count);
  })(t0);
}
function showSettings(msg = '') {
  S.scene = 'settings';
  ui.innerHTML = `<div class="panel">
    <h2>タイミング調整</h2>
    <p>Bluetoothイヤホンなどで音が遅れて聞こえると、判定がずれます。<br>「自動で調整」でカチッ音に合わせて12回ほどタップしてください。</p>
    <div class="offset" id="offVal">${offsetMs >= 0 ? '+' : ''}${offsetMs}ms</div>
    <input type="range" id="offRange" min="-200" max="300" step="5" value="${offsetMs}">
    <p style="font-size:12px;opacity:.7">プラス＝自分の入力が遅れぎみ扱い（遅めに押しても合う）</p>
    ${msg ? `<p style="color:var(--gold);margin-top:6px">${msg}</p>` : ''}
    <div class="row"><button class="btn" data-act="calib">自動で調整</button><button class="btn ghost" data-act="menu">もどる<kbd>Esc</kbd></button></div>
  </div>`;
  document.getElementById('offRange').addEventListener('input', e => {
    offsetMs = +e.target.value; store('yr_offset', offsetMs);
    document.getElementById('offVal').textContent = `${offsetMs >= 0 ? '+' : ''}${offsetMs}ms`;
  });
}

ui.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'play') startGame(GAMES[b.dataset.game]);
  else if (act === 'retry') startGame(S.def);
  else if (act === 'menu') quitToMenu();
  else if (act === 'settings') showSettings();
  else if (act === 'calib') startCalib();
  else if (act === 'fs') toggleFullscreen();
});

// ---------- 入力 ----------
const KEYS = new Set(['Space', 'Enter', 'KeyZ', 'KeyX', 'KeyJ', 'KeyF', 'NumpadEnter']);
const playing = () => S.scene === 'play' || S.scene === 'calib';
// 縦持ちのタップ面のボタンを、押した瞬間に光らせる
function tapFx() {
  if (!padBtn) return;
  padBtn.classList.remove('hit'); void padBtn.offsetWidth; padBtn.classList.add('hit');
}
addEventListener('keydown', e => {
  if (playing()) {
    if (e.code === 'Escape') { quitToMenu(); return; }
    if (!KEYS.has(e.code)) return;
    e.preventDefault();
    if (!e.repeat) { press(evtTime(e)); tapFx(); }
    return;
  }
  if (e.repeat || e.target.closest('input')) return;
  if (e.code === 'Escape' && S.scene !== 'title') { quitToMenu(); return; }
  if (S.scene === 'title') {
    const g = /^(Digit|Numpad)\d$/.test(e.code) && Object.values(GAMES)[+e.code.slice(-1) - 1];
    if (g) startGame(g);
    else if (e.code === 'KeyS') showSettings();
    else if (e.code === 'KeyF' && CAN_FS) toggleFullscreen();
  } else if (S.scene === 'result' && ['Enter', 'Space', 'KeyR'].includes(e.code)) {
    e.preventDefault();
    // 曲の終わりに押しっぱなしだった入力で、すぐにやり直しにならないように少し待つ
    if (performance.now() - S.resultAt > 800) startGame(S.def);
  }
});
addEventListener('pointerdown', e => {
  if (!playing() || e.target.closest('button, input')) return;
  e.preventDefault();
  press(evtTime(e)); tapFx();
}, { passive: false });
addEventListener('contextmenu', e => { if (playing()) e.preventDefault(); });
// iPhone の Safari は user-scalable=no を無視するので、連打（ダブルタップ）やピンチでの拡大をここで止める。
// ボタンやリンクの上だけは止めない（止めるとクリックが発生しなくなる）
if (IS_SP) {
  const onControl = t => t.closest && t.closest('button, input, a');
  const opt = { passive: false, capture: true };
  let lastEnd = 0;
  window.addEventListener('touchstart', e => { if (playing() || e.touches.length > 1) e.preventDefault(); }, opt);
  window.addEventListener('touchmove', e => { if (playing() || e.touches.length > 1) e.preventDefault(); }, opt);
  window.addEventListener('touchend', e => {
    const now = performance.now();
    // プレイ中は全部、メニューでも0.35秒以内の2回目のタップ（＝ダブルタップ）はボタン以外で止める
    if (playing() || (!onControl(e.target) && now - lastEnd < 350)) e.preventDefault();
    lastEnd = now;
  }, opt);
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) window.addEventListener(ev, e => e.preventDefault(), opt);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) quitToMenu(); });

resize();
showTitle();
requestAnimationFrame(frame);
