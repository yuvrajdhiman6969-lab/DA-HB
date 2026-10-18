/* suggest.js v1 — automatic exercise suggestions inside the Gym log window (the one where you add sets / add extra exercises).
   Needs holo.js + musclemap.js loaded before it (it reuses the muscle-part map: HOLO.map.exRegs / HOLO.map.regions).

   How it decides (nothing to set up, it runs every time you open the log window):
     1. Looks at the last 14 days of what you really logged and credits every muscle PART (22 of them, e.g. rear delt, upper chest,
        lower abs) with the sets that hit it.
     2. Adds today's plan: every exercise still on today's list counts as ~3 sets, so it never suggests what the plan already covers.
        An exercise you marked "Couldn't do it" counts as zero, so its muscle shows up as a gap and a replacement is suggested.
     3. Picks the exercises from today's muscle groups that fill the biggest gaps (major muscles count more).
     4. v2: skips any exercise whose main muscle is still SORE (trained yesterday, see the RECOVERY view on the muscle map).
   You stay in control:  ✓ adds it (with the suggested number of empty set rows ready to fill)  ·  ✗ dismisses it.
   A dismissed one turns into a small red chip (↺ brings it back) and is remembered for that day; it is also ranked lower for a week.
   If a MAJOR muscle is far behind, Jarvis says one short line (once per day, only for today, only if he is allowed to talk).
   Tweak in the console:  HOLO.suggest.cfg.days / maxActive / planCredit / targetMajor / targetMinor / speak           */
(function () {
'use strict';
var H = window.HOLO, MM = H && H.map, D = document;
if (!MM || !MM.exRegs || !MM.regions) { if (window.console) console.warn('suggest.js needs holo.js and musclemap.js loaded first'); return; }
var esc = (H.kit && H.kit.esc) || function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

var CFG = {
  days: 14,            // look-back window
  targetMajor: 12,     // weighted sets per window for a big muscle part to count as "covered"
  targetMinor: 6,      // …and for a small one
  planCredit: 3,       // sets credited to every exercise still on today's list
  maxActive: 3,        // suggestions shown at once
  speak: true,         // let Jarvis say one short line when a major muscle is far behind
  behind: .25,         // coverage below this = "far behind"
  /* region ids (see HOLO.map.regions) that are MAJOR muscles */
  major: ['ch_up', 'ch_mid', 'lat', 'mb', 'dl_s', 'dl_r', 'bi_l', 'bi_s', 'tri_l', 'tri_o', 'quad', 'ham', 'glu']
};
var NAMES = { ch_up: 'upper chest', ch_mid: 'mid/lower chest', tr: 'traps', lat: 'lats', mb: 'mid back', lb: 'lower back', dl_f: 'front delt', dl_s: 'side delt', dl_r: 'rear delt',
  bi_l: 'biceps long head', bi_s: 'biceps short head', bi_b: 'brachialis', tri_l: 'triceps long head', tri_o: 'triceps side heads', fore: 'forearms',
  abs_u: 'upper abs', abs_l: 'lower abs', obl: 'obliques', quad: 'quads', ham: 'hamstrings', glu: 'glutes', calf: 'calves' };

var R = MM.regions, NR = R.length, MAJ = {};
CFG.major.forEach(function (id) { MAJ[id] = 1; });
function isMajor(i) { return !!MAJ[R[i][0]]; }
function rname(i) { return NAMES[R[i][0]] || R[i][1].toLowerCase(); }
function target(i) { return isMajor(i) ? CFG.targetMajor : CFG.targetMinor; }
function validSet(x) { return x && (typeof x.weight === 'number' || typeof x.reps === 'number'); }
function today() { return isoDate(new Date()); }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 864e5); }

/* ---------- per-day "dismissed" memory ---------- */
function noKey(iso) { return 'gym_sug_no_' + iso; }
function getNo(iso) { try { return JSON.parse(localStorage.getItem(noKey(iso)) || '[]') || []; } catch (e) { return []; } }
function setNo(iso, a) { try { if (a.length) localStorage.setItem(noKey(iso), JSON.stringify(a)); else localStorage.removeItem(noKey(iso)); } catch (e) { } }
function recentNo(iso) {           // exercises dismissed in the last 7 days (ranked lower, never hidden)
  var s = {}, i, a;
  for (i = 1; i <= 7; i++) { a = getNo(gymAddDays(iso, -i)); a.forEach(function (n) { s[n] = 1; }); }
  return s;
}

