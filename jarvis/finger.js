/* finger.js v4 — FINGER MODE for Discipline OS. Relaxed hand: no pointing, no holding your arm up, every gesture looks different.
   It sends the same events a mouse would, so every button, tab, canvas (Muscle Map / Holo body), slider and scroll area just works.

   GESTURES (one hand, the one that is clearest to the camera)
     🖐  RELAXED HAND   any loose hand moves the cursor (it follows the centre of your palm, so you never have to point)
     🖐  OPEN PALM      hold it still ~2.2 s = open Jarvis (a ring fills up)
     ✊  SQUEEZE        open hand, then close it quickly into a loose fist and open again = CLICK · twice = DOUBLE CLICK
                         keep it closed and move = DRAG (rotates the 3D body, moves sliders, scrolls like a touch screen)
                         keep it closed and still 1 s on a card, then move = MOVE THE CARD (remembered)
                         keep it closed and completely still ~3 s = PAUSE
     ✌  TWO FINGERS    move the hand up / down = SCROLL (the menu if it is open) · quick flick to the RIGHT = open menu, LEFT = close it
     🤟  THREE FINGERS  hold 0.7 s = BACK (close window / menu / go Home)
     🤏  PINCH ZOOM     thumb + index (and / or middle): touch and open = ZOOM IN · open and close = ZOOM OUT
     👍 👎  THUMBS       hold 0.8 s = YES / NO to Jarvis (when his panel is open)
     ✊  FIST           hold a fist 3 s = PAUSE · hold an open palm 1 s = RESUME

   Start / stop: the ✋ button (bottom right), Shift+F, or say “Jarvis, turn on finger mode” / “turn off finger mode”.
   Console: FINGER.start() · FINGER.stop() · FINGER.toggle() · FINGER.status() · FINGER.guide() · FINGER.resetLayout()
   Tracking runs on this device with MediaPipe Hands (a one-time ~8 MB model download, then cached). No video ever leaves the device. */
(function () {
'use strict';
if (window.FINGER) return;
var W = window, D = document, H = D.documentElement;

/* ================================================================ COLOURS: change them here, everything follows */
var THEME = {
  accent: '#9d7bff',                 // main colour: cursor ring, panel border, highlights
  accent2: '#e4d9ff',                // light version of the accent (text, outlines)
  ok: '#b8ff4a',                     // "live" dot, cursor centre, fingertips on the hand drawing
  hot: '#ffc233',                    // pinching / paused
  pink: '#ff5fa2',                   // zoom + grab
  panel: 'rgba(14,10,28,.86)',       // pill / guide background
  line: 'rgba(157,123,255,.38)',     // panel borders
  text: '#f2eeff', muted: '#a79cc8',
  /* the drawing around your hand (camera preview) */
  bone: '#a78bff', boneGlow: 'rgba(167,139,255,.75)', palm: 'rgba(157,123,255,.14)', joint: '#f3edff', tip: '#b8ff4a', ink: '#0b0618'
};

/* ================================================================ config */
var MP_VER = '0.10.14';
var LIBS = ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER + '/vision_bundle.mjs', 'https://unpkg.com/@mediapipe/tasks-vision@' + MP_VER + '/vision_bundle.mjs'];
var WASM = ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER + '/wasm', 'https://unpkg.com/@mediapipe/tasks-vision@' + MP_VER + '/wasm'];
var MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
var MARGINS = [.10, .18, .26];                 // how much of the camera frame edge is ignored: bigger = less hand movement needed
var SENS_NAME = ['WIDE', 'NORMAL', 'FAST'];
var DWELL_MS = 1100;
var PINCH_IN = .32, PINCH_OUT = .50;           // thumb-to-finger distance / palm size: below IN = pinch starts, above OUT = pinch ends
var ZOOM_IN = .38, ZOOM_OUT = .56;             // same idea for the two-hand zoom pinch
var ZOOM_STEP = Math.log(1.12);                // hands change distance by 12% = one zoom step
var JARVIS_HOLD = 2200;                        // open palm held still this long (ms) = open Jarvis
var ZOOM_GAP = 90;                             // minimum ms between two zoom steps (keeps Jarvis from being spammed)
var PANEL_SEL = '.dash-card,.home-stat-box,.wd-card,.bunk-bank-card,.punish-card,.aar-card,.timer-card,.detailed-breakdown-card,.schedule-day-col,.exc-card,.hero-quote,.hero-streak,.hl-panel,.hl-stage,.mm-p,.ops-card,.stark-hud,.gym-ex-block,.qp,.table-wrapper,.month-selector,.wd-item,.ach-badge,.punish-log-item';
var INTERACT = 'button,a[href],input,select,textarea,summary,label,[onclick],[role="button"],.nav-btn,.th-row,.wd-pill,.wd-chip,.wd-date,.ins-tab,.ins-chip,.gym-hud-tab,.gym-metric-btn,.gym-pick-chip,.qp-btn,.pl-item,.hamburger,.scroll-level-btn,.class-attendance-btn,.cell-check,.event-action-btn,.mm-row,.hl-chip,.mm-ctl button,canvas';
var CONN = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
var TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18];

/* ================================================================ tiny helpers */
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

/* ================================================================ state */
var P = {                                                  // saved preferences
  dwell: lsGet('fg_dwell') === '1',
  cam: lsGet('fg_cam') === 'v3',                           // camera preview is OFF by default (old saved values are ignored on purpose)
  big: lsGet('fg_size') === 'v3',
  sens: (function () { var v = parseInt(lsGet('fg_sens'), 10); return v >= 0 && v <= 2 ? v : 1; })()
};
var S = {
  on: false, loading: false, paused: false, lm: null, stream: null, video: null, raf: 0, rraf: 0, lastDet: 0, lastVT: -1, minDt: 0, errs: 0, AR: 4 / 3,
  cx: innerWidth / 2, cy: innerHeight / 2, lx: 0, ly: 0, rx: null, ry: null, rt: 0, hist: [], fresh: true, freezeUntil: 0, prog: 0, state: 'idle', note: '', noteT: 0,
  pose: '', cand: '', cnt: 0, hp: '', hpT: 0, holdDone: false, lostAt: 0, nHands: 0, pk: '', actT: 0, lastClick: 0, lastCP: [0, 0], tok: 0, vx: 0, vy: 0, mt: 0, mvT: 0, hvT: 0, pvel: 0, pmiss: 0, ch: [], pa: null, paT: 0, paDone: false, squeezeCool: 0,
  dw: { el: null, x: 0, y: 0, t: 0, done: false }, hot: null, pp: null, ph: [], fps: 0, fpsN: 0, fpsT: 0, pz: 1, vel: [0, 0], momRaf: 0, momTgt: null
};
var PN = { on: false, finger: -1, t0: 0, c0: [0, 0], m0: [0, 0], dragging: false, mode: '', tgt: null, last: [0, 0], vel: [0, 0], vt: 0, cancel: false, armMove: false };
var MV = null;                                             // panel being moved
var Z = { on: false, bad: 0, acc: 0, prev: 0, t: 0, lt: 0, mx: 0, lab: 'ZOOM', f: null };   // two-hand zoom
var LAY = (function () { try { return JSON.parse(lsGet('fg_layout') || '{}') || {}; } catch (e) { return {}; } })();
var U = {};                                                // DOM handles

/* ================================================================ One-Euro filter: smooth when slow, instant when fast
   minC = smoothness at rest (lower = steadier), beta = how fast it "opens up" when you move, dc = speed-estimate cutoff */
