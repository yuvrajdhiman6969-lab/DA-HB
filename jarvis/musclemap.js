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

/* ================= body mesh ================= */
var MESH = null;
function tprof(tab, y) {                       // tab rows: [y, rx, rz] descending y
  if (y >= tab[0][0]) return [tab[0][1], tab[0][2]];
  for (var i = 0; i < tab.length - 1; i++) { var a = tab[i], b = tab[i + 1]; if (y <= a[0] && y >= b[0]) { var t = (a[0] - y) / (a[0] - b[0]); return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; } }
  var l = tab[tab.length - 1]; return [l[1], l[2]];
}
function sm(x, a, b) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function bell(x, c, w) { var t = (x - c) / w; return Math.exp(-t * t); }
function buildMesh() {
  var X = [], Y = [], Z = [], CX = [], CZ = [], NX = [], NZ = [], RG = [], Q = [], QF = [];
  function stack(rings, N, rf, bf) {
    var rows = [], i, k, L = rings.length - 1;
    for (i = 0; i <= L; i++) {
      var r = rings[i], row = [], u = L ? i / L : 0;
      for (k = 0; k < N; k++) {
        var a = k / N * TAU, sn = Math.sin(a), cs = Math.cos(a), m = bf ? bf(r, sn, cs, u) : 1, nx = sn * r.rz, nz = cs * r.rx, ln = Math.sqrt(nx * nx + nz * nz) || 1;
        X.push(r.cx + r.rx * m * sn); Y.push(r.y); Z.push(r.cz + r.rz * m * cs); CX.push(r.cx); CZ.push(r.cz); NX.push(nx / ln); NZ.push(nz / ln);
        RG.push(rf(r, sn, cs, u)); row.push(X.length - 1);
      }
      rows.push(row);
    }
    for (i = 0; i < L; i++) for (k = 0; k < N; k++) {
      var k2 = (k + 1) % N, a0 = rows[i][k], b0 = rows[i][k2], c0 = rows[i + 1][k2], d0 = rows[i + 1][k];
      Q.push(a0, b0, c0, d0); QF.push((RG[b0] !== RG[a0] ? 1 : 0) | (RG[d0] !== RG[a0] ? 2 : 0));
    }
  }
  function ring(y, cx, cz, rx, rz) { return { y: y, cx: cx, cz: cz, rx: rx, rz: rz }; }
  var id = function (s) { return RI[s]; };

  /* torso */
  var TT = [[.74, .075, .075], [.71, .14, .09], [.68, .235, .105], [.65, .295, .125], [.60, .302, .145], [.55, .292, .152], [.50, .268, .15], [.45, .232, .14], [.40, .212, .13], [.35, .196, .12], [.30, .186, .115], [.25, .18, .11], [.20, .18, .108], [.15, .19, .113], [.10, .205, .12], [.05, .222, .128], [.0, .228, .132], [-.05, .228, .13]];
  var tr = []; for (var y = .74; y > -.051; y -= .0325) { var p = tprof(TT, y); tr.push(ring(y, 0, 0, p[0], p[1])); }
  stack(tr, 36, function (r, sn, cs) {
    var y = r.y, a = Math.abs(sn);
    if (y >= .64) return cs > .15 ? id('ch_up') : id('tr');
    if (y >= .45) { if (cs > .05) return y >= .575 ? id('ch_up') : id('ch_mid'); if (a > .6) return id('lat'); return y >= .56 ? id('tr') : id('mb'); }
    if (y >= .18) { if (cs > .4 && a < .5) return y >= .33 ? id('abs_u') : id('abs_l'); if (cs > -.25) return id('obl'); if (a > .55 && y >= .33) return id('lat'); return y >= .33 ? id('mb') : id('lb'); }
    if (y >= .05) { if (cs > .4 && a < .5) return id('abs_l'); if (cs > -.25) return id('obl'); return id('lb'); }
    return cs < -.2 ? id('glu') : NONE;
  }, function (r, sn, cs) {
    var y = r.y, a = Math.abs(sn), front = clamp(cs, 0, 1), back = clamp(-cs, 0, 1), m = 1;
    m += .17 * bell(y, .565, .075) * sm(a, .06, .2) * (1 - sm(a, .72, .95)) * front;                              // pecs (centre groove)
    m += .05 * front * (a < .45 ? 1 : 0) * sm(a, .02, .09) * (.5 + .5 * Math.sin((y - .12) / .068 * TAU - 1.57)) * sm(y, .11, .15) * (1 - sm(y, .44, .47));   // abs blocks
    m += .11 * bell(y, .42, .13) * sm(a, .42, .7) * (1 - sm(a, .92, 1.0)) * back;                                 // lats flare
    m += .065 * bell(y, .66, .045) * (.4 + .6 * back);                                                              // traps
    m += .03 * bell(y, .2, .1) * back * sm(a, .06, .2) * (1 - sm(a, .35, .5));                                     // erectors
    m += .15 * bell(y, -.02, .065) * back * sm(a, .04, .18) * (1 - sm(a, .85, 1.0));                               // glutes
    m += .03 * bell(y, .3, .12) * sm(a, .8, .98) * front;                                                          // obliques
    return m;
  });
  /* head, neck */
  var hd = [[1.0, .03, .035], [.99, .075, .085], [.965, .105, .12], [.925, .12, .135], [.885, .122, .138], [.845, .116, .132], [.81, .1, .115], [.785, .075, .085]];
  stack(hd.map(function (t) { return ring(t[0], 0, .008, t[1], t[2]); }), 20, function () { return NONE; }, null);
  stack([ring(.795, 0, 0, .062, .064), ring(.76, 0, 0, .066, .068), ring(.725, 0, 0, .09, .082)], 16, function () { return NONE; }, null);
  [-1, 1].forEach(function (s) {
    /* deltoid: cap of the shoulder */
    var dr = []; for (var q = 0; q < 8; q++) { var o = -.1 + q * .029, rr = Math.sqrt(Math.max(0, 1 - (o / .105) * (o / .105))); dr.push(ring(.625 + o, s * .352, 0, .1 * rr + .012, .102 * rr + .012)); }
    stack(dr, 18, function (r, sn, cs) { return cs > .4 ? id('dl_f') : cs < -.4 ? id('dl_r') : id('dl_s'); }, function (r, sn, cs, u) { return 1 + .05 * bell(u, .45, .3); });
    /* upper arm */
    var ua = []; for (var i = 0; i <= 8; i++) { var t = i / 8; ua.push(ring(lerp(.565, .365, t), s * lerp(.372, .42, t), 0, lerp(.07, .054, t), lerp(.068, .054, t))); }
    stack(ua, 20, function (r, sn, cs, u) {
      var out = sn * s > 0;
      if (cs > .25) return out ? id('bi_l') : id('bi_s');
      if (cs < -.25) return out ? id('tri_o') : id('tri_l');
      if (u > .55) return out ? id('bi_b') : id('tri_l');
      return out ? id('tri_o') : id('bi_s');
    }, function (r, sn, cs, u) { return 1 + .19 * bell(u, .5, .26) * clamp(cs + .2, 0, 1) + .15 * bell(u, .4, .3) * clamp(-cs, 0, 1) + .03 * bell(u, .78, .2); });
    /* forearm + hand */
    var fa = []; for (i = 0; i <= 7; i++) { var f = i / 7; fa.push(ring(lerp(.355, .13, f), s * lerp(.425, .465, f), 0, lerp(.058, .033, f), lerp(.058, .034, f))); }
    stack(fa, 16, function () { return id('fore'); }, function (r, sn, cs, u) { return 1 + .14 * bell(u, .15, .2); });
    stack([ring(.11, s * .467, 0, .032, .022), ring(.082, s * .469, 0, .04, .026), ring(.05, s * .47, 0, .037, .022), ring(.02, s * .471, 0, .022, .014)], 12, function () { return NONE; }, null);
    /* leg */
    var th = []; for (i = 0; i <= 11; i++) { var tt = i / 11; th.push(ring(lerp(.01, -.5, tt), s * lerp(.108, .12, tt), lerp(.012, 0, tt), lerp(.112, .071, tt), lerp(.118, .074, tt))); }
    stack(th, 22, function (r, sn, cs, u) { if (cs < -.2 && u < .22) return id('glu'); return cs > -.15 ? id('quad') : id('ham'); },
      function (r, sn, cs, u) { var out = sn * s > 0; return 1 + .15 * bell(u, .35, .25) * clamp(cs + .3, 0, 1) * (out ? 1.2 : .8) + .06 * bell(u, .4, .25) * clamp(-cs, 0, 1) + .05 * bell(u, .85, .12) * clamp(cs, 0, 1); });
    var ca = []; for (i = 0; i <= 9; i++) { var c = i / 9; ca.push(ring(lerp(-.5, -.935, c), s * lerp(.12, .122, c), 0, lerp(.071, .034, c), lerp(.074, .035, c))); }
    stack(ca, 18, function (r, sn, cs) { return cs < .15 ? id('calf') : NONE; }, function (r, sn, cs, u) { var out = sn * s > 0; return 1 + .27 * bell(u, .25, .17) * clamp(-cs + .15, 0, 1) * (out ? 1 : .9) - .03 * clamp(cs, 0, 1) * bell(u, .5, .4); });
    stack([ring(-.945, s * .122, .035, .042, .062), ring(-.97, s * .122, .06, .052, .1), ring(-.99, s * .122, .07, .054, .122), ring(-1.0, s * .122, .07, .05, .12)], 14, function () { return NONE; }, null);
  });
  var n = X.length, cen = {};
  /* region centroids (right side of the model) for the focus camera */
  for (var i = 0; i < n; i++) { var rg = RG[i]; if (rg === NONE) continue; if (X[i] < -.001 && Math.abs(X[i]) > .04) continue; var c2 = cen[rg] || (cen[rg] = [0, 0, 0, 0]); c2[0] += X[i]; c2[1] += Y[i]; c2[2] += Z[i]; c2[3]++; }
  var VX = new Float32Array(n), VY = new Float32Array(n), VZ = new Float32Array(n);
  for (var qq = 0; qq < QF.length; qq++) {
    var a1 = Q[qq * 4], b1 = Q[qq * 4 + 1], c1 = Q[qq * 4 + 2], d1 = Q[qq * 4 + 3];
    var ux = X[d1] - X[a1], uy = Y[d1] - Y[a1], uz = Z[d1] - Z[a1], vx = X[b1] - X[a1], vy = Y[b1] - Y[a1], vz = Z[b1] - Z[a1];
    var fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    [a1, b1, c1, d1].forEach(function (v) { VX[v] += fx; VY[v] += fy; VZ[v] += fz; });
  }
  for (var vi = 0; vi < n; vi++) {
    var l2 = Math.sqrt(VX[vi] * VX[vi] + VY[vi] * VY[vi] + VZ[vi] * VZ[vi]) || 1; VX[vi] /= l2; VY[vi] /= l2; VZ[vi] /= l2;
    if (VX[vi] * (X[vi] - CX[vi]) + VZ[vi] * (Z[vi] - CZ[vi]) < 0) { VX[vi] = -VX[vi]; VY[vi] = -VY[vi]; VZ[vi] = -VZ[vi]; }
  }
  return { NY: VY, GX: VX, GZ: VZ, n: n, X: new Float32Array(X), Y: new Float32Array(Y), Z: new Float32Array(Z), CX: new Float32Array(CX), CZ: new Float32Array(CZ), NX: new Float32Array(NX), NZ: new Float32Array(NZ), RG: RG, Q: Q, QF: QF, nq: QF.length, cen: cen };
}
function rowCentroid(row) {
  var M = MESH || (MESH = buildMesh()), s = [0, 0, 0, 0];
  R.forEach(function (r, k) { if (r[2] === row && M.cen[k]) { var c = M.cen[k]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3] += c[3]; } });
  return s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0, .3, 0];
}