/* ---------- the analysis ---------- */
function analyse(iso, plan, list) {
  var hist = new Float32Array(NR), last = new Array(NR), sc = new Float32Array(NR), from = gymAddDays(iso, -CFG.days), i;
  gymCollectLogs().forEach(function (l) {
    if (l.iso < from || l.iso >= iso) return;
    MM.exRegs(l.name, l.group).forEach(function (r) { hist[r[0]] += l.sets * r[1]; if (!last[r[0]] || l.iso > last[r[0]]) last[r[0]] = l.iso; });
  });
  for (i = 0; i < NR; i++) sc[i] = hist[i];
  list.forEach(function (e) {
    if (e.skipped) return;
    var logged = getGymSets(iso, e.name).filter(validSet).length, credit = Math.max(logged, CFG.planCredit);
    MM.exRegs(e.name, e.group).forEach(function (r) { sc[r[0]] += credit * r[1]; });
  });
  return { hist: hist, last: last, sc: sc };
}
function cov(a, i) { return Math.min(1, a.sc[i] / target(i)); }

function suggest(iso) {
  var plan = gymPlanFor(iso);
  if (!plan || plan.type !== 'workout') return null;
  var list = gymDayExerciseList(iso, plan), have = {}, no = getNo(iso), noSet = {}, soft = recentNo(iso);
  list.forEach(function (e) { have[e.name] = 1; });
  no.forEach(function (n) { noSet[n] = 1; });
  var a = analyse(iso, plan, list), groups = plan.groups || [], cands = [], out = [], usedTop = {}, rv = null, soreSkip = {};
  try { if (MM.recovery) rv = MM.recovery(iso, true); } catch (e) { }          // sets logged TODAY never count as 'sore' here, only earlier days
  groups.forEach(function (g) {
    (GYM_CATALOG[g] || []).forEach(function (n) { if (!have[n] && !noSet[n]) cands.push({ name: n, group: g, regs: MM.exRegs(n, g), pen: soft[n] ? .5 : 1 }); });
  });
  function gap(i) { return Math.max(0, 1 - cov(a, i)) * (isMajor(i) ? 1.6 : 1); }
  for (var k = 0; k < CFG.maxActive; k++) {
    var best = null, bv = 0, top = -1;
    cands.forEach(function (c) {
      if (c.used) return;
      if (rv) { var sr = c.regs.filter(function (r) { return r[1] >= 1 && rv.rs[r[0]] === 3; }); if (sr.length) { sr.forEach(function (r) { soreSkip[rname(r[0])] = 1; }); return; } }      // main muscle still sore: skip
      var v = 0, t = -1, tv = 0;
      c.regs.forEach(function (r) { var g = r[1] * gap(r[0]); v += g; if (g > tv) { tv = g; t = r[0]; } });
      v *= c.pen;
      if (t >= 0 && usedTop[t]) return;                    // one suggestion per muscle part: no two calf raises in a row
      if (v > bv) { bv = v; best = c; top = t; }
    });
    if (!best || bv < .5) break;
    best.used = true; if (top >= 0) usedTop[top] = 1;
    var c0 = top >= 0 ? cov(a, top) : 1, maj = top >= 0 && isMajor(top);
    out.push({
      name: best.name, group: best.group, region: top, major: maj && c0 < .5, far: maj && c0 < CFG.behind,
      sets: (maj && c0 < CFG.behind) ? 4 : 3,
      why: top >= 0 ? rname(top) + ' · ' + (a.hist[top] < .5 ? 'not hit in ' + CFG.days + ' days' : (a.last[top] ? 'last hit ' + (function (d) { return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; })(daysBetween(a.last[top], iso)) : '')) : ''
    });
    best.regs.forEach(function (r) { a.sc[r[0]] += CFG.planCredit * r[1]; });          // later picks should cover other gaps
  }
  return { iso: iso, sore: Object.keys(soreSkip), items: out, crossed: no.filter(function (n) { return !have[n] && GYM_EX_INFO.has(n); }), plan: plan, onTrack: !out.length };
}

