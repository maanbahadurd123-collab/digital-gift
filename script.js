/* =====================================================================
   DIGITAL GIFT — script.js
   Flow:  GIFT → COUNTDOWN → EXPLOSION → FORMING → HEART → FINAL
   Pure vanilla JS + Canvas. No libraries, no backend, no image files.
   ===================================================================== */
"use strict";

/* =====================================================================
   1. CUSTOMIZATION  — change these values to personalise the gift
   ===================================================================== */
const CONFIG = {

  // ----- Heart -----
  heartColor: "#ff1493",     // any CSS hex colour, or "rainbow"
  heartSize: 220,            // heart width ≈ heartSize × 1.6 px (it shrinks automatically to fit the screen)

  // ----- Particles -----
  particleCount: 1200,        // desktop count (phones/weak devices are reduced automatically)
  particleSize: 2,           // base particle radius in px
  particleGlow: 14,          // halo size around each particle
  autoAdjustParticles: false, // lower the count on small / weak devices
  maxPixelRatio: 2,          // cap for devicePixelRatio (lower = faster)

  // ----- Animation (milliseconds) -----
  countdownSpeed: 900,       // time each number (3, 2, 1) stays on screen
  explosionDuration: 2300,   // burst + floating time before the heart starts forming
  formationDuration: 3500,   // time particles take to assemble the heart
  pulsePeriod: 3800,         // one slow "breath" of the heart
  animationSpeed: 1,         // 1 = normal, 2 = twice as fast, 0.5 = slow motion

  // ----- Glow -----
  glowIntensity: 50,         // 0 – 100

  // ----- Text -----
  introText: "There's a little surprise for you...",
  message: "For the my cute sister❤️",
  secondaryMessage: "BE HAPPY. TAKE CARE",
  showSecondaryMessage: true,

  // ----- Features -----
  enableSound: true,         // false hides the sound button and mutes everything
  enableColorPicker: true,   // false hides the colour presets + picker
  enableTouchInteraction: true,

  // ----- Optional sound files -----
  // Leave "" to use the built-in synthesised sounds. Put a path like "sounds/open.mp3"
  // to use your own file instead. Missing files fall back to the built-in sound.
  soundFiles: { open: "", tick: "", whoosh: "", explosion: "", sparkle: "", form: "", final: "" }
};

/* =====================================================================
   2. SMALL HELPERS
   ===================================================================== */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = (id) => document.getElementById(id);

function hslToRgb(h, s, l) {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}
const RAINBOW = Array.from({ length: 36 }, (_, i) => hslToRgb(i * 10, 1, 0.62)); // 36 hues, 10° apart

function parseColor(c) {
  c = String(c || "").trim();
  if (c[0] === "#") {
    if (c.length === 4) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    const n = parseInt(c.slice(1, 7), 16);
    if (!isNaN(n)) return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return { r: 255, g: 20, b: 147 };
}
const toHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/* =====================================================================
   3. STATE
   ===================================================================== */
const STATE = Object.freeze({
  GIFT: "GIFT", COUNTDOWN: "COUNTDOWN", EXPLOSION: "EXPLOSION",
  FORMING: "FORMING", HEART: "HEART", FINAL: "FINAL"
});

const app = {
  state: STATE.GIFT, stateTime: 0, time: 0, dt: 0.016, last: 0, frame: 0,
  runToken: 0, opening: false, messageShown: false,
  W: 0, H: 0, dpr: 1, quality: 1,
  unit: 10, cx: 0, cy: 0, sizeScale: 1,                 // heart layout (px per heart-unit, centre)
  particles: [], dust: [], dustCap: 300,
  giftRect: { cx: 0, cy: 0, w: 100, h: 100 },
  glow: 0, glowTarget: 0, pulseAmt: 0, pulseTarget: 0, pulsePhase: 0, pulse01: 0, heartScale: 1,
  acc: { mote: 0, spark: 0, rise: 0, leave: 0 },
  stars: [], specks: [],
  perf: { acc: 0, frames: 0, drops: 0 }
};

// Colour manager: `cur` glides smoothly toward `target`; rainbow blends in/out with `mix`.
const color = {
  cur: { r: 255, g: 20, b: 147 }, target: { r: 255, g: 20, b: 147 },
  rainbow: false, mix: 0,
  ui: { r: 255, g: 20, b: 147 }, uiKey: -1, uiSet: 0
};

const pointer = { x: 0, y: 0, active: false, down: false };
const dom = {};
let fx, ctx, bgCv, bgCtx;

/* =====================================================================
   4. HEART MATHS   x = 16 sin³t,  y = 13cos t − 5cos 2t − 2cos 3t − cos 4t
   ===================================================================== */
const HEART_CY = 2.5; // vertical centre of the curve (it spans y ≈ −17 … +12)

function heartPoint(t) {
  return {
    x: 16 * Math.pow(Math.sin(t), 3),
    y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
  };
}

// Pre-computed outline (re-centred so (0,0) is the middle of the heart) + cumulative length
// so we can pick points evenly along the edge.
const heartPts = [];
const heartCum = [];
let heartLen = 0;
(function buildHeartLUT() {
  const N = 720;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const p = heartPoint((i / N) * TAU);
    const q = { x: p.x, y: p.y + HEART_CY };
    if (prev) heartLen += Math.hypot(q.x - prev.x, q.y - prev.y);
    heartPts.push(q); heartCum.push(heartLen); prev = q;
  }
})();

function sampleHeartEdge() {
  const u = Math.random() * heartLen;
  let lo = 0, hi = heartCum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (heartCum[mid] < u) lo = mid + 1; else hi = mid; }
  return heartPts[lo];
}

