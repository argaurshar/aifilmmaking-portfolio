/**
 * main.js — progressive enhancement only.
 *
 * Contract: with JavaScript disabled every page is fully usable. Nothing is
 * hidden by default and revealed by JS. See docs/02-DESIGN-SYSTEM.md.
 *
 * Loaded as a module, so it defers, runs in strict mode, and leaks no globals.
 */

/** One feature failing must not take down the rest. */
const init = (name, fn) => {
  try { fn(); } catch (e) { console.warn(`[${name}]`, e); }
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ══════════════════════════════════════════════════════════════════════════
   Video embed facade

   The control is a real <a href> to the watch page. With JS off it genuinely
   works. Here we upgrade it in place: inject the iframe, move focus into it.

   Note: reduced motion does NOT suppress playback the user just asked for.
   It targets incidental motion only.
   ══════════════════════════════════════════════════════════════════════════ */

let activeEmbed = null;

function warmConnection(root) {
  if (root.dataset.warmed) return;
  root.dataset.warmed = '1';
  const origin = root.dataset.embedOrigin;
  if (!origin) return;
  for (const rel of ['preconnect', 'dns-prefetch']) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = origin;
    link.crossOrigin = '';
    document.head.append(link);
  }
}

function restoreEmbed(root, { refocus = false } = {}) {
  if (root.dataset.embedState !== 'playing') return;
  const frame = root.querySelector('.embed__frame');
  // Removing the iframe is how playback stops — you cannot pause a
  // cross-origin player without the vendor's JS API, which is a dependency.
  //
  // Restore the ORIGINAL nodes, never a serialised copy. innerHTML would
  // re-parse the markup into a fresh <a>, silently discarding the listeners
  // bound in init('embeds') — after which the play control is a plain link
  // that navigates the visitor to youtube.com. That fires on the ordinary
  // path too: activateEmbed() restores the previous embed whenever a second
  // film is played, so playing B used to break A.
  if (frame && root._posterNodes) frame.replaceChildren(...root._posterNodes);
  delete root.dataset.embedState;
  if (activeEmbed === root) activeEmbed = null;

  // The iframe we just removed may have held focus. Left alone it falls to
  // <body> and a keyboard user restarts from the top of the document.
  if (refocus) root.querySelector('.embed__play')?.focus();
}

function activateEmbed(root) {
  if (root.dataset.embedState === 'playing') return;
  const src = root.dataset.embedSrc;
  const frame = root.querySelector('.embed__frame');
  if (!src || !frame) return;

  if (activeEmbed && activeEmbed !== root) restoreEmbed(activeEmbed);

  root._posterNodes = [...frame.childNodes];

  const iframe = document.createElement('iframe');
  iframe.className = 'embed__iframe';
  iframe.src = src;                                   // built by build.mjs, never here
  iframe.title = root.dataset.embedTitle || 'Video player';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

  frame.replaceChildren(iframe);
  root.dataset.embedState = 'playing';
  activeEmbed = root;

  // The activated <a> was just removed from the DOM. Without this, focus falls
  // to <body> and keyboard users are stranded mid-page.
  iframe.focus({ preventScroll: true });
}