function Euro(minC, beta, dc) { this.minC = minC; this.beta = beta; this.dc = dc || 1; this.px = null; this.dx = 0; this.pt = 0; }
Euro.prototype.reset = function () { this.px = null; this.dx = 0; this.pt = 0; };
function alphaOf(cut, dt) { var tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
Euro.prototype.f = function (x, t) {
  if (this.px === null) { this.px = x; this.pt = t; this.dx = 0; return x; }
  var dt = Math.max(1e-3, Math.min(.25, t - this.pt)); this.pt = t;
  var raw = (x - this.px) / dt; this.dx += alphaOf(this.dc, dt) * (raw - this.dx);
  var cut = this.minC + this.beta * Math.abs(this.dx);
  this.px += alphaOf(cut, dt) * (x - this.px);
  return this.px;
};
var FX = new Euro(1.9, .13, 6), FY = new Euro(1.9, .13, 6), PFX = new Euro(1.9, .09, 6), PFY = new Euro(1.9, .09, 6), SE = new Euro(2.6, .6, 5);
Z.f = new Euro(2.5, 3, 4);                                 // works on log(distance between the hands)
function ksc() { return 1400 / Math.max(360, innerWidth); } // filter in "1400px-wide" units so it feels the same on every screen

/* ================================================================ styles + UI */
function css() {
  if ($('fg-css')) return;
  var T = THEME, s = el('style'); s.id = 'fg-css';
  s.textContent = [
    ':root{--fg-a:' + T.accent + ';--fg-a2:' + T.accent2 + ';--fg-ok:' + T.ok + ';--fg-hot:' + T.hot + ';--fg-pk:' + T.pink + ';--fg-bg:' + T.panel + ';--fg-ln:' + T.line + ';--fg-tx:' + T.text + ';--fg-mu:' + T.muted + '}',
    /* cursor */
    '#fg-cursor{position:fixed;left:0;top:0;width:0;height:0;z-index:21100;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform}',
    '#fg-cursor.on{opacity:1}',
    '#fg-cursor .c{position:absolute;left:-26px;top:-26px;width:52px;height:52px;transition:transform .14s cubic-bezier(.2,.8,.2,1),opacity .2s}',
    '#fg-cursor svg{width:100%;height:100%;overflow:visible;display:block}',
    '#fg-cursor .rg{fill:rgba(157,123,255,.08);stroke:var(--fg-a2);stroke-width:2;filter:drop-shadow(0 0 6px var(--fg-a))}',
    '#fg-cursor .r2{fill:none;stroke:var(--fg-a);stroke-width:1.2;stroke-dasharray:3 6;opacity:.8;transform-origin:26px 26px;animation:fgSpin 8s linear infinite}',
    '#fg-cursor .dw{fill:none;stroke:var(--fg-ok);stroke-width:4;stroke-linecap:round;transform:rotate(-90deg);transform-origin:26px 26px;stroke-dasharray:0 200}',
    '#fg-cursor i{position:absolute;left:-3.5px;top:-3.5px;width:7px;height:7px;border-radius:50%;background:var(--fg-ok);box-shadow:0 0 10px var(--fg-ok),0 0 0 2px rgba(11,6,24,.6)}',
    '#fg-cursor b{position:absolute;left:34px;top:12px;white-space:nowrap;font:700 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;color:var(--fg-a2);text-shadow:0 0 8px #000,0 0 6px var(--fg-a)}',
    '#fg-cursor[data-s=pinch] .c{transform:scale(.55)}#fg-cursor[data-s=pinch] .rg{stroke:var(--fg-hot);fill:rgba(255,194,51,.22)}',
    '#fg-cursor[data-s=drag] .c{transform:scale(.5)}#fg-cursor[data-s=drag] .rg{stroke:#fff;fill:rgba(255,255,255,.2)}',
    '#fg-cursor[data-s=grab] .c{transform:scale(.7) rotate(45deg)}#fg-cursor[data-s=grab] .rg{stroke:var(--fg-pk);fill:rgba(255,95,162,.2)}',
    '#fg-cursor[data-s=scroll] .c{transform:scaleY(1.35) scaleX(.7)}',
    '#fg-cursor[data-s=zoom] .c{transform:scale(1.25)}#fg-cursor[data-s=zoom] .rg{stroke:var(--fg-pk)}',
    '#fg-cursor[data-s=paused] .c,#fg-cursor[data-s=lost] .c{opacity:.35}',
    '@keyframes fgSpin{to{transform:rotate(360deg)}}',
    '.fg-hot{outline:2px solid var(--fg-a2)!important;outline-offset:3px!important}',
    '.fg-moving{z-index:900!important;box-shadow:0 30px 60px -10px rgba(0,0,0,.75),0 0 0 2px var(--fg-a)!important;transition:none!important;opacity:.97}',
    '.fg-rip{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid var(--fg-ok);pointer-events:none;z-index:21090;animation:fgRip .5s ease-out forwards}',
    '@keyframes fgRip{to{transform:scale(4.5);opacity:0}}',
    /* round button */
    '#fg-fab{position:fixed;right:80px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:951;width:48px;height:48px;border-radius:50%;cursor:pointer;display:grid;place-items:center;font-size:21px;line-height:1;color:var(--fg-tx);background:var(--fg-bg);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1.5px solid var(--fg-ln);box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 16px -6px var(--fg-a);transition:transform .15s,box-shadow .2s,border-color .2s}',
    '#fg-fab:hover{transform:scale(1.08)}#fg-fab.on{border-color:var(--fg-ok);box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 20px -2px var(--fg-ok)}#fg-fab.load{animation:fgSpin 1.2s linear infinite}',
    '@media(max-width:640px){#fg-fab{right:66px;width:42px;height:42px;font-size:18px}}',
    /* compact dock: small preview (hidden by default) + pill */
    '#fg-cam{position:fixed;right:16px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:21050;display:none;flex-direction:column;align-items:flex-end;gap:7px;font-family:var(--font-body,system-ui,sans-serif);color:var(--fg-tx)}',
    '#fg-cam.show{display:flex}',
    '#fg-cam .pv{position:relative;width:148px;aspect-ratio:4/3;border-radius:16px;overflow:hidden;background:#07040f;border:1px solid var(--fg-ln);box-shadow:0 10px 28px rgba(0,0,0,.55),0 0 20px -8px var(--fg-a)}',
    '#fg-cam .pv.big{width:236px}',
    '#fg-cam .pv.off{position:absolute;right:0;bottom:0;width:2px;height:2px;aspect-ratio:auto!important;opacity:0;pointer-events:none;border:0;box-shadow:none}',
    '#fg-cam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);opacity:.9}',
    '#fg-cam canvas{position:absolute;inset:0;width:100%;height:100%}',
    '#fg-cam .hn{position:absolute;left:6px;bottom:5px;padding:3px 7px;border-radius:99px;background:rgba(11,6,24,.62);font:600 8px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--fg-a2);white-space:nowrap}',
    '#fg-cam .pill{display:flex;align-items:center;gap:4px;padding:4px 5px 4px 12px;border-radius:999px;background:var(--fg-bg);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--fg-ln);box-shadow:0 8px 24px rgba(0,0,0,.5)}',
    '#fg-cam .st{font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--fg-a2);white-space:nowrap}',
    '#fg-cam .st::before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--fg-mu)}',
    '#fg-cam.live .st::before{background:var(--fg-ok);box-shadow:0 0 8px var(--fg-ok)}#fg-cam.pause .st::before{background:var(--fg-hot);box-shadow:0 0 8px var(--fg-hot)}',
    '#fg-cam .ps{min-width:46px;max-width:96px;margin-right:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--fg-mu)}',
    '#fg-cam .ib{width:28px;height:28px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:rgba(157,123,255,.15);color:var(--fg-tx);font-size:13px;line-height:1;cursor:pointer;transition:background .15s}',
    '#fg-cam .ib:hover{background:rgba(157,123,255,.32)}#fg-cam .ib.on{background:var(--fg-a);color:#12082b}',
    '#fg-cam .more{display:none;flex-wrap:wrap;justify-content:flex-end;gap:5px;max-width:270px}',
    '#fg-cam.open .more{display:flex}',
    '#fg-cam .more button{padding:6px 10px;border-radius:99px;border:1px solid var(--fg-ln);background:var(--fg-bg);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:var(--fg-tx);font:700 8.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;cursor:pointer}',
    '#fg-cam .more button:hover{border-color:var(--fg-a)}#fg-cam .more button.on{background:var(--fg-a);color:#12082b;border-color:var(--fg-a)}',
    /* zoom overlay */
    '#fg-zoom{position:fixed;inset:0;z-index:21095;pointer-events:none;display:none}#fg-zoom.on{display:block}',
    '#fg-zoom svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '#fg-zoom line{stroke:var(--fg-pk);stroke-width:2;stroke-dasharray:6 6;filter:drop-shadow(0 0 4px var(--fg-pk))}',
    '#fg-zoom circle{fill:rgba(255,95,162,.2);stroke:var(--fg-pk);stroke-width:2}',
    '#fg-zoom b{position:absolute;transform:translateX(-50%);padding:5px 11px;border-radius:99px;background:rgba(14,10,28,.88);border:1px solid var(--fg-pk);font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#fff;white-space:nowrap}',
    '#fg-zoom.solo svg{display:none}',
    /* guide */
    '#fg-guide{position:fixed;right:16px;top:calc(76px + env(safe-area-inset-top,0px));z-index:21060;width:min(340px,92vw);max-height:calc(100vh - 120px);overflow:auto;padding:14px 14px 12px;border-radius:18px;background:var(--fg-bg);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--fg-ln);box-shadow:0 20px 50px rgba(0,0,0,.65);font-family:var(--font-body,system-ui,sans-serif);color:var(--fg-tx);display:none}',
    '#fg-guide.show{display:block}',
    '#fg-guide h4{margin:0 0 8px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.2em;color:var(--fg-a);display:flex;justify-content:space-between;align-items:center}',
    '#fg-guide h4 button{background:rgba(157,123,255,.15);border:0;border-radius:99px;color:var(--fg-tx);cursor:pointer;padding:5px 11px;font:inherit;font-size:9px}',
    '#fg-guide .g{display:grid;grid-template-columns:34px 1fr;gap:2px 10px;align-items:center;padding:6px 0;border-top:1px solid rgba(157,123,255,.16)}',
    '#fg-guide .g span{font-size:21px;text-align:center}#fg-guide .g b{display:block;font:700 10.5px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--fg-a2)}#fg-guide .g em{font-style:normal;font-size:12px;color:var(--fg-mu);line-height:1.35}',
    '#fg-guide p{margin:8px 0 0;font-size:11px;color:var(--fg-mu);line-height:1.45}',
    'html.fx-lite #fg-cursor .r2,html.fx-lite #fg-fab.load{animation:none}',
    '@media(prefers-reduced-motion:reduce){#fg-cursor .r2,.fg-rip,#fg-fab.load{animation:none}}',
    '@media print{#fg-cursor,#fg-cam,#fg-guide,#fg-fab,#fg-zoom{display:none!important}}'
  ].join('\n');
  (D.head || H).appendChild(s);
}
var GUIDE = [
  ['🖐️', 'MOVE', 'Just hold your hand loosely in front of the camera. The ring follows the centre of your palm. No pointing needed.'],
  ['✊', 'SQUEEZE = CLICK', 'Open your hand, then close it quickly into a loose fist and open it again. Twice quickly = double click.'],
  ['✊', 'SQUEEZE + MOVE', 'Stay closed and move: drags sliders, rotates the 3D body, scrolls like a touch screen. Closed and still for 1 s on a card, then move = carry the card.'],
  ['🖐️', 'JARVIS', 'Hold an open palm still for about 2 seconds. The ring fills up, then Jarvis opens.'],
  ['✌️', 'SCROLL', 'Two fingers up, move the hand up or down to scroll (works inside the menu too).'],
  ['↔️', 'MENU', 'With two fingers up, flick your hand quickly RIGHT to open the menu and LEFT to close it.'],
  ['🤟', 'BACK', 'Three fingers up for a moment: closes the window or menu, or goes Home.'],
  ['🤏', 'ZOOM', 'Thumb + index (or middle): touch and open = zoom in, open and close = zoom out. Fingertips rising helps it understand.'],
  ['👍', 'YES / NO', 'Hold a thumb up or down for a second when Jarvis is asking you something.'],
  ['⏸️', 'PAUSE', 'Squeeze and stay completely still ~3 s (or hold a fist 3 s). Open palm for 1 s to resume.']
];
function buildUI() {
  if (U.built) return;
  css();
  U.cur = el('div', null, '<div class="c"><svg viewBox="0 0 52 52"><circle class="r2" cx="26" cy="26" r="24"/><circle class="rg" cx="26" cy="26" r="17"/><circle class="dw" cx="26" cy="26" r="22"/></svg></div><i></i><b></b>');
  U.cur.id = 'fg-cursor'; U.cur.setAttribute('aria-hidden', 'true'); D.body.appendChild(U.cur);
  U.dw = U.cur.querySelector('.dw'); U.lab = U.cur.querySelector('b');
  U.cam = el('div', null,
    '<div class="pv off"><video muted playsinline></video><canvas></canvas><span class="hn"><span id="fg-hands">NO HAND</span> · <span id="fg-fps">0 FPS</span></span></div>' +
    '<div class="more"><button data-a="dwell" title="Hold the ring on a button to click it">DWELL</button><button data-a="sens" title="How far your hand has to travel">REACH</button><button data-a="size" title="Size of the camera preview">PREVIEW</button><button data-a="reset" title="Put moved panels back">RESET PANELS</button><button data-a="guide" title="Gesture guide">GUIDE</button></div>' +
    '<div class="pill"><span class="st" id="fg-st">OFF</span><span class="ps" id="fg-pose">—</span><button class="ib" data-a="cam" title="Show / hide the camera preview">📷</button><button class="ib" data-a="more" title="Settings">⚙</button><button class="ib" data-a="off" title="Turn finger mode off">✕</button></div>');
  U.cam.id = 'fg-cam'; D.body.appendChild(U.cam);
  U.pv = U.cam.querySelector('.pv'); U.video = U.cam.querySelector('video'); U.cv = U.cam.querySelector('canvas'); U.cx = U.cv.getContext('2d');
  U.st = $('fg-st'); U.hands = $('fg-hands'); U.pose = $('fg-pose'); U.fps = $('fg-fps');
  U.zm = el('div', null, '<svg><line x1="0" y1="0" x2="0" y2="0"/><circle r="11" cx="0" cy="0"/><circle r="11" cx="0" cy="0"/></svg><b>ZOOM</b>');
  U.zm.id = 'fg-zoom'; D.body.appendChild(U.zm);
  U.zl = U.zm.querySelector('line'); U.zc = U.zm.querySelectorAll('circle'); U.zlab = U.zm.querySelector('b');
  U.guide = el('div', null, '<h4><span>FINGER MODE · GESTURES</span><button type="button" data-a="gclose">CLOSE</button></h4>' +
    GUIDE.map(function (g) { return '<div class="g"><span>' + g[0] + '</span><div><b>' + g[1] + '</b><em>' + g[2] + '</em></div></div>'; }).join('') +
    '<p>Tips: sit about an arm\'s length from the camera with light on your hand. Use your clearest hand. The camera preview is hidden: tap 📷 on the pill to see it. Press Shift+F or say “turn off finger mode” to stop. Nothing is recorded; tracking runs on this device.</p>');
  U.guide.id = 'fg-guide'; D.body.appendChild(U.guide);
  U.cam.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) camAct(b.dataset.a); });
  U.guide.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) guide(false); });
  U.built = true; prefsUI();
}
function prefsUI() {
  if (!U.built) return;
  var b = function (a) { return U.cam.querySelector('[data-a="' + a + '"]'); };
  b('dwell').classList.toggle('on', P.dwell); b('dwell').textContent = 'DWELL ' + (P.dwell ? 'ON' : 'OFF');
  b('sens').textContent = 'REACH · ' + SENS_NAME[P.sens];
  b('size').classList.toggle('on', P.big); b('size').textContent = 'PREVIEW · ' + (P.big ? 'BIG' : 'SMALL');
  b('cam').classList.toggle('on', P.cam); b('more').classList.toggle('on', U.cam.classList.contains('open'));
  U.pv.classList.toggle('off', !P.cam); U.pv.classList.toggle('big', P.big);
}
function camAct(a) {
  if (a === 'dwell') { P.dwell = !P.dwell; lsSet('fg_dwell', P.dwell ? '1' : '0'); note(P.dwell ? 'DWELL CLICK ON' : 'DWELL CLICK OFF'); }
  else if (a === 'sens') { P.sens = (P.sens + 1) % 3; lsSet('fg_sens', String(P.sens)); note('REACH: ' + SENS_NAME[P.sens]); }
  else if (a === 'cam') { P.cam = !P.cam; lsSet('fg_cam', P.cam ? 'v3' : '0'); }
  else if (a === 'size') { P.big = !P.big; lsSet('fg_size', P.big ? 'v3' : '0'); if (!P.cam) { P.cam = true; lsSet('fg_cam', 'v3'); } }
  else if (a === 'more') U.cam.classList.toggle('open');
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
  b.addEventListener('click', function () { toggle(); }); D.body.appendChild(b);
}
function fabState() { var b = $('fg-fab'); if (!b) return; b.classList.toggle('on', S.on); b.classList.toggle('load', S.loading); }
function status(t) { if (U.st) U.st.textContent = t; }
function note(t) { S.note = t; S.noteT = performance.now() + 1400; }

