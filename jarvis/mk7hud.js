/* mk7hud.js v1 — Mark VII helmet-HUD header for Discipline OS.
   Builds (1) a compass dome whose tape slews to a new bearing every time you change tab,
          (2) a chamfered tab bar with a gliding underline, rails and a lock-on decode effect,
          (3) a scan beam on every tab change and a one-time boot sequence after unlock.
   Additive: it wraps switchTab, touches no storage, and every block is try/catch'd.
   Honours Lite mode, the perf governor (html.fx-mid), prefers-reduced-motion and hidden tabs.
   Console:  mk7hud.heading(deg)   mk7hud.boot()   mk7hud.rebuild() */
(function () {
'use strict';
var D = document, R = D.documentElement;
var PRIMARY = [['home', 'Home'], ['tick', 'Daily Grid'], ['timetable', 'Time Table'], ['gym', 'Gym'], ['report', 'Reports']];
var NS = 'http://www.w3.org/2000/svg';

function $(id) { return D.getElementById(id); }
function el(tag, cls, html) { var n = D.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
function sv(tag, attrs, parent) { var n = D.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function mod(a, n) { return ((a % n) + n) % n; }
function wrap180(a) { a = mod(a + 180, 360) - 180; return a; }
function m7() { return R.getAttribute('data-theme') === 'mark7'; }
function calm() {
    try { if (typeof fxCalm === 'function' && fxCalm()) return true; } catch (e) { }
    return R.classList.contains('fx-lite') || R.classList.contains('fx-mid');
}

var S = {
    built: false, dome: null, cv: null, ctx: null, tabs: null, bar: null, ind: null, beam: null, frame: null,
    W: 0, H: 46, dpr: 1, ppd: 3,
    h: 0, v: 0, ht: 0, act: '', inView: true, raf: 0, lastT: 0, dirty: true,
    reveal: 1, revealT0: 0, flash: { b: 0, t: 0, next: 0 }, bearings: {}, els: {}, booted: false
};

/* ---------- bearings: every section of the app gets its own heading on the compass ---------- */
function mapBearings() {
    var list = D.querySelectorAll('.drawer-links .nav-btn[data-tab]'), i, seen = {}, n = 0;
    for (i = 0; i < list.length; i++) { var id = list[i].getAttribute('data-tab'); if (!seen[id]) { seen[id] = 1; S.bearings[id] = wrap180(n * 24); n++; } }
    PRIMARY.forEach(function (p) { if (S.bearings[p[0]] == null) S.bearings[p[0]] = wrap180(n++ * 24); });
}
function tabLabel(id) {
    var b = D.querySelector('.drawer-links .nav-btn[data-tab="' + id + '"]');
    if (b && b.firstChild && b.firstChild.nodeType === 3) return b.firstChild.textContent.trim();
    return id.replace(/-/g, ' ');
}

/* =====================================================================
   BUILD
===================================================================== */
function build() {
    if (S.built || $('mk7-dome')) return;
    var app = $('app-content'), nav = D.querySelector('nav');
    if (!app || !nav) return;
    mapBearings();

    /* ---- dome ---- */
    var dome = el('div'); dome.id = 'mk7-dome'; dome.setAttribute('aria-hidden', 'true');
    var inn = el('div', 'mk7-in');
    var svg = sv('svg', { 'class': 'mk7-frame', preserveAspectRatio: 'none' });
    var pa = sv('path', { 'class': 'a', pathLength: 1000 }, svg);
    var pb1 = sv('path', { 'class': 'b' }, svg), pb2 = sv('path', { 'class': 'b' }, svg);
    var pp = sv('path', { 'class': 'p', pathLength: 1000 }, svg);
    var caret = sv('path', { 'class': 'caret' }, svg);
    var cap = sv('path', { 'class': 'cap' }, svg);
    var cv = el('canvas');
    inn.appendChild(svg); inn.appendChild(cv);
    dome.appendChild(inn);
    app.insertBefore(dome, nav);
    S.dome = dome; S.cv = cv; S.ctx = cv.getContext('2d');
    S.frame = { a: pa, b1: pb1, b2: pb2, p: pp, caret: caret, cap: cap, svg: svg };

    /* ---- tab bar (inside the sticky nav, on its own row) ---- */
    var tabs = el('div'); tabs.id = 'mk7-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Main sections');
    var railL = el('div', 'mk7-rail l', '<i></i><div class="mk7-fl l"><i></i>T <b id="k7-time">--:--:--</b></div>'),
        railR = el('div', 'mk7-rail r', '<i></i><div class="mk7-fl r">STREAK <b id="k7-streak">--</b>&nbsp;&nbsp;TODAY <b id="k7-today">--</b></div>');
    var glow = el('div', 'mk7-glow'), shell = el('div', 'mk7-shell'), bar = el('div', 'mk7-bar');
    PRIMARY.forEach(function (p, i) {
        var b = el('button', 'mk7-tab', '<span>' + p[1] + '</span>');
        b.type = 'button'; b.setAttribute('data-k7', p[0]); b.style.setProperty('--i', i);
        b.addEventListener('click', function () { press(p[0]); });
        bar.appendChild(b);
    });
    var more = el('button', 'mk7-tab more', '<span>More</span>');
    more.type = 'button'; more.setAttribute('data-k7', '__more'); more.setAttribute('aria-label', 'Open full menu');
    more.addEventListener('click', function () { try { if (typeof haptic === 'function') haptic(8); if (typeof toggleDrawer === 'function') toggleDrawer(); } catch (e) { } });
    bar.appendChild(more);
    var ind = el('i', 'mk7-ind'); bar.appendChild(ind);
    shell.appendChild(bar); shell.appendChild(el('div', 'mk7-shine'));
    glow.appendChild(shell);
    tabs.appendChild(railL); tabs.appendChild(glow); tabs.appendChild(railR);
    var links = nav.querySelector('.nav-links');
    nav.insertBefore(tabs, links ? links.nextSibling : null);
    S.els.time = $('k7-time'); S.els.streak = $('k7-streak'); S.els.today = $('k7-today');
    S.tabs = tabs; S.bar = bar; S.ind = ind; S.els.more = more; S.els.glow = glow; S.els.rails = [railL, railR];

    var beam = el('div'); beam.id = 'mk7-beam'; D.body.appendChild(beam); S.beam = beam;

    R.classList.add('mk7-on');
    S.built = true;
    measure(); drawFrame();
    hookSwitch();
    syncActive(currentTab(), true);
    S.h = S.ht;                                     // start already facing the current section
    wire();
    tickText();
    ensureLoop();
}

/* =====================================================================
   TABS
===================================================================== */
function currentTab() {
    var s = D.querySelector('.section.active');
    return s && s.id ? s.id.replace(/^tab-/, '') : 'home';
}
function press(id) {
    try { if (typeof haptic === 'function') haptic(8); } catch (e) { }
    if (id === S.act) { slew(id); return; }
    try { if (typeof switchTab === 'function') switchTab(id); } catch (e) { console.warn(e); }
}
function hookSwitch() {
    var orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__k7) return;
    var w = function (id) { var r = orig.apply(this, arguments); try { syncActive(id, false); } catch (e) { } return r; };
    w.__k7 = true; window.switchTab = w;
}
function syncActive(id, silent) {
    if (!S.built) return;
    var changed = id !== S.act; S.act = id;
    var btns = S.bar.querySelectorAll('.mk7-tab'), hit = null, i;
    for (i = 0; i < btns.length; i++) {
        var k = btns[i].getAttribute('data-k7'), on = k === id;
        if (on) hit = btns[i];
        btns[i].classList.toggle('on', on);
        if (on) btns[i].setAttribute('aria-current', 'page'); else btns[i].removeAttribute('aria-current');
    }
    /* a section that is not one of the five lives under MORE: show its name there */
    var more = S.els.more, isPrimary = PRIMARY.some(function (p) { return p[0] === id; });
    var wantTxt = isPrimary ? 'More' : tabLabel(id);
    var sp = more.firstChild;
    if (sp.textContent !== wantTxt) { sp.textContent = wantTxt; }
    more.classList.toggle('on', !isPrimary);
    if (!isPrimary) { hit = more; more.setAttribute('aria-current', 'page'); } else more.removeAttribute('aria-current');
    place(hit, silent);
    if (S.bearings[id] != null) S.ht = S.bearings[id];
    callTop();
    if (changed && !silent) { scanBeam(); if (hit && !calm()) decode(hit.firstChild, wantTxtFor(hit, id), 380); }
    wake();
}
function wantTxtFor(btn, id) { return btn === S.els.more ? btn.firstChild.textContent : (PRIMARY.filter(function (p) { return p[0] === id; })[0] || [0, id])[1]; }

function place(btn, instant) {
    var ind = S.ind; if (!ind) return;
    if (!btn) { ind.classList.remove('ready'); return; }
    var x = btn.offsetLeft + 14, w = Math.max(10, btn.offsetWidth - 28);
    if (instant) { var t = ind.style.transition; ind.style.transition = 'none'; ind.style.width = w + 'px'; ind.style.transform = 'translateX(' + x + 'px)'; void ind.offsetWidth; ind.style.transition = t; }
    else { ind.style.width = w + 'px'; ind.style.transform = 'translateX(' + x + 'px)'; }
    ind.classList.add('ready');
    var bar = S.bar;
    if (bar.scrollWidth > bar.clientWidth + 2) {
        var left = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2;
        try { bar.scrollTo({ left: left, behavior: instant || calm() ? 'auto' : 'smooth' }); } catch (e) { bar.scrollLeft = left; }
    }
}
/* the app's own "TARGET LOCKED // TAB" callout used to sit under a one-row nav; keep it under the tab bar */
function callTop() {
    try { var n = D.querySelector('nav'); if (n) R.style.setProperty('--k7-call-top', Math.round(n.getBoundingClientRect().bottom + 10) + 'px'); } catch (e) { }
}
function relayout() { var on = S.bar && S.bar.querySelector('.mk7-tab.on'); if (on) place(on, true); }

/* letters scramble then lock in, left to right */
var GLYPH = 'ABCDEFGHJKLMNPRSTUVXYZ0123456789#%/<>';
function decode(node, text, ms) {
    if (!node || !text) return;
    var start = performance.now(), n = text.length, id = ++decode.id;
    node.__d = id;
    (function step(t) {
        if (node.__d !== id) return;
        var p = Math.min(1, (t - start) / ms), lock = Math.floor(p * n), out = '', i;
        for (i = 0; i < n; i++) out += (i < lock || text.charAt(i) === ' ') ? text.charAt(i) : GLYPH.charAt((Math.random() * GLYPH.length) | 0);
        node.textContent = out;
        if (p < 1) requestAnimationFrame(step); else { node.textContent = text; relayout(); }
    })(start);
}
decode.id = 0;

function scanBeam() {
    if (calm() || !S.beam) return;
    S.beam.classList.remove('run'); void S.beam.offsetWidth; S.beam.classList.add('run');
}

/* =====================================================================
   FRAME (SVG, rebuilt in real pixels on resize so the angles never distort)
===================================================================== */
function measure() {
    var inn = S.dome.querySelector('.mk7-in');
    var W = Math.max(280, Math.round(inn.clientWidth || R.clientWidth)), H = Math.round(inn.clientHeight || 46);
    S.dpr = Math.min(2, window.devicePixelRatio || 1);
    S.W = W; S.H = H;
    S.cv.width = Math.round(W * S.dpr); S.cv.height = Math.round(H * S.dpr);
    var spacing = Math.max(52, Math.min(92, W / 11));             // pixels between two 30° labels
    S.ppd = spacing / 30;
    S.frame.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    S.dirty = true;
}
function drawFrame() {
    var F = S.frame, W = S.W, H = S.H, cx = W / 2, top = 5, leg = H - 7;
    var x1 = Math.max(24, Math.min(84, W * .055)), x2 = x1 + Math.max(18, Math.min(40, W * .026));
    var nw = Math.max(46, Math.min(80, W * .06)), nd = 8, sl = 13;
    var a = 'M0 ' + leg + 'L' + x1 + ' ' + leg + 'L' + x2 + ' ' + top +
        'L' + (cx - nw - sl) + ' ' + top + 'L' + (cx - nw) + ' ' + (top + nd) + 'L' + (cx + nw) + ' ' + (top + nd) + 'L' + (cx + nw + sl) + ' ' + top +
        'L' + (W - x2) + ' ' + top + 'L' + (W - x1) + ' ' + leg + 'L' + W + ' ' + leg;
    S.edge = x2 + 18;
    F.a.setAttribute('d', a); F.p.setAttribute('d', a);
    F.b1.setAttribute('d', 'M' + (x2 + 14) + ' ' + (top + 5) + 'L' + (cx - nw - sl - 22) + ' ' + (top + 5));
    F.b2.setAttribute('d', 'M' + (cx + nw + sl + 22) + ' ' + (top + 5) + 'L' + (W - x2 - 14) + ' ' + (top + 5));
    F.caret.setAttribute('d', 'M' + (cx - 5) + ' ' + (top + nd + 2) + 'L' + (cx + 5) + ' ' + (top + nd + 2) + 'L' + cx + ' ' + (top + nd + 10) + 'Z');
    F.cap.setAttribute('d', 'M' + (cx - nw + 8) + ' ' + (top + nd + 4) + 'h8M' + (cx + nw - 16) + ' ' + (top + nd + 4) + 'h8');
}

/* =====================================================================
   TAPE (canvas): labels every 30°, ticks every 5°, centre pointer, sweep light, random flicker
===================================================================== */
function labelOf(b, a) {
    var v = wrap180(b);
    if (mod(b, 360) === 180) v = a < 0 ? -180 : 180;
    return v === 0 ? '00' : String(v);
}
function drawTape(view, t) {
    var c = S.ctx, W = S.W, H = S.H, cx = W / 2, ppd = S.ppd, hw = Math.max(60, cx - (S.edge || 0)), half = hw / ppd, sag = H * .11;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); c.clearRect(0, 0, W, H);
    var phone = W < 560, fs = phone ? 10 : 11.5;
    c.font = '600 ' + fs + 'px "Chakra Petch", ui-monospace, Menlo, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    var b0 = Math.floor((view - half) / 5) * 5, b1 = Math.ceil((view + half) / 5) * 5;
    var sweep = calm() ? -9999 : ((t % 7000) / 7000) * 2 - 1, bx = cx + sweep * hw;
    var reveal = S.reveal, nearest = 1e9, fl = S.flash;
    for (var b = b0; b <= b1; b += 5) {
        var a = b - view, x = cx + a * ppd, u = Math.abs(x - cx) / hw;
        if (u >= 1) continue;
        var vis = Math.max(0, Math.min(1, (reveal * 1.35 - u) / .25)); if (vis <= 0) continue;
        var edge = 1 - u * u * u, lift = sag * (1 - u * u);
        var major = mod(b, 30) === 0, mid = mod(b, 10) === 0;
        var glow = Math.exp(-Math.pow((x - bx) / 46, 2));
        var al = Math.max(0, edge) * vis;
        /* tick hanging from the frame line, a little shorter at the edges like the curved visor in the reference */
        var y0 = 15 + lift * .55, len = major ? 7 : (mid ? 4.5 : 3);
        c.strokeStyle = 'rgba(' + (major ? '190,240,255' : '79,216,255') + ',' + (al * (major ? .95 : .5) + glow * .4) + ')';
        c.lineWidth = major ? 1.3 : 1;
        c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + len); c.stroke();
        if (!major) continue;
        var near = Math.abs(a) < 2.6, flash = (fl.b === b && t - fl.t < 420) ? 1 - (t - fl.t) / 420 : 0;
        var ly = H * .66 + lift * .8;
        var bright = Math.min(1, al * .88 + glow * .55 + flash * .6 + (near ? .35 : 0));
        c.fillStyle = near ? 'rgba(255,255,255,' + Math.min(1, al + .2) + ')' : 'rgba(207,238,255,' + bright + ')';
        c.shadowColor = 'rgba(79,216,255,' + Math.min(1, .75 * al + flash) + ')'; c.shadowBlur = near ? 12 : (flash || glow > .3 ? 9 : 5);
        c.fillText(labelOf(b, a), x, ly);
        c.shadowBlur = 0;
        if (near) {                                     // underline under the label that the pointer is on
            c.fillStyle = 'rgba(79,216,255,.9)'; c.fillRect(x - 9, ly + fs * .72, 18, 1.5);
        }
    }
}

