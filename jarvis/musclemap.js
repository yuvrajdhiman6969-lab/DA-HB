/* musclemap.js v1 — "Today's Muscle Map" for the Gym tab (Gym HUD → MAP). Needs holo.js (loaded before it).
   • Solid, lit 3D body (22 muscle regions, depth-sorted) you can spin with mouse/finger, zoom with the buttons or Ctrl+wheel.
   • Colours come from what you LOGGED on the selected day:
       green  = trained: an exercise with 2+ valid sets hit this muscle part
       amber  = partial: only 1 set, or only light secondary work
       red    = planned for that day's split but not trained (or this part of the muscle was not hit)
       blue   = not part of that day's plan
     Each exercise is mapped to the muscle parts it really works (e.g. Incline DB Curl → long head, Preacher → short head,
     Hammer curl → brachialis), so on a Bicep day the short head can be green while the brachialis is still red.
   • Slow "size" growth: only a tiny 1–2% visual change, and only after 20+ QUALIFIED days
     (qualified = gym done + sleep habit + food habits [water, fruit] all ticked). It is a motivational estimate built from
     your habits, not a body measurement. Each muscle grows in proportion to how well you trained it in the last 28 days.
   Tweak in the console or at the top: HOLO.map.cfg.minDays / startPct / maxPct / rampDays / foodHabits. */
