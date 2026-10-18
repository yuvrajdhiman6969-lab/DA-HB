/* holo.js v1 — Holographic data room for Discipline OS.
   Additive: nothing in the app is removed. It adds
     • a "Holo Room" tab   (hologram body + month globe + 3D volume towers + progress/stats panels)
     • a HOLO tab inside the Gym HUD (hologram body + 3D towers)
     • a month globe on top of the Reports tab
   All 3D is plain canvas-2D maths (no libraries, no network), so it works offline and in the PWA.
   Performance: one shared render loop · only canvases on screen are drawn · paused while you scroll (perf.js __fxHold),
   in a hidden tab, in Lite mode (⚡) or with reduced-motion (then it draws on demand only) · DPR capped ·
   frame rate halves automatically when perf.js trims the phone (perf.level >= 1).
   Data is read live from the app: gym sets, gym status, habit scores. Nothing is stored by this file.
   Tweak: HOLO.target.Core = 6  (weekly hard-set target per muscle; default 10 like the BODY tab). */
(function () {
'use strict';
if (window.HOLO) return;
var W = window, D = document, TAU = Math.PI * 2, VERSION = 1;

/* ================= palette ================= */
var C = { cy: [96, 226, 255], bl: [64, 146, 255], dp: [38, 100, 225], or: [255, 112, 40], am: [255, 170, 66], wh: [235, 252, 255], pale: [170, 214, 255] };
var COL = [C.or, C.am, C.bl, C.cy, C.dp, C.wh];                 // 0 neglected · 1 low · 2 mid · 3 on target · 4 neutral · 5 selected
var FAL = [.30, .22, .15, .20, .10, .36];                       // fill alpha per colour
var LAL = [.20, .50, .95];                                      // line alpha: back / side / front
var STATUS = ['NEGLECTED', 'LOW', 'BUILDING', 'ON TARGET'];
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

var GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core', 'Legs'];
var GI = { Chest: 0, Back: 1, Shoulders: 2, Biceps: 3, Triceps: 4, Core: 5, Legs: 6, None: 7 };
var TARGET = { Chest: 10, Back: 10, Shoulders: 10, Biceps: 10, Triceps: 10, Core: 10, Legs: 10 };
var FACE_YAW = { Chest: 0, Core: 0, Shoulders: 0, Biceps: 0, Legs: 0, Back: Math.PI, Triceps: Math.PI };

/* ================= environment ================= */
var reduced = !!(W.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
function lvl() { return (W.perf && typeof W.perf.level === 'number') ? W.perf.level : 0; }
function lite() { return reduced || lvl() >= 2 || D.documentElement.classList.contains('fx-lite'); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmtK(v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v)); }
function fmt(n) { return Math.round(n).toLocaleString(); }
var DOWS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
var MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/* ================= data layer (reads the app's own helpers) ================= */
var DATA = null;
function daysBetween(aIso, bIso) { return Math.round((parseISO(bIso) - parseISO(aIso)) / 864e5); }
function getData(force) {
  var now = Date.now();
  if (!force && DATA && now - DATA.at < 1200) return DATA;
  var d = { at: now, ok: false, g: {}, weekVol: [0, 0, 0, 0, 0, 0, 0], prevVol: [0, 0, 0, 0, 0, 0, 0], vol8: [], vol8k: [], today: '', mon: '',
            wk: { done: 0, sched: 0, sets: 0, reps: 0, pSets: 0, pReps: 0 }, st: { done: 0, scheduled: 0, totalReps: 0, totalSets: 0 }, streak: { cur: 0, best: 0 }, load: 0, days: 0 };
  GROUPS.forEach(function (g) { d.g[g] = { g: g, s28: 0, wk: 0, last: '', target: TARGET[g] || 10 }; });
  try {
    var logs = gymCollectLogs(), today = isoDate(new Date()), mon = gymMondayIso(today), from28 = gymAddDays(today, -27), pmon = gymAddDays(mon, -7);
    d.today = today; d.mon = mon;
    var byWeek = {}, dayset = {};
    logs.forEach(function (l) {
      var o = d.g[l.group];
      if (o) { if (l.iso >= from28 && l.iso <= today) o.s28 += l.sets; if (l.iso >= mon && l.iso <= today) o.wk += l.sets; if (l.iso <= today && l.iso > o.last) o.last = l.iso; }
      d.load += l.vol; dayset[l.iso] = 1;
      var wk = gymMondayIso(l.iso); byWeek[wk] = (byWeek[wk] || 0) + l.vol;
      var di = daysBetween(mon, l.iso);
      if (di >= 0 && di <= 6) { d.weekVol[di] += l.vol; d.wk.sets += l.sets; d.wk.reps += l.reps; }
      else if (di >= -7 && di <= -1) { d.prevVol[di + 7] += l.vol; d.wk.pSets += l.sets; d.wk.pReps += l.reps; }
    });
    d.days = Object.keys(dayset).length;
    for (var i = 7; i >= 0; i--) { var k = gymAddDays(mon, -7 * i); d.vol8k.push(k); d.vol8.push(byWeek[k] || 0); }
    var plans = gymPlanRange(mon, gymAddDays(mon, 6));
    Object.keys(plans).forEach(function (iso) {
      if (plans[iso].type === 'workout' && !(excGymAway(iso) && !getGymStatusRaw(iso))) { d.wk.sched++; if (getGymStatus(iso) === 'done') d.wk.done++; }
    });
    d.st = gymAllTimeStats(); d.streak = gymStreaks(); d.ok = true;
  } catch (e) { /* app helpers not ready: panels show zeros */ }
  DATA = d; return d;
}
function ginfo(d, g) {
  var o = d.g[g]; if (!o) return { g: g, s28: 0, wk: 0, last: '', target: 10, h: 0, idx: 0, label: STATUS[0], ago: null };
  var h = clamp(o.s28 / (o.target * 4), 0, 1), idx = h < .25 ? 0 : h < .5 ? 1 : h < .8 ? 2 : 3;
  var ago = o.last ? daysBetween(o.last, d.today) : null;
  return { g: g, s28: o.s28, wk: o.wk, last: o.last, target: o.target, h: h, idx: idx, label: STATUS[idx], ago: ago };
}
function agoTxt(a) { return a === null ? 'never logged' : a === 0 ? 'today' : a === 1 ? 'yesterday' : a + ' days ago'; }
function cidxList(d) { var a = []; GROUPS.forEach(function (g) { a[GI[g]] = ginfo(d, g).idx; }); a[7] = 4; return a; }

/* ================= render engine ================= */
var reg = [], raf = 0, lastT = 0;
function loop(t) {
  raf = requestAnimationFrame(loop);
  if (D.hidden || W.__fxHold) return;                               // scrolling or backgrounded: keep the last frame
  var L = lite(), drag = false, i, s;
  for (i = 0; i < reg.length; i++) if (reg[i].drag) drag = true;
  var gap = drag ? 14 : L ? 240 : lvl() >= 1 ? 32 : 15;
  if (t - lastT < gap) return;
  var dt = Math.min(90, t - lastT); lastT = t;
  for (i = reg.length - 1; i >= 0; i--) {
    s = reg[i];
    if (!s.cv.isConnected) { reg.splice(i, 1); continue; }
    if (!s.vis) continue;
    if ((s.still || L) && !s.dirty) continue;
    s.dirty = false;
    try { s.draw(s.ctx, s.w, s.h, t, s); } catch (e) { if (W.console) console.warn('holo draw', e); s.dirty = false; }
  }
  if (!reg.length) { cancelAnimationFrame(raf); raf = 0; }
}
function attach(wrap, draw, o) {
  o = o || {};
  var cv = D.createElement('canvas'); cv.className = 'hl-cv'; wrap.appendChild(cv);
  var s = { cv: cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1, vis: true, dirty: true, draw: draw, still: !!o.still, drag: false, ud: {}, wrap: wrap };
  function size() {
    var r = wrap.getBoundingClientRect(); if (r.width < 20 || r.height < 20) return;
    var dpr = Math.min(W.devicePixelRatio || 1, lvl() >= 1 || D.documentElement.classList.contains('fx-low') ? 1.25 : 2);
    s.w = r.width; s.h = r.height; s.dpr = dpr;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); s.dirty = true;
  }
  s.size = size; s.invalidate = function () { s.dirty = true; };
  if (W.ResizeObserver) new ResizeObserver(size).observe(wrap); else addEventListener('resize', size);
  if (W.IntersectionObserver) new IntersectionObserver(function (es) { s.vis = es[0].isIntersecting; if (s.vis) s.dirty = true; }, { rootMargin: '60px' }).observe(wrap);
  size(); reg.push(s);
  if (!raf) raf = requestAnimationFrame(loop);
  return s;
}
addEventListener('perf:level', function () { reg.forEach(function (s) { s.size && s.size(); }); });
D.addEventListener('visibilitychange', function () { reg.forEach(function (s) { s.dirty = true; }); });

/* drag-to-rotate on a canvas. onTap(x,y) fires for a still tap. */
function dragger(s, onDelta, onTap) {
  var cv = s.cv, down = false, sx = 0, sy = 0, lx = 0, moved = 0;
  cv.style.touchAction = 'pan-y';                                   // vertical swipes still scroll the page
  cv.addEventListener('pointerdown', function (e) { down = true; moved = 0; sx = lx = e.clientX; sy = e.clientY; s.drag = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { } });
  cv.addEventListener('pointermove', function (e) {
    if (!down) return; var dx = e.clientX - lx; lx = e.clientX; moved += Math.abs(dx) + Math.abs(e.clientY - sy) * 0.0;
    if (dx) { onDelta(dx); s.dirty = true; }
  });
  function up(e) {
    if (!down) return; down = false; s.drag = false; s.dirty = true;
    if (Math.abs(e.clientX - sx) < 6 && Math.abs(e.clientY - sy) < 6 && onTap) { var r = cv.getBoundingClientRect(); onTap(e.clientX - r.left, e.clientY - r.top); }
  }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', function () { down = false; s.drag = false; });
}

/* glow sprites */
var SPR = {};
function sprite(c, size) {
  var cv = D.createElement('canvas'); cv.width = cv.height = size; var x = cv.getContext('2d');
  var g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(c, 1)); g.addColorStop(.22, rgba(c, .6)); g.addColorStop(.55, rgba(c, .16)); g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g; x.fillRect(0, 0, size, size); return cv;
}
function sprites() { if (!SPR.cy) { SPR.cy = sprite(C.cy, 64); SPR.or = sprite(C.or, 64); SPR.wh = sprite(C.wh, 64); SPR.bl = sprite(C.bl, 64); SPR.pale = sprite(C.pale, 64); } return SPR; }
function glow(ctx, spr, x, y, size, a) { ctx.globalAlpha = a; ctx.drawImage(spr, x - size / 2, y - size / 2, size, size); ctx.globalAlpha = 1; }