/* ================================================================ hand maths
   Distances use the 3D "world" landmarks when MediaPipe provides them (so tilting / turning the hand does not change the numbers),
   and fall back to the flat camera image otherwise. */
function dd(a, b) { return Math.hypot((a.x - b.x) * S.AR, a.y - b.y); }
function d3(a, b) { var x = a.x - b.x, y = a.y - b.y, z = (a.z || 0) - (b.z || 0); return Math.sqrt(x * x + y * y + z * z); }
function analyse(lm, wl) {
  var w3 = !!(wl && wl.length >= 21), q = w3 ? wl : lm, df = w3 ? d3 : dd;
  var scale = df(q[0], q[9]) || .001, ext = [], rt = [], pr = [], i;
  for (i = 0; i < 4; i++) {
    var tipD = df(q[0], q[TIPS[i]]), pipD = df(q[0], q[PIPS[i]]);
    rt[i] = tipD / scale; ext[i] = tipD > pipD * 1.12 && rt[i] > (i === 3 ? 1.35 : 1.5);
    pr[i] = df(q[4], q[TIPS[i]]) / scale;
  }
  var thumbExt = df(q[4], q[5]) / scale > .85 && df(q[4], q[17]) > df(q[3], q[17]);
  var maxTip = Math.max(rt[0], rt[1], rt[2], rt[3]), anyExt = ext[0] || ext[1] || ext[2] || ext[3];
  var fist = !anyExt && maxTip < 1.3, pose = 'other';
  if (thumbExt && !anyExt && maxTip < 1.45 && lm[4].y < lm[3].y && lm[4].y < lm[2].y && lm[4].y < lm[5].y - .02) pose = 'up';
  else if (thumbExt && !anyExt && maxTip < 1.45 && lm[4].y > lm[3].y && lm[4].y > lm[0].y + .03) pose = 'down';
  else if (ext[0] && ext[1] && ext[2] && ext[3]) pose = 'palm';
  else if (ext[0] && ext[1] && ext[2] && !ext[3]) pose = 'three';
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
function isPinch0(a, th) { return a.pr[0] < th && (a.rt[0] > 1.08 || a.pr[0] < .16); }
function mapXY(nx, ny) {                                  // camera image (not mirrored) -> screen pixels, with the edges trimmed
  var m = MARGINS[P.sens], x = 1 - nx, sx = (x - m) / (1 - 2 * m), top = m * .9, bot = m * 1.6, sy = (ny - top) / (1 - top - bot);
  return [clamp(sx, 0, 1) * innerWidth, clamp(sy, 0, 1) * innerHeight];
}
function pinchMid(lm, f) { var t = lm[4], b = lm[TIPS[f]]; return mapXY((t.x + b.x) / 2, (t.y + b.y) / 2); }
function histAt(t) { for (var i = S.hist.length - 1; i >= 0; i--) if (S.hist[i][0] <= t) return [S.hist[i][1], S.hist[i][2]]; return S.hist.length ? [S.hist[0][1], S.hist[0][2]] : null; }

/* ================================================================ synthetic input (same events a real mouse makes) */
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

/* ================================================================ scrolling */
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
function openMenu() {
  if (typeof W.openDrawer === 'function') W.openDrawer();
  else if (typeof W.toggleDrawer === 'function') W.toggleDrawer();
  else { var b = $('menu-btn'); if (b) b.click(); }
  note('MENU');
}
/* two fingers up: move the hand up / down = scroll (the menu if it is open). A quick flick RIGHT opens the menu, LEFT closes it. */
function peaceScroll(lm, now) {
  if (!S.pp) SE.reset();
  var t = now / 1000, x = lm[9].x, y = SE.f(lm[9].y, t), p = S.pp; S.pp = [x, y, now];
  S.ph.push([now, x, y]); while (S.ph.length && now - S.ph[0][0] > 380) S.ph.shift();
  var dr = $('drawer'), open = !!(dr && dr.classList.contains('open'));
  if (S.ph.length >= 4 && now - S.actT > 900) {
    var a0 = S.ph[0], fx = -(x - a0[1]) * S.AR, fy = y - a0[2];            // fx > 0 = hand moved to your right
    if (Math.abs(fx) > .17 && Math.abs(fx) > Math.abs(fy) * 1.8) {
      if (fx > 0 && !open) { S.actT = now; S.ph.length = 0; S.pp = null; S.pvel = 0; openMenu(); return; }
      if (fx < 0 && open) { S.actT = now; S.ph.length = 0; S.pp = null; S.pvel = 0; if (typeof W.closeDrawer === 'function') W.closeDrawer(); note('MENU CLOSED'); return; }
    }
  }
  if (!p || now - p[2] > 150) return;
  var sx = Math.abs(x - p[0]) * S.AR, dyn = y - p[1], dt = Math.max(.008, (now - p[2]) / 1000);
  if (sx > Math.abs(dyn) * 1.5 && sx > .01) return;                          // a sideways flick is not a scroll
  if (Math.abs(dyn) < .0012) { S.pvel *= .5; return; }                       // tiny wobble: ignore
  var gain = 2.8 + clamp(Math.abs(dyn) / dt, 0, 2.2) * 1.5, dy = dyn * innerHeight * gain;   // slow = precise, fast = far
  S.pvel = S.pvel * .5 - dy / dt * .5;
  if (open) { try { dr.scrollBy({ top: -dy, behavior: 'instant' }); } catch (e) { dr.scrollTop -= dy; } }
  else doScroll(elAt(S.cx, S.cy), 0, -dy);
}
function peaceEnd() {                                      // two fingers put away: let the page glide on
  var dr = $('drawer');
  if (!(dr && dr.classList.contains('open')) && Math.abs(S.pvel) > 160) { S.vel = [0, S.pvel]; S.momTgt = elAt(S.cx, S.cy); momentumRun(); }
  S.pvel = 0;
}
/* ================================================================ app actions */
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
  S.pz = clamp(zoomNow() * (dir > 0 ? 1.1 : 1 / 1.1), .6, 2.2); H.style.zoom = String(S.pz);
}

