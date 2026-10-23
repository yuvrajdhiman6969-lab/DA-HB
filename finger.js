/* finger.js v1 — FINGER MODE for Discipline OS.
   Control the whole app with your hand in front of the webcam. Nothing in the app is changed: this file only adds a layer on top.
   It sends the same events a mouse would, so every button, tab, canvas (Muscle Map / Holo body), slider and scroll area just works.

   GESTURES (primary hand, the one that is clearest to the camera)
     ☝  POINT            index finger up: the cursor ring follows your fingertip
     🤏  PINCH           thumb + index: quick pinch = CLICK · pinch twice = DOUBLE CLICK
                         pinch, hold and move = DRAG (rotates the 3D body, moves sliders) or SCROLL (everywhere else, like a touch screen)
     🤏  GRAB            thumb + middle finger: picks up the panel under the cursor and moves it (positions are remembered)
     🤏  BACK            thumb + ring finger: close the window / drawer / go back Home
     🤏  JARVIS          thumb + little finger: tap the Jarvis orb (talk)
     ✌  TWO FINGERS     index + middle up, move the hand up / down / sideways to SCROLL
     🖐  OPEN PALM       swipe left / right = next / previous tab · swipe up / down = page down / up
     🙌  TWO HANDS       pinch with both hands, spread apart / bring together = ZOOM (the 3D body if one is on screen, otherwise the page)
                         and slide both hands sideways to turn the 3D body
     👍 👎  THUMBS       hold 0.8 s = say YES / NO to Jarvis (when his panel is open)
     ✊  FIST            hold 1.2 s = PAUSE gesture control · hold an open palm 1 s = RESUME
   Extras: DWELL click (hold the ring on a button for 1.1 s, off by default), forgiving targets (a click lands on the nearest button
   if you are a few pixels off), smooth One-Euro filtering, momentum scrolling, a small camera preview with the skeleton, and a guide.

   Start / stop: the ✋ button (bottom right), Shift+F, or say “Jarvis, turn on finger mode” / “turn off finger mode”.
   Console: FINGER.start() · FINGER.stop() · FINGER.toggle() · FINGER.status() · FINGER.guide() · FINGER.resetLayout()
   Tracking runs on this device with MediaPipe Hands (a one-time ~8 MB model download, then cached). No video ever leaves the device. */
(function () {
'use strict';
if (window.FINGER) return;
var W = window, D = document, H = D.documentElement;

/* ---------------------------------------------------------------- config */
var MP_VER = '0.10.14';
var LIBS = ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER + '/vision_bundle.mjs', 'https://unpkg.com/@mediapipe/tasks-vision@' + MP_VER + '/vision_bundle.mjs'];
var WASM = ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER + '/wasm', 'https://unpkg.com/@mediapipe/tasks-vision@' + MP_VER + '/wasm'];
var MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
var MARGINS = [.08, .14, .22];                 // how much of the camera frame edge is ignored: bigger = less hand movement needed
var SENS_NAME = ['WIDE', 'NORMAL', 'FAST'];
var DWELL_MS = 1100;
var PINCH_IN = .30, PINCH_OUT = .46;
var PANEL_SEL = '.dash-card,.home-stat-box,.wd-card,.bunk-bank-card,.punish-card,.aar-card,.timer-card,.detailed-breakdown-card,.schedule-day-col,.exc-card,.hero-quote,.hero-streak,.hl-panel,.hl-stage,.mm-p,.ops-card,.stark-hud,.gym-ex-block,.qp,.table-wrapper,.month-selector,.wd-item,.ach-badge,.punish-log-item';
var INTERACT = 'button,a[href],input,select,textarea,summary,label,[onclick],[role="button"],.nav-btn,.th-row,.wd-pill,.wd-chip,.wd-date,.ins-tab,.ins-chip,.gym-hud-tab,.gym-metric-btn,.gym-pick-chip,.qp-btn,.pl-item,.hamburger,.scroll-level-btn,.class-attendance-btn,.cell-check,.event-action-btn,.mm-row,.hl-chip,.mm-ctl button,canvas';
var CONN = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
var TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18];
var PINCH_LABEL = ['CLICK', 'GRAB', 'BACK', 'JARVIS'];

