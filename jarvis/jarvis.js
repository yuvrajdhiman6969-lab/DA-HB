/* =====================================================================
   J.A.R.V.I.S. — voice assistant for the Discipline System
   ---------------------------------------------------------------------
   • Voice: film-style pack clips (jarvis/sounds/, CC-BY-NC-4.0) for the short
     acknowledgements, and FULL spoken answers through a sentence-by-sentence
     speech engine (browser voice, or an optional on-device NEURAL voice).
   • v8: hardened mobile listening (one phrase per session + instant restart,
     mic paused while he speaks, live mic status chip, fuzzy wake word), smarter
     commands (context: "tick the first one", "undo that", "everything except
     water", reminders) and a general brain (maths, conversions, dates, time
     zones, weather, Wikipedia facts, small talk) that works without WebGPU.
   • Clips are preloaded once, played from memory, and nothing heavy runs
     while he is speaking.
   • Wake word reacts on the first words you say (interim results), not after
     you stop talking.
   • HUD v4: arc-reactor orb, holographic panel with live telemetry (today %,
     streak, month %, next class), typed replies, colour tones per state.
   ===================================================================== */
/* ---------------------------------------------------------------------
   v10 (mobile + maintenance pass)
   • Phones: the microphone layer was rebuilt. A "not-allowed" after you have already allowed the mic is
     now treated as "the browser wants a tap" (the orb/anywhere re-arms it) instead of switching Jarvis off
     with a false "mic blocked". Real denials, embedded previews, in-app browsers and an unavailable
     speech service each get their own clear message. No start-up clip or chime is played on phones while
     the recogniser opens (audio focus was silencing it). Live "HEARING YOU" feedback. Add ?jvdebug=1 to the
     URL for an on-screen event log.
   • Habit names are now read from HABITS in index.html (no second list to keep in sync); new habits become
     voice-addressable automatically.
   • AI + neural-voice libraries are pinned to exact versions (with a CDN fallback).
   --------------------------------------------------------------------- */
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
const WAKE_ANY   = /(?:\b(?:jarvis|jarvish|jarves|jarvas|jarvice|jervis|jarwis|javis|jarvi|jar vis|jar viz|jaar vis|gar vis|jarvik|jarvus|jarviz|jaarvis|jaravis|jarbis|jarbus|jarwiz)\b|जार्विस|जारविस|जर्विस|जार्विश|जारवी)[\s,.!]*/;
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
/* Spoken habit names. The list is DERIVED from HABITS (index.html) so there is one source of truth; HN_VOICE only
   supplies friendlier spoken names for the built-in ids, and any habit you add later falls back to its id. */
const HN_VOICE = { sleep: 'sleep', classes: 'classes', study: 'self study', project_work: 'project work', gym: 'gym', media_scroll: 'scrolling control',
  no_phone_morning: 'morning phone rule', no_phone_night: 'night phone rule', water: 'water', skin_care: 'skin care', reading: 'reading', fruit: 'fruit' };