/* ================================================================ panel moving (grab) */
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

/* ================================================================ SQUEEZE: click / drag / move a card
   Open your hand, then close it quickly into a loose fist (SQUEEZE). Open again = CLICK (twice quickly = double click).
   Keep it closed and move = DRAG: rotates the 3D body, moves sliders, scrolls like a touch screen.
   Keep it closed and still for 1 s on a card, then move = MOVE THE CARD (its place is remembered). */
function anchorN(lm) { var x = lm[0].x * .3 + (lm[5].x + lm[9].x + lm[13].x + lm[17].x) * .175, y = lm[0].y * .3 + (lm[5].y + lm[9].y + lm[13].y + lm[17].y) * .175; return { x: x, y: y }; }
function anchorXY(lm) { var c = anchorN(lm); return mapXY(c.x, c.y); }   // palm centre: does not jump when the fingers open / close
function dragMode(t) {
  if (!t || !t.closest) return 'scroll';
  if (t.closest('input[type=range]')) return 'range';
  if (t.closest('canvas,[data-fg="drag"]')) return 'pointer';
  return 'scroll';
}
function beginDrag(now) {
  PN.tgt = elAt(PN.c0[0], PN.c0[1]); PN.mode = dragMode(PN.tgt); PN.dragging = true; PN.last = [PN.c0[0], PN.c0[1]]; PN.vel = [0, 0]; PN.vt = now;
  if (PN.mode === 'scroll' && PN.armMove) {
    var pn = PN.tgt && PN.tgt.closest ? PN.tgt.closest(PANEL_SEL) : null;
    if (pn) { startMove(pn, PN.c0); PN.mode = 'move'; }
  }
  if (PN.mode === 'pointer' && PN.tgt) { ptr('pointerdown', PN.tgt, PN.c0[0], PN.c0[1], 1, 0); mse('mousedown', PN.tgt, PN.c0[0], PN.c0[1], 1, 0); }
  if (PN.mode === 'range' && PN.tgt) setRange(PN.tgt.closest('input[type=range]'), PN.c0[0]);
  cursorState(PN.mode === 'move' ? 'grab' : 'drag');
}
function dragStep(x, y, now) {
  var dx = x - PN.last[0], dy = y - PN.last[1]; PN.last = [x, y];
  if (PN.mode === 'move') { moveStep(x, y); return; }
  if (PN.mode === 'pointer' && PN.tgt) { ptr('pointermove', PN.tgt, x, y, 1, -1); mse('mousemove', PN.tgt, x, y, 1, 0); }
  else if (PN.mode === 'range' && PN.tgt) { var r = PN.tgt.closest('input[type=range]'); if (r) setRange(r, x); }
  else {
    doScroll(PN.tgt, -dx * 1.15, -dy * 1.15);
    var dt = Math.max(8, now - PN.vt); PN.vt = now;
    PN.vel[0] = PN.vel[0] * .6 + (-dx * 1.15 / dt * 1000) * .4; PN.vel[1] = PN.vel[1] * .6 + (-dy * 1.15 / dt * 1000) * .4;
  }
}
function endDrag() {
  if (PN.mode === 'move') endMove();
  else if (PN.mode === 'pointer' && PN.tgt) { ptr('pointerup', PN.tgt, PN.last[0], PN.last[1], 0, 0); mse('mouseup', PN.tgt, PN.last[0], PN.last[1], 0, 0); }
  else if (PN.mode === 'scroll') { S.vel = [PN.vel[0], PN.vel[1]]; S.momTgt = PN.tgt; if (Math.abs(S.vel[0]) > 120 || Math.abs(S.vel[1]) > 120) momentumRun(); }
  PN.dragging = false; PN.tgt = null;
}
function squeezeStep(h, now) {
  var lm = h.lm, t = now / 1000, k = ksc();
  if (!PN.on) {
    var mid0 = anchorXY(lm), c0 = histAt(now - 150) || [S.cx, S.cy];     // the click lands where the cursor was just BEFORE the hand closed
    PN.on = true; PN.finger = 0; PN.t0 = now; PN.dragging = false; PN.mode = ''; PN.cancel = false; PN.armMove = false; PN.c0 = c0; PN.m0 = mid0;
    PFX.reset(); PFY.reset(); PFX.f(mid0[0] * k, t); PFY.f(mid0[1] * k, t); S.cx = c0[0]; S.cy = c0[1];
    S.vel = [0, 0]; S.pmiss = 0; cursorState('pinch');
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) { }
    return;
  }
  var mid = anchorXY(lm), mx = PFX.f(mid[0] * k, t) / k, my = PFY.f(mid[1] * k, t) / k;
  S.cx = clamp(PN.c0[0] + (mx - PN.m0[0]), 0, innerWidth); S.cy = clamp(PN.c0[1] + (my - PN.m0[1]), 0, innerHeight);
  var dist = Math.hypot(S.cx - PN.c0[0], S.cy - PN.c0[1]);
  if (!PN.dragging) {
    var held = now - PN.t0;
    if (!PN.armMove && held > 1000 && dist < 12) {
      var tg = elAt(PN.c0[0], PN.c0[1]);
      if (tg && tg.closest && tg.closest(PANEL_SEL) && dragMode(tg) === 'scroll') { PN.armMove = true; cursorState('grab'); note('MOVE PANEL'); }
    }
    if (held > 1600) S.prog = clamp((held - 1600) / 1600, 0, 1);              // a closed fist held completely still for ~3 s = pause
    if (held > 3200) { PN.cancel = true; pause(); return; }
    if (dist > 18) beginDrag(now);
  }
  if (PN.dragging) dragStep(S.cx, S.cy, now);
}
function endSqueeze(now) {
  PN.on = false;
  if (PN.dragging) endDrag();
  else if (!PN.cancel && now - PN.t0 < 2500) {
    var dbl = now - S.lastClick < 430 && Math.hypot(PN.c0[0] - S.lastCP[0], PN.c0[1] - S.lastCP[1]) < 34;
    clickAt(PN.c0[0], PN.c0[1], dbl); S.lastClick = dbl ? 0 : now; S.lastCP = PN.c0;
  }
  S.freezeUntil = now + 160; S.fresh = true; S.squeezeCool = now + 250; cursorState('point');
}
function releaseAll() {
  if (PN.on) { PN.on = false; PN.cancel = true; if (PN.dragging) endDrag(); }
  if (MV) endMove();
}