/* ---------------------------------------------------------------- tiny helpers */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
try { ['fg_dwell', 'fg_cam', 'fg_size', 'fg_sens', 'fg_layout', 'fg_seen'].forEach(function (k) { SYNC_LOCAL_ONLY.add(k); }); } catch (e) { }
function $(id) { return D.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function toast(m, k) { try { if (typeof W.toast === 'function') W.toast(m, k || 'info'); } catch (e) { } }
function typing(t) { return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
function el(tag, cls, html) { var n = D.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
function curTab() { var s = D.querySelector('.section.active'); return s ? s.id.replace('tab-', '') : 'home'; }
function zoomNow() { return parseFloat(H.style.zoom) || 1; }
function lite() { return H.classList.contains('fx-lite'); }

/* ---------------------------------------------------------------- state */
var P = {                                                  // saved preferences
  dwell: lsGet('fg_dwell') === '1',
  cam: lsGet('fg_cam') !== '0',
  big: lsGet('fg_size') === '1',
  sens: (function () { var v = parseInt(lsGet('fg_sens'), 10); return v >= 0 && v <= 2 ? v : 1; })()
};
var S = {
  on: false, loading: false, paused: false, lm: null, stream: null, video: null, raf: 0, lastDet: 0, lastVT: -1, minDt: 33, errs: 0, AR: 4 / 3,
  cx: innerWidth / 2, cy: innerHeight / 2, lx: 0, ly: 0, hist: [], fresh: true, freezeUntil: 0, prog: 0, state: 'idle', note: '', noteT: 0,
  pose: '', cand: '', cnt: 0, hp: '', hpT: 0, holdDone: false, lostAt: 0, nHands: 0, pk: '', actT: 0, lastClick: 0, lastCP: [0, 0],
  dw: { el: null, x: 0, y: 0, t: 0, done: false }, hot: null, pp: null, ph: [], fps: 0, fpsN: 0, fpsT: 0, pz: 1, vel: [0, 0], momRaf: 0, momTgt: null
};
var PN = { on: false, finger: -1, t0: 0, c0: [0, 0], m0: [0, 0], dragging: false, mode: '', tgt: null, last: [0, 0], vel: [0, 0], vt: 0, cancel: false };
var MV = null;                                             // panel being moved
var Z = { on: false, d0: 0, t: 0, mx: 0 };                 // two-hand zoom
var LAY = (function () { try { return JSON.parse(lsGet('fg_layout') || '{}') || {}; } catch (e) { return {}; } })();
var U = {};                                                // DOM handles

/* ---------------------------------------------------------------- One-Euro filter: smooth when slow, instant when fast */
function Euro(minC, beta) { this.minC = minC; this.beta = beta; this.px = null; this.dx = 0; this.pt = 0; }
Euro.prototype.reset = function () { this.px = null; this.dx = 0; this.pt = 0; };
function alphaOf(cut, dt) { var tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
Euro.prototype.f = function (x, t) {
  if (this.px === null) { this.px = x; this.pt = t; this.dx = 0; return x; }
  var dt = Math.max(1e-3, t - this.pt); this.pt = t;
  var raw = (x - this.px) / dt; this.dx += alphaOf(1, dt) * (raw - this.dx);
  var cut = this.minC + this.beta * Math.abs(this.dx);
  this.px += alphaOf(cut, dt) * (x - this.px);
  return this.px;
};
var FX = new Euro(1.1, .008), FY = new Euro(1.1, .008), PFX = new Euro(1.3, .008), PFY = new Euro(1.3, .008);

/* ---------------------------------------------------------------- styles + UI */
function css() {
  if ($('fg-css')) return;
  var s = el('style'); s.id = 'fg-css';
  s.textContent = [
    '#fg-cursor{position:fixed;left:0;top:0;width:0;height:0;z-index:21100;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform}',
    '#fg-cursor.on{opacity:1}',
    '#fg-cursor .c{position:absolute;left:-26px;top:-26px;width:52px;height:52px;transition:transform .14s cubic-bezier(.2,.8,.2,1),opacity .2s}',
    '#fg-cursor svg{width:100%;height:100%;overflow:visible;display:block}',
    '#fg-cursor .rg{fill:none;stroke:var(--primary,#4fd8ff);stroke-width:2;filter:drop-shadow(0 0 5px var(--primary,#4fd8ff))}',
    '#fg-cursor .r2{fill:none;stroke:var(--primary-2,#bff3ff);stroke-width:1;stroke-dasharray:3 6;opacity:.7;transform-origin:26px 26px;animation:fgSpin 8s linear infinite}',
    '#fg-cursor .dw{fill:none;stroke:var(--orange,#ff6a3d);stroke-width:4;stroke-linecap:round;transform:rotate(-90deg);transform-origin:26px 26px;stroke-dasharray:0 200}',
    '#fg-cursor i{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:var(--orange,#ff6a3d);box-shadow:0 0 8px var(--orange,#ff6a3d)}',
    '#fg-cursor b{position:absolute;left:34px;top:12px;white-space:nowrap;font:700 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;color:var(--primary-2,#bff3ff);text-shadow:0 0 8px #000,0 0 6px var(--primary,#4fd8ff)}',
    '#fg-cursor[data-s=pinch] .c{transform:scale(.55)}#fg-cursor[data-s=pinch] .rg{stroke:var(--orange,#ff6a3d)}',
    '#fg-cursor[data-s=drag] .c{transform:scale(.5)}#fg-cursor[data-s=drag] .rg{stroke:#fff}',
    '#fg-cursor[data-s=grab] .c{transform:scale(.7) rotate(45deg)}#fg-cursor[data-s=grab] .rg{stroke:var(--warn,#ff9a4d)}',
    '#fg-cursor[data-s=scroll] .c{transform:scaleY(1.35) scaleX(.7)}',
    '#fg-cursor[data-s=zoom] .c{transform:scale(1.5)}#fg-cursor[data-s=zoom] .rg{stroke:var(--ok,#3df0c8)}',
    '#fg-cursor[data-s=paused] .c,#fg-cursor[data-s=lost] .c{opacity:.35}',
    '@keyframes fgSpin{to{transform:rotate(360deg)}}',
    '.fg-hot{outline:2px solid var(--primary-2,#bff3ff)!important;outline-offset:3px!important}',
    '.fg-moving{z-index:900!important;box-shadow:0 30px 60px -10px rgba(0,0,0,.75),0 0 0 2px var(--primary,#4fd8ff)!important;transition:none!important;opacity:.97}',
    '.fg-rip{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid var(--primary-2,#bff3ff);pointer-events:none;z-index:21090;animation:fgRip .5s ease-out forwards}',
    '@keyframes fgRip{to{transform:scale(4.5);opacity:0}}',
    '#fg-fab{position:fixed;right:80px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:951;width:50px;height:50px;border-radius:50%;cursor:pointer;display:grid;place-items:center;font-size:22px;line-height:1;color:var(--text,#e6f6ff);background:rgba(2,10,22,.88);border:1.5px solid var(--border-strong,rgba(120,225,255,.5));box-shadow:0 0 16px -4px var(--primary,#4fd8ff);transition:transform .15s,box-shadow .2s,border-color .2s}',
    '#fg-fab:hover{transform:scale(1.08)}#fg-fab.on{border-color:var(--ok,#3df0c8);box-shadow:0 0 22px -2px var(--ok,#3df0c8)}#fg-fab.load{animation:fgSpin 1.2s linear infinite}',
    '@media(max-width:640px){#fg-fab{right:66px;width:44px;height:44px;font-size:19px}}',
    '#fg-cam{position:fixed;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:21050;width:216px;background:linear-gradient(160deg,rgba(8,30,60,.94),rgba(2,8,18,.96));border:1px solid var(--border-strong,rgba(120,225,255,.5));box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 24px -10px var(--primary,#4fd8ff);font-family:ui-monospace,Menlo,monospace;color:var(--text,#e6f6ff);clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%);display:none}',
    '#fg-cam.show{display:block}#fg-cam.big{width:340px}',
    '#fg-cam .bar{display:flex;align-items:center;gap:5px;padding:6px 7px;border-bottom:1px solid var(--border,rgba(120,225,255,.25));font-size:9px;letter-spacing:.12em}',
    '#fg-cam .st{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--primary-2,#bff3ff);font-weight:700}',
    '#fg-cam .st::before{content:"";display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:var(--muted,#7fa0bd);vertical-align:0}',
    '#fg-cam.live .st::before{background:var(--ok,#3df0c8);box-shadow:0 0 8px var(--ok,#3df0c8)}#fg-cam.pause .st::before{background:var(--warn,#ff9a4d)}',
    '#fg-cam button{background:transparent;border:1px solid var(--border-strong,rgba(120,225,255,.45));color:var(--text,#e6f6ff);font:700 8.5px ui-monospace,Menlo,monospace;letter-spacing:.08em;padding:3px 5px;cursor:pointer;min-height:22px}',
    '#fg-cam button.on{background:var(--primary,#4fd8ff);color:var(--primary-ink,#02121c);border-color:var(--primary,#4fd8ff)}',
    '#fg-cam .vw{position:relative;width:100%;aspect-ratio:4/3;background:#000;overflow:hidden}#fg-cam.min .vw{height:0;aspect-ratio:auto}',
    '#fg-cam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);opacity:.85}',
    '#fg-cam canvas{position:absolute;inset:0;width:100%;height:100%}',
    '#fg-cam .ft{padding:5px 8px 6px;font-size:8.5px;letter-spacing:.1em;color:var(--muted,#7fa0bd);display:flex;justify-content:space-between;gap:8px}',
    '#fg-cam .ft b{color:var(--primary-2,#bff3ff)}',
    '#fg-guide{position:fixed;right:16px;top:calc(76px + env(safe-area-inset-top,0px));z-index:21060;width:min(350px,92vw);max-height:calc(100vh - 120px);overflow:auto;padding:12px 12px 10px;background:linear-gradient(160deg,rgba(8,30,60,.96),rgba(2,8,18,.98));border:1px solid var(--border-strong,rgba(120,225,255,.5));box-shadow:0 20px 50px rgba(0,0,0,.65);font-family:var(--font-body,sans-serif);color:var(--text,#e6f6ff);display:none;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}',
    '#fg-guide.show{display:block}',
    '#fg-guide h4{margin:0 0 8px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.22em;color:var(--primary,#4fd8ff);display:flex;justify-content:space-between;align-items:center}',
    '#fg-guide h4 button{background:none;border:1px solid var(--border-strong,rgba(120,225,255,.45));color:var(--text,#e6f6ff);cursor:pointer;padding:2px 8px;font:inherit}',
    '#fg-guide .g{display:grid;grid-template-columns:34px 1fr;gap:2px 10px;align-items:center;padding:6px 0;border-top:1px solid var(--border,rgba(120,225,255,.18))}',
    '#fg-guide .g span{font-size:22px;text-align:center}#fg-guide .g b{display:block;font:700 10.5px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--primary-2,#bff3ff)}#fg-guide .g em{font-style:normal;font-size:12px;color:var(--muted,#9ab);line-height:1.35}',
    '#fg-guide p{margin:8px 0 0;font-size:11px;color:var(--muted,#9ab);line-height:1.45}',
    'html.fx-lite #fg-cursor .r2,html.fx-lite #fg-fab.load{animation:none}',
    '@media(prefers-reduced-motion:reduce){#fg-cursor .r2,.fg-rip,#fg-fab.load{animation:none}}',
    '@media print{#fg-cursor,#fg-cam,#fg-guide,#fg-fab{display:none!important}}'
  ].join('\n');
  (D.head || H).appendChild(s);
}
var GUIDE = [
  ['☝️', 'POINT', 'Raise your index finger and move your hand. The ring follows your fingertip.'],
  ['🤏', 'PINCH = CLICK', 'Touch thumb and index finger and let go. Pinch twice quickly to double click.'],
  ['🤏', 'PINCH + MOVE', 'Hold the pinch and move: drags sliders, rotates the 3D body, and scrolls everywhere else like a touch screen.'],
  ['🫳', 'GRAB A PANEL', 'Pinch thumb + middle finger over a card and move it. Its place is remembered. RESET puts everything back.'],
  ['↩️', 'BACK', 'Pinch thumb + ring finger: closes the window or menu, or goes back Home.'],
  ['🎙️', 'JARVIS', 'Pinch thumb + little finger: taps the Jarvis orb so you can talk.'],
  ['✌️', 'SCROLL', 'Index + middle finger up, then move your hand up, down or sideways.'],
  ['🖐️', 'SWIPE', 'Open palm: swipe left or right to change tab, swipe up or down for a page.'],
  ['🙌', 'ZOOM', 'Pinch with both hands, then spread apart or bring together. Slide both hands sideways to turn the 3D body.'],
  ['👍', 'YES / NO', 'Hold a thumb up or down for a second when Jarvis is asking you something.'],
  ['✊', 'PAUSE', 'Hold a fist 1.2 s to pause. Hold an open palm 1 s to resume.']
];
function buildUI() {
  if (U.built) return;
  css();
  U.cur = el('div', null, '<div class="c"><svg viewBox="0 0 52 52"><circle class="r2" cx="26" cy="26" r="24"/><circle class="rg" cx="26" cy="26" r="17"/><circle class="dw" cx="26" cy="26" r="22"/></svg></div><i></i><b></b>');
  U.cur.id = 'fg-cursor'; U.cur.setAttribute('aria-hidden', 'true'); D.body.appendChild(U.cur);
  U.dw = U.cur.querySelector('.dw'); U.lab = U.cur.querySelector('b');
  U.cam = el('div', null,
    '<div class="bar"><span class="st" id="fg-st">OFF</span><button data-a="dwell" title="Hold the ring on a button to click it">DWELL</button><button data-a="sens" title="How far your hand has to travel">SENS</button><button data-a="cam" title="Show or hide the preview">VIEW</button><button data-a="size" title="Bigger preview">SIZE</button><button data-a="guide" title="Gesture guide">?</button><button data-a="reset" title="Put moved panels back">RESET</button><button data-a="off" title="Turn finger mode off">✕</button></div>' +
    '<div class="vw"><video muted playsinline></video><canvas></canvas></div><div class="ft"><span id="fg-hands">NO HAND</span><span id="fg-pose">—</span><span id="fg-fps">0 FPS</span></div>');
  U.cam.id = 'fg-cam'; D.body.appendChild(U.cam);
  U.video = U.cam.querySelector('video'); U.cv = U.cam.querySelector('canvas'); U.cx = U.cv.getContext('2d');
  U.st = $('fg-st'); U.hands = $('fg-hands'); U.pose = $('fg-pose'); U.fps = $('fg-fps');
  U.guide = el('div', null, '<h4><span>FINGER MODE · GESTURES</span><button type="button" data-a="gclose">CLOSE</button></h4>' +
    GUIDE.map(function (g) { return '<div class="g"><span>' + g[0] + '</span><div><b>' + g[1] + '</b><em>' + g[2] + '</em></div></div>'; }).join('') +
    '<p>Tips: sit about an arm\'s length from the camera with light on your hand. Use your clearest hand. Press Shift+F or say “turn off finger mode” to stop. Nothing is recorded; tracking runs on this device.</p>');
  U.guide.id = 'fg-guide'; D.body.appendChild(U.guide);
  U.cam.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) camAct(b.dataset.a); });
  U.guide.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) guide(false); });
  U.built = true; prefsUI();
}
function prefsUI() {
  if (!U.built) return;
  var b = function (a) { return U.cam.querySelector('[data-a="' + a + '"]'); };
  b('dwell').classList.toggle('on', P.dwell); b('dwell').textContent = 'DWELL ' + (P.dwell ? 'ON' : 'OFF');
  b('sens').textContent = SENS_NAME[P.sens]; b('cam').classList.toggle('on', P.cam); b('size').classList.toggle('on', P.big);
  U.cam.classList.toggle('min', !P.cam); U.cam.classList.toggle('big', P.big);
}
function camAct(a) {
  if (a === 'dwell') { P.dwell = !P.dwell; lsSet('fg_dwell', P.dwell ? '1' : '0'); note(P.dwell ? 'DWELL CLICK ON' : 'DWELL CLICK OFF'); }
  else if (a === 'sens') { P.sens = (P.sens + 1) % 3; lsSet('fg_sens', String(P.sens)); note('REACH: ' + SENS_NAME[P.sens]); }
  else if (a === 'cam') { P.cam = !P.cam; lsSet('fg_cam', P.cam ? '1' : '0'); }
  else if (a === 'size') { P.big = !P.big; lsSet('fg_size', P.big ? '1' : '0'); }
  else if (a === 'guide') guide();
  else if (a === 'reset') resetLayout();
  else if (a === 'off') stop();
  prefsUI();
}
function guide(on) { if (!U.built) buildUI(); U.guide.classList.toggle('show', on === undefined ? !U.guide.classList.contains('show') : !!on); }
function fab() {
  if ($('fg-fab')) return;
  css();
  var b = el('button', null, '✋'); b.id = 'fg-fab'; b.type = 'button'; b.title = 'Finger mode (Shift+F): control the app with your hand'; b.setAttribute('aria-label', 'Toggle finger mode');
  b.addEventListener('click', toggle); D.body.appendChild(b);
}
function fabState() { var b = $('fg-fab'); if (!b) return; b.classList.toggle('on', S.on); b.classList.toggle('load', S.loading); }
function status(t) { if (U.st) U.st.textContent = t; }
function note(t) { S.note = t; S.noteT = performance.now() + 1400; }