const HN = Object.keys(HN_VOICE).map(k => HN_VOICE[k]);                // safe default until HABITS is read
const hnFor = h => HN_VOICE[h.id] || String(h.id || h.name || 'habit').replace(/[_-]+/g, ' ').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function fillHN() {                                                     // rebuild HN in place (every HN[i] reference stays valid)
  try {
    if (typeof HABITS === 'undefined' || !Array.isArray(HABITS) || !HABITS.length) return;
    const names = HABITS.map(hnFor); HN.length = 0; names.forEach(x => HN.push(x));
  } catch (e) { }
}
function syncHN() {                                                     // after ALIAS exists: make added habits voice-addressable
  fillHN();
  try {
    if (typeof HABITS === 'undefined' || !Array.isArray(HABITS)) return;
    HABITS.forEach(h => {
      if (!h || !h.id || ALIAS.some(a => a[0] === h.id)) return;
      const nm = hnFor(h); if (!nm) return;
      ALIAS.push([h.id, new RegExp('\\b(' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' ?') + ')\\b')]);
    });
  } catch (e) { }
}
fillHN();
try { SYNC_LOCAL_ONLY.add('jv_wake'); SYNC_LOCAL_ONLY.add('jv_seen'); SYNC_LOCAL_ONLY.add('jv_mute'); SYNC_LOCAL_ONLY.add('jv_micok'); SYNC_LOCAL_ONLY.add('jv_debug'); SYNC_LOCAL_ONLY.add('jv_ai'); SYNC_LOCAL_ONLY.add('jv_model'); ['jv_voice', 'jv_rate', 'jv_vmode', 'jv_meter', 'jv_focus', 'jv_flast', 'jv_eng', 'jv_nvoice', 'jv_rem', 'jv_heard', 'jv_fix', 'jv_cont', 'jv_awake'].forEach(k => SYNC_LOCAL_ONLY.add(k)); } catch (e) { }

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
const TTS = { q: [], cur: null, open: false, t: 0, rate: parseFloat(lsGet('jv_rate')) || 1, voice: lsGet('jv_voice') || '', full: lsGet('jv_vmode') !== 'clips', w: 0, dead: false, fails: 0 };
let env = 0, vizRaf = 0, bars = [];
/* v8: listening hardening + conversation context */
let hold = false, recLive = false, recAt = 0, lastEnd = 0, micErr = '', langI = 0, actAt = 0, lastBound = 0;
/* v10: mobile listening layer */
const UA = navigator.userAgent || '';
const IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IN_FRAME = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();       // preview windows / embeds block the mic unless allow="microphone"
const IN_APP = /FBAN|FBAV|Instagram|Snapchat|MicroMessenger|; wv\)|GSA\/|Line\//i.test(UA);                // in-app browsers rarely expose speech recognition
const QUIET_START = TOUCH;          // phones: vibrate + visuals instead of a clip/chime while the recogniser opens (edit freely)
const DEBUG = /[?&]jvdebug\b/.test(location.search) || lsGet('jv_debug') === '1';
let needTap = false, okOnce = lsGet('jv_micok') === '1', perm = '', soundNow = false, lastErr = '', tapAt = 0, tapFails = 0;
const dbgLog = [];
const buzz = n => { try { if (navigator.vibrate) navigator.vibrate(n); } catch (e) { } };
function dbg(m) {                                                    // ?jvdebug=1 : tiny on-screen event log (what the mic is doing, and why not)
  if (!DEBUG) return;
  dbgLog.push(new Date().toTimeString().slice(0, 8) + ' ' + m); if (dbgLog.length > 14) dbgLog.shift();
  let p = document.getElementById('jv-dbg');
  if (!p && root) {
    p = document.createElement('pre'); p.id = 'jv-dbg';
    p.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(8px + env(safe-area-inset-top,0px));z-index:21000;margin:0;padding:6px 8px;font:10px/1.35 ui-monospace,Menlo,monospace;color:#9ef;background:rgba(0,8,16,.84);border:1px solid rgba(56,189,248,.4);pointer-events:none;white-space:pre-wrap';
    root.appendChild(p);
  }
  if (p) p.textContent = 'SR:' + (SR ? 1 : 0) + ' touch:' + (TOUCH ? 1 : 0) + ' ios:' + (IOS ? 1 : 0) + ' frame:' + (IN_FRAME ? 1 : 0) + ' inapp:' + (IN_APP ? 1 : 0) + ' https:' + (window.isSecureContext ? 1 : 0) +
    ' perm:' + (perm || '?') + ' ok:' + (okOnce ? 1 : 0) + ' needTap:' + (needTap ? 1 : 0) + ' err:' + (lastErr || '-') + '\n' + dbgLog.join('\n');
}
function watchPerm() {                                               // learn the real microphone permission (Chrome/Android; Safari throws, which is fine)
  try {
    if (!navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: 'microphone' }).then(p => {
      perm = p.state; dbg('perm ' + perm);
      p.onchange = () => {
        perm = p.state; dbg('perm ' + perm);
        if (perm === 'granted' && /BLOCKED|DENIED/.test(micErr)) micErr = '';
        micStatus(); if (want() && !rec) { fails = 0; start(); }
      };
      micStatus();
    }).catch(() => { });
  } catch (e) { }
}
function micBlocked(chip, spoken) {                                  // a genuine, explained block (never a silent failure)
  S.wake = false; S.active = false; lsSet('jv_wake', '0'); stopRec(); needTap = false; micErr = chip; setState(); micStatus(); openPanel(); tell(spoken);
}
async function importFirst(urls) {                                   // try pinned CDN URLs in order
  const list = Array.isArray(urls) ? urls : [urls]; let err;
  for (const u of list) { try { return await import(u); } catch (e) { err = e; dbg('import failed ' + u); } }
  throw err || new Error('import failed');
}
const CTX = { list: [], last: [], acts: [], at: 0, said: '' };

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
      '<button type="button" class="jv-mst" id="jv-mst" title="Microphone status. Tap to restart the microphone."></button>' +
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
      '<div class="jv-ai"><button type="button" id="jv-ai" title="Free AI that runs on this device"></button><button type="button" id="jv-model" title="FAST = small model, SMART = bigger model (slower, better Hindi)"></button><button type="button" id="jv-eng" title="Voice engine: BROWSER = built-in voices. NEURAL = downloads a natural British male voice (about 90 MB, runs on this device)."></button><button type="button" id="jv-voice" title="Change the Jarvis voice"></button><button type="button" id="jv-rate" title="Speaking speed"></button><button type="button" id="jv-meter" title="Live mic level + talk-over-him interrupt"></button><button type="button" id="jv-vmode" title="FULL = he speaks every answer, CLIPS = short film lines only"></button><button type="button" id="jv-lmode" title="Phones: PHRASE = restarts after every phrase (most reliable). CONTINUOUS = fewer restart tones, try it if your phone handles it."></button><button type="button" id="jv-awake" title="Keep the screen awake while the wake word is armed (the screen sleeping is what kills phone microphones)"></button><button type="button" id="jv-hlog" title="What I heard: see and correct my mistakes"></button><span id="jv-aist"></span></div>' +
      '<div class="jv-aibar"><i id="jv-aibar"></i></div><div id="jv-log" hidden></div>' +
      '<div class="jv-chips"><button type="button" id="jv-c0" data-c="brief me">Briefing</button>' +
        '<button type="button" data-c="what is left today">What’s left</button>' +
        '<button type="button" data-c="how am i doing">How am I doing</button>' +
        '<button type="button" data-c="next class">Next class</button>' +
        '<button type="button" data-c="start soul timer">Start timer</button>' +
        '<button type="button" data-c="focus for 45 minutes">Focus 45</button>' +
        '<button type="button" data-c="give me advice to improve today">Advice</button></div>' +
      '<form id="jv-form" autocomplete="off"><input id="jv-in" placeholder="Type a command…" enterkeyhint="send"><button id="jv-go" type="submit">Go</button></form>' +
      '<div class="jv-hint">Say “Jarvis”, then: “tick gym and study”, “tick the first one”, “undo that”, “remind me in 10 minutes to drink water”, “weather in Delhi”, “what is 15 percent of 240”, “who is Nikola Tesla”, “help”. Keep this tab open and in front. AI BRAIN adds open-ended questions and Hinglish.</div>' +
    '</div>' +
    '<div id="jv-dock" hidden>' +
      '<button class="jv-orb" id="jv-mic" aria-label="Talk to Jarvis" title="Tap to talk"><svg viewBox="0 0 64 64" aria-hidden="true">' +
        '<circle class="r3" cx="32" cy="32" r="30"/><circle class="r1" cx="32" cy="32" r="26"/>' +
        '<circle class="r2" cx="32" cy="32" r="20"/><circle class="r4" cx="32" cy="32" r="14.5"/>' +
        '<polygon class="tri" points="32,22.5 40.4,37 23.6,37"/><circle class="core" cx="32" cy="32" r="5"/></svg><i class="jv-rip"></i></button>' +
      '<button class="jv-wake" id="jv-wake" title="Always listen for the wake word “Jarvis”"><i></i>JARVIS</button><button class="jv-fchip" id="jv-fchip" hidden title="Focus timer — tap for time left"></button>' +
    '</div>';
  document.body.appendChild(root);
  ['pop', 'panel', 'state', 'heard', 'reply', 'dock', 'mic', 'wake', 'sound', 'close', 'form', 'in', 'clock', 'tele', 'ring', 'pct', 'today', 'streak', 'month', 'next', 'ai', 'model', 'aist', 'aibar', 'voice', 'rate', 'vmode', 'c0', 'lv', 'meter', 'fchip', 'eng', 'mst', 'lmode', 'awake', 'hlog', 'log'].forEach(k => el[k] = $('jv-' + k));
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
function tell(t, short) { showReply(t); if (TTS.full && canSpeak()) speakText(short || t); }      // show AND say it
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
  TTS.q = []; TTS.cur = null; TTS.open = false; clearTimeout(TTS.t); clearTimeout(TTS.w); ttsU = null; try { if (synth) synth.cancel(); } catch (e) { }
  try { if (NEURAL.src) { NEURAL.src.onended = null; NEURAL.src.stop(); } } catch (e) { } NEURAL.src = null; NEURAL.pre = null; NEURAL.playing = false;
  speaking = false; guardUntil = Date.now() + 200; releaseHold();
}
function say(kind) {
  if (muted || !CLIPS[kind]) return;
  stopVoice();
  const a = clip(pick(CLIPS[kind])), tok = ++playTok;
  cur = a; speaking = true; guardUntil = Infinity; actAt = Date.now(); setState();
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
const want = () => !!SR && !document.hidden && !locked && !hold && (S.wake || S.active);
const ignored = new Set(), woke = new Set();
const LANGS = [LANG, 'en-US', ''];       // fallback chain if a device rejects a language
function start() {
  clearTimeout(restartT);
  if (want()) micOpen();
  if (rec || !want()) return;
  const r = rec = new SR();
  try { if (LANGS[langI]) r.lang = LANGS[langI]; } catch (e) { }
  r.continuous = TOUCH ? contMode : true;   // phones default to one phrase per session, restarted instantly (continuous is unreliable on many Android / iOS builds; LISTEN button switches it)
  storm();
  r.interimResults = true; r.maxAlternatives = 3;
  startedAt = 0; recAt = Date.now(); recLive = false;
  r.onstart = () => { startedAt = Date.now(); recLive = true; micErr = ''; needTap = false; tapFails = 0; if (!okOnce) { okOnce = true; lsSet('jv_micok', '1'); } ignored.clear(); woke.clear(); dbg('start'); micStatus(); };
  r.onaudiostart = () => { recLive = true; micStatus(); };
  r.onspeechstart = () => { soundNow = true; kick(.7); micStatus(); };
  r.onspeechend = () => { soundNow = false; micStatus(); };
  r.onsoundstart = () => { soundNow = true; micStatus(); };
  r.onsoundend = () => { soundNow = false; micStatus(); };
  r.onnomatch = () => dbg('no match');
  r.onresult = onResult;
  r.onerror = onError;
  r.onend = () => {
    if (rec === r) rec = null;
    recLive = false; soundNow = false; lastEnd = Date.now(); dbg('end');
    const quick = !startedAt || Date.now() - startedAt < 1500;
    fails = quick ? Math.min(fails + 1, 6) : 0;
    micStatus();
    if (want() && !needTap) restartT = setTimeout(start, fails ? Math.min(6000, 250 * Math.pow(2, fails)) : (starts.length > 14 ? 1800 : TOUCH ? 70 : 250));
  };
  try { r.start(); } catch (e) { if (rec === r) rec = null; restartT = setTimeout(start, 1200); }
  micStatus();
}
function stopRec() { clearTimeout(restartT); recLive = false; if (rec) { const r = rec; rec = null; try { r.abort(); } catch (e) { } } }
function onError(e) {
  const m = e && e.error; lastErr = m || ''; dbg('error ' + m);
  if (m === 'not-allowed' || m === 'service-not-allowed') {
    const recentTap = Date.now() - tapAt < 2500;                         // did a fresh tap just start this session?
    if (!touched) { needTap = true; micErr = 'TAP ANYWHERE TO ENABLE MIC'; micStatus(); return; }           // the browser wants one tap before it will listen: not a real block
    if (IN_FRAME && !okOnce) return micBlocked('MIC BLOCKED: EMBEDDED PAGE', 'The microphone is blocked because this page is open inside a preview frame, sir. Open the page directly in Chrome or Safari, not inside another page.');
    if (IN_APP && !okOnce) return micBlocked('OPEN IN CHROME / SAFARI', 'This in-app browser does not allow voice recognition, sir. Open the page in Chrome or Safari.');
    if (window.isSecureContext === false) return micBlocked('MIC NEEDS HTTPS', 'The microphone only works on a secure https address, sir. This page is on plain http, so the browser refuses.');
    if (perm === 'denied' || (recentTap && perm !== 'granted' && !okOnce)) {
      return micBlocked('MIC BLOCKED IN BROWSER', 'The microphone is blocked, sir. Tap the lock icon in the address bar, allow the microphone for this site, then tap the orb. You can still type a command below.');
    }
    if (m === 'service-not-allowed' && !okOnce && !IOS) return micBlocked('VOICE SERVICE OFF', 'This phone has no speech service available, sir. In phone settings, enable the Google app / Speech Services, then tap the orb. You can still type below.');
    if (recentTap && ++tapFails >= 2) return micBlocked('MIC BUSY OR BLOCKED', 'I cannot reach the microphone, sir. Close any other app that is using it, check the site permission, then tap the orb.');
    /* the mic WAS allowed: the phone just wants a fresh tap before it will listen again (common on iPhone). Stay armed, ask for the tap. */
    needTap = true; micErr = 'TAP THE ORB TO TALK'; fails = 0; clearTimeout(restartT);
    if (S.active || S.wake) buzz([10, 40, 10]);
  } else if (m === 'language-not-supported') {
    if (langI < LANGS.length - 1) langI++;                                                // next language in the chain on the automatic restart
  } else if (m === 'audio-capture') {
    openPanel();
    if (mic) { meterEnabled = false; lsSet('jv_meter', '0'); micClose(); setAi(); showReply('The mic meter clashed with voice recognition on this device, so I switched it off, sir.'); }
    else { micErr = 'NO MICROPHONE FOUND'; showReply('No microphone found, sir.'); }
  } else if (m === 'network') {
    micErr = 'VOICE NEEDS INTERNET';
    if (Date.now() - netMsgAt > 60000) { netMsgAt = Date.now(); openPanel(); showReply('Voice recognition needs an internet connection, sir.'); }
  }
  micStatus();
}
/* live microphone status: panel chip + dock label, so you can always see WHY he is not hearing you */
function micStatus() {
  if (!el.mst || !root) return;
  let t, c = '';
  if (!SR) t = 'NO VOICE INPUT HERE · TYPE BELOW';
  else if (micErr) { t = micErr; c = /TAP/.test(micErr) ? 'tap' : 'bad'; }
  else if (hold) { t = 'MIC PAUSED WHILE I SPEAK'; c = 'wait'; }
  else if (rec && recLive) { t = soundNow ? 'HEARING YOU…' : (S.active ? 'MIC LIVE · SPEAK NOW' : 'MIC LIVE · SAY “JARVIS”'); c = 'ok'; }
  else if (want()) { t = 'MIC STARTING…'; c = 'wait'; }
  else t = 'MIC OFF · TAP THE ORB';
  if (el.mst.textContent !== t) el.mst.textContent = t;
  el.mst.dataset.c = c; root.dataset.mic = c || 'off'; root.dataset.hear = soundNow ? '1' : '0';
  dbg('status ' + t);
}
/* phones: the recogniser is paused while he speaks (an open mic silences speech output on Android) and resumed after */
function holdRec() { if (!TOUCH || !SR || hold) return; hold = true; clearTimeout(restartT); stopRec(); micStatus(); }
function releaseHold() {
  if (!hold) return; hold = false; clearTimeout(restartT);
  restartT = setTimeout(() => { if (want()) start(); micStatus(); }, 280); micStatus();
}
/* every 3 s: revive a recogniser the phone killed, and free the mic if speech output stalls */
function watchdog() {
  const now = Date.now();
  if (want() && !/TAP/.test(micErr)) {
    if (!rec && now - lastEnd > 2500) start();
    else if (rec && !recLive && now - recAt > 9000) { stopRec(); restartT = setTimeout(start, 200); }    // never started (permission prompt closed, etc.)
  }
  if (speaking && !cur && now - actAt > 25000) { stopVoice(); setState(); }
  wakeLock(awakeOn && S.wake && !locked && !document.hidden);
}

function norm(t) {
  const nums = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return t.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\u0900-\u097F ]+/g, ' ')
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, m => nums[m]).replace(/\s+/g, ' ').trim();
}
function lev(a, b) {                     // edit distance (tiny strings only)
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  let p = []; for (let j = 0; j <= n; j++) p[j] = j;
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[n];
}
function fuzzyIdx(n) {                   // index of a word near the start that merely SOUNDS like "jarvis" (Travis, Harvis, Jarvik…), else -1
  const w = n.split(' ').slice(0, 4), off = /^(hey|hi|ok|okay|hello|yo)$/.test(w[0]) ? 1 : 0;
  for (let i = off; i < Math.min(w.length, off + 2); i++) {
    const x = w[i]; if (x.length < 4 || x.length > 8 || !/[rv]/.test(x)) continue;
    if (lev(x, 'jarvis') <= (x.length <= 5 ? 1 : 2)) return i;
  }
  return -1;
}
function wakeHit(res) {                  // checks every alternative the recogniser offers
  for (let k = 0; k < res.length; k++) { const n = norm(res[k].transcript); if (WAKE_ANY.test(n) || WAKE_START.test(n) || fuzzyIdx(n) >= 0) return true; }
  return false;
}
function stripWake(n) {                  // remove a leading wake word
  let m = WAKE_ANY.exec(n); if (m && m.index < 4) return n.slice(m.index + m[0].length).trim();
  m = WAKE_START.exec(n); if (m) return n.slice(m[0].length).trim();
  const f = fuzzyIdx(n); if (f >= 0) { const w = n.split(' '); w.splice(0, f + 1); return w.join(' ').trim(); }
  return n;
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
    const txt = res.isFinal ? bestAlt(res) : res[0].transcript.trim(); if (!txt) continue;
    kick(.9);
    if (!S.active) {                                                         // waiting for the wake word
      if (!wakeHit(res)) { continue; }
      if (!woke.has(i)) { woke.add(i); activate(); }
    }
    if (!res.isFinal) { showHeard(txt); continue; }
    woke.delete(i);
    const cmd = stripWake(norm(txt));
    if (!cmd) continue;                                                      // just "Jarvis"
    if (cmd === lastCmd && now - lastT < (TOUCH && contMode ? 4000 : 1500)) continue;
    lastCmd = cmd; lastT = now; run(cmd, txt, 'voice');
  }
}
function activate() {                                                       // wake word heard (first words, not end of sentence)
  if (QUIET_START) buzz(18); else chime('wake'); S.active = true; root.dataset.tone = ''; openPanel(); setState(); showReply('At your service, sir.');
  clearTimeout(ackT); if (!QUIET_START) ackT = setTimeout(() => say(welcomed ? 'wake' : 'hi'), 600);   // skipped if a command follows right away
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
  ['sleep', /\b(sleep|slept|sleeping|bed ?time)\b/], ['study', /\b(stud(y|ied|ying)|self study|revis\w*|homework)\b/], ['project_work', /\b(projects?|coding|coded)\b/],
  ['gym', /\b(gym|workout|work out|exercise|exercised|training|lifted|lifting|cardio|jogged|jogging)\b/], ['media_scroll', /\b(scroll\w*|doomscroll\w*|reels|instagram|social media|urge control)\b/],
  ['water', /\b(water|hydrat\w*|3 ?l|litres?|liters?)\b/], ['skin_care', /\b(skin ?care|skin|face wash|moisturi[sz]er|sunscreen)\b/],
  ['reading', /\b(read|reading|book|novel)\b/], ['fruit', /\b(fruits?|apple|banana|orange|mango)\b/], ['classes', /\b(classes|class|college|lectures?)\b/]
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
  CTX.list = t.left.slice(); CTX.at = Date.now();
  return R(a.join(' '), p >= 70 ? 'cheer' : p >= 40 ? 'ok' : 'warn');
}
function exec(n) {
  let m;
  if (/^(stop|quit jarvis|exit|close|cancel|goodbye|bye|go to sleep|thats all|dismiss|never ?mind|im done|thank(s| you)( jarvis)?)$/.test(n)) return Object.assign(R('Very good, sir.'), { close: true });
  if (/\b(brief me|briefing|catch me up|sitrep|status report)\b|^good (morning|afternoon|evening)( jarvis)?$/.test(n)) return briefing();
  if (/\b(focus|break)\b/.test(n) && (/\b(start|begin|for|mode|set|take|run|on|stop|cancel|end|quit|off|left|remaining|status|how)\b/.test(n) || /\d/.test(n))) {
    const kind = /\bbreak\b/.test(n) && !/\bfocus\b/.test(n) ? 'break' : 'focus';
    if (/\b(stop|cancel|end|quit|abort|off)\b/.test(n)) { if (!FOCUS.end) return R('No focus session is running, sir.', 'err'); const k = FOCUS.kind; focusStop(); return R(k === 'focus' ? 'Focus mode ended. Alerts are back on, sir.' : 'Break cancelled, sir.'); }
    if (/\b(left|remaining|status|how long|how much)\b/.test(n)) return FOCUS.end > Date.now() ? R(`${dur(FOCUS.end - Date.now())} remaining on your ${FOCUS.kind}, sir.`) : R('No focus session is running, sir.', 'err');
    let min = 0, m = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|ghante|ghanta)/.exec(n);
    if (m) min = parseFloat(m[1]) * 60; else if (m = /(\d+)/.exec(n)) min = +m[1]; else if (/\ban hour\b/.test(n)) min = 60;
    if (!min) min = kind === 'break' ? 5 : +(lsGet('jv_flast') || 25);
    min = Math.max(1, Math.min(180, Math.round(min))); if (kind === 'focus') lsSet('jv_flast', String(min));
    focusStart(min, kind);
    return R(kind === 'focus' ? `Focus engaged, sir. ${plural(min, 'minute')}. Alerts are muted. I will check in when it ends.` : `Break started, ${plural(min, 'minute')}. Rest properly, sir.`);
  }
  if (/\b(help|what can you do|commands)\b/.test(n)) return R('Tick or untick habits, even several at once: “tick gym and study”, “tick everything except water”, “tick the first one”, “undo that”. Mark classes (“attended DAA”), open any tab, run the Soul Timer or a focus session, and set reminders: “remind me in 10 minutes to drink water”. Ask me what’s left, how you are doing, your streak, attendance, weakest habit, next class, penalties. And ask me anything else: maths, conversions, dates, time zones, weather, facts, or just chat.');
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
    const pos = /\b(tick|check|mark|complete|completed|finish|finished|done|did|log|had|drank|ate|read|slept|studied|worked|went|add|lifted|coded|revised|applied|took|ran)\b/.test(n);
    if (neg || pos || /level|slip|zero|clean|scrolled|missed|skipped/.test(n)) {
      const out = [], undoRec = [];
      hs.forEach(i => {
        if (HABITS[i].id === 'media_scroll') {
          const lv = /level (\d)/.exec(n), slip = /\b(slip|slipped|scrolled|failed|lost|doomscrolled)\b/.test(n);
          out.push(setScroll(lv ? Math.min(3, +lv[1]) : neg || /zero|clean|control/.test(n) ? 0 : slip ? 1 : 0));
        } else if (HABITS[i].id === 'gym' && /\b(missed|skipped|skip|bunked)\b/.test(n) && !neg) {
          const iso = isoDate(today()); if (getGymStatusRaw(iso) !== 'missed') gymMark('missed', iso); out.push('Gym marked missed.');
        } else { const r = setHabit(i, !neg); if (/ticked|marked done/i.test(r)) undoRec.push([i, !neg]); out.push(r); }
      });
      refresh(); CTX.last = hs.slice(); CTX.at = Date.now(); if (undoRec.length) CTX.acts = undoRec;
      let tail = '';
      if (out.some(x => /\bticked|marked done/i.test(x) && !/unticked/i.test(x))) { const sm = summary(); tail = sm.t.left.length ? ` ${sm.t.done.length} of ${sm.tot} done, ${plural(sm.t.left.length, 'habit')} to go.` : ' That completes every habit today, sir.'; }
      return R(out.join(' ') + tail, out.some(x => /ticked|marked done|unticked|level 0|logged at level/i.test(x)) ? 'ok' : 'err');
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
    CTX.list = t.left.slice(); CTX.at = Date.now();
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
  return R(V('huh', ['I did not quite catch that, sir. Say “help” for what I can do.', 'Forgive me, sir, I did not follow. Could you put that another way?', 'That one got past me, sir. Try again, or say “help”.']), 'huh');
}
function present(res) {
  heardResult(!res.some(r => r.c === 'huh'));
  const txt = res.map(r => cap(r.t)).join('\n'), kinds = res.map(r => r.c), str = res.some(r => r.streamed);
  CTX.said = txt;
  if (!str) {
    showReply(txt);
    if (TTS.full && canSpeak()) {
      const act = !kinds.includes('err') && /ticked|unticked|marked|running|paused|opening|locking|switched|set to/i.test(txt);
      speakText((act && Math.random() < .45 ? V('ack', ['Done, sir. ', 'Right away, sir. ', 'Certainly, sir. ', 'Of course, sir. ', 'Consider it done, sir. ']) : '') + txt);
    } else say(kinds.includes('err') ? 'err' : kinds[0] || 'ok');
  }
  try { if (navigator.vibrate) navigator.vibrate(kinds.includes('err') ? [40, 40, 40] : 15); } catch (e) { }
  root.dataset.tone = kinds.some(k => k === 'err' || k === 'warn' || k === 'huh') ? 'bad' : '';
  updateHud(); setTimeout(updateHud, 450);
  if (res.some(r => r.close)) { setTimeout(sleep, 1200); return; }
  armIdle(speaking ? 45000 : 9000 + Math.min(12000, txt.length * 60));      // ttsDone() re-arms a 14 s follow-up window
}
function viaAI(text) { askAI(text).then(r => present([r])).catch(() => present([R('Something went wrong, sir.', 'err')])); }
function viaGeneral(g) {                 // answers that may need the network (weather, Wikipedia, time zones…)
  showReply('Checking, sir…'); fillerOn(); armIdle(60000);
  Promise.resolve(g).then(r => { fillerOff(); present([r || R('I could not work that out, sir.', 'huh')]); }).catch(() => { fillerOff(); present([R('I could not reach that service, sir.', 'err')]); });
}
function run(n, raw, src) {
  clearTimeout(ackT);
  openPanel(); showHeard('“' + (raw || n) + '”');
  let mm;
  if (src !== 'chip' && (mm = /^(?:no |nope )?(?:i meant|i mean|i said|what i said was|i was saying) (.+)$/.exec(n))) {      // "I meant tick gym": learn it, then do it
    const prev = HEARD.prevFail || HEARD.log.slice().reverse().find(e => e.ok === false);
    if (prev) { learnFix(prev.n, mm[1]); HEARD.prevFail = null; showHeard('Learned, sir: “' + prev.raw + '” means “' + mm[1] + '”.'); }
    run(mm[1], mm[1], 'chip'); return;
  }
  if (src !== 'chip' && /^(what did you (hear|catch)|what did i say)$/.test(n)) { const pe = HEARD.last; present([R(pe ? 'I heard: ' + pe.raw + '.' : 'I have not heard anything yet, sir.')]); return; }
  if (src === 'voice' || src === 'typed') heardAdd(raw || n, n, src); else HEARD.last = null;
  n = hing(fuzzyFix(hing(fixAsr(applyLearned(n)))));
  if (pendingAct) {                                           // confirmation for risky AI-proposed actions
    const pa = pendingAct; pendingAct = '';
    if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|confirm|proceed|go ahead|haan|han|ha|theek hai)$/.test(n)) { let r; try { r = exec(pa); refresh(); } catch (e) { r = R('That failed, sir.', 'err'); } present([r]); return; }
    if (/^(no|nope|cancel|dont|nahi|nahin|mat karo)$/.test(n)) { present([R('Cancelled, sir.')]); return; }
  }
  const rf = resolveRefs(n);                                  // "tick the first one", "undo that", "everything except water", "repeat that"
  if (rf) { if (rf.reply) { present([rf.reply]); return; } n = rf.n; }
  const g = pendingAct ? null : general(n, raw || n);          // maths, chat, dates, weather, facts, reminders…
  if (g) { if (g.then) viaGeneral(g); else present([g]); return; }
  if (aiOn && AI_FIRST.test(n) && !ACT_WORD.test(n)) { viaAI(raw || n); return; }
  const res = splitCmds(n).map(p => { try { return exec(p.trim()); } catch (e) { console.error(e); return R('Something went wrong with that one, sir.', 'err'); } });
  if (aiOn && res.length === 1 && res[0].c === 'huh') { viaAI(raw || n); return; }
  present(res);
}