/* ================================================================ ONE HAND ZOOM: pinch-out = zoom in, pinch-in = zoom out
   Thumb + index (and / or middle finger). Touch them together and open them (pinch out) = zoom in; start open and close them
   (pinch in) = zoom out. It is recognised from the movement itself: how fast the gap changes, whether it started / ended touching,
   whether the hand stayed in place, and whether the fingertips rise (pinch out) or sink (pinch in). */
var Z1 = { on: false, f: new Euro(2.2, 2.5, 4), h: [], acc: 0, prev: 0, t: 0, last: 0, lastSm: 0, bad: 0, cool: 0, lt: 0, lab: 'ZOOM' };
function zoomGap(a) {                                     // smallest thumb-to-fingertip gap among index / middle (a curled finger does not count)
  var g = null, f = -1;
  for (var i = 0; i < 2; i++) if ((a.rt[i] > 1.15 || a.pr[i] < .2) && (g === null || a.pr[i] < g)) { g = a.pr[i]; f = i; }
  return g === null ? null : [g, f];
}
function zoomSolo(on) {
  if (!U.zm) return;
  U.zm.classList.add('solo'); showZoom(on);
  if (on) { U.zlab.style.left = S.cx.toFixed(0) + 'px'; U.zlab.style.top = (S.cy - 58).toFixed(0) + 'px'; if (U.zlab.textContent !== Z1.lab) U.zlab.textContent = Z1.lab; }
}
function endZoom1(now) {
  if (!Z1.on) return;
  Z1.on = false; Z1.cool = now + 500; Z1.h.length = 0; Z1.f.reset(); Z1.bad = 0;
  showZoom(false); S.fresh = true; S.freezeUntil = now + 150; cursorState('point');
}
function zoom1(h, now) {                                  // true while a one-hand pinch zoom is going on (the cursor holds still meanwhile)
  var a = h.a, lm = h.lm, gf = zoomGap(a), t = now / 1000;
  if (!gf) {
    if (Z1.on) { if (!Z1.bad) Z1.bad = now; if (now - Z1.bad > 220) { endZoom1(now); return false; } return true; }
    Z1.h.length = 0; Z1.f.reset(); return false;
  }
  Z1.bad = 0;
  var sm = Z1.f.f(Math.log(clamp(gf[0], .1, 1.6)), t), cn = anchorN(lm), s2 = dd(lm[0], lm[9]) || .001;
  var lift = (cn.y - (lm[4].y + lm[TIPS[gf[1]]].y) / 2) / s2;           // fingertips above the palm = positive
  if (!Z1.on) {
    if (now < Z1.cool) return false;
    Z1.h.push([now, sm, lift, cn.x, cn.y]); while (Z1.h.length && now - Z1.h[0][0] > 600) Z1.h.shift();
    if (Z1.h.length < 4) return false;
    var p = Z1.h[0], d = sm - p[1], dl = lift - p[2], mv = Math.hypot((cn.x - p[3]) * S.AR, cn.y - p[4]) / s2;
    var gNow = Math.exp(sm), gPast = Math.exp(p[1]), out = d > 0;
    var rises = out ? dl > .12 : dl < -.12, need = rises ? .30 : .46;     // fingers moving up while opening (or down while closing) = clearly a zoom
    var fromPinch = out ? gPast < .5 : gNow < .6;                          // zoom in starts touching, zoom out ends touching
    if (Math.abs(d) < need || Math.abs(gNow - gPast) < .22 || !fromPinch || mv > .7) return false;
    releaseAll();
    Z1.on = true; Z1.acc = clamp(d, -3 * ZOOM_STEP, 3 * ZOOM_STEP); Z1.prev = sm; Z1.t = now - ZOOM_GAP; Z1.last = now; Z1.lastSm = sm; Z1.lt = 0; Z1.lab = 'ZOOM'; Z1.h.length = 0;
    S.pp = null; S.pa = null; cursorState('zoom');
  } else { Z1.acc += sm - Z1.prev; Z1.prev = sm; }
  if (Math.abs(sm - Z1.lastSm) > .03) { Z1.lastSm = sm; Z1.last = now; }
  if (Math.abs(Z1.acc) > ZOOM_STEP && now - Z1.t >= ZOOM_GAP) {
    var dir = Z1.acc > 0 ? 1 : -1;
    zoomBy(dir); Z1.acc -= dir * ZOOM_STEP; Z1.t = now; Z1.lt = now; Z1.lab = dir > 0 ? '＋ ZOOM IN' : '－ ZOOM OUT';
    if (Math.abs(Z1.acc) > ZOOM_STEP) Z1.acc = dir * ZOOM_STEP;
  }
  if (now - Z1.lt > 600) Z1.lab = 'ZOOM';
  S.freezeUntil = now + 200;
  if (now - Z1.last > 450) { endZoom1(now); return false; }                // fingers stopped moving: zoom is finished
  zoomSolo(true);
  return true;
}

