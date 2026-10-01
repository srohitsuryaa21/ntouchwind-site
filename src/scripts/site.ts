import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { SceneState, TurbineScene } from './turbine';
import type { SolarScene } from './solar';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const $ = <T extends Element = HTMLElement>(s: string, p: ParentNode = document) => p.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, p: ParentNode = document) => Array.from(p.querySelectorAll<T>(s));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isHome = !!$('.scene');
const mobile = matchMedia('(max-width: 960px)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
// anchors that live inside pinned sections scroll to a point in the pin instead of the element
const pinAnchors = new Map<string, () => number>();
const isLight = () => root.dataset.theme === 'light';

/* Day and night mode: remembered per visitor, applied before paint by the inline script in Layout */
function setupTheme() {
  const btn = $<HTMLButtonElement>('.theme-btn');
  const meta = $<HTMLMetaElement>('meta[name="theme-color"]');
  const sync = () => {
    const light = isLight();
    btn?.setAttribute('aria-pressed', String(light));
    btn?.setAttribute('aria-label', light ? 'Switch to night mode' : 'Switch to day mode');
    meta?.setAttribute('content', light ? '#f3f6f9' : '#04080e');
  };
  sync();
  btn?.addEventListener('click', () => {
    root.classList.add('theme-fade');
    root.dataset.theme = isLight() ? 'dark' : 'light';
    try { localStorage.setItem('ntw-theme', root.dataset.theme); } catch { /* storage unavailable */ }
    sync();
    setTimeout(() => root.classList.remove('theme-fade'), 700);
  });
}

/* ───── Always on: menu, form, year ───── */
function setupMenu() {
  const btn = $<HTMLButtonElement>('.menu-btn');
  const menu = $('#mobile-menu');
  if (!btn || !menu) return;
  const set = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => set(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
}

function setupForm() {
  const form = $<HTMLFormElement>('.contact-form');
  if (!form) return;
  const note = $('.form-note', form)!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    $$<HTMLInputElement | HTMLTextAreaElement>('input, textarea', form).forEach((f) => {
      const bad = !f.checkValidity();
      f.setAttribute('aria-invalid', String(bad));
      if (bad && ok) { ok = false; f.focus(); }
    });
    if (!ok) { note.textContent = 'Please fill in your name, a valid email and a message.'; return; }
    const d = new FormData(form);
    const body = `Name: ${d.get('name')}\nCompany: ${d.get('company') || ''}\nEmail: ${d.get('email')}\n\n${d.get('message')}`;
    location.href = `mailto:ntouchwind@gmail.com?subject=${encodeURIComponent('Enquiry from ntouchwind.com')}&body=${encodeURIComponent(body)}`;
    note.textContent = 'Your email app should now be open with the message ready. Press send there. If nothing opened, write to ntouchwind@gmail.com.';
  });
}

$$('.year').forEach((el) => (el.textContent = String(new Date().getFullYear())));
setupTheme();
setupMenu();
setupForm();

if (reduced) {
  root.classList.add('reduced', 'loader-done');
  $$('.station, .path-finish').forEach((s) => s.classList.add('is-on'));
} else {
  initMotion();
}