(function () {
'use strict';
var H = window.HOLO;
if (!H || !H.kit) { if (window.console) console.warn('musclemap.js needs holo.js loaded first'); return; }
var K = H.kit, TAU = Math.PI * 2, D = document, clamp = K.clamp, lerp = K.lerp, rgba = K.rgba, esc = K.esc, C = K.C;

var CFG = { recMinSets: 2, recBig: ['ch_up', 'ch_mid', 'lat', 'mb', 'dl_s', 'dl_r', 'bi_l', 'bi_s', 'tri_l', 'tri_o', 'quad', 'ham', 'glu'], minDays: 20, startPct: 1, maxPct: 2, rampDays: 20, minSets: 2, foodHabits: ['water', 'fruit'], sleepHabit: 'sleep', demoMult: 10 };

/* ================= muscle regions ================= */
/* id, label, row index, growth group, plan-by-group? */
var R = [
  ['ch_up', 'Upper chest', 0, 'Chest'], ['ch_mid', 'Mid / lower chest', 0, 'Chest'],
  ['tr', 'Trapezius', 1, 'Back'], ['lat', 'Lats', 1, 'Back'], ['mb', 'Mid back', 1, 'Back'], ['lb', 'Lower back', 1, 'Back'],
  ['dl_f', 'Front delt', 2, 'Shoulders'], ['dl_s', 'Side delt', 2, 'Shoulders'], ['dl_r', 'Rear delt', 2, 'Shoulders'],
  ['bi_l', 'Long head', 3, 'Biceps'], ['bi_s', 'Short head', 3, 'Biceps'], ['bi_b', 'Brachialis', 3, 'Biceps'],
  ['tri_l', 'Long head', 4, 'Triceps'], ['tri_o', 'Lateral / medial head', 4, 'Triceps'],
  ['fore', 'Forearm', 5, 'Biceps'],
  ['abs_u', 'Upper abs', 6, 'Core'], ['abs_l', 'Lower abs', 6, 'Core'], ['obl', 'Obliques', 6, 'Core'],
  ['quad', 'Quadriceps', 7, 'Legs'], ['ham', 'Hamstrings', 8, 'Legs'], ['glu', 'Glutes', 9, 'Legs'], ['calf', 'Calves', 10, 'Legs']
];
var ROWS = [['Chest', 'Chest'], ['Back', 'Back'], ['Shoulders', 'Shoulders'], ['Biceps', 'Biceps'], ['Triceps', 'Triceps'], ['Forearms', 'Biceps'], ['Abs & Core', 'Core'], ['Quads', 'Legs'], ['Hamstrings', 'Legs'], ['Glutes', 'Legs'], ['Calves', 'Legs']];
var RI = {}; R.forEach(function (r, i) { RI[r[0]] = i; });
var NR = R.length, NONE = NR;
var ROW_BACK = { 1: 1, 4: 1, 8: 1, 9: 1, 10: 1 };                     // rows best viewed from behind
var ROW_ZOOM = [2.1, 2.0, 2.6, 3.0, 3.0, 2.8, 2.4, 1.6, 1.7, 2.4, 2.2];
/* state: 0 idle(blue) · 1 done(green) · 2 partial(amber) · 3 missed/pending(red) */
var ST_NAME = ['Other', 'Trained', 'Partial', 'Not trained'];

/* ================= exercise → muscle parts ================= */
function exRegs(name, group) {
  var n = String(name).toLowerCase(), o = [];
  function a(id, w) { o.push([RI[id], w]); }
  switch (group) {
    case 'Chest':
      if (/incline/.test(n)) { a('ch_up', 1); a('ch_mid', .5); a('dl_f', .5); }
      else if (/decline|dip/.test(n)) { a('ch_mid', 1); a('ch_up', .3); a('tri_o', .5); }
      else if (/high-to-low/.test(n)) { a('ch_mid', 1); a('ch_up', .4); }
      else if (/low-to-high/.test(n)) { a('ch_up', 1); a('ch_mid', .5); }
      else if (/fly|pec/.test(n)) { a('ch_mid', 1); a('ch_up', .6); }
      else { a('ch_mid', 1); a('ch_up', .6); a('dl_f', .5); a('tri_o', .5); }
      break;
    case 'Triceps':
      if (/overhead|skull|french/.test(n)) { a('tri_l', 1); a('tri_o', .6); }
      else if (/close-grip bench|dip|diamond/.test(n)) { a('tri_o', 1); a('tri_l', .6); a('ch_mid', .5); }
      else { a('tri_o', 1); a('tri_l', .6); }
      break;
    case 'Back':
      if (/shrug/.test(n)) { a('tr', 1); }
      else if (/back extension/.test(n)) { a('lb', 1); a('glu', .5); a('ham', .4); }
      else if (/deadlift/.test(n)) { a('lb', 1); a('glu', 1); a('ham', 1); a('tr', .5); a('mb', .5); }
      else if (/straight-arm/.test(n)) { a('lat', 1); }
      else if (/pull-up|chin|pulldown/.test(n)) { a('lat', 1); a('mb', .5); a('bi_s', .5); }
      else if (/row/.test(n)) { a('mb', 1); a('lat', .7); a('tr', .5); a('dl_r', .5); a('bi_s', .5); }
      else { a('lat', 1); a('mb', .5); }
      break;
    case 'Biceps':
      if (/incline|bayesian/.test(n)) { a('bi_l', 1); a('bi_b', .4); }
      else if (/preacher|concentration|spider/.test(n)) { a('bi_s', 1); a('bi_b', .4); }
      else if (/reverse curl/.test(n)) { a('bi_b', 1); a('fore', 1); }
      else if (/hammer/.test(n)) { a('bi_b', 1); a('bi_l', .5); a('fore', .5); }
      else { a('bi_l', 1); a('bi_s', 1); a('bi_b', .5); }
      break;
    case 'Shoulders':
      if (/lateral|upright/.test(n)) { a('dl_s', 1); a('tr', .4); }
      else if (/rear|reverse pec|face pull/.test(n)) { a('dl_r', 1); a('mb', .5); a('tr', .4); }
      else if (/front raise/.test(n)) { a('dl_f', 1); }
      else if (/press|arnold/.test(n)) { a('dl_f', 1); a('dl_s', .7); a('tri_o', .4); }
      else { a('dl_s', 1); }
      break;
    case 'Legs':
      if (/extension/.test(n)) { a('quad', 1); }
      else if (/leg curl/.test(n)) { a('ham', 1); }
      else if (/romanian/.test(n)) { a('ham', 1); a('glu', 1); a('lb', .4); }
      else if (/hip thrust|glute|abduction/.test(n)) { a('glu', 1); a('ham', .3); }
      else if (/calf/.test(n)) { a('calf', 1); }
      else { a('quad', 1); a('glu', .7); a('ham', .4); }
      break;
    case 'Core':
      if (/hanging|raise|knee-to-elbow|leg\/knee/.test(n)) { a('abs_l', 1); a('abs_u', .4); }
      else if (/twist|wood|side plank|pallof|bicycle|heel touch/.test(n)) { a('obl', 1); a('abs_u', .5); }
      else if (/crunch|sit-up/.test(n)) { a('abs_u', 1); a('abs_l', .4); }
      else if (/plank|hollow|dead bug|mountain|rollout/.test(n)) { a('abs_u', 1); a('abs_l', 1); a('obl', .5); }
      else { a('abs_u', 1); }
      break;
  }
  return o;
}

/* ================= data: one day's muscle state ================= */
var HAB = null;
function habIdx(id) { if (!HAB) { HAB = {}; try { HABITS.forEach(function (h, i) { HAB[h.id] = i; }); } catch (e) { } } return HAB[id]; }
function habitDone(iso, id) {
  var i = habIdx(id); if (i === undefined) return false; var d = parseISO(iso);
  try { return localStorage.getItem('habit_' + d.getFullYear() + '_' + d.getMonth() + '_' + i + '_' + d.getDate()) === 'true'; } catch (e) { return false; }
}
/* ---- recovery: how many days since each muscle PART was really trained (2+ weighted sets) ----
   state 3 = SORE (trained today / yesterday) · 2 = RECOVERING (big muscles: 2 days, small: none) · 1 = READY · big muscles need 3 days, small ones 2.
   beforeOnly = ignore sets logged on `iso` itself (used by the exercise suggestions, so today's own log never hides today's plan). */
function recovery(iso, beforeOnly) {
  iso = iso || isoDate(new Date());
  var last = new Array(NR), days = new Float32Array(NR), rs = new Uint8Array(NR), big = {}, logs = [], i;
  CFG.recBig.forEach(function (id) { big[id] = 1; });
  try { logs = gymCollectLogs(); } catch (e) { }
  logs.forEach(function (l) {
    if (l.iso > iso || (beforeOnly && l.iso === iso)) return;
    exRegs(l.name, l.group).forEach(function (r) { if (l.sets * r[1] < CFG.recMinSets) return; if (!last[r[0]] || l.iso > last[r[0]]) last[r[0]] = l.iso; });
  });
  var t = parseISO(iso);
  for (i = 0; i < NR; i++) {
    if (!last[i]) { days[i] = 99; rs[i] = 1; continue; }
    var d = Math.round((t - parseISO(last[i])) / 864e5); days[i] = d;
    rs[i] = d <= 1 ? 3 : d < (big[R[i][0]] ? 3 : 2) ? 2 : 1;
  }
  return { days: days, last: last, rs: rs };
}
function dayState(iso, rec) {
  var today = isoDate(new Date()), st = { iso: iso, isToday: iso === today, future: iso > today, plan: null, rest: false, rs: new Uint8Array(NR), score: new Float32Array(NR), exs: [], planned: [], rowSt: [], sets: 0, okEx: 0, plannedGroups: {} };
  var plan = null, logs = [];
  try { plan = gymPlanFor(iso); } catch (e) { }
  try { logs = gymCollectLogs().filter(function (l) { return l.iso === iso; }); } catch (e) { }
  st.plan = plan; st.rest = !plan || plan.type !== 'workout';
  var planned = [];
  try { if (plan && plan.type === 'workout') planned = gymEffectiveExercises(iso, plan); } catch (e) { }
  st.planned = planned;
  var part = new Float32Array(NR), plannedHit = new Float32Array(NR);
  planned.forEach(function (e) { st.plannedGroups[e.group] = 1; exRegs(e.name, e.group).forEach(function (r) { plannedHit[r[0]] = Math.max(plannedHit[r[0]], r[1]); }); });
  logs.forEach(function (l) {
    var ok = l.sets >= CFG.minSets; st.sets += l.sets; if (ok) st.okEx++;
    st.exs.push({ name: l.name, group: l.group, sets: l.sets, reps: l.reps, vol: l.vol, ok: ok, regs: exRegs(l.name, l.group) });
    exRegs(l.name, l.group).forEach(function (r) { if (ok) st.score[r[0]] += l.sets * r[1]; else part[r[0]] += l.sets * r[1]; });
    st.plannedGroups[l.group] = st.plannedGroups[l.group] || 0;
  });
  for (var i = 0; i < NR; i++) {
    var g = R[i][3], isFore = R[i][0] === 'fore', fine = (g === 'Legs' || g === 'Core' || isFore);
    var planned_ = plannedHit[i] >= 1 || (!fine && st.plannedGroups[g] === 1);
    if (st.score[i] >= CFG.minSets) st.rs[i] = 1;
    else if (st.score[i] > 0 || part[i] > 0) st.rs[i] = 2;
    else if (planned_ && !st.future) st.rs[i] = 3;
    else st.rs[i] = 0;
    st.score[i] = Math.round(st.score[i] * 10) / 10;
  }
  if (rec) { var rv = recovery(iso); for (var q = 0; q < NR; q++) st.rs[q] = rv.rs[q]; st.recDays = rv.days; st.recLast = rv.last; st.rec = true; }
  /* per list-row (11 muscles): exercises done / planned that primarily hit it */
  ROWS.forEach(function (rw, ri) {
    var pl = 0, dn = 0, part1 = 0, regs = [];
    R.forEach(function (r, k) { if (r[2] === ri) regs.push(k); });
    planned.forEach(function (e) { var p = exRegs(e.name, e.group).filter(function (x) { return x[1] >= 1 && R[x[0]][2] === ri; }); if (p.length) pl++; });
    st.exs.forEach(function (e) { var p = e.regs.filter(function (x) { return x[1] >= 1 && R[x[0]][2] === ri; }); if (p.length) { if (e.ok) dn++; else part1++; } });
    var cnt = [0, 0, 0, 0]; regs.forEach(function (k) { cnt[st.rs[k]]++; });
    var s;
    if (rec) s = cnt[3] ? 3 : cnt[2] ? 2 : 1; else if (cnt[1] && !cnt[3]) s = 1; else if (cnt[1] || cnt[2]) s = 2; else if (cnt[3]) s = 3; else s = 0;
    st.rowSt.push({ name: rw[0], state: s, planned: pl, done: dn, part: part1, regs: regs, cnt: cnt, frac: pl ? clamp(dn / pl, 0, 1) : (dn ? 1 : 0) });
  });
  return st;
}

/* ================= data: qualified days + estimated growth ================= */
var GR = null;
function growth(force) {
  var now = Date.now(); if (!force && GR && now - GR.at < 3000) return GR;
  var g = { at: now, n: 0, base: 0, days: [], weekly: [], per: {}, eligible: false, last: '' };
  try {
    var today = isoDate(new Date()), logs = gymCollectLogs(), okByIso = {};
    logs.forEach(function (l) { if (l.sets >= CFG.minSets) okByIso[l.iso] = 1; });
    var n = 0, dts = [];
    for (var d = parseISO(GYM_EPOCH_ISO); isoDate(d) <= today; d.setDate(d.getDate() + 1)) {
      var iso = isoDate(d), gymOk = getGymStatus(iso) === 'done' || okByIso[iso];
      var q = !!gymOk && habitDone(iso, CFG.sleepHabit) && CFG.foodHabits.every(function (h) { return habitDone(iso, h); });
      if (q) { n++; g.last = iso; }
      dts.push([iso, n, !!gymOk]);
    }
    g.n = n; g.days = dts;
    var base = function (k) { return k < CFG.minDays ? 0 : CFG.startPct + (CFG.maxPct - CFG.startPct) * Math.min(1, (k - CFG.minDays) / CFG.rampDays); };
    g.base = base(n); g.eligible = n >= CFG.minDays;
    var d0 = K.getData(); ROWS.forEach(function (rw) { var o = K.ginfo(d0, rw[1]); g.per[rw[0]] = g.base * clamp(o.s28 / (o.target * 4), 0, 1); });
    var mon = gymMondayIso(today);
    for (var w = 7; w >= 0; w--) {
      var end = gymAddDays(mon, -7 * w + 6); if (end > today) end = today;
      var cnt = 0; for (var i = 0; i < dts.length; i++) if (dts[i][0] <= end) cnt = dts[i][1];
      g.weekly.push({ end: end, n: cnt, pct: base(cnt) });
    }
  } catch (e) { if (window.console) console.warn('muscle growth', e); }
  GR = g; return g;
}

/* ================= body mesh (anatomical build) ================= */
var MESH = null, MESH_LO = null;
function sm(x, a, b) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function bell(x, c, w) { var t = (x - c) / w; return Math.exp(-t * t); }
var G = bell;                                                                   // gaussian bump
function Bx(x, a, b, s) { return sm(x, a - s, a + s) * (1 - sm(x, b - s, b + s)); }   // soft box
var PI = Math.PI, AOV = 1, TX = 0, TY = 0, TZ = 0;
function prof(tab, y) {                         // smooth (cubic Hermite) lookup in a table of rows [y, v1, v2, ...] with y descending
  var n = tab.length, i = 0, k, out = [];
  if (y >= tab[0][0]) return tab[0].slice(1);
  if (y <= tab[n - 1][0]) return tab[n - 1].slice(1);
  while (i < n - 2 && y < tab[i + 1][0]) i++;
  var a = tab[i], b = tab[i + 1], p = tab[i - 1], q = tab[i + 2], h = a[0] - b[0], t = (a[0] - y) / h, t2 = t * t, t3 = t2 * t;
  var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  for (k = 1; k < a.length; k++) {
    var ma = p ? (b[k] - p[k]) / (p[0] - b[0]) : (b[k] - a[k]) / h, mb = q ? (q[k] - a[k]) / (a[0] - q[0]) : (b[k] - a[k]) / h;
    out.push(h00 * a[k] + h10 * h * ma + h01 * b[k] + h11 * h * mb);
  }
  return out;
}
/* rotate about the Z axis (front-plane swing) around a pivot, then translate */
function rotZ(x, y, z, px, py, ang, ox, oy, oz) { var c = Math.cos(ang), s = Math.sin(ang), dx = x - px, dy = y - py; TX = ox + px + dx * c - dy * s; TY = oy + py + dx * s + dy * c; TZ = z + oz; }
function rotY(x, y, z, px, pz, ang) { var c = Math.cos(ang), s = Math.sin(ang), dx = x - px, dz = z - pz; TX = px + dx * c + dz * s; TY = y; TZ = pz - dx * s + dz * c; }

function buildMesh(det) {
  det = det || 1;
  var X = [], Y = [], Z = [], CX = [], CY = [], CZ = [], RG = [], AO = [], Q = [], QF = [], QP = [];
  var nr = function (n) { return Math.max(3, Math.round(n * det)); }, ns = function (n) { return Math.max(8, 2 * Math.round(n * det / 2)); };
  var id = function (s) { return RI[s]; };
  function stack(o) {
    var rings = o.rings, N = o.N, L = rings.length - 1, rows = [], i, k, ax = o.axis || 'y', start = X.length;
    for (i = 0; i <= L; i++) {
      var r = rings[i], row = [], ex = r.n || 2, pw = 2 / ex, u = L ? i / L : 0;
      for (k = 0; k < N; k++) {
        var a = k / N * TAU; if (o.warp) a -= o.warp * Math.sin(2 * a); var sn = Math.sin(a), cs = Math.cos(a), s1 = sn, c1 = cs;
        if (ex !== 2) { s1 = (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), pw); c1 = (cs < 0 ? -1 : 1) * Math.pow(Math.abs(cs), pw); }
        var lx = r.r1 * s1, lz = r.r2 * c1, rho = Math.sqrt(lx * lx + lz * lz) || 1e-6;
        AOV = 1; var d = o.D ? o.D(r, sn, cs, u) : 0;
        lx += d * lx / rho; lz += d * lz / rho;
        var x, y, z, cx, cy, cz;
        if (ax === 'y') { x = r.c1 + lx; y = r.t; z = r.c2 + lz; cx = r.c1; cy = r.t; cz = r.c2; }
        else { x = r.c1 + lx; y = r.c2 + lz; z = r.t; cx = r.c1; cy = r.c2; cz = r.t; }
        if (o.xf) { o.xf(x, y, z); x = TX; y = TY; z = TZ; o.xf(cx, cy, cz); cx = TX; cy = TY; cz = TZ; }
        X.push(x); Y.push(y); Z.push(z); CX.push(cx); CY.push(cy); CZ.push(cz); RG.push(o.reg ? o.reg(r, sn, cs, u) : NONE); AO.push(AOV < .4 ? .4 : AOV > 1 ? 1 : AOV);
        row.push(X.length - 1);
      }
      rows.push(row);
    }
    for (i = 0; i < L; i++) for (k = 0; k < N; k++) {
      var k2 = (k + 1) % N, a0 = rows[i][k], b0 = rows[i][k2], c0 = rows[i + 1][k2], d0 = rows[i + 1][k];
      Q.push(a0, b0, c0, d0); QP.push(k & 1); QF.push((RG[b0] !== RG[a0] ? 1 : 0) | (RG[d0] !== RG[a0] ? 2 : 0));
    }
  }
  function ringsOf(tab, y0, y1, n, mk) { var a = [], i; for (i = 0; i <= n; i++) { var y = y0 + (y1 - y0) * i / n; a.push(mk(y, prof(tab, y), i / n)); } return a; }

  /* =============================== HEAD + NECK =============================== */
  var HD = [[1.0, .016, .020, -.014], [.994, .044, .056, -.012], [.982, .066, .080, -.009], [.962, .077, .094, -.006], [.938, .081, .100, -.003], [.912, .080, .099, 0], [.888, .076, .095, .004], [.864, .070, .090, .008], [.840, .063, .085, .012], [.818, .056, .078, .016], [.802, .046, .066, .020], [.792, .030, .044, .022], [.787, .008, .016, .022]];
  stack({
    N: ns(40), rings: ringsOf(HD, 1.0, .787, nr(34), function (y, v) { return { t: y, c1: 0, c2: v[2], r1: v[0], r2: v[1], n: y < .86 ? 2.35 : 2.1 }; }),
    reg: function () { return NONE; },
    D: function (r, sn, cs) {
      var y = r.t, f = Math.atan2(Math.abs(sn), cs), d = 0, v;
      d += .030 * G(y, .876, .022) * G(f, 0, .14) + .012 * G(y, .896, .03) * G(f, 0, .085);                     // nose
      d += .013 * G(y, .93, .011) * Bx(f, 0, .66, .18);                                                           // brow ridge
      v = .017 * G(y, .908, .016) * G(f, .42, .17); d -= v; AOV -= v * 22;                                          // eye sockets
      d += .005 * G(y, .905, .008) * G(f, .4, .1);                                                                  // eyeball
      d += .011 * G(y, .886, .024) * G(f, .8, .24);                                                                // cheekbones
      d += .008 * G(y, .852, .009) * G(f, 0, .22) + .008 * G(y, .829, .01) * G(f, 0, .19);                         // lips
      v = .005 * G(y, .84, .004) * G(f, 0, .2); d -= v; AOV -= v * 40;                                            // mouth line
      d += .015 * G(y, .804, .016) * G(f, 0, .24);                                                                  // chin
      d += .014 * G(y, .905, .026) * G(f, 1.58, .13) * (.6 + .4 * G(y, .9, .016));                                 // ears
      d -= .008 * G(y, .94, .02) * Bx(f, .5, 1.1, .1);                                                              // temples
      d += .014 * G(y, .835, .03) * Bx(f, 1.0, 1.5, .1);                                                            // jaw angle
      return d;
    }
  });
  var NK = [[.80, .066, .074, -.004], [.77, .071, .079, -.004], [.74, .080, .088, -.004], [.71, .098, .098, -.004], [.69, .116, .106, -.004]];
  stack({
    N: ns(26), rings: ringsOf(NK, .80, .69, nr(8), function (y, v) { return { t: y, c1: 0, c2: v[2], r1: v[0], r2: v[1] }; }),
    reg: function (r, sn, cs) { return cs < -.25 && r.t < .775 ? id('tr') : NONE; },
    D: function (r, sn, cs) {
      var y = r.t, f = Math.atan2(Math.abs(sn), cs), d = 0, ln = clamp((y - .70) / .095, 0, 1);
      d += .014 * G(f - (.28 + .95 * ln), 0, .2) * Bx(y, .70, .795, .01) * (f < 1.8 ? 1 : 0);                      // sternocleidomastoid
      d += .007 * G(y, .75, .012) * G(f, 0, .1);                                                                   // adam's apple
      d += .014 * sm(f, 2.1, 2.8) * sm(y, .795, .72);                                                              // trap rising up the neck
      return d;
    }
  });

  /* =============================== TORSO =============================== */
  var TT = [[.752, .066, .074, -.004, 2], [.738, .082, .086, -.004, 2], [.724, .106, .096, -.003, 2], [.71, .136, .105, -.002, 2], [.695, .17, .113, 0, 2.05], [.68, .203, .12, .002, 2.1], [.664, .228, .126, .004, 2.15], [.645, .246, .131, .006, 2.2], [.62, .254, .136, .010, 2.25], [.58, .252, .141, .014, 2.3], [.54, .250, .145, .016, 2.3], [.50, .246, .146, .016, 2.3], [.46, .236, .142, .014, 2.25], [.42, .223, .136, .010, 2.2], [.38, .209, .130, .008, 2.15], [.34, .197, .125, .006, 2.15], [.30, .187, .120, .004, 2.1], [.26, .179, .116, .003, 2.1], [.22, .172, .113, .002, 2.1], [.18, .168, .111, 0, 2.1], [.14, .168, .110, -.001, 2.1], [.10, .175, .113, -.003, 2.1], [.06, .188, .118, -.006, 2.15], [.02, .200, .123, -.010, 2.15], [-.02, .192, .122, -.014, 2.15], [-.05, .165, .112, -.016, 2.1], [-.075, .125, .090, -.014, 2.05], [-.095, .070, .060, -.01, 2], [-.108, .020, .02, -.008, 2]];
  var ABY = .3525, ABP = .0665;
  function pecEdge(f) { return [.452 + .055 * sm(f, .25, 1.15), .636 - .03 * sm(f, .5, 1.2)]; }
  function trapW(y) { return prof([[.74, .5], [.70, 1.0], [.66, 1.22], [.60, .95], [.52, .6], [.42, .34], [.33, .14], [.27, .0]], y)[0]; }
  stack({
    N: ns(100), warp: .3, rings: ringsOf(TT, .752, -.108, nr(68), function (y, v) { return { t: y, c1: 0, c2: v[2], r1: v[0] * (1 - .06 * G(y, .5, .15) - .07 * G(y, .17, .09)), r2: v[1], n: v[3] }; }),
    reg: function (r, sn, cs) {
      var y = r.t, f = Math.atan2(Math.abs(sn), cs), fb = PI - f, e = pecEdge(f);
      if (y >= .70) return f < 1.0 ? id('ch_up') : id('tr');
      if (f < 1.15 && y >= e[0] - .004 && y <= e[1] + .01) return y >= e[0] + (e[1] - e[0]) * .52 ? id('ch_up') : id('ch_mid');
      if (f < 1.2 && y > .6) return id('ch_up');
      if (f < 1.5 && y >= .44 && y <= .64) return id('ch_mid');
      if (f < .46 && y > .068 && y < .435) return y > .25 ? id('abs_u') : id('abs_l');
      if (f < 1.6 && y > .05 && y < .46) return id('obl');
      if (y >= .31 && fb < trapW(y) * .96) return id('tr');
      if (f >= 1.6 && y > .15 && y < .55 && fb > .5) return id('lat');
      if (y > .32) return id('mb');
      if (y > .04) return fb < 1.0 ? id('lb') : id('obl');
      return cs < -.1 ? id('glu') : NONE;
    },
    D: function (r, sn, cs) {
      var y = r.t, f = Math.atan2(Math.abs(sn), cs), fb = PI - f, d = 0, v, cav = 0, e, pm, i, ab;
      if (f < 1.8) {
        /* pectorals */
        e = pecEdge(f); pm = Bx(y, e[0], e[1], .02) * Bx(f, .05, 1.14, .07);
        d += .034 * pm * (.4 + .6 * G(y, e[0] + .065, .06)) * (.6 + .4 * G(f, .6, .45));                          // pec mass
        d += .021 * G(y, e[0] + .005, .012) * Bx(f, .08, 1.05, .07);                                               // thick lower pec edge
        v = .024 * G(y, e[0] - .022, .017) * Bx(f, .1, 1.08, .08); d -= v; cav += v * 30;                           // shadow under the pec
        d += .006 * G(y, e[1] - .012, .02) * Bx(f, .1, 1.0, .1);                                                   // upper-pec / clavicular fullness
        v = .006 * G(f - (.5 + .5 * (y - .5) * 0), 0, .03) * Bx(y, e[0] + .03, e[1] - .02, .02) * 0; d -= v;
        v = .022 * G(f, 0, .05) * Bx(y, .435, .66, .015); d -= v; cav += v * 32;
        v = .014 * G(f, 1.2, .07) * Bx(y, .5, .64, .03); d -= v; cav += v * 26;                                      // delto-pectoral groove                                   // sternal groove
        d += .008 * G(y - (.652 + .03 * Math.min(f, 1.1)), 0, .012) * Bx(f, .1, 1.2, .08);                        // clavicle
        v = .006 * G(y - (.642 + .03 * Math.min(f, 1.1)), 0, .012) * Bx(f, .1, 1.2, .08); d -= v; cav += v * 22;
        /* serratus anterior fingers */
        for (i = 0; i < 4; i++) { var sv = .02 * G(y + .075 * (f - 1.35), .445 - .047 * i, .016) * Bx(f, 1.12, 1.72, .08); d += sv; cav += (i % 2 ? 0 : .2) * sv * 20; }
        /* abs: 4 rows of blocks + lower pair, linea alba, tendinous intersections */
        ab = Bx(y, .075, .43, .012) * Bx(f, .04, .40, .035);
        var wv = .5 + .5 * Math.cos((y - ABY) / ABP * TAU), blk = sm(wv, .12, .6);
        d += .014 * ab * (.1 + .9 * blk) * (1 - .45 * sm(f, .22, .42));
        v = .011 * G(f, 0, .035) * Bx(y, .07, .43, .012); d -= v; cav += v * 28;                                    // linea alba
        v = .008 * G(f, .41, .03) * Bx(y, .09, .42, .02); d -= v; cav += v * 24;                                     // linea semilunaris
        cav += ab * (1 - blk) * .32;                                                                              // soft grooves between blocks
        /* obliques + iliac crest + v-cut */
        d += .020 * Bx(f, .46, 1.38, .1) * Bx(y, .075, .40, .04) * (.55 + .45 * G(f, .95, .5));
        d += .010 * G(y, .072, .014) * Bx(f, .5, 1.6, .1);
        v = .014 * G(y - (.075 - (.9 - Math.min(f, .9)) * .2), 0, .013) * Bx(f, .22, .95, .06); d -= v; cav += v * 30;
        v = .012 * G(f, 0, .06) * G(y, .095, .012); d -= v; cav += v * 30;                                         // navel
        d += .010 * Bx(y, -.05, .05, .02) * Bx(f, .0, .5, .15);                                                    // pubic mound
        d += .008 * G(y - (.435 - .12 * Math.min(f, 1.4) * .75), 0, .015) * Bx(f, .35, 1.5, .1);                   // costal arch
      }
      if (f > 1.35) {
        /* back */
        var w = trapW(y);
        d += .032 * (1 - sm(fb, w - .2, w + .06)) * Bx(y, .27, .725, .025) * (.45 + .55 * G(y, .62, .16));        // trapezius kite
        v = .016 * G(fb, 0, .05) * Bx(y, .0, .72, .02); d -= v; cav += v * 32;                                      // spine groove
        d += .020 * G(y, .565, .07) * G(fb, .95, .32) * Bx(f, 1.4, 2.8, .1);                                        // infraspinatus
        d += .012 * G(y, .62, .02) * G(fb, 1.0, .4);                                                                // scapular spine
        d += .018 * G(y, .485, .028) * G(fb, 1.45, .2);                                                             // teres major
        v = .009 * G(y, .52, .01) * G(fb, .95, .35); d -= v; cav += v * 20;
        d += .052 * G(y, .385, .115) * Bx(f, 1.42, 2.72, .22) * (.5 + .5 * G(f, 1.95, .55)) * (1 - sm(y, .5, .57)); // lats
        d += .024 * Bx(y, .035, .34, .03) * G(fb, .2, .11);                                                         // erector spinae
        d += .012 * G(y, .50, .03) * G(fb, .45, .16);                                                               // rhomboids
        v = .008 * G(y, .045, .012) * G(fb, .3, .06); d -= v; cav += v * 24;                                        // lumbar dimples
        d += .014 * G(y, .0, .05) * Bx(fb, .0, .95, .2);                                                            // sacral/upper glute
      }
      AOV -= cav;
      return d;
    }
  });

  /* =============================== ARMS + SHOULDERS =============================== */
  [-1, 1].forEach(function (s) {
    var JX = s * .238, JY = .572, JZ = -.002, BU = s * .085, BF = s * .14, EY = -.40, WL = -.30;
    var EXp = JX - EY * Math.sin(BU), EYp = JY + EY * Math.cos(BU), WXp = EXp - WL * Math.sin(BF), WYp = EYp + WL * Math.cos(BF);
    /* deltoid: cap + three heads */
    var DL = [[.052, .011, .011, 0], [.046, .056, .056, .004], [.034, .080, .080, .008], [.012, .091, .089, .008], [-.02, .093, .091, .008], [-.06, .088, .086, .008], [-.105, .082, .082, .006], [-.145, .074, .074, .003], [-.178, .068, .068, 0]];
    stack({
      N: ns(30), xf: function (x, y, z) { rotZ(x, y, z, 0, 0, s * .07, JX, JY, JZ); },
      rings: ringsOf(DL, .052, -.178, nr(16), function (y, v) { return { t: y, c1: v[2], c2: 0, r1: v[0], r2: v[1] }; }),
      reg: function (r, sn, cs) { return cs > .42 ? id('dl_f') : cs < -.42 ? id('dl_r') : id('dl_s'); },
      D: function (r, sn, cs, u) {
        var y = r.t, so = sn * s, f = Math.atan2(sn * s, cs), d = 0, v;
        d += .020 * G(f, 0, .55) * G(y, -.03, .06) * (cs > 0 ? 1 : 0) + .012 * G(f, .0, .4) * G(y, -.1, .05);                // front head
        d += .022 * G(f, 1.45, .5) * G(y, -.02, .08);                                                                   // side head
        d += .020 * G(f, 3.0, .6) * G(y, -.03, .07) * (cs < 0 ? 1 : 0);                                                  // rear head
        v = .010 * G(f, .78, .1) * Bx(y, -.14, .03, .03); d -= v; AOV -= v * 26;                                       // groove front/side
        v = .010 * G(f, 2.3, .1) * Bx(y, -.14, .03, .03); d -= v; AOV -= v * 26;                                        // groove side/rear
        d += .012 * G(y, -.075, .03) * G(Math.abs(f) - 1.55, 0, .6) * (so > -.4 ? 1 : .4);                              // deltoid V insertion bulge
        return d;
      }
    });
    /* upper arm */
    var UA = [[0, .068, .067, 0], [-.06, .071, .069, 0], [-.13, .066, .067, 0], [-.21, .058, .063, 0], [-.30, .049, .054, 0], [-.36, .044, .048, 0], [-.40, .042, .044, 0]];
    stack({
      N: ns(30), xf: function (x, y, z) { rotZ(x, y, z, 0, 0, BU, JX, JY, JZ); },
      rings: ringsOf(UA, 0, -.40, nr(22), function (y, v) { return { t: y, c1: 0, c2: 0, r1: v[0], r2: v[1] }; }),
      reg: function (r, sn, cs, u) {
        var out = sn * s > 0, y = r.t;
        if (y > -.06) return cs > .3 ? id('bi_s') : cs < -.3 ? id('tri_l') : out ? id('bi_l') : id('bi_s');
        if (cs > .22) return out ? id('bi_l') : id('bi_s');
        if (cs < -.28) return out ? id('tri_o') : id('tri_l');
        return y < -.22 && out ? id('bi_b') : (out ? id('tri_o') : id('bi_s'));
      },
      D: function (r, sn, cs, u) {
        var y = r.t, f = Math.atan2(sn * s, cs), fa = Math.abs(f), d = 0, v;
        d += .030 * G(y, -.2, .085) * G(f, .12, .62) * (cs > -.1 ? 1 : 0);                                                // biceps peak
        v = .012 * G(f, .1, .07) * Bx(y, -.30, -.07, .04); d -= v; AOV -= v * 30;                                          // groove between the two heads
        d += .010 * G(y, -.2, .08) * G(f, -.55, .3) + .010 * G(y, -.2, .08) * G(f, .75, .3);                                // head fullness
        d += .013 * G(y, -.28, .06) * G(f, 1.35, .4);                                                                      // brachialis
        d += .030 * G(y, -.15, .09) * G(PI - fa, .55, .75) * (cs < 0 ? 1 : 0);                                              // triceps (horseshoe)
        v = .008 * G(PI - fa, 0, .08) * Bx(y, -.30, -.04, .03); d -= v; AOV -= v * 26;                                      // groove between triceps heads
        d += .012 * G(y, -.1, .05) * G(f, 2.4, .4);                                                                         // lateral head
        v = .010 * G(f, 1.88, .09) * Bx(y, -.30, -.06, .03); d -= v; AOV -= v * 22;                                         // biceps / triceps separation
        d += .014 * G(y, -.39, .018) * G(fa, PI, .5);                                                                      // olecranon
        d += .007 * G(y, -.37, .02) * (G(f, 1.57, .35) + G(f, -1.57, .35));                                                 // epicondyles
        return d;
      }
    });
    /* forearm */
    var FA = [[0, .047, .049], [-.04, .052, .054], [-.09, .049, .051], [-.15, .040, .043], [-.22, .031, .034], [-.27, .026, .029], [-.30, .024, .028]];
    stack({
      N: ns(26), xf: function (x, y, z) { rotZ(x, y, z, 0, 0, BF, EXp, EYp, JZ); },
      rings: ringsOf(FA, 0, -.30, nr(20), function (y, v) { return { t: y, c1: 0, c2: 0, r1: v[0], r2: v[1] }; }),
      reg: function () { return id('fore'); },
      D: function (r, sn, cs, u) {
        var y = r.t, f = Math.atan2(sn * s, cs), d = 0, v;
        d += .020 * G(y, -.045, .05) * G(f, .75, .38);                                                                     // brachioradialis
        d += .013 * G(y, -.07, .07) * G(f, -.8, .45);                                                                      // flexors
        d += .012 * G(y, -.08, .07) * G(Math.abs(f), 2.5, .6);                                                             // extensors
        v = .007 * G(f, .2, .06) * Bx(y, -.26, -.02, .03); d -= v; AOV -= v * 22;
        v = .006 * G(Math.abs(f), 2.0, .07) * Bx(y, -.26, -.02, .03); d -= v; AOV -= v * 22;
        d += .007 * G(y, -.27, .02) * (G(f, .0, .12) + G(f, -.5, .1) + G(f, .5, .1));                                      // wrist tendons
        d += .006 * G(y, -.295, .012) * (G(f, 1.57, .3) + G(f, -1.57, .3));                                                  // wrist bones
        return d;
      }
    });
    /* hand + fingers */
    function handXf(x, y, z) { rotZ(x, y, z, 0, 0, BF, WXp, WYp, JZ); }
    stack({
      N: ns(20), xf: handXf, rings: ringsOf([[0, .026, .031], [-.02, .021, .037], [-.05, .020, .041], [-.075, .018, .038], [-.085, .016, .034]], 0, -.085, nr(8), function (y, v) { return { t: y, c1: 0, c2: 0, r1: v[0], r2: v[1], n: 2.4 }; }),
      reg: function () { return NONE; },
      D: function (r, sn, cs) { var y = r.t, f = Math.atan2(sn * s, cs); return .008 * G(y, -.06, .018) * G(f, 1.57, .5) + .006 * G(y, -.012, .014) * G(Math.abs(f), 0, .9); }
    });
    if (det >= .7) {
      [[.027, .074, .0085, 0.0], [.009, .082, .0088, .004], [-.009, .077, .0084, .005], [-.026, .062, .0075, .006]].forEach(function (fg, fi) {
        var ln = fg[1], rr = fg[2], cu = fg[3] * 0 + .5;
        stack({
          N: 8, xf: handXf, rings: (function () { var a = [], j; for (j = 0; j <= 5; j++) { var t = j / 5, cv = t * t; a.push({ t: -.082 - ln * t * (1 - .35 * t), c1: -s * (.003 + .02 * cv), c2: fg[0] + .0 * t, r1: rr * (1 - .25 * t), r2: rr * (1 - .2 * t) }); } return a; })(),
          reg: function () { return NONE; }
        });
      });
      stack({
        N: 8, xf: handXf, rings: (function () { var a = [], j; for (j = 0; j <= 5; j++) { var t = j / 5; a.push({ t: -.012 - .062 * t, c1: -s * (.012 + .018 * t), c2: .04 + .028 * t, r1: .0105 * (1 - .22 * t), r2: .0105 * (1 - .2 * t) }); } return a; })(),
        reg: function () { return NONE; }
      });
    }
  });

  /* =============================== LEGS (hip to ankle as ONE continuous surface) =============================== */
  [-1, 1].forEach(function (s) {
    var HX = s * .108, TA = s * .08;
    /* rows: [t (0 = hip joint, going down), rx, rz, cz] */
    var LG = [[0, .090, .112, -.014], [-.05, .116, .128, -.012], [-.10, .126, .128, -.008], [-.16, .121, .122, -.003], [-.22, .110, .113, 0], [-.30, .095, .101, .003], [-.37, .083, .090, .004], [-.43, .071, .078, .004], [-.47, .063, .069, .003], [-.495, .059, .065, .002],
      [-.55, .060, .066, .000], [-.61, .061, .068, -.004], [-.67, .060, .068, -.008], [-.725, .054, .064, -.010], [-.795, .045, .052, -.008], [-.865, .036, .040, -.003], [-.915, .031, .034, 0], [-.95, .031, .036, 0]];
    var thighD = function (t, sn, cs) {
      var f = Math.atan2(sn * s, cs), fa = Math.abs(f), fb = PI - fa, tau = clamp(-t / .46, 0, 1.1), d = 0, v, fr = cs > -.25 ? 1 : 0, y = t;
      d += .042 * G(f, .88, .42) * G(tau, .46, .26) * sm(tau, .03, .2);                                                  // vastus lateralis
      d += .036 * G(f, .02, .27) * Bx(tau, .06, .66, .1) * (.6 + .4 * G(tau, .3, .2));                                    // rectus femoris
      d += .052 * G(f, -.72, .36) * G(tau, .79, .12);                                                                    // vastus medialis (teardrop)
      d += .016 * G(f, -.72, .4) * G(tau, .4, .2);
      v = .014 * G(f, .5, .075) * Bx(tau, .08, .84, .05) * fr; d -= v; AOV -= v * 34;                                       // RF / VL groove
      v = .014 * G(f, -.4, .075) * Bx(tau, .1, .74, .05) * fr; d -= v; AOV -= v * 34;                                       // RF / VM groove
      d += .012 * G(f - (.95 - 2.5 * tau), 0, .11) * Bx(tau, .02, .78, .03) * fr;                                          // sartorius strap
      v = .006 * G(f - (.95 - 2.5 * tau) - .16, 0, .05) * Bx(tau, .05, .74, .03) * fr; d -= v; AOV -= v * 18;
      d += .016 * G(f, 1.25, .3) * G(tau, .08, .13);                                                                     // tensor fasciae latae
      d += .030 * G(f, -1.5, .36) * G(tau, .25, .26);                                                                    // adductors
      v = .007 * G(f, 1.52, .08) * Bx(tau, .15, .85, .05); d -= v; AOV -= v * 20;                                          // IT band line
      d += .042 * G(fb, .55, .34) * G(tau, .45, .3) * sm(tau, .14, .3);                                                   // hamstrings
      v = .012 * G(fb, 0, .07) * Bx(tau, .14, .92, .05); d -= v; AOV -= v * 30;                                            // hamstring cleft
      d += .085 * G(y, -.025, .095) * G(fb, .55, .6) * (cs < 0 ? 1 : 0);                                                   // gluteus maximus
      d += .020 * G(y, .0, .06) * G(f, 2.05, .5) * (cs < 0 ? 1 : 0);                                                      // gluteus medius
      v = .015 * G(y, -.115, .016) * Bx(fb, 0, 1.2, .2) * (cs < 0 ? 1 : 0); d -= v; AOV -= v * 24;                         // gluteal fold
      d += .014 * G(f, 0, .22) * G(y, -.45, .026);                                                                       // patella
      d += .005 * G(y, -.46, .03) * (G(f, 1.5, .4) + G(f, -1.5, .4));                                                    // condyles
      return d;
    };
    var shinD = function (y, sn, cs) {                         // y: 0 at the knee line, going down
      var f = Math.atan2(sn * s, cs), fa = Math.abs(f), fb = PI - fa, d = 0, v, inner = f < 0;
      d += (inner ? .047 : .036) * G(y, -.15, .075) * G(fb, inner ? .6 : .65, .36) * (cs < .1 ? 1 : 0);                      // gastrocnemius heads
      v = .011 * G(fb, 0, .08) * Bx(y, -.30, -.01, .04); d -= v; AOV -= v * 28;                                                // between the two heads
      d += .016 * G(y, -.26, .07) * G(fb, .55, .5) * (cs < .1 ? 1 : 0);                                                        // soleus
      d += .012 * G(y, -.32, .05) * G(fb, 0, .2);
      d += .014 * G(y, -.17, .09) * (G(f, 1.5, .35) + G(f, -1.5, .3));                                                         // calf width from the front
      d += .007 * G(fb, 0, .09) * Bx(y, -.36, -.455, .02);                                                                     // achilles
      d += .016 * G(f, .1, .15) * Bx(y, -.04, -.40, .04) * (cs > 0 ? 1 : 0);                                                   // tibial crest
      d += .016 * G(f, .75, .25) * G(y, -.15, .12) * (cs > 0 ? 1 : 0);                                                         // tibialis anterior
      v = .007 * G(f, .45, .08) * Bx(y, -.35, -.04, .03); d -= v; AOV -= v * 18;
      d += .012 * G(y, -.425, .016) * (G(f, 1.57, .3) + G(f, -1.57, .3));                                                      // malleoli
      d += .010 * G(y, -.03, .03) * G(f, 0, .5);                                                                              // tibial tuberosity
      return d;
    };
    stack({
      N: ns(56), warp: .1, xf: function (x, y, z) { rotZ(x, y, z, 0, 0, TA, HX, .05, 0); },
      rings: ringsOf(LG, 0, -.95, nr(76), function (y, v) { return { t: y, c1: 0, c2: v[2], r1: v[0], r2: v[1] }; }),
      reg: function (r, sn, cs) {
        var t = r.t, f = Math.atan2(sn * s, cs), fb = PI - Math.abs(f), tau = -t / .48;
        if (t < -.5) return cs < .18 ? id('calf') : NONE;
        if (cs < -.1 && tau < .17 && fb < 1.5) return id('glu');
        return fb > 1.12 ? id('quad') : id('ham');
      },
      D: function (r, sn, cs) {
        var t = r.t, d = 0;
        if (t > -.53) d += thighD(t, sn, cs) * (1 - sm(t, -.5, -.53) * 0);
        if (t < -.47) d += shinD(t + .495, sn, cs);
        return d;
      }
    });
    var kp = [HX + .495 * Math.sin(TA), .05 - .495 * Math.cos(TA)];
    /* foot (built along z) */
    var ankleAbs = [HX + .95 * Math.sin(TA), .05 - .95 * Math.cos(TA)], AX = ankleAbs[0];
    var FT = [[-.062, -.956, .046, .030], [-.04, -.944, .060, .041], [-.01, -.936, .068, .047], [.03, -.952, .052, .050], [.075, -.968, .038, .054], [.12, -.978, .026, .056], [.16, -.983, .019, .054], [.195, -.986, .015, .048], [.215, -.987, .011, .034], [.226, -.987, .005, .018]];
    var footTab = FT.map(function (r) { return [-r[0], r[1], r[2], r[3]]; });                       // table descending in the lookup axis
    var fr2 = [], fi;
    for (fi = 0; fi <= nr(18); fi++) { var zz = -.062 + (.226 + .062) * fi / nr(18), vv = prof(footTab, -zz); fr2.push({ t: zz, c1: 0, c2: vv[0], r1: vv[2], r2: vv[1] }); }
    stack({
      N: ns(24), axis: 'z', xf: function (x, y, z) { rotY(x + AX, y, z, AX, 0, s * .22); },
      rings: fr2,
      reg: function () { return NONE; },
      D: function (r, sn, cs) {
        var z = r.t, d = 0, f = Math.atan2(sn, cs), v;
        d += .016 * G(z, .02, .035) * G(f, 0, .5) * (cs > 0 ? 1 : 0);                                                           // instep
        d += .012 * G(z, -.04, .022) * (G(f, 1.57, .3) + G(f, -1.57, .3)) * 1;                                                  // malleoli
        d += .008 * G(z, -.05, .02) * (cs < 0 ? 1 : 0);                                                                         // heel
        var tg = Bx(z, .15, .22, .01) * (cs > 0 ? 1 : 0);
        v = .006 * tg * (G(f, .18, .06) + G(f, -.18, .06) + G(f, .38, .06) + G(f, -.38, .06) + G(f, .0, .06)); d -= v;          // toe separations
        d += .006 * G(z, .19, .02) * G(f, 0, .5) * (cs > 0 ? 1 : 0);
        return d;
      }
    });
  });

  /* =============================== finalise: normals, centroids =============================== */
  var n = X.length, cen = {}, i;
  for (i = 0; i < n; i++) { var rg = RG[i]; if (rg === NONE) continue; if (X[i] < -.001 && Math.abs(X[i]) > .04) continue; var c2 = cen[rg] || (cen[rg] = [0, 0, 0, 0]); c2[0] += X[i]; c2[1] += Y[i]; c2[2] += Z[i]; c2[3]++; }
  var VX = new Float32Array(n), VY = new Float32Array(n), VZ = new Float32Array(n);
  for (var qq = 0; qq < QF.length; qq++) {
    var a1 = Q[qq * 4], b1 = Q[qq * 4 + 1], c1 = Q[qq * 4 + 2], d1 = Q[qq * 4 + 3];
    var ux = X[d1] - X[a1], uy = Y[d1] - Y[a1], uz = Z[d1] - Z[a1], vx = X[b1] - X[a1], vy = Y[b1] - Y[a1], vz = Z[b1] - Z[a1];
    var fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    VX[a1] += fx; VY[a1] += fy; VZ[a1] += fz; VX[b1] += fx; VY[b1] += fy; VZ[b1] += fz; VX[c1] += fx; VY[c1] += fy; VZ[c1] += fz; VX[d1] += fx; VY[d1] += fy; VZ[d1] += fz;
  }
  for (i = 0; i < n; i++) {
    var l2 = Math.sqrt(VX[i] * VX[i] + VY[i] * VY[i] + VZ[i] * VZ[i]) || 1; VX[i] /= l2; VY[i] /= l2; VZ[i] /= l2;
    if (VX[i] * (X[i] - CX[i]) + VY[i] * (Y[i] - CY[i]) + VZ[i] * (Z[i] - CZ[i]) < 0) { VX[i] = -VX[i]; VY[i] = -VY[i]; VZ[i] = -VZ[i]; }
  }
  return { NY: VY, GX: VX, GZ: VZ, n: n, X: new Float32Array(X), Y: new Float32Array(Y), Z: new Float32Array(Z), CX: new Float32Array(CX), CZ: new Float32Array(CZ), AO: new Float32Array(AO), RG: RG, Q: Q, QF: QF, QP: new Uint8Array(QP), nq: QF.length, cen: cen, lo: det < .7 };
}
function getMesh(lo) { return lo ? (MESH_LO || (MESH_LO = buildMesh(.55))) : (MESH || (MESH = buildMesh(1))); }
function rowCentroid(row) {
  var M = getMesh(true), s = [0, 0, 0, 0];
  R.forEach(function (r, k) { if (r[2] === row && M.cen[k]) { var c = M.cen[k]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3] += c[3]; } });
  return s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0, .3, 0];
}