/* ================================================================ two hands: zoom + turn the body
   Both hands pinch (thumb + index). The distance between the two pinch points is tracked in log space; every time it has
   grown / shrunk by one step (12%) a zoom step is sent. Fast spreading = many steps per second, slow = few. A dropped frame
   or a flickering pinch for up to 0.2 s does not stop the zoom. */
function showZoom(on) { if (U.zm) U.zm.classList.toggle('on', !!on); }
function zoomLine(a, b) {
  if (!U.zl) return;
  U.zl.setAttribute('x1', a[0].toFixed(0)); U.zl.setAttribute('y1', a[1].toFixed(0)); U.zl.setAttribute('x2', b[0].toFixed(0)); U.zl.setAttribute('y2', b[1].toFixed(0));
  U.zc[0].setAttribute('cx', a[0].toFixed(0)); U.zc[0].setAttribute('cy', a[1].toFixed(0)); U.zc[1].setAttribute('cx', b[0].toFixed(0)); U.zc[1].setAttribute('cy', b[1].toFixed(0));
  U.zlab.style.left = ((a[0] + b[0]) / 2).toFixed(0) + 'px'; U.zlab.style.top = (Math.min(a[1], b[1]) - 40).toFixed(0) + 'px';
  if (U.zlab.textContent !== Z.lab) U.zlab.textContent = Z.lab;
}
function zoomStep(hands, now) {
  var A = hands[0], B = hands[1], th = Z.on ? ZOOM_OUT : ZOOM_IN;
  if (!(isPinch0(A.a, th) && isPinch0(B.a, th))) {
    if (Z.on) { if (!Z.bad) Z.bad = now; if (now - Z.bad < 200) return true; }       // brief flicker: keep zooming
    return false;
  }
  Z.bad = 0;
  var ma = pinchMid(A.lm, 0), mb = pinchMid(B.lm, 0), mx = (ma[0] + mb[0]) / 2, t = now / 1000;
  var dx = ((A.lm[4].x + A.lm[8].x) - (B.lm[4].x + B.lm[8].x)) / 2 * S.AR, dy = ((A.lm[4].y + A.lm[8].y) - (B.lm[4].y + B.lm[8].y)) / 2;
  var ld = Math.log(Math.max(Math.hypot(dx, dy), .03));                              // distance between hands, measured on the camera image (not clipped at the screen edge)
  S.cx = mx; S.cy = (ma[1] + mb[1]) / 2;
  if (!Z.on) {
    releaseAll(); Z.on = true; Z.f.reset(); Z.prev = Z.f.f(ld, t); Z.acc = 0; Z.t = now; Z.lt = 0; Z.mx = mx; Z.lab = 'ZOOM';
    cursorState('zoom'); showZoom(true); zoomLine(ma, mb); return true;
  }
  var sm = Z.f.f(ld, t); Z.acc += sm - Z.prev; Z.prev = sm;
  if (Math.abs(Z.acc) > ZOOM_STEP && now - Z.t >= ZOOM_GAP) {
    var dir = Z.acc > 0 ? 1 : -1;
    zoomBy(dir); Z.acc -= dir * ZOOM_STEP; Z.t = now; Z.lt = now; Z.lab = dir > 0 ? '＋ ZOOM IN' : '－ ZOOM OUT';
    if (Math.abs(Z.acc) > ZOOM_STEP) Z.acc = dir * ZOOM_STEP;                         // never build up a backlog
  }
  if (now - Z.lt > 600) Z.lab = 'ZOOM';
  if (now - Z.lt < 400) Z.mx = mx;                                                    // hands drifting sideways while zooming do not turn the body
  else if (Math.abs(mx - Z.mx) > innerWidth * .14 && now - S.actT > 350) {
    try { if (W.HOLO && typeof W.HOLO.bodyAct === 'function') { W.HOLO.bodyAct(mx > Z.mx ? 'right' : 'left'); S.actT = now; note('TURN'); } } catch (e) { }
    Z.mx = mx;
  }
  zoomLine(ma, mb);
  return true;
}
function endZoom() { if (Z.on) { Z.on = false; Z.bad = 0; showZoom(false); S.fresh = true; S.freezeUntil = performance.now() + 200; cursorState('point'); } }

