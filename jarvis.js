/* =====================================================================
   J.A.R.V.I.S. — voice assistant for the Discipline System
   ---------------------------------------------------------------------
   • ONE voice: the J.A.R.V.I.S. pack clips in jarvis/sounds/ (CC-BY-NC-4.0).
     No browser text-to-speech at all, so no second/female voice and no stutter.
   • Jarvis talks like in the films: a short spoken line ("At your service,
     sir"), the details appear on the HUD panel.
   • Clips are preloaded once, played from memory, and nothing heavy runs
     while he is speaking.
   • Wake word reacts on the first words you say (interim results), not after
     you stop talking.
   • HUD v4: arc-reactor orb, holographic panel with live telemetry (today %,
     streak, month %, next class), typed replies, colour tones per state.
   ===================================================================== */
(function () {
'use strict';
if (window.__jarvis) return;

/* ---------- config (edit freely) ---------- */
const BASE = 'jarvis/sounds/';
const LANG = 'en-IN';
// Which pack clips play for which situation. Change names here if you re-map clips.
const CLIPS = {
  wake:  ['acknowledge_2', 'acknowledge_3'],            // "Jarvis" heard
  ok:    ['acknowledge_4', 'acknowledge_5', 'acknowledge_1'], // command done / answered
  done:  ['complete_1'],
  cheer: ['complete_2', 'complete_3'],                  // good news
  err:   ['error_2', 'error_4'],                        // could not do it
  huh:   ['input_2'],                                   // did not understand
  warn:  ['input_5', 'input_16', 'input_20'],           // bad news / warnings
  hi:    ['session_start_1']                            // first greeting
};
const WAKE_ANY   = /\b(jarvis|jarvish|jarves|jarvas|jarvice|jervis|jarwis|javis|jarvi|jar vis|jar viz|jaar vis|gar vis)\b[\s,.!]*/;
const WAKE_START = /^(?:(?:hey|hi|ok|okay) )?(?:travis|davis|garvis|charvis|harvis)\b[\s,.!]*/;   // only at the very start (false-positive guard)

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const today = () => new Date();
const curTab = () => { const s = document.querySelector('.section.active'); return s ? s.id.replace('tab-', '') : 'home'; };
const idle = (fn, ms) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: ms || 3000 }) : setTimeout(fn, 60));
const HN = ['sleep', 'classes', 'self study', 'project work', 'gym', 'scrolling control', 'morning phone rule', 'night phone rule', 'water', 'skin care', 'reading', 'fruit'];
try { SYNC_LOCAL_ONLY.add('jv_wake'); SYNC_LOCAL_ONLY.add('jv_seen'); SYNC_LOCAL_ONLY.add('jv_mute'); } catch (e) { }

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const S = { wake: lsGet('jv_wake') === '1', active: false };
let muted = lsGet('jv_mute') === '1';
let locked = true, speaking = false, guardUntil = 0, touched = false, needUnlock = false, welcomed = false;
let rec = null, restartT = 0, fails = 0, startedAt = 0, idleT = 0, ackT = 0, evalT = 0, netMsgAt = 0;
let root, el = {};

/* =====================================================================
   UI
   ===================================================================== */
function build() {
  root = document.createElement('div');
  root.id = 'jv-root'; root.dataset.state = 'off';
  root.innerHTML =
    '<div id="jv-edge" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>' +
    '<div id="jv-pop" aria-live="polite"></div>' +
    '<div id="jv-panel" hidden role="dialog" aria-label="Jarvis">' +
      '<i class="jv-c tl"></i><i class="jv-c tr"></i><i class="jv-c bl"></i><i class="jv-c br"></i>' +
      '<div class="jv-top"><span class="jv-title">J.A.R.V.I.S.</span><span id="jv-state"></span>' +
        '<span class="jv-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
        '<button class="jv-ico" id="jv-sound" aria-label="Mute Jarvis" title="Voice on/off">&#128266;</button>' +
        '<button class="jv-ico" id="jv-close" aria-label="Close Jarvis">&#10005;</button></div>' +
      '<div class="jv-sub"><span>DISCIPLINE CORE // ONLINE</span><span id="jv-clock">--:--:--</span></div>' +
      '<div class="jv-tele" id="jv-tele" data-lv="lo" aria-hidden="true">' +
        '<div class="jv-ringbox"><svg viewBox="0 0 56 56"><circle class="tk" cx="28" cy="28" r="26"/><circle class="bg" cx="28" cy="28" r="22"/>' +
          '<circle class="fg" id="jv-ring" cx="28" cy="28" r="22" transform="rotate(-90 28 28)"/></svg>' +
          '<b><span id="jv-pct">0</span><em>%</em></b></div>' +
        '<div class="jv-stats">' +
          '<div><small>TODAY</small><b id="jv-today">0/0</b></div>' +
          '<div><small>STREAK</small><b id="jv-streak">0</b></div>' +
          '<div><small>MONTH</small><b id="jv-month">0%</b></div>' +
          '<div class="wide"><small>NEXT BLOCK</small><b id="jv-next">—</b></div></div></div>' +
      '<div id="jv-heard"></div><div id="jv-reply">At your service, sir.</div>' +
      '<div class="jv-chips">' +
        '<button type="button" data-c="what is left today">What’s left</button>' +
        '<button type="button" data-c="how am i doing">How am I doing</button>' +
        '<button type="button" data-c="next class">Next class</button>' +
        '<button type="button" data-c="start soul timer">Start timer</button></div>' +
      '<form id="jv-form" autocomplete="off"><input id="jv-in" placeholder="Type a command…" enterkeyhint="send"><button id="jv-go" type="submit">Go</button></form>' +
      '<div class="jv-hint">Say “Jarvis”, then: “tick gym and study”, “open reports”, “attended DAA”, “help”. Keep this tab open and in front.</div>' +
    '</div>' +
    '<div id="jv-dock" hidden>' +
      '<button class="jv-orb" id="jv-mic" aria-label="Talk to Jarvis" title="Tap to talk"><svg viewBox="0 0 64 64" aria-hidden="true">' +
        '<circle class="r3" cx="32" cy="32" r="30"/><circle class="r1" cx="32" cy="32" r="26"/>' +
        '<circle class="r2" cx="32" cy="32" r="20"/><circle class="r4" cx="32" cy="32" r="14.5"/>' +
        '<polygon class="tri" points="32,22.5 40.4,37 23.6,37"/><circle class="core" cx="32" cy="32" r="5"/></svg></button>' +
      '<button class="jv-wake" id="jv-wake" title="Always listen for the wake word “Jarvis”"><i></i>JARVIS</button>' +
    '</div>';
  document.body.appendChild(root);
  ['pop', 'panel', 'state', 'heard', 'reply', 'dock', 'mic', 'wake', 'sound', 'close', 'form', 'in', 'clock', 'tele', 'ring', 'pct', 'today', 'streak', 'month', 'next'].forEach(k => el[k] = $('jv-' + k));
}