/* ================= palette (8 light levels per state) ================= */
var BASE = [[[5, 13, 34], [112, 186, 255]], [[3, 26, 14], [110, 255, 160]], [[44, 26, 4], [255, 204, 96]], [[40, 5, 8], [255, 112, 100]]];
var PAL = BASE.map(function (b) { var a = []; for (var i = 0; i < 8; i++) { var t = i / 7; a.push('rgb(' + Math.round(lerp(b[0][0], b[1][0], t)) + ',' + Math.round(lerp(b[0][1], b[1][1], t)) + ',' + Math.round(lerp(b[0][2], b[1][2], t)) + ')'); } return a; });
var STC = [[96, 170, 255], [70, 255, 140], [255, 190, 70], [255, 80, 78]];
var RECLEG = '<span><i style="background:#46ff8c"></i><div>READY<em>3+ days rest (2 for small muscles)</em></div></span><span><i style="background:#ffbe46"></i><div>RECOVERING<em>trained 2 days ago</em></div></span><span><i style="background:#ff504e"></i><div>SORE<em>trained today or yesterday</em></div></span>';
var PX = 0, PY = 0, PZ = 0;

/* ================= render ================= */
var LABELS_F = [['tr', 'Trapezius', 'L'], ['dl_s', 'Deltoid', 'R'], ['ch_mid', 'Pectorals', 'L'], ['bi_s', 'Biceps', 'R'], ['obl', 'Obliques', 'L'], ['abs_u', 'Abs', 'R'], ['quad', 'Quadriceps', 'L'], ['fore', 'Forearm', 'R'], ['calf', 'Calves', 'R']];
var LABELS_B = [['tr', 'Trapezius', 'L'], ['dl_r', 'Rear delt', 'R'], ['lat', 'Lats', 'L'], ['tri_l', 'Triceps', 'R'], ['lb', 'Lower back', 'L'], ['glu', 'Glutes', 'R'], ['ham', 'Hamstrings', 'L'], ['calf', 'Calves', 'R']];
function ringPath(ctx, pr, y, r, a0, a1, N) { for (var i = 0; i <= N; i++) { var a = a0 + (a1 - a0) * i / N; pr(Math.cos(a) * r, y, Math.sin(a) * r); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); } }
function mstate(s) {
  var u = s.ud, M = MESH || (MESH = buildMesh());
  if (!u.px) { u.px = new Float32Array(M.n); u.py = new Float32Array(M.n); u.pz = new Float32Array(M.n); u.lm = new Float32Array(M.n); u.nz = new Float32Array(M.n); u.key = new Float32Array(M.nq); u.ord = []; u.rs = new Uint8Array(NR); u.mult = new Float32Array(NR + 1).fill(1); u.yaw = u.yaw === undefined ? .5 : u.yaw; u.zoom = u.zoom || 1; u.selRow = -1; u.fx = u.fx || 0; u.fy = u.fy || 0; u.fz = u.fz || 0; }
  return M;
}
function drawMap(ctx, w, h, t, s) {
  var M = mstate(s), u = s.ud, mini = !!u.mini, dt = Math.min(90, t - (u.t0 || t)); u.t0 = t;
  if (!mini) {
    if (u.tgt !== undefined && u.tgt !== null) { var df = Math.atan2(Math.sin(u.tgt - u.yaw), Math.cos(u.tgt - u.yaw)); u.yaw += df * Math.min(1, dt * .008); if (Math.abs(df) < .01) u.tgt = null; }
    else if (u.spin && !s.drag && !K.lite()) u.yaw += dt * .00045;
    u.vel = u.vel || 0; if (!s.drag && Math.abs(u.vel) > .0004) { u.yaw += u.vel * dt; u.vel *= .94; }
  }
  var yaw = u.yaw, cyw = Math.cos(yaw), syw = Math.sin(yaw), pitch = mini ? .04 : .1, cp = Math.cos(pitch), sp = Math.sin(pitch), F = 4.6;
  var base = mini ? h / 2.4 : Math.min(h / 2.5, w / 1.75), sc = base * (u.zoom || 1), cx = w / 2, cy = h / 2;
  /* focus camera: put the focus point in the centre of the canvas */
  if (u.zoom > 1.05 || mini) {
    var fxr = u.fx * cyw + u.fz * syw, fzr = -u.fx * syw + u.fz * cyw, fyp = u.fy * cp - fzr * sp, fzp = u.fy * sp + fzr * cp, fk = F / (F - fzp);
    cx = w / 2 - fxr * sc * fk; cy = h / 2 + fyp * sc * fk;
  }
  var GX = M.GX, GZ = M.GZ, NYv = M.NY, X = M.X, Y = M.Y, Z = M.Z, CX = M.CX, CZ = M.CZ, NX = M.NX, NZ = M.NZ, RG = M.RG, px = u.px, py = u.py, pz = u.pz, lm = u.lm, nzv = u.nz, mult = u.mult, i, x, y, z, xr, zr, yp, zp, k, m, g;
  /* per-region accumulators for label anchors */
  var showLab = !mini && w > 560 && u.zoom <= 1.3, face = cyw >= 0, labs = face ? LABELS_F : LABELS_B, acc = null;
  if (showLab) { acc = u.acc || (u.acc = {}); labs.forEach(function (L) { var a = acc[L[0]] || (acc[L[0]] = [0, 0, 0, 0, 0, 0]); a[0] = a[1] = a[2] = a[3] = a[4] = a[5] = 0; }); }
  for (i = 0; i < M.n; i++) {
    g = RG[i]; m = mult[g]; x = X[i]; y = Y[i]; z = Z[i];
    if (m !== 1) { x = CX[i] + (x - CX[i]) * m; z = CZ[i] + (z - CZ[i]) * m; }
    xr = x * cyw + z * syw; zr = -x * syw + z * cyw; yp = y * cp - zr * sp; zp = y * sp + zr * cp; k = F / (F - zp);
    px[i] = cx + xr * sc * k; py[i] = cy - yp * sc * k; pz[i] = zp;
    var gx = GX[i], gz = GZ[i], nxr = gx * cyw + gz * syw, nzr = -gx * syw + gz * cyw; nzv[i] = nzr;
    lm[i] = Math.pow(clamp(.05 + (nxr * -.5 + NYv[i] * .42 + nzr * .72), 0, 1), 1.7) * 1.15 + (nzr < .25 ? .08 : 0);
    if (acc && g !== NONE && nzr > .25) { var a2 = acc[R[g][0]]; if (a2) { a2[0] += px[i]; a2[1] += py[i]; a2[2]++; if (px[i] < w / 2) { a2[3] += px[i]; a2[4] += py[i]; a2[5]++; } } }
  }
  ctx.clearRect(0, 0, w, h); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  var sprs = K.sprites(), pulse = .5 + .5 * Math.sin(t * .004);
  function pr(x0, y0, z0) { var xr0 = x0 * cyw + z0 * syw, zr0 = -x0 * syw + z0 * cyw, yp0 = y0 * cp - zr0 * sp, zp0 = y0 * sp + zr0 * cp, k0 = F / (F - zp0); PX = cx + xr0 * sc * k0; PY = cy - yp0 * sc * k0; PZ = zp0; }
  /* pedestal (behind) */
  if (!mini) {
    ctx.globalCompositeOperation = 'lighter';
    pr(0, -1.03, 0); ctx.save(); ctx.translate(PX, PY); ctx.scale(1, .3);
    var gg = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * 1.1); gg.addColorStop(0, rgba(C.cy, .42)); gg.addColorStop(.4, rgba(C.bl, .2)); gg.addColorStop(1, rgba(C.bl, 0));
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, sc * 1.1, 0, TAU); ctx.fill(); ctx.restore();
    var spin = t * .0004;
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(C.cy, .7); ctx.beginPath(); ringPath(ctx, pr, -1.03, .46, 0, TAU, 56); ctx.stroke();
    ctx.setLineDash([2, 7]); ctx.lineDashOffset = -t * .012; ctx.strokeStyle = rgba(C.pale, .5); ctx.beginPath(); ringPath(ctx, pr, -1.03, .66, 0, TAU, 64); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 3.4; ctx.strokeStyle = rgba(C.bl, .85);
    for (i = 0; i < 4; i++) { ctx.beginPath(); ringPath(ctx, pr, -1.03, .85, spin + i * TAU / 4, spin + i * TAU / 4 + .95, 16); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .28); ctx.beginPath(); ringPath(ctx, pr, -1.03, 1.0, 0, TAU, 72); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  /* solid body: depth-sorted, lit quads */
  var Q = M.Q, QF = M.QF, key = u.key, ord = u.ord, q, a, b, c, d, st, si, rs = u.rs, sel = u.selRow;
  ord.length = 0;
  for (q = 0; q < M.nq; q++) {
    a = Q[q * 4]; b = Q[q * 4 + 1]; c = Q[q * 4 + 2]; d = Q[q * 4 + 3];
    if (nzv[a] + nzv[b] < -.12) continue;
    key[q] = pz[a] + pz[b] + pz[c] + pz[d]; ord.push(q);
  }
  ord.sort(function (p, r) { return key[p] - key[r]; });
  for (i = 0; i < ord.length; i++) {
    q = ord[i]; a = Q[q * 4]; b = Q[q * 4 + 1]; c = Q[q * 4 + 2]; d = Q[q * 4 + 3]; g = RG[a];
    st = g === NONE ? 0 : rs[g];
    var lv = (lm[a] + lm[b] + lm[c] + lm[d]) * .25, isSel = sel >= 0 && g !== NONE && R[g][2] === sel;
    si = Math.round(clamp(lv + (isSel ? .22 + .1 * pulse : 0) + (st === 3 ? .08 * pulse : 0), 0, 1) * 7);
    ctx.fillStyle = PAL[st][si];
    ctx.beginPath(); ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); ctx.lineTo(px[d], py[d]); ctx.closePath(); ctx.fill();
    if (QF[q] || isSel) {                                                  // muscle separation lines
      var fl = QF[q];
      ctx.strokeStyle = isSel ? 'rgba(240,252,255,.85)' : 'rgba(' + STC[st][0] + ',' + STC[st][1] + ',' + STC[st][2] + ',.5)'; ctx.lineWidth = isSel ? 1 : .8; ctx.beginPath();
      if (fl & 1) { ctx.moveTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); }
      if (fl & 2) { ctx.moveTo(px[d], py[d]); ctx.lineTo(px[c], py[c]); }
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  /* arc reactor + visor light so it reads as a hologram, fading as the body turns away */
  var fa = Math.max(0, cyw);
  if (fa > .08 && !mini) {
    pr(0, .54, .16); K.glow(ctx, sprs.cy, PX, PY, sc * .26 * (1 + .1 * Math.sin(t * .005)), fa * .9); K.glow(ctx, sprs.wh, PX, PY, sc * .09, fa);
    [-1, 1].forEach(function (sd) { pr(sd * .045, .915, .135); K.glow(ctx, sprs.wh, PX, PY, sc * .06, fa); });
  }
  if (!mini) {
    var ph = (t % 5600) / 5600, sy = -1 + 2.05 * (ph < .5 ? ph * 2 : 2 - ph * 2);
    ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(C.cy, .8); ctx.beginPath(); ringPath(ctx, pr, sy, .42, 0, TAU, 40); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.cy, .08); ctx.beginPath(); ringPath(ctx, pr, sy, .42, 0, TAU, 40); ctx.stroke();
    /* top halo */
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cy, .5); ctx.beginPath(); ringPath(ctx, pr, 1.16, .26, 0, TAU, 36); ctx.stroke();
    ctx.lineWidth = 2.6; ctx.strokeStyle = rgba(C.bl, .8); for (i = 0; i < 3; i++) { ctx.beginPath(); ringPath(ctx, pr, 1.16, .5, -spin * 1.3 + i * TAU / 3, -spin * 1.3 + i * TAU / 3 + 1.2, 14); ctx.stroke(); }
  }
  ctx.globalCompositeOperation = 'source-over';
  /* callout labels with leader lines */
  if (showLab) {
    var items = [];
    labs.forEach(function (L) { var a3 = acc[L[0]]; if (!a3 || a3[2] < 3) return; var side = L[2], ax, ay; if (side === 'L' && a3[5] > 2) { ax = a3[3] / a3[5]; ay = a3[4] / a3[5]; } else if (side === 'R' && a3[2] - a3[5] > 2) { ax = (a3[0] - a3[3]) / (a3[2] - a3[5]); ay = (a3[1] - a3[4]) / (a3[2] - a3[5]); } else { ax = a3[0] / a3[2]; ay = a3[1] / a3[2]; } items.push({ L: L, ax: ax, ay: ay, left: ax < w / 2 }); });
    [true, false].forEach(function (isLeft) {
      var col = items.filter(function (o) { return o.left === isLeft; }).sort(function (p, r) { return p.ay - r.ay; }), last = -1e9;
      col.forEach(function (o) {
        var ly = Math.max(o.ay, last + 34); ly = Math.min(ly, h - 30); last = ly; var lx = isLeft ? 14 : w - 14, ri = RI[o.L[0]], stt = rs[ri], cc = STC[stt];
        var tx = isLeft ? lx + 96 : lx - 96;
        ctx.strokeStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',.65)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(tx + (isLeft ? 8 : -8), ly - 6); ctx.lineTo(tx, ly - 6); ctx.stroke();
        ctx.fillStyle = rgbS(cc, .95); ctx.beginPath(); ctx.arc(o.ax, o.ay, 2.4, 0, TAU); ctx.fill();
        ctx.textAlign = isLeft ? 'left' : 'right';
        ctx.font = '600 11.5px "Chakra Petch",monospace'; ctx.fillStyle = 'rgba(225,242,255,.95)'; ctx.fillText(o.L[1], lx, ly - 8);
        ctx.font = '500 10px "IBM Plex Sans",sans-serif'; ctx.fillStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',.95)'; ctx.fillText(u.labelTxt ? u.labelTxt(ri) : ST_NAME[stt], lx, ly + 5);
      });
    });
  }
}
function pickQuad(s, mx, my) {
  var u = s.ud, M = MESH, Q = M.Q, px = u.px, py = u.py;
  function inside(a, b, c, d) { var xs = [px[a], px[b], px[c], px[d]], ys = [py[a], py[b], py[c], py[d]], sg = 0; for (var i = 0; i < 4; i++) { var j = (i + 1) % 4, cr = (xs[j] - xs[i]) * (my - ys[i]) - (ys[j] - ys[i]) * (mx - xs[i]); if (cr !== 0) { var sgn = cr > 0 ? 1 : -1; if (sg && sgn !== sg) return false; sg = sgn; } } return true; }
  for (var i = u.ord.length - 1; i >= 0; i--) { var q = u.ord[i]; if (inside(Q[q * 4], Q[q * 4 + 1], Q[q * 4 + 2], Q[q * 4 + 3])) return M.RG[Q[q * 4]]; }
  return -1;
}

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
    '@container (min-width:1100px){.mm-cols{grid-template-columns:minmax(260px,.9fr) minmax(430px,1.55fr) minmax(260px,.95fr);align-items:start}.mm-center{grid-column:auto;order:0}}'
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
        '<div class="mm-split lg"><div class="mm-rows" id="mm-rows"></div><div class="mm-leg"><span><i style="background:#46ff8c"></i><div>TRAINED<em>2+ valid sets</em></div></span><span><i style="background:#ffbe46"></i><div>PARTIAL<em>1 set / light work</em></div></span><span><i style="background:#ff504e"></i><div>NOT TRAINED<em>planned, not hit</em></div></span><span><i style="background:#60aaff"></i><div>OTHER MUSCLES</div></span></div></div></div>' +
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
  root.querySelector('#mm-exl').innerHTML = st.exs.length ? st.exs.map(function (e) { return '<div class="mm-ex"><div>' + esc(e.name) + '<small>' + e.sets + ' set' + (e.sets > 1 ? 's' : '') + ' · ' + e.reps + ' reps</small></div><span class="ck" style="background:' + (e.ok ? '#46ff8c' : '#ffbe46') + ';box-shadow:0 0 8px ' + (e.ok ? '#46ff8c' : '#ffbe46') + '"></span></div>'; }).join('') : '<div class="mm-small">No sets logged for this day.</div>';
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
  dots(root.querySelector('#mm-sld'), sl, '#7dffb0'); dots(root.querySelector('#mm-wad'), wa, '#4fb4ff'); dots(root.querySelector('#mm-frd'), fr, '#ffbe46');
  root.querySelector('#mm-sl').textContent = sum(sl) + '/7'; root.querySelector('#mm-wa').textContent = sum(wa) + '/7'; root.querySelector('#mm-fr').textContent = sum(fr) + '/7';
  var rec = Math.round(100 * (sum(sl) + sum(wa) + sum(fr)) / 21); root.querySelector('#mm-rec').textContent = rec + '%'; root.querySelector('#mm-recb').style.width = rec + '%';
  /* growth */
  var big = Math.round(gr.base * 10) / 10;
  root.querySelector('#mm-gbig').textContent = '+' + big.toFixed(1) + '%'; root.querySelector('#mm-tbig').textContent = '+' + big.toFixed(1) + '%';
  root.querySelector('#mm-gsub').textContent = gr.eligible ? 'UNLOCKED · ' + gr.n + ' QUALIFIED DAYS' : 'LOCKED · ' + gr.n + ' / ' + CFG.minDays + ' QUALIFIED DAYS';
  var qd = root.querySelector('#mm-qd'), recent = gr.days.slice(-14); qd.innerHTML = recent.map(function (x, i) { var q = false; try { q = (function (iso) { return habitDone(iso, CFG.sleepHabit) && CFG.foodHabits.every(function (h) { return habitDone(iso, h); }) && x[2]; })(x[0]); } catch (e) { } return '<i title="' + x[0] + '" style="' + (q ? 'background:#46ff8c;box-shadow:0 0 8px #46ff8c' : (x[2] ? 'background:rgba(255,190,70,.5)' : '')) + '">' + parseISO(x[0]).getDate() + '</i>'; }).join('');
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
  det.innerHTML = list.length ? list.map(function (e) { return '<div class="mm-ex"><div>' + esc(e.name) + '<small>' + e.sets + ' x ' + (e.sets ? Math.round(e.reps / e.sets) : 0) + ' reps' + (e.ok ? '' : ' · needs 2+ sets to count') + '</small></div><span class="ck" style="background:' + (e.ok ? '#46ff8c' : '#ffbe46') + '"></span></div>'; }).join('') : '<div class="mm-small">No logged exercise worked ' + ROWS[ri][0].toLowerCase() + ' on this day.' + (r.state === 3 ? ' It was in the plan, so it shows red.' : '') + '</div>';
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
  M.body = K.attach(root.querySelector('#mm-body'), drawMap); mstate(M.body); M.body.ud.spin = true; M.body.ud.yaw = .5; M.body.ud.zoom = 1;
  M.focus = K.attach(root.querySelector('#mm-focus'), drawMap, { still: true }); mstate(M.focus); M.focus.ud.mini = true;
  M.back = K.attach(root.querySelector('#mm-back'), drawMap, { still: true }); mstate(M.back); M.back.ud.mini = true; M.back.ud.yaw = Math.PI - .2; M.back.ud.zoom = 1; M.back.ud.fy = 0;
  M.focus.ud.fy = .3;
  K.dragger(M.body, function (dx) { var u = M.body.ud; u.yaw += dx * .012; u.vel = dx * .0007; u.spin = false; u.tgt = null; setSpin(false); }, function (x, y) {
    var rg = pickQuad(M.body, x, y); if (rg < 0 || rg === NONE) { selectRow(M, -1); return; } selectRow(M, R[rg][2]);
  });
  M.body.cv.addEventListener('wheel', function (e) { if (!e.ctrlKey) return; e.preventDefault(); var u = M.body.ud; u.zoom = clamp((u.zoom || 1) * (e.deltaY < 0 ? 1.1 : .9), .8, 2.4); u.fx = 0; u.fy = .1; u.fz = 0; M.body.invalidate(); }, { passive: false });
  function setSpin(on) { M.body.ud.spin = on; var b = root.querySelector('[data-a="spin"]'); if (b) b.classList.toggle('on', on); }
  setSpin(true);
  root.querySelector('.mm-ctl').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; var a = b.dataset.a, u = M.body.ud;
    if (a === 'front') { u.tgt = 0; setSpin(false); } else if (a === 'back') { u.tgt = Math.PI; setSpin(false); } else if (a === 'spin') setSpin(!u.spin);
    else if (a === 'zi' || a === 'zo') { u.zoom = clamp((u.zoom || 1) * (a === 'zi' ? 1.2 : .83), .8, 2.4); if (u.zoom <= 1.05) { u.fx = 0; u.fy = 0; u.fz = 0; } else { u.fy = .1; } }
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
H.map = { cfg: CFG, recovery: recovery, open: open, dayState: dayState, growth: growth, exRegs: exRegs, regions: R, rows: ROWS, _t: { drawMap: drawMap, mstate: mstate, buildMesh: buildMesh, shell: shell, render: render } };
if (D.readyState === 'complete' || D.readyState === 'interactive') hook(); else D.addEventListener('DOMContentLoaded', hook);
})();