/* ================================================================ cursor + per-frame logic */
function cursorState(s) { S.state = s; if (U.cur) U.cur.dataset.s = s; }
function stableTo(raw) {                                  // a pose has to be seen for 2 frames before it counts (squeeze is instant)
  if (raw === 'squeeze') { S.cand = 'squeeze'; S.cnt = 9; return 'squeeze'; }
  if (raw === S.cand) S.cnt++; else { S.cand = raw; S.cnt = 1; }
  return S.cnt >= 2 ? raw : (S.pose === 'squeeze' ? raw : S.pose || raw);
}
function holdTime(pose, now) {
  if (pose !== S.hp) { S.hp = pose; S.hpT = now; S.holdDone = false; }
  return (now - S.hpT) / 1000;
}
function drawCursor(now) {                                // label + dwell ring (the position itself is moved by rloop at screen refresh rate)
  if (!U.cur) return;
  U.cur.classList.toggle('on', S.on);
  U.dw.style.strokeDasharray = (clamp(S.prog, 0, 1) * 138).toFixed(1) + ' 200';
  var lab = '';
  if (now < S.noteT) lab = S.note;
  else if (S.state === 'pinch') lab = 'SQUEEZE';
  else if (S.state === 'grab') lab = 'MOVE PANEL';
  else if (S.state === 'zoom') lab = '';
  else if (S.state === 'paused') lab = 'PAUSED · OPEN PALM 1s';
  else if (S.state === 'lost') lab = 'NO HAND';
  else if (S.state === 'scroll') lab = 'SCROLL';
  else if (S.state === 'drag') lab = PN.mode === 'scroll' ? 'SCROLL' : 'DRAG';
  if (U.lab.textContent !== lab) U.lab.textContent = lab;
}
function rloop(now) {                                     // cursor glides between camera frames: looks like 60 fps even though the camera gives ~30
  if (!S.on) { S.rraf = 0; return; }
  S.rraf = requestAnimationFrame(rloop);
  if (!U.cur) return;
  var dt = Math.min(64, now - (S.rt || now)); S.rt = now;
  if (S.rx === null || Math.hypot(S.cx - S.rx, S.cy - S.ry) > 260) { S.rx = S.cx; S.ry = S.cy; }
  else { var lead = S.state === 'point' ? .03 : 0, tx = S.cx + clamp(S.vx * lead, -45, 45), ty = S.cy + clamp(S.vy * lead, -45, 45), a = 1 - Math.exp(-dt / 9); S.rx += (tx - S.rx) * a; S.ry += (ty - S.ry) * a; }
  U.cur.style.transform = 'translate3d(' + S.rx.toFixed(1) + 'px,' + S.ry.toFixed(1) + 'px,0)';
}
function pause() {
  releaseAll(); S.paused = true; cursorState('paused'); setHot(null); status('PAUSED'); U.cam.classList.add('pause'); U.cam.classList.remove('live');
  toast('Finger mode paused. Hold an open palm for a second to resume.');
}
function resume() {
  S.paused = false; S.fresh = true; cursorState('point'); status('LIVE'); U.cam.classList.remove('pause'); U.cam.classList.add('live'); note('RESUMED');
}
function moveCursor(lm, t, now) {
  var p = anchorXY(lm), k = ksc(), ox = S.cx, oy = S.cy;
  if (S.fresh) { FX.reset(); FY.reset(); S.hist.length = 0; S.fresh = false; S.vx = 0; S.vy = 0; S.mt = t; ox = null; }
  S.cx = FX.f(p[0] * k, t) / k; S.cy = FY.f(p[1] * k, t) / k;
  var dt = Math.max(.008, t - S.mt); S.mt = t;
  if (ox !== null) { S.vx = S.vx * .6 + (S.cx - ox) / dt * .4; S.vy = S.vy * .6 + (S.cy - oy) / dt * .4; }
  S.hist.push([now, S.cx, S.cy]); if (S.hist.length > 18) S.hist.shift();
  if (now - S.mvT > 40 && Math.hypot(S.cx - S.lx, S.cy - S.ly) > 1.5) {
    S.mvT = now; S.lx = S.cx; S.ly = S.cy;
    var tg = elAt(S.cx, S.cy); if (tg) { ptr('pointermove', tg, S.cx, S.cy, 0, -1); mse('mousemove', tg, S.cx, S.cy, 0, 0); }
  }
}
function hoverDwell(now) {
  if (!P.dwell && now - S.hvT < 70) return; S.hvT = now;
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
function curlOf(a) { return (a.rt[0] + a.rt[1] + a.rt[2] + a.rt[3]) / 4; }       // ~1.8 open hand, ~1.1 closed fist
var POSE_NAME = { squeeze: 'SQUEEZE', other: 'HAND', point: 'POINT', palm: 'PALM', peace: '2 FINGERS', three: '3 FINGERS', fist: 'FIST', up: '👍', down: '👎' };
function jarvisOpen() {
  var jp = $('jv-panel');
  if (jp && !jp.hidden) { note('JARVIS IS OPEN'); return; }
  talkJarvis();
}
function pinchLike(a) { var g = zoomGap(a); return !!g && g[0] < .5 && a.rt[g[1]] > 1.4; }   // thumb touching a finger that is still out = zoom pinch, not a squeeze
function primary(h, now) {
  var a = h.a, lm = h.lm, t = now / 1000, cv = curlOf(a), i;
  S.prog = 0;
  S.ch.push([now, cv]); while (S.ch.length && now - S.ch[0][0] > 550) S.ch.shift();
  var wasOpen = false; for (i = 0; i < S.ch.length; i++) if (S.ch[i][1] > 1.45) wasOpen = true;
  var sq;                                                  // SQUEEZE = the hand was open a moment ago and is now closing fast / is closed
  if (PN.on) { S.pmiss = cv > 1.5 ? S.pmiss + 1 : 0; sq = S.pmiss < 2; }
  else sq = !S.paused && !Z1.on && wasOpen && cv < 1.32 && a.pose !== 'up' && a.pose !== 'down' && a.pose !== 'point' && a.pose !== 'peace' && a.pose !== 'three' && !pinchLike(a) && now >= S.squeezeCool;
  var pose = stableTo(sq ? 'squeeze' : a.pose); S.pose = pose;
  var hold = holdTime(pose, now);
  if (U.pose) U.pose.textContent = POSE_NAME[pose] || pose.toUpperCase();
  if (S.paused) {
    cursorState('paused'); S.prog = pose === 'palm' ? hold / 1 : 0;
    if (pose === 'palm' && hold >= 1 && !S.holdDone) { S.holdDone = true; resume(); }
    drawCursor(now); return;
  }
  if (sq || PN.on) { if (sq) squeezeStep(h, now); else endSqueeze(now); drawCursor(now); return; }
  if (zoom1(h, now)) { drawCursor(now); return; }
  var moving = pose === 'point' || pose === 'other' || pose === 'palm';              // any relaxed hand moves the cursor: no pointing needed
  if (moving && now >= S.freezeUntil) { moveCursor(lm, t, now); cursorState('point'); hoverDwell(now); }
  else if (!moving) { S.fresh = true; if (pose !== 'peace') cursorState('idle'); }
  if (pose === 'peace') { peaceScroll(lm, now); cursorState('scroll'); } else { if (S.pp) peaceEnd(); S.pp = null; S.ph.length = 0; }
  if (pose === 'palm') {                                                              // open hand held still = open Jarvis
    var c = anchorN(lm);
    if (!S.pa || Math.hypot((c.x - S.pa.x) * S.AR, c.y - S.pa.y) > .05) { S.pa = c; S.paT = now; S.paDone = false; }
    var ph = now - S.paT;
    if (ph > 500) S.prog = clamp((ph - 500) / (JARVIS_HOLD - 500), 0, 1);
    if (ph >= JARVIS_HOLD && !S.paDone) { S.paDone = true; jarvisOpen(); }
  } else S.pa = null;
  if (pose === 'three') { S.prog = hold / .7; if (hold >= .7 && !S.holdDone) { S.holdDone = true; goBack(); } }
  if (pose === 'fist') { S.prog = hold / 3; if (hold >= 3 && !S.holdDone) { S.holdDone = true; pause(); } }
  if (pose === 'up' || pose === 'down') {
    S.prog = hold / .8;
    if (hold >= .8 && !S.holdDone) {
      S.holdDone = true; var jp = $('jv-panel');
      if (W.__jarvis && typeof W.__jarvis.run === 'function' && jp && !jp.hidden) { W.__jarvis.run(pose === 'up' ? 'yes' : 'no'); note(pose === 'up' ? 'YES' : 'NO'); }
      else note('OPEN JARVIS FIRST');
    }
  }
  if (!moving && pose !== 'peace') setHot(null);
  drawCursor(now);
}
function lost(now) {
  if (!S.lostAt) S.lostAt = now;
  if (now - S.lostAt > 260) { if (PN.on || MV) releaseAll(); endZoom(); endZoom1(now); S.fresh = true; S.pose = ''; S.hp = ''; S.pmiss = 0; S.ch.length = 0; S.pa = null; setHot(null); if (!S.paused) cursorState('lost'); }
  if (U.hands) U.hands.textContent = 'NO HAND'; if (U.pose) U.pose.textContent = '—';
  drawCursor(now);
}

function process(res, now) {
  var L = res.landmarks || [], WL = res.worldLandmarks || [], HD = res.handednesses || res.handedness || [], hands = [], i;
  for (i = 0; i < L.length; i++) {
    var key = (HD[i] && HD[i][0] && HD[i][0].categoryName) || ('h' + i);
    hands.push({ lm: L[i], key: key, a: analyse(L[i], WL[i]) });
  }
  drawSkeleton(hands);
  S.nHands = hands.length;
  if (!hands.length) { lost(now); return; }
  S.lostAt = 0; if (U.hands) U.hands.textContent = hands.length + (hands.length > 1 ? ' HANDS' : ' HAND');
  endZoom();
  var prim = hands[0];
  if (hands.length === 2) {
    var same = hands.filter(function (h) { return h.key === S.pk; })[0];
    prim = same || (hands[0].a.scale >= hands[1].a.scale ? hands[0] : hands[1]);
  }
  S.pk = prim.key;
  primary(prim, now);
}

/* ================================================================ camera preview: the drawing around your hand (only when the preview is visible) */
function drawSkeleton(hands) {
  if (!P.cam || !U.cx) return;
  var vw = U.cv.clientWidth, vh = U.cv.clientHeight, dpr = Math.min(W.devicePixelRatio || 1, 2);
  if (!vw || !vh) return;
  if (U.cv.width !== Math.round(vw * dpr)) { U.cv.width = Math.round(vw * dpr); U.cv.height = Math.round(vh * dpr); }
  var c = U.cx, T = THEME, u = vw / 200, glow = !lite();
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, vw, vh); c.lineCap = 'round'; c.lineJoin = 'round';
  hands.forEach(function (h) {
    var lm = h.lm, pf = -1, i;
    var X = function (n) { return (1 - lm[n].x) * vw; }, Y = function (n) { return lm[n].y * vh; };
    c.beginPath(); [0, 1, 5, 9, 13, 17].forEach(function (n, k) { if (k) c.lineTo(X(n), Y(n)); else c.moveTo(X(n), Y(n)); }); c.closePath();   // soft palm fill
    c.fillStyle = T.palm; c.fill();
    c.shadowColor = T.boneGlow; c.shadowBlur = glow ? 8 * u : 0;                                                                          // bones with a glow
    c.lineWidth = Math.max(1.6, 2.6 * u); c.strokeStyle = T.bone; c.beginPath();
    CONN.forEach(function (e) { c.moveTo(X(e[0]), Y(e[0])); c.lineTo(X(e[1]), Y(e[1])); });
    c.stroke(); c.shadowBlur = 0;
    if (pf >= 0) {                                                                                                                         // pinch: bright link between the two fingertips
      c.strokeStyle = T.hot; c.lineWidth = Math.max(2, 3 * u); c.shadowColor = T.hot; c.shadowBlur = glow ? 10 * u : 0;
      c.beginPath(); c.moveTo(X(4), Y(4)); c.lineTo(X(TIPS[pf]), Y(TIPS[pf])); c.stroke(); c.shadowBlur = 0;
    }
    for (i = 0; i < 21; i++) {
      var tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20, hot = pf >= 0 && (i === 4 || i === TIPS[pf]);
      c.beginPath(); c.arc(X(i), Y(i), Math.max(1.4, (hot ? 5.2 : tip ? 4 : 2.4) * u), 0, 6.2832);
      c.fillStyle = hot ? T.hot : tip ? T.tip : T.joint; c.fill();
      if (tip) { c.lineWidth = 1; c.strokeStyle = T.ink; c.stroke(); }
    }
  });
}