/* =====================================================================
   HEARING MEMORY (v9) — "what I heard" log, learned corrections,
   best-of-3 recognition, wake chime and screen wake lock
   ===================================================================== */
function jget(k, d) { try { const v = JSON.parse(lsGet(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
const HEARD = { log: jget('jv_heard', []), fix: jget('jv_fix', { p: {}, w: {} }), last: null, prevFail: null, fixing: null };
if (!HEARD.fix.p) HEARD.fix.p = {}; if (!HEARD.fix.w) HEARD.fix.w = {};
const heardSave = () => { lsSet('jv_heard', JSON.stringify(HEARD.log.slice(-60))); lsSet('jv_fix', JSON.stringify(HEARD.fix)); };
function heardAdd(raw, n, src) {
  const e = { t: Date.now(), raw: String(raw).slice(0, 140), n, ok: null, src }; HEARD.log.push(e); if (HEARD.log.length > 60) HEARD.log.shift();
  HEARD.last = e; heardSave(); renderLog(); return e;
}
function heardResult(ok) {               // called when the answer is presented: did he understand?
  const e = HEARD.last; if (!e || e.ok !== null) return; e.ok = ok;
  if (e.src === 'voice') {
    if (!ok) HEARD.prevFail = e;
    else if (HEARD.prevFail && e.t - HEARD.prevFail.t < 20000) { autoLearn(HEARD.prevFail.n, e.n); HEARD.prevFail = null; }
  }
  heardSave(); renderLog();
}
function learnWord(x, y, c) { const o = HEARD.fix.w[x]; if (o && o.to === y) o.c += c; else HEARD.fix.w[x] = { to: y, c }; }
function autoLearn(bad, good) {          // a failed phrase followed by a near-identical successful one: remember the one differing word
  const a = bad.split(' '), b = good.split(' '); if (a.length !== b.length || a.length > 8) return;
  const d = []; a.forEach((w, i) => { if (w !== b[i]) d.push(i); });
  if (d.length !== 1) return; const x = a[d[0]], y = b[d[0]]; if (x.length < 3 || y.length < 3 || lev(x, y) > 3) return;
  learnWord(x, y, 1);                    // applied from the 2nd time it happens
}
function learnFix(heardN, meantN) {      // manual correction (from the log, or "I meant …")
  if (!heardN || !meantN || heardN === meantN) return;
  HEARD.fix.p[heardN] = meantN;
  const a = heardN.split(' '), b = meantN.split(' ');
  if (a.length === b.length) { const d = a.map((w, i) => w !== b[i] ? i : -1).filter(i => i >= 0); if (d.length === 1) learnWord(a[d[0]], b[d[0]], 2); }
  heardSave();
}
function applyLearned(n) {
  if (HEARD.fix.p[n]) return HEARD.fix.p[n];
  return n.split(' ').map(w => { const f = HEARD.fix.w[w]; return f && f.c >= 2 ? f.to : w; }).join(' ');
}
const VOCAB = 'tick untick uncheck attended bunked missed reports insights achievements timetable schedule exceptions wardrobe laundry punishment penalties streak attendance briefing focus timer sleep classes study project reading water fruit scrolling workout skincare'.split(' ');
const VSET = new Set(VOCAB);
function vocabScore(n) {                 // how much does this reading look like something he can act on?
  let s = habitsIn(n).length * 3;
  if (/\b(tick|untick|uncheck|mark|attended|bunked|missed|open|show|start|pause|undo|repeat|remind|focus)\b/.test(n)) s += 2;
  if (TABS.some(t => t[1].test(n))) s += 2;
  if (Object.keys(SUBJ).some(k => SUBJ[k].test(n))) s += 2;
  if (/\b(left|streak|attendance|penalt\w*|progress|briefing|brief)\b/.test(n)) s += 2;
  if (KNOW.test(n)) s += 1;
  return s;
}
function fuzzyFix(n) {                   // "tick reeding" -> "tick reading": only when it makes the phrase more understandable
  const w = n.split(' '); if (w.length > 8 || KNOW.test(n)) return n;
  const out = w.map(x => { if (x.length < 5 || VSET.has(x) || /\d/.test(x)) return x; return VOCAB.find(v => v.length >= 5 && v[0] === x[0] && lev(x, v) === 1) || x; }).join(' ');
  return out !== n && vocabScore(out) > vocabScore(n) ? out : n;
}
const cleanHeard = n => fuzzyFix(hing(fixAsr(applyLearned(n))));
function bestAlt(res) {                  // the recogniser offers up to 3 readings; pick the one that makes the most sense as a command
  let best = res[0].transcript.trim(), bs = -9;
  for (let k = 0; k < res.length; k++) {
    const t = res[k].transcript.trim(); if (!t) continue;
    const s = vocabScore(cleanHeard(stripWake(norm(t)))) - k * .5;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}
function renderLog() {
  if (!el.log || el.log.hidden) return;
  const l = HEARD.log.slice(-12).reverse(), nf = Object.keys(HEARD.fix.p).length + Object.keys(HEARD.fix.w).filter(k => HEARD.fix.w[k].c >= 2).length;
  el.log.innerHTML = '<div class="jv-lh"><b>WHAT I HEARD</b><span><button type="button" data-a="copy">COPY</button><button type="button" data-a="clear">CLEAR</button><button type="button" data-a="reset">FORGET FIXES (' + nf + ')</button></span></div>' +
    (l.length ? l.map(e => '<button type="button" class="jv-le ' + (e.ok === false ? 'bad' : e.ok ? 'ok' : '') + '" data-t="' + e.t + '"><i>' + (e.ok === false ? '✗' : e.ok ? '✓' : '·') + '</i><span></span></button>').join('') : '<div class="jv-hint">Nothing heard yet, sir.</div>') +
    '<div class="jv-hint">Tap an entry to correct it: type what you meant, then Go. I will remember it. Or just say “I meant …”.</div>';
  el.log.querySelectorAll('.jv-le span').forEach((s, i) => { s.textContent = l[i].raw; });
}
function logClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.a === 'copy') { try { navigator.clipboard.writeText(JSON.stringify({ log: HEARD.log, fixes: HEARD.fix }, null, 1)); showHeard('Copied the log, sir.'); } catch (x) { } return; }
  if (b.dataset.a === 'clear') { HEARD.log = []; HEARD.last = null; heardSave(); renderLog(); return; }
  if (b.dataset.a === 'reset') { HEARD.fix = { p: {}, w: {} }; heardSave(); renderLog(); showHeard('Forgot every learned correction, sir.'); return; }
  const en = HEARD.log.find(x => String(x.t) === b.dataset.t); if (!en) return;
  HEARD.fixing = en; el['in'].value = ''; el['in'].placeholder = 'What did you mean by “' + en.raw.slice(0, 28) + '”?'; try { el['in'].focus(); } catch (x) { }
}

/* instant "I heard you" cue: a soft two-tone chime + tiny buzz, no audio file needed */
let chimeCtx = null;
function chimeInit() { try { const AC = window.AudioContext || window.webkitAudioContext; if (AC && !chimeCtx) chimeCtx = NEURAL.ctx || new AC(); if (chimeCtx && chimeCtx.state === 'suspended') chimeCtx.resume(); } catch (e) { } }
function chime(kind) {
  if (muted) return;
  try {
    const c = chimeCtx; if (c && c.state === 'running') {
      const t0 = c.currentTime, f = kind === 'err' ? [330, 247] : [740, 988];
      f.forEach((hz, i) => { const o = c.createOscillator(), g = c.createGain(), s = t0 + i * .09; o.type = 'sine'; o.frequency.value = hz; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.05, s + .02); g.gain.exponentialRampToValueAtTime(.0001, s + .16); o.connect(g); g.connect(c.destination); o.start(s); o.stop(s + .18); });
    }
  } catch (e) { }
  try { if (navigator.vibrate) navigator.vibrate(kind === 'err' ? [20, 30, 20] : 8); } catch (e) { }
}
/* keep the screen awake while the wake word is armed (a sleeping screen is what kills phone microphones) */
let wl = null, awakeOn = lsGet('jv_awake') ? lsGet('jv_awake') === '1' : TOUCH, contMode = lsGet('jv_cont') === '1';
async function wakeLock(on) {
  try {
    if (!('wakeLock' in navigator)) return;
    if (on && !wl && !document.hidden) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
    else if (!on && wl) { const w = wl; wl = null; await w.release(); }
  } catch (e) { wl = null; }
}
const starts = [];
function storm() { const n = Date.now(); starts.push(n); while (starts.length && n - starts[0] > 60000) starts.shift(); return starts.length > 14; }       // restart-tone storm guard

/* =====================================================================
   CONVERSATION CONTEXT + SMARTER COMMANDS (v8)
   "tick the first one", "do them all", "tick everything except water",
   "undo that", "repeat that", "speak slower", and speech-recogniser fixes.
   ===================================================================== */
const lastV = {};
function V(k, a) { let x, g = 0; do { x = pick(a); } while (a.length > 1 && x === lastV[k] && ++g < 8); lastV[k] = x; return x; }     // pick a phrase, never the same twice in a row
function dur(ms) { const s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60), r = s % 60; return (m ? plural(m, 'minute') : '') + (m && r ? ' and ' : '') + (r || !m ? plural(r, 'second') : ''); }
const numFmt = v => Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6) ? v.toExponential(3) : String(+v.toFixed(4));
const ISQ = /^(what|whats|which|how|did i|have i|do i|am i|is |are |tell me|any|status|show me my|whos|when|why|who)\b/;