/* ================= palette: 24 light levels x 4 rim steps per state ================= */
/* each state: [shadow, body, highlight] */
var BASE = [[[2, 6, 14], [44, 84, 132], [170, 214, 250]], [[2, 20, 10], [38, 222, 108], [205, 255, 228]], [[10, 26, 48], [150, 212, 255], [246, 252, 255]], [[32, 3, 7], [238, 54, 52], [255, 204, 192]]];
var RIMC = [90, 226, 255], NLV = 24;
var PAL = BASE.map(function (b) {
  var a = [], ri, i, c, t, col, mix;
  for (ri = 0; ri < 4; ri++) for (i = 0; i < NLV; i++) {
    if (i <= 16) { t = i / 16; c = [lerp(b[0][0], b[1][0], t), lerp(b[0][1], b[1][1], t), lerp(b[0][2], b[1][2], t)]; }
    else { t = (i - 16) / 7; c = [lerp(b[1][0], b[2][0], t), lerp(b[1][1], b[2][1], t), lerp(b[1][2], b[2][2], t)]; }
    mix = ri * .2 * (.35 + .65 * Math.min(1, i / 14));
    a.push('rgb(' + Math.round(lerp(c[0], RIMC[0], mix)) + ',' + Math.round(lerp(c[1], RIMC[1], mix)) + ',' + Math.round(lerp(c[2], RIMC[2], mix)) + ')');
  }
  return a;
});
var STC = [[96, 170, 255], [70, 255, 140], [190, 232, 255], [255, 80, 78]];
/* v2: the same 24 x 4 ramps for the white-blue Holo palette (5 states: other / on target / building / neglected / low) */
var BASE_BLUE = [[[4, 10, 22], [52, 92, 146], [182, 220, 252]], [[8, 38, 64], [140, 238, 255], [244, 255, 255]], [[5, 18, 52], [72, 148, 255], [204, 230, 255]], [[3, 9, 24], [36, 72, 134], [118, 160, 222]], [[4, 14, 36], [56, 116, 214], [182, 214, 252]]];
var PALB = BASE_BLUE.map(function (b) {
  var a = [], ri, i, c, t, mix;
  for (ri = 0; ri < 4; ri++) for (i = 0; i < NLV; i++) {
    if (i <= 16) { t = i / 16; c = [lerp(b[0][0], b[1][0], t), lerp(b[0][1], b[1][1], t), lerp(b[0][2], b[1][2], t)]; }
    else { t = (i - 16) / 7; c = [lerp(b[1][0], b[2][0], t), lerp(b[1][1], b[2][1], t), lerp(b[1][2], b[2][2], t)]; }
    mix = ri * .2 * (.35 + .65 * Math.min(1, i / 14));
    a.push('rgb(' + Math.round(lerp(c[0], RIMC[0], mix)) + ',' + Math.round(lerp(c[1], RIMC[1], mix)) + ',' + Math.round(lerp(c[2], RIMC[2], mix)) + ')');
  }
  return a;
});
var STCB = [[96, 170, 255], [150, 240, 255], [96, 160, 255], [86, 120, 190], [120, 170, 240]];
var RECLEG = '<span><i style="background:#46ff8c"></i><div>READY<em>3+ days rest (2 for small muscles)</em></div></span><span><i style="background:#bfe8ff"></i><div>RECOVERING<em>trained 2 days ago</em></div></span><span><i style="background:#ff504e"></i><div>SORE<em>trained today or yesterday</em></div></span>';
var PX = 0, PY = 0, PZ = 0;
var SF = new Uint8Array(NR + 1); ['dl_f', 'dl_s', 'dl_r', 'bi_l', 'bi_s', 'bi_b', 'tri_l', 'tri_o', 'fore', 'quad', 'ham', 'glu', 'calf', 'lat', 'tr', 'mb', 'lb'].forEach(function (k) { SF[RI[k]] = 1; });

