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
const cap = x => x ? x[0].toUpperCase() + x.slice(1) : x;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const today = () => new Date();
const curTab = () => { const s = document.querySelector('.section.active'); return s ? s.id.replace('tab-', '') : 'home'; };
const idle = (fn, ms) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: ms || 3000 }) : setTimeout(fn, 60));
const HN = ['sleep', 'classes', 'self study', 'project work', 'gym', 'scrolling control', 'morning phone rule', 'night phone rule', 'water', 'skin care', 'reading', 'fruit'];
try { SYNC_LOCAL_ONLY.add('jv_wake'); SYNC_LOCAL_ONLY.add('jv_seen'); SYNC_LOCAL_ONLY.add('jv_mute'); SYNC_LOCAL_ONLY.add('jv_ai'); SYNC_LOCAL_ONLY.add('jv_model'); ['jv_voice', 'jv_rate', 'jv_vmode', 'jv_meter', 'jv_focus', 'jv_flast'].forEach(k => SYNC_LOCAL_ONLY.add(k)); } catch (e) { }

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TOUCH = !!(window.matchMedia && matchMedia('(pointer:coarse)').matches);
const S = { wake: lsGet('jv_wake') === '1', active: false };
let muted = lsGet('jv_mute') === '1';
let locked = true, speaking = false, guardUntil = 0, touched = false, needUnlock = false, welcomed = false;
let rec = null, restartT = 0, fails = 0, startedAt = 0, idleT = 0, ackT = 0, evalT = 0, netMsgAt = 0;
let root, el = {};
/* local AI state (WebLLM, runs on this device) */
let aiOn = lsGet('jv_ai') === '1', aiSmart = lsGet('jv_model') === 'smart';
let aiEngine = null, aiLoading = null, aiBusy = false, aiErr = '', aiHist = [], pendingAct = '', ttsU = null;
/* v7: speech engine state + live visualiser */
const synth = window.speechSynthesis;
const TTS = { q: [], cur: null, open: false, t: 0, rate: parseFloat(lsGet('jv_rate')) || 1, voice: lsGet('jv_voice') || '', full: lsGet('jv_vmode') !== 'clips' };
let env = 0, vizRaf = 0, bars = [];

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
      '<div class="jv-meter" aria-hidden="true"><i id="jv-lv"></i></div>' +
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
      '<div class="jv-ai"><button type="button" id="jv-ai" title="Free AI that runs on this device"></button><button type="button" id="jv-model" title="FAST = small model, SMART = bigger model (slower, better Hindi)"></button><button type="button" id="jv-voice" title="Change the Jarvis voice"></button><button type="button" id="jv-rate" title="Speaking speed"></button><button type="button" id="jv-meter" title="Live mic level + talk-over-him interrupt"></button><button type="button" id="jv-vmode" title="FULL = he speaks every answer, CLIPS = short film lines only"></button><span id="jv-aist"></span></div>' +
      '<div class="jv-aibar"><i id="jv-aibar"></i></div>' +
      '<div class="jv-chips"><button type="button" id="jv-c0" data-c="brief me">Briefing</button>' +
        '<button type="button" data-c="what is left today">What’s left</button>' +
        '<button type="button" data-c="how am i doing">How am I doing</button>' +
        '<button type="button" data-c="next class">Next class</button>' +
        '<button type="button" data-c="start soul timer">Start timer</button>' +
        '<button type="button" data-c="focus for 45 minutes">Focus 45</button>' +
        '<button type="button" data-c="give me advice to improve today">Advice</button></div>' +
      '<form id="jv-form" autocomplete="off"><input id="jv-in" placeholder="Type a command…" enterkeyhint="send"><button id="jv-go" type="submit">Go</button></form>' +
      '<div class="jv-hint">Say “Jarvis”, then: “tick gym and study”, “open reports”, “attended DAA”, “help”. Keep this tab open and in front. Turn on AI BRAIN for free-form questions, advice and Hinglish.</div>' +
    '</div>' +
    '<div id="jv-dock" hidden>' +
      '<button class="jv-orb" id="jv-mic" aria-label="Talk to Jarvis" title="Tap to talk"><svg viewBox="0 0 64 64" aria-hidden="true">' +
        '<circle class="r3" cx="32" cy="32" r="30"/><circle class="r1" cx="32" cy="32" r="26"/>' +
        '<circle class="r2" cx="32" cy="32" r="20"/><circle class="r4" cx="32" cy="32" r="14.5"/>' +
        '<polygon class="tri" points="32,22.5 40.4,37 23.6,37"/><circle class="core" cx="32" cy="32" r="5"/></svg><i class="jv-rip"></i></button>' +
      '<button class="jv-wake" id="jv-wake" title="Always listen for the wake word “Jarvis”"><i></i>JARVIS</button><button class="jv-fchip" id="jv-fchip" hidden title="Focus timer — tap for time left"></button>' +
    '</div>';
  document.body.appendChild(root);
  ['pop', 'panel', 'state', 'heard', 'reply', 'dock', 'mic', 'wake', 'sound', 'close', 'form', 'in', 'clock', 'tele', 'ring', 'pct', 'today', 'streak', 'month', 'next', 'ai', 'model', 'aist', 'aibar', 'voice', 'rate', 'vmode', 'c0', 'lv', 'meter', 'fchip'].forEach(k => el[k] = $('jv-' + k));
  bars = [].slice.call(root.querySelectorAll('.jv-bars i')); root.classList.add('viz');
}