const LABEL = { off: 'STANDBY', wake: 'SAY “JARVIS”', listen: 'LISTENING…', speak: 'SPEAKING' };
function setState() {
  const s = speaking ? 'speak' : S.active ? 'listen' : S.wake ? 'wake' : 'off';
  root.dataset.state = s;
  el.state.textContent = SR ? LABEL[s] : 'TYPE A COMMAND';
  el.wake.classList.toggle('on', S.wake);
  el.sound.classList.toggle('off', muted);
}
let heardRaf = 0, heardTxt = '';
function showHeard(t) { heardTxt = t; if (!heardRaf) heardRaf = requestAnimationFrame(() => { heardRaf = 0; el.heard.textContent = heardTxt; }); }
let typeRaf = 0;
function showReply(t) {                  // typed-out reveal (instant in Lite mode / reduced motion)
  cancelAnimationFrame(typeRaf); el.reply.classList.remove('typing');
  const calm = document.documentElement.classList.contains('fx-lite') || (window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches);
  if (calm || t.length < 6) { el.reply.textContent = t; return; }
  let i = 0; const stepBy = Math.max(2, Math.ceil(t.length / 60));
  el.reply.classList.add('typing');
  const step = () => { i = Math.min(t.length, i + stepBy); el.reply.textContent = t.slice(0, i); if (i < t.length) typeRaf = requestAnimationFrame(step); else el.reply.classList.remove('typing'); };
  step();
}
let clockT = 0;
const p2 = n => (n < 10 ? '0' : '') + n;
function tickClock() { const d = new Date(); el.clock.textContent = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); }
function updateHud() {                   // live telemetry strip — read-only, never throws
  try {
    const { t, tot, p, s } = summary();
    el.pct.textContent = p; el.ring.style.strokeDashoffset = (138.2 * (1 - Math.min(100, p) / 100)).toFixed(1);
    el.tele.dataset.lv = p >= 70 ? 'hi' : p >= 40 ? 'mid' : 'lo';
    el.today.textContent = t.done.length + '/' + tot;
    el.streak.textContent = (s.streak || 0) + 'd';
    el.month.textContent = (s.hasData ? s.hPct : 0) + '%';
    const nx = ttToday().find(x => !x.over);
    el.next.textContent = nx ? nx.at + ' · ' + nx.name : 'ALL CLEAR';
  } catch (e) { }
}
function openPanel() {
  if (el.panel.hidden) { el.panel.hidden = false; updateHud(); }
  if (!clockT) { tickClock(); clockT = setInterval(tickClock, 1000); }
}
function closePanel() { el.panel.hidden = true; showHeard(''); clearInterval(clockT); clockT = 0; cancelAnimationFrame(typeRaf); }
function armIdle(ms) { clearTimeout(idleT); idleT = setTimeout(sleep, ms); }
function sleep() {                       // back to wake-word mode (or fully off)
  clearTimeout(idleT); clearTimeout(ackT);
  S.active = false; closePanel(); root.dataset.tone = ''; setState();
  if (!want()) stopRec();
}

/* =====================================================================
   VOICE OUT — pack clips only (preloaded, played from memory)
   ===================================================================== */
const cache = {};
let cur = null, playTok = 0;
function clip(n) { return cache[n] || (cache[n] = Object.assign(new Audio(BASE + n + '.mp3'), { preload: 'auto' })); }
function preload() { Object.keys(CLIPS).forEach(k => CLIPS[k].forEach(clip)); }
function stopVoice() {
  playTok++;
  if (cur) { try { cur.pause(); } catch (e) { } clearTimeout(cur._t); cur = null; }
  speaking = false;
}
function say(kind) {
  if (muted || !CLIPS[kind]) return;
  stopVoice();
  const a = clip(pick(CLIPS[kind])), tok = ++playTok;
  cur = a; speaking = true; guardUntil = Infinity; setState();
  const fin = () => {
    if (tok !== playTok) return;
    a.onended = a.onerror = null; clearTimeout(a._t); cur = null;
    speaking = false; guardUntil = Date.now() + 450; setState();
  };
  a.onended = a.onerror = fin;
  try { a.currentTime = 0; } catch (e) { }
  a._t = setTimeout(fin, (isFinite(a.duration) && a.duration > 0 ? a.duration + .8 : 6) * 1000);
  const p = a.play();
  if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') needUnlock = true; fin(); });
}