/* ───── Motion ───── */
function initMotion() {
  if (isHome) root.classList.add('motion');
  const lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // smooth in-page anchors, including /#id links on the home page
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href*="#"]');
    if (!a) return;
    const url = new URL(a.href);
    if (url.pathname !== location.pathname || !url.hash) return;
    const pinned = pinAnchors.get(url.hash);
    const target = url.hash === '#top' ? 0 : pinned ? pinned() : $(url.hash);
    if (target === null) return;
    e.preventDefault();
    lenis.scrollTo(target as number | HTMLElement, { duration: 1.6, easing: (x: number) => 1 - Math.pow(1 - x, 4) });
  });

  buildHeader(lenis);
  if (!isHome) { root.classList.add('loader-done'); buildArticle(); return; }

  lenis.stop();
  if (!location.hash) { history.scrollRestoration = 'manual'; scrollTo(0, 0); }

  // start loading the 3D scene straight away; the loader covers it
  const canvas = $<HTMLCanvasElement>('.turbine-canvas')!;
  const sceneReady: Promise<TurbineScene | null> = import('./turbine')
    .then(({ createTurbineScene }) => createTurbineScene(canvas, { mobile }))
    .catch((err) => { console.warn('[scene] WebGL unavailable, keeping the photo', err); return null; });

  const titleLines = $$('.hero-title .line').map((l) => {
    l.innerHTML = `<span>${l.innerHTML}</span>`;
    return l.firstElementChild as HTMLElement;
  });
  const introBits = '.hero-block .eyebrow, .hero-meta, .hero-copy, .hero-cta, .hero-stats li, .scroll-cue';
  gsap.set(titleLines, { yPercent: 110 });
  gsap.set(introBits, { opacity: 0, y: 30 });

  runLoader(sceneReady, () => {
    root.classList.add('loader-done');
    lenis.start();
    gsap.to(titleLines, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.09 });
    gsap.to(introBits, { y: 0, opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.06, delay: 0.25 });
  });

  const start = () => {
    // each section is isolated: one failing must never leave the page half built
    const steps: [string, () => void][] = [
      ['scene', () => buildScene(lenis, sceneReady)],
      ['about', buildAbout],
      ['direction', buildDirection],
      ['values', buildValues],
      ['services', buildServices],
      ['onsite', buildOnsite],
      ['solar', buildSolar],
      ['contact', buildContact],
      ['nav', buildNavState],
    ];
    for (const [name, fn] of steps) {
      try { fn(); } catch (err) { console.error(`[motion] ${name} failed`, err); }
    }
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  };
  Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(start);
  addEventListener('load', () => ScrollTrigger.refresh());
}

function runLoader(ready: Promise<unknown>, done: () => void) {
  const loader = $('.loader');
  if (!loader) return done();
  let seen = false;
  try { seen = sessionStorage.getItem('ntw-seen') === '1'; sessionStorage.setItem('ntw-seen', '1'); } catch { /* storage unavailable */ }
  const num = $('.loader-num span', loader)!;
  const counter = { v: 0 };
  const dur = seen ? 0.5 : 1.9;
  const count = gsap.timeline()
    .to(counter, { v: 750, duration: dur, ease: 'power2.inOut', onUpdate: () => (num.textContent = String(Math.round(counter.v))) }, 0)
    .to('.loader-bar i', { scaleX: 1, duration: dur, ease: 'power2.inOut' }, 0);
  const sceneOrTimeout = Promise.race([ready, new Promise((r) => setTimeout(r, 4500))]);
  Promise.all([count.then(), sceneOrTimeout]).then(() => {
    gsap.to(loader, { yPercent: -100, duration: 0.9, ease: 'expo.inOut', delay: 0.1 });
    gsap.delayedCall(0.55, done);
  });
}

/* Header: solid once scrolled, hides while scrolling down, back on the way up. Top bar shows page progress. */
function buildHeader(lenis: Lenis) {
  const header = $('.site-header')!;
  const bar = $('.progress i')!;
  let last = 0;
  lenis.on('scroll', ({ scroll, limit }: { scroll: number; limit: number }) => {
    bar.style.transform = `scaleX(${limit ? scroll / limit : 0})`;
    header.classList.toggle('is-solid', scroll > 80);
    header.classList.toggle('is-hidden', scroll > last && scroll > 300 && !!$('#mobile-menu[hidden]'));
    last = scroll;
  });
}

function buildNavState() {
  $$<HTMLAnchorElement>('.nav a').forEach((a) => {
    const hash = new URL(a.href).hash;
    if (hash === '#impact') return; // handled by the scene timeline
    const target = $(hash);
    if (!target) return;
    ScrollTrigger.create({ trigger: target, start: 'top 55%', end: 'bottom 55%', onToggle: (st) => a.classList.toggle('is-active', st.isActive) });
  });
}