const LABEL = { off: 'STANDBY', wake: 'SAY “JARVIS”', listen: 'LISTENING…', speak: 'SPEAKING', think: 'THINKING…' };
function setState() {
  const s = speaking ? 'speak' : (aiBusy || aiLoading) ? 'think' : S.active ? 'listen' : S.wake ? 'wake' : 'off';
  root.dataset.state = s;
  el.state.textContent = SR ? LABEL[s] : 'TYPE A COMMAND';
  el.wake.classList.toggle('on', S.wake);
  el.sound.classList.toggle('off', muted);
  setAi(); if (s !== 'off' && s !== 'wake') kick(.1);
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
let hudT = 0;
function updateHud() { if (hudT || el.panel.hidden) return; hudT = setTimeout(() => { hudT = 0; hudNow(); }, 120); }   // coalesced, skipped while closed
function hudNow() {                      // live telemetry strip — read-only, never throws
  try {
    const { t, tot, p, s } = summary();
    el.pct.textContent = p; el.ring.style.strokeDashoffset = (138.2 * (1 - Math.min(100, p) / 100)).toFixed(1);
    el.tele.dataset.lv = p >= 70 ? 'hi' : p >= 40 ? 'mid' : 'lo';
    el.today.textContent = t.done.length + '/' + tot;
    el.streak.textContent = (s.streak || 0) + 'd';
    el.month.textContent = (s.hasData ? s.hPct : 0) + '%';
    const nx = ttToday().find(x => !x.over);
    el.next.textContent = nx ? nx.at + ' · ' + nx.name : 'ALL CLEAR';
    if (t.left.length) { el.c0.dataset.c = 'tick ' + HN[t.left[0]]; el.c0.textContent = 'Tick ' + cap(HN[t.left[0]]); } else { el.c0.dataset.c = 'brief me'; el.c0.textContent = 'Briefing'; }
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
  if (!want()) { stopRec(); micClose(); }
}

/* =====================================================================
   VOICE OUT — pack clips only (preloaded, played from memory)
   ===================================================================== */
const cache = {};
let cur = null, playTok = 0;
function clip(n) { return cache[n] || (cache[n] = Object.assign(new Audio(BASE + n + '.mp3'), { preload: 'auto' })); }
let preloaded = false;
function preload() {                     // same clips, loaded one at a time so the phone never stalls on startup
  if (preloaded) return; preloaded = true;
  const all = []; Object.keys(CLIPS).forEach(k => CLIPS[k].forEach(n => { if (all.indexOf(n) < 0) all.push(n); }));
  let i = 0; const next = () => { if (i < all.length) { clip(all[i++]); setTimeout(() => idle(next, 1500), 200); } }; next();
}
function stopVoice() {
  playTok++;
  if (cur) { try { cur.pause(); } catch (e) { } clearTimeout(cur._t); cur = null; }
  TTS.q = []; TTS.cur = null; TTS.open = false; clearTimeout(TTS.t); ttsU = null; try { if (synth) synth.cancel(); } catch (e) { }
  speaking = false; guardUntil = Date.now() + 200;
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
  if (want()) micOpen();
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
    openPanel();
    if (mic) { meterEnabled = false; lsSet('jv_meter', '0'); micClose(); setAi(); showReply('The mic meter clashed with voice recognition on this device, so I switched it off, sir.'); }
    else showReply('No microphone found, sir.');
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
    if (speaking && wakeHit(res) && /\b(stop|quiet|enough|shut up|chup|bas)\b/.test(norm(res[0].transcript))) {   // voice barge-in: "Jarvis, stop"
      stopVoice(); S.active = true; openPanel(); showHeard('Go ahead, sir…'); setState(); armIdle(14000); ignored.add(i); continue;
    }
    if (ignored.has(i)) { if (res.isFinal) ignored.delete(i); continue; }
    if (now < guardUntil) { if (!res.isFinal) ignored.add(i); continue; }      // that is Jarvis's own voice
    const txt = res[0].transcript.trim(); if (!txt) continue;
    kick(.9);
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
  welcomed = true; armIdle(10000); warmAI();
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
function briefing() {
  const d = today(), h = d.getHours(), { t, tot, p, s } = summary(), up = ttToday().filter(x => !x.over)[0];
  const a = [`${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, sir.`, `${t.done.length} of ${tot} habits done, ${p} percent.`];
  if (s.streak > 0) a.push(`Streak at ${plural(s.streak, 'day')}.`);
  if (t.left.length) a.push(`Still pending: ${list(t.left.slice(0, 4).map(i => HN[i]))}.`);
  if (up) a.push(`Next up, ${up.name} at ${up.at}.`);
  if (s.activePenalties) a.push(`${plural(s.activePenalties, 'penalty')} waiting to be served.`);
  return R(a.join(' '), p >= 70 ? 'cheer' : p >= 40 ? 'ok' : 'warn');
}
function exec(n) {
  let m;
  if (/^(stop|quit jarvis|exit|close|cancel|goodbye|bye|go to sleep|thats all|dismiss|never ?mind|im done|thank(s| you)( jarvis)?)$/.test(n)) return Object.assign(R('Very good, sir.'), { close: true });
  if (/\b(brief me|briefing|catch me up|sitrep|status report)\b|^good (morning|afternoon|evening)( jarvis)?$/.test(n)) return briefing();
  if (/\b(focus|break)\b/.test(n) && (/\b(start|begin|for|mode|set|take|run|on|stop|cancel|end|quit|off|left|remaining|status|how)\b/.test(n) || /\d/.test(n))) {
    const kind = /\bbreak\b/.test(n) && !/\bfocus\b/.test(n) ? 'break' : 'focus';
    if (/\b(stop|cancel|end|quit|abort|off)\b/.test(n)) { if (!FOCUS.end) return R('No focus session is running, sir.', 'err'); const k = FOCUS.kind; focusStop(); return R(k === 'focus' ? 'Focus mode ended. Alerts are back on, sir.' : 'Break cancelled, sir.'); }
    if (/\b(left|remaining|status|how long|how much)\b/.test(n)) return FOCUS.end > Date.now() ? R(`${fmt(FOCUS.end - Date.now())} remaining on your ${FOCUS.kind}, sir.`) : R('No focus session is running, sir.', 'err');
    let min = 0, m = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|ghante|ghanta)/.exec(n);
    if (m) min = parseFloat(m[1]) * 60; else if (m = /(\d+)/.exec(n)) min = +m[1]; else if (/\ban hour\b/.test(n)) min = 60;
    if (!min) min = kind === 'break' ? 5 : +(lsGet('jv_flast') || 25);
    min = Math.max(1, Math.min(180, Math.round(min))); if (kind === 'focus') lsSet('jv_flast', String(min));
    focusStart(min, kind);
    return R(kind === 'focus' ? `Focus engaged, sir. ${plural(min, 'minute')}. Alerts are muted. I will check in when it ends.` : `Break started, ${plural(min, 'minute')}. Rest properly, sir.`);
  }
  if (/\b(help|what can you do|commands)\b/.test(n)) return R('Tick or untick habits (“tick gym and study”), mark classes (“attended DAA”), open any tab (“open reports”), run the Soul Timer. Ask me: what’s left, how am I doing, my streak, attendance, weakest habit, next class, penalties.');
  if (/^(hi|hello|hey|yo|are you there|you there|you up)$/.test(n)) return R('For you, sir, always.', 'wake');
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
function present(res) {
  const txt = res.map(r => cap(r.t)).join('\n'), kinds = res.map(r => r.c), str = res.some(r => r.streamed);
  if (!str) {
    showReply(txt);
    if (TTS.full && synth && !muted) {
      const act = !kinds.includes('err') && /ticked|unticked|marked|running|paused|opening|locking|switched|set to/i.test(txt);
      speakText((act && Math.random() < .5 ? pick(['Done, sir. ', 'Right away, sir. ', 'Certainly, sir. ']) : '') + txt);
    } else say(kinds.includes('err') ? 'err' : kinds[0] || 'ok');
  }
  try { if (navigator.vibrate) navigator.vibrate(kinds.includes('err') ? [40, 40, 40] : 15); } catch (e) { }
  root.dataset.tone = kinds.some(k => k === 'err' || k === 'warn' || k === 'huh') ? 'bad' : '';
  updateHud(); setTimeout(updateHud, 450);
  if (res.some(r => r.close)) { setTimeout(sleep, 1200); return; }
  armIdle(speaking ? 45000 : 9000 + Math.min(12000, txt.length * 60));      // ttsDone() re-arms a 14 s follow-up window
}
function viaAI(text) { askAI(text).then(r => present([r])).catch(() => present([R('Something went wrong, sir.', 'err')])); }
function run(n, raw) {
  clearTimeout(ackT);
  openPanel(); showHeard('“' + (raw || n) + '”');
  n = hing(n);
  if (pendingAct) {                                           // confirmation for risky AI-proposed actions
    const pa = pendingAct; pendingAct = '';
    if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|confirm|proceed|go ahead|haan|han|ha|theek hai)$/.test(n)) { let r; try { r = exec(pa); refresh(); } catch (e) { r = R('That failed, sir.', 'err'); } present([r]); return; }
    if (/^(no|nope|cancel|dont|nahi|nahin|mat karo)$/.test(n)) { present([R('Cancelled, sir.')]); return; }
  }
  if (aiOn && AI_FIRST.test(n) && !ACT_WORD.test(n)) { viaAI(raw || n); return; }
  const res = n.split(/\s+(?:and then|then|after that)\s+/).map(p => { try { return exec(p.trim()); } catch (e) { console.error(e); return R('Something went wrong with that one, sir.', 'err'); } });
  if (aiOn && res.length === 1 && res[0].c === 'huh') { viaAI(raw || n); return; }
  present(res);
}

/* =====================================================================
   HINGLISH — roman-script Hindi mapped onto the commands above
   ===================================================================== */
const HING = [
  [/\b(maine|maine) aaj kya kya kar liya\b|\baaj kya kya (kiya|kar liya)\b|\bkya kya (kiya|kar liya)\b/g, 'what did i do today'],
  [/\b(kya|kitna) (baaki|baki|bacha)( hai)?\b|\bbaaki kya\b|\babhi kya karna( hai)?\b|\bkya karna hai\b/g, 'what is left today'],
  [/\b(aaj )?kaisa (chal raha|ja raha)( hai)?\b|\bmera haal\b|\bmain kaisa\b/g, 'how am i doing'],
  [/\bstreak (kitni|kitna|kya)\b|\bkitni streak\b/g, 'what is my streak'],
  [/\bagli class\b|\bnext class kab\b/g, 'next class'],
  [/\b(motivation do|mujhe motivate kar(o|do)|himmat do)\b/g, 'motivate me'],
  [/\b(nahi|nahin) (kiya|hua|ho paya)\b/g, 'not done'],
  [/\b(ho gaya|ho gya|hogaya|kar liya|kar diya|kar di|kar lia)\b/g, 'done'],
  [/\b(tick|check) (kar do|karo|kardo)\b|\b(kar do|kardo)\b/g, 'tick'],
  [/\b(kholo|khol do|kholiye)\b/g, 'open'], [/\b(dikhao|dikha do)\b/g, 'show'],
  [/\b(shuru karo|shuru kar do|chalu karo|chalu kar do|start karo)\b/g, 'start'],
  [/\b(roko|ruko|rok do|band karo)\b/g, 'pause'],
  [/\b(bata do|batao|bataiye)\b/g, 'tell me']
];
const hing = n => HING.reduce((s, r) => s.replace(r[0], r[1]), n).replace(/\s+/g, ' ').trim();

/* =====================================================================
   LOCAL AI BRAIN — WebLLM on WebGPU. Free, no API key, no billing.
   Built-in commands stay instant and exact; the AI handles everything
   the command brain does not understand, plus advice and "why" questions.
   ===================================================================== */
const AI_LIB = 'https://esm.run/@mlc-ai/web-llm';
const AI_IDS = { fast: 'Llama-3.2-1B-Instruct', smart: 'Llama-3.2-3B-Instruct' };
const AI_FIRST = /\b(why|advice|advise|suggest\w*|improve|analy[sz]e|explain|tips?|should i|how can i|how do i|how to|compare|reason|kaise|kyun|kyu|samjhao|salah)\b/;
const ACT_WORD = /\b(tick|untick|uncheck|open|start|pause|quit|attended|bunked|lock|serve|theme|mark)\b/;
const SAFE_ACT = /^(tick|untick|open|start|pause|attended|missed|bunked)\b/;
const RISKY_ACT = /\b(quit|give up|abort|lock|log me out|serve|punish\w*|penalt\w*)\b/;

async function aiModelId() {
  let f16 = false;
  try { const a = await navigator.gpu.requestAdapter(); f16 = !!(a && a.features.has('shader-f16')); } catch (e) { }
  return AI_IDS[aiSmart ? 'smart' : 'fast'] + (f16 ? '-q4f16_1-MLC' : '-q4f32_1-MLC');     // f32 build for phones without f16
}
function setAi() {
  if (!el.ai) return;
  el.ai.textContent = 'AI BRAIN: ' + (aiLoading ? 'LOADING' : aiOn ? (aiEngine ? 'ON' : 'READY') : 'OFF');
  el.ai.classList.toggle('on', aiOn);
  el.model.textContent = aiSmart ? 'SMART' : 'FAST';
  const pv = pickVoice(); el.voice.textContent = 'VOICE: ' + (pv ? pv.name.replace(/^(Microsoft|Google)\s+/i, '').split(/[\s-]/)[0].toUpperCase() : 'DEFAULT');
  el.rate.textContent = TTS.rate + '×'; el.vmode.textContent = TTS.full ? 'SPEAK: FULL' : 'SPEAK: CLIPS'; el.meter.textContent = 'MIC: ' + (meterEnabled ? 'ON' : 'OFF');
}
function ensureAI() {
  if (aiEngine) return Promise.resolve(true);
  if (aiLoading) return aiLoading;
  if (!navigator.gpu) { aiErr = 'WebGPU is not available in this browser.'; return Promise.resolve(false); }
  aiLoading = (async () => {
    try {
      const id = await aiModelId();
      const lib = await import(AI_LIB);
      aiEngine = await lib.CreateMLCEngine(id, { initProgressCallback: p => { const pc = Math.round((p.progress || 0) * 100); el.aist.textContent = pc + '%'; el.aibar.style.width = pc + '%'; armIdle(60000); } });
      return true;
    } catch (e) { aiEngine = null; aiErr = (e && e.message) || 'unknown error'; return false; }
    finally { aiLoading = null; el.aist.textContent = ''; el.aibar.style.width = '0'; setState(); }
  })();
  setState();
  return aiLoading;
}
function warmAI() { if (aiOn && !aiEngine && !aiLoading) ensureAI(); }

function snapshot() {                    // live, read-only facts the model may use
  const L = [], d = today(), iso = isoDate(d), none = a => list(a) || 'none';
  try {
    const { t, tot, p, s } = summary();
    L.push(`Now: ${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
    L.push(`Today: ${t.done.length}/${tot} habits done (${p}%). Done: ${none(t.done.map(i => HN[i]))}. Left: ${none(t.left.map(i => HN[i]))}. Missed: ${none(t.missed.map(i => HN[i]))}.`);
    L.push(`Streak ${s.streak} days (best ${s.bestStreak}). Month ${s.hasData ? s.hPct : 0}%. Active penalties: ${s.activePenalties || 0}.`);
    const rs = HABITS.map((h, i) => ({ i, r: habitRate(i) })).filter(x => x.r.tot > 0).sort((a, b) => a.r.pct - b.r.pct);
    if (rs.length) L.push(`Weakest habits this month: ${list(rs.slice(0, 3).map(x => HN[x.i] + ' ' + x.r.pct + '%'))}. Strongest: ${HN[rs[rs.length - 1].i]} ${rs[rs.length - 1].r.pct}%.`);
  } catch (e) { }
  try { const up = ttToday().filter(x => !x.over).slice(0, 5); L.push('Rest of today\'s schedule: ' + (up.length ? list(up.map(x => `${x.name} at ${x.at}`)) : 'nothing') + '.'); } catch (e) { }
  try { const bd = bunkData(); L.push('Attendance: ' + list(Object.keys(bd).map(k => { const o = bd[k]; return `${k} ${o.total ? Math.round(o.attended / o.total * 100) : 100}%`; })) + ' (75% is the safe line).'); } catch (e) { }
  try {
    const g = gymPlanFor(iso), gi = habitIdx('gym'), gr = habitRate(gi);
    L.push(`Gym today: ${g ? (g.type === 'workout' ? g.title.replace(/^\S+\s/, '') + (g.variant ? ' (' + g.variant + ')' : '') : 'rest day') : 'no plan'}; status ${getGymStatusRaw(iso) || 'not logged'}. Gym this month: ${gr.done} of ${gr.tot} days (${gr.pct}%).`);
    const prog = []; gymGroupBySlug(gymCollectLogs()).forEach((a, sl) => { if (a.length >= 2) { const x = a[a.length - 2], y = a[a.length - 1], inf = GYM_SLUG_INFO.get(sl); prog.push({ n: inf ? inf.name : sl, x, y }); } });
    prog.sort((a, b) => (a.y.iso < b.y.iso ? 1 : -1));
    if (prog.length) L.push('Lift progress (est. 1RM, previous to latest): ' + prog.slice(0, 5).map(o => `${o.n} ${Math.round(o.x.e1rm)} to ${Math.round(o.y.e1rm)}kg`).join('; ') + '.');
  } catch (e) { }
  try { L.push(`Soul timer: ${timerStarted ? Math.ceil(timerRemainingSec / 60) + ' min left' + (timerRunning ? '' : ' (paused)') : 'not running'}.`); } catch (e) { }
  return L.join('\n');
}
function sysPrompt() {
  return 'You are J.A.R.V.I.S., the personal assistant inside the user\'s Discipline OS habit app. Call the user "sir". Be brief: at most 2 short sentences, plain speech, no markdown, no lists, no emojis. ' +
    'Use ONLY the LIVE DATA below for facts about the user. Never invent numbers, habits or workouts; if something is not in the data, say you do not have it. ' +
    'If the user writes Hinglish or Hindi, answer in simple Hinglish using Roman letters. ' +
    'To perform an app action, add a final separate line "ACTION: <command>" (at most 2). Allowed commands: tick <habit>, untick <habit>, open <tab>, start soul timer, pause soul timer, attended <subject>, missed <subject>. ' +
    'Habits: sleep, classes, study, project, gym, scrolling, morning phone, night phone, water, skin care, reading, fruit. Tabs: home, daily grid, time table, gym, reports, insights, achievements, soul timer, punishment. ' +
    'Only act when the user clearly asks for it. For questions and advice give no ACTION.\n\nLIVE DATA:\n' + snapshot();
}
function runActs(acts) {                 // allow-list only; risky ones wait for a spoken/typed "yes"
  const out = []; let ran = false;
  acts.slice(0, 2).forEach(a => {
    const c = hing(norm(a));
    if (RISKY_ACT.test(c)) { pendingAct = c; out.push(`Shall I ${c}, sir? Say yes to confirm.`); return; }
    if (!SAFE_ACT.test(c)) return;
    try { const r = exec(c); out.push(r.t); ran = true; } catch (e) { out.push('That action failed, sir.'); }
  });
  if (ran) refresh();
  return out;
}
function splitReply(raw) {
  const acts = [], keep = [];
  raw.split('\n').forEach(l => { const m = /^\s*[*_`]*ACTION[*_`]*\s*:\s*(.+)$/i.exec(l); if (m) acts.push(m[1]); else if (!/^\s*[*_`]*ACTION/i.test(l)) keep.push(l); });
  return { acts, reply: keep.join(' ').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 420) };
}
async function askAI(text) {
  if (aiBusy) return R('One moment, sir, I am still thinking.', 'huh');
  aiBusy = true; setState();
  try {
    showReply(aiEngine ? 'Thinking, sir…' : 'Waking my local brain, sir. The first time it downloads the model, after that it is stored on this device.');
    armIdle(90000);
    if (!await ensureAI()) return R('My local brain is unavailable, sir: ' + aiErr + ' Command mode still works.', 'err');
    const stream = await aiEngine.chat.completions.create({ messages: [{ role: 'system', content: sysPrompt() }, ...aiHist.slice(-6), { role: 'user', content: text }], temperature: 0.3, max_tokens: 160, stream: true });
    let raw = '', said = 0, started = false, talk = false;
    const begin = () => { if (!started) { started = true; talk = speakBegin(); } };
    el.reply.classList.remove('typing');
    for await (const ch of stream) {                       // words appear as they are generated
      raw += (ch.choices && ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content) || '';
      kick(.8); const part = splitReply(raw).reply; if (part) el.reply.textContent = part;
      const seg = part.slice(said), k = Math.max(seg.lastIndexOf('. '), seg.lastIndexOf('! '), seg.lastIndexOf('? '));
      if (k > -1) { begin(); if (talk) speakPush(seg.slice(0, k + 1)); said += k + 2; }      // he starts talking before the model finishes
      armIdle(30000);
    }
    const sp = splitReply(raw), acts = sp.acts, reply = sp.reply || 'Understood, sir.';
    aiHist.push({ role: 'user', content: text }, { role: 'assistant', content: reply }); if (aiHist.length > 8) aiHist.splice(0, aiHist.length - 8);
    const done = runActs(acts); begin();
    if (talk) { speakPush(reply.slice(said)); if (done.length) speakPush(pendingAct ? done[done.length - 1] : 'Done.'); speakEnd(); }
    return Object.assign(R(reply + (done.length ? '\n' + done.join(' ') : ''), 'ok'), { streamed: talk });
  } catch (e) {
    console.warn('Jarvis AI', e);
    return R('My local brain hit an error, sir. Try again.', 'err');
  } finally { aiBusy = false; setState(); }
}
/* ---------- v7 speech engine: sentence-chunked, natural-sounding, never cuts off ---------- */
const VM = /daniel|arthur|george|ryan|ravi|prabhat|rishi|james|oliver|thomas|hemant|male/i, VF = /female|zira|susan|hazel|samantha|karen|moira|tessa|fiona|heera|neerja|aria|jenny|libby|sonia|swara|google us english/i;
function voiceList() {
  const sc = x => (VM.test(x.name) && !/female/i.test(x.name) ? 10 : 0) - (VF.test(x.name) ? 20 : 0) + (/natural|neural|online/i.test(x.name) ? 4 : 0) + (/^en-GB/i.test(x.lang) ? 6 : /^en-IN/i.test(x.lang) ? 4 : 1);
  return ((synth && synth.getVoices()) || []).filter(x => /^en/i.test(x.lang)).sort((a, b) => sc(b) - sc(a)).slice(0, 6);
}
function pickVoice(hi) {
  if (hi) return ((synth && synth.getVoices()) || []).find(x => /^hi/i.test(x.lang)) || null;
  const l = voiceList(); return l.find(x => x.name === TTS.voice) || l[0] || null;
}
function speechify(t) {                  // make written text sound right when spoken
  return t.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mi) => { h = +h; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + (mi === '00' ? '' : mi[0] === '0' ? ' oh ' + mi[1] : ' ' + mi) + ' ' + ap; })
    .replace(/(\d+)\s?%/g, '$1 percent').replace(/\b(COA|DAA|DCN|OS|AAR|1RM)\b/g, m => m.split('').join(' '))
    .replace(/[“”]/g, '').replace(/[·—–]/g, ', ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
}
function chunks(t) {
  const o = []; (t.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) || []).forEach(x => { x = x.trim(); if (!x) return; if (o.length && o[o.length - 1].length < 24) o[o.length - 1] += ' ' + x; else o.push(x); });
  return o;
}
function ttsNext() {
  if (TTS.cur) return;
  const x = TTS.q.shift();
  if (!x) { if (!TTS.open && speaking) ttsDone(); return; }
  const u = new SpeechSynthesisUtterance(x), hi = /[\u0900-\u097F]/.test(x), v = pickVoice(hi), tok = playTok;
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = hi ? 'hi-IN' : 'en-GB';
  u.rate = TTS.rate; u.pitch = v && /natural|neural|online/i.test(v.name) ? 1 : .88;
  TTS.cur = u;
  const nxt = () => { if (TTS.cur !== u || tok !== playTok) return; clearTimeout(TTS.t); TTS.cur = null; ttsNext(); };
  u.onend = u.onerror = nxt; u.onboundary = () => kick(1);          // every word pulses the orb and bars
  TTS.t = setTimeout(nxt, x.length * 110 / TTS.rate + 2500);
  try { synth.speak(u); } catch (e) { nxt(); }
}
function ttsDone() {
  speaking = false; guardUntil = Date.now() + 500;
  if (ignored.size && want()) { stopRec(); restartT = setTimeout(start, 150); }   // drop stale echo results
  setState(); if (S.active) { armIdle(14000); showHeard('Go ahead, sir…'); }       // conversation mode: stay listening for a follow-up
}
function speakBegin() { if (muted || !synth) return false; stopVoice(); TTS.open = true; speaking = true; guardUntil = Infinity; setState(); return true; }
function speakPush(t) { if (!speaking) return; chunks(speechify(t)).forEach(c => TTS.q.push(c)); ttsNext(); }
function speakEnd() { TTS.open = false; if (speaking && !TTS.cur && !TTS.q.length) ttsDone(); }
function speakText(t) { if (speakBegin()) { speakPush(t); speakEnd(); } }
function kick(a) { env = Math.max(env, a || 1); if (!vizRaf && !document.hidden && !document.documentElement.classList.contains('fx-lite')) vizRaf = requestAnimationFrame(vizTick); }
const bg = { base: 0, n: 0, t: 0, was: '' };
function vizTick(t) {                    // bars + orb follow real mic / speech level; also watches for talk-over (barge-in)
  vizRaf = 0; const st = root.dataset.state;
  if (st === 'off' || st === 'wake' || document.hidden) { el.mic.style.removeProperty('--lvl'); el.lv.style.transform = ''; bars.forEach(b => b.style.transform = ''); bg.n = 0; bg.was = st; return; }
  if (TOUCH && t - (bg.last || 0) < 30) { vizRaf = requestAnimationFrame(vizTick); return; } bg.last = t;     // ~30 fps on phones
  const l = mic ? micLevel() : 0;
  if (st === 'listen' && mic) env = Math.max(env, Math.min(1, l * 3.2));
  if (st === 'speak' && mic) {
    if (bg.was !== 'speak') { bg.base = l; bg.n = 0; bg.t = t; }
    if (t - bg.t < 600) bg.base = Math.max(bg.base, l);                       // learn his own echo level first
    else { bg.base = bg.base * .985 + l * .015; if (l > bg.base * 2 + .14) bg.n++; else bg.n = Math.max(0, bg.n - 2); if (bg.n > (TOUCH ? 7 : 12)) { bg.n = 0; bargeIn(); } }
  }
  bg.was = st;
  el.lv.style.transform = 'scaleX(' + Math.min(1, l * 3).toFixed(2) + ')';
  env *= .9; const base = st === 'think' ? .25 : st === 'speak' ? .3 : .18;
  bars.forEach((b, i) => b.style.transform = 'scaleY(' + Math.min(1, base + env * (.55 + .45 * Math.sin(t / 110 + i * 1.4))).toFixed(2) + ')');
  el.mic.style.setProperty('--lvl', (.85 + Math.min(env, 1) * .6).toFixed(2));
  vizRaf = requestAnimationFrame(vizTick);
}
function bargeIn() { stopVoice(); S.active = true; openPanel(); showHeard('Go ahead, sir…'); setState(); armIdle(14000); stopRec(); start(); try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { } }

/* ---------- real microphone level meter (also powers voice barge-in) ---------- */
let mic = null, micBusy = false, meterEnabled = lsGet('jv_meter') ? lsGet('jv_meter') === '1' : !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
async function micOpen() {
  if (mic || micBusy || !meterEnabled || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return; micBusy = true;
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }), AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), an = ctx.createAnalyser();
    an.fftSize = 512; ctx.createMediaStreamSource(st).connect(an); mic = { st, ctx, an, buf: new Uint8Array(512), lvl: 0 };
    if (!want()) micClose(); else kick(.1);
  } catch (e) { meterEnabled = false; setAi(); } finally { micBusy = false; }
}
function micClose() { if (!mic) return; const m = mic; mic = null; try { m.st.getTracks().forEach(x => x.stop()); m.ctx.close(); } catch (e) { } }
function micLevel() { mic.an.getByteTimeDomainData(mic.buf); let pk = 0; for (let k = 0; k < mic.buf.length; k++) { const d = Math.abs(mic.buf[k] - 128) / 128; if (d > pk) pk = d; } return mic.lvl = Math.max(pk, mic.lvl * .75); }

/* ---------- focus mode: timer + muted alerts + spoken check-in ---------- */
const FOCUS = { end: 0, min: 0, kind: '', iv: 0 };
const focusOn = () => FOCUS.kind === 'focus' && FOCUS.end > Date.now();
const fmt = ms => { const q = Math.max(0, Math.ceil(ms / 1000)); return p2(Math.floor(q / 60)) + ':' + p2(q % 60); };
function focusStart(min, kind) {
  clearInterval(FOCUS.iv); pendingAct = '';
  Object.assign(FOCUS, { end: Date.now() + min * 60000, min, kind: kind || 'focus' });
  lsSet('jv_focus', JSON.stringify({ end: FOCUS.end, min, kind: FOCUS.kind }));
  FOCUS.iv = setInterval(focusTick, 1000); focusTick();
}
function focusStop() { clearInterval(FOCUS.iv); FOCUS.end = 0; FOCUS.kind = ''; lsSet('jv_focus', ''); el.fchip.hidden = true; root.dataset.focus = ''; }
function focusTick() {
  const left = FOCUS.end - Date.now(); if (left <= 0) { focusEnd(); return; }
  if (document.hidden) return;
  el.fchip.hidden = false; el.fchip.textContent = (FOCUS.kind === 'focus' ? 'FOCUS ' : 'BREAK ') + fmt(left); root.dataset.focus = FOCUS.kind === 'focus' ? '1' : '';
}
function focusEnd() {
  const { min, kind } = FOCUS; focusStop();
  const msg = kind === 'focus' ? `Focus session complete, sir. ${plural(min, 'minute')} of deep work. Take a 5 minute break. Shall I start one?` : 'Break is over, sir. Ready for another focus session?';
  pendingAct = kind === 'focus' ? 'start break 5' : 'start focus ' + (lsGet('jv_flast') || 25);
  openPanel(); root.dataset.tone = ''; showReply(msg); speakText(msg);
  if (SR && !locked) { S.active = true; setState(); start(); armIdle(25000); }       // listening for "yes"
  schedEval(5000);
}