/* =====================================================================
   LISTENING — continuous recognition, restarts itself, never talks over Jarvis
   ===================================================================== */
const want = () => !!SR && !document.hidden && !locked && (S.wake || S.active);
const ignored = new Set(), woke = new Set();
function start() {
  clearTimeout(restartT);
  if (rec || !want()) return;
  const r = rec = new SR();
  r.lang = LANG; r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
  r.onstart = () => { startedAt = Date.now(); ignored.clear(); woke.clear(); };
  r.onresult = onResult;
  r.onerror = onError;
  r.onend = () => {
    if (rec === r) rec = null;
    fails = Date.now() - startedAt < 1500 ? Math.min(fails + 1, 6) : 0;
    if (want()) restartT = setTimeout(start, Math.min(6000, 250 * Math.pow(2, fails)));
  };
  try { r.start(); } catch (e) { if (rec === r) rec = null; restartT = setTimeout(start, 1200); }
}
function stopRec() { clearTimeout(restartT); if (rec) { const r = rec; rec = null; try { r.abort(); } catch (e) { } } }
function onError(e) {
  const m = e && e.error;
  if (m === 'not-allowed' || m === 'service-not-allowed') {
    S.wake = false; S.active = false; lsSet('jv_wake', '0'); stopRec(); setState(); openPanel();
    showReply('The microphone is blocked, sir. Allow mic access for this site in the browser, or type a command below.');
  } else if (m === 'audio-capture') {
    openPanel(); showReply('No microphone found, sir.');
  } else if (m === 'network' && Date.now() - netMsgAt > 60000) {
    netMsgAt = Date.now(); openPanel(); showReply('Voice recognition needs an internet connection, sir.');
  }
}
function norm(t) {
  const nums = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return t.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, m => nums[m]).replace(/\s+/g, ' ').trim();
}
function wakeHit(res) {                  // checks every alternative the recogniser offers
  for (let k = 0; k < res.length; k++) { const n = norm(res[k].transcript); if (WAKE_ANY.test(n) || WAKE_START.test(n)) return true; }
  return false;
}
function stripWake(n) {                  // remove a leading wake word
  let m = WAKE_ANY.exec(n); if (m && m.index < 4) return n.slice(m.index + m[0].length).trim();
  m = WAKE_START.exec(n); return m ? n.slice(m[0].length).trim() : n;
}
let lastCmd = '', lastT = 0;
function onResult(e) {
  const now = Date.now();
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    if (ignored.has(i)) { if (res.isFinal) ignored.delete(i); continue; }
    if (now < guardUntil) { if (!res.isFinal) ignored.add(i); continue; }      // that is Jarvis's own voice
    const txt = res[0].transcript.trim(); if (!txt) continue;
    if (!S.active) {                                                         // waiting for the wake word
      if (!wakeHit(res)) { continue; }
      if (!woke.has(i)) { woke.add(i); activate(); }
    }
    if (!res.isFinal) { showHeard(txt); continue; }
    woke.delete(i);
    const cmd = stripWake(norm(txt));
    if (!cmd) continue;                                                      // just "Jarvis"
    if (cmd === lastCmd && now - lastT < 1500) continue;
    lastCmd = cmd; lastT = now; run(cmd, txt);
  }
}
function activate() {                                                       // wake word heard (first words, not end of sentence)
  S.active = true; root.dataset.tone = ''; openPanel(); setState(); showReply('At your service, sir.');
  clearTimeout(ackT); ackT = setTimeout(() => say(welcomed ? 'wake' : 'hi'), 600);   // skipped if a command follows right away
  welcomed = true; armIdle(10000);
}

/* =====================================================================
   READERS — habits, timetable, stats
   ===================================================================== */