/* ================= render ================= */
var LABELS_F = [['tr', 'Trapezius', 'L'], ['dl_s', 'Deltoid', 'R'], ['ch_mid', 'Pectorals', 'L'], ['bi_s', 'Biceps', 'L'], ['obl', 'Obliques', 'L'], ['abs_u', 'Abs', 'R'], ['quad', 'Quadriceps', 'R'], ['fore', 'Forearm', 'L'], ['calf', 'Calves', 'R']];
var LABELS_B = [['tr', 'Trapezius', 'L'], ['dl_r', 'Rear delt', 'R'], ['lat', 'Lats', 'R'], ['tri_l', 'Triceps', 'L'], ['lb', 'Lower back', 'L'], ['glu', 'Glutes', 'R'], ['ham', 'Hamstrings', 'L'], ['calf', 'Calves', 'R']];
function ringPath(ctx, pr, y, r, a0, a1, N) { for (var i = 0; i <= N; i++) { var a = a0 + (a1 - a0) * i / N; pr(Math.cos(a) * r, y, Math.sin(a) * r); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); } }
function meshFor(u) { return getMesh(!!u.mini || K.lite() || K.lvl() >= 1 || !!u.fast); }
function mstate(s) {
  var u = s.ud, M = meshFor(u);
  if (!u.rs) { u.rs = new Uint8Array(NR); u.mult = new Float32Array(NR + 1).fill(1); u.yaw = u.yaw === undefined ? .5 : u.yaw; u.zoom = u.zoom || 1; u.selRow = -1; u.fx = u.fx || 0; u.fy = u.fy || 0; u.fz = u.fz || 0; }
  if (u.mref !== M) {
    u.mref = M; u.arrs = u.arrs || {}; var ak = M.lo ? 'lo' : 'hi', ar = u.arrs[ak];                   // v2: one set of work arrays per detail level
    if (!ar) ar = u.arrs[ak] = { px: new Float32Array(M.n), py: new Float32Array(M.n), pz: new Float32Array(M.n), lm: new Float32Array(M.n), rim: new Float32Array(M.n), nz: new Float32Array(M.n), cnt: new Int32Array(2050), kb: new Int16Array(M.nq), ordA: new Int32Array(M.nq) };
    u.px = ar.px; u.py = ar.py; u.pz = ar.pz; u.lm = ar.lm; u.rim = ar.rim; u.nz = ar.nz; u.cnt = ar.cnt; u.kb = ar.kb; u.ordA = ar.ordA; u.ordN = 0;
  }
  return M;
}
function drawMap(ctx, w, h, t, s) {
  var M = mstate(s), u = s.ud, mini = !!u.mini, dt = Math.min(90, t - (u.t0 || t)); u.t0 = t;
  var PALX = u.pal === 'blue' ? PALB : PAL, STCX = u.pal === 'blue' ? STCB : STC;                       // v2: white-blue palette for the Holo room
  if (!mini) {
    if (u.tgt !== undefined && u.tgt !== null) { var df = Math.atan2(Math.sin(u.tgt - u.yaw), Math.cos(u.tgt - u.yaw)); u.yaw += df * Math.min(1, dt * .008); if (Math.abs(df) < .01) u.tgt = null; }
    else if (u.spin && !s.drag && !K.lite()) u.yaw += dt * .00045;
    u.vel = u.vel || 0; if (!s.drag && Math.abs(u.vel) > .0004) { u.yaw += u.vel * dt; u.vel *= .94; }
  }
  var yaw = u.yaw, cyw = Math.cos(yaw), syw = Math.sin(yaw), pitch = mini ? .04 : .09, cp = Math.cos(pitch), sp = Math.sin(pitch), F = 4.6;
  var base = mini ? h / 2.3 : Math.min(h / 2.18, w / 1.45), sc = base * (u.zoom || 1), cx = w / 2, cy = h / 2 + (mini ? 0 : h * .005);
  if (u.zoom > 1.05 || mini) {
    var fxr = u.fx * cyw + u.fz * syw, fzr = -u.fx * syw + u.fz * cyw, fyp = u.fy * cp - fzr * sp, fzp = u.fy * sp + fzr * cp, fk = F / (F - fzp);
    cx = w / 2 - fxr * sc * fk; cy = h / 2 + fyp * sc * fk;
  }
  var GX = M.GX, GZ = M.GZ, NYv = M.NY, X = M.X, Y = M.Y, Z = M.Z, CX = M.CX, CZ = M.CZ, AO = M.AO, RG = M.RG, px = u.px, py = u.py, pz = u.pz, lm = u.lm, rimv = u.rim, nzv = u.nz, mult = u.mult, i, x, y, z, xr, zr, yp, zp, k, m, g;
  var showLab = !mini && w > 560 && u.zoom <= 1.3, face = cyw >= 0, labs = face ? LABELS_F : LABELS_B, acc = null;
  if (showLab) { acc = u.acc || (u.acc = {}); labs.forEach(function (L) { var a = acc[L[0]] || (acc[L[0]] = [0, 0, 0, 0, 0, 0]); a[0] = a[1] = a[2] = a[3] = a[4] = a[5] = 0; }); }
  /* lights (view space): key upper-left-front, soft fill from the right, specular half-vector */
  var KLx = -.49, KLy = .54, KLz = .686, FLx = .82, FLy = .18, FLz = .53, HHx = -.266, HHy = .293, HHz = .916;
  for (i = 0; i < M.n; i++) {
    g = RG[i]; m = mult[g]; x = X[i]; y = Y[i]; z = Z[i];
    if (m !== 1) { x = CX[i] + (x - CX[i]) * m; z = CZ[i] + (z - CZ[i]) * m; }
    xr = x * cyw + z * syw; zr = -x * syw + z * cyw; yp = y * cp - zr * sp; zp = y * sp + zr * cp; k = F / (F - zp);
    px[i] = cx + xr * sc * k; py[i] = cy - yp * sc * k; pz[i] = zp;
    var gx = GX[i], gz = GZ[i], gy = NYv[i], nxr = gx * cyw + gz * syw, nzr = -gx * syw + gz * cyw; nzv[i] = nzr;
    var dk = nxr * KLx + gy * KLy + nzr * KLz, df2 = nxr * FLx + gy * FLy + nzr * FLz, sh = nxr * HHx + gy * HHy + nzr * HHz;
    dk = dk > 0 ? dk : 0; df2 = df2 > 0 ? df2 : 0; sh = sh > 0 ? sh : 0;
    var sp2 = sh * sh; sp2 *= sp2; sp2 *= sp2; sp2 *= sp2; sp2 *= sh * sh;          // ~ sh^18
    var rm = 1 - (nzr > 0 ? nzr : 0); rm = rm * rm * (rm > .5 ? 1.35 : .8);
    lm[i] = (.06 + .04 * gy + .74 * dk + .14 * df2 + .26 * sp2) * AO[i] + rm * .1; rimv[i] = rm;
    if (acc && g !== NONE && nzr > .25) { var a2 = acc[R[g][0]]; if (a2) { a2[0] += px[i]; a2[1] += py[i]; a2[2]++; if (px[i] < w / 2) { a2[3] += px[i]; a2[4] += py[i]; a2[5]++; } } }
  }
  ctx.clearRect(0, 0, w, h); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  var sprs = K.sprites(), pulse = .5 + .5 * Math.sin(t * .004);
  function pr(x0, y0, z0) { var xr0 = x0 * cyw + z0 * syw, zr0 = -x0 * syw + z0 * cyw, yp0 = y0 * cp - zr0 * sp, zp0 = y0 * sp + zr0 * cp, k0 = F / (F - zp0); PX = cx + xr0 * sc * k0; PY = cy - yp0 * sc * k0; PZ = zp0; }
  var spin = t * .0004;
  /* pedestal (behind) */
  if (!mini) {
    ctx.globalCompositeOperation = 'lighter';
    pr(0, -1.01, 0); ctx.save(); ctx.translate(PX, PY); ctx.scale(1, .26);
    var gg = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * .95); gg.addColorStop(0, rgba(C.cy, .5)); gg.addColorStop(.35, rgba(C.bl, .24)); gg.addColorStop(1, rgba(C.bl, 0));
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, sc * .95, 0, TAU); ctx.fill(); ctx.restore();
    ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(C.cy, .75); ctx.beginPath(); ringPath(ctx, pr, -1.01, .5, 0, TAU, 60); ctx.stroke();
    ctx.lineWidth = 1; ctx.setLineDash([2, 6]); ctx.lineDashOffset = -t * .012; ctx.strokeStyle = rgba(C.pale, .5); ctx.beginPath(); ringPath(ctx, pr, -1.01, .66, 0, TAU, 64); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.bl, .85);
    for (i = 0; i < 4; i++) { ctx.beginPath(); ringPath(ctx, pr, -1.01, .82, spin + i * TAU / 4, spin + i * TAU / 4 + .9, 16); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .3); ctx.beginPath(); ringPath(ctx, pr, -1.01, .96, 0, TAU, 72); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  /* depth sort: counting sort on mean depth (fast, no comparator) */
  var Q = M.Q, QF = M.QF, QP = M.QP, cnt = u.cnt, kb = u.kb, ordA = u.ordA, q, a, b, c, d, st, rs = u.rs, sel = u.selRow, nq = M.nq, tot = 0;
  cnt.fill(0);
  for (q = 0; q < nq; q++) {
    a = Q[q * 4]; b = Q[q * 4 + 1]; c = Q[q * 4 + 2]; d = Q[q * 4 + 3];
    if (nzv[a] + nzv[b] + nzv[c] + nzv[d] < -.14) { kb[q] = -1; continue; }
    k = ((pz[a] + pz[b] + pz[c] + pz[d]) * .25 + 1.3) * 780 | 0; if (k < 0) k = 0; else if (k > 2047) k = 2047;
    kb[q] = k; cnt[k + 1]++; tot++;
  }
  for (i = 1; i < 2050; i++) cnt[i] += cnt[i - 1];
  for (q = 0; q < nq; q++) { k = kb[q]; if (k >= 0) ordA[cnt[k]++] = q; }
  u.ordN = tot;
  for (i = 0; i < tot; i++) {
    q = ordA[i]; a = Q[q * 4]; b = Q[q * 4 + 1]; c = Q[q * 4 + 2]; d = Q[q * 4 + 3]; g = RG[a];
    st = g === NONE ? 0 : rs[g];
    var isSel = sel >= 0 && g !== NONE && R[g][2] === sel;
    var lv = (lm[a] + lm[b] + lm[c] + lm[d]) * .25 + (isSel ? .2 + .1 * pulse : 0) + (st === 3 ? .07 * pulse : 0);
    var rmq = (rimv[a] + rimv[b] + rimv[c] + rimv[d]) * .25;
    var li = lv * 20 + .5 | 0; if (QP[q] && SF[g]) li -= 2; if (li < 0) li = 0; else if (li > 23) li = 23;
    var ri = rmq > .62 ? 3 : rmq > .45 ? 2 : rmq > .3 ? 1 : 0;
    ctx.fillStyle = ctx.strokeStyle = PALX[st][ri * 24 + li]; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); ctx.lineTo(px[d], py[d]); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (QF[q] || isSel) {
      var fl = QF[q];
      ctx.strokeStyle = isSel ? 'rgba(240,252,255,.85)' : 'rgba(' + STCX[st][0] + ',' + STCX[st][1] + ',' + STCX[st][2] + ',.38)'; ctx.lineWidth = isSel ? 1 : .7; ctx.beginPath();
      if (fl & 1) { ctx.moveTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); }
      if (fl & 2) { ctx.moveTo(px[d], py[d]); ctx.lineTo(px[c], py[c]); }
      ctx.stroke();
    }
  }
  if (!mini) {
    ctx.globalCompositeOperation = 'lighter';
    var ph = (t % 5600) / 5600, sy = -1 + 2.04 * (ph < .5 ? ph * 2 : 2 - ph * 2);
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(C.cy, .55); ctx.beginPath(); ringPath(ctx, pr, sy, .4, 0, TAU, 40); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.cy, .06); ctx.beginPath(); ringPath(ctx, pr, sy, .4, 0, TAU, 40); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  /* soft bloom: a 1/4-size copy of the frame added back on top (cheap glow, skipped in Lite) */
  if (!mini && s.cv && !K.lite()) {
    var bw = Math.max(16, w >> 2), bh = Math.max(16, h >> 2), oc = u.bc || (u.bc = D.createElement('canvas'));
    if (oc.width !== bw || oc.height !== bh) { oc.width = bw; oc.height = bh; }
    var bx = oc.getContext('2d'); bx.globalCompositeOperation = 'copy'; bx.drawImage(s.cv, 0, 0, bw, bh);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .2; ctx.imageSmoothingEnabled = true; ctx.drawImage(oc, 0, 0, w, h); ctx.restore();
  }
  /* callout labels with leader lines */
  if (showLab) {
    var items = [];
    labs.forEach(function (L) { var a3 = acc[L[0]]; if (!a3 || a3[2] < 3) return; var side = L[2], ax, ay; if (side === 'L' && a3[5] > 2) { ax = a3[3] / a3[5]; ay = a3[4] / a3[5]; } else if (side === 'R' && a3[2] - a3[5] > 2) { ax = (a3[0] - a3[3]) / (a3[2] - a3[5]); ay = (a3[1] - a3[4]) / (a3[2] - a3[5]); } else { ax = a3[0] / a3[2]; ay = a3[1] / a3[2]; } items.push({ L: L, ax: ax, ay: ay, left: side === 'L' ? true : side === 'R' ? false : ax < w / 2 }); });
    [true, false].forEach(function (isLeft) {
      var col = items.filter(function (o) { return o.left === isLeft; }).sort(function (p, r) { return p.ay - r.ay; }), last = -1e9;
      col.forEach(function (o) {
        var ly = Math.max(o.ay, last + 34); ly = Math.min(ly, h - 30); last = ly; var lx = isLeft ? 14 : w - 14, ri2 = RI[o.L[0]], stt = rs[ri2], cc = STCX[stt];
        var tx = isLeft ? lx + 96 : lx - 96;
        ctx.strokeStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(tx + (isLeft ? 10 : -10), ly - 6); ctx.lineTo(tx, ly - 6); ctx.stroke();
        ctx.fillStyle = rgbS(cc, .95); ctx.beginPath(); ctx.arc(o.ax, o.ay, 2.4, 0, TAU); ctx.fill();
        ctx.textAlign = isLeft ? 'left' : 'right';
        ctx.font = '600 11.5px "Chakra Petch",monospace'; ctx.fillStyle = 'rgba(225,242,255,.95)'; ctx.fillText(o.L[1], lx, ly - 8);
        ctx.font = '500 10px "IBM Plex Sans",sans-serif'; ctx.fillStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',.95)'; ctx.fillText(u.labelTxt ? u.labelTxt(ri2) : ST_NAME[stt], lx, ly + 5);
      });
    });
  }
}
function pickQuad(s, mx, my) {
  var u = s.ud, M = u.mref, Q = M.Q, px = u.px, py = u.py, ord = u.ordA;
  function inside(a, b, c, d) { var xs = [px[a], px[b], px[c], px[d]], ys = [py[a], py[b], py[c], py[d]], sg = 0; for (var i = 0; i < 4; i++) { var j = (i + 1) % 4, cr = (xs[j] - xs[i]) * (my - ys[i]) - (ys[j] - ys[i]) * (mx - xs[i]); if (cr !== 0) { var sgn = cr > 0 ? 1 : -1; if (sg && sgn !== sg) return false; sg = sgn; } } return true; }
  for (var i = u.ordN - 1; i >= 0; i--) { var q = ord[i]; if (inside(Q[q * 4], Q[q * 4 + 1], Q[q * 4 + 2], Q[q * 4 + 3])) return M.RG[Q[q * 4]]; }
  return -1;
}

var TOUCHY = !!(window.matchMedia && matchMedia('(pointer:coarse)').matches);

/* =====================================================================
   v2 — GPU SOLID BODY (WebGL2)
   The same procedural anatomy mesh, camera and light rig as the canvas version above, but drawn by the GPU:
   smooth per-pixel lighting, rim light, micro fibre detail, a scanning band and crisp muscle-part outlines at a
   steady 60 fps on phones (the canvas version pushed 22 000 polygons through the CPU and managed about 12 fps).
   • ONE shared WebGL context for every body on the page (big body, small back view, zoomed muscle view, Holo bodies).
     Each view is rendered into a corner of it and copied into its own canvas, so the 2D pedestal, scan ring and
     call-out labels stay exactly as before and there is never more than one GL context.
   • If WebGL2 is missing, blocked, slow (software renderer) or the GPU context is lost, every view silently falls
     back to the canvas version above (with a lighter mesh while you drag), so nothing ever goes blank.
   • HOLO.cfg.noGL = true forces the canvas version; HOLO.cfg.allowSoftwareGL = true lets a software renderer be used.
   ===================================================================== */
H.cfg = H.cfg || {};

/* ---------- palettes: [shadow, body, highlight] per state ---------- */
/* SEM = the colours of the reference design: green trained, red not trained, white-blue partial, steel blue other */
var PAL_SEM = [
  [[2, 6, 14], [44, 84, 132], [170, 214, 250]],
  [[2, 20, 10], [38, 222, 108], [205, 255, 228]],
  [[10, 26, 48], [150, 212, 255], [246, 252, 255]],
  [[32, 3, 7], [238, 54, 52], [255, 204, 192]]
];
/* BLUE = Holo room: white-blue only. Brightness says how well a muscle is trained (bright = on target, dark = neglected) */
var PAL_BLUE = [
  [[4, 10, 22], [52, 92, 146], [182, 220, 252]],         // 0 other (head, hands, feet)
  [[8, 38, 64], [140, 238, 255], [244, 255, 255]],       // 1 on target: bright ice-white
  [[5, 18, 52], [72, 148, 255], [204, 230, 255]],        // 2 building
  [[3, 9, 24], [36, 72, 134], [118, 160, 222]],          // 3 neglected: dim steel blue (still clearly a body)
  [[4, 14, 36], [56, 116, 214], [182, 214, 252]]         // 4 low
];
var STC_SEM = [[96, 170, 255], [70, 255, 140], [190, 232, 255], [255, 80, 78]];
var STC_BLUE = [[96, 170, 255], [150, 240, 255], [96, 160, 255], [86, 120, 190], [120, 170, 240]];
function palOf(u) { return u && u.pal === 'blue' ? PAL_BLUE : PAL_SEM; }
function stcOf(u) { return u && u.pal === 'blue' ? STC_BLUE : STC_SEM; }