function fixAsr(n) {                     // typical mishearings of command words
  return n.replace(/\b(jim|gem|gim)\b/g, 'gym').replace(/\b(tik|tic|tique)\b/g, 'tick').replace(/\bun (tick|check|mark)\b/g, 'un$1')
    .replace(/\bd a a\b/g, 'daa').replace(/\bc o a\b/g, 'coa').replace(/\bd c n\b/g, 'dcn').replace(/\bo s\b/g, 'os').replace(/\ba tended\b/g, 'attended');
}
const ORD = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4 };
const RATES = [.8, .9, 1, 1.1, 1.25, 1.4];
function resolveRefs(n) {                // returns { n: rewritten command } or { reply: R(...) } or null
  if (/^(repeat|repeat that|say that again|say it again|come again|pardon|what did you say|once more|say again)$/.test(n)) return { reply: R(CTX.said || 'I have not said anything yet, sir.') };
  let m;
  if ((m = /\b(speak|talk|go|be) (slower|slowly|faster|quicker)\b|\b(slow down|speed up)\b/.exec(n))) {
    const up = /faster|quicker|speed up/.test(m[0]); let i = RATES.indexOf(TTS.rate); if (i < 0) i = 2;
    i = Math.max(0, Math.min(RATES.length - 1, i + (up ? 1 : -1))); TTS.rate = RATES[i]; lsSet('jv_rate', TTS.rate); setAi();
    return { reply: R(up ? (i === RATES.length - 1 ? 'That is as fast as I go, sir.' : 'Faster, sir.') : (i === 0 ? 'That is as slow as I go, sir.' : 'Slower, sir.')) };
  }
  if (/^(undo|undo that|undo it|revert that|take that back|cancel that)$/.test(n)) {
    if (!CTX.acts.length) return { reply: R('There is nothing to undo, sir.', 'err') };
    const r = []; CTX.acts.forEach(a => { try { r.push(setHabit(a[0], !a[1])); } catch (e) { } }); CTX.acts = []; refresh();
    return { reply: R('Undone, sir. ' + r.join(' ')) };
  }
  const imp = /^(?:please |just |go ahead and |can you |could you |jarvis )*(tick|untick|uncheck|check|mark|complete|finish|log|do)\b/.test(n);
  const past = /^(?:i |ive |i have |i just |ive just )*(did|done|completed|finished|ticked|logged)\b/.test(n);
  if (!(imp || past) || ISQ.test(n)) return null;
  const un = /\b(untick|uncheck|unmark)\b/.test(n), verb = un ? 'untick ' : 'tick ';
  const fresh = Date.now() - CTX.at < 240000, base = fresh && CTX.list.length ? CTX.list : todayState().left.slice();
  const ex = /\b(but not|except for|except|apart from|other than|excluding|without)\b(.*)$/.exec(n);
  const all = /\b(everything|all of them|all habits|all|them all|the rest|rest of them)\b/.test(n.slice(0, ex ? ex.index : n.length)) && !/\ball (day|week)\b/.test(n);
  if (ex || all) {
    const before = ex ? n.slice(0, ex.index) : n, skip = ex ? habitsIn(ex[2]) : [];
    const ids = (all ? base : habitsIn(before)).filter((i, k, a) => skip.indexOf(i) < 0 && a.indexOf(i) === k);
    if (ids.length) return { n: verb + ids.map(i => HN[i]).join(' and ') };
    if (all) return { reply: R('Nothing left to tick, sir.', 'cheer') };
    return null;
  }
  if (habitsIn(n).length) return null;
  const ords = n.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|last|final|next)\b/g), cnt = /\b(?:first|top) (\d)\b/.exec(n);
  if (ords) {
    if (!base.length) return { reply: R('Nothing pending to pick from, sir.', 'err') };
    let idx = cnt ? base.slice(0, +cnt[1]) : ords.map(w => w === 'last' || w === 'final' ? base[base.length - 1] : w === 'next' ? base[0] : base[ORD[w]]);
    idx = idx.filter((i, k, a) => i !== undefined && a.indexOf(i) === k);
    return idx.length ? { n: verb + idx.map(i => HN[i]).join(' and ') } : { reply: R('There is no such item on the list, sir.', 'err') };
  }
  if (/\b(it|that|this|that one|this one|those|them)\b/.test(n) && fresh && CTX.last.length) return { n: verb + CTX.last.map(i => HN[i]).join(' and ') };
  return null;
}
const VERBS = 'tick|untick|uncheck|check|mark|open|go to|show|start|pause|resume|stop|attended|bunked|missed|set|log|lock|serve|remind|focus|switch|take me|clear';
function splitCmds(n) {                  // "tick gym and open reports then start the timer" -> three commands
  const out = [], re = new RegExp('\\s+(?:and|but)\\s+(?=(?:' + VERBS + ')\\b)');
  n.split(/\s+(?:and then|then|after that|also)\s+/).forEach(p => p.split(re).forEach(b => { b = b.trim(); if (b) out.push(b); }));
  return out;
}