function hState(dt, i) {
  const h = HABITS[i], dow = dt.getDay(), key = `habit_${dt.getFullYear()}_${dt.getMonth()}_${i}_${dt.getDate()}`;
  if (isExempt(h, dow) || excHabitSkipped(dt, h)) return 'na';
  if (h.id === 'gym') { const g = gymHabitState(dt, key); if (g) return g.kind === 'rest' || g.kind === 'exception' ? 'na' : g.kind === 'done' ? 'done' : g.kind === 'missed' ? 'missed' : 'pending'; }
  const v = localStorage.getItem(key);
  if (h.type === 'tristate') return v === 'YES' || v === 'MET' ? 'done' : 'pending';
  if (h.type === 'scroll_numeric') return parseInt(v || '0') === 0 ? 'done' : 'missed';
  return v === 'true' ? 'done' : 'pending';
}
function todayState() {
  const d = today(), r = { done: [], left: [], missed: [] };
  HABITS.forEach((h, i) => { const s = hState(d, i); if (s !== 'na') r[s === 'done' ? 'done' : s === 'missed' ? 'missed' : 'left'].push(i); });
  return r;
}
function ttToday() {
  const d = today(), iso = isoDate(d), now = new Date();
  return eventsFor(d, readJSON('custom_tt_events', {})).sort((a, b) => a.time.localeCompare(b.time)).map(ev => ({ ev, st: getTTState(iso, ev.id), over: eventEnd(d, ev) <= now, name: ev.title.replace(/^[^\w(]+/, '').replace(/ ->.*/, ''), at: ev.time.split('-')[0] }));
}
function habitRate(i) {
  const n = today(), st = startOfDay(parseISO(getStartISO())); let done = 0, tot = 0;
  for (let d = new Date(n.getFullYear(), n.getMonth(), 1); d <= n; d.setDate(d.getDate() + 1)) {
    if (d < st) continue; const s = hState(d, i); if (s === 'na') continue;
    if (d.toDateString() === n.toDateString() && s === 'pending') continue; tot++; if (s === 'done') done++;
  }
  return { done, tot, pct: pctOf(done, tot) };
}
function summary() {
  const t = todayState(), tot = t.done.length + t.left.length + t.missed.length;
  return { t, tot, p: pctOf(t.done.length, tot), s: getComputedStats() };
}

/* =====================================================================
   ACTIONS — the heavy re-render is deferred so his voice starts first
   ===================================================================== */
let refT = 0;
function refresh() { clearTimeout(refT); refT = setTimeout(() => { try { renderTabContent(curTab(), true); } catch (e) { } try { renderExecutionGrid(); } catch (e) { } }, 250); }

const ALIAS = [
  ['no_phone_morning', /\b(morning (phone|no phone)|no phone (in the |first )?morning|phone (in the )?morning)\b/],
  ['no_phone_night', /\b(night (phone|no phone)|no phone (at |last )?night|phone (at |in the )?night)\b/],
  ['sleep', /\b(sleep|slept|sleeping)\b/], ['study', /\b(stud(y|ied|ying)|self study)\b/], ['project_work', /\bprojects?\b/],
  ['gym', /\b(gym|workout|work out|exercise|exercised|training)\b/], ['media_scroll', /\b(scroll\w*|doomscroll\w*|reels|instagram|social media|urge control)\b/],
  ['water', /\b(water|hydrat\w*|3 ?l|litres?|liters?)\b/], ['skin_care', /\b(skin ?care|skin|face wash|moisturi[sz]er)\b/],
  ['reading', /\b(read|reading|book)\b/], ['fruit', /\b(fruits?|apple|banana)\b/], ['classes', /\b(classes|class|college|lectures?)\b/]
];
const habitsIn = n => ALIAS.filter(a => a[1].test(n)).map(a => habitIdx(a[0]));

function setHabit(i, on) {
  const h = HABITS[i], d = today(), iso = isoDate(d), key = habitKeyFor(d, h.id), nm = HN[i], st = hState(d, i);
  if (h.id === 'gym') {
    const plan = gymPlanFor(iso); if (plan && plan.type !== 'workout') return 'Today is a rest day, sir. No gym to log.';
    if (on && st === 'done') return 'Gym is already marked done.'; if (!on && st !== 'done') return 'Gym is not marked done.';
    if (getGymStatusRaw(iso) || on) gymMark('done', iso); else localStorage.setItem(key, 'false');
    return on ? 'Gym marked done.' : 'Gym unticked.';
  }
  if (st === 'na') return `${nm} is excused today.`;
  if ((st === 'done') === on) return `${nm} is already ${on ? 'done' : 'not done'}.`;
  localStorage.setItem(key, h.type === 'tristate' ? (on ? 'YES' : 'NO') : String(on));
  try { linkHabitToTT(d, h.id); } catch (e) { }
  return `${nm} ${on ? 'ticked' : 'unticked'}.`;
}
function setScroll(n) {
  const d = today(), key = habitKeyFor(d, 'media_scroll'); let extra = '';
  localStorage.setItem(key, String(n));
  if (n > 0) { const made = assignPunishment(`Level ${n} slip — Urge Control`, SCROLL_SENTENCES[n], `pun_scroll${n}_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`); extra = made ? ` Penalty assigned: ${SCROLL_SENTENCES[n]}` : ' That penalty was already issued today.'; }
  return n === 0 ? 'Scrolling control back to level 0.' : `Scrolling logged at level ${n}.${extra}`;
}
const SUBJ = { OS: /\b(os|operating systems?)\b/, COA: /\b(coa|computer organi[sz]ation)\b/, DAA: /\b(daa|algorithms?)\b/, Frontend: /\bfront ?end\b/, DCN: /\b(dcn|data communications?)\b/ };
function markClass(n, state) {
  const sub = Object.keys(SUBJ).find(k => SUBJ[k].test(n)); if (!sub) return null;
  const iso = isoDate(today()), evs = ttToday().filter(x => x.ev.subCode === sub);
  if (!evs.length) return `There is no ${sub} class on today's timetable, sir.`;
  const x = evs.find(e => e.st !== state) || evs[0];
  if (x.st === state) return `${sub} is already marked ${state === 'completed' ? 'attended' : 'missed'}.`;
  const before = readJSON('punishment_list', []).length; ttMark(state, iso, x.ev.id);
  return state === 'completed' ? `${sub} marked attended.` : `${sub} marked missed.` + (readJSON('punishment_list', []).length > before ? ' A penalty was assigned.' : '');
}
const TABS = [['hard-truth', /hard truth|\btruth\b/], ['soul', /soul|timer|deep work/], ['tick', /daily grid|\bgrid\b|habits?|tick sheet/], ['timetable', /time ?table|schedule/], ['exceptions', /exceptions?|away|leave/], ['gym', /\b(gym|workout)\b/], ['wardrobe', /wardrobe|clothes|closet/], ['laundry', /laundry/], ['punishment', /punish\w*|penalt\w*/], ['report', /reports?/], ['insights', /insights?|analytics|statistics/], ['achievements', /achievements?|badges?|trophies/], ['aar', /\baar\b|weekly|debrief/], ['home', /\bhome\b|dashboard|main page/]];
const TNAME = { 'hard-truth': 'Hard Truth', soul: 'Soul Timer', tick: 'Daily Grid', timetable: 'Time Table', exceptions: 'Exceptions', gym: 'Gym', wardrobe: 'Wardrobe', laundry: 'Laundry', punishment: 'Punishment', report: 'Reports', insights: 'Insights', achievements: 'Achievements', aar: 'Weekly AAR', home: 'Home' };

/* =====================================================================
   THE BRAIN — short, film-style answers.  R(text, clipKind)
   ===================================================================== */
const R = (t, c) => ({ t, c: c === undefined ? 'ok' : c });
function exec(n) {
  let m;
  if (/^(stop|quit jarvis|exit|close|cancel|goodbye|bye|go to sleep|thats all|dismiss|never ?mind|im done|thank(s| you)( jarvis)?)$/.test(n)) return Object.assign(R('Very good, sir.'), { close: true });
  if (/\b(help|what can you do|commands)\b/.test(n)) return R('Tick or untick habits (“tick gym and study”), mark classes (“attended DAA”), open any tab (“open reports”), run the Soul Timer. Ask me: what’s left, how am I doing, my streak, attendance, weakest habit, next class, penalties.');
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening)|are you there|you there|you up)$/.test(n)) return R('For you, sir, always.', 'wake');
  // soul timer
  if (/\b(timer|soul|session|deep work)\b/.test(n) && !/^(open|go to|show|take me)/.test(n)) {
    if (/\b(quit|give up|abort|cancel)\b/.test(n)) { if (!timerStarted) return R('No session is running, sir.', 'err'); quitTimerWithGoggins(); return R('Session abandoned. A penalty has been assigned.', 'err'); }
    if (/\b(pause|stop|hold)\b/.test(n)) { if (!timerRunning) return R('The timer is not running, sir.', 'err'); toggleTimer(); return R('Timer paused.'); }
    if (/\b(start|begin|resume|run|launch)\b/.test(n)) { if (timerRunning) return R('The timer is already running, sir.', 'err'); const min = /\b30\b/.test(n) ? 30 : /\b90\b/.test(n) ? 90 : 0; if (min && !timerStarted) setTimerDuration(min); toggleTimer(); return R(`Timer running, ${Math.round(timerRemainingSec / 60)} minutes on the clock. Focus, sir.`); }
    if (m = /\b(set|change|make)\b.*\b(30|90)\b/.exec(n)) { if (timerStarted) return R('Finish or quit the current session first, sir.', 'err'); setTimerDuration(+m[2]); return R(`Timer set to ${m[2]} minutes.`); }
    if (/\b(left|remaining|status|how (much|long)|souls|sessions)\b/.test(n)) { const ss = parseInt(localStorage.getItem('timer_sessions') || '0'); return R((timerStarted ? `${Math.ceil(timerRemainingSec / 60)} minutes remaining${timerRunning ? '' : ', paused'}. ` : 'No session is running. ') + `${plural(ss, 'soul')} taken so far.`); }
  }
  // class attendance
  if (/\b(attended|attend|present|bunked|bunk|missed|skipped|absent)\b/.test(n) && !/\b(can i|how many|attendance|percent)\b/.test(n) && !habitsIn(n).includes(habitIdx('gym'))) {
    const r = markClass(n, /\b(bunked|bunk|missed|skipped|absent)\b/.test(n) ? 'missed' : 'completed'); if (r) { refresh(); return R(r, /missed|already|no /i.test(r) ? 'err' : 'ok'); }
  }
  // habits: tick / untick (statements, not questions)
  const isQ = /^(what|whats|which|how|did i|have i|do i|am i|is |are |tell me|any|status|show me my|whos|when)/.test(n) || /\?/.test(n);
  const hs = habitsIn(n);
  if (!isQ && hs.length) {
    const neg = /\b(untick|uncheck|unmark|undo|remove|clear|not done|didnt|did not|havent|have not|wasnt|reset)\b/.test(n);
    const pos = /\b(tick|check|mark|complete|completed|finish|finished|done|did|log|had|drank|ate|read|slept|studied|worked|went|add)\b/.test(n);
    if (neg || pos || /level|slip|zero|clean|scrolled|missed|skipped/.test(n)) {
      const out = [];
      hs.forEach(i => {
        if (HABITS[i].id === 'media_scroll') {
          const lv = /level (\d)/.exec(n), slip = /\b(slip|slipped|scrolled|failed|lost|doomscrolled)\b/.test(n);
          out.push(setScroll(lv ? Math.min(3, +lv[1]) : neg || /zero|clean|control/.test(n) ? 0 : slip ? 1 : 0));
        } else if (HABITS[i].id === 'gym' && /\b(missed|skipped|skip|bunked)\b/.test(n) && !neg) {
          const iso = isoDate(today()); if (getGymStatusRaw(iso) !== 'missed') gymMark('missed', iso); out.push('Gym marked missed.');
        } else out.push(setHabit(i, !neg));
      });
      refresh();
      return R(out.join(' '), out.some(x => /ticked|marked done|unticked|level 0|logged at level/i.test(x)) ? 'ok' : 'err');
    }
  }
  // navigation
  if ((/\b(open|go to|goto|show|take me to|switch to|navigate|launch|view|visit|bring up|display)\b/.test(n) && !/\b(left|done|streak|how|doing)\b/.test(n)) || (n.split(' ').length <= 3 && TABS.some(t => t[1].test(n)) && !isQ && !/\b(weak\w*|worst|strong\w*|best|left|streak|attendance|doing|punish\w*|penalt\w*)\b/.test(n))) {
    const t = TABS.find(x => x[1].test(n)); if (t) { switchTab(t[0]); return R(`Opening ${TNAME[t[0]]}, sir.`); }
  }
  if (/\b(change|switch|toggle)\b.*\btheme\b/.test(n)) { toggleTheme(); return R('Theme switched.'); }
  if (/\b(lock|log me out)\b/.test(n)) { setTimeout(lockApp, 900); return R('Locking the system, sir.'); }
  if (/\b(serve|clear|mark)\b.*\bpunish\w*|\bpunish\w*.*\bserved\b/.test(n)) {
    const l = readJSON('punishment_list', []).filter(p => !p.served); if (!l.length) return R('You have no active penalties, sir.', 'done');
    l.forEach(p => servePunishment(p.id)); refresh(); return R(`${plural(l.length, 'penalty')} marked as served. Do try not to earn more.`, 'done');
  }
  // questions
  if (/\b(punish\w*|penalt\w*)\b/.test(n)) {
    const l = readJSON('punishment_list', []).filter(p => !p.served);
    return l.length ? R(`${plural(l.length, 'active penalty')}: ${list(l.slice(0, 3).map(p => p.reason))}.\nLatest sentence: ${l[0].sentence}`, 'warn') : R('No active penalties, sir. Keep it that way.', 'cheer');
  }
  if (/\b(streak|chain)\b/.test(n)) { const s = getComputedStats(); return s.streak > 0 ? R(`Streak: ${plural(s.streak, 'day')}. Your best is ${s.bestStreak}.`, 'cheer') : R(`No active streak, sir. Your best was ${s.bestStreak}. Reach ${STREAK_MIN_PCT} percent today to start one.`, 'warn'); }
  if (/\b(attendance|bunk|bunks|can i skip)\b/.test(n)) {
    const bd = bunkData(), sub = Object.keys(SUBJ).find(k => SUBJ[k].test(n));
    const info = k => { const o = bd[k], p = o.total ? Math.round(o.attended / o.total * 100) : 100, al = Math.max(0, Math.floor(o.attended / .75 - o.total)), need = Math.max(0, Math.ceil(3 * o.total - 4 * o.attended)); return { k, p, al, need }; };
    if (sub && bd[sub]) { const i = info(sub); return i.p >= 75 ? R(`${sub} attendance is ${i.p} percent. You can still bunk ${plural(i.al, 'class')}.`) : R(`${sub} attendance is ${i.p} percent, below 75. Attend the next ${i.need} classes to recover.`, 'warn'); }
    const all = Object.keys(bd).map(info), low = all.filter(x => x.p < 75);
    return R(`Attendance: ${list(all.map(x => `${x.k} ${x.p}%`))}. ` + (low.length ? `Danger in ${list(low.map(x => x.k))}.` : 'All subjects are above 75 percent.'), low.length ? 'warn' : 'ok');
  }
  if (/\b(weak\w*|worst|struggl\w*|bad at|neglect\w*|strong\w*|best habit|good at)\b/.test(n)) {
    const rs = HABITS.map((h, i) => ({ i, r: habitRate(i) })).filter(x => x.r.tot > 0).sort((a, b) => a.r.pct - b.r.pct);
    if (!rs.length) return R('No data this month yet, sir.', 'err');
    if (/strong|best|good/.test(n)) { const b = rs[rs.length - 1]; return R(`Your strongest habit is ${HN[b.i]}, at ${b.r.pct} percent this month.`, 'cheer'); }
    return R(`Weakest links this month: ${list(rs.slice(0, 2).map(x => `${HN[x.i]} at ${x.r.pct}%`))}. Fix those first.`, 'warn');
  }
  if (/\b(left|pending|remaining|todo|to do|yet to|not done|still need|undone)\b/.test(n) || /what (do i|should i|else)/.test(n)) {
    const { t } = summary(), tt = ttToday().filter(x => x.st === 'pending' && !x.over).slice(0, 4);
    if (!t.left.length && !tt.length) return R('Nothing left today, sir. A flawless day.', 'cheer');
    let s = t.left.length ? `${plural(t.left.length, 'habit')} left: ${list(t.left.map(i => HN[i]))}.` : 'All habits are done.';
    if (tt.length) s += `\nComing up: ${list(tt.map(x => `${x.name} at ${x.at}`))}.`; return R(s);
  }
  if (/\b(done|did|completed|finished|accomplished|achieved|so far)\b/.test(n) && /\b(what|which|how much|how many|today|so far)\b/.test(n)) {
    const { t, tot } = summary(), tt = ttToday().filter(x => x.st === 'completed');
    return t.done.length ? R(`Done today: ${list(t.done.map(i => HN[i]))}.\n${t.done.length} of ${tot} habits` + (tt.length ? `, plus ${plural(tt.length, 'timetable block')}.` : '.')) : R('Nothing logged yet today, sir. Shall we begin?', 'warn');
  }
  if (/\b(doing|progress|score|perform\w*|how am i|summary|status|overview|report card|today)\b/.test(n) && !/\b(workout|class|timetable|schedule)\b/.test(n)) {
    const { t, tot, p, s } = summary(), verdict = p >= 85 ? 'Excellent work.' : p >= 70 ? 'Decent, but you can do better.' : p >= 40 ? 'Below standard. Pick up the pace.' : 'This is going badly. Act now.';
    return R(`Today: ${t.done.length} of ${tot} habits, ${p}%. ${verdict}\nStreak ${s.streak} days. This month ${s.hPct}%.` + (s.activePenalties ? ` ${plural(s.activePenalties, 'penalty')} pending.` : ''), p >= 70 ? 'cheer' : 'warn');
  }
  if (/\bmonth\b/.test(n)) { const s = getComputedStats(); return R(`This month you are at ${s.hPct} percent. ${s.hPct >= 85 ? 'Grid dominator territory.' : 'Target is 85.'}`, s.hPct >= 85 ? 'cheer' : 'ok'); }
  if (/\b(next|upcoming|class(es)?|timetable|schedule|lecture)\b/.test(n)) {
    const tt = ttToday(), up = tt.filter(x => !x.over), nx = /next/.test(n);
    if (!tt.length) return R('Nothing is scheduled today, sir.');
    return R(up.length ? `${nx ? 'Next' : 'Remaining today'}: ${list(up.slice(0, nx ? 1 : 5).map(x => `${x.name} at ${x.at}`))}.` : 'Your schedule is complete for today, sir.');
  }
  if (/\b(workout|gym|exercise)\b/.test(n)) { const p = gymPlanFor(isoDate(today())); return R(p ? (p.type === 'workout' ? `Today is ${p.title.replace(/^\S+\s/, '')}, ${p.variant}.` : 'Today is a rest day, sir.') : 'No gym plan for today.'); }
  if (/\b(time|date|day)\b/.test(n)) { const d = today(); return R(`It is ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, ${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}.`); }
  if (/\b(motivat\w*|quote|inspire|encourage|push me)\b/.test(n)) { const x = pick(MASTER_QUOTES), c = x.lastIndexOf(' — '); return R(c > -1 ? x.slice(0, c) : x, 'cheer'); }
  if (/\b(who are you|your name)\b/.test(n)) return R('J.A.R.V.I.S., sir. A rather discerning discipline system.', 'wake');
  if (hs.length) { const d = today(); return R(list(hs.map(i => `${HN[i]} is ${({ done: 'done', missed: 'missed', na: 'excused today', pending: 'still pending' })[hState(d, i)]}`)) + '.'); }
  return R('I did not quite catch that, sir. Say “help” for what I can do.', 'huh');
}
function run(n, raw) {
  clearTimeout(ackT);
  openPanel(); showHeard('“' + (raw || n) + '”');
  const res = n.split(/\s+(?:and then|then|after that)\s+/).map(p => { try { return exec(p.trim()); } catch (e) { console.error(e); return R('Something went wrong with that one, sir.', 'err'); } });
  const txt = res.map(r => r.t).join('\n'); showReply(txt);
  const kinds = res.map(r => r.c); say(kinds.includes('err') ? 'err' : kinds[0] || 'ok');
  root.dataset.tone = kinds.some(k => k === 'err' || k === 'warn' || k === 'huh') ? 'bad' : '';
  updateHud(); setTimeout(updateHud, 450);       // after the deferred re-render has saved the tick
  if (res.some(r => r.close)) { setTimeout(sleep, 1200); return; }
  armIdle(9000 + Math.min(8000, txt.length * 40));
}