/* ---------- shaders ---------- */
var GL_VS = [
  '#version 300 es', 'precision highp float;',
  'in vec3 aPos; in vec3 aNrm; in float aAO; in float aReg; in vec2 aCen;',
  'uniform vec2 uYaw; uniform vec2 uPit; uniform float uF; uniform vec2 uC; uniform float uSc; uniform vec2 uRes; uniform float uBias;',
  'uniform float uMult[24]; uniform vec3 uShade[24]; uniform vec3 uBody[24]; uniform vec3 uHigh[24]; uniform vec2 uES[24];',
  'out vec3 vN; out vec3 vO; out float vAO;',
  'flat out vec3 vSh; flat out vec3 vBo; flat out vec3 vHi; flat out vec2 vES;',
  'void main(){',
  '  int r = int(aReg + 0.5);',
  '  float m = uMult[r];',
  '  vec3 p = aPos; p.x = aCen.x + (p.x - aCen.x) * m; p.z = aCen.y + (p.z - aCen.y) * m;',
  '  float xr = p.x * uYaw.x + p.z * uYaw.y;',
  '  float zr = -p.x * uYaw.y + p.z * uYaw.x;',
  '  float yp = p.y * uPit.x - zr * uPit.y;',
  '  float zp = p.y * uPit.y + zr * uPit.x;',
  '  float k = uF / (uF - zp);',
  '  vec2 sc = uC + vec2(xr, -yp) * uSc * k;',
  '  vec2 ndc = vec2(sc.x / uRes.x * 2.0 - 1.0, 1.0 - sc.y / uRes.y * 2.0);',
  '  float wv = 1.0 / k;',
  '  float zc = -zp * 0.45 - uBias;',
  '  gl_Position = vec4(ndc * wv, zc * wv, wv);',
  '  float nxr = aNrm.x * uYaw.x + aNrm.z * uYaw.y;',
  '  float nzr = -aNrm.x * uYaw.y + aNrm.z * uYaw.x;',
  '  float nyp = aNrm.y * uPit.x - nzr * uPit.y;',
  '  float nzp = aNrm.y * uPit.y + nzr * uPit.x;',
  '  vN = vec3(nxr, nyp, nzp); vO = p; vAO = aAO;',
  '  vSh = uShade[r]; vBo = uBody[r]; vHi = uHigh[r]; vES = uES[r];',
  '}'
].join('\n');
var GL_FS = [
  '#version 300 es', 'precision highp float;',
  'in vec3 vN; in vec3 vO; in float vAO;',
  'flat in vec3 vSh; flat in vec3 vBo; flat in vec3 vHi; flat in vec2 vES;',
  'uniform float uMode; uniform float uPulse; uniform float uScan; uniform float uDet; uniform vec3 uRim;',
  'out vec4 o;',
  'float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
  'float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
  '             mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }',
  'void main(){',
  '  if (uMode > 0.5) { vec3 lc = min(vBo * 1.25 + 0.12, vec3(1.0)); o = vec4(lc * 0.42, 0.42); return; }',
  '  vec3 n = normalize(vN);',
  '  float fib = vn(vO * vec3(46.0, 12.0, 46.0));',
  '  float fib2 = vn(vO * vec3(118.0, 22.0, 118.0));',
  '  n = normalize(n + (vec3(vn(vO * 60.0 + 3.1), vn(vO * 60.0 + 9.7), vn(vO * 60.0 + 17.3)) - 0.5) * 0.11 * uDet);',
  '  vec3 KL = vec3(-0.49, 0.54, 0.686); vec3 FL = vec3(0.82, 0.18, 0.53); vec3 HH = vec3(-0.266, 0.293, 0.916);',
  '  float dk = max(dot(n, KL), 0.0); float df = max(dot(n, FL), 0.0); float sh = max(dot(n, HH), 0.0);',
  '  float sp = pow(sh, 24.0);',
  '  float rm = 1.0 - max(n.z, 0.0);',
  '  float lv = (0.055 + 0.05 * n.y + 0.76 * dk + 0.16 * df + 0.30 * sp) * (vAO * (0.35 + 0.65 * vAO));',
  '  lv *= 0.84 + 0.17 * fib + 0.10 * fib2 * uDet;',
  '  lv += 0.08 * rm * rm;',
  '  lv += vES.y * (0.20 + 0.10 * uPulse);',
  '  vec3 c = lv < 0.8 ? mix(vSh, vBo, lv / 0.8) : mix(vBo, vHi, clamp((lv - 0.8) / 0.35, 0.0, 1.0));',
  '  c += uRim * pow(rm, 2.4) * (0.58 + 0.25 * uPulse);',
  '  float br = pow(max(dot(n, normalize(vec3(0.85, 0.15, -0.5))), 0.0), 3.0);',
  '  c += vec3(0.10, 0.30, 0.75) * br * 0.55;',
  '  c += vBo * vES.x;',
  '  float sb = exp(-pow((vO.y - uScan) * 16.0, 2.0)); c += uRim * sb * 0.30;',
  '  c = mix(c, vec3(0.93, 0.98, 1.0), vES.y * (0.10 + 0.06 * uPulse));',
  '  c *= 0.965 + 0.035 * sin(gl_FragCoord.y * 1.1);',
  '  o = vec4(clamp(c, 0.0, 1.0), 1.0);',
  '}'
].join('\n');

/* ---------- context + mesh upload ---------- */
var GLS = { tried: false, ok: false, c: null, g: null, prog: null, vao: null, nIdx: 0, nLine: 0, idxType: 0, M: null, loc: {}, lost: false, capW: 0, capH: 0,
  tx: null, ty: null, tz: null, f: { sh: new Float32Array(72), bo: new Float32Array(72), hi: new Float32Array(72), es: new Float32Array(48), mu: new Float32Array(24) }, anch: null };
function glCompile(g, type, src) {
  var sh = g.createShader(type); g.shaderSource(sh, src); g.compileShader(sh);
  if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) { var m = g.getShaderInfoLog(sh); g.deleteShader(sh); throw new Error('shader: ' + m); }
  return sh;
}
function glInit() {
  if (GLS.tried) return GLS.ok && !GLS.lost;
  GLS.tried = true;
  if (H.cfg.noGL) return false;
  try {
    var c = D.createElement('canvas'); c.width = 256; c.height = 256;
    var low = K.lvl() >= 1 || D.documentElement.classList.contains('fx-low');
    var g = c.getContext('webgl2', { alpha: true, antialias: !low, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: !H.cfg.allowSoftwareGL });
    if (!g) return false;
    var vs = glCompile(g, g.VERTEX_SHADER, GL_VS), fs = glCompile(g, g.FRAGMENT_SHADER, GL_FS), p = g.createProgram();
    g.attachShader(p, vs); g.attachShader(p, fs); g.bindAttribLocation(p, 0, 'aPos'); g.bindAttribLocation(p, 1, 'aNrm'); g.bindAttribLocation(p, 2, 'aAO'); g.bindAttribLocation(p, 3, 'aReg'); g.bindAttribLocation(p, 4, 'aCen');
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error('link: ' + g.getProgramInfoLog(p));
    GLS.c = c; GLS.g = g; GLS.prog = p;
    ['uYaw', 'uPit', 'uF', 'uC', 'uSc', 'uRes', 'uBias', 'uMode', 'uPulse', 'uScan', 'uDet', 'uRim'].forEach(function (n) { GLS.loc[n] = g.getUniformLocation(p, n); });
    ['uMult', 'uShade', 'uBody', 'uHigh', 'uES'].forEach(function (n) { GLS.loc[n] = g.getUniformLocation(p, n + '[0]'); });
    c.addEventListener('webglcontextlost', function (e) { e.preventDefault(); GLS.lost = true; GLS.vao = null; if (W.console) console.warn('muscle map: GPU context lost, using the canvas renderer until it returns'); });
    c.addEventListener('webglcontextrestored', function () { GLS.tried = false; GLS.ok = false; GLS.lost = false; GLS.M = null; GLS.capW = GLS.capH = 0; });
    glUpload(getMeshGL());
    GLS.ok = true;
  } catch (e) { GLS.ok = false; if (W.console) console.warn('muscle map: WebGL2 unavailable, using the canvas renderer (' + (e && e.message) + ')'); }
  return GLS.ok;
}
var MESH_GL = null;
function glDet() {                        // v3: how dense the GPU body is. Phones 1.45, weak phones 1.0, desktop 1.9
  if (H.cfg.glDetail) return H.cfg.glDetail;
  var weak = K.lite() || K.lvl() >= 1 || D.documentElement.classList.contains('fx-low');
  return TOUCHY ? (weak ? 1 : 1.45) : (weak ? 1.2 : 1.9);
}
function getMeshGL() { return MESH_GL || (MESH_GL = buildMesh(glDet())); }
function glUpload(M) {
  var g = GLS.g, n = M.n, i, q, vb = new Float32Array(n * 10);
  for (i = 0; i < n; i++) {
    vb[i * 10] = M.X[i]; vb[i * 10 + 1] = M.Y[i]; vb[i * 10 + 2] = M.Z[i];
    vb[i * 10 + 3] = M.GX[i]; vb[i * 10 + 4] = M.NY[i]; vb[i * 10 + 5] = M.GZ[i];
    vb[i * 10 + 6] = M.AO[i]; vb[i * 10 + 7] = M.RG[i]; vb[i * 10 + 8] = M.CX[i]; vb[i * 10 + 9] = M.CZ[i];
  }
  var big = n > 65000, TI = big ? Uint32Array : Uint16Array, idx = new TI(M.nq * 6), li = [], Q = M.Q, QF = M.QF;
  for (q = 0; q < M.nq; q++) {
    var a = Q[q * 4], b = Q[q * 4 + 1], c = Q[q * 4 + 2], d = Q[q * 4 + 3];
    idx[q * 6] = b; idx[q * 6 + 1] = c; idx[q * 6 + 2] = a;           // the LAST vertex of each triangle is the quad's first vertex, so the whole quad takes its region
    idx[q * 6 + 3] = c; idx[q * 6 + 4] = d; idx[q * 6 + 5] = a;
    if (QF[q] & 1) li.push(b, c);
    if (QF[q] & 2) li.push(d, c);
  }
  var vao = g.createVertexArray(); g.bindVertexArray(vao);
  var vbuf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, vbuf); g.bufferData(g.ARRAY_BUFFER, vb, g.STATIC_DRAW);
  var S = 40;
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 3, g.FLOAT, false, S, 0);
  g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 3, g.FLOAT, false, S, 12);
  g.enableVertexAttribArray(2); g.vertexAttribPointer(2, 1, g.FLOAT, false, S, 24);
  g.enableVertexAttribArray(3); g.vertexAttribPointer(3, 1, g.FLOAT, false, S, 28);
  g.enableVertexAttribArray(4); g.vertexAttribPointer(4, 2, g.FLOAT, false, S, 32);
  var ib = g.createBuffer(); g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ib); g.bufferData(g.ELEMENT_ARRAY_BUFFER, idx, g.STATIC_DRAW);
  var lb = g.createBuffer(); GLS.lineBuf = lb; g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, lb); g.bufferData(g.ELEMENT_ARRAY_BUFFER, new TI(li), g.STATIC_DRAW);
  g.bindVertexArray(null);
  GLS.vao = vao; GLS.triBuf = ib; GLS.nIdx = M.nq * 6; GLS.nLine = li.length; GLS.idxType = big ? g.UNSIGNED_INT : g.UNSIGNED_SHORT; GLS.M = M;
  GLS.tx = new Float32Array(n); GLS.ty = new Float32Array(n); GLS.tz = new Float32Array(n);
  /* up to 28 sample vertices per muscle region: the call-out labels average these instead of all 22 000 vertices */
  var per = {}, k; GLS.anch = [];
  for (k = 0; k <= NR; k++) per[k] = [];
  for (i = 0; i < n; i++) per[M.RG[i]].push(i);
  for (k = 0; k < NR; k++) { var all = per[k], st = Math.max(1, Math.floor(all.length / 28)), pick = []; for (i = 0; i < all.length && pick.length < 28; i += st) pick.push(all[i]); GLS.anch[k] = new Int32Array(pick); }
}

/* ---------- colours per region (cheap: 23 regions) ---------- */
function glColors(u, t) {
  var pal = palOf(u), F = GLS.f, ri, st, p, em, sel, pulse = .5 + .5 * Math.sin(t * .004), blue = u.pal === 'blue', mask = u.selMask;
  for (ri = 0; ri <= NR; ri++) {
    st = ri === NONE ? 0 : u.rs[ri]; p = pal[st] || pal[0];
    F.sh[ri * 3] = p[0][0] / 255; F.sh[ri * 3 + 1] = p[0][1] / 255; F.sh[ri * 3 + 2] = p[0][2] / 255;
    F.bo[ri * 3] = p[1][0] / 255; F.bo[ri * 3 + 1] = p[1][1] / 255; F.bo[ri * 3 + 2] = p[1][2] / 255;
    F.hi[ri * 3] = p[2][0] / 255; F.hi[ri * 3 + 1] = p[2][1] / 255; F.hi[ri * 3 + 2] = p[2][2] / 255;
    em = 0;
    if (blue) { if (st === 1) em = .16 + .07 * pulse; else if (st === 3) em = .04 * pulse; }
    else { if (st === 1) em = .13 + .06 * pulse; else if (st === 3) em = .05 * pulse; else if (st === 2) em = .06; }
    sel = (ri !== NONE && ((u.selRow >= 0 && R[ri][2] === u.selRow) || (mask && mask[R[ri][2]]))) ? 1 : 0;
    F.es[ri * 2] = em; F.es[ri * 2 + 1] = sel;
    F.mu[ri] = ri === NONE ? 1 : (u.mult[ri] || 1);
  }
}

/* ---------- camera: identical maths to the canvas version, plus a gentle tilt ---------- */
function camOf(w, h, u, mini) {
  var pitch = (mini ? .04 : .09) + (u.tilt || 0), yaw = u.yaw, F = 4.6, zoom = u.zoom || 1;
  var cam = { yaw: yaw, cyw: Math.cos(yaw), syw: Math.sin(yaw), pitch: pitch, cp: Math.cos(pitch), sp: Math.sin(pitch), F: F };
  var base = mini ? h / 2.3 : Math.min(h / 2.18, w / 1.45); cam.sc = base * zoom; cam.cx = w / 2; cam.cy = h / 2 + (mini ? 0 : h * .005);
  if (zoom > 1.05 || mini) {
    var fxr = u.fx * cam.cyw + u.fz * cam.syw, fzr = -u.fx * cam.syw + u.fz * cam.cyw, fyp = u.fy * cam.cp - fzr * cam.sp, fzp = u.fy * cam.sp + fzr * cam.cp, fk = F / (F - fzp);
    cam.cx = w / 2 - fxr * cam.sc * fk; cam.cy = h / 2 + fyp * cam.sc * fk;
  }
  cam.w = w; cam.h = h; return cam;
}
function projTo(M, u, cam, i, out) {
  var m = u.mult[M.RG[i]] || 1, x = M.X[i], z = M.Z[i], y = M.Y[i];
  if (m !== 1) { x = M.CX[i] + (x - M.CX[i]) * m; z = M.CZ[i] + (z - M.CZ[i]) * m; }
  var xr = x * cam.cyw + z * cam.syw, zr = -x * cam.syw + z * cam.cyw, yp = y * cam.cp - zr * cam.sp, zp = y * cam.sp + zr * cam.cp, k = cam.F / (cam.F - zp);
  out[0] = cam.cx + xr * cam.sc * k; out[1] = cam.cy - yp * cam.sc * k; out[2] = zp;
}
var PO = [0, 0, 0];

/* ---------- draw one view with the GPU, then the 2D extras on top ---------- */
function glFrame(s, w, h, t, cam, u, mini) {
  var g = GLS.g, dpr = s.dpr || 1, qs = s.q || 1, pw = Math.max(8, Math.round(w * dpr * qs)), ph = Math.max(8, Math.round(h * dpr * qs));
  if (pw > GLS.capW || ph > GLS.capH) {                                         // grow-only shared drawing buffer
    GLS.capW = Math.max(GLS.capW, pw, 256); GLS.capH = Math.max(GLS.capH, ph, 256); GLS.c.width = GLS.capW; GLS.c.height = GLS.capH;
  }
  g.useProgram(GLS.prog); g.bindVertexArray(GLS.vao);
  g.viewport(0, 0, pw, ph); g.enable(g.SCISSOR_TEST); g.scissor(0, 0, pw, ph);
  g.clearColor(0, 0, 0, 0); g.clearDepth(1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
  g.enable(g.DEPTH_TEST); g.depthFunc(g.LEQUAL); g.disable(g.CULL_FACE);
  glColors(u, t);
  var L = GLS.loc, F = GLS.f;
  g.uniform2f(L.uYaw, cam.cyw, cam.syw); g.uniform2f(L.uPit, cam.cp, cam.sp); g.uniform1f(L.uF, cam.F); g.uniform2f(L.uC, cam.cx, cam.cy); g.uniform1f(L.uSc, cam.sc); g.uniform2f(L.uRes, w, h);
  g.uniform1fv(L.uMult, F.mu); g.uniform3fv(L.uShade, F.sh); g.uniform3fv(L.uBody, F.bo); g.uniform3fv(L.uHigh, F.hi); g.uniform2fv(L.uES, F.es);
  var ph2 = (t % 5600) / 5600, sy = -1 + 2.04 * (ph2 < .5 ? ph2 * 2 : 2 - ph2 * 2);
  g.uniform1f(L.uPulse, .5 + .5 * Math.sin(t * .004)); g.uniform1f(L.uScan, mini ? -9 : sy); g.uniform1f(L.uDet, (s.q || 1) < .75 ? 0 : 1);
  g.uniform3f(L.uRim, .35, .89, 1.0); g.uniform1f(L.uMode, 0); g.uniform1f(L.uBias, 0);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, GLS.triBuf); g.drawElements(g.TRIANGLES, GLS.nIdx, GLS.idxType, 0);
  if (!mini && GLS.nLine) { g.uniform1f(L.uMode, 1); g.uniform1f(L.uBias, .012); g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, GLS.lineBuf); g.drawElements(g.LINES, GLS.nLine, GLS.idxType, 0); }
  g.bindVertexArray(null); g.disable(g.SCISSOR_TEST);
  return { pw: pw, ph: ph };
}

var GLOWS = [null, null];
function glowSprite(k) {                  // 0 = soft blue aura behind the body, 1 = bright floor glow under the feet (built once, 128 px)
  if (GLOWS[k]) return GLOWS[k];
  var c = D.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (k === 0) { g.addColorStop(0, rgba(C.bl, .13)); g.addColorStop(.55, rgba(C.bl, .06)); g.addColorStop(1, rgba(C.bl, 0)); }
  else { g.addColorStop(0, rgba(C.cy, .5)); g.addColorStop(.35, rgba(C.bl, .24)); g.addColorStop(1, rgba(C.bl, 0)); }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return (GLOWS[k] = c);
}
function drawMapGL(ctx, w, h, t, s) {
  var M = mstate(s), u = s.ud, mini = !!u.mini, dt = Math.min(90, t - (u.t0 || t)); u.t0 = t;
  /* motion: drag > selection tween > idle spin > inertia (time based, so 30, 60 and 120 Hz all feel the same) */
  if (!mini) {
    if (u.tgt !== undefined && u.tgt !== null) { var df = Math.atan2(Math.sin(u.tgt - u.yaw), Math.cos(u.tgt - u.yaw)); u.yaw += df * Math.min(1, dt * .008); if (Math.abs(df) < .01) u.tgt = null; }
    else if (u.spin && !s.drag && !K.lite()) u.yaw += dt * .00045;
    else if (u.idleSpin && !s.drag && !K.lite() && t - (u.userT || 0) > 2600) u.yaw += dt * .00032;
    u.vel = u.vel || 0; if (!s.drag && Math.abs(u.vel) > .00015) { u.yaw += u.vel * dt; u.vel *= Math.pow(.94, dt / 16.7); } else if (!s.drag) u.vel = 0;
    if (!s.drag && u.tilt) { u.tilt *= Math.pow(.9, dt / 16.7); if (Math.abs(u.tilt) < .002) u.tilt = 0; }
    if (u.zoomT !== undefined && u.zoomT !== null) { u.zoom += (u.zoomT - u.zoom) * Math.min(1, dt * .014); if (Math.abs(u.zoomT - u.zoom) < .004) { u.zoom = u.zoomT; u.zoomT = null; } s.dirty = true; }
    if (s.drag || Math.abs(u.vel) > .00015 || u.tgt !== null && u.tgt !== undefined || u.zoomT !== undefined && u.zoomT !== null || Math.abs(u.tilt || 0) > .001) s.dirty = true;
  }
  /* frame-time governor: if dragging drops below ~35 fps, lower the GPU render scale (the canvas overlays stay sharp) */
  if (s.drag && !mini) {
    u.ft = u.ft ? u.ft * .88 + dt * .12 : dt; u.fc = (u.fc || 0) + 1;
    if (u.fc % 18 === 0) { if (u.ft > 28 && (s.q || 1) > .55) s.q = Math.max(.55, (s.q || 1) - .1); else if (u.ft < 18 && (s.q || 1) < 1) s.q = Math.min(1, (s.q || 1) + .05); }
  } else if (!s.drag && (s.q || 1) < 1 && t - (u.userT || 0) > 700) s.q = Math.min(1, (s.q || 1) + .1);
  var cam = camOf(w, h, u, mini); u.cam = cam;
  ctx.clearRect(0, 0, w, h); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  var sprs = K.sprites(), spin = t * .0004;
  function pr(x0, y0, z0) { var xr0 = x0 * cam.cyw + z0 * cam.syw, zr0 = -x0 * cam.syw + z0 * cam.cyw, yp0 = y0 * cam.cp - zr0 * cam.sp, zp0 = y0 * cam.sp + zr0 * cam.cp, k0 = cam.F / (cam.F - zp0); PX = cam.cx + xr0 * cam.sc * k0; PY = cam.cy - yp0 * cam.sc * k0; PZ = zp0; }
  /* behind the body: aura + pedestal */
  if (!mini) {
    ctx.globalCompositeOperation = 'lighter';
    pr(0, .1, 0); var ax = PX, ay = PY, ar = cam.sc * 1.05;
    ctx.drawImage(glowSprite(0), ax - ar, ay - ar, ar * 2, ar * 2);                       // v3: pre-rendered glow (a canvas-wide gradient fill every frame was the most expensive overlay)
    pr(0, -1.01, 0); ctx.save(); ctx.translate(PX, PY); ctx.scale(1, .26);
    var fr = cam.sc * .95; ctx.drawImage(glowSprite(1), -fr, -fr, fr * 2, fr * 2); ctx.restore();
    ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(C.cy, .75); ctx.beginPath(); ringPath(ctx, pr, -1.01, .5, 0, TAU, 60); ctx.stroke();
    ctx.lineWidth = 1; ctx.setLineDash([2, 6]); ctx.lineDashOffset = -t * .012; ctx.strokeStyle = rgba(C.pale, .5); ctx.beginPath(); ringPath(ctx, pr, -1.01, .66, 0, TAU, 64); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.bl, .85);
    for (var i = 0; i < 4; i++) { ctx.beginPath(); ringPath(ctx, pr, -1.01, .82, spin + i * TAU / 4, spin + i * TAU / 4 + .9, 16); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .3); ctx.beginPath(); ringPath(ctx, pr, -1.01, .96, 0, TAU, 72); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .16);                       // outer tick ring, slowly counter-rotating
    for (i = 0; i < 48; i++) { var ta = -spin * .6 + i * TAU / 48; pr(Math.cos(ta) * 1.04, -1.01, Math.sin(ta) * 1.04); var tx0 = PX, ty0 = PY; pr(Math.cos(ta) * (i % 4 ? 1.07 : 1.1), -1.01, Math.sin(ta) * (i % 4 ? 1.07 : 1.1)); ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.lineTo(PX, PY); ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
  }
  /* the body itself */
  var r = glFrame(s, w, h, t, cam, u, mini);
  ctx.drawImage(GLS.c, 0, GLS.c.height - r.ph, r.pw, r.ph, 0, 0, w, h);
  /* in front of the body: scan ring, call-outs */
  if (!mini) {
    ctx.globalCompositeOperation = 'lighter';
    var ph2 = (t % 5600) / 5600, sy = -1 + 2.04 * (ph2 < .5 ? ph2 * 2 : 2 - ph2 * 2);
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(C.cy, .55); ctx.beginPath(); ringPath(ctx, pr, sy, .4, 0, TAU, 40); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.cy, .06); ctx.beginPath(); ringPath(ctx, pr, sy, .4, 0, TAU, 40); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    if (w > 560 && (u.zoom || 1) <= 1.3 && !u.noLabels) glLabels(ctx, w, h, u, cam, M);
  }
  s.glDone = true;
}