init('embeds', () => {
  const embeds = document.querySelectorAll('[data-embed]');
  for (const root of embeds) {
    const play = root.querySelector('.embed__play');
    if (!play) continue;

    // Warm the connection on intent, never on load — preconnecting to the
    // video host before the user asks would defeat the nocookie embed.
    play.addEventListener('pointerenter', () => warmConnection(root), { once: true });
    play.addEventListener('focus', () => warmConnection(root), { once: true });

    play.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;  // let open-in-new-tab work
      e.preventDefault();
      activateEmbed(root);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeEmbed) restoreEmbed(activeEmbed, { refocus: true });
  });

  // The film page's title card carries its own Play pill. With JS off it is a
  // link to the watch page; here it drives the stage's embed instead.
  for (const btn of document.querySelectorAll('[data-play-embed]')) {
    btn.addEventListener('click', (e) => {
      const root = document.querySelector('[data-embed]');
      if (!root) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      activateEmbed(root);
      root.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Mobile nav — an inline disclosure, not a modal.

   No focus trap, no scroll lock, no aria-modal. All three are bug farms and
   none of them is needed for a five-item list.
   ══════════════════════════════════════════════════════════════════════════ */

init('nav', () => {
  const toggle = document.querySelector('.site-nav__toggle');
  const panel = document.getElementById('site-nav-panel');
  if (!toggle || !panel) return;

  const mq = matchMedia('(max-width: 46rem)');

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  };

  // Only collapse where the toggle is actually shown.
  const sync = () => { if (mq.matches) setOpen(false); else { toggle.setAttribute('aria-expanded', 'false'); panel.hidden = false; } };
  sync();
  mq.addEventListener('change', sync);

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!mq.matches) return;
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (panel.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Work page filtering

   The filter links are real pages generated by build.mjs, so they work with
   JS off and are indexable. Here we intercept and filter in place.
   ══════════════════════════════════════════════════════════════════════════ */

init('filter', () => {
  const bar = document.querySelector('[data-filter-bar]');
  const list = document.querySelector('[data-film-list]');
  const status = document.querySelector('[data-filter-status]');
  if (!bar || !list) return;

  const items = [...list.querySelectorAll('.sheet__item')];
  const total = items.length;

  const apply = (type, { push }) => {
    let shown = 0;
    for (const item of items) {
      // "vertical" is an orientation, not a type: it cuts across the others.
      const match = type === 'all'
        || item.dataset.type === type
        || (type === 'vertical' && item.dataset.orientation === 'portrait');
      item.hidden = !match;
      if (match) shown++;
    }
    for (const link of bar.querySelectorAll('a')) {
      if (link.dataset.filter === type) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (status) status.textContent = `Showing ${shown} of ${total} films`;
    if (push) {
      const href = bar.querySelector(`a[data-filter="${type}"]`)?.getAttribute('href');
      if (href) history.pushState({ filter: type }, '', href);
    }
  };

  bar.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-filter]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    apply(link.dataset.filter, { push: true });
  });

  addEventListener('popstate', (e) => {
    apply(e.state?.filter ?? 'all', { push: false });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Copy-email — purely additive. The mailto link is the base state.
   ══════════════════════════════════════════════════════════════════════════ */

init('copy-email', () => {
  if (!navigator.clipboard) return;

  for (const link of document.querySelectorAll('.callout a[href^="mailto:"]')) {
    const email = link.getAttribute('href').slice('mailto:'.length);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost';
    btn.textContent = 'Copy';

    const live = document.createElement('span');
    live.className = 'u-visually-hidden';
    live.setAttribute('role', 'status');

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email);
        btn.textContent = 'Copied';
        live.textContent = 'Email address copied to clipboard';
        setTimeout(() => { btn.textContent = 'Copy'; live.textContent = ''; }, 2000);
      } catch {
        live.textContent = 'Could not copy. Select the address instead.';
      }
    });

    link.after(btn, live);
    link.parentElement?.classList.add('l-cluster');
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Header height, so :target scroll-margin clears the sticky header.
   ══════════════════════════════════════════════════════════════════════════ */

init('header-height', () => {
  const header = document.querySelector('.site-header');
  if (!header || !('ResizeObserver' in window)) return;

  // Writes --header-measured, NOT --header-h. --header-h feeds the header's own
  // min-height, so measuring into it is a feedback loop: each pass adds the
  // border and the header grows forever.
  let last = -1;
  const set = () => {
    const h = Math.round(header.getBoundingClientRect().height);
    if (h === last) return;
    last = h;
    document.documentElement.style.setProperty('--header-measured', `${h}px`);
  };
  set();
  new ResizeObserver(set).observe(header);
});

/* ══════════════════════════════════════════════════════════════════════════
   Scroll reveal — cinematic-subtle.

   The .reveal class is added HERE, never in markup, so with JS off (or under
   prefers-reduced-motion, where we bail before touching the DOM) every
   element is simply visible. Siblings stagger by 70ms within their parent.
   ══════════════════════════════════════════════════════════════════════════ */

init('reveal', () => {
  if (reduceMotion.matches) return;
  if (!('IntersectionObserver' in window)) return;

  const targets = document.querySelectorAll(
    '.reel__item, .sheet__item, .strip__item, .founder, .offer, .timeline__step, ' +
    '.related__item, .recent__lead, .recent__side > *, .process-clip, .callout, ' +
    '.section__heading, .statement, .film-head'
  );
  if (!targets.length) return;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
      pending.delete(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

  const pending = new Set();
  for (const el of targets) {
    // Never hide what the visitor can already see — reveals are for content
    // that has yet to scroll in, not a curtain over the first paint.
    if (el.getBoundingClientRect().top < innerHeight * 0.92) continue;
    const siblings = el.parentElement ? [...el.parentElement.children] : [el];
    const among = siblings.filter((n) => n.matches?.('.reel__item, .sheet__item, .strip__item, .founder, .offer, .related__item'));
    const idx = Math.max(0, among.indexOf(el));
    el.style.setProperty('--reveal-delay', `${Math.min(idx, 5) * 70}ms`);
    el.classList.add('reveal');
    pending.add(el);
    io.observe(el);
  }

  // Failsafe: a teleport (find-in-page, fragment jump, history restore) can
  // move PAST an element without it ever intersecting — the observer sees
  // below-viewport → above-viewport as no change and stays silent, leaving a
  // permanent hole. On each scroll, reveal anything already scrolled past.
  let raf = 0;
  const sweep = () => {
    raf = 0;
    for (const el of pending) {
      if (el.getBoundingClientRect().bottom < 0) {
        el.classList.add('in');
        io.unobserve(el);
        pending.delete(el);
      }
    }
    if (!pending.size) removeEventListener('scroll', onScroll);
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(sweep); };
  addEventListener('scroll', onScroll, { passive: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   The reel — prev/next buttons for the horizontal track.

   The track is a real scrolling region (tabindex="0"), so keyboard users
   already have arrow keys and touch users already have swipe. The buttons
   are for the mouse. With JS off they are hidden by CSS.
   ══════════════════════════════════════════════════════════════════════════ */

init('reel', () => {
  const track = document.querySelector('[data-reel]');
  if (!track) return;
  const step = () => {
    const item = track.querySelector('.reel__item');
    return item ? item.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
  };
  const go = (dir, n = 2) => track.scrollBy({ left: dir * step() * n, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  document.querySelector('[data-reel-prev]')?.addEventListener('click', () => go(-1));
  document.querySelector('[data-reel-next]')?.addEventListener('click', () => go(1));

  // Arrow keys move one whole frame. The browser's own key scrolling nudges
  // by a few dozen pixels, which the snap then pulls back — net movement zero.
  track.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1, 1); }
    else if (e.key === 'Home') { e.preventDefault(); track.scrollTo({ left: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); }
    else if (e.key === 'End') { e.preventDefault(); track.scrollTo({ left: track.scrollWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Hover-scrub — a poster that plays under the pointer.

   Any element with data-strip names an image of N frames laid side by side
   (assets/strips/<id>.jpg, cut by scripts/make-posters.sh --strip). Moving
   across the element slides the strip so the frame under the cursor shows.
   Motion from stills: not a byte of video is hosted. The strip is fetched
   on first hover, never on load. Pointer devices only; off under reduced
   motion, where the poster simply stands.
   ══════════════════════════════════════════════════════════════════════════ */

init('scrub', () => {
  if (reduceMotion.matches) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  for (const el of document.querySelectorAll('[data-strip]')) {
    const frames = Number(el.dataset.frames) || 0;
    if (frames < 2) continue;
    let strip = null;

    const ensure = () => {
      if (strip) return strip;
      strip = new Image();
      strip.className = 'frame__strip';
      strip.alt = '';
      strip.decoding = 'async';
      strip.style.width = `${frames * 100}%`;
      strip.src = el.dataset.strip;
      el.append(strip);
      return strip;
    };
    const show = (e) => {
      if (!strip) return;
      const r = el.getBoundingClientRect();
      const i = Math.min(frames - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * frames)));
      strip.style.transform = `translateX(${(-i * 100) / frames}%)`;
    };

    el.addEventListener('pointerenter', (e) => { ensure(); el.classList.add('is-scrubbing'); show(e); });
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', () => el.classList.remove('is-scrubbing'));
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   The play cursor — a small white pill that follows the pointer over a film.

   Decorative only: aria-hidden, pointer devices only, and never a substitute
   for the focus ring, which is untouched. Keyboard users get the same pill
   drawn by CSS on :focus-visible.
   ══════════════════════════════════════════════════════════════════════════ */

init('cursor', () => {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const targets = document.querySelectorAll('[data-cursor="play"]');
  if (!targets.length) return;

  const pill = document.createElement('div');
  pill.className = 'cursor';
  pill.setAttribute('aria-hidden', 'true');
  pill.innerHTML = '<svg viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg>Play';
  document.body.append(pill);
  document.documentElement.classList.add('has-cursor');

  // Eases toward the pointer so it feels attached rather than glued.
  // Under reduced motion it simply follows.
  const ease = reduceMotion.matches ? 1 : 0.32;
  let x = 0, y = 0, tx = 0, ty = 0, raf = 0, over = false;
  const tick = () => {
    x += (tx - x) * ease; y += (ty - y) * ease;
    pill.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    raf = (over || Math.abs(tx - x) + Math.abs(ty - y) > 0.5) ? requestAnimationFrame(tick) : 0;
  };
  const move = (e) => { tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(tick); };

  for (const t of targets) {
    t.addEventListener('pointerenter', (e) => { over = true; x = tx = e.clientX; y = ty = e.clientY; pill.classList.add('is-on'); move(e); });
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerleave', () => { over = false; pill.classList.remove('is-on'); });
  }
});