/* =====================================================================
   ACHIEVEMENT & WARNING POPUPS — event-driven, run only when idle
   ===================================================================== */
function popup(kind, icon, title, body) {
  if (el.pop.children.length >= 3) return;
  const c = document.createElement('div'); c.className = 'jv-card' + (kind === 'bad' ? ' bad' : '');
  c.innerHTML = '<div class="ic"></div><div><b></b><span></span><small>TAP TO HEAR JARVIS</small></div><button class="cx" aria-label="Dismiss">&#10005;</button><i class="pg"></i>';
  c.querySelector('.ic').textContent = icon; c.querySelector('b').textContent = title; c.querySelector('span').textContent = body;
  el.pop.appendChild(c);
  const kill = () => c.remove(); setTimeout(kill, 40000);
  c.querySelector('.cx').onclick = ev => { ev.stopPropagation(); kill(); };
  c.onclick = () => { kill(); say(kind === 'bad' ? 'warn' : 'cheer'); };
}
function evaluate() {
  if (locked || document.hidden) return;
  if (speaking || S.active) { schedEval(20000); return; }
  let seen; try { seen = JSON.parse(lsGet('jv_seen') || 'null'); } catch (e) { }
  const first = !seen; seen = seen || {}; const out = [], d = today(), iso = isoDate(d), ym = iso.slice(0, 7), hr = d.getHours();
  const add = (k, kind, icon, title, body, silent) => { if (seen[k]) return; seen[k] = 1; if (!silent) out.push([kind, icon, title, body]); };
  try {
    const s = getComputedStats(), { t, tot, p } = summary();
    [3, 7, 14, 21, 30, 50, 100].forEach(N => { if (s.streak >= N) add('streak_' + N, 'win', '🔥', `${N}-day streak!`, 'Magnificent, sir. The chain stays alive.', first); });
    if (tot > 3 && !t.left.length && !t.missed.length) add('perfect_' + iso, 'win', '🏆', 'Perfect day', 'Every habit is complete. A flawless performance, sir.');
    if (hState(d, habitIdx('gym')) === 'done') add('gym_' + iso, 'win', '🏋️', 'Gym done', 'Well done, sir. You did not stop when you were tired.');
    if (s.sessions > 0) add('soul_' + s.sessions, 'win', '💀', 'Soul taken', `${plural(s.sessions, 'session')} completed in total.`, first);
    if (s.hasData && s.hPct >= 85 && d.getDate() >= 5) add('grid85_' + ym, 'win', '📈', 'Grid Dominator', `${s.hPct}% of this month's habits done.`, first);
    if (s.activePenalties) add('pun_' + iso, 'bad', '⚠️', `${plural(s.activePenalties, 'penalty')} pending`, 'Serve them before they pile up, sir.');
    if (hState(d, habitIdx('media_scroll')) === 'missed') add('scr_' + iso, 'bad', '📵', 'You slipped on scrolling', 'Put the phone down and get back to work, sir.');
    if (hState(d, habitIdx('gym')) === 'missed') add('gymm_' + iso, 'bad', '🛑', 'Gym missed', 'That is not the standard. Tomorrow, no excuses.');
    if (hr >= 18 && tot && p < STREAK_MIN_PCT) add('risk_' + iso, 'bad', '⏳', s.streak ? `${s.streak}-day streak at risk` : 'Day is slipping', `Only ${p}% done. Finish ${list(t.left.slice(0, 3).map(i => HN[i]))}.`);
    if (hr >= 12 && s.hasData && s.hPct < 60 && d.getDate() >= 5) add('low_' + iso, 'bad', '📉', 'Month is going badly', `Only ${s.hPct}% this month. Fix your routine, sir.`);
    try { const bd = bunkData(); Object.keys(bd).forEach(k => { const o = bd[k], pc = o.total ? Math.round(o.attended / o.total * 100) : 100; if (pc < 75) add('att_' + iso + k, 'bad', '🎓', `${k} attendance ${pc}%`, 'Below the 75% safe line. Attend every class from now.'); }); } catch (e) { }
  } catch (e) { console.warn('Jarvis evaluate', e); }
  const keys = Object.keys(seen); if (keys.length > 400) keys.slice(0, keys.length - 300).forEach(k => delete seen[k]);
  lsSet('jv_seen', JSON.stringify(seen));
  out.slice(0, 3).forEach(o => popup(...o));
  if (out.length && touched && !muted) say(out.some(o => o[0] === 'bad') ? 'warn' : 'cheer');   // one line, no matter how many popups
}
function schedEval(ms) { clearTimeout(evalT); evalT = setTimeout(() => idle(evaluate, 5000), ms); }