/* ================= BODY MODEL ================= */
var BODY = null;
var TORSO = [[.70, .17, .10], [.665, .255, .12], [.60, .255, .14], [.52, .245, .145], [.44, .225, .135], [.36, .20, .12], [.28, .178, .105], [.20, .17, .10], [.12, .195, .11], [.05, .21, .115], [.0, .21, .115]];
function torsoAt(y) {
  for (var i = 0; i < TORSO.length - 1; i++) { var a = TORSO[i], b = TORSO[i + 1]; if (y <= a[0] && y >= b[0]) { var t = (a[0] - y) / (a[0] - b[0]); return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; } }
  return [.2, .11];
}
function buildBody() {
  var V = [], NX = [], NZ = [], GR = [], S = [], Q = [];
  function vtx(x, y, z, g, nx, nz) { V.push(x, y, z); GR.push(g); NX.push(nx); NZ.push(nz); return GR.length - 1; }
  /* rings: [cx,cy,cz,rx,rz]; gf(ring,sin,cos) -> group; every `ls`-th longitudinal line is drawn */
  function stack(rings, N, gf, ls) {
    var rows = [], i, k;
    for (i = 0; i < rings.length; i++) {
      var r = rings[i], row = [];
      for (k = 0; k < N; k++) { var a = k / N * TAU, sn = Math.sin(a), cs = Math.cos(a); row.push(vtx(r[0] + r[3] * sn, r[1], r[2] + r[4] * cs, gf(r, sn, cs), sn, cs)); }
      rows.push(row);
    }
    for (i = 0; i < rings.length; i++) for (k = 0; k < N; k++) {
      var k2 = (k + 1) % N;
      S.push(rows[i][k], rows[i][k2]);
      if (i < rings.length - 1) {
        if (k % (ls || 1) === 0) S.push(rows[i][k], rows[i + 1][k]);
        Q.push(rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]);
      }
    }
  }
  function poly(pts, g) { var prev = -1; pts.forEach(function (p) { var id = vtx(p[0], p[1], p[2], g, 0, 1); if (prev >= 0) S.push(prev, id); prev = id; }); }
  var none = function () { return GI.None; };
  function gTorso(r, sn, cs) {
    var y = r[1];
    if (y >= .66) return cs < -.2 ? GI.Back : (Math.abs(sn) > .75 ? GI.Shoulders : GI.Chest);
    if (y >= .47) { if (Math.abs(sn) > .88 && y >= .55) return GI.Shoulders; return cs >= 0 ? GI.Chest : GI.Back; }
    if (y >= .05) return cs < -.35 ? GI.Back : GI.Core;
    return GI.Legs;
  }
  /* torso */
  stack(TORSO.map(function (t) { return [0, t[0], 0, t[1], t[2]]; }), 24, gTorso, 2);
  /* head + neck (the “helmet”) */
  stack([[0, .78, 0, .07, .08], [0, .81, 0, .1, .11], [0, .86, 0, .115, .13], [0, .915, 0, .118, .135], [0, .965, 0, .1, .12], [0, .99, 0, .07, .08], [0, 1.0, 0, .03, .035]], 14, none, 1);
  stack([[0, .74, 0, .06, .06], [0, .70, 0, .075, .075]], 10, none, 1);
  [-1, 1].forEach(function (s) {
    /* deltoid */
    var dy = [-.08, -.045, 0, .045, .08];
    stack(dy.map(function (o) { var rr = Math.sqrt(Math.max(0, 1 - (o / .09) * (o / .09))); return [s * .305, .625 + o, 0, .085 * rr + .01, .09 * rr + .01]; }), 12, function () { return GI.Shoulders; }, 1);
    /* upper arm: biceps front · triceps back */
    var up = [];
    for (var i = 0; i < 5; i++) { var t = i / 4, bulge = [0, .09, .12, .06, 0][i]; up.push([s * lerp(.325, .372, t), lerp(.575, .36, t), 0, lerp(.068, .054, t) + bulge * .05, lerp(.066, .052, t) + bulge * .09]); }
    stack(up, 12, function (r, sn, cs) { return cs < -.2 ? GI.Triceps : GI.Biceps; }, 1);
    /* forearm + hand */
    var fa = []; for (i = 0; i < 5; i++) { var u = i / 4; fa.push([s * lerp(.375, .432, u), lerp(.35, .13, u), 0, lerp(.058, .034, u), lerp(.058, .036, u)]); }
    stack(fa, 10, none, 2);
    stack([[s * .436, .11, 0, .032, .022], [s * .438, .075, 0, .04, .025], [s * .44, .04, 0, .036, .02], [s * .44, .015, 0, .02, .012]], 8, none, 1);
    /* leg: thigh, calf, foot */
    var th = []; for (i = 0; i < 7; i++) { var q = i / 6; th.push([s * lerp(.105, .115, q), lerp(.0, -.5, q), lerp(.01, 0, q), lerp(.108, .07, q), lerp(.112, .072, q) + [0, .008, .01, .005, 0, 0, 0][i]]); }
    stack(th, 14, function () { return GI.Legs; }, 1);
    var ca = [[.115, -.5, .066, .066], [.118, -.57, .074, .076], [.12, -.66, .068, .07], [.12, -.76, .054, .054], [.12, -.86, .04, .04], [.12, -.93, .033, .033]];
    stack(ca.map(function (c) { return [s * c[0], c[1], 0, c[2], c[3]]; }), 14, function () { return GI.Legs; }, 1);
    stack([[s * .12, -.945, .04, .04, .06], [s * .12, -.975, .06, .05, .1], [s * .12, -1.0, .07, .05, .12]], 10, none, 1);
  });
  /* surface detail lines: abs, pecs, collar */
  function sz(x, y) { var t = torsoAt(y); return t[1] * Math.sqrt(Math.max(0, 1 - (x / t[0]) * (x / t[0]))) + .004; }
  var pts = [], y;
  for (y = .47; y >= .1; y -= .04) pts.push([0, y, sz(0, y)]); poly(pts, GI.Core);
  [-1, 1].forEach(function (s) {
    pts = []; for (y = .45; y >= .14; y -= .05) pts.push([s * .058, y, sz(s * .058, y)]); poly(pts, GI.Core);
    pts = []; for (y = .50; y >= .22; y -= .045) pts.push([s * .17, y, sz(s * .17, y)]); poly(pts, GI.Core);
    pts = []; for (var x = .02; x <= .2; x += .03) { var yy = .515 - .028 * Math.sin((x / .2) * 1.6); pts.push([s * x, yy, sz(s * x, yy)]); } poly(pts, GI.Chest);
  });
  [.40, .33, .26].forEach(function (yy) { pts = []; for (var x = -.115; x <= .1151; x += .0383) pts.push([x, yy, sz(x, yy)]); poly(pts, GI.Core); });
  pts = []; for (var x = -.2; x <= .2001; x += .05) pts.push([x, .645 - Math.abs(x) * .06, sz(x, .645)]); poly(pts, GI.Chest);
  return { V: new Float32Array(V), NX: new Float32Array(NX), NZ: new Float32Array(NZ), GR: GR, S: S, Q: Q, n: GR.length };
}