/* ---------- panel ---------- */
function css() {
  if (D.getElementById('sg-css')) return;
  var s = D.createElement('style'); s.id = 'sg-css';
  s.textContent =
    '#sg-card{margin:0 0 14px;padding:10px 10px 8px;border:1px solid var(--border-strong,rgba(56,189,248,.35));border-radius:12px;background:linear-gradient(180deg,rgba(56,189,248,.07),transparent 70%),var(--panel,transparent);position:relative}' +
    '#sg-card .sg-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
    '#sg-card .sg-head b{font-size:11.5px;letter-spacing:.16em;color:var(--primary,#38bdf8)}' +
    '#sg-card .sg-head small{margin-left:auto;font-size:10.5px;color:var(--muted,#8aa)}' +
    '#sg-card .sg-orb{width:9px;height:9px;border-radius:50%;background:var(--primary,#38bdf8);box-shadow:0 0 9px var(--primary,#38bdf8)}' +
    '#sg-card .sg-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border,rgba(255,255,255,.08))}' +
    '#sg-card .sg-txt{flex:1;min-width:0}' +
    '#sg-card .sg-txt b{font-size:13.5px;color:var(--text,#fff)}' +
    '#sg-card .sg-txt span{display:block;margin-top:2px;font-size:11.5px;line-height:1.3;color:var(--muted,#8aa)}' +
    '#sg-card .sg-maj{margin-left:6px;padding:1px 6px;border-radius:99px;font-size:9px;font-weight:700;line-height:1.5;letter-spacing:.1em;font-style:normal;color:var(--warn,#fbbf24);border:1px solid var(--warn,#fbbf24)}' +
    '#sg-card button{flex:none;width:40px;height:40px;border-radius:10px;font-size:18px;font-weight:700;line-height:1;cursor:pointer;background:transparent;-webkit-tap-highlight-color:transparent}' +
    '#sg-card .sg-ok{border:1.5px solid #46ff8c;color:#46ff8c}#sg-card .sg-ok:active{background:#46ff8c;color:#021}' +
    '#sg-card .sg-no{border:1.5px solid var(--danger,#ff4d5e);color:var(--danger,#ff4d5e)}#sg-card .sg-no:active{background:var(--danger,#ff4d5e);color:#fff}' +
    '#sg-card .sg-crossed{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-top:7px;border-top:1px solid var(--border,rgba(255,255,255,.08))}' +
    '#sg-card .sg-crossed i{font-style:normal;font-size:10px;letter-spacing:.1em;color:var(--danger,#ff4d5e);opacity:.8}' +
    '#sg-card .sg-crossed button{width:auto;height:auto;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:600;border:1px solid var(--danger,#ff4d5e);color:var(--danger,#ff4d5e);background:rgba(255,77,94,.08);text-decoration:line-through;text-decoration-color:rgba(255,77,94,.6)}' +
    '#sg-card .sg-sore{font-size:11px;color:var(--warn,#fbbf24);padding:0 0 6px;opacity:.9}' +
    '#sg-card .sg-ok-line{font-size:12px;color:#46ff8c;padding:4px 0 2px}' +
    '.gym-pick-chip.sg-star{border-color:var(--primary,#38bdf8);color:var(--primary,#38bdf8)}' +
    '@media (max-width:640px){#sg-card button{width:44px;height:44px}}';
  (D.head || D.documentElement).appendChild(s);
}
function panelHTML(S) {
  var h = '<div class="sg-head"><span class="sg-orb"></span><b>JARVIS SUGGESTS</b><small>based on your last ' + CFG.days + ' days · your call</small></div>';
  if (S.sore && S.sore.length) h += '<div class="sg-sore">Resting, still sore: ' + esc(S.sore.join(', ')) + '</div>';
  if (S.items.length) {
    h += S.items.map(function (x) {
      return '<div class="sg-row"><div class="sg-txt"><b>' + esc(x.name) + '</b>' + (x.major ? '<em class="sg-maj">MAJOR</em>' : '') +
        '<span>' + esc(x.why) + ' · add ' + x.sets + ' sets</span></div>' +
        '<button type="button" class="sg-ok" data-sug="yes" data-n="' + esc(x.name) + '" data-sets="' + x.sets + '" aria-label="Add ' + esc(x.name) + '">✓</button>' +
        '<button type="button" class="sg-no" data-sug="no" data-n="' + esc(x.name) + '" data-far="' + (x.far ? 1 : 0) + '" data-r="' + esc(x.region >= 0 ? rname(x.region) : '') + '" aria-label="Dismiss ' + esc(x.name) + '">✗</button></div>';
    }).join('');
  } else h += '<div class="sg-ok-line">✓ Every muscle part is covered by today’s list. Nothing to add.</div>';
  if (S.crossed.length) h += '<div class="sg-crossed"><i>DISMISSED</i>' + S.crossed.map(function (n) { return '<button type="button" data-sug="undo" data-n="' + esc(n) + '" title="Bring back">' + esc(n) + ' ↺</button>'; }).join('') + '</div>';
  return h;
}
var lastS = null;
function paint() {
  var body = D.getElementById('gym-modal-body'); if (!body) return;
  var old = D.getElementById('sg-card'); if (old) old.remove();
  var iso; try { iso = gymModalIso; } catch (e) { return; }
  if (!iso) return;
  var S; try { S = suggest(iso); } catch (e) { if (window.console) console.warn('suggest', e); return; }
  lastS = S; if (!S) return;
  css();
  var card = D.createElement('div'); card.id = 'sg-card'; card.innerHTML = panelHTML(S);
  body.insertBefore(card, body.firstChild);
  /* in the "Add extra exercise" list: star the exercises Jarvis would pick */
  var pick = {}; S.items.forEach(function (x) { pick[x.name] = 1; });
  body.querySelectorAll('.gym-pick-chip').forEach(function (c) { if (pick[c.dataset.name]) { c.classList.add('sg-star'); if (c.textContent.indexOf('★') < 0) c.textContent = '★ ' + c.textContent.replace(/^\+\s*/, '+ '); } });
}