/* =====================================================================
   WIRING
   ===================================================================== */
function wire() {
  el.mic.onclick = () => {
    if (!SR) { openPanel(); showReply('This browser has no speech recognition (use Chrome or Edge). You can still type or tap a command below.'); setState(); return; }
    if (S.active && !el.panel.hidden) { sleep(); return; }
    S.active = true; openPanel(); showHeard(''); showReply('Listening, sir…'); setState();
    clearTimeout(ackT); say(welcomed ? 'wake' : 'hi'); welcomed = true; armIdle(12000); start();
  };
  el.wake.onclick = () => {
    if (!SR) { openPanel(); showReply('The wake word needs Chrome or Edge. Firefox has no speech recognition.'); return; }
    S.wake = !S.wake; lsSet('jv_wake', S.wake ? '1' : '0');
    if (S.wake) { start(); say(welcomed ? 'wake' : 'hi'); welcomed = true; openPanel(); showReply('Wake word on, sir. Say “Jarvis” any time. Keep this tab open and in front.'); armIdle(5000); }
    else if (!S.active) stopRec();
    setState();
  };
  el.close.onclick = sleep;
  el.sound.onclick = () => { muted = !muted; lsSet('jv_mute', muted ? '1' : '0'); if (muted) stopVoice(); setState(); };
  el.form.onsubmit = e => { e.preventDefault(); const v = el['in'].value.trim(); if (!v) return; el['in'].value = ''; run(stripWake(norm(v)) || norm(v), v); };
  el['in'].addEventListener('input', () => armIdle(30000));
  el.panel.addEventListener('click', e => { const b = e.target.closest('.jv-chips button'); if (b) run(norm(b.dataset.c), b.textContent); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.panel.hidden) sleep(); });
  const touch = () => { touched = true; if (needUnlock && !muted) { needUnlock = false; say('wake'); } preload(); };
  addEventListener('pointerdown', touch, { once: true, passive: true });
  addEventListener('keydown', touch, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopRec(); stopVoice(); setState(); }
    else { start(); schedEval(1500); }
  });
}

/* Lock screen: show the dock only once the app is unlocked. A page lock reloads the page,
   so a short poll runs only until the first unlock. */
function checkLock() {
  const l = $('login-screen');
  const now = !!l && l.isConnected && l.style.display !== 'none' && getComputedStyle(l).display !== 'none';
  if (now === locked) return;
  locked = now; el.dock.hidden = locked;
  if (locked) { stopRec(); return; }
  clearInterval(lockPoll);
  if (S.wake) { start(); }
  idle(preload, 4000); schedEval(4000);
}
let lockPoll = 0;

function init() {
  build(); wire();
  el.dock.hidden = true; setState();
  checkLock();
  if (locked) { lockPoll = setInterval(checkLock, 1500); }
  setInterval(() => schedEval(0), 180000);          // gentle re-check every 3 min, only while idle
}
window.__jarvis = { run: t => run(norm(t), t), evaluate, say, exec };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