/* ───── Hero + signature: one pinned 3D scene ───── */
function buildScene(lenis: Lenis, sceneReady: Promise<TurbineScene | null>) {
  const section = $('.scene')!;
  const stage = $('.scene-stage', section)!;
  const chapters = $$('.chapter', section);
  const kwEl = $('.hud-kw', section)!;
  const units = $$('.hud-units i', section);
  const dots = $$('.hud-dots i', section);
  const impactLink = $('.nav a[href$="#impact"]');

  // camera keyframes: wide hero, close on the hub, rotor, all three, aerial with the client, low on the horizon.
  // wide screens keep the turbine right of centre so the copy has room on the left.
  const k = mobile
    ? [
        { cx: 0, cy: 4, cz: 85, lx: 0, ly: 12, lz: -20 },
        { cx: 0, cy: 28, cz: 26, lx: 0, ly: 31, lz: 0 },
        { cx: -4, cy: 22, cz: 52, lx: 0, ly: 24, lz: 0 },
        { cx: 8, cy: 26, cz: 150, lx: -4, ly: 14, lz: -40 },
        { cx: 135, cy: 175, cz: 150, lx: 132, ly: 0, lz: -62 },
        { cx: -26, cy: 2, cz: 95, lx: -2, ly: 22, lz: -20 },
      ]
    : [
        { cx: 26, cy: 6, cz: 92, lx: -64, ly: 29, lz: -20 },
        { cx: 4, cy: 30.6, cz: 15, lx: -1.5, ly: 30, lz: 0 },
        { cx: -10, cy: 27, cz: 36, lx: -10, ly: 26, lz: 0 },
        { cx: 14, cy: 22, cz: 98, lx: -12, ly: 16, lz: -40 },
        { cx: 18, cy: 125, cz: 118, lx: 100, ly: 0, lz: -58 },
        { cx: -30, cy: 2, cz: 75, lx: -4, ly: 20, lz: -20 },
      ];
  const END = 5.3;
  // `shift` is how far the last chapter has turned the sky: night to sunrise in night mode, day to sunset to night in day mode
  const state: SceneState & { shift: number } = { ...k[0], spin: 0.3, time: 0, arc: 0, dayMode: false, shift: 0, flow: 0, others: 1 };
  const veil = $('.night-veil', section);
  const dayVignette = $('.scene-vignette:not(.night-veil)', section);
  let dark = false;

  let scene: TurbineScene | null = null;
  let active = true;
  const tick = (_t: number, dms: number) => {
    if (!scene || !active) return;
    const s = scene.state;
    s.cx = state.cx; s.cy = state.cy; s.cz = state.cz; s.lx = state.lx; s.ly = state.ly; s.lz = state.lz;
    s.spin = state.spin; s.flow = state.flow; s.others = state.others;
    const light = isLight();
    // day mode: noon, a warmer afternoon as the sun sinks, then sunset into night in the last chapter
    s.time = light ? (state.shift > 0 ? 0.7 - 0.64 * state.shift : 1 - 0.3 * Math.min(1, state.arc / 0.764)) : 0.5 * state.shift;
    s.arc = state.arc;
    s.dayMode = light;
    // once night falls in day mode, darken behind the copy and switch it to white
    const night = light ? Math.max(0, Math.min(1, (0.5 - s.time) / 0.3)) : 0;
    if (veil) veil.style.opacity = night.toFixed(3);
    if (dayVignette) dayVignette.style.opacity = (1 - night).toFixed(3);
    if (night > 0.45 !== dark) { dark = !dark; stage.classList.toggle('is-dark', dark); }
    scene.render(Math.min(dms / 1000, 0.05));
  };
  sceneReady.then((s) => {
    if (!s) return;
    scene = s;
    lenis.on('scroll', ({ velocity }: { velocity: number }) => s.setVelocity(velocity));
    if (finePointer) addEventListener('pointermove', (e) => s.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
    addEventListener('resize', () => s.resize());
    section.classList.add('is-live');
    gsap.ticker.add(tick);
    if (import.meta.env.DEV) (window as any).__ntw = { state, scene: s };
  });

  let lastIdx = -2;
  const hud = (p: number) => {
    const kw = p < 0.85 ? 0 : p < 1.35 ? (250 * (p - 0.85)) / 0.5 : p < 2.2 ? 250 : p < 2.8 ? 250 + (500 * (p - 2.2)) / 0.6 : 750;
    kwEl.textContent = String(Math.round(kw));
    const on = p < 0.85 ? 0 : p < 2.35 ? 1 : p < 2.55 ? 2 : 3;
    units.forEach((u, i) => u.classList.toggle('on', i < on));
    const idx = p < 0.85 ? -1 : Math.min(3, Math.floor(p - 0.85));
    if (idx !== lastIdx) { lastIdx = idx; dots.forEach((d, i) => d.classList.toggle('on', i <= idx)); }
  };

  const tl = gsap.timeline({
    defaults: { ease: 'power1.inOut' },
    scrollTrigger: {
      trigger: section, pin: stage, start: 'top top', end: () => `+=${innerHeight * (mobile ? 4.8 : 5.6)}`, scrub: 1, anticipatePin: 1,
      onUpdate: (st) => { hud(st.progress * END); impactLink?.classList.toggle('is-active', st.progress > 0.16); },
      onToggle: (st) => { active = st.isActive; if (!st.isActive) impactLink?.classList.remove('is-active'); },
    },
  });
  pinAnchors.set('#impact', () => { const st = tl.scrollTrigger!; return st.start + (st.end - st.start) * (1.1 / END); });

  // camera and scene
  tl.to(state, { ...k[1], spin: 0.7, duration: 1 }, 0)
    // each move settles before its chapter's copy leaves, so the view holds while you read
    .to(state, { ...k[2], duration: 0.8 }, 1)
    .to(state, { ...k[3], spin: 0.9, duration: 0.75 }, 2)
    .to(state, { ...k[4], duration: 0.7 }, 3)
    .to(state, { flow: 1, duration: 0.5 }, 3.15)
    .to(state, { ...k[5], duration: 0.8 }, 4)
    .to(state, { shift: 1, flow: 0.35, duration: 0.9 }, 4.05)
    .to(state, { arc: 1, duration: END, ease: 'none' }, 0)
    .to({}, { duration: END - 5 }, 5);
  // hero copy leaves as the camera dives in, then the chapters take over
  tl.to('.hero-block', { y: -80, autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, 0.02)
    .to('.hero-stats', { y: -60, autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, 0.02)
    .to('.scroll-cue', { autoAlpha: 0, duration: 0.15 }, 0)
    .to('.hud', { autoAlpha: 1, duration: 0.25 }, 0.7)
    .to('.chapters-eyebrow', { opacity: 1, duration: 0.2 }, 0.75);
  chapters.forEach((c, i) => {
    const at = i === 0 ? 0.8 : i + 1.05;
    tl.fromTo(c, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.25, ease: 'power2.out' }, at);
    if (i < chapters.length - 1) tl.to(c, { autoAlpha: 0, y: -30, duration: 0.18, ease: 'power2.in' }, i + 1.8);
  });
  hud(0);
}

/* About: the intro sentence fills word by word, the portrait drifts, the years count up */
function buildAbout() {
  const fill = $('.fill-text');
  if (fill) {
    const words = fill.textContent!.trim().split(/\s+/);
    fill.innerHTML = words.map((w) => `<span class="w">${w}</span>`).join(' ');
    const spans = $$('.w', fill);
    ScrollTrigger.create({
      trigger: fill, start: 'top 85%', end: 'bottom 45%', scrub: true,
      onUpdate: (st) => { const n = Math.round(st.progress * spans.length); spans.forEach((s, i) => s.classList.toggle('on', i < n)); },
    });
  }
  gsap.from('.about-intro h2', { y: 50, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.about-intro', start: 'top 80%', once: true } });
  gsap.from('.founder-frame', { clipPath: 'inset(30% 20% 30% 20% round 18px)', duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.founder', start: 'top 80%', once: true } });
  gsap.fromTo('.founder-frame img', { yPercent: -6 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.founder', start: 'top bottom', end: 'bottom top', scrub: true } });
  const years = $('.founder-years b');
  if (years) {
    const o = { v: 0 };
    gsap.to(o, { v: 30, duration: 1.8, ease: 'power3.out', onUpdate: () => (years.textContent = String(Math.round(o.v))), scrollTrigger: { trigger: years, start: 'top 85%', once: true } });
  }
  gsap.from('.founder-copy > *', { y: 40, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: '.founder-copy', start: 'top 80%', once: true } });
}

/* Mission & vision: the year rolls from today to 2030 while the capacity grid fills, 50 kW a square */
function buildDirection() {
  const mw = $('.grid-mw')!;
  const o = { v: 0.75 };
  const show = () => (mw.textContent = o.v.toFixed(2).replace(/0$/, ''));
  show();
  const wind = $$('.cell.wind b');
  const sun = $$('.cell.sun b');
  gsap.set([...wind, ...sun], { scale: 0 });
  gsap.set('.odo-strip', { yPercent: 0 });
  gsap.set('.grid-legend .wind, .grid-legend .sun', { opacity: 0.3 });
  const [mission, vision] = $$('.dir-text');
  gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: '.direction', pin: true, start: 'top top', end: () => `+=${innerHeight * (mobile ? 2 : 2.4)}`, scrub: 1, anticipatePin: 1 },
  })
    .to('.odo-strip', { yPercent: -80, duration: 2.1, ease: 'power1.inOut' }, 0.3)
    .to(wind, { scale: 1, duration: 0.15, stagger: 0.05, ease: 'back.out(2)' }, 0.4)
    .to('.grid-legend .wind', { opacity: 1, duration: 0.2 }, 0.4)
    .to(o, { v: 1.5, duration: 0.85, onUpdate: show }, 0.4)
    .to(sun, { scale: 1, duration: 0.15, stagger: 0.05, ease: 'back.out(2)' }, 1.3)
    .to('.grid-legend .sun', { opacity: 1, duration: 0.2 }, 1.3)
    .to(o, { v: 2.5, duration: 1.1, onUpdate: show }, 1.3)
    .to(mission, { autoAlpha: 0, y: -30, duration: 0.25, ease: 'power2.in' }, 1.3)
    .fromTo(vision, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 1.55)
    .to({}, { duration: 0.6 }, 2.4);
  gsap.from('.dir-left > .eyebrow, .dir-left > h2, .odometer', { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.direction', start: 'top 75%', once: true } });
  gsap.from('.dir-right', { y: 60, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.direction', start: 'top 70%', once: true } });
}

/* Values: three blades, three values. The rotor turns 120 degrees per value and the blade pointing at the copy lights up */
function buildValues() {
  const blades = $$('.blade');
  const panels = $$('.value-panel');
  const head = $('.values-head h2 span');
  const glows = ['rgba(34, 178, 234, 0.38)', 'rgba(255, 210, 63, 0.32)', 'rgba(61, 187, 92, 0.34)'];
  const colors = ['var(--sky)', 'var(--sun)', 'var(--leaf)'];
  const wrap = $('.rotor-wrap')!;
  const rot = { r: 0 };
  let cur = -1;
  const apply = () => {
    gsap.set('.rotor-spin', { rotation: rot.r, svgOrigin: '0 0' });
    gsap.set('.rotor-ring', { rotation: -rot.r * 0.35, svgOrigin: '0 0' });
    const idx = Math.max(0, Math.min(2, Math.round(rot.r / 120)));
    if (idx === cur) return;
    cur = idx;
    blades.forEach((b, i) => b.classList.toggle('on', i === idx));
    wrap.style.setProperty('--glow', glows[idx]);
    if (head) head.style.color = colors[idx];
    panels.forEach((p, i) => gsap.to(p, { autoAlpha: i === idx ? 1 : 0, y: i === idx ? 0 : i < idx ? -30 : 30, duration: 0.5, ease: 'power2.out', overwrite: true }));
  };
  apply();
  gsap.timeline({
    scrollTrigger: {
      trigger: '.values', pin: true, start: 'top top', end: () => `+=${innerHeight * 2.2}`, scrub: 1, anticipatePin: 1,
      // snap to the nearest value (an array would snap in the scroll direction and skip the first one)
      snap: { snapTo: (v: number) => Math.round(v * 2) / 2, duration: { min: 0.3, max: 0.8 }, delay: 0.12, ease: 'power2.inOut', inertia: false },
    },
  })
    .to(rot, { r: 120, duration: 0.6, ease: 'power2.inOut', onUpdate: apply }, 0.4)
    .to(rot, { r: 240, duration: 0.6, ease: 'power2.inOut', onUpdate: apply }, 1.4)
    .to({}, { duration: 0.4 }, 2.0);
  gsap.from('.values-head > *', { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.values', start: 'top 75%', once: true } });
  gsap.from('.rotor', { rotation: -90, scale: 0.8, opacity: 0, duration: 1.8, ease: 'expo.out', scrollTrigger: { trigger: '.values', start: 'top 70%', once: true } });
}

/* Services: a power cable is drawn down the section; as its pulse reaches each station that service switches on */
function buildServices() {
  gsap.from('.services .section-head > *', { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.services', start: 'top 80%', once: true } });
  const pulse = $('.path-pulse')!;
  gsap.to('.path-fill', {
    scaleY: 1, ease: 'none',
    scrollTrigger: { trigger: '.path-line', start: 'top 60%', end: 'bottom 60%', scrub: true, onUpdate: (st) => (pulse.style.top = `${st.progress * 100}%`) },
  });
  $$('.station').forEach((s, i) => {
    const node = $('.station-node', s)!;
    ScrollTrigger.create({ trigger: node, start: 'center 60%', onEnter: () => s.classList.add('is-on'), onLeaveBack: () => s.classList.remove('is-on') });
    const side = mobile ? 40 : i % 2 ? 60 : -60;
    gsap.from($('.station-art', s), { x: side, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 85%', once: true } });
    gsap.from($('.station-text', s), { x: mobile ? 40 : -side, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 85%', once: true } });
  });
  // the big outlined numbers drift against the scroll
  $$('.station-big').forEach((n) => gsap.fromTo(n, { yPercent: -70 }, { yPercent: -30, ease: 'none', scrollTrigger: { trigger: n.parentElement!, start: 'top bottom', end: 'bottom top', scrub: true } }));
  // cards tilt toward the pointer, with a soft light following it
  if (finePointer) {
    $$('.station-art').forEach((card) => {
      gsap.set(card, { transformPerspective: 900 });
      const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' });
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        rx((0.5 - y) * 14);
        ry((x - 0.5) * 18);
        card.style.setProperty('--mx', `${x * 100}%`);
        card.style.setProperty('--my', `${y * 100}%`);
      });
      card.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  }
  // a real clock on the monitoring card, in Indian time
  const clock = $('.readout-time');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const tickClock = () => (clock.textContent = `${fmt.format(new Date())} IST`);
    tickClock();
    setInterval(tickClock, 1000);
  }
  const finish = $('.path-finish')!;
  ScrollTrigger.create({ trigger: $('svg', finish), start: 'center 60%', onEnter: () => finish.classList.add('is-on'), onLeaveBack: () => finish.classList.remove('is-on') });
}

function buildOnsite() {
  gsap.from('.onsite-copy > *', { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.onsite', start: 'top 75%', once: true } });
  gsap.from('.onsite-frame', { clipPath: 'inset(100% 0% 0% 0% round 22px)', duration: 1.6, ease: 'expo.inOut', scrollTrigger: { trigger: '.onsite-photo', start: 'top 80%', once: true } });
  gsap.fromTo('.onsite-frame img', { yPercent: -10 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.onsite-photo', start: 'top bottom', end: 'bottom top', scrub: true } });
}

/* Solar: pinned 3D story of the planned expansion. An empty plot, tracker rows rising and turning to the sun,
   the planned turbines appearing on the ridge, then power flowing out. Sunrise in night mode, full day in day mode. */
function buildSolar() {
  const section = $('.solar')!;
  const stage = $('.solar-stage', section)!;
  const canvas = $<HTMLCanvasElement>('.solar-canvas', section)!;
  const figs = $$('.solar-figs li', section);
  const para = $('.solar-copy p:not(.eyebrow)', section);
  const S = mobile
    ? [
        { cx: -30, cy: 14, cz: 70, lx: 4, ly: 0, lz: -22 },
        { cx: -26, cy: 46, cz: 66, lx: 2, ly: 0, lz: -20 },
        { cx: 30, cy: 7, cz: 26, lx: -2, ly: 2, lz: -22 },
        { cx: 10, cy: 34, cz: 110, lx: 14, ly: 14, lz: -95 },
        { cx: -40, cy: 60, cz: 110, lx: 22, ly: 6, lz: -55 },
      ]
    : [
        { cx: -38, cy: 10, cz: 40, lx: 6, ly: 0, lz: -20 },
        { cx: -30, cy: 32, cz: 46, lx: 4, ly: 0, lz: -18 },
        { cx: 26, cy: 5, cz: 9, lx: -2, ly: 2, lz: -22 },
        { cx: 6, cy: 30, cz: 72, lx: 14, ly: 14, lz: -92 },
        { cx: -58, cy: 42, cz: 62, lx: 30, ly: 8, lz: -58 },
      ];
  const END = 4.3;
  const state = { ...S[0], build: 0, tilt: 0, wind: 0, flow: 0, rise: 0 };
  let scene: SolarScene | null = null;
  let active = false;
  const tick = (_t: number, dms: number) => {
    if (!scene || !active) return;
    const s = scene.state, light = isLight();
    s.cx = state.cx; s.cy = state.cy; s.cz = state.cz; s.lx = state.lx; s.ly = state.ly; s.lz = state.lz;
    s.build = state.build; s.tilt = state.tilt; s.wind = state.wind; s.flow = state.flow;
    s.dayMode = light;
    // night mode: the sun comes up while the panels turn to it; day mode: a high, bright sun
    s.time = light ? 1 : 0.5 + 0.2 * state.rise;
    s.sunElev = light ? 0.55 + 0.05 * state.rise : 0.02 + 0.26 * state.rise;
    scene.render(Math.min(dms / 1000, 0.05));
  };
  ScrollTrigger.create({
    trigger: section, start: 'top 250%', once: true,
    onEnter: () => {
      import('./solar').then(({ createSolarScene }) => {
        try {
          scene = createSolarScene(canvas, { mobile });
          section.classList.add('is-live');
          gsap.ticker.add(tick);
          addEventListener('resize', () => scene?.resize());
        } catch (err) { console.warn('[solar] WebGL unavailable, keeping the photo', err); }
      });
    },
  });
  const marks = [1.1, 2.75, 3.55]; // when 1 MW, 750 kW and 2.5 MW switch on
  const tl = gsap.timeline({
    defaults: { ease: 'power1.inOut' },
    scrollTrigger: {
      trigger: section, pin: stage, start: 'top top', end: () => `+=${innerHeight * (mobile ? 3.2 : 3.6)}`, scrub: 1, anticipatePin: 1,
      onUpdate: (st) => { const p = st.progress * END; figs.forEach((f, i) => f.classList.toggle('on', p >= marks[i])); },
    },
  });
  tl.to(state, { ...S[1], build: 1, duration: 1.2 }, 0.15)
    .to(state, { ...S[2], tilt: 1, duration: 0.9 }, 1.4)
    .to(state, { ...S[3], wind: 1, duration: 1 }, 2.3)
    .to(state, { ...S[4], flow: 1, duration: 0.8 }, 3.3)
    .to(state, { rise: 1, duration: END, ease: 'none' }, 0)
    .to({}, { duration: 0.2 }, 4.1);
  // phones: the paragraph makes way for the scene once the rows start rising
  if (mobile && para) tl.fromTo(para, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3, immediateRender: false }, 0.9);
  ScrollTrigger.create({ trigger: section, start: 'top bottom', end: 'bottom top', refreshPriority: -1, onToggle: (st) => (active = st.isActive) });
  gsap.from(mobile ? '.solar-copy > :not(p:not(.eyebrow)), .solar-side' : '.solar-copy > *, .solar-side', { y: 50, opacity: 0, duration: 1.1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.solar', start: 'top 60%', once: true } });
}

function buildContact() {
  gsap.from('.contact-copy > *, .contact-form', { y: 50, opacity: 0, duration: 1.1, stagger: 0.07, ease: 'expo.out', scrollTrigger: { trigger: '.contact', start: 'top 70%', once: true } });
  gsap.from('.footer-big', { yPercent: 60, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.footer', start: 'top 95%', once: true } });
}

/* Article page: gentle entrances only */
function buildArticle() {
  gsap.from('.article-head > *', { y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08 });
  gsap.from('.article-hero', { clipPath: 'inset(15% 10% 0% 10% round 22px)', duration: 1.4, ease: 'expo.out', delay: 0.2 });
  gsap.fromTo('.article-hero img', { yPercent: -10 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.article-hero', start: 'top bottom', end: 'bottom top', scrub: true } });
  $$('.article-body section').forEach((el) => gsap.from(el, { y: 50, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
}