/* ---------------------------------------------------------------- hand maths */
function dd(a, b) { return Math.hypot((a.x - b.x) * S.AR, a.y - b.y); }
function analyse(lm) {
  var scale = dd(lm[0], lm[9]) || .001, ext = [], rt = [], pr = [], i;
  for (i = 0; i < 4; i++) {
    var tipD = dd(lm[0], lm[TIPS[i]]), pipD = dd(lm[0], lm[PIPS[i]]);
    rt[i] = tipD / scale; ext[i] = tipD > pipD * 1.12 && rt[i] > (i === 3 ? 1.35 : 1.5);
    pr[i] = dd(lm[4], lm[TIPS[i]]) / scale;
  }
  var thumbExt = dd(lm[4], lm[5]) / scale > .85 && dd(lm[4], lm[17]) > dd(lm[3], lm[17]);
  var maxTip = Math.max(rt[0], rt[1], rt[2], rt[3]), anyExt = ext[0] || ext[1] || ext[2] || ext[3];
  var fist = !anyExt && maxTip < 1.3, pose = 'other';
  if (thumbExt && !anyExt && maxTip < 1.45 && lm[4].y < lm[3].y && lm[4].y < lm[2].y && lm[4].y < lm[5].y - .02) pose = 'up';
  else if (thumbExt && !anyExt && maxTip < 1.45 && lm[4].y > lm[3].y && lm[4].y > lm[0].y + .03) pose = 'down';
  else if (ext[0] && ext[1] && ext[2] && ext[3]) pose = 'palm';
  else if (ext[0] && ext[1] && !ext[2] && !ext[3]) pose = 'peace';
  else if (ext[0] && !ext[1] && !ext[2] && !ext[3]) pose = 'point';
  else if (fist) pose = 'fist';
  return { scale: scale, ext: ext, rt: rt, pr: pr, pose: pose, fist: fist, thumbExt: thumbExt };
}
function pinchState(a, prev) {                            // which finger is pinching the thumb (hysteresis), -1 for none
  var best = -1, bv = 9, i;
  for (i = 0; i < 4; i++) { if (a.pr[i] < bv && (a.rt[i] > 1.08 || a.pr[i] < .16)) { bv = a.pr[i]; best = i; } }   // a closed fist is not a pinch
  if (prev >= 0 && a.pr[prev] < PINCH_OUT && (a.rt[prev] > 1.0 || a.pr[prev] < .2) && !(best !== prev && best >= 0 && a.pr[best] < PINCH_IN * .8)) return prev;
  return bv < PINCH_IN ? best : -1;
}
function mapXY(nx, ny) {                                  // camera image (not mirrored) -> screen pixels, with the edges trimmed
  var m = MARGINS[P.sens], x = 1 - nx, sx = (x - m) / (1 - 2 * m), top = m * .9, bot = m * 1.6, sy = (ny - top) / (1 - top - bot);
  return [clamp(sx, 0, 1) * innerWidth, clamp(sy, 0, 1) * innerHeight];
}
function pinchMid(lm, f) { var t = lm[4], b = lm[TIPS[f]]; return mapXY((t.x + b.x) / 2, (t.y + b.y) / 2); }
function histAt(t) { for (var i = S.hist.length - 1; i >= 0; i--) if (S.hist[i][0] <= t) return [S.hist[i][1], S.hist[i][2]]; return S.hist.length ? [S.hist[0][1], S.hist[0][2]] : null; }