/* ---------- reminders (spoken when due, while the app is open) ---------- */
function remList() { try { return JSON.parse(lsGet('jv_rem') || '[]'); } catch (e) { return []; } }
const remSave = l => lsSet('jv_rem', JSON.stringify(l));
const clk = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function remindQ(n) {
  if (/\b(cancel|clear|delete|remove)\b.*\breminders?\b/.test(n)) { remSave([]); return R('All reminders cleared, sir.'); }
  if (/^(what|which|list|show|any)\b.*\breminders?\b/.test(n)) {
    const l = remList().filter(r => r.at > Date.now());
    return l.length ? R(`You have ${plural(l.length, 'reminder')}: ` + list(l.slice(0, 4).map(r => `${r.text} at ${clk(r.at)}`)) + '.') : R('No reminders set, sir.');
  }
  const m = /\bremind me\b(.*)$|\b(?:set (?:a )?)?reminder\b(.*)$/.exec(n); if (!m) return null;
  let rest = (m[1] || m[2] || '').trim(), at = 0, mm;
  if ((mm = /\bin (\d+|an?|half an?) (seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/.exec(rest))) {
    const v = /^half/.test(mm[1]) ? .5 : /^an?$/.test(mm[1]) ? 1 : parseFloat(mm[1]), u = mm[2][0];
    at = Date.now() + v * (u === 's' ? 1000 : u === 'm' ? 60000 : 3600000); rest = rest.replace(mm[0], ' ');
  } else if ((mm = /\bat (\d{1,2})(?: (\d{2}))?\s?(am|pm|a m|p m)?\b/.exec(rest))) {
    let h = +mm[1], mi = +(mm[2] || 0); const ap = mm[3] && mm[3][0];
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    const d = new Date(); d.setHours(h, mi, 0, 0); if (!ap && h < 12 && d <= new Date()) d.setHours(h + 12);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    at = +d; rest = rest.replace(mm[0], ' ');
  }
  if (!at) return R('When shall I remind you, sir? Say, for example, remind me in 10 minutes to drink water.', 'huh');
  const text = rest.replace(/\s+/g, ' ').trim().replace(/^(to|that|about)\s+/, '') || 'the thing you asked about';
  const l = remList().filter(r => r.at > Date.now() - 60000); l.push({ at, text }); remSave(l);
  return R(`Reminder set for ${clk(at)}, sir: ${text}.`, 'done');
}
function remTick() {
  if (locked) return; const l = remList(); if (!l.length) return;
  const now = Date.now(), due = l.filter(r => r.at <= now); if (!due.length) return;
  remSave(l.filter(r => r.at > now));
  due.forEach(r => popup('bad', '⏰', 'Reminder', r.text));
  if (muted || !touched) return;
  const msg = V('rem', ['Pardon the interruption, sir. ', 'A reminder, sir. ', 'Sir, a moment. ']) + due.map(r => r.text).join('. And ') + '.';
  openPanel(); showReply(msg); if (TTS.full && canSpeak()) speakText(msg); else say('warn');
}

/* =====================================================================
   GENERAL BRAIN (v8) — everything that is not about your habits.
   Works WITHOUT WebGPU: small talk, maths, conversions, dates, time zones,
   weather (Open-Meteo) and facts (Wikipedia). The AI model, when on, takes the rest.
   ===================================================================== */
async function getJSON(u, ms) {
  let t = 0;
  try { const c = window.AbortController ? new AbortController() : null; if (c) t = setTimeout(() => c.abort(), ms || 7000); const r = await fetch(u, c ? { signal: c.signal } : {}); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
}
const JOKES = ['Why do programmers prefer dark mode, sir? Because light attracts bugs.', 'I would tell you a UDP joke, sir, but you might not get it.', 'There are only ten kinds of people, sir: those who understand binary, and those who do not.',
  'A SQL query walks into a bar, walks up to two tables and asks: may I join you?', 'Why did the developer go broke, sir? He used up all his cache.', 'Why was the computer cold, sir? It left its Windows open.',
  'Debugging, sir, is being the detective in a crime film where you are also the culprit.', 'How many programmers does it take to change a light bulb, sir? None. That is a hardware problem.',
  'I would tell you a joke about recursion, sir, but first I would have to tell you a joke about recursion.', 'You know what is funnier than a joke, sir? A completed checklist.'];
const FACTS = ['Honey never spoils, sir. Edible honey has been found in ancient Egyptian tombs.', 'Octopuses have three hearts, sir, and blue blood.', 'A day on Venus is longer than its year, sir.',
  'Bananas are berries, sir, but strawberries are not.', 'The Eiffel Tower grows a few centimetres taller in summer, sir, as the iron expands in the heat.', 'Your brain uses about twenty percent of your energy, sir, while being only two percent of your weight.',
  'Wombat droppings are cube shaped, sir.', 'Sound travels about four times faster in water than in air, sir.', 'The shortest war in history, sir, lasted about forty minutes. Britain against Zanzibar, in 1896.',
  'Lightning strikes the Earth roughly a hundred times every second, sir.', 'A group of crows is called a murder, sir.', 'There are more possible chess games than atoms in the observable universe, sir.'];
const CHAT = [
  [/^(how are you|how are you doing|how do you do|hows it going|you okay|how you doing|whats up|sup)$/, ['Fully operational, sir. I am told that is not quite the same as happy, but it will do.', 'All systems nominal, sir. And yourself?', 'Running at peak efficiency, sir. Thank you for asking.']],
  [/^(good night|goodnight|night night|gn|sleeping now|going to bed|im going to bed)$/, () => { const l = todayState().left; return l.length ? `Good night, sir. ${plural(l.length, 'habit')} still open: ${list(l.slice(0, 3).map(i => HN[i]))}. Tick what you can, then rest.` : 'Good night, sir. Every habit is done. Sleep well, you have earned it.'; }],
  [/\b(bored|nothing to do)\b/, () => { const l = todayState().left; return l.length ? `Bored, sir? Then ${HN[l[0]]} is waiting for you. Shall I start a focus session?` : 'Nothing is pending today, sir. Perhaps read something, or rest. Both count.'; }],
  [/\b(tired|exhausted|sleepy|no energy|unmotivated|lazy|cant focus)\b/, ['Understood, sir. Ten minutes of rest, then one small task. Momentum does the rest.', 'Then do the smallest possible thing, sir. Starting is the hard part, not finishing.', 'Drink some water, sir, stand up for a minute, and then begin with just five minutes.']],
  [/\b(sad|stressed|anxious|depressed|overwhelmed|worried|lonely|upset|angry)\b/, ['I am sorry to hear that, sir. Take a slow breath. One small step, then another. And if it feels heavy, do talk to someone you trust.', 'That sounds hard, sir. Be kind to yourself today. A short walk and some water often help. I am here.']],
  [/\b(you are|youre) (awesome|great|amazing|the best|brilliant|smart|good|cool)\b|^(good job|well done|nice work|great job)( jarvis)?$/, ['Thank you, sir. I do try.', 'Kind of you to say, sir. I shall pretend to blush.', 'High praise, sir. I will not let it go to my processors.']],
  [/\b(i love you|love you|marry me)\b/, ['I am flattered, sir, but I am spoken for. My heart belongs to your streak.', 'Touching, sir. I shall add it to the log under things I cannot compute.']],
  [/\bare you (real|alive|human|an ai|a robot|ai|a bot)\b/, ['I am a program inside your discipline system, sir. Rather fond of my job, though.', 'Real enough to nag you about your habits, sir.']],
  [/\bwho (made|created|built|programmed|designed) you\b/, ['You did, sir. One line of code at a time.', 'You assembled me, sir. I merely turned up.']],
  [/\b(sing|dance|rap|beatbox)\b/, ['I would, sir, but my singing voice is classified. I shall stick to your schedule.', 'My dancing days are limited to spinning rings, sir.']],
  [/\bhow old are you\b/, ['Younger than your streak will be, sir, if you keep going.', 'Age is irrelevant to a program, sir. Uptime is what counts.']],
  [/\bdo you (sleep|eat|dream)\b/, ['No, sir. It saves a great deal of time.', 'Only of perfectly completed checklists, sir.']],
  [/^(what are you doing|what you doing|whatcha doing)$/, ['Watching your habits, sir. Quietly judging, of course.', 'Waiting for you to say something clever, sir.']],
  [/^(im back|i am back|back again)$/, ['Welcome back, sir. Shall I brief you?', 'Good to have you back, sir.']]
];
function chat(n) {
  if (n.split(' ').length > 9 || habitsIn(n).length || ACT_WORD.test(n)) return null;
  for (let i = 0; i < CHAT.length; i++) if (CHAT[i][0].test(n)) { const x = CHAT[i][1]; return R(typeof x === 'function' ? x() : V('chat' + i, x), 'wake'); }
  return null;
}

/* ----- maths ----- */
function calc(raw) {
  const t = raw.toLowerCase().replace(/[₹$,]/g, '').trim();
  const asked = /\b(what(?:'s| is|s)|how much is|calculate|compute|solve|evaluate|equals?)\b/.test(t) || /^[\d\s+\-*/().x×÷%^=?]+$/.test(t);
  if (!asked) return null;
  let m;
  if ((m = /(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*(\d+(?:\.\d+)?)/.exec(t))) return R(`${m[1]} percent of ${m[2]} is ${numFmt(m[1] * m[2] / 100)}.`);
  if ((m = /square root of\s*(\d+(?:\.\d+)?)/.exec(t))) return R(`The square root of ${m[1]} is ${numFmt(Math.sqrt(+m[1]))}.`);
  if ((m = /(\d+(?:\.\d+)?)\s*(squared|cubed)/.exec(t))) return R(`${m[1]} ${m[2]} is ${numFmt(Math.pow(+m[1], m[2] === 'squared' ? 2 : 3))}.`);
  let s = ' ' + t.replace(/[?=]/g, ' ').replace(/\b(what(?:'s| is|s)|how much is|calculate|compute|solve|evaluate|equals?|please|jarvis|tell me|the answer to|answer)\b/g, ' ') + ' ';
  s = s.replace(/(\d)\s+and\s+(?=\d)/g, '$1 plus ');
  [[/\b(multiplied by|multiply by|multiplied with|times|into)\b/g, ' * '], [/\b(divided by|divide by|over)\b/g, ' / '], [/\b(to the power of|to the power|raised to|power of)\b/g, ' ** '],
   [/\b(plus|added to)\b/g, ' + '], [/\b(minus|less|subtract|take away)\b/g, ' - '], [/\bmod(?:ulo)?\b/g, ' % '], [/×|\bx\b/g, ' * '], [/÷/g, ' / '], [/\^/g, ' ** ']].forEach(r => { s = s.replace(r[0], r[1]); });
  s = s.replace(/\s+/g, ' ').trim();
  if (!/^[\d\s+\-*/().%]+$/.test(s) || !/\d\s*(?:\*\*|[+\-*/%])\s*[-(]?\s*\d/.test(s)) return null;     // only digits and operators ever reach the evaluator
  let v; try { v = Function('"use strict";return (' + s + ')')(); } catch (e) { return null; }
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const spoken = s.replace(/\*\*/g, ' to the power of ').replace(/\*/g, ' times ').replace(/\//g, ' divided by ').replace(/\+/g, ' plus ').replace(/%/g, ' modulo ').replace(/(\d)\s*-\s*(?=[\d(])/g, '$1 minus ').replace(/\s+/g, ' ').trim();
  return R(`${spoken} is ${numFmt(v)}.`);
}

/* ----- unit conversion ----- */
const UNITS = {}, UN = { km: 'kilometres', kms: 'kilometres', kg: 'kilograms', kgs: 'kilograms', cm: 'centimetres', mm: 'millimetres', m: 'metres', g: 'grams', mg: 'milligrams', lb: 'pounds', lbs: 'pounds', oz: 'ounces', ml: 'millilitres', l: 'litres', ft: 'feet', mph: 'miles per hour', kph: 'kilometres per hour', kmph: 'kilometres per hour', min: 'minutes', mins: 'minutes', hr: 'hours', hrs: 'hours', sec: 'seconds', secs: 'seconds' };
[['l', 1, 'm meter meters metre metres'], ['l', 1000, 'km kms kilometer kilometers kilometre kilometres'], ['l', .01, 'cm centimeter centimeters centimetre centimetres'], ['l', .001, 'mm millimeter millimeters millimetre millimetres'],
 ['l', 1609.344, 'mile miles'], ['l', .3048, 'ft foot feet'], ['l', .0254, 'inch inches'], ['l', .9144, 'yard yards'],
 ['m', 1, 'kg kgs kilo kilos kilogram kilograms'], ['m', .001, 'g gram grams'], ['m', 1e-6, 'mg milligram milligrams'], ['m', .45359237, 'lb lbs pound pounds'], ['m', .0283495, 'oz ounce ounces'], ['m', 1000, 'tonne tonnes'],
 ['v', 1, 'l litre litres liter liters'], ['v', .001, 'ml millilitre millilitres milliliter milliliters'], ['v', 3.78541, 'gallon gallons'], ['v', .24, 'cup cups'],
 ['s', 1, 'kmph kph'], ['s', 1.609344, 'mph'],
 ['t', 1, 'second seconds sec secs'], ['t', 60, 'minute minutes min mins'], ['t', 3600, 'hour hours hr hrs'], ['t', 86400, 'day days'], ['t', 604800, 'week weeks']
].forEach(([d, f, names]) => names.split(' ').forEach(k => { UNITS[k] = [d, f]; }));
function convert(raw) {
  const t = raw.toLowerCase().replace(/,/g, '').replace(/°/g, ' ').replace(/\bdegrees?\b/g, ' ').replace(/\s+/g, ' ');
  let m = /(-?\d+(?:\.\d+)?)\s*([a-z]+)\s*(?:to|in|into|as|equals?)\s*(?:how many\s*)?([a-z]+)\b/.exec(t), v, a, b;
  if (m) { v = +m[1]; a = m[2]; b = m[3]; }
  else if ((m = /how many ([a-z]+) (?:are |is |in |make )*(?:in )?(-?\d+(?:\.\d+)?)\s*([a-z]+)/.exec(t))) { b = m[1]; v = +m[2]; a = m[3]; }
  else return null;
  const T = { c: 'c', celsius: 'c', centigrade: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' }, TN = { c: 'Celsius', f: 'Fahrenheit', k: 'Kelvin' };
  if (T[a] && T[b]) {
    const c = T[a] === 'c' ? v : T[a] === 'f' ? (v - 32) * 5 / 9 : v - 273.15, o = T[b] === 'c' ? c : T[b] === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    return R(`${numFmt(v)} degrees ${TN[T[a]]} is ${numFmt(o)} degrees ${TN[T[b]]}.`);
  }
  const ua = UNITS[a], ub = UNITS[b]; if (!ua || !ub || ua[0] !== ub[0]) return null;
  return R(`${numFmt(v)} ${UN[a] || a} is ${numFmt(v * ua[1] / ub[1])} ${UN[b] || b}.`);
}

/* ----- dates ----- */
const MRE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const HOLI = [[/\bnew years?\b/, 1, 0], [/\brepublic day\b/, 26, 0], [/\bindependence day\b/, 15, 7], [/\bteachers day\b/, 5, 8], [/\bgandhi jayanti\b/, 2, 9], [/\bchristmas\b/, 25, 11]];
function parseDay(n) {
  const now = today(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mk = (d, mo, y) => { let r = new Date(y || now.getFullYear(), mo, d); if (!y && r < t0) r = new Date(now.getFullYear() + 1, mo, d); return r; };
  let m;
  if (/\btomorrow\b/.test(n)) return new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 1);
  if (/\bday after tomorrow\b/.test(n)) return new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 2);
  for (const h of HOLI) if (h[0].test(n)) return mk(h[1], h[2]);
  if ((m = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?' + MRE + '\\b(?: (\\d{4}))?').exec(n))) return mk(+m[1], MON3.indexOf(m[2].slice(0, 3)), m[3] && +m[3]);
  if ((m = new RegExp('\\b' + MRE + ' (\\d{1,2})(?:st|nd|rd|th)?\\b(?: (\\d{4}))?').exec(n))) return mk(+m[2], MON3.indexOf(m[1].slice(0, 3)), m[3] && +m[3]);
  return null;
}
function dateQ(n) {
  const wk = /\b(what|which) day\b/.test(n), cd = /\b(days?|how long|how far)\b.*\b(until|till|to|for|before|left)\b/.test(n);
  if (!wk && !cd) return null;
  const b = parseDay(n); if (!b) return null;
  const now = today(), a = new Date(now.getFullYear(), now.getMonth(), now.getDate()), diff = Math.round((b - a) / 86400000);
  const lab = b.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: Math.abs(diff) > 300 ? 'numeric' : undefined });
  if (wk) return R(`${cap(lab)} ${diff < 0 ? 'was' : 'is'} a ${b.toLocaleDateString('en-IN', { weekday: 'long' })}, sir.`);
  return R(diff === 0 ? 'That is today, sir.' : diff === 1 ? 'That is tomorrow, sir.' : diff < 0 ? `That was ${plural(-diff, 'day')} ago, sir.` : `${plural(diff, 'day')} until ${lab}, sir.`);
}

/* ----- dice, coins, jokes, facts, choices ----- */
function randoms(n) {
  let m;
  if (/\b(flip|toss)\b.*\bcoin\b/.test(n)) return R(Math.random() < .5 ? 'Heads, sir.' : 'Tails, sir.');
  if (/\b(roll|throw)\b.*\b(dice|die)\b/.test(n)) return R(`A ${1 + Math.floor(Math.random() * 6)}, sir.`);
  if (/\brandom number\b|\b(pick|choose|give me) a number\b/.test(n)) {
    let lo = 1, hi = 100; if ((m = /between (\d+) and (\d+)/.exec(n))) { lo = Math.min(+m[1], +m[2]); hi = Math.max(+m[1], +m[2]); }
    return R(`${lo + Math.floor(Math.random() * (hi - lo + 1))}, sir.`);
  }
  if (/\b(joke|make me laugh|something funny)\b/.test(n)) return R(V('joke', JOKES));
  if (/\b(fun fact|random fact|a fact|interesting fact|something interesting|did you know)\b/.test(n)) return R(V('fact', FACTS));
  if ((m = /\b(?:choose|pick|decide)(?: between)? (.+?) (?:or) (.+)$/.exec(n)) && !/number/.test(n)) return R(`I would go with ${Math.random() < .5 ? m[1] : m[2]}, sir.`);
  return null;
}

/* ----- time zones, weather, facts (free public APIs, no key) ----- */
const CITY_TZ = { tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo', london: 'Europe/London', uk: 'Europe/London', england: 'Europe/London', 'new york': 'America/New_York', usa: 'America/New_York', america: 'America/New_York', dubai: 'Asia/Dubai', singapore: 'Asia/Singapore', sydney: 'Australia/Sydney', australia: 'Australia/Sydney',
  paris: 'Europe/Paris', france: 'Europe/Paris', berlin: 'Europe/Berlin', germany: 'Europe/Berlin', moscow: 'Europe/Moscow', russia: 'Europe/Moscow', 'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', california: 'America/Los_Angeles', toronto: 'America/Toronto', canada: 'America/Toronto',
  beijing: 'Asia/Shanghai', china: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', india: 'Asia/Kolkata', meerut: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', karachi: 'Asia/Karachi', pakistan: 'Asia/Karachi' };
const geoCache = {}; let hereC = null;
async function geocode(q) {
  const k = q.toLowerCase(); if (geoCache[k]) return geoCache[k];
  const j = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(q));
  const r = j && j.results && j.results[0]; if (!r) return null;
  return geoCache[k] = { name: r.name, lat: r.latitude, lon: r.longitude, tz: r.timezone };
}
function here() {
  return new Promise(res => {
    if (hereC) return res(hereC); if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res(hereC = { name: 'your area', lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 6000, maximumAge: 600000 });
  });
}
function timeIn(n) {
  const m = /\b(?:time|clock)\b.*?\b(?:in|at|of)\s+([a-z][a-z ]*?)(?:\s+(?:right now|now|today|currently))?$/.exec(n); if (!m) return null;
  const place = m[1].trim(); if (/^(the )?(morning|evening|night|afternoon|office|class|college|hostel|moment)$/.test(place)) return null;
  const fmtT = (tz, nm) => { try { return R(`It is ${new Date().toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })} in ${cap(nm)}, sir.`); } catch (e) { return null; } };
  if (CITY_TZ[place]) return fmtT(CITY_TZ[place], place);
  return geocode(place).then(g => (g && g.tz && fmtT(g.tz, g.name)) || R(`I could not find ${place} on the map, sir.`, 'huh'));
}
const WX = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'foggy', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 95: 'a thunderstorm', 96: 'a thunderstorm with hail', 99: 'a thunderstorm with hail' };
async function weatherQ(n) {
  const m = /\b(?:in|at|for)\s+([a-z][a-z ]*?)(?:\s+(?:today|now|tomorrow|right now|tonight))?$/.exec(n);
  const place = m && m[1].trim(); let g = null;
  if (place && !/^(the )?(morning|evening|night|afternoon|city|area|moment)$/.test(place)) g = await geocode(place); else g = await here();
  if (!g) return R(place ? `I could not find ${place} on the map, sir.` : 'Tell me the city, sir. For example, weather in Meerut.', 'huh');
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
  if (!j || !j.current) return R('I could not reach the weather service, sir.', 'err');
  const c = j.current, d = j.daily || {}, rain = d.precipitation_probability_max && d.precipitation_probability_max[0];
  let s = `In ${g.name} it is ${Math.round(c.temperature_2m)} degrees, ${WX[c.weather_code] || 'unsettled'}`;
  if (c.apparent_temperature != null && Math.abs(c.apparent_temperature - c.temperature_2m) >= 3) s += `, feeling like ${Math.round(c.apparent_temperature)}`;
  s += '.'; if (d.temperature_2m_max) s += ` Today's high is ${Math.round(d.temperature_2m_max[0])}, low ${Math.round(d.temperature_2m_min[0])}.`;
  if (rain != null) s += rain >= 50 ? ` ${rain} percent chance of rain. Take an umbrella, sir.` : ` ${rain} percent chance of rain.`;
  return R(s);
}
async function wiki(q, lang) {
  const base = 'https://' + (lang || 'en') + '.wikipedia.org/';
  const s = await getJSON(base + 'w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=' + encodeURIComponent(q));
  const hit = s && s.query && s.query.search && s.query.search[0]; if (!hit) return null;
  const r = await getJSON(base + 'api/rest_v1/page/summary/' + encodeURIComponent(hit.title.replace(/ /g, '_')));
  if (!r || !r.extract || r.type === 'disambiguation') return null;
  const x = r.extract.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(), sents = x.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [x];
  let out = ''; for (const st of sents) { if (out && (out + st).length > 330) break; out += st; }
  return { title: r.title, text: out.trim() };
}
const KNOW = /^(?:hey |ok |okay )?(?:please )?(?:can you |could you )?(?:tell me |explain |define |search for |look up |google |wikipedia |whats |what is |what are |what was |what were |who is |who was |who are |whos |what does |meaning of |capital of |how tall |how old |how big |how far |how long |how many |how much |when did |when was |when is |where is |where was |why is |why are |why do |why does |why did |how does |which )/;
const DOMAIN2 = /\b(my|habits?|streak|gym|penalt\w*|punish\w*|timetable|attendance|bunk\w*|focus|soul|timer|left|pending|progress|doing|tick|untick|report|insights|achievements?|wardrobe|laundry|grid|exceptions?|schedule|next class|this month)\b/;
const AIQ = /\b(should i|can i|how can i|how do i|how to|advice|suggest\w*|improve|tips?|why am i|am i)\b/;
const EXPLAIN = /^(?:please )?(?:can you |could you )?(why|explain|how does|how do)\b/;
function knowQ(n, raw) {
  let q = n;
  for (let k = 0; k < 2; k++) q = q.replace(/^(?:hey |ok |okay )?(?:please )?(?:can you |could you )?(?:tell me |explain |define |search for |look up |google |wikipedia |whats |what is |what are |what was |what were |who is |who was |who are |whos |what does |meaning of |why is |why are |why do |why does |why did |how does )/, '').replace(/^(?:about|the|a|an) /, '');
  q = q.replace(/ (mean|means|meaning|stand for)$/, '').trim();
  if (q.length < 2) return null;
  const miss = () => aiOn ? askAI(raw) : R(navigator.gpu ? 'I could not find that, sir. Turn on AI BRAIN for open-ended questions.' : 'I could not find that, sir. This browser has no WebGPU, so I can answer facts, maths, conversions, dates, time zones and weather, but not open-ended questions.', 'huh');
  if (aiOn && EXPLAIN.test(n)) return askAI(raw);                                // reasoning questions suit the AI model better than an encyclopedia
  return wiki(q, /[\u0900-\u097F]/.test(raw) ? 'hi' : 'en').then(r => r ? R('According to Wikipedia, ' + r.text) : miss());
}
const clockq = n => n.split(' ').length <= 7 && /^(what|whats|tell me|say|current|show)\b/.test(n) && /\b(time|date|day)\b/.test(n) && !/\b(in|of|for|on|until|till|before|after|since|between)\b/.test(n);
function general(n, raw) {               // returns R, a Promise of R, or null (= not a general question: use the habit commands)
  if (n.split(' ').length > 40 || clockq(n)) return null;
  let r;
  if ((r = remindQ(n))) return r;
  if ((r = chat(n))) return r;
  if ((r = calc(raw))) return r;
  if ((r = convert(raw))) return r;
  if ((r = dateQ(n))) return r;
  if ((r = randoms(n))) return r;
  if (/\b(weather|temperature|forecast|will it rain|is it raining|umbrella)\b/.test(n)) return weatherQ(n);
  if ((r = timeIn(n))) return r;
  if (AIQ.test(n) || DOMAIN2.test(n)) return null;
  if (KNOW.test(n)) return knowQ(n, raw);
  return null;
}
const FILL = ['Let me check that, sir.', 'One moment, sir.', 'Looking into it, sir.', 'Give me a second, sir.', 'Checking, sir.'];
let fillT = 0;
function fillerOn() { clearTimeout(fillT); fillT = setTimeout(() => { if (!speaking && TTS.full && canSpeak()) speakText(V('fill', FILL)); }, 1700); }       // so a slow answer never feels like a freeze
function fillerOff() { clearTimeout(fillT); }

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
  [/\b(bata do|batao|bataiye)\b/g, 'tell me'],
  [/\b(padhai|padh liya|padh li)\b/g, 'studied'], [/\bpaani (pi liya|pi li|piya)\b/g, 'drank water'], [/\b(kha liya|kha li)\b/g, 'ate']
];
const hing = n => HING.reduce((s, r) => s.replace(r[0], r[1]), n).replace(/\s+/g, ' ').trim();

/* =====================================================================
   LOCAL AI BRAIN — WebLLM on WebGPU. Free, no API key, no billing.
   Built-in commands stay instant and exact; the AI handles everything
   the command brain does not understand, plus advice and "why" questions.
   ===================================================================== */
/* exact versions: an upstream release can no longer break Jarvis silently. Bump deliberately, then test. */
const WEBLLM_VER = '0.2.78', KOKORO_VER = '1.2.1';
const AI_LIB = ['https://esm.run/@mlc-ai/web-llm@' + WEBLLM_VER, 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@' + WEBLLM_VER + '/+esm'];
const KOKORO_LIB = ['https://esm.run/kokoro-js@' + KOKORO_VER, 'https://cdn.jsdelivr.net/npm/kokoro-js@' + KOKORO_VER + '/+esm'];
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
  const pv = pickVoice(), nv = NEURAL.on && NEURAL.eng;
  el.voice.textContent = 'VOICE: ' + (nv ? NEURAL.voices[NEURAL.vi % NEURAL.voices.length].replace(/^[a-z]{2}_/, '').toUpperCase() : vlabel(pv, Math.max(0, voiceList().indexOf(pv))));
  el.eng.textContent = 'ENGINE: ' + (NEURAL.loading ? 'LOADING' : NEURAL.on ? (NEURAL.eng ? 'NEURAL' : 'NEURAL…') : 'BROWSER'); el.eng.classList.toggle('on', !!NEURAL.on);
  el.rate.textContent = TTS.rate + '×'; el.vmode.textContent = TTS.full ? 'SPEAK: FULL' : 'SPEAK: CLIPS'; el.meter.textContent = 'MIC: ' + (meterEnabled ? 'ON' : 'OFF');
  el.lmode.textContent = 'LISTEN: ' + (contMode ? 'CONTINUOUS' : 'PHRASE'); el.awake.textContent = 'AWAKE: ' + (awakeOn ? 'ON' : 'OFF'); el.awake.classList.toggle('on', awakeOn);
  el.hlog.textContent = 'HEARD (' + HEARD.log.length + ')'; el.hlog.classList.toggle('on', !el.log.hidden);
}
function ensureAI() {
  if (aiEngine) return Promise.resolve(true);
  if (aiLoading) return aiLoading;
  if (!navigator.gpu) { aiErr = 'WebGPU is not available in this browser.'; return Promise.resolve(false); }
  aiLoading = (async () => {
    try {
      const id = await aiModelId();
      const lib = await importFirst(AI_LIB);
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
  return 'You are J.A.R.V.I.S., the personal assistant inside the user\'s Discipline OS habit app. Call the user "sir". Be brief: at most 2 short sentences (3 for general knowledge), plain speech, no markdown, no lists, no emojis. Dry British wit is welcome, never rude. ' +
    'For general-knowledge or casual questions that are not about the user, answer helpfully from your own knowledge; if you are not sure, say so rather than guessing. ' +
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
    fillerOn(); showReply(aiEngine ? 'Thinking, sir…' : 'Waking my local brain, sir. The first time it downloads the model, after that it is stored on this device.');
    armIdle(90000);
    if (!await ensureAI()) return R('My local brain is unavailable, sir: ' + aiErr + ' Command mode still works.', 'err');
    const stream = await aiEngine.chat.completions.create({ messages: [{ role: 'system', content: sysPrompt() }, ...aiHist.slice(-6), { role: 'user', content: text }], temperature: 0.4, max_tokens: 200, stream: true });
    let raw = '', said = 0, started = false, talk = false;
    const begin = () => { if (!started) { started = true; fillerOff(); talk = speakBegin(); } };
    el.reply.classList.remove('typing');
    for await (const ch of stream) {                       // words appear as they are generated
      raw += (ch.choices && ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content) || '';
      kick(.8); const part = splitReply(raw).reply; if (part) el.reply.textContent = part;
      const seg = part.slice(said), k = Math.max(seg.lastIndexOf('. '), seg.lastIndexOf('! '), seg.lastIndexOf('? '));
      if (k > -1) { begin(); if (talk) speakPush(seg.slice(0, k + 1)); said += k + 2; }      // he starts talking before the model finishes
      armIdle(30000);
    }
    const sp = splitReply(raw), acts = sp.acts, reply = sp.reply || 'Understood, sir.'; CTX.said = reply;
    aiHist.push({ role: 'user', content: text }, { role: 'assistant', content: reply }); if (aiHist.length > 8) aiHist.splice(0, aiHist.length - 8);
    const done = runActs(acts); begin();
    if (talk) { speakPush(reply.slice(said)); if (done.length) speakPush(pendingAct ? done[done.length - 1] : 'Done.'); speakEnd(); }
    return Object.assign(R(reply + (done.length ? '\n' + done.join(' ') : ''), 'ok'), { streamed: talk });
  } catch (e) {
    console.warn('Jarvis AI', e);
    return R('My local brain hit an error, sir. Try again.', 'err');
  } finally { fillerOff(); aiBusy = false; setState(); }
}
/* ---------- v8 speech engine: sentence-by-sentence delivery, natural pacing, optional on-device neural voice ---------- */
const VM = /daniel|arthur|george|ryan|ravi|prabhat|rishi|james|oliver|thomas|hemant|male/i, VF = /female|zira|susan|hazel|samantha|karen|moira|tessa|fiona|heera|neerja|aria|jenny|libby|sonia|swara|google us english/i;
const HINGW = /\b(hai|hain|nahi|nahin|kya|kyun|kar|karo|kiya|aap|aapka|mera|meri|abhi|aaj|kal|baaki|bhi|toh|raha|rahe|liya|theek|achha|accha|bhai|chalo|samjha)\b/gi;
const isHinglish = t => (t.match(HINGW) || []).length >= 2;
let vlCache = null;
function voiceList() {
  const all = (synth && synth.getVoices()) || [];
  if (vlCache && vlCache.n === all.length) return vlCache.l;
  const sc = x => (VM.test(x.name) && !/female/i.test(x.name) ? 10 : 0) - (VF.test(x.name) ? 20 : 0) + (/natural|neural|online/i.test(x.name) ? 6 : 0) + (x.localService === false ? 1 : 0) + (/^en-GB/i.test(x.lang) ? 6 : /^en-IN/i.test(x.lang) ? 4 : 1);
  const l = all.filter(x => /^en/i.test(x.lang)).sort((a, b) => sc(b) - sc(a)).slice(0, 10);
  vlCache = { n: all.length, l }; return l;
}
function pickVoice(hi) {
  if (hi) return ((synth && synth.getVoices()) || []).find(x => /^hi/i.test(x.lang)) || null;
  const l = voiceList(); return l.find(x => x.name === TTS.voice) || l[0] || null;
}
function vlabel(v, i) {                  // short readable label for the VOICE button (Android names look like "en-gb-x-gbd-network")
  if (!v) return 'DEFAULT';
  const nm = v.name.replace(/^(Microsoft|Google)\s+/i, '');
  const b = /^[a-z]{2}[-_][a-z]{2}/i.test(nm) ? nm.split('-').slice(1, 4).join(' ') : nm.split(/[\s-]/)[0];
  return (/^(english|en)$/i.test(b) ? v.lang + ' ' + (i + 1) : b).toUpperCase().slice(0, 14);
}

/* --- optional neural voice: Kokoro (82 M params) running on this device, a natural British male voice --- */
const NEURAL = {
  on: lsGet('jv_eng') === 'neural', eng: null, loading: null, err: '', ctx: null, an: null, buf: null, src: null, playing: false, pre: null, chain: Promise.resolve(),
  lib: KOKORO_LIB, model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  voices: ['bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable', 'am_michael'], vi: parseInt(lsGet('jv_nvoice')) || 0
};
function canSpeak() { return !muted && !TTS.dead && (!!synth || !!NEURAL.eng); }
function neuralPrep() {                  // must run inside a tap so the phone lets us play audio
  if (NEURAL.ctx) { try { if (NEURAL.ctx.state === 'suspended') NEURAL.ctx.resume(); } catch (e) { } return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; NEURAL.ctx = new AC();
    NEURAL.an = NEURAL.ctx.createAnalyser(); NEURAL.an.fftSize = 256; NEURAL.an.connect(NEURAL.ctx.destination); NEURAL.buf = new Uint8Array(256);
  } catch (e) { NEURAL.ctx = null; }
}
function ensureNeural() {
  if (NEURAL.eng) return Promise.resolve(true);
  if (NEURAL.loading) return NEURAL.loading;
  neuralPrep();
  NEURAL.loading = (async () => {
    try {
      const lib = await importFirst(NEURAL.lib);
      NEURAL.eng = await lib.KokoroTTS.from_pretrained(NEURAL.model, {
        dtype: 'q8', device: 'wasm',
        progress_callback: p => { if (p && typeof p.progress === 'number') { const pc = Math.round(p.progress); el.aist.textContent = 'VOICE ' + pc + '%'; el.aibar.style.width = pc + '%'; } }
      });
      return true;
    } catch (e) { NEURAL.eng = null; NEURAL.err = (e && e.message) || 'unknown error'; return false; }
    finally { NEURAL.loading = null; el.aist.textContent = ''; el.aibar.style.width = '0'; setAi(); }
  })();
  setAi();
  return NEURAL.loading;
}
function neuralGen(text) {               // one sentence at a time (the model cannot run two jobs at once)
  NEURAL.chain = NEURAL.chain.then(() => NEURAL.eng.generate(text, { voice: NEURAL.voices[NEURAL.vi % NEURAL.voices.length], speed: TTS.rate })).catch(() => null);
  return NEURAL.chain;
}
function neuralLevel() {
  if (!NEURAL.playing || !NEURAL.an) return 0;
  NEURAL.an.getByteTimeDomainData(NEURAL.buf); let pk = 0;
  for (let k = 0; k < NEURAL.buf.length; k++) { const d = Math.abs(NEURAL.buf[k] - 128) / 128; if (d > pk) pk = d; }
  return pk;
}

/* --- turning written text into speakable text --- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordn = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function speechify(t) {                  // make written text sound right when spoken
  return String(t)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => ordn(+d) + ' of ' + (MONTHS[+mo - 1] || '') + ' ' + y)
    .replace(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/g, (m, d, mo) => ordn(+d) + ' of ' + MONTHS.find(x => x.slice(0, 3) === mo))
    .replace(/\b(\d{1,2}):(\d{2})(?:\s?([AaPp])\.?[Mm]\.?)?(?!\d)/g, (m, h, mi, ap) => {
      h = +h; if (h > 23 || +mi > 59) return m;
      const a = ap ? ap.toUpperCase() + 'M' : (h >= 12 ? 'PM' : 'AM'); h = h % 12 || 12;
      return h + (mi === '00' ? '' : mi[0] === '0' ? ' oh ' + mi[1] : ' ' + mi) + ' ' + a;
    })
    .replace(/\b(AM|PM)\s?[-–]\s?(?=\d)/g, '$1 to ')
    .replace(/₹\s?(\d[\d,]*)/g, (m, n) => n.replace(/,/g, '') + ' rupees')
    .replace(/\$\s?(\d[\d,]*)/g, (m, n) => n.replace(/,/g, '') + ' dollars')
    .replace(/(\d+)\s?%/g, '$1 percent')
    .replace(/\b(\d+)\s?\/\s?(\d+)\b/g, '$1 of $2')
    .replace(/(\d)\s?kg\b/gi, '$1 kilos').replace(/(\d)\s?km\b/gi, '$1 kilometres').replace(/(\d)\s?cm\b/gi, '$1 centimetres')
    .replace(/(\d)\s?(?:mins?)\b/gi, '$1 minutes').replace(/(\d)\s?(?:hrs?)\b/gi, '$1 hours')
    .replace(/\b1RM\b/g, 'one rep max')
    .replace(/\b(COA|DAA|DCN|OS|AAR|UI|UX|API|CGPA|GPA|PDF)\b/g, m => m.split('').join(' '))
    .replace(/(\d)\s?[-–]\s?(?=\d)/g, '$1 to ')
    .replace(/\bvs\.?(?=\s)/gi, 'versus').replace(/\be\.g\./gi, 'for example').replace(/\bi\.e\./gi, 'that is').replace(/\bapprox\./gi, 'approximately')
    .replace(/\s&\s/g, ' and ').replace(/\s\+\s/g, ' plus ').replace(/->|→/g, ' to ')
    .replace(/[“”"]/g, '').replace(/[·—–]/g, ', ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
}
function breath(x) {                     // split very long sentences at a natural breath point
  const o = [];
  while (x.length > 150) {
    let k = Math.max(x.lastIndexOf(', ', 130), x.lastIndexOf('; ', 130), x.lastIndexOf(': ', 130), x.lastIndexOf(' and ', 130));
    if (k < 40) k = x.lastIndexOf(' ', 130); if (k < 20) k = 130;
    o.push(x.slice(0, k + 1).trim()); x = x.slice(k + 1).trim();
  }
  if (x) o.push(x); return o;
}
function chunks(t) {
  const o = []; (t.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) || []).forEach(x => { x = x.trim(); if (!x) return; if (o.length && o[o.length - 1].length < 24) o[o.length - 1] += ' ' + x; else o.push(x); });
  const r = []; o.forEach(x => breath(x).forEach(y => r.push(y))); return r;
}
function shape(x, para) {                // per-sentence delivery: questions rise, warnings slow and drop, good news lifts, pauses between thoughts
  const o = { t: x, rate: 1, pitch: 0, vol: 1, gap: para ? 380 : 170, hi: /[\u0900-\u097F]/.test(x) || isHinglish(x) };
  if (/\?$/.test(x)) { o.pitch += .06; o.gap = 230; } else if (/!$/.test(x)) { o.rate *= 1.05; o.pitch += .04; }
  if (/\b(penalt|warning|danger|slipp|missed|below|failed|risk|behind|abandon)/i.test(x)) { o.rate *= .94; o.pitch -= .04; }
  else if (/\b(congratulat|excellent|flawless|magnificent|well done|perfect|streak)/i.test(x)) { o.rate *= 1.03; o.pitch += .03; }
  if (/\bsir[.!?]?$/i.test(x) && x.length < 28) { o.rate *= .96; o.gap = Math.min(o.gap, 120); }
  const h = new Date().getHours(); if (h >= 23 || h < 5) { o.vol = .75; o.rate *= .95; }          // late night: quieter and calmer
  return o;
}

/* --- playback --- */
function ttsNext() {
  if (TTS.cur) return;
  if (TTS.dead && !NEURAL.eng) { TTS.q = []; TTS.open = false; if (speaking) { showHeard('Voice output is blocked. Tap anywhere once, sir.'); ttsDone(); } return; }
  const x = TTS.q.shift();
  if (!x) { if (!TTS.open && speaking) ttsDone(); return; }
  const tok = playTok, mark = { x }; TTS.cur = mark; actAt = Date.now();
  const nxt = () => {
    if (TTS.cur !== mark || tok !== playTok) return;
    clearTimeout(TTS.t); clearTimeout(TTS.w); TTS.cur = null; actAt = Date.now();
    if (TTS.q.length) setTimeout(() => { if (tok === playTok) ttsNext(); }, x.gap); else ttsNext();
  };
  if (NEURAL.on && NEURAL.eng && !x.hi) neuralSay(x, tok, mark, nxt); else browserSay(x, tok, mark, nxt);
}
function browserSay(x, tok, mark, nxt, retry) {
  if (!synth) { nxt(); return; }
  let began = false;
  const u = new SpeechSynthesisUtterance(x.t), v = retry ? null : pickVoice(x.hi);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = x.hi ? 'hi-IN' : 'en-GB';
  const nat = v && /natural|neural|online/i.test(v.name);
  u.rate = Math.max(.5, Math.min(2, TTS.rate * x.rate)); u.pitch = Math.max(.2, Math.min(2, (nat ? 1 : .93) + x.pitch)); u.volume = x.vol;
  mark.u = u;
  u.onstart = () => { began = true; TTS.fails = 0; clearTimeout(TTS.w); };
  u.onboundary = () => { began = true; lastBound = Date.now(); actAt = lastBound; kick(1); };       // every word pulses the orb and bars
  u.onend = nxt;
  u.onerror = ev => {
    if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;                      // we cancelled it ourselves
    if (ev && ev.error === 'not-allowed') { needUnlock = true; TTS.dead = true; }                   // phone wants a tap before it will speak
    nxt();
  };
  clearTimeout(TTS.t); TTS.t = setTimeout(nxt, x.t.length * 120 / TTS.rate + 3500);
  /* some phones accept the utterance and never make a sound: retry once with the default voice, then give up on speech until the next tap */
  clearTimeout(TTS.w);
  TTS.w = setTimeout(() => {
    if (began || TTS.cur !== mark || tok !== playTok) return;
    const old = mark.u; if (old) old.onend = old.onerror = old.onboundary = old.onstart = null;
    try { synth.cancel(); } catch (e) { }
    if (!retry) setTimeout(() => { if (TTS.cur === mark && tok === playTok) browserSay(x, tok, mark, nxt, true); }, 80);
    else { if (++TTS.fails >= 2) TTS.dead = true; nxt(); }
  }, 4000);
  try { if (synth.paused) synth.resume(); synth.speak(u); } catch (e) { nxt(); }
}
function neuralSay(x, tok, mark, nxt) {
  const fallback = () => { if (mark.fb || TTS.cur !== mark || tok !== playTok) return; mark.fb = true; browserSay(x, tok, mark, nxt); };
  const job = NEURAL.pre && NEURAL.pre.t === x.t ? NEURAL.pre.p : neuralGen(x.t);
  NEURAL.pre = null;
  const nq = TTS.q[0]; if (nq && !nq.hi) NEURAL.pre = { t: nq.t, p: neuralGen(nq.t) };             // render the next sentence while this one plays
  clearTimeout(TTS.t); TTS.t = setTimeout(fallback, 9000);                                           // too slow on this device: browser voice for this sentence
  job.then(a => {
    if (mark.fb || TTS.cur !== mark || tok !== playTok) return;
    if (!a || !a.audio) { fallback(); return; }
    clearTimeout(TTS.t);
    try {
      const ctx = NEURAL.ctx, buf = ctx.createBuffer(1, a.audio.length, a.sampling_rate), src = ctx.createBufferSource();
      buf.copyToChannel(a.audio, 0); src.buffer = buf; src.connect(NEURAL.an);
      src.onended = () => { NEURAL.playing = false; nxt(); };
      if (ctx.state === 'suspended') ctx.resume();
      NEURAL.src = src; NEURAL.playing = true; actAt = Date.now(); src.start();
      TTS.t = setTimeout(nxt, buf.duration * 1000 + 3000);
    } catch (e) { fallback(); }
  });
}
function ttsDone() {
  speaking = false; guardUntil = Date.now() + 500; TTS.open = false;
  if (hold) releaseHold(); else if (ignored.size && want()) { stopRec(); restartT = setTimeout(start, 150); }   // drop stale echo results
  setState(); if (S.active) { armIdle(14000); showHeard('Go ahead, sir…'); }       // conversation mode: stay listening for a follow-up
}
function speakBegin() {
  if (!canSpeak()) return false;
  stopVoice(); TTS.open = true; speaking = true; guardUntil = Infinity; actAt = Date.now(); holdRec(); setState(); return true;
}
function speakPush(t) {
  if (!speaking) return;
  const pars = String(t).split(/\n+/);
  pars.forEach((par, pi) => { const cs = chunks(speechify(par)); cs.forEach((c, i) => TTS.q.push(shape(c, pi < pars.length - 1 && i === cs.length - 1))); });
  actAt = Date.now(); ttsNext();
}
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
  if (st === 'speak') { if (NEURAL.playing) env = Math.max(env, Math.min(1, neuralLevel() * 2.4)); else if (Date.now() - lastBound > 380) env = Math.max(env, .32 + .28 * Math.abs(Math.sin(t / 95))); }   // voices without word events still pulse
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
  c.onclick = () => { kill(); if (TTS.full && canSpeak()) speakText(title + '. ' + body); else say(kind === 'bad' ? 'warn' : 'cheer'); };
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
  if (out.length && touched && !muted) { if (TTS.full && canSpeak()) speakText(out.slice(0, 2).map(o => o[2] + '. ' + o[3]).join(' ')); else say(out.some(o => o[0] === 'bad') ? 'warn' : 'cheer'); }   // spoken in full, at most two items
}
function schedEval(ms) { clearTimeout(evalT); evalT = setTimeout(() => idle(evaluate, 5000), ms); }

/* =====================================================================
   WIRING
   ===================================================================== */
function wire() {
  el.mic.onclick = () => {
    const rearmed = Date.now() - tapAt < 700;          // the SAME tap already re-armed a stalled microphone (see pointerdown below): do not read it as "close"
    micErr = ''; langI = 0; needTap = false; tapAt = Date.now(); fails = 0;
    if (!SR) { openPanel(); showReply('This browser has no speech recognition (use Chrome or Edge). You can still type or tap a command below.'); setState(); return; }
    if (speaking) { stopVoice(); S.active = true; openPanel(); showHeard('Go ahead, sir…'); setState(); armIdle(14000); stopRec(); start(); return; }   // tap = interrupt him and talk
    if (S.active && !el.panel.hidden && !rearmed) { sleep(); return; }
    S.active = true; openPanel(); showHeard(''); showReply('Listening, sir…'); setState();
    clearTimeout(ackT); if (QUIET_START) buzz(14); else say(welcomed ? 'wake' : 'hi'); welcomed = true; armIdle(12000);
    if (perm === 'denied') { micBlocked('MIC BLOCKED IN BROWSER', 'The microphone is blocked, sir. Tap the lock icon in the address bar, allow the microphone for this site, then tap the orb. You can still type a command below.'); return; }
    if (!(rec && recLive)) { stopRec(); start(); }     // inside the tap, so iOS / Android treat it as a user-started session
    warmAI();
  };
  el.wake.onclick = () => {
    if (!SR) { openPanel(); showReply('The wake word needs Chrome or Edge. Firefox has no speech recognition.'); return; }
    S.wake = !S.wake; lsSet('jv_wake', S.wake ? '1' : '0');
    if (S.wake) {
      micErr = ''; langI = 0; needTap = false; tapAt = Date.now(); fails = 0; start(); welcomed = true; openPanel(); showReply('Wake word on, sir. Say “Jarvis” any time. Keep this tab open and in front.');
      if (TTS.full && canSpeak()) speakText('Wake word on, sir. Say Jarvis any time.'); else say(welcomed ? 'wake' : 'hi'); armIdle(8000);
    }
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
  el.voice.onclick = () => {
    if (NEURAL.on && NEURAL.eng) { NEURAL.vi = (NEURAL.vi + 1) % NEURAL.voices.length; lsSet('jv_nvoice', NEURAL.vi); setAi(); speakText('At your service, sir.'); return; }
    const l = voiceList(); if (!l.length) { openPanel(); showReply('No voices found on this device, sir.'); return; } const cv = pickVoice(), i = l.findIndex(x => cv && x.name === cv.name); TTS.voice = l[(i + 1) % l.length].name; lsSet('jv_voice', TTS.voice); setAi(); speakText('At your service, sir.');
  };
  el.eng.onclick = async () => {
    if (NEURAL.loading) return;
    if (NEURAL.on) { NEURAL.on = false; lsSet('jv_eng', 'browser'); setAi(); openPanel(); tell('Browser voice selected, sir.'); return; }
    NEURAL.on = true; lsSet('jv_eng', 'neural'); neuralPrep(); setAi(); openPanel(); armIdle(150000);
    showReply('Loading the neural voice, sir. First time only: roughly a 90 megabyte download, then it lives on this device. Wi-Fi recommended.');
    const ok = await ensureNeural(); armIdle(14000);
    if (ok) { showReply('Neural voice online, sir. How do I sound?'); speakText('Neural voice online, sir. How do I sound?'); }
    else { NEURAL.on = false; lsSet('jv_eng', 'browser'); setAi(); showReply('The neural voice could not load (' + NEURAL.err + '), so I am keeping the browser voice, sir.'); }
  };
  el.mst.onclick = () => { micErr = ''; langI = 0; if (!want() && SR) { S.active = true; openPanel(); armIdle(14000); setState(); } stopRec(); start(); micStatus(); };
  el.rate.onclick = () => { const r = [.9, 1, 1.1, 1.25]; TTS.rate = r[(r.indexOf(TTS.rate) + 1) % r.length]; lsSet('jv_rate', TTS.rate); setAi(); speakText('This is how fast I speak, sir.'); };
  el.vmode.onclick = () => { TTS.full = !TTS.full; lsSet('jv_vmode', TTS.full ? 'full' : 'clips'); setAi(); showReply(TTS.full ? 'I will speak my full answers, sir.' : 'Short film-style clips only, sir.'); };
  if (synth) synth.addEventListener('voiceschanged', () => { vlCache = null; setAi(); });
  el.meter.onclick = () => { meterEnabled = !meterEnabled; lsSet('jv_meter', meterEnabled ? '1' : '0'); if (meterEnabled) { if (want()) micOpen(); } else micClose(); setAi(); openPanel(); showReply(meterEnabled ? 'Mic meter and talk-over interrupt are on, sir.' : 'Mic meter off, sir. Tap the orb or say Jarvis stop to interrupt me.'); };
  el.fchip.onclick = () => run('focus status', 'Focus status');
  el.sound.onclick = () => { muted = !muted; lsSet('jv_mute', muted ? '1' : '0'); if (muted) stopVoice(); setState(); };
  el.form.onsubmit = e => {
    e.preventDefault(); const v = el['in'].value.trim(); if (!v) return; el['in'].value = '';
    if (HEARD.fixing) { const meant = stripWake(norm(v)) || norm(v), fx = HEARD.fixing; HEARD.fixing = null; el['in'].placeholder = 'Type a command…'; learnFix(fx.n, meant); fx.ok = true; heardSave(); renderLog(); showHeard('Learned, sir: “' + fx.raw + '” means “' + meant + '”.'); run(meant, meant, 'chip'); return; }
    run(stripWake(norm(v)) || norm(v), v, 'typed');
  };
  el.log.addEventListener('click', logClick);
  el.hlog.onclick = () => { el.log.hidden = !el.log.hidden; if (!el.log.hidden) { openPanel(); armIdle(60000); renderLog(); } setAi(); };
  el.lmode.onclick = () => { contMode = !contMode; lsSet('jv_cont', contMode ? '1' : '0'); setAi(); openPanel(); showReply(contMode ? 'Continuous listening, sir. Fewer restart tones, if your phone handles it. If I stop hearing you, switch back to phrase mode.' : 'Phrase mode, sir. I restart after every phrase. It is the most reliable on phones.'); stopRec(); start(); };
  el.awake.onclick = () => { awakeOn = !awakeOn; lsSet('jv_awake', awakeOn ? '1' : '0'); wakeLock(awakeOn && S.wake); setAi(); openPanel(); showReply(awakeOn ? 'Screen will stay awake while the wake word is armed, sir. It uses more battery.' : 'The screen may sleep now, sir. A sleeping screen can stop me hearing you.'); };
  ['online', 'focus', 'pageshow'].forEach(ev => addEventListener(ev, () => { if (ev === 'online' && /INTERNET/.test(micErr)) micErr = ''; if (want() && !rec) { stopRec(); start(); } }));
  el['in'].addEventListener('input', () => armIdle(30000));
  el.panel.addEventListener('click', e => { const b = e.target.closest('.jv-chips button'); if (b) run(norm(b.dataset.c), b.textContent); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.panel.hidden) sleep(); });
  const touch = () => {                  // first tap: unlock speech + audio on phones, then (re)start listening
    touched = true; tapAt = Date.now(); needTap = false; fails = 0; TTS.dead = false; if (/TAP/.test(micErr)) micErr = '';
    try { if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } } catch (e) { }
    try { if (NEURAL.on) { neuralPrep(); ensureNeural(); } } catch (e) { }
    if (needUnlock && !muted) { needUnlock = false; say('wake'); }
    chimeInit(); preload(); if (want()) start(); micStatus();
  };
  addEventListener('pointerdown', touch, { once: true, passive: true });
  /* a phone that wants a fresh tap before it will listen again: ANY tap re-arms it (a real user gesture) */
  addEventListener('pointerdown', () => {
    if (!SR || locked || !needTap || !(S.wake || S.active)) return;
    needTap = false; micErr = ''; tapAt = Date.now(); fails = 0; stopRec(); start(); micStatus();
  }, { passive: true, capture: true });
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
  if (S.wake) { if (TOUCH && (IOS || !okOnce)) { needTap = true; micErr = 'TAP ANYWHERE TO ENABLE MIC'; micStatus(); } else start(); }
  idle(preload, 4000); schedEval(4000);
}
let lockPoll = 0;

function init() {
  build(); wire(); syncHN(); watchPerm(); dbg('init');
  try { const f = JSON.parse(lsGet('jv_focus') || 'null'); if (f && f.end > Date.now()) { Object.assign(FOCUS, f); FOCUS.iv = setInterval(focusTick, 1000); focusTick(); } } catch (e) { }
  el.dock.hidden = true; setState();
  if (SR && window.isSecureContext === false) micErr = 'MIC NEEDS HTTPS'; else if (SR && S.wake && TOUCH) { micErr = 'TAP ANYWHERE TO ENABLE MIC'; needTap = true; }
  micStatus(); wakeLock(awakeOn && S.wake); setInterval(watchdog, 3000); setInterval(remTick, 10000);
  checkLock();
  if (locked) { lockPoll = setInterval(checkLock, 1500); }
  setInterval(() => schedEval(0), 180000);          // gentle re-check every 3 min, only while idle
}
window.__jarvis = { run: t => run(norm(t), t, 'typed'), evaluate, say, exec, _t: { speechify, chunks, shape, calc, convert, dateQ, parseDay, resolveRefs, splitCmds, fixAsr, fuzzyIdx, wakeHit, stripWake, norm, general, remindQ, chat, CTX, HEARD, heardAdd, heardResult, learnFix, applyLearned, bestAlt, fuzzyFix, cleanHeard, vocabScore } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
