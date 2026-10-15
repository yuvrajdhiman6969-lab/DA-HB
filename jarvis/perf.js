/* perf.js v2 — adaptive performance governor for Discipline OS (mobile first).
   Additive: removes no feature. It
     (1) fixes touch latency,
     (2) holds decorative canvas work while you scroll,
     (3) measures real scroll smoothness against YOUR display's refresh rate (so a 30 fps battery-saver
         phone or a 120 Hz phone is not misjudged) and, only if the phone is genuinely struggling, steps the
         heavy effects (blur, glow, decorative loops) down,
     (4) gives effects back: sustained smooth scrolling steps you up again, and an auto-trimmed phone gets a
         fresh trial after 7 days,
     (5) never fights you: a Lite switch you turned on yourself is never switched off by this file.
   Console / API:  perf.set(0|1|2)  perf.auto(true|false)  perf.status()  perf.reset()  perf.hud(true|false)
                   perf.pause() / perf.resume()  (call pause while a big download or model load is running)
   Add ?perfdebug=1 to the URL for a live frame-time readout. */
(function () {
'use strict';
var W = window, D = document.documentElement, VERSION = 2;

/* ---------- tiny helpers ---------- */
var ls = function (k, v) {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { }
  return null;
};
var num = function (k, d) { var n = parseFloat(ls(k)); return isFinite(n) ? n : d; };
var now = function () { return (W.performance && performance.now) ? performance.now() : Date.now(); };
var DAY = 864e5;

/* ---------- device profile ---------- */
var touch = !!(W.matchMedia && matchMedia('(pointer:coarse)').matches);
var mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
var conn = navigator.connection || {};
var save = !!conn.saveData, slowNet = /(^|-)2g$/.test(conn.effectiveType || '');
var reduced = !!(W.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
var debug = /[?&]perfdebug\b/.test(location.search) || ls('perf_debug') === '1';
if (touch) D.classList.add('fx-touch');
if (touch && (mem <= 4 || cores <= 6 || save || slowNet)) D.classList.add('fx-low');

/* ---------- always-on, visually identical ---------- */
var css = document.createElement('style'); css.id = 'perf-css';
css.textContent =
  'html{touch-action:manipulation}' +                                                              // no 300 ms tap delay anywhere
  'html.fx-touch :is(.modal-overlay,.qotd-overlay){-webkit-backdrop-filter:none!important;backdrop-filter:none!important}' +   // dark overlay hides the blur anyway
  /* mid level: only applied if the phone is measured to be struggling */
  'html.fx-mid *,html.fx-mid *::before,html.fx-mid *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;text-shadow:none!important}' +
  'html.fx-mid nav{background:var(--bg)!important}' +
  'html.fx-mid #fx-canvas{display:none!important}' +
  'html.fx-mid :is(.rx-spin-a,.rx-spin-b,.rx-spin-c,.rx-orbit,.rx-breathe,.stark-hud::after,.sysdot,nav::after,.hero-streak::after,.sys-strip::after){animation:none!important}' +
  /* debug readout */
  '#perf-hud{position:fixed;left:6px;top:calc(6px + env(safe-area-inset-top,0px));z-index:21000;padding:3px 7px;font:600 10px/1.3 ui-monospace,Menlo,monospace;' +
  'color:#9ef;background:rgba(0,8,16,.82);border:1px solid rgba(56,189,248,.4);pointer-events:none;white-space:pre}';
(document.head || D).appendChild(css);

/* ---------- state ---------- */
var level = Math.max(0, Math.min(2, +ls('perf_level') || 0));    // 0 full · 1 mid (no blur / text-glow / decorative loops) · 2 the app's own Lite mode
var autoOn = ls('perf_auto') !== '0';                            // false once the person picks a level by hand
var lastChange = num('perf_ts', 0);                              // when the governor last degraded this phone
var ownLite = ls('perf_lite_own') === '1';                       // true only if THIS file switched Lite on
var bootAt = now(), changedAt = 0, flaps = 0, probation = false;
var baseDt = 1000 / 60, capped = false, probed = false;          // measured refresh interval of this display
var bad = 0, goodRun = 0, bursts = 0, last = 0, mon = 0, holdT = 0, fr = [];
var stats = { bursts: 0, bad: 0, good: 0, p90: 0, longPct: 0, fps: 0 };
var hud = null;
window.__fxHold = false;

/* ---------- reporting ---------- */
function say(msg) { try { if (typeof W.toast === 'function') W.toast(msg, 'info'); } catch (e) { } }
function emit(auto) { try { W.dispatchEvent(new CustomEvent('perf:level', { detail: { level: level, auto: !!auto } })); } catch (e) { } }
function hudDraw() {
  if (!debug) return;
  if (!hud) { hud = document.createElement('div'); hud.id = 'perf-hud'; (document.body || D).appendChild(hud); }
  hud.textContent = 'perf v' + VERSION + ' · level ' + level + (autoOn ? ' auto' : ' manual') + (probation ? ' trial' : '') +
    '\nrefresh ' + Math.round(1000 / baseDt) + ' Hz' + (capped ? ' (capped)' : '') +
    '\nlast scroll ' + stats.fps + ' fps · long ' + stats.longPct + '% · p90 ' + stats.p90 + ' ms' +
    '\nbad ' + bad.toFixed(1) + ' · good run ' + goodRun;
}

/* ---------- level control ---------- */
function applyFxSafe() { try { if (typeof W.applyFx === 'function') W.applyFx(); } catch (e) { } }
function set(l, auto) {
  l = Math.max(0, Math.min(2, l | 0));
  var prev = level; level = l; changedAt = now();
  ls('perf_level', String(l));
  D.classList.toggle('fx-mid', l >= 1);
  /* Lite (level 2) is the app's own switch; only undo it if we were the ones who turned it on */
  if (l >= 2) {
    if (ls('fx_lite') !== '1') { ls('fx_lite', '1'); ownLite = true; ls('perf_lite_own', '1'); }
    applyFxSafe();
  } else if (prev >= 2 && ownLite) {
    ls('fx_lite', '0'); ownLite = false; ls('perf_lite_own', null); applyFxSafe();
  }
  if (auto && l > prev) { lastChange = Date.now(); ls('perf_ts', String(lastChange)); }
  bad = 0; goodRun = 0; fr = [];
  if (auto && l !== prev) {
    if (l > prev) say(l === 1 ? 'Smoother mode on: blur and glow trimmed for your phone. It will be given back if scrolling stays smooth.'
                              : 'Lite mode on: your phone needed it for smooth scrolling. Toggle ⚡ to undo.');
    else say(l === 0 ? 'Full effects restored: scrolling has been smooth for a while.' : 'Lite mode lifted: scrolling is smooth enough for the mid level.');
  }
  emit(auto); hudDraw();
}
if (level >= 1) D.classList.add('fx-mid');

/* an auto-trimmed phone gets a fresh trial after a week (a new OS update, a closed background app, a cooler day…) */
if (autoOn && level >= 1 && lastChange && Date.now() - lastChange > 7 * DAY) { probation = true; set(level - 1, false); }

/* ---------- refresh-rate probe: median idle frame time tells us what “smooth” means on THIS screen ---------- */
function probe() {
  if (probed || document.hidden || W.__fxHold) return; probed = true;
  var n = 0, prev = 0, ds = [];
  function f(t) {
    if (prev) ds.push(t - prev); prev = t;
    if (++n < 26 && !document.hidden && !W.__fxHold) requestAnimationFrame(f); else done();
  }
  function done() {
    if (ds.length < 12) { probed = false; return; }
    ds.sort(function (a, b) { return a - b; });
    var med = ds[ds.length >> 1];
    if (med > 5 && med < 70) baseDt = med;
    capped = med > 28 && med < 40;                       // iOS Low Power Mode and some battery savers cap rAF at 30 fps: not a struggle
    hudDraw();
  }
  requestAnimationFrame(f);
}
if (document.readyState === 'complete') setTimeout(probe, 1500); else addEventListener('load', function () { setTimeout(probe, 1500); });

/* ---------- scroll-smoothness monitor ---------- */
function monitoring() {
  if (!autoOn || document.hidden || W.__perfPause) return false;
  if (now() - bootAt < 4000) return false;                           // startup jank is not scroll jank
  if (level >= 2 && !probation) return false;                        // nothing left to trim
  return touch || D.classList.contains('fx-low');
}
function frame(t) {
  if (!W.__fxHold) { mon = 0; verdict(); return; }
  if (last) fr.push(t - last); last = t; mon = requestAnimationFrame(frame);
}
function verdict() {
  last = 0;
  var a = [], i, d;
  for (i = 0; i < fr.length; i++) { d = fr[i]; if (d <= 250) a.push(d); }     // a tab switch or GC pause is not a dropped frame
  fr = [];
  if (a.length < 14) return;
  var lim = Math.max(baseDt * 1.9, 26), longN = 0, sum = 0;
  for (i = 0; i < a.length; i++) { sum += a[i]; if (a[i] > lim) longN++; }
  var sorted = a.slice().sort(function (x, y) { return x - y; });
  var p90 = sorted[Math.floor(sorted.length * .9)], longPct = longN / a.length;
  stats.bursts = ++bursts; stats.p90 = Math.round(p90); stats.longPct = Math.round(longPct * 100); stats.fps = Math.round(1000 / (sum / a.length));
  var isBad = longPct > .22 || p90 > lim * 1.6, isGood = longPct < .08 && p90 <= lim;
  if (isBad) { bad += 1; goodRun = 0; stats.bad++; } else if (isGood) { goodRun++; bad = Math.max(0, bad - .5); stats.good++; }
  /* escalate */
  if (isBad && level < 1 && bad >= 2.5) { if (probation) { probation = false; lastChange = Date.now(); } set(1, true); }
  else if (isBad && level === 1 && bad >= 6) set(2, true);
  /* recover: sustained smoothness steps effects back, with a cooldown so a borderline phone does not flap */
  else if (isGood && level >= 1 && goodRun >= 24 && flaps < 2 && now() - changedAt > 10 * 6e4 && lsOwnsAuto()) {
    flaps++; probation = true; set(level - 1, true);
  }
  hudDraw();
}
function lsOwnsAuto() { return autoOn && (level < 2 || ownLite); }          // never lift a Lite the person chose themselves

addEventListener('scroll', function () {
  W.__fxHold = true; clearTimeout(holdT); holdT = setTimeout(function () { W.__fxHold = false; }, 160);
  if (!mon && monitoring()) mon = requestAnimationFrame(frame);
}, { passive: true, capture: true });

document.addEventListener('visibilitychange', function () {
  if (document.hidden) { W.__fxHold = false; if (mon) { cancelAnimationFrame(mon); mon = 0; } fr = []; last = 0; }
  else { probed = false; setTimeout(probe, 800); }
});

/* if the person flips the ⚡ switch themselves, respect it: they now own Lite */
function hookToggle() {
  var orig = W.toggleFx; if (typeof orig !== 'function' || orig.__perfHooked) return;
  var wrapped = function () {
    var r = orig.apply(this, arguments);
    ownLite = false; ls('perf_lite_own', null);                      // after a manual flip this file no longer owns the Lite flag
    if (ls('fx_lite') !== '1' && level >= 2) { level = 1; ls('perf_level', '1'); bad = 0; goodRun = 0; hudDraw(); }
    return r;
  };
  wrapped.__perfHooked = true; W.toggleFx = wrapped;
}
if (document.readyState === 'complete') hookToggle(); else addEventListener('load', hookToggle);
if (debug) { if (document.body) hudDraw(); else addEventListener('DOMContentLoaded', hudDraw); }

/* ---------- public API ---------- */
W.perf = {
  version: VERSION,
  set: function (l) { autoOn = false; ls('perf_auto', '0'); probation = false; set(l); },
  auto: function (on) { autoOn = on !== false; ls('perf_auto', autoOn ? '1' : '0'); hudDraw(); return autoOn; },
  reset: function () { autoOn = true; flaps = 0; probation = false; lastChange = 0; ls('perf_auto', '1'); ls('perf_ts', null); set(0); },
  pause: function () { W.__perfPause = true; },
  resume: function () { W.__perfPause = false; },
  hud: function (on) { debug = on !== false; ls('perf_debug', debug ? '1' : '0'); if (!debug && hud) { hud.remove(); hud = null; } hudDraw(); },
  status: function () {
    return { level: level, auto: autoOn, probation: probation, refreshHz: Math.round(1000 / baseDt), capped30: capped, touch: touch, lowEnd: D.classList.contains('fx-low'),
             memoryGB: mem, cores: cores, saveData: save, reducedMotion: reduced, lastScroll: stats };
  },
  get level() { return level; }
};
})();