/* ---------------------------------------------------------------- synthetic input (same events a real mouse makes) */
function elAt(x, y) { return D.elementFromPoint(clamp(x, 0, innerWidth - 1), clamp(y, 0, innerHeight - 1)); }
function smart(x, y) {                                    // forgiving target: if nothing clickable is exactly under the ring, use the nearest clickable within ~18px
  var t = elAt(x, y); if (t && t.closest && t.closest(INTERACT)) return t;
  var off = [[10, 0], [-10, 0], [0, 10], [0, -10], [14, 14], [-14, 14], [14, -14], [-14, -14], [18, 0], [-18, 0], [0, 18], [0, -18]];
  for (var i = 0; i < off.length; i++) { var q = elAt(x + off[i][0], y + off[i][1]); if (q && q.closest && q.closest(INTERACT)) return q; }
  return t;
}
function ptr(type, t, x, y, buttons, button) {
  try {
    t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: W, clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 77, pointerType: 'mouse', isPrimary: true, button: button, buttons: buttons, pressure: buttons ? .5 : 0, width: 1, height: 1 }));
  } catch (e) { }
}
function mse(type, t, x, y, buttons, button, detail) {
  try { t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: W, clientX: x, clientY: y, screenX: x, screenY: y, button: button, buttons: buttons, detail: detail || 0 })); } catch (e) { }
}
function ripple(x, y) { if (lite()) return; var r = el('i', 'fg-rip'); r.style.left = x + 'px'; r.style.top = y + 'px'; D.body.appendChild(r); setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 600); }
function setRange(r, x) {
  var b = r.getBoundingClientRect(), f = clamp((x - b.left) / Math.max(1, b.width), 0, 1), mn = parseFloat(r.min || 0), mx = parseFloat(r.max || 100), st = parseFloat(r.step || 1) || 1;
  var v = Math.round((mn + f * (mx - mn)) / st) * st; v = clamp(v, mn, mx);
  if (String(v) === r.value) return;
  r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
}
function cycleSelect(s) {
  if (!s.options || !s.options.length) return;
  s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
  s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
  note(String(s.options[s.selectedIndex].text).slice(0, 20).toUpperCase());
}
function clickAt(x, y, dbl) {
  var t = smart(x, y); if (!t) return;
  ripple(x, y);
  var f = t.closest ? t.closest('input,textarea,select,button,[tabindex]') : null;
  ptr('pointermove', t, x, y, 0, -1); mse('mousemove', t, x, y, 0, 0);
  ptr('pointerdown', t, x, y, 1, 0); mse('mousedown', t, x, y, 1, 0);
  if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) { } }
  ptr('pointerup', t, x, y, 0, 0); mse('mouseup', t, x, y, 0, 0);
  var rg = t.closest ? t.closest('input[type=range]') : null, sel = t.closest ? t.closest('select') : null, inp = t.closest ? t.closest('input') : null;
  if (rg) { setRange(rg, x); return; }
  if (sel) { cycleSelect(sel); return; }
  if (inp && /^(date|time|datetime-local|month|week|color)$/.test(inp.type) && inp.showPicker) { try { inp.showPicker(); } catch (e) { } return; }
  if (inp && /^(text|search|number|password|email|url|tel)$/.test(inp.type)) return;
  if (t.closest && t.closest('textarea')) return;
  mse('click', t, x, y, 0, 0, dbl ? 2 : 1);
  if (dbl) mse('dblclick', t, x, y, 0, 0, 2);
}
function setHot(n) {
  if (S.hot === n) return;
  if (S.hot) S.hot.classList.remove('fg-hot');
  S.hot = n; if (n) n.classList.add('fg-hot');
}