/* ================= BODY RENDER ================= */
function bodyState(s) {
  var u = s.ud, B = BODY || (BODY = buildBody());
  if (!u.px) { u.px = new Float32Array(B.n); u.py = new Float32Array(B.n); u.pz = new Float32Array(B.n); u.nz = new Float32Array(B.n); u.yaw = u.yaw === undefined ? .45 : u.yaw; u.sel = -1; u.cidx = [4, 4, 4, 4, 4, 4, 4, 4]; u.lists = []; u.fills = []; for (var i = 0; i < 18; i++) u.lists.push([]); for (i = 0; i < 6; i++) u.fills.push([]); }
  return B;
}
function ringPath(ctx, pr, y, r, a0, a1, N) {
  for (var i = 0; i <= N; i++) { var a = a0 + (a1 - a0) * i / N; pr(Math.cos(a) * r, y, Math.sin(a) * r); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); }
}
var PX = 0, PY = 0, PZ = 0;
function drawBody(ctx, w, h, t, s) {
  var B = bodyState(s), u = s.ud, mini = !!u.mini, d = getData();
  /* data → colours (cheap, cached 1.2 s) */
  if (u.stamp !== d.at) { u.stamp = d.at; u.cidx = cidxList(d); }
  /* yaw: user drag > selection tween > idle spin */
  var dt = u.dtc = t - (u.t0 || t); u.t0 = t; if (dt > 100) dt = 16;
  if (!mini) {
    if (u.tgt !== undefined && u.tgt !== null) { var df = Math.atan2(Math.sin(u.tgt - u.yaw), Math.cos(u.tgt - u.yaw)); u.yaw += df * Math.min(1, dt * .008); if (Math.abs(df) < .01) u.tgt = null; }
    else if (!s.drag && !lite() && t - (u.userT || 0) > 2600) u.yaw += dt * .00032;
    u.vel = u.vel || 0; if (!s.drag && Math.abs(u.vel) > .0004) { u.yaw += u.vel * dt; u.vel *= .94; }
  }
  var yaw = u.yaw, cyw = Math.cos(yaw), syw = Math.sin(yaw), pitch = mini ? .05 : .13, cp = Math.cos(pitch), sp = Math.sin(pitch), F = 4.4;
  var sc = mini ? h / 2.45 : Math.min(h / 2.62, w / 2.05), cx = w / 2, cy = h / 2 + (mini ? 0 : sc * .02);
  var V = B.V, NX = B.NX, NZ = B.NZ, px = u.px, py = u.py, pz = u.pz, nz = u.nz, i, x, y, z, xr, zr, yp, zp, k;
  for (i = 0; i < B.n; i++) {
    x = V[i * 3]; y = V[i * 3 + 1]; z = V[i * 3 + 2];
    xr = x * cyw + z * syw; zr = -x * syw + z * cyw; yp = y * cp - zr * sp; zp = y * sp + zr * cp; k = F / (F - zp);
    px[i] = cx + xr * sc * k; py[i] = cy - yp * sc * k; pz[i] = zp; nz[i] = -NX[i] * syw + NZ[i] * cyw;
  }
  function pr(x, y, z) { var xr = x * cyw + z * syw, zr = -x * syw + z * cyw, yp = y * cp - zr * sp, zp = y * sp + zr * cp, k = F / (F - zp); PX = cx + xr * sc * k; PY = cy - yp * sc * k; PZ = zp; }
  var sprs = sprites(), pulse = .78 + .22 * Math.sin(t * .004);
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';

  /* pedestal + halo rings (behind the body) */
  if (!mini) {
    pr(0, -1.03, 0); var bx = PX, by = PY;
    ctx.save(); ctx.translate(bx, by); ctx.scale(1, .3);
    var gg = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * 1.05); gg.addColorStop(0, rgba(C.cy, .45)); gg.addColorStop(.35, rgba(C.bl, .22)); gg.addColorStop(1, rgba(C.bl, 0));
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, sc * 1.05, 0, TAU); ctx.fill(); ctx.restore();
    var spin = t * .00045;
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(C.cy, .75); ctx.beginPath(); ringPath(ctx, pr, -1.03, .44, 0, TAU, 56); ctx.stroke();
    ctx.setLineDash([2, 7]); ctx.lineDashOffset = -t * .012; ctx.strokeStyle = rgba(C.pale, .55); ctx.beginPath(); ringPath(ctx, pr, -1.03, .62, 0, TAU, 64); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 3.6; ctx.strokeStyle = rgba(C.bl, .9);
    for (i = 0; i < 4; i++) { ctx.beginPath(); ringPath(ctx, pr, -1.03, .8, spin + i * TAU / 4, spin + i * TAU / 4 + .95, 16); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .3); ctx.beginPath(); ringPath(ctx, pr, -1.03, .95, 0, TAU, 72); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .12);
    for (i = 0; i < 6; i++) { var a = i * TAU / 6 + .3; pr(Math.cos(a) * .8, -1.03, Math.sin(a) * .8); var ax = PX, ay = PY; pr(Math.cos(a) * .52, 1.17, Math.sin(a) * .52); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(PX, PY); ctx.stroke(); }
    /* halo above the head */
    ctx.lineWidth = 1.1; ctx.strokeStyle = rgba(C.cy, .7); ctx.beginPath(); ringPath(ctx, pr, 1.17, .26, 0, TAU, 40); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.bl, .85);
    for (i = 0; i < 3; i++) { ctx.beginPath(); ringPath(ctx, pr, 1.17, .52, -spin * 1.3 + i * TAU / 3, -spin * 1.3 + i * TAU / 3 + 1.25, 14); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .35); ctx.beginPath(); ringPath(ctx, pr, 1.17, .68, 0, TAU, 48); ctx.stroke();
    pr(0, 1.17, 0); var tx = PX, ty = PY; pr(0, 1.03, 0);
    var bg = ctx.createLinearGradient(0, ty, 0, PY); bg.addColorStop(0, rgba(C.cy, .7)); bg.addColorStop(1, rgba(C.cy, .05)); ctx.strokeStyle = bg; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(PX, PY); ctx.stroke();
  }

  /* bucket the surface */
  var lists = u.lists, fills = u.fills, S = B.S, Q = B.Q, GR = B.GR, ci = u.cidx, sel = u.sel, a, b, f, fi, g, c;
  for (i = 0; i < 18; i++) lists[i].length = 0; for (i = 0; i < 6; i++) fills[i].length = 0;
  for (i = 0; i < S.length; i += 2) {
    a = S[i]; b = S[i + 1]; g = GR[a]; c = g === sel ? 5 : ci[g]; f = (nz[a] + nz[b]) * .5; fi = f > .22 ? 2 : f > -.15 ? 1 : 0;
    if (mini && fi === 0) continue;
    lists[c * 3 + fi].push(a, b);
  }
  for (i = 0; i < Q.length; i += 4) {
    a = Q[i]; b = Q[i + 1]; if (nz[a] + nz[b] < .12) continue;
    g = GR[a]; c = g === sel ? 5 : ci[g]; fills[c].push(Q[i], Q[i + 1], Q[i + 2], Q[i + 3]);
  }
  var j, L, al;
  for (c = 0; c < 6; c++) {
    L = fills[c]; if (!L.length) continue;
    ctx.beginPath(); for (j = 0; j < L.length; j += 4) { ctx.moveTo(px[L[j]], py[L[j]]); ctx.lineTo(px[L[j + 1]], py[L[j + 1]]); ctx.lineTo(px[L[j + 2]], py[L[j + 2]]); ctx.lineTo(px[L[j + 3]], py[L[j + 3]]); ctx.closePath(); }
    ctx.fillStyle = rgba(COL[c], FAL[c] * (c === 0 ? pulse : 1)); ctx.fill();
  }
  for (fi = 0; fi < 3; fi++) for (c = 0; c < 6; c++) {
    L = lists[c * 3 + fi]; if (!L.length) continue;
    al = LAL[fi] * (c === 0 ? pulse : 1);
    ctx.beginPath(); for (j = 0; j < L.length; j += 2) { ctx.moveTo(px[L[j]], py[L[j]]); ctx.lineTo(px[L[j + 1]], py[L[j + 1]]); }
    if (fi === 2 && !mini && lvl() < 1 && (c === 0 || c === 3 || c === 5)) { ctx.lineWidth = 3.4; ctx.strokeStyle = rgba(COL[c], .08); ctx.stroke(); }
    ctx.lineWidth = fi === 2 ? (mini ? .8 : 1.15) : .6; ctx.strokeStyle = rgba(COL[c], al); ctx.stroke();
  }

  /* arc reactor, repulsors, visor — fade as the body turns away */
  var face = Math.max(0, cyw);
  if (face > .05 && !mini) {
    pr(0, .535, .15); glow(ctx, sprs.cy, PX, PY, sc * .30 * (1 + .1 * Math.sin(t * .005)), face); glow(ctx, sprs.wh, PX, PY, sc * .11, face * .9);
    ctx.strokeStyle = rgba(C.wh, .7 * face); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(PX, PY, sc * .052, 0, TAU); ctx.stroke(); ctx.strokeStyle = rgba(C.cy, .5 * face); ctx.beginPath(); ctx.arc(PX, PY, sc * .082, 0, TAU); ctx.stroke();
    [-1, 1].forEach(function (sd) { pr(sd * .44, .06, .035); glow(ctx, sprs.cy, PX, PY, sc * .1, face * .85); pr(sd * .042, .91, .13); glow(ctx, sprs.wh, PX, PY, sc * .07, face); glow(ctx, sprs.cy, PX, PY, sc * .16, face * .6); });
  }
  if (!mini) {
    /* scan ring: one clean sweep up and down the body */
    var ph = (t % 5200) / 5200, sy = -1 + 2.04 * (ph < .5 ? ph * 2 : 2 - ph * 2);
    ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(C.cy, .85); ctx.beginPath(); ringPath(ctx, pr, sy, .4, 0, TAU, 40); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.cy, .09); ctx.beginPath(); ringPath(ctx, pr, sy, .4, 0, TAU, 40); ctx.stroke();
  } else if (u.scan) {
    var p2 = (t % 4000) / 4000; ctx.fillStyle = rgba(C.cy, .5); ctx.fillRect(w * .1, h * (.06 + .88 * p2), w * .8, 1.2);
  }
  /* selected muscle marker */
  if (u.pick && sel >= 0 && !mini) {
    var pi = u.pick; ctx.strokeStyle = rgba(C.wh, .95); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(px[pi], py[pi], 8 + 2 * Math.sin(t * .008), 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px[pi] - 14, py[pi]); ctx.lineTo(px[pi] - 4, py[pi]); ctx.moveTo(px[pi] + 4, py[pi]); ctx.lineTo(px[pi] + 14, py[pi]); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function bodyPick(s, mx, my) {
  var u = s.ud, B = BODY, best = -1, bd = 34 * 34;
  for (var i = 0; i < B.n; i++) { if (B.GR[i] > 6 || u.nz[i] < .1) continue; var dx = u.px[i] - mx, dy = u.py[i] - my, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
  return best;
}

/* ================= MONTH GLOBE ================= */
function monthDays(y, m, mode) {
  var out = [], first = new Date(y, m, 1), off = (first.getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate(), today = isoDate(new Date());
  var startIso = ''; try { startIso = getStartISO(); } catch (e) { }
  for (var dn = 1; dn <= n; dn++) {
    var dt = new Date(y, m, dn), iso = isoDate(dt), w = (dt.getDay() + 6) % 7, row = Math.floor((dn - 1 + off) / 7), o = { d: dn, iso: iso, w: w, row: row, state: 'none', pct: null, label: '', today: iso === today };
    try {
      if (mode === 'habits') {
        if (iso >= startIso && iso <= today) { var sc = dayHabitScore(dt); if (sc.possible > 0) { o.pct = clamp(sc.done / sc.possible, 0, 1); o.state = o.pct >= .8 ? 'done' : o.pct >= .5 ? 'mid' : 'missed'; o.label = sc.done + '/' + sc.possible + ' habits · ' + Math.round(o.pct * 100) + '%'; } else { o.state = 'rest'; o.label = 'nothing due'; } }
        else o.state = iso > today ? 'future' : 'none';
      } else {
        var plan = gymPlanFor(iso), st = getGymStatus(iso);
        if (!plan) { o.state = iso > today ? 'future' : 'none'; o.label = 'before tracking'; }
        else if (plan.type === 'rest') { o.state = 'rest'; o.label = 'Rest day'; }
        else {
          var nm = plan.title ? plan.title.replace(/^\S+\s/, '') : 'Workout';
          if (st === 'done') { o.state = 'done'; o.label = nm + ' · DONE'; }
          else if (st === 'missed') { o.state = 'missed'; o.label = nm + ' · MISSED'; }
          else if (st === 'exception') { o.state = 'exc'; o.label = nm + ' · excused'; }
          else if (iso > today) { o.state = 'future'; o.label = nm + ' · scheduled'; }
          else if (iso === today) { o.state = 'pending'; o.label = nm + ' · today'; }
          else { o.state = 'unmarked'; o.label = nm + ' · not marked'; }
        }
      }
    } catch (e) { }
    out.push(o);
  }
  var rows = Math.floor((n - 1 + off) / 7) + 1; return { days: out, rows: rows, n: n };
}
function drawGlobe(ctx, w, h, t, s) {
  var u = s.ud, sprs = sprites(); if (!u.md || u.mkey !== u.y + '-' + u.m + '-' + u.mode + '-' + getData().at) { u.mkey = u.y + '-' + u.m + '-' + u.mode + '-' + getData().at; u.md = monthDays(u.y, u.m, u.mode); }
  var md = u.md, R = Math.min(w, h) * .335, cx = w / 2, cy = h / 2, dt = Math.min(90, t - (u.t0 || t)); u.t0 = t;
  if (!s.drag && !lite() && t - (u.userT || 0) > 2200 && !u.hold) u.rot += dt * .00022;
  if (u.vel && !s.drag && Math.abs(u.vel) > .0004) { u.rot += u.vel * dt; u.vel *= .94; }
  var cyw = Math.cos(u.rot), syw = Math.sin(u.rot), tilt = .42, ct = Math.cos(tilt), st = Math.sin(tilt);
  function pr(x, y, z) { var xr = x * cyw + z * syw, zr = -x * syw + z * cyw, yt = y * ct - zr * st, zt = y * st + zr * ct; PX = cx + xr * R; PY = cy - yt * R; PZ = zt; }
  ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  /* atmosphere */
  var ag = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.12); ag.addColorStop(0, rgba(C.bl, .13)); ag.addColorStop(.8, rgba(C.bl, .06)); ag.addColorStop(1, rgba(C.cy, 0));
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(C.cy, .35); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  /* lattice: meridian = weekday column, parallel = week row */
  var rows = md.rows, fr = new Path2D(), bk = new Path2D(), N = 36, j, i, lon, lat, pz0 = 0, px0 = 0, py0 = 0;
  function line(fn, lo, hi) {
    for (i = 0; i <= N; i++) { var q = lo + (hi - lo) * i / N; fn(q); if (i) { var p = (PZ + pz0) > 0 ? fr : bk; p.moveTo(px0, py0); p.lineTo(PX, PY); } px0 = PX; py0 = PY; pz0 = PZ; }
  }
  for (j = 0; j < 14; j++) { lon = j * TAU / 14; line(function (q) { pr(Math.cos(q) * Math.sin(lon), Math.sin(q), Math.cos(q) * Math.cos(lon)); }, -1.35, 1.35); }
  for (j = -1; j <= rows; j++) { lat = ((rows - 1) / 2 - j) * .349; line(function (q) { pr(Math.cos(lat) * Math.sin(q), Math.sin(lat), Math.cos(lat) * Math.cos(q)); }, 0, TAU); }
  ctx.lineWidth = .8; ctx.strokeStyle = rgba(C.bl, .13); ctx.stroke(bk); ctx.strokeStyle = rgba(C.cy, .42); ctx.stroke(fr);
  /* orbit rings */
  [[1.32, .6, .9, 0], [1.2, -.9, -.7, 1.7]].forEach(function (o, ri) {
    var a0 = t * .0003 * (ri ? -1 : 1), co = Math.cos(o[1]), so = Math.sin(o[1]), p0x = 0, p0y = 0;
    ctx.lineWidth = ri ? 1 : 1.6; ctx.strokeStyle = rgba(ri ? C.pale : C.bl, ri ? .3 : .55);
    ctx.beginPath(); for (i = 0; i <= 60; i++) { var a = a0 + i / 60 * TAU, x = Math.cos(a) * o[0], z = Math.sin(a) * o[0], y = 0, x2 = x * co - y * so, y2 = x * so + y * co; pr(x2, y2 * .55 + z * .18, z * .82); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); } ctx.stroke();
  });
  /* day nodes */
  var nodes = [];
  md.days.forEach(function (dd) { lon = dd.w * TAU / 7; lat = ((rows - 1) / 2 - dd.row) * .349; pr(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)); nodes.push({ d: dd, x: PX, y: PY, z: PZ }); });
  nodes.sort(function (a, b) { return a.z - b.z; }); u.nodes = nodes;
  nodes.forEach(function (n) {
    var dd = n.d, front = n.z > -.05 ? 1 : .28, spr = sprs.cy, size = 15, core = false, a = front;
    switch (dd.state) {
      case 'done': spr = sprs.cy; size = 18; core = true; break;
      case 'mid': spr = sprs.bl; size = 15; core = true; break;
      case 'missed': spr = sprs.or; size = 17; core = true; break;
      case 'rest': spr = sprs.pale; size = 10; a *= .7; break;
      case 'exc': spr = sprs.or; size = 10; a *= .55; break;
      case 'pending': spr = sprs.wh; size = 15; core = true; break;
      case 'unmarked': spr = sprs.or; size = 12; a *= .6; break;
      default: spr = sprs.bl; size = 7; a *= .45;
    }
    if (dd.state === 'done' && dd.pct !== null) size = 11 + 9 * dd.pct;
    if (dd.state === 'mid' || dd.state === 'missed') if (dd.pct !== null) size = 9 + 11 * Math.max(.3, dd.pct);
    size *= (1 + n.z * .18);
    glow(ctx, spr, n.x, n.y, size * 1.9, a * .9);
    if (core) { ctx.fillStyle = rgba(C.wh, a * .95); ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(1.2, size * .11), 0, TAU); ctx.fill(); }
    if (dd.today) { var pu = .6 + .4 * Math.sin(t * .006); ctx.strokeStyle = rgba(C.wh, a * pu); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(n.x, n.y, size * .72 + 3 * pu, 0, TAU); ctx.stroke(); }
    if (u.sel === dd.d) { ctx.strokeStyle = rgba(C.wh, a); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(n.x, n.y, size * .9 + 2, 0, TAU); ctx.stroke(); }
    if (front === 1 && w > 240 && (u.sel === dd.d || dd.today)) { ctx.fillStyle = rgba(C.wh, .95); ctx.font = '600 10px "Chakra Petch",monospace'; ctx.textAlign = 'center'; ctx.fillText(String(dd.d), n.x, n.y - size * .95 - 3); }
  });
  ctx.globalCompositeOperation = 'source-over';
}
function globePick(s, mx, my) {
  var best = null, bd = 28 * 28; (s.ud.nodes || []).forEach(function (n) { if (n.z < -.05) return; var dx = n.x - mx, dy = n.y - my, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = n.d; } }); return best;
}