/** Target positions (in heart units, relative to the heart centre) for `n` particles. */
function createHeartTargets(n) {
  const out = new Array(n);
  const edgeCount = Math.floor(n * 0.58);          // ~58 % trace the outline, the rest fill the inside
  for (let i = 0; i < n; i++) {
    const e = sampleHeartEdge();
    const r = i < edgeCount ? 1 - Math.pow(Math.random(), 3) * 0.09 : Math.sqrt(Math.random()) * 0.93;
    const hx = e.x * r, hy = e.y * r;
    out[i] = { hx, hy, hue: (Math.atan2(hy, hx) / TAU + 0.5) * 360 };
  }
  return out;
}

/* =====================================================================
   5. SPRITES — pre-rendered glowing dots (much faster than shadowBlur)
   ===================================================================== */
const spriteCache = new Map();

function getSprite(r, g, b) {
  const q = (v) => Math.min(255, Math.round(v / 12) * 12);
  r = q(r); g = q(g); b = q(b);
  const key = (r << 16) | (g << 8) | b;
  let sp = spriteCache.get(key);
  if (sp) return sp;
  if (spriteCache.size > 500) spriteCache.clear();

  const s = 64, cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const c = cv.getContext("2d");
  const white = (a) => `rgba(${Math.round(lerp(r, 255, a))},${Math.round(lerp(g, 255, a))},${Math.round(lerp(b, 255, a))},`;
  const grd = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, white(0.95) + "1)");        // white-hot core
  grd.addColorStop(0.14, white(0.7) + "0.95)");
  grd.addColorStop(0.38, `rgba(${r},${g},${b},0.5)`); // coloured halo
  grd.addColorStop(0.7, `rgba(${r},${g},${b},0.12)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = grd; c.fillRect(0, 0, s, s);
  spriteCache.set(key, cv);
  return cv;
}

/* =====================================================================
   6. SOUND  (synthesised with Web Audio — works with no audio files)
   ===================================================================== */
const audio = { ctx: null, master: null, enabled: false, noiseBuf: null };

function initAudio() {
  if (!CONFIG.enableSound) return;
  try {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.55;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === "suspended") audio.ctx.resume();
  } catch (e) { /* audio is optional */ }
}

function tone(freq, dur, o = {}) {
  const ac = audio.ctx; if (!ac) return;
  const t0 = ac.currentTime + (o.delay || 0);
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = o.type || "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol || 0.15, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(audio.master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise(dur, o = {}) {
  const ac = audio.ctx; if (!ac) return;
  if (!audio.noiseBuf) {
    audio.noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = audio.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ac.currentTime + (o.delay || 0);
  const src = ac.createBufferSource(); src.buffer = audio.noiseBuf;
  const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = o.q || 1.2;
  f.frequency.setValueAtTime(o.from || 400, t0);
  f.frequency.exponentialRampToValueAtTime(o.to || 3000, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t0 + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(audio.master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

function synth(name, param) {
  switch (name) {
    case "open":    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.45, { type: "triangle", vol: 0.1, delay: i * 0.09 })); break;
    case "tick":    tone(param === 1 ? 1175 : 880, 0.18, { vol: 0.16 }); break;
    case "whoosh":  noise(0.9, { vol: 0.2, from: 300, to: 3500 }); break;
    case "explosion":
      noise(1.2, { vol: 0.42, from: 2600, to: 180 });
      tone(150, 0.9, { vol: 0.45, slideTo: 40 });
      for (let i = 0; i < 6; i++) tone(rand(1200, 2600), 0.4, { type: "triangle", vol: 0.05, delay: 0.1 + i * 0.07 });
      break;
    case "sparkle": for (let i = 0; i < 4; i++) tone(rand(1500, 3000), 0.3, { type: "triangle", vol: 0.05, delay: i * 0.08 }); break;
    case "form":    tone(220, 3, { vol: 0.07, slideTo: 660 }); noise(2.4, { vol: 0.06, from: 300, to: 2400 }); break;
    case "final":   [523, 659, 784, 1047].forEach((f, i) => tone(f, 2.4, { type: "triangle", vol: 0.08, delay: i * 0.14 })); break;
  }
}

function playSound(name, param) {
  if (!audio.enabled) return;
  const file = CONFIG.soundFiles && CONFIG.soundFiles[name];
  if (file) {
    try {
      const a = new Audio(file); a.volume = 0.7;
      a.play().catch(() => synth(name, param));   // missing file → built-in sound
      return;
    } catch (e) { /* fall through */ }
  }
  synth(name, param);
}

function toggleSound() {
  audio.enabled = !audio.enabled;
  if (audio.enabled) { initAudio(); playSound("sparkle"); }
  updateSoundButton();
}

function updateSoundButton() {
  dom.soundBtn.setAttribute("aria-pressed", String(audio.enabled));
  dom.soundBtn.setAttribute("aria-label", audio.enabled ? "Sound on" : "Sound off");
  dom.soundIcon.textContent = audio.enabled ? "🔊" : "🔇";
}

/* =====================================================================
   7. COLOUR
   ===================================================================== */
function changeHeartColor(value, instant) {
  if (value === "rainbow") {
    color.rainbow = true;
    if (instant) color.mix = 1;
  } else {
    color.rainbow = false;
    CONFIG.heartColor = value;
    color.target = parseColor(value);
    if (instant) Object.assign(color.cur, color.target);
  }
  syncColorUI(value);
}

function syncColorUI(value) {
  const t = value === "rainbow" ? null : parseColor(value);
  dom.swatches.forEach((b) => {
    const v = b.dataset.color;
    let on = false;
    if (value === "rainbow") on = v === "rainbow";
    else if (v !== "rainbow") { const c = parseColor(v); on = c.r === t.r && c.g === t.g && c.b === t.b; }
    b.setAttribute("aria-pressed", String(on));
  });
  if (t) dom.picker.value = toHex(t);
}

function updateColor(dt) {
  const k = 1 - Math.exp(-dt * 4);
  const c = color.cur, t = color.target;
  c.r += (t.r - c.r) * k; c.g += (t.g - c.g) * k; c.b += (t.b - c.b) * k;
  color.mix += ((color.rainbow ? 1 : 0) - color.mix) * k;

  // Colour used for glow + CSS variables
  const u = color.ui;
  if (color.mix > 0.003) {
    const rc = RAINBOW[Math.floor(((app.time * 40) % 360) / 10) % 36];
    u.r = lerp(c.r, rc.r, color.mix); u.g = lerp(c.g, rc.g, color.mix); u.b = lerp(c.b, rc.b, color.mix);
  } else { u.r = c.r; u.g = c.g; u.b = c.b; }

  const key = (Math.round(u.r) << 16) | (Math.round(u.g) << 8) | Math.round(u.b);
  const now = performance.now();
  if (key !== color.uiKey && now - color.uiSet > 50) {
    color.uiKey = key; color.uiSet = now;
    const s = document.documentElement.style;
    s.setProperty("--hr", Math.round(u.r)); s.setProperty("--hg", Math.round(u.g)); s.setProperty("--hb", Math.round(u.b));
    s.setProperty("--heart", `rgb(${Math.round(u.r)},${Math.round(u.g)},${Math.round(u.b)})`);
  }
}

/* =====================================================================
   8. CANVAS SETUP + LAYOUT
   ===================================================================== */
function resizeCanvases() {
  app.W = window.innerWidth; app.H = window.innerHeight;
  app.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio) * app.quality;
  fx.width = Math.round(app.W * app.dpr); fx.height = Math.round(app.H * app.dpr);
  bgCv.width = app.W; bgCv.height = app.H;          // background is soft, so 1× is plenty
  app.dustCap = Math.floor((app.W < 600 ? 220 : 420) * app.quality);
  layoutHeart();
  buildStars();
  cacheGiftRect();
}

/** Work out how big the heart can be and where it sits (leaves room for message + buttons). */
function layoutHeart() {
  const reserve = clamp(app.H * 0.27, 140, 230);
  const areaH = Math.max(160, app.H - reserve - 28);
  const maxW = Math.min(CONFIG.heartSize * 1.6, app.W * 0.82);
  app.unit = Math.max(2, Math.min(maxW / 32, (areaH * 0.97) / 29));   // heart is 32 wide × 29 tall (units)
  app.cx = app.W / 2;
  app.cy = 14 + areaH / 2;
  app.sizeScale = clamp(app.unit / 11, 0.6, 1.35);
  document.documentElement.style.setProperty("--cy", app.cy + "px");
}

function getParticleCount() {
  let n = CONFIG.particleCount;
  if (CONFIG.autoAdjustParticles) {
    const small = Math.min(app.W, app.H) < 560 || app.W * app.H < 420000;
    const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2;
    if (small) n = Math.min(n, 420);
    else if (weak) n = Math.min(n, 520);
    if (small && weak) n = Math.min(n, 280);
  }
  return Math.max(120, Math.round(n));
}

function cacheGiftRect() {
  if (!dom.giftBox) return;
  const r = dom.giftBox.getBoundingClientRect();
  if (!r.width) return;
  app.giftRect = { cx: r.left + r.width / 2, cy: r.top + r.height * 0.55, w: r.width * 0.85, h: r.height * 0.7 };
}

/* =====================================================================
   9. BACKGROUND (stars + drifting dust)
   ===================================================================== */
function buildStars() {
  const n = Math.round(clamp((app.W * app.H) / 9000, 70, 170));
  app.stars = Array.from({ length: n }, () => ({
    x: Math.random(), y: Math.random(), s: Math.random() < 0.12 ? 2 : 1,
    a: rand(0.35, 1), sp: rand(0.6, 2.2), ph: rand(0, TAU), tint: Math.random() < 0.25
  }));
  app.specks = Array.from({ length: 34 }, () => ({
    x: Math.random(), y: Math.random(), v: rand(4, 14), r: rand(1, 2.2), a: rand(0.1, 0.3), sw: rand(0.3, 1), ph: rand(0, TAU)
  }));
}

function drawBackground() {
  const W = app.W, H = app.H, t = app.time, dt = app.dt;
  bgCtx.clearRect(0, 0, W, H);
  for (const s of app.stars) {
    const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
    bgCtx.globalAlpha = 0.12 + 0.6 * tw * s.a;
    bgCtx.fillStyle = s.tint ? "#ffd6f2" : "#ffffff";
    bgCtx.fillRect(s.x * W, s.y * H, s.s, s.s);
  }
  bgCtx.fillStyle = "#d9b8ff";
  for (const s of app.specks) {
    s.y -= (s.v * dt) / H;
    if (s.y < -0.01) { s.y = 1.01; s.x = Math.random(); }
    const x = s.x * W + Math.sin(t * s.sw + s.ph) * 10;
    bgCtx.globalAlpha = s.a;
    bgCtx.beginPath(); bgCtx.arc(x, s.y * H, s.r, 0, TAU); bgCtx.fill();
  }
  bgCtx.globalAlpha = 1;
}

/* =====================================================================
   10. GIFT SEQUENCE:  open → countdown → explode
   ===================================================================== */
const scaled = (ms) => ms / Math.max(0.1, CONFIG.animationSpeed);

/** Resolves true after `ms`, or false if the experience was reset in the meantime. */
function wait(ms, token) {
  return new Promise((res) => setTimeout(() => res(token === app.runToken), scaled(ms)));
}
/** Run `fn` later unless the experience was reset. */
function after(ms, fn) {
  const t = app.runToken;
  setTimeout(() => { if (t === app.runToken) fn(); }, scaled(ms));
}

function setState(s) {
  app.state = s; app.stateTime = 0;
  document.body.dataset.state = s;
}

function createGift() {
  // The gift itself is HTML/CSS (see index.html + style.css); here we just make sure it is in its start pose.
  dom.gift.classList.remove("shake", "ribbon-glow", "open", "charging", "overload", "gone");
  dom.gift.style.visibility = "";
  dom.gift.style.setProperty("--charge", 0);
  dom.gift.style.animation = "none"; void dom.gift.offsetWidth; dom.gift.style.animation = "";  // replay fade-in
}

async function openGift() {
  if (app.state !== STATE.GIFT || app.opening) return;
  app.opening = true;
  const token = app.runToken;
  initAudio();
  playSound("open");
  cacheGiftRect();
  dom.scene.classList.add("opening");

  dom.gift.classList.add("shake");                       if (!(await wait(700, token))) return;
  dom.gift.classList.add("ribbon-glow");                 if (!(await wait(500, token))) return;
  dom.gift.classList.add("open"); playSound("whoosh");   if (!(await wait(850, token))) return;
  document.body.classList.add("dim");
  dom.gift.classList.add("charging");                    if (!(await wait(900, token))) return;
  startCountdown(token);
}

async function startCountdown(token) {
  setState(STATE.COUNTDOWN);
  for (let n = 3; n >= 1; n--) {
    showCount(n);
    playSound("tick", n);
    dom.gift.style.setProperty("--charge", (4 - n) / 3);   // gift glows brighter each second
    if (!(await wait(CONFIG.countdownSpeed, token))) return;
  }
  dom.countdown.textContent = "";
  if (!(await wait(rand(200, 500), token))) return;        // tiny dramatic pause
  explodeGift(token);
}

function showCount(n) {
  dom.countdown.textContent = "";
  const span = document.createElement("span");
  span.textContent = n;
  span.className = "tick";
  span.style.setProperty("--dur", scaled(CONFIG.countdownSpeed) + "ms");
  dom.countdown.appendChild(span);
}

async function explodeGift(token) {
  // 1. gift becomes blindingly bright and swells
  dom.gift.classList.add("overload");
  playSound("whoosh");
  if (!(await wait(420, token))) return;

  // 2. flash + the gift turns into particles
  cacheGiftRect();
  const origin = Object.assign({}, app.giftRect);
  dom.flash.style.setProperty("--fx", ((origin.cx / app.W) * 100).toFixed(1) + "%");
  dom.flash.style.setProperty("--fy", ((origin.cy / app.H) * 100).toFixed(1) + "%");
  dom.flash.classList.remove("boom"); void dom.flash.offsetWidth; dom.flash.classList.add("boom");
  dom.gift.classList.add("gone");

  setState(STATE.EXPLOSION);
  createParticles(origin);
  spawnDebris(origin);
  playSound("explosion");
  after(700, () => { dom.gift.style.visibility = "hidden"; });
}

/* =====================================================================
   11. PARTICLES
   ===================================================================== */
function createParticles(origin) {
  const n = getParticleCount();
  const targets = createHeartTargets(n);
  const burst = Math.max(app.W, app.H) * 0.95;            // peak speed in px/s
  const P = new Array(n);

  for (let i = 0; i < n; i++) {
    const tg = targets[i];
    const x = origin.cx + rand(-0.5, 0.5) * origin.w;
    const y = origin.cy + rand(-0.5, 0.5) * origin.h;
    const ang = Math.atan2(y - origin.cy, x - origin.cx) + rand(-1.1, 1.1);
    let speed = (0.25 + Math.pow(Math.random(), 0.7) * 0.95) * burst;
    let vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
    let zb = 0;

    const kind = Math.random();
    if (kind < 0.22)      { vy -= burst * rand(0.35, 0.85); }            // shoot upward
    else if (kind < 0.42) { vx *= 1.7; vy *= 0.4; }                      // sideways
    else if (kind < 0.56) { zb = rand(0.8, 2.2); vx *= 1.2; vy *= 1.2; } // toward the camera (grows then settles)
    else if (kind < 0.70) { vx *= 0.25; vy *= 0.25; }                    // stay close and float

    P[i] = {
      x, y, vx, vy,
      hx: tg.hx, hy: tg.hy, hue: tg.hue,                 // heart target + rainbow hue
      size: CONFIG.particleSize * (Math.random() < 0.1 ? rand(1.4, 2.0) : rand(0.55, 1.25)),
      alpha: rand(0.55, 1), bright: rand(0.65, 1.3),
      omega: rand(0.85, 1.2), zeta: rand(0.55, 0.85),    // spring speed + damping (→ slight overshoot)
      delay: Math.random(), hold: rand(0, 0.14),         // formation stagger / explosion ripple
      phase: rand(0, TAU), drift: rand(0.5, 1.5),
      zb, z: 1, blink: Math.random() < 0.12
    };
  }
  app.particles = P;
}

/** Extra short-lived sparks that fade out after the burst. */
function spawnDebris(origin) {
  const count = Math.round(clamp(app.particles.length * 0.4, 80, 320) * (app.W < 600 ? 0.7 : 1));
  const burst = Math.max(app.W, app.H) * 0.95;
  for (let i = 0; i < count; i++) {
    const ang = rand(0, TAU), sp = rand(0.15, 1.1) * burst;
    app.dust.push({
      type: "free", x: origin.cx + rand(-0.5, 0.5) * origin.w, y: origin.cy + rand(-0.5, 0.5) * origin.h,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rand(0, 80), drag: rand(1.2, 2.2),
      age: 0, life: rand(1.2, 3.2), fi: 0.05, fo: 1.0,
      size: Math.random() < 0.1 ? rand(2.4, 3.5) : rand(0.5, 1.6), alpha: rand(0.4, 1),
      hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: rand(2, 5)
    });
  }
}

function beginForming() {
  setState(STATE.FORMING);
  for (const p of app.particles) p.delay = Math.random();
  playSound("form");
}

/** Re-scatter the heart and form it again (no gift replay). */
function newHeart() {
  if (app.state !== STATE.FINAL && app.state !== STATE.HEART) return;
  const P = app.particles;
  const tg = createHeartTargets(P.length);
  const k = Math.max(0.5, app.unit / 10);
  for (let i = 0; i < P.length; i++) {
    const p = P[i], a = rand(0, TAU), sp = rand(250, 650) * k;
    p.hx = tg[i].hx; p.hy = tg[i].hy; p.hue = tg[i].hue;
    p.vx += Math.cos(a) * sp; p.vy += Math.sin(a) * sp;
    p.delay = Math.random(); p.zb = 0;
  }
  setState(STATE.FORMING);
  playSound("sparkle"); playSound("form");
}

function updateParticles(h) {
  const P = app.particles;
  if (!P.length) return;
  const S = app.state;
  const formDur = CONFIG.formationDuration / 1000;
  const stagger = formDur * 0.42;
  const baseOmega = 6 / Math.max(0.8, formDur * 0.55);
  const spring = S === STATE.FORMING || S === STATE.HEART || S === STATE.FINAL;
  const s = app.heartScale, cx = app.cx, cy = app.cy, unit = app.unit, t = app.time;
  const wob = unit * 0.07;
  const zEnv = S === STATE.EXPLOSION ? Math.sin(Math.min(1, app.stateTime / 1.5) * Math.PI) : 0;
  const usePointer = CONFIG.enableTouchInteraction && pointer.active && spring;
  const R = Math.max(60, unit * 6), R2 = R * R;

  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    p.z += ((1 + p.zb * zEnv) - p.z) * Math.min(1, h * 5);

    if (S === STATE.EXPLOSION) {
      if (p.hold > 0) { p.hold -= h; continue; }
      freeFlight(p, h, 1.5);
    } else if (S === STATE.FORMING && app.stateTime < p.delay * stagger) {
      freeFlight(p, h, 2.4);                              // slow down and float until it's this particle's turn
    } else if (spring) {
      // Spring toward the heart target: accelerates, decelerates and overshoots slightly
      const w = p.omega * baseOmega, k = w * w, c = 2 * p.zeta * w;
      const tx = cx + p.hx * unit * s + Math.sin(t * 0.8 + p.phase) * wob;
      const ty = cy - p.hy * unit * s + Math.cos(t * 0.7 + p.phase * 1.3) * wob;
      p.vx += ((tx - p.x) * k - p.vx * c) * h;
      p.vy += ((ty - p.y) * k - p.vy * c) * h;

      if (usePointer) {                                   // finger/mouse gently pushes nearby particles away
        const dx = p.x - pointer.x, dy = p.y - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2), f = 1 - d / R;
          p.vx += (dx / d) * f * f * 4200 * h; p.vy += (dy / d) * f * f * 4200 * h;
        }
      }
      p.x += p.vx * h; p.y += p.vy * h;
    }
  }
}

function freeFlight(p, h, drag) {
  const t = app.time;
  p.vx += Math.sin(t * 0.9 + p.phase) * 40 * p.drift * h;
  p.vy += (Math.cos(t * 0.7 + p.phase * 1.3) * 40 - 8) * p.drift * h;
  const f = Math.exp(-drag * h);
  p.vx *= f; p.vy *= f;
  p.x += p.vx * h; p.y += p.vy * h;
}

/* =====================================================================
   12. AMBIENT "LIVING" PARTICLES (dust)
   ===================================================================== */
function pushDust(d) { if (app.dust.length < app.dustCap) app.dust.push(d); }
const mobileFactor = () => (app.W < 600 ? 0.6 : 1);

function spawnOrbiters() {
  const n = Math.round(38 * mobileFactor());
  for (let i = 0; i < n; i++) {
    app.dust.push({
      type: "orbit", x: app.cx, y: app.cy, age: 0, life: Infinity, fi: 2.5, fo: 0,
      ang: rand(0, TAU), spd: rand(0.08, 0.3) * (Math.random() < 0.5 ? -1 : 1),
      rx: rand(18, 24), ry: rand(17, 22),
      size: rand(0.8, 1.6), alpha: rand(0.5, 0.95), hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: rand(1.5, 3.5)
    });
  }
}

function edgePoint() {
  const e = sampleHeartEdge(), s = app.heartScale;
  return { x: app.cx + e.x * app.unit * s, y: app.cy - e.y * app.unit * s };
}

function spawnAmbient(dt) {
  const S = app.state, a = app.acc, mf = mobileFactor();

  if (S === STATE.GIFT || S === STATE.COUNTDOWN) {          // sparkles around the gift
    const r = app.giftRect;
    if (S === STATE.GIFT) {
      a.mote += dt * 8 * mf;
      while (a.mote >= 1) {
        a.mote--;
        pushDust({
          type: "free", x: r.cx + rand(-0.75, 0.75) * r.w, y: r.cy + rand(-0.2, 0.75) * r.h,
          vx: rand(-6, 6), vy: -rand(14, 38), drag: 0, age: 0, life: rand(2, 3.6), fi: 0.6, fo: 1.2,
          size: rand(0.7, 1.5), alpha: rand(0.4, 0.9), sway: 1.6, hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: 3
        });
      }
    } else {                                                // energy gathers into the gift while counting down
      a.mote += dt * 45 * mf;
      while (a.mote >= 1) {
        a.mote--;
        const ang = rand(0, TAU), dist = Math.max(r.w, r.h) * rand(0.9, 1.8);
        pushDust({
          type: "gather", x: r.cx, y: r.cy, sx: r.cx + Math.cos(ang) * dist, sy: r.cy + Math.sin(ang) * dist * 0.8,
          tx: r.cx, ty: r.cy, age: 0, life: rand(0.6, 1.0), fi: 0.15, fo: 0.2,
          size: rand(0.8, 1.8), alpha: rand(0.6, 1), hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: 0
        });
      }
    }
    return;
  }

  if (S !== STATE.HEART && S !== STATE.FINAL) return;
  if (app.glow < 0.3) return;

  a.spark += dt * 7 * mf;                                   // tiny bright sparks flying off the edge
  while (a.spark >= 1) {
    a.spark--;
    const p = edgePoint(), dx = p.x - app.cx, dy = p.y - app.cy, d = Math.hypot(dx, dy) || 1, sp = rand(40, 130);
    pushDust({
      type: "free", x: p.x, y: p.y, vx: (dx / d) * sp, vy: (dy / d) * sp, drag: 2.2, age: 0, life: rand(0.45, 1.0),
      fi: 0.05, fo: 0.4, size: rand(0.7, 1.5), alpha: 1, hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: 0
    });
  }
  a.rise += dt * 4 * mf;                                    // particles drifting upward
  while (a.rise >= 1) {
    a.rise--;
    const p = edgePoint();
    pushDust({
      type: "free", x: p.x + rand(-8, 8), y: p.y, vx: rand(-6, 6), vy: -rand(20, 55), drag: 0, age: 0, life: rand(2.5, 5),
      fi: 0.6, fo: 1.5, size: rand(0.8, 1.6), alpha: rand(0.6, 0.9), sway: 1.2, hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: 3
    });
  }
  a.leave += dt * 2.5 * mf;                                 // slow tiny particles leaving the heart
  while (a.leave >= 1) {
    a.leave--;
    const p = edgePoint(), dx = p.x - app.cx, dy = p.y - app.cy, d = Math.hypot(dx, dy) || 1, sp = rand(14, 32);
    pushDust({
      type: "free", x: p.x, y: p.y, vx: (dx / d) * sp, vy: (dy / d) * sp - 10, drag: 0.3, age: 0, life: rand(3, 5),
      fi: 0.4, fo: 2, size: rand(0.9, 1.7), alpha: rand(0.5, 0.9), hi: (Math.random() * 36) | 0, ph: rand(0, TAU), tw: 2
    });
  }
}

function updateDust(dt) {
  const D = app.dust, t = app.time;
  for (let i = D.length - 1; i >= 0; i--) {
    const d = D[i];
    d.age += dt;
    if (d.age >= d.life) { D[i] = D[D.length - 1]; D.pop(); continue; }
    if (d.type === "orbit") {
      d.ang += d.spd * dt;
      const sc = app.unit * app.heartScale, w = 1 + 0.04 * Math.sin(t * 0.8 + d.ph);
      d.x = app.cx + Math.cos(d.ang) * d.rx * sc * w;
      d.y = app.cy - Math.sin(d.ang) * d.ry * sc * w;
    } else if (d.type === "gather") {
      const k = d.age / d.life, e = k * k * (3 - 2 * k);
      d.x = d.sx + (d.tx - d.sx) * e; d.y = d.sy + (d.ty - d.sy) * e;
    } else {
      if (d.drag) { const f = Math.exp(-d.drag * dt); d.vx *= f; d.vy *= f; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.sway) d.x += Math.sin(t * d.sway + d.ph) * 12 * dt;
    }
  }
}

/* =====================================================================
   13. PULSE + GLOW AMOUNTS
   ===================================================================== */
function updatePulse(dt) {
  app.glow += (app.glowTarget - app.glow) * Math.min(1, dt * 2.5);
  app.pulseAmt += (app.pulseTarget - app.pulseAmt) * Math.min(1, dt * 1.5);
  app.pulsePhase += (dt * TAU) / (CONFIG.pulsePeriod / 1000);
  app.pulse01 = 0.5 + 0.5 * Math.sin(app.pulsePhase - Math.PI / 2);   // 0 → 1 → 0, very smooth
  app.heartScale = 1 + 0.04 * app.pulseAmt * app.pulse01;              // gentle breathing
}

/* =====================================================================
   14. RENDERING
   ===================================================================== */
function drawHeartGlow() {
  const g = app.glow, u = color.ui, gi = CONFIG.glowIntensity / 30;
  const s = app.heartScale, unit = app.unit, cx = app.cx, cy = app.cy;
  const pg = 0.8 + 0.4 * app.pulse01 * app.pulseAmt;
  const rgba = (a) => `rgba(${Math.round(u.r)},${Math.round(u.g)},${Math.round(u.b)},${clamp(a, 0, 1).toFixed(3)})`;

  // Layered atmosphere: small bright → medium → large soft
  const layers = [[unit * 9, 0.30], [unit * 16, 0.16], [unit * 26, 0.09]];
  for (const [r, a] of layers) {
    const R = r * s;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop(0, rgba(a * g * gi * pg));
    gr.addColorStop(1, rgba(0));
    ctx.globalAlpha = 1; ctx.fillStyle = gr;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }

  // Glowing outline (heart-shaped halo)
  ctx.beginPath();
  for (let i = 0; i < heartPts.length; i += 3) {
    const e = heartPts[i], x = cx + e.x * unit * s, y = cy - e.y * unit * s;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineJoin = "round"; ctx.globalAlpha = 1;
  const passes = [[unit * 2.6, 0.06], [unit * 1.2, 0.10], [unit * 0.45, 0.16], [1.4 * app.sizeScale, 0.30]];
  for (const [lw, a] of passes) {
    ctx.lineWidth = lw; ctx.strokeStyle = rgba(a * g * gi * pg); ctx.stroke();
  }
  if (app.quality > 0.7) {                                     // crisp core with a real blur
    ctx.shadowColor = rgba(0.9); ctx.shadowBlur = CONFIG.glowIntensity * 0.8 * app.dpr;
    ctx.lineWidth = 1.2 * app.sizeScale; ctx.strokeStyle = rgba(0.25 * g * pg);
    ctx.stroke(); ctx.shadowBlur = 0;
  }
}

function drawDust(glowK) {
  const D = app.dust;
  if (!D.length) return;
  const cur = color.cur, rm = color.mix, t = app.time, ss = app.sizeScale;
  const lr = lerp(cur.r, 255, 0.45), lg = lerp(cur.g, 255, 0.45), lb = lerp(cur.b, 255, 0.45);
  const baseSprite = rm < 0.01 ? getSprite(lr, lg, lb) : null;

  for (let i = 0; i < D.length; i++) {
    const d = D[i];
    const fi = d.fi ? Math.min(1, d.age / d.fi) : 1;
    const fo = d.fo ? clamp((d.life - d.age) / d.fo, 0, 1) : 1;
    let a = d.alpha * fi * fo;
    if (d.tw) a *= 0.7 + 0.3 * Math.sin(t * d.tw + d.ph);
    if (a <= 0.01) continue;
    let sp = baseSprite;
    if (!sp) {
      const rc = RAINBOW[(d.hi + Math.floor(t * 4)) % 36];
      sp = getSprite(lerp(lr, rc.r, rm), lerp(lg, rc.g, rm), lerp(lb, rc.b, rm));
    }
    const sz = d.size * ss * 2 * glowK * 0.8;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(sp, d.x - sz / 2, d.y - sz / 2, sz, sz);
  }
}

function drawParticles(glowK) {
  const P = app.particles;
  if (!P.length) return;
  const S = app.state, cur = color.cur, rm = color.mix, t = app.time, ss = app.sizeScale;
  const baseSprite = rm < 0.01 ? getSprite(cur.r, cur.g, cur.b) : null;
  const settled = S === STATE.HEART || S === STATE.FINAL;

  // Glow trails on fast-moving particles (one batched path)
  if (S === STATE.EXPLOSION || S === STATE.FORMING) {
    ctx.globalAlpha = 0.3; ctx.lineWidth = 1.6 * ss; ctx.lineCap = "round";
    ctx.strokeStyle = `rgb(${Math.round(cur.r)},${Math.round(cur.g)},${Math.round(cur.b)})`;
    ctx.beginPath();
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.vx * p.vx + p.vy * p.vy > 6400) { ctx.moveTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.lineTo(p.x, p.y); }
    }
    ctx.stroke();
  }

  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    let a = p.alpha * p.bright * (0.78 + 0.22 * Math.sin(t * 2.4 + p.phase * 5));   // twinkle
    if (settled && p.blink) a *= 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.7 + p.phase * 3)); // some slowly fade in/out
    if (a <= 0.01) continue;

    let sp = baseSprite;
    if (!sp) {
      const rc = RAINBOW[((((p.hue + t * 35) % 360) + 360) % 360 / 10) | 0];
      sp = getSprite(lerp(cur.r, rc.r, rm), lerp(cur.g, rc.g, rm), lerp(cur.b, rc.b, rm));
    }
    const d = p.size * p.z * ss * 2 * glowK;
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(sp, p.x - d / 2, p.y - d / 2, d, d);
  }
}

function render() {
  drawBackground();
  ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  ctx.clearRect(0, 0, app.W, app.H);
  if (!app.particles.length && !app.dust.length) return;

  ctx.globalCompositeOperation = "lighter";                  // additive blending = glowing energy
  const glowK = 1 + CONFIG.particleGlow / 6;
  if (app.glow > 0.01) drawHeartGlow();
  drawDust(glowK);
  drawParticles(glowK);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}

/* =====================================================================
   15. FINAL MESSAGE + CONTROLS
   ===================================================================== */
function showFinalMessage() {
  app.messageShown = true;
  playSound("final");
  dom.final.classList.add("show");
  after(1700, () => dom.controls.classList.add("show"));
}

function toggleColorPanel() {
  const open = dom.panel.hidden;
  dom.panel.hidden = !open;
  document.body.classList.toggle("panel-open", open);
  dom.colorBtn.setAttribute("aria-expanded", String(open));
}
function closeColorPanel() {
  dom.panel.hidden = true;
  document.body.classList.remove("panel-open");
  dom.colorBtn.setAttribute("aria-expanded", "false");
}

/* =====================================================================
   16. RESET / REPLAY
   ===================================================================== */
function resetExperience() {
  app.runToken++;                                            // cancels every pending timer/sequence
  app.opening = false; app.messageShown = false;
  app.particles = []; app.dust = [];
  app.glow = app.glowTarget = app.pulseAmt = app.pulseTarget = 0;
  app.heartScale = 1;
  Object.keys(app.acc).forEach((k) => (app.acc[k] = 0));

  document.body.classList.remove("dim", "heart-on", "panel-open");
  dom.scene.classList.remove("opening");
  dom.final.classList.remove("show");
  dom.controls.classList.remove("show");
  dom.countdown.textContent = "";
  dom.flash.classList.remove("boom");
  closeColorPanel();
  createGift();
  setState(STATE.GIFT);
  cacheGiftRect();
  dom.openBtn.focus({ preventScroll: true });
}
const replayExperience = resetExperience;

/* =====================================================================
   17. MAIN LOOP
   ===================================================================== */
function advanceState(dt) {
  app.stateTime += dt;
  const S = app.state;
  const formDur = CONFIG.formationDuration / 1000;

  if (S === STATE.EXPLOSION) {
    app.glowTarget = 0; app.pulseTarget = 0;
    if (app.stateTime >= CONFIG.explosionDuration / 1000) beginForming();
  } else if (S === STATE.FORMING) {
    const prog = app.stateTime / formDur;
    app.glowTarget = smooth(0.5, 1, prog);
    app.pulseTarget = smooth(0.85, 1.05, prog);
    if (prog > 0.55) document.body.classList.add("heart-on");
    if (app.stateTime >= formDur + 0.2) { setState(STATE.HEART); playSound("sparkle"); }
  } else if (S === STATE.HEART) {
    app.glowTarget = 1; app.pulseTarget = 1;
    if (!app.dust.some((d) => d.type === "orbit")) spawnOrbiters();
    if (app.stateTime >= (app.messageShown ? 0.2 : 0.9)) {
      setState(STATE.FINAL);
      if (!app.messageShown) showFinalMessage();
    }
  } else if (S === STATE.FINAL) {
    app.glowTarget = 1; app.pulseTarget = 1;
  }
}

function monitorPerformance(raw) {
  if (app.state === STATE.GIFT || app.state === STATE.COUNTDOWN) return;
  const pf = app.perf;
  pf.acc += raw; pf.frames++;
  if (pf.frames >= 90) {
    const avg = pf.acc / pf.frames;
    pf.acc = 0; pf.frames = 0;
    if (avg > 0.032 && pf.drops < 3) {                       // running slowly → render at lower resolution
      pf.drops++;
      app.quality = Math.max(0.55, app.quality * 0.82);
      resizeCanvases();
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  let raw = (now - app.last) / 1000;
  app.last = now;
  if (!(raw > 0)) return;
  if (raw > 0.1) raw = 1 / 30;                               // returning from a hidden tab: don't jump
  const dt = raw * CONFIG.animationSpeed;
  app.dt = dt; app.time += dt; app.frame++;

  monitorPerformance(raw);
  advanceState(dt);
  updateColor(raw);
  updatePulse(dt);

  const steps = Math.max(1, Math.ceil(dt / 0.02)), h = dt / steps;
  for (let i = 0; i < steps; i++) updateParticles(h);
  updateDust(dt);
  spawnAmbient(dt);

  if ((app.state === STATE.GIFT || app.state === STATE.COUNTDOWN) && app.frame % 30 === 0) cacheGiftRect();
  render();
}

/* =====================================================================
   18. EVENTS + INIT
   ===================================================================== */
function bindEvents() {
  dom.openBtn.addEventListener("click", openGift);           // Enter / Space work natively on the button
  dom.gift.addEventListener("click", openGift);              // tapping the gift works too
  dom.colorBtn.addEventListener("click", toggleColorPanel);
  dom.replayBtn.addEventListener("click", replayExperience);
  dom.newHeartBtn.addEventListener("click", newHeart);
  dom.soundBtn.addEventListener("click", toggleSound);
  dom.panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (b) changeHeartColor(b.dataset.color);
  });
  dom.picker.addEventListener("input", (e) => changeHeartColor(e.target.value));

  let rt = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(resizeCanvases); });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvases, 250));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeColorPanel(); });

  document.addEventListener("visibilitychange", () => {
    app.last = performance.now();
    if (audio.ctx) { if (document.hidden) audio.ctx.suspend(); else if (audio.enabled) audio.ctx.resume(); }
  });

  // Touch / mouse interaction with the heart (never blocks scrolling or taps)
  const setPtr = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; };
  window.addEventListener("pointerdown", (e) => { pointer.down = true; pointer.active = true; setPtr(e); }, { passive: true });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || pointer.down) { setPtr(e); pointer.active = true; }
  }, { passive: true });
  const release = () => { pointer.down = false; pointer.active = false; };
  window.addEventListener("pointerup", release, { passive: true });
  window.addEventListener("pointercancel", release, { passive: true });
  document.addEventListener("mouseleave", release);
}

function applyConfigToDom() {
  dom.tagline.textContent = CONFIG.introText;
  dom.message.textContent = CONFIG.message;
  const second = CONFIG.showSecondaryMessage && CONFIG.secondaryMessage;
  dom.message2.textContent = second ? CONFIG.secondaryMessage : "";
  dom.message2.hidden = !second;
  dom.colorBtn.hidden = !CONFIG.enableColorPicker;
  dom.soundBtn.hidden = !CONFIG.enableSound;
  audio.enabled = !!CONFIG.enableSound;
  updateSoundButton();
}

function init() {
  ["bg", "fx", "scene", "gift", "giftBox", "tagline", "openBtn", "countdown", "flash", "final", "message", "message2",
   "colorPanel", "colorPicker", "controls", "colorBtn", "replayBtn", "newHeartBtn", "soundBtn", "soundIcon"]
    .forEach((id) => (dom[id] = $(id)));
  dom.panel = dom.colorPanel; dom.picker = dom.colorPicker;
  dom.swatches = Array.from(document.querySelectorAll(".swatch"));

  fx = dom.fx; ctx = fx.getContext("2d");
  bgCv = dom.bg; bgCtx = bgCv.getContext("2d");

  applyConfigToDom();
  changeHeartColor(CONFIG.heartColor, true);
  bindEvents();
  resizeCanvases();
  createGift();
  setState(STATE.GIFT);

  app.last = performance.now();
  requestAnimationFrame(frame);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