/* ---------------------------------------------------------------- scrolling */
function pageEl() { return D.scrollingElement || H; }
function scroller(t, dx, dy) {
  var e = t, vert = Math.abs(dy) >= Math.abs(dx);
  while (e && e !== D.body && e !== H) {
    var cs = getComputedStyle(e);
    if (vert && /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && ((dy < 0 && e.scrollTop > 0) || (dy > 0 && e.scrollTop < e.scrollHeight - e.clientHeight - 1))) return e;
    if (!vert && /(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && ((dx < 0 && e.scrollLeft > 0) || (dx > 0 && e.scrollLeft < e.scrollWidth - e.clientWidth - 1))) return e;
    e = e.parentElement;
  }
  return pageEl();
}
function doScroll(t, dx, dy) {
  var s = scroller(t || D.body, dx, dy);
  try { if (s === pageEl()) W.scrollBy({ left: dx, top: dy, behavior: 'instant' }); else s.scrollBy({ left: dx, top: dy, behavior: 'instant' }); }
  catch (e) { s.scrollTop += dy; s.scrollLeft += dx; }
}
function momentum() {
  if (S.momRaf) return;
  var last = performance.now();
  (function step(now) {
    var dt = Math.min(50, now - last); last = now;
    var k = Math.pow(.94, dt / 16.7); S.vel[0] *= k; S.vel[1] *= k;
    if (Math.abs(S.vel[0]) < 18 && Math.abs(S.vel[1]) < 18 || !S.on) { S.momRaf = 0; return; }
    doScroll(S.momTgt, S.vel[0] * dt / 1000, S.vel[1] * dt / 1000);
    S.momRaf = requestAnimationFrame(step);
  })(last);
  S.momRaf = requestAnimationFrame(function (n) { S.momRaf = 0; S.momRaf = 0; momentumRun(); });
  cancelAnimationFrame(S.momRaf); S.momRaf = 0; momentumRun();
}
function momentumRun() {
  if (S.momRaf) return;
  var last = performance.now();
  var step = function (now) {
    var dt = Math.min(50, now - last); last = now;
    var k = Math.pow(.94, dt / 16.7); S.vel[0] *= k; S.vel[1] *= k;
    if ((Math.abs(S.vel[0]) < 18 && Math.abs(S.vel[1]) < 18) || !S.on) { S.momRaf = 0; return; }
    doScroll(S.momTgt, S.vel[0] * dt / 1000, S.vel[1] * dt / 1000);
    S.momRaf = requestAnimationFrame(step);
  };
  S.momRaf = requestAnimationFrame(step);
}
function peaceScroll(lm, now) {
  var x = lm[9].x, y = lm[9].y, p = S.pp; S.pp = [x, y, now];
  if (!p || now - p[2] > 150) return;
  var dyn = y - p[1], dxn = -(x - p[0]), dy = dyn * innerHeight * 2.6, dx = dxn * innerWidth * 2.6, tgt = elAt(S.cx, S.cy);
  if (Math.abs(dx) > Math.abs(dy) * 1.5) doScroll(tgt, -dx, 0); else doScroll(tgt, 0, -dy);
}
function swipe(lm, now) {
  var x = lm[9].x, y = lm[9].y; S.ph.push([now, x, y]);
  while (S.ph.length && now - S.ph[0][0] > 280) S.ph.shift();
  if (S.ph.length < 3 || now - S.actT < 900) return;
  var a = S.ph[0], dx = -(x - a[1]), dy = y - a[2];
  if (Math.abs(dx) > .22 && Math.abs(dx) > Math.abs(dy) * 2) { S.actT = now; S.ph.length = 0; stepTab(dx < 0 ? 1 : -1); }
  else if (Math.abs(dy) > .24 && Math.abs(dy) > Math.abs(dx) * 2) {
    S.actT = now; S.ph.length = 0; note(dy < 0 ? 'PAGE DOWN' : 'PAGE UP');
    try { W.scrollBy({ top: (dy < 0 ? 1 : -1) * innerHeight * .85, behavior: 'smooth' }); } catch (e) { }
  }
}

/* ---------------------------------------------------------------- app actions */
function tabIds() { return [].map.call(D.querySelectorAll('#drawer .nav-btn[data-tab]'), function (b) { return b.dataset.tab; }); }
function stepTab(d) {
  var t = tabIds(); if (!t.length) return;
  var i = t.indexOf(curTab()); if (i < 0) i = 0;
  var n = (i + d + t.length) % t.length;
  if (typeof W.switchTab === 'function') { W.switchTab(t[n]); note((d > 0 ? 'NEXT · ' : 'PREV · ') + t[n].toUpperCase()); }
}
function goBack() {
  var m = D.querySelector('.modal-overlay.show');
  if (m) { var btn = m.querySelector('.btn-exception.muted') || m.querySelector('[onclick*="lose"]'); if (btn) { btn.click(); note('CLOSED'); return; } }
  var q = $('qotd-overlay'); if (q && q.classList.contains('show') && typeof W.qotdClose === 'function') { W.qotdClose(); note('CLOSED'); return; }
  var dr = $('drawer'); if (dr && dr.classList.contains('open') && typeof W.closeDrawer === 'function') { W.closeDrawer(); note('MENU CLOSED'); return; }
  var jp = $('jv-panel'); if (jp && !jp.hidden && $('jv-close')) { $('jv-close').click(); note('JARVIS CLOSED'); return; }
  if (U.guide && U.guide.classList.contains('show')) { guide(false); return; }
  if (curTab() !== 'home' && typeof W.switchTab === 'function') { W.switchTab('home'); note('HOME'); return; }
  try { D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { }
}
function talkJarvis() { var m = $('jv-mic'); if (m) { m.click(); note('JARVIS'); } else note('JARVIS NOT HERE'); }
function zoomBy(dir) {
  try { if (W.__jarvis && typeof W.__jarvis.exec === 'function') { W.__jarvis.exec(dir > 0 ? 'zoom in a little' : 'zoom out a little'); return; } } catch (e) { }
  S.pz = clamp(S.pz * (dir > 0 ? 1.1 : 1 / 1.1), .6, 2.2); H.style.zoom = String(S.pz);
}

/* ---------------------------------------------------------------- panel moving (grab) */
function keyFor(p) {
  var sec = p.closest('.section'); if (!sec) return '';
  var all = sec.querySelectorAll(PANEL_SEL), i = [].indexOf.call(all, p);
  return i < 0 ? '' : sec.id + '|' + i;
}
function readTr(p) { var s = p.style.translate; if (!s) return [0, 0]; var a = s.split(' '); return [parseFloat(a[0]) || 0, parseFloat(a[1] || a[0]) || 0]; }
function startMove(p, c0) {
  var tr = readTr(p);
  if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
  MV = { el: p, bx: tr[0], by: tr[1], c0: c0 }; p.classList.add('fg-moving');
}
function moveStep(x, y) {
  if (!MV) return; var z = zoomNow();
  MV.el.style.translate = (MV.bx + (x - MV.c0[0]) / z).toFixed(1) + 'px ' + (MV.by + (y - MV.c0[1]) / z).toFixed(1) + 'px';
}
function endMove() {
  if (!MV) return; var p = MV.el, k = keyFor(p), tr = readTr(p); MV = null; p.classList.remove('fg-moving');
  if (k) { if (Math.abs(tr[0]) < 1 && Math.abs(tr[1]) < 1) delete LAY[k]; else { LAY[k] = tr; p.dataset.fgk = k; } lsSet('fg_layout', JSON.stringify(LAY)); }
  note('PANEL PLACED');
}
function applyLayout() {
  if (!S.on || MV) return;
  var sec = D.querySelector('.section.active'); if (!sec) return;
  var all = sec.querySelectorAll(PANEL_SEL);
  for (var i = 0; i < all.length; i++) {
    var k = sec.id + '|' + i, v = LAY[k];
    if (v && all[i].dataset.fgk !== k) {
      if (getComputedStyle(all[i]).position === 'static') all[i].style.position = 'relative';
      all[i].style.translate = v[0] + 'px ' + v[1] + 'px'; all[i].dataset.fgk = k;
    }
  }
}
function clearLayoutDom() {
  [].forEach.call(D.querySelectorAll('[data-fgk]'), function (p) { p.style.translate = ''; delete p.dataset.fgk; });
}
function resetLayout() { LAY = {}; lsSet('fg_layout', '{}'); clearLayoutDom(); [].forEach.call(D.querySelectorAll('.fg-moving'), function (p) { p.style.translate = ''; p.classList.remove('fg-moving'); }); MV = null; note('LAYOUT RESET'); toast('Panels put back where they belong.'); }

/* ---------------------------------------------------------------- pinch: click / drag / scroll / grab / back / jarvis */
function dragMode(t) {
  if (!t || !t.closest) return 'scroll';
  if (t.closest('input[type=range]')) return 'range';
  if (t.closest('canvas,[data-fg="drag"]')) return 'pointer';
  return 'scroll';
}
function beginDrag() {
  PN.tgt = elAt(PN.c0[0], PN.c0[1]); PN.mode = dragMode(PN.tgt); PN.dragging = true; PN.last = [PN.c0[0], PN.c0[1]]; PN.vel = [0, 0]; PN.vt = performance.now();
  if (PN.mode === 'pointer' && PN.tgt) { ptr('pointerdown', PN.tgt, PN.c0[0], PN.c0[1], 1, 0); mse('mousedown', PN.tgt, PN.c0[0], PN.c0[1], 1, 0); }
  if (PN.mode === 'range' && PN.tgt) setRange(PN.tgt.closest('input[type=range]'), PN.c0[0]);
  cursorState('drag');
}
function dragStep(x, y, now) {
  var dx = x - PN.last[0], dy = y - PN.last[1]; PN.last = [x, y];
  if (PN.mode === 'pointer' && PN.tgt) { ptr('pointermove', PN.tgt, x, y, 1, -1); mse('mousemove', PN.tgt, x, y, 1, 0); }
  else if (PN.mode === 'range' && PN.tgt) { var r = PN.tgt.closest('input[type=range]'); if (r) setRange(r, x); }
  else {
    doScroll(PN.tgt, -dx * 1.15, -dy * 1.15);
    var dt = Math.max(8, now - PN.vt); PN.vt = now;
    PN.vel[0] = PN.vel[0] * .6 + (-dx * 1.15 / dt * 1000) * .4; PN.vel[1] = PN.vel[1] * .6 + (-dy * 1.15 / dt * 1000) * .4;
  }
}
function endDrag() {
  if (PN.mode === 'pointer' && PN.tgt) { ptr('pointerup', PN.tgt, PN.last[0], PN.last[1], 0, 0); mse('mouseup', PN.tgt, PN.last[0], PN.last[1], 0, 0); }
  else if (PN.mode === 'scroll') { S.vel = [PN.vel[0], PN.vel[1]]; S.momTgt = PN.tgt; if (Math.abs(S.vel[0]) > 120 || Math.abs(S.vel[1]) > 120) momentumRun(); }
  PN.dragging = false; PN.tgt = null;
}
function pinchStep(h, pf, now) {
  var lm = h.lm, t = now / 1000;
  if (!PN.on) {
    if (pf < 0) return;
    var mid0 = pinchMid(lm, pf), c0 = histAt(now - 120) || [S.cx, S.cy];
    PN.on = true; PN.finger = pf; PN.t0 = now; PN.dragging = false; PN.mode = ''; PN.cancel = false; PN.c0 = c0; PN.m0 = mid0;
    PFX.reset(); PFY.reset(); PFX.f(mid0[0], t); PFY.f(mid0[1], t); S.cx = c0[0]; S.cy = c0[1];
    S.vel = [0, 0];
    if (pf === 0) cursorState('pinch');
    else if (pf === 1) {
      var tg = elAt(c0[0], c0[1]), pn = tg && tg.closest ? tg.closest(PANEL_SEL) : null;
      if (pn) startMove(pn, c0); else note('NO PANEL HERE');
      cursorState('grab');
    } else if (pf === 2) { if (now - S.actT > 900) { S.actT = now; goBack(); } cursorState('pinch'); }
    else { if (now - S.actT > 900) { S.actT = now; talkJarvis(); } cursorState('pinch'); }
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { }
    return;
  }
  if (pf !== PN.finger) { endPinch(now); return; }
  var mid = pinchMid(lm, PN.finger), mx = PFX.f(mid[0], t), my = PFY.f(mid[1], t);
  S.cx = clamp(PN.c0[0] + (mx - PN.m0[0]), 0, innerWidth); S.cy = clamp(PN.c0[1] + (my - PN.m0[1]), 0, innerHeight);
  if (PN.finger === 0) {
    var dist = Math.hypot(S.cx - PN.c0[0], S.cy - PN.c0[1]);
    if (!PN.dragging && dist > 18) beginDrag();
    if (PN.dragging) dragStep(S.cx, S.cy, now);
  } else if (PN.finger === 1 && MV) moveStep(S.cx, S.cy);
}
function endPinch(now) {
  var f = PN.finger; PN.on = false;
  if (f === 0) {
    if (PN.dragging) endDrag();
    else if (!PN.cancel && now - PN.t0 < 2500) {
      var dbl = now - S.lastClick < 430 && Math.hypot(PN.c0[0] - S.lastCP[0], PN.c0[1] - S.lastCP[1]) < 34;
      clickAt(PN.c0[0], PN.c0[1], dbl); S.lastClick = dbl ? 0 : now; S.lastCP = PN.c0;
    }
  } else if (f === 1) endMove();
  S.freezeUntil = now + 160; S.fresh = true; cursorState('point');
}
function releaseAll() {
  if (PN.on) { var f = PN.finger; PN.on = false; PN.cancel = true; if (PN.dragging) endDrag(); if (f === 1) endMove(); }
  if (MV) endMove();
}

/* ---------------------------------------------------------------- two hands: zoom + turn the body */
function zoomStep(hands, now) {
  var A = hands[0], B = hands[1];
  if (!(A.a.pr[0] < .36 && B.a.pr[0] < .36)) return false;
  var ma = pinchMid(A.lm, 0), mb = pinchMid(B.lm, 0), d = Math.hypot(ma[0] - mb[0], ma[1] - mb[1]), mx = (ma[0] + mb[0]) / 2;
  S.cx = mx; S.cy = (ma[1] + mb[1]) / 2;
  if (!Z.on) { releaseAll(); Z.on = true; Z.d0 = d; Z.t = now; Z.mx = mx; cursorState('zoom'); return true; }
  var ratio = d / Math.max(20, Z.d0);
  if (now - Z.t > 240) {
    if (ratio > 1.16) { zoomBy(1); Z.d0 = d; Z.t = now; note('ZOOM +'); }
    else if (ratio < .86) { zoomBy(-1); Z.d0 = d; Z.t = now; note('ZOOM −'); }
  }
  if (Math.abs(mx - Z.mx) > innerWidth * .14 && now - S.actT > 350) {
    try { if (W.HOLO && typeof W.HOLO.bodyAct === 'function') { W.HOLO.bodyAct(mx > Z.mx ? 'right' : 'left'); S.actT = now; note('TURN'); } } catch (e) { }
    Z.mx = mx;
  }
  return true;
}
function endZoom() { if (Z.on) { Z.on = false; S.fresh = true; S.freezeUntil = performance.now() + 200; cursorState('point'); } }

/* ---------------------------------------------------------------- cursor + per-frame logic */
function cursorState(s) { S.state = s; if (U.cur) U.cur.dataset.s = s; }
function stableTo(raw) {                                  // a pose has to be seen for 3 frames before it counts (pinch is instant)
  if (raw === 'pinch') { S.cand = 'pinch'; S.cnt = 9; return 'pinch'; }
  if (raw === S.cand) S.cnt++; else { S.cand = raw; S.cnt = 1; }
  return S.cnt >= 3 ? raw : (S.pose === 'pinch' ? raw : S.pose || raw);
}
function holdTime(pose, now) {
  if (pose !== S.hp) { S.hp = pose; S.hpT = now; S.holdDone = false; }
  return (now - S.hpT) / 1000;
}
function drawCursor(now) {
  if (!U.cur) return;
  U.cur.style.transform = 'translate3d(' + S.cx.toFixed(1) + 'px,' + S.cy.toFixed(1) + 'px,0)';
  U.cur.classList.toggle('on', S.on);
  U.dw.style.strokeDasharray = (clamp(S.prog, 0, 1) * 138).toFixed(1) + ' 200';
  var lab = '';
  if (now < S.noteT) lab = S.note;
  else if (S.state === 'pinch' || S.state === 'grab') lab = PINCH_LABEL[PN.finger] || '';
  else if (S.state === 'paused') lab = 'PAUSED · SHOW PALM 1s';
  else if (S.state === 'lost') lab = 'NO HAND';
  else if (S.state === 'scroll') lab = 'SCROLL';
  else if (S.state === 'drag') lab = PN.mode === 'scroll' ? 'SCROLL' : 'DRAG';
  else if (S.state === 'zoom') lab = 'ZOOM';
  if (U.lab.textContent !== lab) U.lab.textContent = lab;
}
function pause() {
  releaseAll(); S.paused = true; cursorState('paused'); setHot(null); status('PAUSED'); U.cam.classList.add('pause'); U.cam.classList.remove('live');
  toast('Finger mode paused. Hold an open palm for a second to resume.');
}
function resume() {
  S.paused = false; S.fresh = true; cursorState('point'); status('LIVE'); U.cam.classList.remove('pause'); U.cam.classList.add('live'); note('RESUMED');
}
function moveCursor(lm, t, now) {
  var p = mapXY(lm[8].x, lm[8].y);
  if (S.fresh) { FX.reset(); FY.reset(); S.hist.length = 0; S.fresh = false; }
  S.cx = FX.f(p[0], t); S.cy = FY.f(p[1], t);
  S.hist.push([now, S.cx, S.cy]); if (S.hist.length > 18) S.hist.shift();
  if (Math.hypot(S.cx - S.lx, S.cy - S.ly) > 1.5) {
    S.lx = S.cx; S.ly = S.cy;
    var tg = elAt(S.cx, S.cy); if (tg) { ptr('pointermove', tg, S.cx, S.cy, 0, -1); mse('mousemove', tg, S.cx, S.cy, 0, 0); }
  }
}
function hoverDwell(now) {
  var tg = smart(S.cx, S.cy), it = tg && tg.closest ? tg.closest(INTERACT) : null;
  setHot(it);
  var typed = it && (it.tagName === 'TEXTAREA' || it.tagName === 'CANVAS' || (it.tagName === 'INPUT' && /^(text|search|number|password|email|url|tel|range)$/.test(it.type)));
  if (P.dwell && it && !typed) {
    var d = S.dw;
    if (d.el !== it || Math.hypot(S.cx - d.x, S.cy - d.y) > 26) { S.dw = { el: it, x: S.cx, y: S.cy, t: now, done: false }; }
    else if (!d.done) {
      var f = (now - d.t - 250) / DWELL_MS; S.prog = Math.max(0, f);
      if (f >= 1) { d.done = true; S.prog = 0; clickAt(S.cx, S.cy, false); note('CLICK'); }
    }
  } else S.dw.el = null;
}
function primary(h, now) {
  var a = h.a, lm = h.lm, t = now / 1000;
  S.prog = 0;
  var pf = pinchState(a, PN.on ? PN.finger : -1);
  var pose = stableTo(pf >= 0 ? 'pinch' : a.pose); S.pose = pose;
  var hold = holdTime(pose, now);
  if (U.pose) U.pose.textContent = pose === 'pinch' ? 'PINCH · ' + PINCH_LABEL[pf >= 0 ? pf : PN.finger] : pose.toUpperCase();
  if (S.paused) {
    cursorState('paused'); S.prog = pose === 'palm' ? hold / 1 : 0;
    if (pose === 'palm' && hold >= 1 && !S.holdDone) { S.holdDone = true; resume(); }
    drawCursor(now); return;
  }
  if (pf >= 0 || PN.on) { pinchStep(h, pf, now); drawCursor(now); return; }
  var pointing = pose === 'point' || pose === 'other';
  if (pointing && now >= S.freezeUntil) { moveCursor(lm, t, now); cursorState('point'); hoverDwell(now); }
  else if (!pointing) { S.fresh = true; if (pose !== 'peace' && pose !== 'palm') cursorState('idle'); }
  if (pose === 'peace') { peaceScroll(lm, now); cursorState('scroll'); } else S.pp = null;
  if (pose === 'palm') { swipe(lm, now); cursorState('idle'); } else S.ph.length = 0;
  if (pose === 'fist') { S.prog = hold / 1.2; if (hold >= 1.2 && !S.holdDone) { S.holdDone = true; pause(); } }
  if (pose === 'up' || pose === 'down') {
    S.prog = hold / .8;
    if (hold >= .8 && !S.holdDone) {
      S.holdDone = true; var jp = $('jv-panel');
      if (W.__jarvis && typeof W.__jarvis.run === 'function' && jp && !jp.hidden) { W.__jarvis.run(pose === 'up' ? 'yes' : 'no'); note(pose === 'up' ? 'YES' : 'NO'); }
      else note('OPEN JARVIS FIRST');
    }
  }
  if (!pointing && pose !== 'peace') setHot(null);
  drawCursor(now);
}
function lost(now) {
  if (!S.lostAt) S.lostAt = now;
  if (now - S.lostAt > 260) { if (PN.on || MV) releaseAll(); endZoom(); S.fresh = true; S.pose = ''; S.hp = ''; setHot(null); if (!S.paused) cursorState('lost'); }
  if (U.hands) U.hands.textContent = 'NO HAND'; if (U.pose) U.pose.textContent = '—';
  drawCursor(now);
}
function process(res, now) {
  var L = res.landmarks || [], HD = res.handednesses || res.handedness || [], hands = [], i;
  for (i = 0; i < L.length; i++) {
    var key = (HD[i] && HD[i][0] && HD[i][0].categoryName) || ('h' + i);
    hands.push({ lm: L[i], key: key, a: analyse(L[i]) });
  }
  drawSkeleton(hands);
  S.nHands = hands.length;
  if (!hands.length) { lost(now); return; }
  S.lostAt = 0; if (U.hands) U.hands.textContent = hands.length + (hands.length > 1 ? ' HANDS' : ' HAND');
  if (hands.length === 2 && !S.paused && zoomStep(hands, now)) { drawCursor(now); if (U.pose) U.pose.textContent = 'ZOOM'; return; }
  endZoom();
  var prim = hands[0];
  if (hands.length === 2) {
    var same = hands.filter(function (h) { return h.key === S.pk; })[0];
    prim = same || (hands[0].a.scale >= hands[1].a.scale ? hands[0] : hands[1]);
  }
  S.pk = prim.key;
  primary(prim, now);
}

/* ---------------------------------------------------------------- camera preview skeleton */
function drawSkeleton(hands) {
  if (!P.cam || !U.cx) return;
  var vw = U.cv.clientWidth, vh = U.cv.clientHeight, dpr = Math.min(W.devicePixelRatio || 1, 2);
  if (U.cv.width !== Math.round(vw * dpr)) { U.cv.width = Math.round(vw * dpr); U.cv.height = Math.round(vh * dpr); }
  var c = U.cx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, vw, vh); c.lineCap = 'round';
  hands.forEach(function (h) {
    var lm = h.lm, pf = pinchState(h.a, PN.on && h.key === S.pk ? PN.finger : -1);
    c.lineWidth = 2; c.strokeStyle = 'rgba(120,225,255,.9)'; c.beginPath();
    CONN.forEach(function (e) { c.moveTo((1 - lm[e[0]].x) * vw, lm[e[0]].y * vh); c.lineTo((1 - lm[e[1]].x) * vw, lm[e[1]].y * vh); });
    c.stroke();
    for (var i = 0; i < 21; i++) {
      var tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20, hot = pf >= 0 && (i === 4 || i === TIPS[pf]);
      c.fillStyle = hot ? '#ff6a3d' : tip ? '#ffffff' : 'rgba(120,225,255,.9)';
      c.beginPath(); c.arc((1 - lm[i].x) * vw, lm[i].y * vh, hot ? 5 : tip ? 3.2 : 2.2, 0, 6.2832); c.fill();
    }
  });
}

/* ---------------------------------------------------------------- loop, load, start / stop */
function loop() {
  if (!S.on) return;
  S.raf = requestAnimationFrame(loop);
  if (D.hidden) return;
  var v = S.video, now = performance.now();
  if (!S.lm || v.readyState < 2 || now - S.lastDet < S.minDt || v.currentTime === S.lastVT) return;
  S.lastVT = v.currentTime; S.lastDet = now;
  var res;
  try { res = S.lm.detectForVideo(v, now); S.errs = 0; }
  catch (e) { if (++S.errs > 25) { toast('Hand tracking stopped: ' + (e && e.message), 'danger'); stop(); } return; }
  try { process(res, now); } catch (e) { if (W.console) console.warn('finger', e); }
  S.fpsN++; if (now - S.fpsT > 1000) { S.fps = S.fpsN; S.fpsN = 0; S.fpsT = now; if (U.fps) U.fps.textContent = S.fps + ' FPS'; }
}
async function loadLandmarker() {
  var err, i;
  for (i = 0; i < LIBS.length; i++) {
    try {
      var mod = await import(LIBS[i]), fs = await mod.FilesetResolver.forVisionTasks(WASM[i]);
      var mk = function (del) { return mod.HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: del }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .55, minHandPresenceConfidence: .5, minTrackingConfidence: .5 }); };
      try { return await mk('GPU'); } catch (e) { return await mk('CPU'); }
    } catch (e) { err = e; }
  }
  throw err || new Error('the hand model could not be loaded');
}
async function start() {
  if (S.on || S.loading) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot open the camera.', 'danger'); return; }
  if (W.isSecureContext === false) { toast('The camera needs a secure (https) address.', 'danger'); return; }
  S.loading = true; fabState(); buildUI(); U.cam.classList.add('show'); status('STARTING CAMERA…');
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
    S.video = U.video; S.video.srcObject = S.stream; await S.video.play();
    if (S.video.videoWidth) { S.AR = S.video.videoWidth / S.video.videoHeight; U.cam.querySelector('.vw').style.aspectRatio = S.video.videoWidth + ' / ' + S.video.videoHeight; }
    if (!S.lm) { status(lsGet('fg_seen') === '1' ? 'LOADING MODEL…' : 'DOWNLOADING MODEL (ONCE)…'); if (lsGet('fg_seen') !== '1') toast('Downloading the hand-tracking model, about 8 MB, one time only.'); S.lm = await loadLandmarker(); }
    S.on = true; S.paused = false; S.fresh = true; S.errs = 0; S.lastVT = -1; S.fpsT = performance.now();
    S.minDt = (W.perf && typeof W.perf.level === 'number' && W.perf.level >= 1) ? 50 : 33;
    status('LIVE'); U.cam.classList.add('live'); U.cam.classList.remove('pause'); cursorState('idle'); prefsUI(); drawCursor(performance.now());
    S.raf = requestAnimationFrame(loop);
    if (lsGet('fg_seen') !== '1') { lsSet('fg_seen', '1'); guide(true); } else toast('Finger mode on. Point to move, pinch to click.');
  } catch (e) {
    var msg = e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for this site and try again.' : e && e.name === 'NotFoundError' ? 'No camera found on this device.' : 'Finger mode could not start: ' + ((e && e.message) || e);
    toast(msg, 'danger'); S.loading = false; S.on = true; stop(); return;
  }
  S.loading = false; fabState();
}
function stop() {
  var was = S.on; S.on = false; S.loading = false; cancelAnimationFrame(S.raf); cancelAnimationFrame(S.momRaf); S.momRaf = 0;
  try { releaseAll(); } catch (e) { }
  endZoom(); setHot(null); clearLayoutDom();
  if (S.stream) { S.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } }); S.stream = null; }
  if (S.video) { try { S.video.pause(); S.video.srcObject = null; } catch (e) { } }
  if (U.cam) { U.cam.classList.remove('show', 'live', 'pause'); }
  if (U.cur) U.cur.classList.remove('on');
  if (U.guide) U.guide.classList.remove('show');
  S.paused = false; PN.on = false; fabState();
  if (was) toast('Finger mode off.');
}
function toggle() { if (S.on || S.loading) stop(); else start(); }
function statusInfo() { return { on: S.on, paused: S.paused, hands: S.nHands, fps: S.fps, pose: S.pose, state: S.state, sens: SENS_NAME[P.sens], dwell: P.dwell, moved: Object.keys(LAY).length }; }

/* ---------------------------------------------------------------- keyboard + boot */
D.addEventListener('keydown', function (e) {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  if (e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); toggle(); }
}, true);
D.addEventListener('visibilitychange', function () { if (D.hidden && S.on) { releaseAll(); } });
function boot() { fab(); setInterval(applyLayout, 2500); }
if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot); else boot();

W.FINGER = { version: 1, start: start, stop: stop, toggle: toggle, status: statusInfo, guide: guide, resetLayout: resetLayout, _t: { analyse: analyse, pinchState: pinchState, mapXY: mapXY } };
})();