/* call-outs: a short leader line from each muscle to a label in the margin (same look as the reference design) */
function glLabels(ctx, w, h, u, cam, M) {
  var face = cam.cyw >= 0, labs = face ? LABELS_F : LABELS_B, items = [], rs = u.rs, stc = stcOf(u), i, j, k, v, sx, sy, n, sxl, syl, nl, nzr, ax, ay, a3;
  for (i = 0; i < labs.length; i++) {
    var L = labs[i], ri = RI[L[0]], an = GLS.anch[ri]; if (!an) continue;
    sx = sy = n = sxl = syl = nl = 0;
    for (j = 0; j < an.length; j++) {
      k = an[j]; v = k; projTo(GLS.M, u, cam, v, PO);
      nzr = -GLS.M.GX[v] * cam.syw + GLS.M.GZ[v] * cam.cyw; if (nzr <= .25) continue;
      sx += PO[0]; sy += PO[1]; n++; if (PO[0] < w / 2) { sxl += PO[0]; syl += PO[1]; nl++; }
    }
    if (n < 3) continue;
    var side = L[2], axx, ayy;
    if (side === 'L' && nl > 2) { axx = sxl / nl; ayy = syl / nl; } else if (side === 'R' && n - nl > 2) { axx = (sx - sxl) / (n - nl); ayy = (sy - syl) / (n - nl); } else { axx = sx / n; ayy = sy / n; }
    items.push({ L: L, ax: axx, ay: ayy, left: side === 'L' ? true : side === 'R' ? false : axx < w / 2 });
  }
  [true, false].forEach(function (isLeft) {
    var col = items.filter(function (o) { return o.left === isLeft; }).sort(function (p, q) { return p.ay - q.ay; }), last = -1e9;
    col.forEach(function (o) {
      var ly = Math.max(o.ay, last + 34); ly = Math.min(ly, h - 30); last = ly; var lx = isLeft ? 14 : w - 14, ri2 = RI[o.L[0]], stt = rs[ri2], cc = stc[stt] || stc[0], tx = isLeft ? lx + 96 : lx - 96;
      ctx.strokeStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(tx + (isLeft ? 10 : -10), ly - 6); ctx.lineTo(tx, ly - 6); ctx.stroke();
      ctx.fillStyle = rgbS(cc, .95); ctx.beginPath(); ctx.arc(o.ax, o.ay, 2.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(o.ax, o.ay, 5.5, 0, TAU); ctx.strokeStyle = rgbS(cc, .35); ctx.stroke();
      ctx.textAlign = isLeft ? 'left' : 'right';
      ctx.font = '600 11.5px "Chakra Petch",monospace'; ctx.fillStyle = 'rgba(225,242,255,.95)'; ctx.fillText(o.L[1], lx, ly - 8);
      ctx.font = '500 10px "IBM Plex Sans",sans-serif'; ctx.fillStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',.95)'; ctx.fillText(u.labelTxt ? u.labelTxt(ri2) : ST_NAME[stt], lx, ly + 5);
    });
  });
}

/* tap picking on the GPU mesh: project everything the way the shader does, then the nearest triangle under the finger wins */
function pickGL(s, mx, my) {
  var u = s.ud, M = GLS.M, cam = u.cam; if (!M || !cam) return -1;
  var n = M.n, tx = GLS.tx, ty = GLS.ty, tz = GLS.tz, i, q, Q = M.Q, best = -1, bz = -1e9;
  for (i = 0; i < n; i++) { projTo(M, u, cam, i, PO); tx[i] = PO[0]; ty[i] = PO[1]; tz[i] = PO[2]; }
  function tri(a, b, c, rg) {
    var minx = Math.min(tx[a], tx[b], tx[c]); if (mx < minx) return; var maxx = Math.max(tx[a], tx[b], tx[c]); if (mx > maxx) return;
    var miny = Math.min(ty[a], ty[b], ty[c]); if (my < miny) return; var maxy = Math.max(ty[a], ty[b], ty[c]); if (my > maxy) return;
    var d = (ty[b] - ty[c]) * (tx[a] - tx[c]) + (tx[c] - tx[b]) * (ty[a] - ty[c]); if (!d) return;
    var l1 = ((ty[b] - ty[c]) * (mx - tx[c]) + (tx[c] - tx[b]) * (my - ty[c])) / d, l2 = ((ty[c] - ty[a]) * (mx - tx[c]) + (tx[a] - tx[c]) * (my - ty[c])) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) return;
    var z = l1 * tz[a] + l2 * tz[b] + l3 * tz[c]; if (z > bz) { bz = z; best = rg; }
  }
  for (q = 0; q < M.nq; q++) { var a = Q[q * 4], b = Q[q * 4 + 1], c = Q[q * 4 + 2], d = Q[q * 4 + 3], rg = M.RG[a]; tri(b, c, a, rg); tri(c, d, a, rg); }
  return best;
}

/* ---------- one entry point for every view: GPU when available, canvas otherwise ---------- */
function drawMapAuto(ctx, w, h, t, s) {
  var ok = false;
  try { ok = glInit(); } catch (e) { ok = false; }
  if (ok && !GLS.lost && GLS.vao) {
    try { return drawMapGL(ctx, w, h, t, s); } catch (e) { if (W.console) console.warn('muscle map GPU frame failed, using canvas', e); GLS.ok = false; }
  }
  /* canvas fallback: drop to the light mesh while the finger is down on a touch screen */
  s.ud.fast = !!(s.drag && (TOUCHY || (s.ud.ft && s.ud.ft > 30)));
  if (s.drag) { var dtt = Math.min(90, t - (s.ud.t0 || t)); s.ud.ft = s.ud.ft ? s.ud.ft * .88 + dtt * .12 : dtt; }
  return drawMap(ctx, w, h, t, s);
}
function pickAuto(s, mx, my) { return (GLS.ok && !GLS.lost && GLS.vao && s.glDone) ? pickGL(s, mx, my) : pickQuad(s, mx, my); }

/* ================= CSS ================= */
function css() {
  if (D.getElementById('mm-css')) return;
  var s = D.createElement('style'); s.id = 'mm-css';
  s.textContent = [
    '.mm{container-type:inline-size;color:#cfe6ff;font-family:"IBM Plex Sans",sans-serif}',
    '.mm-cols{display:grid;gap:12px;grid-template-columns:1fr}',
    '.mm-col{display:grid;gap:12px;align-content:start;min-width:0}',
    '.mm-center{order:-1;min-width:0;display:grid;gap:12px;align-content:start}',
    '.mm-p{position:relative;border:1px solid rgba(96,200,255,.24);border-radius:6px;background:linear-gradient(165deg,rgba(30,90,170,.16),rgba(3,10,24,.86) 60%);padding:12px;overflow:hidden}',
    '.mm-p::before{content:"";position:absolute;left:0;top:0;width:12px;height:12px;border-left:2px solid rgba(96,226,255,.9);border-top:2px solid rgba(96,226,255,.9)}',
    '.mm-h{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:9px;font:700 12px/1.1 "Chakra Petch",monospace;letter-spacing:.14em;color:#e6f6ff;text-transform:uppercase}',
    '.mm-h small{display:block;margin-top:4px;font:600 9.5px "Chakra Petch",monospace;letter-spacing:.1em;color:#63d4ff}',
    '.mm-date{text-align:right;font:600 11px "Chakra Petch",monospace;letter-spacing:.06em;color:#cfe6ff}',
    '.mm-date i{display:block;font-style:normal;color:#7fa6c9;font-size:9.5px}',
    '.mm-nav{appearance:none;border:1px solid rgba(96,200,255,.3);background:transparent;color:#cfe6ff;border-radius:3px;width:24px;height:22px;cursor:pointer;font:700 13px sans-serif;margin:0 2px}',
    '.mm-split{display:grid;grid-template-columns:1fr;gap:10px}',
    '@container (min-width:520px){.mm-split.lg{grid-template-columns:1fr 150px}}',
    '.mm-rows{display:grid;gap:1px}',
    '.mm-row{appearance:none;background:transparent;border:0;border-bottom:1px solid rgba(96,200,255,.1);color:#cfe6ff;display:grid;grid-template-columns:14px 1fr 38px 56px 38px;gap:8px;align-items:center;padding:6px 4px;font:500 12.5px "IBM Plex Sans",sans-serif;cursor:pointer;text-align:left;min-height:30px}',
    '.mm-row:hover,.mm-row.on{background:rgba(64,146,255,.16)}',
    '.mm-row .dot{width:12px;height:12px;border-radius:50%}',
    '.mm-row .num{font:600 11.5px "Chakra Petch",monospace;color:#9fc4e6;text-align:right}',
    '.mm-row .pc{font:700 11px "Chakra Petch",monospace;text-align:right}',
    '.mm-trk{height:5px;border-radius:3px;background:rgba(96,200,255,.14);overflow:hidden}',
    '.mm-trk u{display:block;height:100%;border-radius:3px;transition:width .7s cubic-bezier(.2,.8,.2,1)}',
    '.mm-leg{display:grid;gap:7px;align-content:start;border:1px solid rgba(96,200,255,.18);background:rgba(4,12,28,.6);border-radius:4px;padding:10px;font:600 10px/1.25 "Chakra Petch",monospace;letter-spacing:.04em;color:#cfe6ff}',
    '.mm-leg span{display:grid;grid-template-columns:14px 1fr;gap:7px;align-items:center}',
    '.mm-leg i{width:12px;height:12px;border-radius:50%}',
    '.mm-leg em{display:block;font-style:normal;color:#7fa6c9;font-weight:500}',
    '.mm-stage{position:relative;border:1px solid rgba(96,200,255,.24);border-radius:6px;background:radial-gradient(70% 55% at 50% 48%,rgba(30,100,200,.26),rgba(2,8,20,0) 70%),linear-gradient(180deg,#06142c,#020912);overflow:hidden}',
    '.mm-body{position:relative;width:100%;height:min(135vw,680px)}',
    '@container (min-width:760px){.mm-body{height:min(72vw,700px)}}',
    '@container (min-width:1100px){.mm-body{height:min(82vh,780px)}}',
    '.mm-body .hl-cv{position:absolute;inset:0;width:100%;height:100%;cursor:grab}',
    '.mm-ctl{position:absolute;left:10px;top:10px;display:flex;gap:5px;flex-wrap:wrap;z-index:2}',
    '.mm-ctl button{appearance:none;border:1px solid rgba(96,200,255,.32);background:rgba(4,14,32,.8);color:#cfe6ff;border-radius:3px;font:700 10px "Chakra Petch",monospace;letter-spacing:.08em;padding:0 9px;min-height:28px;cursor:pointer}',
    '.mm-ctl button.on{background:rgba(64,146,255,.5);color:#fff;border-color:#bfe6ff}',
    '.mm-hint{position:absolute;left:12px;bottom:10px;font:600 9.5px "Chakra Petch",monospace;letter-spacing:.1em;color:rgba(160,205,245,.7);pointer-events:none}',
    '.mm-tag{position:absolute;right:12px;bottom:10px;font:700 10.5px "Chakra Petch",monospace;letter-spacing:.06em;color:#7dffb0;text-align:right;pointer-events:none}',
    '.mm-banner{position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:5px 12px;border:1px solid rgba(96,200,255,.4);background:rgba(4,14,32,.85);font:700 10.5px "Chakra Petch",monospace;letter-spacing:.12em;color:#cfe6ff;white-space:nowrap;pointer-events:none;z-index:2}',
    '.mm-big{font:700 22px "Chakra Petch",monospace;color:#fff}',
    '.mm-kv{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:5px 0;font:600 11.5px "Chakra Petch",monospace;color:#9fc4e6}',
    '.mm-kv b{color:#fff;font-size:13px}',
    '.mm-ex{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:7px 8px;margin-top:6px;border:1px solid rgba(96,200,255,.16);background:rgba(4,14,32,.55);border-radius:4px;font:500 12px "IBM Plex Sans",sans-serif}',
    '.mm-ex small{display:block;color:#7fa6c9;font:500 10.5px "IBM Plex Sans",sans-serif}',
    '.mm-ex .ck{width:10px;height:10px;border-radius:50%}',
    '.mm-focus{position:relative;height:190px;border:1px solid rgba(96,200,255,.18);border-radius:4px;background:radial-gradient(circle at 50% 50%,rgba(30,100,200,.22),rgba(2,8,20,.6) 70%);overflow:hidden}',
    '.mm-parts{display:grid;gap:6px;margin-top:9px}',
    '.mm-part{display:flex;justify-content:space-between;gap:8px;font:500 12px "IBM Plex Sans",sans-serif;padding:5px 8px;border-left:2px solid;background:rgba(4,14,32,.5)}',
    '.mm-part b{font:700 10.5px "Chakra Petch",monospace;letter-spacing:.08em}',
    '.mm-note{margin-top:8px;font:500 11.5px/1.5 "IBM Plex Sans",sans-serif;color:#9fc4e6}',
    '.mm-note b{color:#fff}',
    '.mm-svg{width:100%;height:140px;display:block}',
    '.mm-gl{display:grid;gap:6px}',
    '.mm-g{display:grid;grid-template-columns:86px 1fr 46px;gap:8px;align-items:center;font:600 11px "Chakra Petch",monospace;color:#cfe6ff}',
    '.mm-g b{text-align:right;color:#7dffb0}',
    '.mm-g.lock b{color:#7fa6c9}',
    '.mm-days{display:flex;gap:5px;margin-top:6px}',
    '.mm-days i{flex:1;height:22px;border-radius:3px;display:grid;place-items:center;font:700 9px "Chakra Petch",monospace;font-style:normal;color:#021;background:rgba(96,200,255,.12)}',
    '.mm-ring{display:grid;grid-template-columns:92px 1fr;gap:12px;align-items:center}',
    '.mm-ring svg{width:92px;height:92px;display:block}',
    '.mm-ring text{font:700 19px "Chakra Petch",monospace;fill:#fff}',
    '.mm-two{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center}',
    '.mm-mini{position:relative;height:150px;border:1px solid rgba(96,200,255,.16);border-radius:4px;background:rgba(2,8,20,.5)}',
    '.mm-small{font:500 10.5px/1.45 "IBM Plex Sans",sans-serif;color:#7fa6c9;margin-top:6px}',
    '@container (min-width:760px){.mm-cols{grid-template-columns:1fr 1fr}.mm-center{grid-column:1/-1}}',
    '@container (min-width:1100px){.mm-cols{grid-template-columns:minmax(260px,.9fr) minmax(430px,1.55fr) minmax(260px,.95fr);align-items:start}.mm-center{grid-column:auto;order:0}}',
    /* ---------- v3 polish: white-blue HUD refinements. Appended last so it refines the rules above ---------- */
    '@keyframes mmIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
    '.mm *{scrollbar-width:thin;scrollbar-color:rgba(120,200,255,.4) transparent}',
    '.mm-p{box-shadow:inset 0 0 0 1px rgba(150,215,255,.04),0 10px 30px rgba(0,0,0,.35);transition:border-color .25s,box-shadow .25s;animation:mmIn .55s cubic-bezier(.2,.8,.2,1) both}',
    '.mm-col>.mm-p:nth-child(2){animation-delay:.06s}.mm-col>.mm-p:nth-child(3){animation-delay:.12s}.mm-col>.mm-p:nth-child(4){animation-delay:.18s}.mm-col>.mm-p:nth-child(5){animation-delay:.24s}.mm-col>.mm-p:nth-child(n+6){animation-delay:.3s}',
    '.mm-p:hover{border-color:rgba(140,220,255,.44);box-shadow:inset 0 0 0 1px rgba(150,215,255,.08),0 12px 34px rgba(0,0,0,.4),0 0 22px rgba(80,170,255,.1)}',
    '.mm-p::after{content:"";position:absolute;right:0;bottom:0;width:12px;height:12px;border-right:2px solid rgba(96,226,255,.5);border-bottom:2px solid rgba(96,226,255,.5);pointer-events:none}',
    '.mm-h{text-shadow:0 0 12px rgba(120,210,255,.28)}',
    '.mm-big{text-shadow:0 0 14px rgba(150,220,255,.5);font-variant-numeric:tabular-nums}',
    '.mm-kv b,.mm-row .num,.mm-row .pc{font-variant-numeric:tabular-nums}',
    '.mm-row{border-radius:3px;transition:background .18s,transform .15s}',
    '.mm-row:hover{background:rgba(110,190,255,.14)}',
    '.mm-row.on{background:linear-gradient(90deg,rgba(110,190,255,.28),rgba(110,190,255,.05));box-shadow:inset 2px 0 0 #bfe8ff}',
    '.mm-row:active{transform:scale(.995)}',
    '.mm-row:focus-visible,.mm-ctl button:focus-visible,.mm-nav:focus-visible{outline:2px solid #bfe8ff;outline-offset:1px}',
    '.mm-trk{background:rgba(120,200,255,.12);box-shadow:inset 0 0 0 1px rgba(150,215,255,.06)}',
    '.mm-leg{background:linear-gradient(180deg,rgba(10,30,60,.7),rgba(4,12,28,.7))}',
    '@container (min-width:1100px){.mm-split.lg{grid-template-columns:1fr}.mm-leg{grid-template-columns:1fr 1fr;gap:8px 10px}}',
    '@container (max-width:560px){.mm-hint{bottom:34px}.mm-tag{left:12px;right:auto;text-align:left}.mm-p{padding:11px}.mm-cols{gap:10px}}',
    '.mm-stage{box-shadow:inset 0 0 60px rgba(40,120,220,.12),0 12px 36px rgba(0,0,0,.4)}',
    '.mm-stage::before,.mm-stage::after{content:"";position:absolute;width:16px;height:16px;pointer-events:none;z-index:2;border:2px solid rgba(140,225,255,.7)}',
    '.mm-stage::before{left:6px;bottom:6px;border-right:0;border-top:0}.mm-stage::after{right:6px;top:6px;border-left:0;border-bottom:0}',
    '.mm-ctl button{transition:background .15s,border-color .15s,transform .12s}',
    '.mm-ctl button:hover{background:rgba(64,146,255,.28);border-color:#bfe6ff}.mm-ctl button:active{transform:scale(.96)}',
    '.mm-ctl button.on{box-shadow:0 0 14px rgba(120,200,255,.45)}',
    /* v4: on a phone the toolbar wraps to two rows; put it above the body instead of on top of the head */
    '@container (max-width:560px){.mm-ctl{position:relative;left:auto;top:auto;padding:8px 8px 0;gap:4px}.mm-ctl button{flex:1 1 auto;min-height:32px}}',
    '.mm-body .hl-cv{touch-action:pan-y;-webkit-tap-highlight-color:transparent;outline:none}',
    '.mm-body .hl-cv:active{cursor:grabbing}',
    '.mm-hint{text-shadow:0 0 8px #020912}',
    '@media (pointer:coarse){.mm-ctl button{min-height:36px;padding:0 12px}.mm-nav{width:32px;height:30px}.mm-row{min-height:36px}}',
    'html.fx-lite .mm-p,html.fx-mid .mm-p{animation:none}',
    '@media (prefers-reduced-motion:reduce){.mm-p{animation:none}.mm-p,.mm-row,.mm-ctl button{transition:none}}'
  ].join('\n');
  (D.head || D.documentElement).appendChild(s);
}