/* ================= 3D BAR TOWER ================= */
function drawTower(ctx, w, h, t, s) {
  var u = s.ud, bars = u.bars || []; if (!bars.length) { ctx.clearRect(0, 0, w, h); return; }
  var n = bars.length, spc = n > 7 ? .62 : .8, bw = spc * .33, dt = Math.min(90, t - (u.t0 || t)); u.t0 = t;
  if (!s.drag && !lite() && t - (u.userT || 0) > 2500) u.ph += dt * .0006;
  if (u.vel && !s.drag && Math.abs(u.vel) > .0004) { u.off += u.vel * dt; u.vel *= .93; }
  u.off = clamp(u.off, -1.2, 1.2);
  var yaw = (lite() ? 0 : Math.sin(u.ph) * .26) + u.off - .12, cyw = Math.cos(yaw), syw = Math.sin(yaw), pitch = .5, cp = Math.cos(pitch), sp = Math.sin(pitch), F = 7;
  var hs = (n - 1) / 2 * spc + .6, sc = Math.min(w / (2 * hs * 1.08), h / 2.5), cx = w / 2, cy = h * .66;
  var mx = 1e-9; bars.forEach(function (b) { mx = Math.max(mx, b.v, b.pv || 0); });
  var HH = 1.55;
  function pr(x, y, z) { var xr = x * cyw + z * syw, zr = -x * syw + z * cyw, yp = y * cp - zr * sp, zp = y * sp + zr * cp, k = F / (F - zp); PX = cx + xr * sc * k; PY = cy - yp * sc * k; PZ = zp; }
  ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  var sprs = sprites(), zf = .62;
  /* floor plate + grid */
  pr(-hs, 0, zf); var a0 = [PX, PY]; pr(hs, 0, zf); var a1 = [PX, PY]; pr(hs, 0, -zf); var a2 = [PX, PY]; pr(-hs, 0, -zf); var a3 = [PX, PY];
  ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.lineTo(a3[0], a3[1]); ctx.closePath(); ctx.fillStyle = rgba(C.bl, .07); ctx.fill(); ctx.strokeStyle = rgba(C.cy, .55); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = rgba(C.cy, .16); ctx.lineWidth = .8; ctx.beginPath();
  for (var gx = -hs; gx <= hs + .001; gx += spc / 2) { pr(gx, 0, zf); ctx.moveTo(PX, PY); pr(gx, 0, -zf); ctx.lineTo(PX, PY); }
  for (var gz = -zf; gz <= zf + .001; gz += zf / 2) { pr(-hs, 0, gz); ctx.moveTo(PX, PY); pr(hs, 0, gz); ctx.lineTo(PX, PY); }
  ctx.stroke();
  /* height guide rails */
  ctx.strokeStyle = rgba(C.cy, .18); ctx.setLineDash([3, 5]);
  [.5, 1].forEach(function (f) { pr(-hs, HH * f, -zf); ctx.beginPath(); ctx.moveTo(PX, PY); pr(-hs, HH * f, zf); ctx.lineTo(PX, PY); pr(hs, HH * f, zf); ctx.lineTo(PX, PY); ctx.stroke(); });
  ctx.setLineDash([]);
  /* order bars far → near */
  var order = bars.map(function (b, i) { var x = (i - (n - 1) / 2) * spc; return { b: b, i: i, x: x, d: -x * syw }; }).sort(function (a, b) { return a.d - b.d; });
  u.pts = [];
  order.forEach(function (o) {
    var b = o.b, x0 = o.x - bw, x1 = o.x + bw, z0 = -bw, z1 = bw, H = Math.max(.012, b.v / mx * HH), hot = b.today, col = b.cur ? C.or : C.cy, fc = b.cur ? C.or : C.bl;
    var grow = u.grow === undefined ? 1 : u.grow; H *= grow;
    /* ghost: the same slot last period, as a wireframe */
    if (b.pv > 0) {
      var GH = b.pv / mx * HH * grow; ctx.strokeStyle = rgba(C.am, .5); ctx.lineWidth = .9; ctx.setLineDash([3, 3]); ctx.beginPath();
      var cs = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], q;
      for (q = 0; q < 4; q++) { pr(cs[q][0], GH, cs[q][1]); if (q) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); } ctx.closePath(); ctx.stroke();
      ctx.beginPath(); for (q = 0; q < 4; q++) { pr(cs[q][0], 0, cs[q][1]); ctx.moveTo(PX, PY); pr(cs[q][0], GH, cs[q][1]); ctx.lineTo(PX, PY); } ctx.stroke(); ctx.setLineDash([]);
    }
    var faces = [
      [[x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], 'S'],
      [[x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], 'S'],
      [[x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], 'S'],
      [[x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], 'S'],
      [[x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], 'T']];
    faces.forEach(function (fc2) {
      var P = [], ar = 0, q; for (q = 0; q < 4; q++) { pr(fc2[q][0], fc2[q][1], fc2[q][2]); P.push([PX, PY]); }
      for (q = 0; q < 4; q++) { var p = P[q], r = P[(q + 1) % 4]; ar += p[0] * r[1] - r[0] * p[1]; }
      if (ar >= 0) return;                                             // back-facing
      var top = fc2[4] === 'T';
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (q = 1; q < 4; q++) ctx.lineTo(P[q][0], P[q][1]); ctx.closePath();
      ctx.fillStyle = rgba(col, top ? .38 : .15); ctx.fill(); ctx.strokeStyle = rgba(col, top ? .95 : .8); ctx.lineWidth = 1.2; ctx.stroke();
      if (!top) {                                                       // hologram scan-lines
        ctx.strokeStyle = rgba(col, .2); ctx.lineWidth = .8; ctx.beginPath();
        var nl = Math.max(2, Math.floor(H / .09)); for (q = 1; q < nl; q++) { var f = q / nl; ctx.moveTo(lerp(P[0][0], P[3][0], f), lerp(P[0][1], P[3][1], f)); ctx.lineTo(lerp(P[1][0], P[2][0], f), lerp(P[1][1], P[2][1], f)); } ctx.stroke();
      }
    });
    pr(o.x, H, 0); var tx = PX, ty = PY; u.pts.push({ x: tx, y: ty, i: o.i });
    if (b.v > 0) { glow(ctx, b.cur ? sprs.or : sprs.cy, tx, ty, sc * .5, hot ? .55 + .3 * Math.sin(t * .006) : .35); }
    ctx.globalCompositeOperation = 'source-over';
    if (b.v > 0 && w > 200) { ctx.fillStyle = rgba(C.wh, .92); ctx.font = '600 ' + (w < 330 ? 9 : 10.5) + 'px "Chakra Petch",monospace'; ctx.textAlign = 'center'; ctx.fillText(fmtK(b.v), tx, ty - 7); }
    pr(o.x, 0, zf + .3); ctx.fillStyle = rgba(hot ? C.wh : C.pale, hot ? 1 : .75); ctx.font = '600 ' + (w < 330 ? 8.5 : 10) + 'px "Chakra Petch",monospace'; ctx.textAlign = 'center'; ctx.fillText(b.label, PX, PY + 3);
    ctx.globalCompositeOperation = 'lighter';
    if (u.sel === o.i) { pr(o.x, H, 0); ctx.strokeStyle = rgba(C.wh, .95); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(PX, PY, 9, 0, TAU); ctx.stroke(); }
  });
  ctx.globalCompositeOperation = 'source-over';
  if (u.grow < 1) { u.grow = Math.min(1, u.grow + dt * .0026); s.dirty = true; }
}
function towerBars(d, mode) {
  var out = [], i, todayIdx = daysBetween(d.mon, d.today);
  if (mode === 'weeks') { for (i = 0; i < d.vol8.length; i++) out.push({ v: d.vol8[i], pv: 0, label: gymDL(d.vol8k[i]).replace(/ .*/, '') + '/' + (parseISO(d.vol8k[i]).getMonth() + 1), cur: i === d.vol8.length - 1, today: false, tip: 'Week of ' + gymDL(d.vol8k[i]) }); }
  else { for (i = 0; i < 7; i++) out.push({ v: d.weekVol[i], pv: d.prevVol[i], label: DOWS[i], cur: false, today: i === todayIdx, tip: DOWS[i] + ' ' + gymDL(gymAddDays(d.mon, i)) }); }
  return out;
}