/* =====================================================================
   LOOP
===================================================================== */
function live() {
    return S.built && m7() && !D.hidden && S.inView && !calm() && !window.__fxHold && !window.__perfPause;
}
function settled() { return Math.abs(S.v) < .01 && Math.abs(wrap180(S.ht - S.h)) < .02; }
function frame(t) {
    S.raf = 0;
    if (!S.built) return;
    if (!live()) {
        if (calm()) { S.h = S.ht; S.v = 0; } else if (S.dirty || !settled()) stepSpring(1);
        render(t, 0); S.dirty = false; return;
    }
    if (t - S.lastT < 33) { S.raf = requestAnimationFrame(frame); return; }      // ~30 fps is plenty for a tape
    S.lastT = t;
    stepSpring(1);
    if (S.reveal < 1) S.reveal = Math.min(1, (t - S.revealT0) / 1100);
    if (t > S.flash.next) { S.flash.b = Math.round((S.h + (Math.random() * 2 - 1) * (S.W / S.ppd / 3)) / 30) * 30; S.flash.t = t; S.flash.next = t + 1400 + Math.random() * 2200; }
    var sway = Math.sin(t / 2300) * 1.5 + Math.sin(t / 870) * .45;
    render(t, sway);
    S.raf = requestAnimationFrame(frame);
}
function stepSpring(k) {
    var d = wrap180(S.ht - S.h);
    S.v = (S.v + d * .055 * k) * .84;
    if (Math.abs(S.v) < .004 && Math.abs(d) < .02) { S.h = S.ht; S.v = 0; } else S.h = S.h + S.v;
}
function render(t, sway) {
    try { drawTape(S.h + sway, t); } catch (e) { }
}
function ensureLoop() { if (!S.raf && S.built) S.raf = requestAnimationFrame(frame); }
function wake() { S.dirty = true; ensureLoop(); }
function slew(id) {                                  // tapping the active tab nudges the compass: a small "ping"
    S.v += 2.4; if (S.bearings[id] != null) S.ht = S.bearings[id]; scanBeam(); wake();
}

