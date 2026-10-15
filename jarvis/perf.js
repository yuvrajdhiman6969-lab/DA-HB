/* perf.js — adaptive performance governor for Discipline OS (mobile first).
   Additive: removes no feature. It (1) fixes touch latency, (2) holds decorative canvas work while you scroll,
   (3) watches real scroll smoothness and, only if the phone is actually struggling, steps the heavy
   effects (blur, glow, decorative loops) down — remembered for next launch. Console: perf.set(0|1|2). */
(function () {
'use strict';
var D = document.documentElement;
var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { } return null; };
var touch = !!(window.matchMedia && matchMedia('(pointer:coarse)').matches), mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
var save = !!(navigator.connection && navigator.connection.saveData);
if (touch) D.classList.add('fx-touch');
if (touch && (mem <= 4 || cores <= 6 || save)) D.classList.add('fx-low');

/* always-on, visually identical */
var css = document.createElement('style'); css.id = 'perf-css';
css.textContent =
  'html{touch-action:manipulation}' +                                                              // no 300 ms tap delay anywhere
  'html.fx-touch :is(.modal-overlay,.qotd-overlay){-webkit-backdrop-filter:none!important;backdrop-filter:none!important}' +   // dark overlay hides the blur anyway
  /* mid level: only applied if the phone is measured to be struggling */
  'html.fx-mid *,html.fx-mid *::before,html.fx-mid *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;text-shadow:none!important}' +
  'html.fx-mid nav{background:var(--bg)!important}' +
  'html.fx-mid #fx-canvas{display:none!important}' +
  'html.fx-mid :is(.rx-spin-a,.rx-spin-b,.rx-spin-c,.rx-orbit,.rx-breathe,.stark-hud::after,.sysdot,nav::after,.hero-streak::after,.sys-strip::after){animation:none!important}';
(document.head || D).appendChild(css);

/* hold decorative canvas/loops while the finger is moving the page */
window.__fxHold = false;
var holdT = 0, mon = 0, last = 0, fr = [], good = 0, bad = 0;
function frame(t) {
  if (!window.__fxHold) { mon = 0; verdict(); return; }
  if (last) fr.push(t - last); last = t; mon = requestAnimationFrame(frame);
}
function verdict() {
  last = 0; if (fr.length < 12) { fr = []; return; }
  var avg = fr.reduce(function (a, b) { return a + b; }, 0) / fr.length; fr = [];
  var fps = 1000 / avg; if (fps < 42) { bad++; good = 0; } else { good++; if (good > 3) bad = 0; }
  if (level < 1 && bad >= 2) set(1, true); else if (level === 1 && bad >= 5) set(2, true);
}
addEventListener('scroll', function () {
  window.__fxHold = true; clearTimeout(holdT); holdT = setTimeout(function () { window.__fxHold = false; }, 160);
  if (!mon && (touch || D.classList.contains('fx-low'))) mon = requestAnimationFrame(frame);
}, { passive: true, capture: true });

/* levels: 0 full · 1 mid (no blur / text-glow / decorative loops) · 2 the app's own Lite mode */
var level = +ls('perf_level') || 0;
function set(l, auto) {
  level = l; ls('perf_level', String(l)); D.classList.toggle('fx-mid', l >= 1);
  if (l >= 2) { ls('fx_lite', '1'); try { applyFx(); } catch (e) { } }
  if (auto) try { toast(l === 1 ? 'Smoother mode on: blur and glow trimmed for your phone.' : 'Lite mode on: your phone needed it for smooth scrolling. Toggle ⚡ to undo.', 'info'); } catch (e) { }
}
if (level >= 1) D.classList.add('fx-mid');
window.perf = { set: function (l) { bad = good = 0; set(l); }, get level() { return level; } };
})();