/* ---------- Jarvis (one short line, never nagging) ---------- */
function jv() { return window.__jarvis && typeof window.__jarvis.nudge === 'function' ? window.__jarvis : null; }
function maybeSpeak(S) {
  if (!CFG.speak || !S || S.iso !== today() || !jv()) return;
  var far = S.items.filter(function (x) { return x.far; })[0]; if (!far) return;
  var key = 'gym_sug_said_' + S.iso; try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) { }
  var r = rname(far.region);
  jv().nudge('Sir, your ' + r + (/s$/.test(r) ? ' are' : ' is') + ' well behind. ' + far.name + ' would fix that.');
}

/* ---------- ticks and crosses ---------- */
function onClick(e) {
  var b = e.target.closest && e.target.closest('[data-sug]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  var iso = gymModalIso, n = b.dataset.n, act = b.dataset.sug;
  if (act === 'yes') {
    var no = getNo(iso).filter(function (x) { return x !== n; }); setNo(iso, no);
    gymAddExtra(n);                                                       // adds to today's list and redraws the window
    if (!getGymSets(iso, n).length) {
      var rows = [], k, cnt = Math.max(1, parseInt(b.dataset.sets) || 3);
      for (k = 0; k < cnt; k++) rows.push({ weight: '', reps: '' });
      saveGymSets(iso, n, rows); gymRefreshExerciseBlock(n);
    }
    var blk = D.querySelector('.gym-ex-block[data-ex="' + (window.CSS && CSS.escape ? CSS.escape(n) : n) + '"]');
    if (blk && blk.scrollIntoView) blk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (act === 'no') {
    var a = getNo(iso); if (a.indexOf(n) < 0) a.push(n); setNo(iso, a);
    paint();
    if (CFG.speak && iso === today() && b.dataset.far === '1' && jv()) { var rn = b.dataset.r || 'muscle'; jv().nudge('Skipping it, sir? Your ' + rn + (/s$/.test(rn) ? ' are' : ' is') + ' still behind.'); }
  } else if (act === 'undo') {
    setNo(iso, getNo(iso).filter(function (x) { return x !== n; })); paint();
  }
}

/* ---------- hook into the Gym log window ---------- */
function hook() {
  var body = D.getElementById('gym-modal-body');
  if (!body || typeof window.gymRenderModalBody !== 'function' || typeof window.openGymLogModal !== 'function') return false;
  if (!window.gymRenderModalBody.__sg) {
    var orig = window.gymRenderModalBody;
    var w = function () { var r = orig.apply(this, arguments); try { paint(); } catch (e) { if (window.console) console.warn('suggest', e); } return r; };
    w.__sg = true; window.gymRenderModalBody = w;
  }
  if (!window.openGymLogModal.__sg) {
    var o2 = window.openGymLogModal;
    var w2 = function () { var r = o2.apply(this, arguments); try { var iso = gymModalIso; setTimeout(function () { if (lastS && lastS.iso === iso) maybeSpeak(lastS); }, 900); } catch (e) { } return r; };
    w2.__sg = true; window.openGymLogModal = w2;
  }
  if (!body.__sg) { body.__sg = true; body.addEventListener('click', onClick, true); }      // capture: handled before the window's own click handler
  return true;
}
H.suggest = { cfg: CFG, run: suggest, paint: paint };
if (D.readyState === 'complete' || D.readyState === 'interactive') { if (!hook()) setTimeout(hook, 300); }
else D.addEventListener('DOMContentLoaded', function () { if (!hook()) setTimeout(hook, 300); });
})();