/* =====================================================================
   LIVE TEXT
===================================================================== */
function tickText() {
    if (!S.built) return;
    var d = new Date();
    if (S.els.time) S.els.time.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    var s = $('vz-streak'), t = $('vz-today');
    if (S.els.streak) S.els.streak.textContent = s && s.textContent ? s.textContent : '--';
    if (S.els.today) S.els.today.textContent = t && t.textContent ? t.textContent : '--';
}

/* =====================================================================
   BOOT (once per session, after the login screen is gone)
===================================================================== */
function boot() {
    if (!S.built || calm()) { S.reveal = 1; return; }
    S.reveal = 0; S.revealT0 = performance.now(); wake();
    var d = S.dome, g = S.els.glow, r = S.els.rails;
    d.classList.add('boot'); g.classList.add('boot'); r[0].classList.add('boot'); r[1].classList.add('boot');
    setTimeout(function () { d.classList.remove('boot'); g.classList.remove('boot'); r[0].classList.remove('boot'); r[1].classList.remove('boot'); }, 1300);
    var btns = S.bar.querySelectorAll('.mk7-tab'), i;
    for (i = 0; i < btns.length; i++) (function (b, k) {
        var sp = b.firstChild, txt = sp.textContent; sp.textContent = '';
        setTimeout(function () { decode(sp, txt, 420); }, 300 + k * 90);
    })(btns[i], i);
    S.h = wrap180(S.ht - 70); S.v = 0;                  // the compass swings in from the side and settles on today's section
    scanBeam();
}
function bootWhenReady() {
    var ls = $('login-screen');
    var visible = function () { return ls && ls.style.display !== 'none' && !ls.classList.contains('unlocking') && D.body.contains(ls); };
    var fire = function () { if (S.booted) return; S.booted = true; setTimeout(boot, 120); };
    if (!visible()) { /* already unlocked (reload while unlocked): run a short boot anyway */ if (!S.booted) { S.booted = true; setTimeout(boot, 350); } return; }
    var mo = new MutationObserver(function () { if (!visible()) { mo.disconnect(); fire(); } });
    mo.observe(ls, { attributes: true, attributeFilter: ['class', 'style'] });
}