/* ================= CSS ================= */
function injectCSS() {
  if (D.getElementById('holo-css')) return;
  var st = D.createElement('style'); st.id = 'holo-css';
  st.textContent = [
    '.hl-room{display:grid;gap:14px;max-width:1260px;margin:0 auto;grid-template-columns:1fr}',
    '.hl-col{display:grid;gap:14px;align-content:start}',
    '.hl-stage{order:-1;position:relative;border:1px solid rgba(96,226,255,.26);border-radius:6px;background:radial-gradient(72% 52% at 50% 46%,rgba(47,123,255,.24),rgba(4,12,28,0) 72%),linear-gradient(180deg,rgba(7,20,44,.75),rgba(2,8,18,.88));overflow:hidden}',
    '.hl-stage::before,.hl-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(96,226,255,.045) 1px,transparent 1px) 0 0/100% 4px;opacity:.55}',
    '.hl-body{position:relative;height:min(128vw,640px);width:100%}',
    '.hl-cv{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}',
    '.hl-cv:active{cursor:grabbing}',
    '.hl-hint{position:absolute;left:12px;top:10px;font:600 10px/1.3 "Chakra Petch",monospace;color:rgba(170,214,255,.7);letter-spacing:.12em;pointer-events:none}',
    '.hl-legend{position:absolute;right:12px;top:10px;display:grid;gap:3px;font:600 9.5px/1.2 "Chakra Petch",monospace;color:rgba(200,230,255,.85);pointer-events:none;text-align:right}',
    '.hl-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:6px;vertical-align:-1px}',
    '.hl-chips{position:relative;display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 10px;justify-content:center}',
    '.hl-chip{appearance:none;border:1px solid rgba(96,226,255,.28);background:rgba(8,22,46,.7);color:#cfeaff;border-radius:3px;padding:5px 9px;font:600 11px/1 "Chakra Petch",monospace;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:30px}',
    '.hl-chip i{width:8px;height:8px;border-radius:50%;box-shadow:0 0 8px currentColor;background:currentColor}',
    '.hl-chip b{font-weight:700;color:#fff}',
    '.hl-chip.on{border-color:#e6fbff;background:rgba(40,110,225,.45);box-shadow:0 0 14px rgba(96,226,255,.35)}',
    '.hl-read{position:relative;margin:0 10px 10px;padding:9px 12px;border-left:2px solid rgba(96,226,255,.7);background:rgba(8,22,46,.6);font:500 12.5px/1.45 "IBM Plex Sans",sans-serif;color:#d6ecff;min-height:42px}',
    '.hl-read b{font:700 12px "Chakra Petch",monospace;letter-spacing:.1em;color:#fff}',
    '.hl-panel{position:relative;border:1px solid rgba(96,226,255,.26);border-radius:6px;background:linear-gradient(160deg,rgba(40,110,225,.14),rgba(5,14,32,.82) 55%);padding:12px 12px 12px;overflow:hidden}',
    '.hl-panel>*{position:relative;z-index:1}',
    '.hl-panel::after{content:"";position:absolute;left:0;top:0;width:14px;height:14px;border-left:2px solid rgba(96,226,255,.85);border-top:2px solid rgba(96,226,255,.85);pointer-events:none}',
    '.hl-ph{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font:700 12px/1 "Chakra Petch",monospace;letter-spacing:.16em;color:#9fd8ff;text-transform:uppercase}',
    '.hl-ph small{font:600 10px "Chakra Petch",monospace;letter-spacing:.06em;color:rgba(170,214,255,.65);text-transform:none}',
    '.hl-seg{display:inline-flex;gap:0;border:1px solid rgba(96,226,255,.3);border-radius:3px;overflow:hidden}',
    '.hl-seg button{appearance:none;border:0;background:transparent;color:#a9d6ff;font:700 10px "Chakra Petch",monospace;letter-spacing:.08em;padding:5px 9px;cursor:pointer;min-height:26px}',
    '.hl-seg button.on{background:rgba(64,146,255,.4);color:#fff}',
    '.hl-nav{appearance:none;border:1px solid rgba(96,226,255,.3);background:transparent;color:#cfeaff;width:28px;height:26px;border-radius:3px;font:700 14px/1 sans-serif;cursor:pointer}',
    '.hl-cvw{position:relative;width:100%}',
    '.hl-cvw.globe{height:min(78vw,300px)}',
    '.hl-cvw.tower{height:min(62vw,250px)}',
    '.hl-cvw.mini{height:min(70vw,230px)}',
    '.hl-mrow{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:2px;font:700 13px "Chakra Petch",monospace;letter-spacing:.14em;color:#e6f6ff}',
    '.hl-key{display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:center;margin-top:6px;font:600 10px "Chakra Petch",monospace;color:#a9d6ff}',
    '.hl-key i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:-1px}',
    '.hl-split{display:grid;grid-template-columns:minmax(78px,38%) 1fr;gap:8px;align-items:center}',
    '.hl-bars{display:grid;gap:7px}',
    '.hl-bar{display:grid;grid-template-columns:70px 1fr auto;gap:7px;align-items:center;font:600 11px "Chakra Petch",monospace;color:#cfeaff}',
    '.hl-bar span:last-child{color:#fff;min-width:34px;text-align:right}',
    '.hl-trk{height:5px;background:rgba(96,226,255,.13);border-radius:2px;overflow:hidden}',
    '.hl-trk u{display:block;height:100%;width:0;border-radius:2px;transition:width .9s cubic-bezier(.2,.8,.2,1)}',
    '.hl-ring{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center}',
    '.hl-ring svg{width:96px;height:96px;display:block}',
    '.hl-ring circle.arc{transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)}',
    '.hl-ring text{font:700 20px "Chakra Petch",monospace;fill:#fff}',
    '.hl-stats{display:grid;gap:0}',
    '.hl-stat{display:grid;grid-template-columns:30px 1fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(96,226,255,.14);font:600 12px "Chakra Petch",monospace;color:#bfe0ff}',
    '.hl-stat:last-child{border-bottom:0}',
    '.hl-stat svg{width:22px;height:22px;stroke:#60e2ff;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',
    '.hl-stat b{font:700 18px "Chakra Petch",monospace;color:#fff;letter-spacing:.02em}',
    '.hl-scan{position:absolute;left:6%;right:6%;height:1.5px;background:linear-gradient(90deg,transparent,rgba(96,226,255,.85),transparent);animation:hlscan 4.2s ease-in-out infinite alternate;pointer-events:none}',
    '@keyframes hlscan{from{top:6%}to{top:94%}}',
    '.hl-empty{padding:18px 8px;text-align:center;font:500 12px/1.5 "IBM Plex Sans",sans-serif;color:#8fb6d8}',
    '.hl-slot{margin-bottom:22px}',
    '.hl-gym{display:grid;gap:12px}',
    '.hl-gym .hl-body{height:min(112vw,430px)}',
    '@media(min-width:720px){.hl-room{grid-template-columns:1fr 1fr}.hl-stage{grid-column:1/-1}.hl-body{height:min(70vw,640px)}}',
    '@media(min-width:1040px){.hl-room{grid-template-columns:minmax(260px,1fr) minmax(400px,1.25fr) minmax(260px,1fr);align-items:start}.hl-stage{grid-column:auto;order:0;grid-row:1}.hl-colL{grid-row:1;grid-column:1}.hl-colR{grid-row:1;grid-column:3}.hl-body{height:min(80vh,720px)}',
    '.hl-colL .hl-panel{transform:perspective(1100px) rotateY(7deg);transform-origin:100% 50%}.hl-colR .hl-panel{transform:perspective(1100px) rotateY(-7deg);transform-origin:0 50%}}',
    '@media(prefers-reduced-motion:reduce){.hl-scan{animation:none}.hl-trk u,.hl-ring circle.arc{transition:none}}',
    'html.fx-lite .hl-scan{animation:none}'
  ].join('\n');
  (D.head || D.documentElement).appendChild(st);
}