/* ================================================================ loop, load, start / stop */
function loop() {
  if (!S.on) return;
  S.raf = requestAnimationFrame(loop);
  tick();
}
function tick() {
  if (!S.on || D.hidden) return;
  var v = S.video, now = performance.now();
  if (!S.lm || v.readyState < 2 || now - S.lastDet < S.minDt || v.currentTime === S.lastVT) return;   // only a NEW camera frame is processed, never skipped
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
      var mk = function (del) { return mod.HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: del }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .45 }); };
      try { return await mk('GPU'); } catch (e) { return await mk('CPU'); }
    } catch (e) { err = e; }
  }
  throw err || new Error('the hand model could not be loaded');
}
async function start() {
  if (S.on || S.loading) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot open the camera.', 'danger'); return; }
  if (W.isSecureContext === false) { toast('The camera needs a secure (https) address.', 'danger'); return; }
  var tok = ++S.tok;                                        // stop() bumps this, so a Stop pressed while the camera or model is still loading cancels cleanly
  S.loading = true; fabState(); buildUI(); U.cam.classList.add('show'); status('STARTING…');
  try {
    var st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 24 } }, audio: false });
    if (tok !== S.tok) { st.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } }); return; }
    S.stream = st;
    S.video = U.video; S.video.srcObject = S.stream; await S.video.play();
    if (tok !== S.tok) return;
    if (S.video.videoWidth) { S.AR = S.video.videoWidth / S.video.videoHeight; U.pv.style.aspectRatio = S.video.videoWidth + ' / ' + S.video.videoHeight; }
    if (!S.lm) { status(lsGet('fg_seen') === '1' ? 'LOADING MODEL…' : 'DOWNLOADING MODEL…'); if (lsGet('fg_seen') !== '1') toast('Downloading the hand-tracking model, about 8 MB, one time only.'); S.lm = await loadLandmarker(); }
    if (tok !== S.tok) return;
    S.on = true; S.paused = false; S.fresh = true; S.errs = 0; S.lastVT = -1; S.fpsT = performance.now(); S.pmiss = 0; S.rx = null;
    try { if (W.perf && W.perf.pause) W.perf.pause(); } catch (e) { }          // perf.js: hand tracking is heavy on purpose, do not mistake it for a struggling phone
    S.minDt = (W.perf && typeof W.perf.level === 'number' && W.perf.level >= 2) ? 33 : 0;
    status('LIVE'); U.cam.classList.add('live'); U.cam.classList.remove('pause'); cursorState('idle'); prefsUI(); drawCursor(performance.now());
    if (S.video.requestVideoFrameCallback) { var vf = function () { if (tok !== S.tok || !S.on) return; tick(); S.video.requestVideoFrameCallback(vf); }; S.video.requestVideoFrameCallback(vf); }
    else S.raf = requestAnimationFrame(loop);
    S.rraf = requestAnimationFrame(rloop);
    if (lsGet('fg_seen') !== '1') { lsSet('fg_seen', '1'); guide(true); } else toast('Finger mode on. Relax your hand to move, squeeze to click.');
  } catch (e) {
    if (tok !== S.tok) return;
    var msg = e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for this site and try again.' : e && e.name === 'NotFoundError' ? 'No camera found on this device.' : 'Finger mode could not start: ' + ((e && e.message) || e);
    toast(msg, 'danger'); stop(true); return;
  }
  S.loading = false; fabState();
}
function stop(silent) {
  var was = S.on && !silent; S.tok++; S.on = false; S.loading = false; cancelAnimationFrame(S.raf); cancelAnimationFrame(S.rraf); cancelAnimationFrame(S.momRaf); S.momRaf = 0; S.rraf = 0;
  try { releaseAll(); } catch (e) { }
  endZoom(); endZoom1(performance.now()); showZoom(false); setHot(null); clearLayoutDom();
  if (S.stream) { S.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } }); S.stream = null; }
  if (S.video) { try { S.video.pause(); S.video.srcObject = null; } catch (e) { } }
  if (U.cam) { U.cam.classList.remove('show', 'live', 'pause', 'open'); }
  if (U.cur) U.cur.classList.remove('on');
  if (U.guide) U.guide.classList.remove('show');
  S.paused = false; PN.on = false; S.ch.length = 0; S.pa = null; fabState();
  try { if (W.perf && W.perf.resume) W.perf.resume(); } catch (e) { }
  if (was) toast('Finger mode off.');
}
function toggle() { if (S.on || S.loading) stop(); else start(); }
function statusInfo() { return { on: S.on, paused: S.paused, hands: S.nHands, fps: S.fps, pose: S.pose, state: S.state, sens: SENS_NAME[P.sens], dwell: P.dwell, preview: P.cam, moved: Object.keys(LAY).length }; }

/* ================================================================ keyboard + boot */
D.addEventListener('keydown', function (e) {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  if (e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); toggle(); }
}, true);
D.addEventListener('visibilitychange', function () { if (D.hidden && S.on) { releaseAll(); } });
function boot() { fab(); setInterval(applyLayout, 2500); }
if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot); else boot();

W.FINGER = { version: 4, start: start, stop: function () { stop(); }, toggle: toggle, status: statusInfo, guide: guide, resetLayout: resetLayout, _t: { analyse: analyse, pinchState: pinchState, mapXY: mapXY, process: process, state: S } };
})();