/* =====================================================================
   WIRING
===================================================================== */
function wire() {
    var rt = 0;
    function onResize() { clearTimeout(rt); rt = setTimeout(function () { measure(); drawFrame(); relayout(); wake(); }, 90); }
    addEventListener('resize', onResize, { passive: true });
    addEventListener('orientationchange', onResize);
    if (window.ResizeObserver) { try { new ResizeObserver(function () { relayout(); }).observe(S.bar); } catch (e) { } }
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { relayout(); wake(); });
    if (window.IntersectionObserver) {
        try { new IntersectionObserver(function (es) { S.inView = es[0].isIntersecting; if (S.inView) wake(); }).observe(S.dome); } catch (e) { }
    }
    D.addEventListener('visibilitychange', function () { if (!D.hidden) wake(); });
    addEventListener('perf:level', wake);
    addEventListener('scroll', function () { callTop(); clearTimeout(wire.st); wire.st = setTimeout(wake, 220); }, { passive: true });
    new MutationObserver(wake).observe(R, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    /* clock + data readouts, and a cheap safety net: if some other code changed section without going through switchTab */
    setInterval(function () {
        tickText();
        var c = currentTab(); if (c !== S.act) syncActive(c, false);
        if (live()) ensureLoop();
    }, 1000);
}

/* ---------- start ---------- */
function start() {
    build();
    if (S.built) { bootWhenReady(); if (!window.mk7hud) window.mk7hud = {
        heading: function (deg) { S.ht = wrap180(+deg || 0); wake(); },
        boot: function () { S.booted = true; boot(); },
        rebuild: function () { measure(); drawFrame(); relayout(); wake(); }
    }; }
}
if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
})();