/* ================= reusable mounts ================= */
function setSel(inst, g) { var u = inst.ud; u.sel = g ? GI[g] : -1; u.pick = null; if (g) u.tgt = FACE_YAW[g]; u.userT = performance.now(); inst.dirty = true; }
function readoutFor(g, d) {
  var o = ginfo(d, g), need = Math.max(0, o.target - o.wk), c = COL[o.idx], hex = 'rgb(' + c.join(',') + ')';
  return '<b style="color:' + hex + '">' + g.toUpperCase() + ' · ' + o.label + '</b><br>' + o.s28 + ' sets in 28 days · ' + o.wk + '/' + o.target + ' this week · last trained ' + agoTxt(o.ago) +
    (need ? '. ' + need + ' more hard set' + (need > 1 ? 's' : '') + ' puts it on this week\'s target.' : '. Weekly target met.');
}
function mountBody(wrap, o) {
  o = o || {}; wrap.innerHTML = '';
  var s = attach(wrap, drawBody, { still: !!o.mini }); s.ud.mini = !!o.mini; s.ud.scan = !!o.scan; if (o.yaw !== undefined) s.ud.yaw = o.yaw;
  if (!o.mini) {
    dragger(s, function (dx) { s.ud.yaw += dx * .012; s.ud.vel = dx * .0007; s.ud.userT = performance.now(); s.ud.tgt = null; }, function (x, y) {
      bodyState(s); var i = bodyPick(s, x, y);
      if (i < 0) { setSel(s, null); o.onSel && o.onSel(null); return; }
      var gi = BODY.GR[i], g = GROUPS[gi]; s.ud.sel = gi; s.ud.pick = i; s.ud.userT = performance.now(); s.dirty = true; o.onSel && o.onSel(g);
    });
  }
  return s;
}
function chipsHTML(d) {
  return GROUPS.map(function (g) { var o = ginfo(d, g), c = COL[o.idx]; return '<button class="hl-chip" data-g="' + g + '" style="color:rgb(' + c.join(',') + ')"><i></i><span style="color:#cfeaff">' + g + '</span> <b>' + o.s28 + '</b></button>'; }).join('');
}
function wireChips(box, readEl, inst) {
  box.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.hl-chip'); if (!b) return;
    var g = b.dataset.g, on = b.classList.contains('on');
    [].forEach.call(box.children, function (x) { x.classList.remove('on'); });
    if (on) { setSel(inst, null); readEl.innerHTML = 'Tap a muscle on the hologram or a chip to inspect it.'; return; }
    b.classList.add('on'); setSel(inst, g); readEl.innerHTML = readoutFor(g, getData());
  });
  return function highlight(g) {
    [].forEach.call(box.children, function (x) { x.classList.toggle('on', x.dataset.g === g); });
    readEl.innerHTML = g ? readoutFor(g, getData()) : 'Tap a muscle on the hologram or a chip to inspect it.';
  };
}
function mountGlobe(wrap, o) {
  o = o || {}; wrap.innerHTML = '';
  var now = new Date(), s = attach(wrap, drawGlobe); var u = s.ud;
  u.y = o.y || now.getFullYear(); u.m = o.m === undefined ? now.getMonth() : o.m; u.mode = o.mode || 'gym'; u.rot = -.6; u.sel = 0; u.vel = 0;
  dragger(s, function (dx) { u.rot += dx * .011; u.vel = dx * .0006; u.userT = performance.now(); }, function (x, y) {
    var n = globePick(s, x, y); u.sel = n ? n.d : 0; u.userT = performance.now(); s.dirty = true; o.onSel && o.onSel(n);
  });
  s.setMonth = function (y, m) { u.y = y; u.m = m; u.md = null; u.sel = 0; s.dirty = true; };
  s.setMode = function (md) { u.mode = md; u.md = null; s.dirty = true; };
  return s;
}
function mountTower(wrap, o) {
  o = o || {}; wrap.innerHTML = '';
  var s = attach(wrap, drawTower); var u = s.ud; u.ph = 0; u.off = 0; u.vel = 0; u.grow = 0; u.mode = o.mode || 'week'; u.sel = -1;
  s.setMode = function (m) { u.mode = m; u.grow = 0; u.sel = -1; s.refresh(); };
  s.refresh = function () { var d = getData(); u.bars = towerBars(d, u.mode); s.dirty = true; };
  dragger(s, function (dx) { u.off += dx * .008; u.vel = dx * .0004; u.userT = performance.now(); }, function (x, y) {
    var best = -1, bd = 30 * 30; (u.pts || []).forEach(function (p) { var dx = p.x - x, dy = p.y - y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = p.i; } });
    u.sel = best; s.dirty = true; o.onSel && o.onSel(best >= 0 ? u.bars[best] : null, best);
  });
  s.refresh(); return s;
}
function towerNote(b, mode) {
  if (!b) return 'Tap a tower. Orange outline = the same slot last week.';
  var t = '<b>' + esc(b.tip) + '</b> · ' + fmt(b.v) + ' kg';
  if (mode !== 'weeks' && b.pv > 0) { var p = Math.round((b.v / b.pv - 1) * 100); t += ' · ' + (p >= 0 ? '+' : '−') + Math.abs(p) + '% vs last week (' + fmt(b.pv) + ' kg)'; }
  return t;
}

