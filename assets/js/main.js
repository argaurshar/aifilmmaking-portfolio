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

  const items = [...list.querySelectorAll('.film-list__item')];
  const total = items.length;

  const apply = (type, { push }) => {
    let shown = 0;
    for (const item of items) {
      const match = type === 'all' || item.dataset.type === type;
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
    '.film-list__item, .film-card, .service-card, .founder, .process-step, ' +
    '.process-clip, .callout, .section__heading, .hero-reel .embed'
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
    const among = siblings.filter((n) => n.matches?.('.film-card, .service-card, .founder'));
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