/* =====================================================================
   ACHIEVEMENT & WARNING POPUPS — event-driven, run only when idle
   ===================================================================== */
function popup(kind, icon, title, body) {
  if (el.pop.children.length >= 3 || focusOn()) return;
  const c = document.createElement('div'); c.className = 'jv-card' + (kind === 'bad' ? ' bad' : '');
  c.innerHTML = '<div class="ic"></div><div><b></b><span></span><small>TAP TO HEAR JARVIS</small></div><button class="cx" aria-label="Dismiss">&#10005;</button><i class="pg"></i>';
  c.querySelector('.ic').textContent = icon; c.querySelector('b').textContent = title; c.querySelector('span').textContent = body;
  el.pop.appendChild(c);
  const kill = () => c.remove(); setTimeout(kill, 40000);
  c.querySelector('.cx').onclick = ev => { ev.stopPropagation(); kill(); };
  c.onclick = () => { kill(); if (TTS.full && synth && !muted) speakText(title + '. ' + body); else say(kind === 'bad' ? 'warn' : 'cheer'); };
}
function evaluate() {
  if (locked || document.hidden) return;
  if (focusOn()) { schedEval(60000); return; }
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
    if (speaking) { stopVoice(); S.active = true; openPanel(); showHeard('Go ahead, sir…'); setState(); armIdle(14000); start(); return; }   // tap = interrupt him and talk
    if (S.active && !el.panel.hidden) { sleep(); return; }
    S.active = true; openPanel(); showHeard(''); showReply('Listening, sir…'); setState();
    clearTimeout(ackT); say(welcomed ? 'wake' : 'hi'); welcomed = true; armIdle(12000); start(); warmAI();
  };
  el.wake.onclick = () => {
    if (!SR) { openPanel(); showReply('The wake word needs Chrome or Edge. Firefox has no speech recognition.'); return; }
    S.wake = !S.wake; lsSet('jv_wake', S.wake ? '1' : '0');
    if (S.wake) { start(); say(welcomed ? 'wake' : 'hi'); welcomed = true; openPanel(); showReply('Wake word on, sir. Say “Jarvis” any time. Keep this tab open and in front.'); armIdle(5000); }
    else if (!S.active) stopRec();
    setState();
  };
  el.close.onclick = sleep;
  el.ai.onclick = async () => {
    if (aiLoading) return;
    if (aiOn) { aiOn = false; lsSet('jv_ai', '0'); setAi(); showReply('AI brain off, sir. Command mode only.'); return; }
    if (!navigator.gpu) { showReply('This browser has no WebGPU, so the local AI cannot run here, sir. Use current Chrome or Edge on desktop, or Chrome on a recent Android phone. Commands still work.'); return; }
    aiOn = true; lsSet('jv_ai', '1'); setAi(); openPanel(); armIdle(120000);
    showReply('Loading the local brain, sir. First time only: roughly a 1 GB download, then it lives on this device. Wi-Fi recommended.');
    const ok = await ensureAI(); armIdle(12000);
    if (ok) { showReply('Local brain online, sir. Ask me anything about your progress.'); speakText('Local brain online, sir.'); }
    else { aiOn = false; lsSet('jv_ai', '0'); setAi(); showReply('The model failed to load: ' + aiErr); }
  };
  el.model.onclick = () => {
    if (aiLoading) return;
    aiSmart = !aiSmart; lsSet('jv_model', aiSmart ? 'smart' : 'fast');
    const old = aiEngine; aiEngine = null; if (old && old.unload) old.unload().catch(() => { }); setAi(); openPanel();
    showReply(aiSmart ? 'Smart model selected, sir. Bigger download, slower, better at Hindi.' : 'Fast model selected, sir.');
    if (aiOn) ensureAI();
  };
  el.voice.onclick = () => { const l = voiceList(); if (!l.length) { openPanel(); showReply('No voices found on this device, sir.'); return; } const cv = pickVoice(), i = l.findIndex(x => cv && x.name === cv.name); TTS.voice = l[(i + 1) % l.length].name; lsSet('jv_voice', TTS.voice); setAi(); speakText('At your service, sir.'); };
  el.rate.onclick = () => { const r = [.9, 1, 1.1, 1.25]; TTS.rate = r[(r.indexOf(TTS.rate) + 1) % r.length]; lsSet('jv_rate', TTS.rate); setAi(); speakText('This is how fast I speak, sir.'); };
  el.vmode.onclick = () => { TTS.full = !TTS.full; lsSet('jv_vmode', TTS.full ? 'full' : 'clips'); setAi(); showReply(TTS.full ? 'I will speak my full answers, sir.' : 'Short film-style clips only, sir.'); };
  if (synth) synth.addEventListener('voiceschanged', setAi);
  el.meter.onclick = () => { meterEnabled = !meterEnabled; lsSet('jv_meter', meterEnabled ? '1' : '0'); if (meterEnabled) { if (want()) micOpen(); } else micClose(); setAi(); openPanel(); showReply(meterEnabled ? 'Mic meter and talk-over interrupt are on, sir.' : 'Mic meter off, sir. Tap the orb or say Jarvis stop to interrupt me.'); };
  el.fchip.onclick = () => run('focus status', 'Focus status');
  el.sound.onclick = () => { muted = !muted; lsSet('jv_mute', muted ? '1' : '0'); if (muted) stopVoice(); setState(); };
  el.form.onsubmit = e => { e.preventDefault(); const v = el['in'].value.trim(); if (!v) return; el['in'].value = ''; run(stripWake(norm(v)) || norm(v), v); };
  el['in'].addEventListener('input', () => armIdle(30000));
  el.panel.addEventListener('click', e => { const b = e.target.closest('.jv-chips button'); if (b) run(norm(b.dataset.c), b.textContent); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.panel.hidden) sleep(); });
  const touch = () => { touched = true; if (needUnlock && !muted) { needUnlock = false; say('wake'); } preload(); };
  addEventListener('pointerdown', touch, { once: true, passive: true });
  addEventListener('keydown', touch, { once: true });
  document.addEventListener('visibilitychange', () => {
    root.classList.toggle('jv-paused', document.hidden);
    if (document.hidden) { stopRec(); micClose(); stopVoice(); setState(); }
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
  if (locked) { stopRec(); micClose(); return; }
  clearInterval(lockPoll);
  if (S.wake) { start(); }
  idle(preload, 4000); schedEval(4000);
}
let lockPoll = 0;

function init() {
  build(); wire();
  try { const f = JSON.parse(lsGet('jv_focus') || 'null'); if (f && f.end > Date.now()) { Object.assign(FOCUS, f); FOCUS.iv = setInterval(focusTick, 1000); focusTick(); } } catch (e) { }
  el.dock.hidden = true; setState();
  checkLock();
  if (locked) { lockPoll = setInterval(checkLock, 1500); }
  setInterval(() => schedEval(0), 180000);          // gentle re-check every 3 min, only while idle
}
window.__jarvis = { run: t => run(norm(t), t), evaluate, say, exec };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