/* ================= HOLO ROOM (tab) ================= */
var ROOM = null;
var ICON = {
  dumb: '<svg viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 2.5 1.5 2.5C10 9 11 6 12 3z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>',
  rep: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5"/></svg>'
};
function barRow(label, id) { return '<div class="hl-bar"><span>' + label + '</span><div class="hl-trk"><u id="' + id + '"></u></div><span id="' + id + 'v">–</span></div>'; }
function buildRoom(root) {
  var d = getData(true);
  root.innerHTML =
    '<div class="hl-room">' +
    '<div class="hl-col hl-colL">' +
      '<div class="hl-panel"><div class="hl-ph"><span>Muscle overview</span><small>this week · sets</small></div><div class="hl-split"><div class="hl-cvw mini" id="hl-mini-a"><div class="hl-scan"></div></div><div class="hl-bars" id="hl-mo"></div></div></div>' +
      '<div class="hl-panel"><div class="hl-ph"><span>Weekly progress</span><small id="hl-wk-sub"></small></div><div class="hl-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(96,226,255,.14)" stroke-width="8"/><circle class="arc" id="hl-arc" cx="50" cy="50" r="40" fill="none" stroke="#4092ff" stroke-width="8" stroke-linecap="round" transform="rotate(-90 50 50)" style="stroke-dasharray:251.3;stroke-dashoffset:251.3;filter:drop-shadow(0 0 5px #4092ff)"/><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(96,226,255,.35)" stroke-dasharray="1.5 5"/><text x="50" y="57" text-anchor="middle" id="hl-pct">0%</text></svg><div class="hl-bars">' + barRow('Workouts', 'hl-p1') + barRow('Sets', 'hl-p2') + barRow('Reps', 'hl-p3') + barRow('Consistency', 'hl-p4') + '</div></div></div>' +
      '<div class="hl-panel"><div class="hl-ph"><span>Gym volume</span><span class="hl-seg" id="hl-tmode"><button class="on" data-m="week">WEEK</button><button data-m="weeks">8 WEEKS</button></span></div><div class="hl-cvw tower" id="hl-tower"></div><div class="hl-read" id="hl-tnote" style="margin:6px 0 0"></div></div>' +
    '</div>' +
    '<div class="hl-stage"><div class="hl-hint">DRAG TO ROTATE · TAP A MUSCLE</div>' +
      '<div class="hl-legend"><span>ON TARGET<i style="background:rgb(96,226,255)"></i></span><span>BUILDING<i style="background:rgb(64,146,255)"></i></span><span>LOW<i style="background:rgb(255,170,66)"></i></span><span>NEGLECTED<i style="background:rgb(255,112,40)"></i></span></div>' +
      '<div class="hl-body" id="hl-body"></div><div class="hl-chips" id="hl-chips"></div><div class="hl-read" id="hl-read">Tap a muscle on the hologram or a chip to inspect it.</div></div>' +
    '<div class="hl-col hl-colR">' +
      '<div class="hl-panel"><div class="hl-ph"><span>Month view</span><span class="hl-seg" id="hl-gmode"><button class="on" data-m="gym">GYM</button><button data-m="habits">HABITS</button></span></div><div class="hl-cvw globe" id="hl-globe"></div>' +
        '<div class="hl-mrow"><button class="hl-nav" id="hl-mprev">‹</button><span id="hl-mlbl"></span><button class="hl-nav" id="hl-mnext">›</button></div><div class="hl-key" id="hl-gkey"></div><div class="hl-read" id="hl-gnote" style="margin:8px 0 0"></div></div>' +
      '<div class="hl-panel"><div class="hl-ph"><span>Body scan</span><small>last 28 days · sets</small></div><div class="hl-split"><div class="hl-cvw mini" id="hl-mini-b"><div class="hl-scan" style="animation-delay:-2s"></div></div><div class="hl-bars" id="hl-bs"></div></div></div>' +
      '<div class="hl-panel"><div class="hl-ph"><span>Stats</span><small>all time</small></div><div class="hl-stats" id="hl-stats"></div></div>' +
    '</div></div>';
  var R = { root: root, d: d };
  /* big body */
  var read = root.querySelector('#hl-read'), chips = root.querySelector('#hl-chips'); chips.innerHTML = chipsHTML(d);
  var hi;
  R.body = mountBody(root.querySelector('#hl-body'), { onSel: function (g) { hi(g); } });
  hi = wireChips(chips, read, R.body);
  /* minis: front for overview, back for scan */
  R.miniA = mountBody(root.querySelector('#hl-mini-a'), { mini: true, yaw: .25, scan: false });
  R.miniB = mountBody(root.querySelector('#hl-mini-b'), { mini: true, yaw: Math.PI - .25, scan: false });
  /* tower */
  var tw = root.querySelector('#hl-tower'), tnote = root.querySelector('#hl-tnote');
  R.tower = mountTower(tw, { onSel: function (b) { tnote.innerHTML = towerNote(b, R.tower.ud.mode); } }); tnote.innerHTML = towerNote(null);
  root.querySelector('#hl-tmode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); R.tower.setMode(b.dataset.m); tnote.innerHTML = towerNote(null); });
  /* globe */
  var gnote = root.querySelector('#hl-gnote'), now = new Date(), gy = now.getFullYear(), gm = now.getMonth();
  function glabel() { root.querySelector('#hl-mlbl').textContent = MONS[gm] + ' ' + gy; }
  function gkey() {
    var gym = R.globe.ud.mode === 'gym';
    root.querySelector('#hl-gkey').innerHTML = gym ? '<span><i style="background:rgb(96,226,255)"></i>Workout</span><span><i style="background:rgb(170,214,255)"></i>Rest</span><span><i style="background:rgb(255,112,40)"></i>Missed</span><span><i style="background:rgb(235,252,255)"></i>Today</span>'
      : '<span><i style="background:rgb(96,226,255)"></i>80%+</span><span><i style="background:rgb(64,146,255)"></i>50–79%</span><span><i style="background:rgb(255,112,40)"></i>under 50%</span>';
  }
  function gtxt(n) { gnote.innerHTML = n ? '<b>' + DOWS[n.w] + ' ' + n.d + ' ' + MONS[gm] + '</b> · ' + esc(n.label || '—') : 'Each node is a day. Columns are weekdays, rings are weeks. Drag to spin, tap a node.'; }
  R.globe = mountGlobe(root.querySelector('#hl-globe'), { onSel: gtxt }); glabel(); gkey(); gtxt(null);
  root.querySelector('#hl-gmode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); R.globe.setMode(b.dataset.m); gkey(); gtxt(null); });
  function mstep(k) { gm += k; if (gm < 0) { gm = 11; gy--; } if (gm > 11) { gm = 0; gy++; } R.globe.setMonth(gy, gm); glabel(); gtxt(null); }
  root.querySelector('#hl-mprev').onclick = function () { mstep(-1); }; root.querySelector('#hl-mnext').onclick = function () { mstep(1); };
  R.hi = hi; R.chips = chips; return R;
}
function bar(id, frac, col, txt, root) { var u = root.querySelector('#' + id), v = root.querySelector('#' + id + 'v'); if (u) { u.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'; u.style.background = col; u.style.boxShadow = '0 0 8px ' + col; } if (v) v.textContent = txt; }
function colStr(i) { return 'rgb(' + COL[i].join(',') + ')'; }
function fillPanels(R) {
  var d = getData(true), root = R.root;
  R.chips.querySelectorAll('.hl-chip').forEach(function (b) { var o = ginfo(d, b.dataset.g); b.style.color = colStr(o.idx); b.querySelector('b').textContent = o.s28; });
  /* muscle overview (this week vs weekly target) */
  var mo = [['Chest', ['Chest']], ['Back', ['Back']], ['Shoulders', ['Shoulders']], ['Arms', ['Biceps', 'Triceps']], ['Legs', ['Legs']], ['Core', ['Core']]];
  root.querySelector('#hl-mo').innerHTML = mo.map(function (r, i) { return barRow(r[0], 'hl-mo' + i); }).join('');
  mo.forEach(function (r, i) { var wk = 0, tg = 0, idx = 0; r[1].forEach(function (g) { var o = ginfo(d, g); wk += o.wk; tg += o.target; idx = Math.max(idx, 0); }); var f = wk / tg, c = f >= 1 ? 3 : f >= .5 ? 2 : f > 0 ? 1 : 0; bar('hl-mo' + i, f, colStr(c), wk + '/' + tg, root); });
  var bs = root.querySelector('#hl-bs'); bs.innerHTML = GROUPS.map(function (g, i) { return barRow(g, 'hl-bs' + i); }).join('');
  GROUPS.forEach(function (g, i) { var o = ginfo(d, g); bar('hl-bs' + i, o.h, colStr(o.idx), o.s28, root); });
  /* weekly progress */
  var wk = d.wk, rWk = wk.sched ? wk.done / wk.sched : 0, rS = wk.pSets ? wk.sets / wk.pSets : (wk.sets ? 1 : 0), rR = wk.pReps ? wk.reps / wk.pReps : (wk.reps ? 1 : 0), cons = d.st.scheduled ? d.st.done / d.st.scheduled : 0;
  bar('hl-p1', rWk, colStr(3), wk.done + '/' + wk.sched, root); bar('hl-p2', rS, colStr(2), wk.sets, root); bar('hl-p3', rR, colStr(2), fmt(wk.reps), root); bar('hl-p4', cons, colStr(3), Math.round(cons * 100) + '%', root);
  root.querySelector('#hl-wk-sub').textContent = wk.pSets ? 'sets & reps vs last week' : 'week so far';
  var arc = root.querySelector('#hl-arc'), pctEl = root.querySelector('#hl-pct'), tgt = Math.round(rWk * 100);
  requestAnimationFrame(function () { arc.style.strokeDashoffset = String(251.3 * (1 - clamp(rWk, 0, 1))); }); countUp(pctEl, tgt, '%');
  /* stats */
  var st = d.st;
  root.querySelector('#hl-stats').innerHTML =
    '<div class="hl-stat">' + ICON.dumb + '<span>Total workouts</span><b data-n="' + st.done + '">0</b></div>' +
    '<div class="hl-stat">' + ICON.bolt + '<span>Lifetime load</span><b data-n="' + Math.round(d.load) + '" data-s=" kg">0</b></div>' +
    '<div class="hl-stat">' + ICON.rep + '<span>Total reps</span><b data-n="' + (st.totalReps || 0) + '">0</b></div>' +
    '<div class="hl-stat">' + ICON.flame + '<span>Streak · best ' + d.streak.best + '</span><b data-n="' + d.streak.cur + '">0</b></div>';
  root.querySelectorAll('.hl-stats b').forEach(function (b) { countUp(b, +b.dataset.n, b.dataset.s || '', true); });
  R.tower.refresh();
}
function countUp(el, to, suffix, grp) {
  if (lite()) { el.textContent = (grp ? fmt(to) : to) + (suffix || ''); return; }
  var t0 = performance.now(), dur = 900;
  (function step(t) { var p = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3), v = Math.round(to * e); el.textContent = (grp ? fmt(v) : v) + (suffix || ''); if (p < 1) requestAnimationFrame(step); })(t0);
}
function open(soft) {
  injectCSS();
  var root = D.getElementById('holo-root'); if (!root) return;
  if (!ROOM || !ROOM.root.isConnected || !ROOM.root.firstChild) ROOM = buildRoom(root);
  fillPanels(ROOM);
  [ROOM.body, ROOM.miniA, ROOM.miniB, ROOM.tower, ROOM.globe].forEach(function (s) { s.size(); s.invalidate(); });
}
/* keep panels fresh while the tab is open (e.g. you just marked a workout done in another tab/device) */
setInterval(function () {
  if (!ROOM || D.hidden || !ROOM.root.offsetParent) return;
  var d = getData(true); if (ROOM.sig !== d.st.done + '|' + d.load + '|' + d.wk.sets) { ROOM.sig = d.st.done + '|' + d.load + '|' + d.wk.sets; fillPanels(ROOM); ROOM.miniA.invalidate(); ROOM.miniB.invalidate(); }
}, 4000);

/* ================= GYM HUD tab ================= */
function renderGym() {
  injectCSS();
  var body = D.getElementById('gym-hud-body'); if (!body) return;
  D.querySelectorAll('.gym-hud-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === 'holo'); });
  var d = getData(true); try { var pw = D.getElementById('gym-hud-pwr'); if (pw) pw.innerText = d.st.scheduled ? Math.round(d.st.done / d.st.scheduled * 100) + '%' : '--'; } catch (e) { }
  body.innerHTML = '<div class="hl-gym"><div class="hl-stage" style="order:0"><div class="hl-hint">DRAG · TAP A MUSCLE</div><div class="hl-body" id="hlg-body"></div><div class="hl-chips" id="hlg-chips"></div><div class="hl-read" id="hlg-read">Tap a muscle on the hologram or a chip to inspect it.</div></div>' +
    '<div class="hl-panel"><div class="hl-ph"><span>Volume towers</span><span class="hl-seg" id="hlg-tmode"><button class="on" data-m="week">WEEK</button><button data-m="weeks">8 WEEKS</button></span></div><div class="hl-cvw tower" id="hlg-tower"></div><div class="hl-read" id="hlg-tnote" style="margin:6px 0 0"></div></div></div>';
  var chips = D.getElementById('hlg-chips'), read = D.getElementById('hlg-read'), hi; chips.innerHTML = chipsHTML(d);
  var bd = mountBody(D.getElementById('hlg-body'), { onSel: function (g) { hi(g); } }); hi = wireChips(chips, read, bd);
  var tn = D.getElementById('hlg-tnote'), tw = mountTower(D.getElementById('hlg-tower'), { onSel: function (b) { tn.innerHTML = towerNote(b, tw.ud.mode); } }); tn.innerHTML = towerNote(null);
  D.getElementById('hlg-tmode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); tw.setMode(b.dataset.m); tn.innerHTML = towerNote(null); });
}
function hookGym() {
  var orig = W.renderGymHUD; if (typeof orig !== 'function' || orig.__holo) return;
  var wrapped = function () { if (typeof gymHudTab !== 'undefined' && gymHudTab === 'holo') { try { return renderGym(); } catch (e) { if (W.console) console.warn('holo gym', e); } } return orig.apply(this, arguments); };
  wrapped.__holo = true; W.renderGymHUD = wrapped;
}

/* ================= REPORTS slot ================= */
var REP = null;
function mountReport() {
  injectCSS();
  var tab = D.getElementById('tab-report'); if (!tab) return;
  var slot = D.getElementById('holo-report-slot');
  if (!slot) {
    slot = D.createElement('div'); slot.id = 'holo-report-slot'; slot.className = 'hl-slot';
    slot.innerHTML = '<div class="hl-panel"><div class="hl-ph"><span>Holographic month</span><span class="hl-seg" id="hlr-mode"><button class="on" data-m="habits">HABITS</button><button data-m="gym">GYM</button></span></div><div class="hl-cvw globe" id="hlr-globe"></div>' +
      '<div class="hl-mrow"><button class="hl-nav" id="hlr-prev">‹</button><span id="hlr-lbl"></span><button class="hl-nav" id="hlr-next">›</button></div><div class="hl-key" id="hlr-key"></div><div class="hl-read" id="hlr-note" style="margin:8px 0 0"></div></div>';
    var first = tab.querySelector('.report-section-title'); if (first) tab.insertBefore(slot, first); else tab.insertBefore(slot, tab.firstChild);
    var now = new Date(), gy = now.getFullYear(), gm = now.getMonth(), note = D.getElementById('hlr-note');
    function lbl() { D.getElementById('hlr-lbl').textContent = MONS[gm] + ' ' + gy; }
    function key() { D.getElementById('hlr-key').innerHTML = REP.ud.mode === 'gym' ? '<span><i style="background:rgb(96,226,255)"></i>Workout</span><span><i style="background:rgb(170,214,255)"></i>Rest</span><span><i style="background:rgb(255,112,40)"></i>Missed</span>' : '<span><i style="background:rgb(96,226,255)"></i>80%+ of habits</span><span><i style="background:rgb(64,146,255)"></i>50–79%</span><span><i style="background:rgb(255,112,40)"></i>under 50%</span>'; }
    function txt(n) { note.innerHTML = n ? '<b>' + DOWS[n.w] + ' ' + n.d + ' ' + MONS[gm] + '</b> · ' + esc(n.label || '—') : 'Each node is a day of the month. Tap one.'; }
    REP = mountGlobe(D.getElementById('hlr-globe'), { mode: 'habits', onSel: txt }); lbl(); key(); txt(null);
    D.getElementById('hlr-mode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); REP.setMode(b.dataset.m); key(); txt(null); });
    function st(k) { gm += k; if (gm < 0) { gm = 11; gy--; } if (gm > 11) { gm = 0; gy++; } REP.setMonth(gy, gm); lbl(); txt(null); }
    D.getElementById('hlr-prev').onclick = function () { st(-1); }; D.getElementById('hlr-next').onclick = function () { st(1); };
  } else if (REP) { REP.size(); REP.invalidate(); }
}

/* ================= public API ================= */
W.HOLO = {
  version: VERSION, open: open, mountReport: mountReport, renderGym: renderGym, target: TARGET,
  refresh: function () { if (ROOM) fillPanels(ROOM); },
  kit: { attach: attach, dragger: dragger, sprites: sprites, glow: glow, rgba: rgba, clamp: clamp, lerp: lerp, esc: esc, C: C, lite: lite, lvl: lvl, getData: getData, ginfo: ginfo, GROUPS: GROUPS, TARGET: TARGET, DOWS: DOWS, MONS: MONS, fmt: fmt, countUp: countUp, injectCSS: injectCSS },
  _t: { drawBody: drawBody, drawGlobe: drawGlobe, drawTower: drawTower, bodyState: bodyState, buildBody: buildBody, monthDays: monthDays, towerBars: towerBars, getData: getData }   // test hooks
};
function boot() { injectCSS(); hookGym(); if (D.querySelector('#tab-holo.active')) open(); }
if (D.readyState === 'complete' || D.readyState === 'interactive') boot(); else D.addEventListener('DOMContentLoaded', boot);
})();