/* ================= UI ================= */
var MAPUI = null;
function rgbS(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }
function dayLabel(iso) { var d = parseISO(iso); return d.getDate() + ' ' + K.MONS[d.getMonth()] + ' ' + d.getFullYear(); }
function dowName(iso) { return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][parseISO(iso).getDay()]; }

function shell() {
  return '<div class="mm"><div class="mm-cols">' +
    '<div class="mm-col mm-L">' +
      '<div class="mm-p"><div class="mm-h"><div>Today\'s muscle map<small id="mm-sub">REAL-TIME TRAINING ANALYSIS</small></div><div class="mm-date"><span><button class="mm-nav" id="mm-prev">‹</button><button class="mm-nav" id="mm-next">›</button></span><span id="mm-dl"></span><i id="mm-dw"></i></div></div>' +
        '<div class="mm-split lg"><div class="mm-rows" id="mm-rows"></div><div class="mm-leg"><span><i style="background:#46ff8c"></i><div>TRAINED<em>2+ valid sets</em></div></span><span><i style="background:#bfe8ff"></i><div>PARTIAL<em>1 set / light work</em></div></span><span><i style="background:#ff504e"></i><div>NOT TRAINED<em>planned, not hit</em></div></span><span><i style="background:#60aaff"></i><div>OTHER MUSCLES</div></span></div></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Exercise coverage<small>PLANNED EXERCISES DONE</small></div><div class="mm-big" id="mm-cov">0/0</div></div><div class="mm-trk"><u id="mm-covb" style="width:0;background:#4fb4ff"></u></div><div id="mm-exl"></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Muscle group status</div></div><div class="mm-two"><div class="mm-mini" id="mm-back"></div><div><div class="mm-kv"><span>Trained today</span><b id="mm-s1">0</b></div><div class="mm-kv"><span>Partial</span><b id="mm-s2">0</b></div><div class="mm-kv"><span>Not trained</span><b id="mm-s3">0</b></div><div class="mm-kv"><span>Total groups</span><b>11</b></div></div></div>' +
        '<div class="mm-ring" style="margin-top:8px"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(96,200,255,.14)" stroke-width="8"/><circle id="mm-arc" cx="50" cy="50" r="40" fill="none" stroke="#46ff8c" stroke-width="8" stroke-linecap="round" transform="rotate(-90 50 50)" style="stroke-dasharray:251.3;stroke-dashoffset:251.3;transition:stroke-dashoffset 1s;filter:drop-shadow(0 0 5px #46ff8c)"/><text x="50" y="57" text-anchor="middle" id="mm-covp">0%</text></svg><div class="mm-small" style="margin:0">PLAN COVERAGE<br>muscles hit vs. muscles in today\'s split</div></div></div>' +
    '</div>' +
    '<div class="mm-center"><div class="mm-stage"><div class="mm-ctl"><button data-a="front">FRONT</button><button data-a="back">BACK</button><button data-a="spin">SPIN</button><button data-a="rec" title="Recovery view: colours each muscle sore, recovering or ready from days since it was last trained">RECOVERY</button><button data-a="zi">＋</button><button data-a="zo">－</button><button data-a="demo" title="Shows the size change ×10 so you can see it">SIZE DEMO ×10</button></div><div class="mm-banner" id="mm-ban" style="display:none"></div><div class="mm-body" id="mm-body"></div><div class="mm-hint">DRAG TO ROTATE · TAP A MUSCLE · CTRL+WHEEL TO ZOOM</div><div class="mm-tag" id="mm-tag"></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Estimated size change<small id="mm-gsub"></small></div><div class="mm-big" id="mm-gbig">+0%</div></div><div class="mm-days" id="mm-qd"></div><div class="mm-gl" id="mm-gl" style="margin-top:10px"></div><div class="mm-small" id="mm-gnote"></div></div></div>' +
    '<div class="mm-col mm-R">' +
      '<div class="mm-p"><div class="mm-h"><div>Selected muscle</div></div><div id="mm-selh" class="mm-big" style="font-size:17px">Tap a muscle</div><div class="mm-focus" id="mm-focus" style="margin-top:8px"></div><div class="mm-parts" id="mm-parts"></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Training details</div></div><div id="mm-det"></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Long-term trend<small>MUSCLE SIZE (ESTIMATED CHANGE)</small></div><div class="mm-big" id="mm-tbig" style="color:#7dffb0">+0%</div></div><svg class="mm-svg" id="mm-svg" viewBox="0 0 300 140" preserveAspectRatio="none"></svg><div class="mm-note" id="mm-tnote"></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Sets completed</div></div><div class="mm-kv"><span>On this day</span><b id="mm-sd">0</b></div><div class="mm-trk"><u id="mm-sdb" style="width:0;background:#4fb4ff"></u></div><div class="mm-kv" style="margin-top:6px"><span>This week</span><b id="mm-sw">0 / 70</b></div><div class="mm-trk"><u id="mm-swb" style="width:0;background:#4fb4ff"></u></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Recovery &amp; sleep</div><small style="font:600 9px \'Chakra Petch\';color:#63d4ff">FROM YOUR HABITS</small></div><div class="mm-kv"><span>7–9h sleep habit · last 7 days</span><b id="mm-sl">0/7</b></div><div class="mm-days" id="mm-sld"></div><div class="mm-kv" style="margin-top:6px"><span>Recovery readiness</span><b id="mm-rec">0</b></div><div class="mm-trk"><u id="mm-recb" style="width:0;background:#7dffb0"></u></div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Nutrition habits</div></div><div class="mm-kv"><span>💧 Water target · 7 days</span><b id="mm-wa">0/7</b></div><div class="mm-days" id="mm-wad"></div><div class="mm-kv" style="margin-top:6px"><span>🍎 Fruit daily · 7 days</span><b id="mm-fr">0/7</b></div><div class="mm-days" id="mm-frd"></div><div class="mm-small">Calories and protein are not tracked in the app, so food = your Water and Fruit habits.</div></div>' +
      '<div class="mm-p"><div class="mm-h"><div>Weekly overview</div></div><div class="mm-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(96,200,255,.14)" stroke-width="8"/><circle id="mm-warc" cx="50" cy="50" r="40" fill="none" stroke="#4fb4ff" stroke-width="8" stroke-linecap="round" transform="rotate(-90 50 50)" style="stroke-dasharray:251.3;stroke-dashoffset:251.3;transition:stroke-dashoffset 1s"/><text x="50" y="57" text-anchor="middle" id="mm-wp">0%</text></svg><div id="mm-wk"></div></div></div>' +
    '</div></div></div>';
}
function dots(el, arr, col) { el.innerHTML = arr.map(function (v, i) { return '<i style="' + (v ? 'background:' + col + ';box-shadow:0 0 8px ' + col : '') + '">' + (v ? '✓' : '') + '</i>'; }).join(''); }
function last7(fn) { var today = isoDate(new Date()), a = []; for (var i = 6; i >= 0; i--) a.push(fn(gymAddDays(today, -i))); return a; }
function sum(a) { return a.reduce(function (p, c) { return p + (c ? 1 : 0); }, 0); }

function render(M) {
  ST_NAME[0] = M.rec ? 'No data' : 'Other'; ST_NAME[1] = M.rec ? 'Ready' : 'Trained'; ST_NAME[2] = M.rec ? 'Recovering' : 'Partial'; ST_NAME[3] = M.rec ? 'Sore' : 'Not trained';
  var root = M.root, st = M.st = dayState(M.iso, M.rec), gr = M.gr = growth(true), body = M.body.ud;
  var leg = root.querySelector('.mm-leg'); if (leg) { if (!M.legT) M.legT = leg.innerHTML; leg.innerHTML = M.rec ? RECLEG : M.legT; }
  var rb = root.querySelector('[data-a="rec"]'); if (rb) rb.classList.toggle('on', !!M.rec);
  /* colours + size multipliers to the 3D views */
  [M.body, M.focus, M.back].forEach(function (s) { var u = s.ud; mstate(s); u.rs.set(st.rs); for (var i = 0; i < NR; i++) { var pct = gr.per[ROWS[R[i][2]][0]] || 0; if (M.demo) pct = Math.max(pct, CFG.maxPct) * CFG.demoMult; u.mult[i] = 1 + pct / 100; } u.labelTxt = function (ri) { return ST_NAME[st.rs[ri]]; }; s.invalidate(); });
  root.querySelector('#mm-dl').textContent = dayLabel(M.iso); root.querySelector('#mm-dw').textContent = dowName(M.iso);
  var ban = root.querySelector('#mm-ban');
  if (st.future) { ban.style.display = ''; ban.textContent = 'SCHEDULED · NOT TRAINED YET'; }
  else if (st.rest && !st.exs.length) { ban.style.display = ''; ban.textContent = 'REST DAY · NOTHING PLANNED'; }
  else if (!st.exs.length) { ban.style.display = ''; ban.textContent = (st.plan && st.plan.short ? st.plan.short.toUpperCase() + ' DAY' : 'WORKOUT DAY') + ' · NOTHING LOGGED YET'; }
  else ban.style.display = 'none';
  if (M.rec) { ban.style.display = ''; ban.textContent = 'RECOVERY VIEW · sore, recovering or ready, from days since each muscle was last trained'; }
  root.querySelector('#mm-sub').textContent = (st.isToday ? 'REAL-TIME ' : '') + 'TRAINING ANALYSIS' + (st.plan && st.plan.type === 'workout' ? ' · ' + String(st.plan.title || '').replace(/^\S+\s/, '').toUpperCase() : '');
  if (M.rec) root.querySelector('#mm-sub').textContent = 'RECOVERY ANALYSIS';
  /* 11 muscle rows */
  root.querySelector('#mm-rows').innerHTML = st.rowSt.map(function (r, i) {
    var c = STC[r.state], pc = r.planned ? Math.round(r.frac * 100) : (r.done ? 100 : 0), val = r.planned ? r.done + ' / ' + r.planned : (r.done ? r.done + ' / –' : '– / –');
    if (st.rec) { var dm = 99; r.regs.forEach(function (k) { if (st.recDays[k] < dm) dm = st.recDays[k]; }); val = dm >= 99 ? 'rested' : dm === 0 ? 'today' : dm + 'd ago'; pc = r.state === 3 ? 25 : r.state === 2 ? 60 : 100; }
    return '<button class="mm-row' + (M.selRow === i ? ' on' : '') + '" data-r="' + i + '"><span class="dot" style="background:' + rgbS(c) + ';box-shadow:0 0 9px ' + rgbS(c, .7) + (r.state ? '' : ';opacity:.55') + '"></span><span>' + r.name + '</span><span class="num">' + val + '</span><span class="mm-trk"><u style="width:' + pc + '%;background:' + rgbS(c) + '"></u></span><span class="pc" style="color:' + rgbS(c) + '">' + (st.rec ? ['', 'READY', 'RECOV.', 'SORE'][r.state] : (r.state === 0 && !r.done ? '0%' : pc + '%')) + '</span></button>';
  }).join('');
  /* coverage + exercise list */
  var pl = st.planned.length, done = st.exs.filter(function (e) { return e.ok; }).length;
  root.querySelector('#mm-cov').textContent = done + '/' + Math.max(pl, st.exs.length); root.querySelector('#mm-covb').style.width = Math.round(100 * done / Math.max(1, pl || st.exs.length)) + '%';
  root.querySelector('#mm-exl').innerHTML = st.exs.length ? st.exs.map(function (e) { return '<div class="mm-ex"><div>' + esc(e.name) + '<small>' + e.sets + ' set' + (e.sets > 1 ? 's' : '') + ' · ' + e.reps + ' reps</small></div><span class="ck" style="background:' + (e.ok ? '#46ff8c' : '#bfe8ff') + ';box-shadow:0 0 8px ' + (e.ok ? '#46ff8c' : '#bfe8ff') + '"></span></div>'; }).join('') : '<div class="mm-small">No sets logged for this day.</div>';
  var cnt = [0, 0, 0, 0]; st.rowSt.forEach(function (r) { cnt[r.state]++; });
  [['#mm-s1', 'Ready', 'Trained today'], ['#mm-s2', 'Recovering', 'Partial'], ['#mm-s3', 'Sore', 'Not trained']].forEach(function (x) { var b = root.querySelector(x[0]), lb = b && b.previousElementSibling; if (lb) lb.textContent = M.rec ? x[1] : x[2]; });
  root.querySelector('#mm-s1').textContent = cnt[1]; root.querySelector('#mm-s2').textContent = cnt[2]; root.querySelector('#mm-s3').textContent = cnt[3];
  var denom = cnt[1] + cnt[2] + cnt[3], cov = denom ? (cnt[1] + cnt[2] * .5) / denom : 0;
  root.querySelector('#mm-covp').textContent = Math.round(cov * 100) + '%'; requestAnimationFrame(function () { root.querySelector('#mm-arc').style.strokeDashoffset = String(251.3 * (1 - cov)); });
  /* sets + weekly */
  var d0 = K.getData(true), wkSets = d0.wk.sets, wkT = 0; K.GROUPS.forEach(function (g) { wkT += K.TARGET[g] || 10; });
  root.querySelector('#mm-sd').textContent = st.sets + ' sets · ' + st.exs.length + ' exercises'; root.querySelector('#mm-sdb').style.width = Math.min(100, Math.round(100 * done / Math.max(1, pl || st.exs.length || 1))) + '%';
  root.querySelector('#mm-sw').textContent = wkSets + ' / ' + wkT; root.querySelector('#mm-swb').style.width = Math.min(100, Math.round(100 * wkSets / wkT)) + '%';
  var rWk = d0.wk.sched ? d0.wk.done / d0.wk.sched : 0; root.querySelector('#mm-wp').textContent = Math.round(rWk * 100) + '%'; requestAnimationFrame(function () { root.querySelector('#mm-warc').style.strokeDashoffset = String(251.3 * (1 - clamp(rWk, 0, 1))); });
  root.querySelector('#mm-wk').innerHTML = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core', 'Legs'].map(function (g) { var o = d0.g[g]; return '<div class="mm-kv" style="padding:3px 0"><span>' + g + '</span><b style="font-size:12px">' + (o ? o.wk : 0) + '/' + (o ? o.target : 10) + '</b></div>'; }).join('');
  /* sleep + food habits, last 7 days */
  var sl = last7(function (i) { return habitDone(i, CFG.sleepHabit); }), wa = last7(function (i) { return habitDone(i, 'water'); }), fr = last7(function (i) { return habitDone(i, 'fruit'); });
  dots(root.querySelector('#mm-sld'), sl, '#7dffb0'); dots(root.querySelector('#mm-wad'), wa, '#4fb4ff'); dots(root.querySelector('#mm-frd'), fr, '#9fd8ff');
  root.querySelector('#mm-sl').textContent = sum(sl) + '/7'; root.querySelector('#mm-wa').textContent = sum(wa) + '/7'; root.querySelector('#mm-fr').textContent = sum(fr) + '/7';
  var rec = Math.round(100 * (sum(sl) + sum(wa) + sum(fr)) / 21); root.querySelector('#mm-rec').textContent = rec + '%'; root.querySelector('#mm-recb').style.width = rec + '%';
  /* growth */
  var big = Math.round(gr.base * 10) / 10;
  root.querySelector('#mm-gbig').textContent = '+' + big.toFixed(1) + '%'; root.querySelector('#mm-tbig').textContent = '+' + big.toFixed(1) + '%';
  root.querySelector('#mm-gsub').textContent = gr.eligible ? 'UNLOCKED · ' + gr.n + ' QUALIFIED DAYS' : 'LOCKED · ' + gr.n + ' / ' + CFG.minDays + ' QUALIFIED DAYS';
  var qd = root.querySelector('#mm-qd'), recent = gr.days.slice(-14); qd.innerHTML = recent.map(function (x, i) { var q = false; try { q = (function (iso) { return habitDone(iso, CFG.sleepHabit) && CFG.foodHabits.every(function (h) { return habitDone(iso, h); }) && x[2]; })(x[0]); } catch (e) { } return '<i title="' + x[0] + '" style="' + (q ? 'background:#46ff8c;box-shadow:0 0 8px #46ff8c' : (x[2] ? 'background:rgba(150,212,255,.45)' : '')) + '">' + parseISO(x[0]).getDate() + '</i>'; }).join('');
  root.querySelector('#mm-gl').innerHTML = ROWS.map(function (r) { var p = gr.per[r[0]] || 0; return '<div class="mm-g' + (gr.eligible ? '' : ' lock') + '"><span>' + r[0] + '</span><div class="mm-trk"><u style="width:' + Math.round(100 * p / CFG.maxPct) + '%;background:#46ff8c"></u></div><b>+' + p.toFixed(1) + '%</b></div>'; }).join('');
  root.querySelector('#mm-gnote').innerHTML = 'A qualified day = gym done + 7–9h sleep ticked + ' + CFG.foodHabits.join(' & ') + ' ticked. After ' + CFG.minDays + ' of them the body gains ' + CFG.startPct + '–' + CFG.maxPct + '% (tiny on purpose), per muscle in proportion to how well it was trained in the last 28 days. This is a motivational estimate from your habits, not a measurement.' + (M.demo ? ' <b>SIZE DEMO ×10 is ON: the hologram is exaggerated.</b>' : '');
  root.querySelector('#mm-tag').innerHTML = big > 0 ? 'SIZE +' + big.toFixed(1) + '% (est.)' : (gr.eligible ? '' : 'SIZE LOCKED · ' + gr.n + '/' + CFG.minDays + ' DAYS');
  var gb = root.querySelector('[data-a="demo"]'); gb.classList.toggle('on', !!M.demo);
  /* trend chart */
  var svg = root.querySelector('#mm-svg'), W0 = 300, H0 = 140, top = Math.max(CFG.maxPct, 2.5), pts = gr.weekly.map(function (w, i) { return [20 + i * (W0 - 36) / 7, H0 - 22 - (H0 - 40) * (w.pct / top)]; });
  var grid = ''; [0, 1, 2].forEach(function (v) { var yy = H0 - 22 - (H0 - 40) * (v / top); grid += '<line x1="20" x2="296" y1="' + yy + '" y2="' + yy + '" stroke="rgba(96,200,255,.14)"/><text x="2" y="' + (yy + 3) + '" fill="#7fa6c9" font-size="9">+' + v + '%</text>'; });
  var labs = ''; pts.forEach(function (p, i) { labs += '<text x="' + p[0] + '" y="136" fill="#7fa6c9" font-size="9" text-anchor="middle">W' + (i + 1) + '</text>'; });
  svg.innerHTML = grid + labs + '<polyline fill="none" stroke="#46ff8c" stroke-width="2" points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" style="filter:drop-shadow(0 0 4px #46ff8c)"/>' + pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" fill="#46ff8c"/>'; }).join('');
  root.querySelector('#mm-tnote').innerHTML = gr.eligible ? '<b>Small, consistent gains. Keep going.</b> ' + gr.n + ' qualified days so far.' : 'Growth stays at 0% until <b>' + CFG.minDays + '</b> qualified days. You have <b>' + gr.n + '</b>' + (gr.last ? ' (last: ' + dayLabel(gr.last) + ')' : '') + '.';
  selectRow(M, M.selRow, true);
}
function selectRow(M, ri, keep) {
  var root = M.root, st = M.st; M.selRow = ri; [M.body, M.focus, M.back].forEach(function (s) { s.ud.selRow = ri; s.invalidate(); });
  [].forEach.call(root.querySelectorAll('.mm-row'), function (b) { b.classList.toggle('on', +b.dataset.r === ri); });
  var h = root.querySelector('#mm-selh'), parts = root.querySelector('#mm-parts'), det = root.querySelector('#mm-det');
  if (ri < 0) { h.textContent = 'Tap a muscle'; parts.innerHTML = '<div class="mm-small">Tap any muscle on the hologram or in the list.</div>'; det.innerHTML = '<div class="mm-small">Select a muscle to see which exercises worked it.</div>'; M.focus.ud.zoom = 1.0; M.focus.ud.fx = 0; M.focus.ud.fy = .3; M.focus.ud.fz = 0; M.focus.invalidate(); return; }
  var r = st.rowSt[ri], c = STC[r.state], gi = ROWS[ri][1], pct = M.gr.per[ROWS[ri][0]] || 0;
  h.innerHTML = ROWS[ri][0].toUpperCase() + ' <span style="font-size:12px;color:' + rgbS(c) + '">· ' + (r.state ? ST_NAME[r.state] + (st.isToday && !st.rec ? ' today' : '') : 'not in plan') + '</span>';
  parts.innerHTML = r.regs.map(function (k) { var s2 = st.rs[k], cc = STC[s2], nm = R[k][1] + (r.regs.length > 1 && R[k][1] === 'Long head' && ri === 4 ? '' : ''); return '<div class="mm-part" style="border-color:' + rgbS(cc) + '"><span>' + nm + (st.score[k] ? ' <small style="color:#7fa6c9">· ' + st.score[k] + ' set-credits</small>' : '') + '</span><b style="color:' + rgbS(cc) + '">' + (st.rec ? ['NO DATA', 'READY', 'RECOVERING', 'SORE'][s2] + (st.recDays[k] < 99 ? ' · ' + st.recDays[k] + 'd' : '') : (s2 === 1 ? 'TRAINED' : s2 === 2 ? 'PARTIAL' : s2 === 3 ? 'NOT TRAINED' : 'OTHER')) + '</b></div>'; }).join('') + '<div class="mm-small">Size estimate for this muscle: <b style="color:#7dffb0">+' + pct.toFixed(1) + '%</b></div>';
  var list = st.exs.filter(function (e) { return e.regs.some(function (x) { return x[1] >= .5 && R[x[0]][2] === ri; }); });
  det.innerHTML = list.length ? list.map(function (e) { return '<div class="mm-ex"><div>' + esc(e.name) + '<small>' + e.sets + ' x ' + (e.sets ? Math.round(e.reps / e.sets) : 0) + ' reps' + (e.ok ? '' : ' · needs 2+ sets to count') + '</small></div><span class="ck" style="background:' + (e.ok ? '#46ff8c' : '#bfe8ff') + '"></span></div>'; }).join('') : '<div class="mm-small">No logged exercise worked ' + ROWS[ri][0].toLowerCase() + ' on this day.' + (r.state === 3 ? ' It was in the plan, so it shows red.' : '') + '</div>';
  if (st.rec) det.innerHTML = '<div class="mm-small">' + r.regs.map(function (k) { return R[k][1] + ': ' + (st.recLast[k] ? 'last trained ' + dayLabel(st.recLast[k]) : 'no real training in your log'); }).join('<br>') + '<br><br>Sore muscles are skipped by the Gym log suggestions.</div>';
  var f = M.focus.ud, cen = rowCentroid(ri); f.fx = cen[0]; f.fy = cen[1]; f.fz = cen[2]; f.zoom = ROW_ZOOM[ri]; f.yaw = ROW_BACK[ri] ? Math.PI - .35 : .38; M.focus.invalidate();
}
function open() {
  css(); K.injectCSS();
  var body = D.getElementById('gym-hud-body'); if (!body) return;
  D.querySelectorAll('.gym-hud-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === 'map'); });
  try { var pw = D.getElementById('gym-hud-pwr'); var d = K.getData(true); if (pw) pw.innerText = d.st.scheduled ? Math.round(d.st.done / d.st.scheduled * 100) + '%' : '--'; } catch (e) { }
  body.innerHTML = shell();
  var root = body.querySelector('.mm'), M = { root: root, iso: isoDate(new Date()), selRow: -1, demo: false, rec: false };
  M.body = K.attach(root.querySelector('#mm-body'), drawMapAuto); mstate(M.body); M.body.ud.spin = true; M.body.ud.yaw = .5; M.body.ud.zoom = 1;
  M.focus = K.attach(root.querySelector('#mm-focus'), drawMapAuto, { still: true }); mstate(M.focus); M.focus.ud.mini = true;
  M.back = K.attach(root.querySelector('#mm-back'), drawMapAuto, { still: true }); mstate(M.back); M.back.ud.mini = true; M.back.ud.yaw = Math.PI - .2; M.back.ud.zoom = 1; M.back.ud.fy = 0;
  M.focus.ud.fy = .3;
  K.dragger(M.body, function (dx, dy, e) {
    var u = M.body.ud; u.yaw += dx * .0125; u.vel = 0; u.spin = false; u.tgt = null; u.userT = performance.now(); setSpin(false);
    if (e && e.pointerType === 'mouse' && dy) u.tilt = clamp((u.tilt || 0) + dy * .0028, -.32, .32);          // mouse: dragging up / down also tips the body a little, it eases back on release
  }, function (x, y) {
    var rg = pickAuto(M.body, x, y); if (rg < 0 || rg === NONE) { selectRow(M, -1); return; } selectRow(M, R[rg][2]);
  }, function (vx) { M.body.ud.vel = clamp(vx * .0125, -.02, .02); M.body.ud.userT = performance.now(); }, function (ratio) {
    var u = M.body.ud; u.zoomT = null; u.zoom = clamp((u.zoom || 1) * ratio, .8, 2.4); if (u.zoom > 1.05) { u.fx = 0; u.fy = .1; u.fz = 0; } M.body.invalidate();           // two-finger pinch
  });
  M.body.cv.addEventListener('wheel', function (e) { if (!e.ctrlKey) return; e.preventDefault(); var u = M.body.ud; u.zoomT = clamp((u.zoomT || u.zoom || 1) * (e.deltaY < 0 ? 1.12 : .89), .8, 2.4); u.fx = 0; u.fy = .1; u.fz = 0; M.body.invalidate(); }, { passive: false });
  M.body.cv.addEventListener('dblclick', function () { var u = M.body.ud; u.zoomT = 1; u.tgt = 0; u.tilt = 0; u.fx = u.fy = u.fz = 0; setSpin(false); M.body.invalidate(); });
  M.body.cv.tabIndex = 0; M.body.cv.setAttribute('aria-label', 'Muscle map 3D body. Arrow keys rotate, plus and minus zoom.');
  M.body.cv.addEventListener('keydown', function (e) {
    var u = M.body.ud, k = e.key, hit = true;
    if (k === 'ArrowLeft') { u.yaw -= .12; } else if (k === 'ArrowRight') { u.yaw += .12; } else if (k === '+' || k === '=') { u.zoomT = clamp((u.zoomT || u.zoom || 1) * 1.15, .8, 2.4); u.fy = .1; } else if (k === '-') { u.zoomT = clamp((u.zoomT || u.zoom || 1) / 1.15, .8, 2.4); } else if (k === '0') { u.zoomT = 1; u.tgt = 0; } else hit = false;
    if (hit) { e.preventDefault(); u.spin = false; u.userT = performance.now(); M.body.invalidate(); }
  });
  function setSpin(on) { M.body.ud.spin = on; var b = root.querySelector('[data-a="spin"]'); if (b) b.classList.toggle('on', on); }
  setSpin(true);
  root.querySelector('.mm-ctl').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; var a = b.dataset.a, u = M.body.ud;
    if (a === 'front') { u.tgt = 0; setSpin(false); } else if (a === 'back') { u.tgt = Math.PI; setSpin(false); } else if (a === 'spin') setSpin(!u.spin);
    else if (a === 'zi' || a === 'zo') { u.zoomT = clamp((u.zoomT || u.zoom || 1) * (a === 'zi' ? 1.2 : .83), .8, 2.4); if (u.zoomT <= 1.05) { u.fx = 0; u.fy = 0; u.fz = 0; } else { u.fy = .1; } }
    else if (a === 'demo') { M.demo = !M.demo; render(M); }
    else if (a === 'rec') { M.rec = !M.rec; render(M); }
    M.body.invalidate();
  });
  root.querySelector('#mm-rows').addEventListener('click', function (e) { var b = e.target.closest('.mm-row'); if (!b) return; var ri = +b.dataset.r; selectRow(M, M.selRow === ri ? -1 : ri); if (M.selRow >= 0) { var u = M.body.ud; u.tgt = ROW_BACK[ri] ? Math.PI : 0; setSpin(false); } });
  root.querySelector('#mm-prev').onclick = function () { M.iso = gymAddDays(M.iso, -1); render(M); };
  root.querySelector('#mm-next').onclick = function () { M.iso = gymAddDays(M.iso, 1); render(M); };
  MAPUI = M; render(M);
  M.sig = sigOf(M);
}
function sigOf(M) { try { var l = gymCollectLogs().filter(function (x) { return x.iso === M.iso; }); return M.iso + '|' + l.map(function (x) { return x.slug + x.sets; }).join(',') + '|' + getGymStatus(M.iso) + '|' + isoDate(new Date()); } catch (e) { return ''; } }
setInterval(function () { var M = MAPUI; if (!M || D.hidden || !M.root.isConnected || !M.root.offsetParent) return; var sg = sigOf(M); if (sg !== M.sig) { M.sig = sg; render(M); } }, 3000);

/* ================= hook the Gym HUD ================= */
function hook() {
  var orig = window.renderGymHUD; if (typeof orig !== 'function' || orig.__mm) return;
  var w = function () { if (typeof gymHudTab !== 'undefined' && gymHudTab === 'map') { try { return open(); } catch (e) { if (window.console) console.warn('muscle map', e); } } return orig.apply(this, arguments); };
  w.__mm = true; window.renderGymHUD = w;
}

/* =====================================================================
   v2 — HOLO ROOM BODY: the solid GPU body (white-blue) instead of the old wireframe.
   Brightness shows training: bright white-cyan = on target, blue = building, dim blue = low, dark = neglected.
   HOLO.cfg.semantic = true paints it green / red like the Muscle Map instead.
   ===================================================================== */
var HSTATUS = ['NEGLECTED', 'LOW', 'BUILDING', 'ON TARGET'];
function holoStates(u, d) {
  var map = u.pal === 'blue' ? [3, 4, 2, 1] : [3, 2, 2, 1], i, g;
  for (i = 0; i < NR; i++) { g = K.ginfo(d, R[i][3]); u.rs[i] = map[g.idx]; }
  u.labelTxt = function (ri) { var o = K.ginfo(d, R[ri][3]); return HSTATUS[o.idx] + ' · ' + o.s28 + ' sets'; };
}
function drawHoloView(ctx, w, h, t, s) {
  var u = s.ud, d = K.getData();
  if (u.stamp !== d.at) { u.stamp = d.at; mstate(s); holoStates(u, d); }
  return drawMapAuto(ctx, w, h, t, s);
}
function rowsOfGroup(g) { var m = new Uint8Array(ROWS.length), i, any = false; for (i = 0; i < ROWS.length; i++) if (ROWS[i][1] === g) { m[i] = 1; any = true; } return any ? m : null; }
var SOLIDS = [];
function mountSolid(wrap, o) {
  o = o || {}; wrap.innerHTML = '';
  var s = K.attach(wrap, drawHoloView, { still: !!o.mini }), u = s.ud;
  u.mini = !!o.mini; u.pal = (o.semantic || H.cfg.semantic) ? 'sem' : 'blue'; mstate(s);
  u.yaw = o.yaw !== undefined ? o.yaw : .45; u.zoom = 1; u.idleSpin = !o.mini; u.userT = 0; u.fx = u.fy = u.fz = 0; u.noLabels = !!o.noLabels;
  s.solid = true; s.wrapEl = wrap; if (!o.mini) SOLIDS.push(s);
  s.select = function (g) {
    u.selMask = g ? rowsOfGroup(g) : null; u.userT = performance.now();
    if (g && !u.mini) u.tgt = (g === 'Back' || g === 'Triceps') ? Math.PI : 0;
    s.dirty = true;
  };
  if (!o.mini) {
    K.dragger(s, function (dx, dy, e) {
      u.yaw += dx * .0125; u.vel = 0; u.tgt = null; u.userT = performance.now();
      if (e && e.pointerType === 'mouse' && dy) u.tilt = clamp((u.tilt || 0) + dy * .0028, -.32, .32);
    }, function (x, y) {
      var rg = pickAuto(s, x, y);
      if (rg < 0 || rg === NONE) { s.select(null); o.onSel && o.onSel(null); return; }
      var g = R[rg][3]; s.select(g); o.onSel && o.onSel(g);
    }, function (vx) { u.vel = clamp(vx * .0125, -.02, .02); u.userT = performance.now(); }, function (ratio) {
      u.zoomT = null; u.zoom = clamp((u.zoom || 1) * ratio, .8, 2.2); if (u.zoom > 1.05) { u.fy = .1; } u.userT = performance.now(); s.dirty = true;
    });
    s.cv.addEventListener('wheel', function (e) { if (!e.ctrlKey) return; e.preventDefault(); u.zoomT = clamp((u.zoomT || u.zoom || 1) * (e.deltaY < 0 ? 1.12 : .89), .8, 2.2); u.fy = .1; u.userT = performance.now(); s.dirty = true; }, { passive: false });
    s.cv.addEventListener('dblclick', function () { u.zoomT = 1; u.tgt = 0; u.tilt = 0; u.fx = u.fy = u.fz = 0; s.dirty = true; });
  }
  return s;
}


/* =====================================================================
   v3 — BODY CONTROL API. Whatever 3D body is on screen right now (the Muscle Map, or the big Holo body) can be driven
   without touching it: HOLO.bodyAct('in' | 'out' | 'reset' | 'left' | 'right' | 'back' | 'front' | 'spin').
   Returns true when a body was on screen and moved. Jarvis uses this for "zoom in", "zoom out", "turn left", "show my back".
   ===================================================================== */
function visibleBody() {
  var M = MAPUI, i, s;
  if (M && M.root && M.root.isConnected && M.root.offsetParent && M.body) return { s: M.body, M: M };
  for (i = SOLIDS.length - 1; i >= 0; i--) { s = SOLIDS[i]; if (s.wrapEl && s.wrapEl.isConnected && s.wrapEl.offsetParent) return { s: s }; }
  return null;
}
function bodyAct(a) {
  var v = visibleBody(); if (!v) return false;
  var s = v.s, u = s.ud, z = u.zoomT || u.zoom || 1, spinBtn = v.M ? v.M.root.querySelector('[data-a="spin"]') : null;
  if (a === 'in') { u.zoomT = clamp(z * 1.3, .8, 2.4); u.fy = .1; }
  else if (a === 'out') { u.zoomT = clamp(z / 1.3, .8, 2.4); if (u.zoomT <= 1.05) { u.fx = u.fy = u.fz = 0; } }
  else if (a === 'reset') { u.zoomT = 1; u.tgt = 0; u.tilt = 0; u.fx = u.fy = u.fz = 0; }
  else if (a === 'left') { u.tgt = u.yaw - .9; }
  else if (a === 'right') { u.tgt = u.yaw + .9; }
  else if (a === 'back') { u.tgt = Math.PI; }
  else if (a === 'front') { u.tgt = 0; }
  else if (a === 'spin') { u.spin = !u.spin; u.idleSpin = u.spin; if (spinBtn) spinBtn.classList.toggle('on', u.spin); u.userT = performance.now(); s.dirty = true; if (s.invalidate) s.invalidate(); return true; }
  else return false;
  u.spin = false; if (spinBtn) spinBtn.classList.remove('on'); u.userT = performance.now(); s.dirty = true; if (s.invalidate) s.invalidate();
  return true;
}

H.bodyAct = bodyAct;
H.map = { act: bodyAct, mountSolid: mountSolid, draw: drawMapAuto, pick: pickAuto, gl: GLS, cfg: CFG, recovery: recovery, open: open, dayState: dayState, growth: growth, exRegs: exRegs, regions: R, rows: ROWS, _t: { drawMap: drawMap, mstate: mstate, buildMesh: buildMesh, shell: shell, render: render } };
if (D.readyState === 'complete' || D.readyState === 'interactive') hook(); else D.addEventListener('DOMContentLoaded', hook);
})();
