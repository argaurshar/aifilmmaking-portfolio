# 02 — Design System

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan, and rewritten for the Screening Room redesign. If you have the original,
> replace this file and rebuild.

**Direction: the Screening Room.** The site behaves like a screening, not a brochure. A film is on
screen first, edge to edge, with a title card. The work is browsed as a filmstrip that plays under
the pointer. Every film has its own page. Type is condensed and enormous for titles, monospaced for
credits. The ground is warm near-black with film grain. Nothing decorative competes with a still.

The audit that led here, and the three directions considered, are on the design canvas linked from
the project history. What follows is what shipped.

---

## Colour

Warm-neutral dark in `oklch` — sRGB hex ramps band badly at these luminances. Hue 70–85 (a faint
warmth, like a cinema with the house lights down) rather than the previous cool 285. Film stills are
the only saturated thing on the page; amber is the one accent and it is spent carefully.

```css
--c-bg:          oklch(0.135 0.004 70);   /* page */
--c-bg-elev-1:   oklch(0.165 0.006 70);   /* the process strip */
--c-bg-elev-2:   oklch(0.205 0.007 70);   /* empty frames, letterbox */
--c-text:        oklch(0.950 0.008 85);
--c-text-muted:  oklch(0.760 0.012 80);   /* body-safe */
--c-text-dim:    oklch(0.620 0.012 80);   /* METADATA ONLY — never body copy */
--c-line:        color-mix(in oklch, var(--c-text) 10%, transparent);
--c-line-strong: color-mix(in oklch, var(--c-text) 22%, transparent);
--c-accent:      oklch(0.800 0.145 78);   /* amber */
--c-accent-ink:  oklch(0.180 0.030 78);   /* text on amber */
--c-focus:       oklch(0.860 0.170 210);  /* cyan — never the accent, so focus never reads as brand */
```

`--c-text-dim` on `--c-bg` is ~7:1 and fine for the metadata it is scoped to. Rules are
`color-mix` of the text colour so they sit on any ground, including over a still.

**Dark only.** No light mode and no toggle. Declare `color-scheme: dark`. Ship
`@media (forced-colors: active)` (restore borders where backgrounds vanish; drop grain and
vignette) and `@media print` (black on white, chrome hidden, link URLs expanded, the reel unrolled).

---

## Type

Two faces, three registers. Both OFL, both self-hosted in `assets/fonts/` with the licence beside
them. Never Google Fonts at runtime: a render-blocking third-party request, a privacy leak, and a
live dependency that contradicts "still builds in five years".

| Face | File | Role |
|---|---|---|
| **Archivo** (variable: weight 100–900 **and width 62–125%**) | `archivo-var.woff2`, 87 KB | Everything that is not credits. Titles run **condensed** (`font-stretch` 80–88%, weight 800, tight tracking, line-height 0.94); body runs at 100%. The width axis is why this face was chosen — one file gives a cinematic title and a readable paragraph. |
| **IBM Plex Mono** (400, 500) | `plex-mono-400/500.woff2`, 9 KB each | Credits, labels, metadata, buttons, nav: the small print of a title card. |

Only Archivo is preloaded (`<link rel="preload" as="font" crossorigin>` — `crossorigin` is
required even same-origin, or the font is fetched twice).

The three registers, as classes:

```css
.display { font-weight: 800; font-stretch: 82%; letter-spacing: -0.02em; line-height: 0.94; }
.eyebrow { font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.2em; text-transform: uppercase; }
.meta    { /* eyebrow, tracked a little tighter */ }
```

Headings inherit the display treatment. Do not invent a fourth register.

Fluid scale via `clamp()`; **every step keeps a `rem` term** so browser zoom works (WCAG 1.4.4).
Two steps were added above the old top for title cards:

```css
--step-5: clamp(2.75rem, 1.60rem + 5.20vw, 6rem);   /* page titles, the statement */
--step-6: clamp(2.9rem,  1.20rem + 7.20vw, 7rem);   /* reserved: between a page title and a stage */
--step-7: clamp(3.2rem,  1.05rem + 9.20vw, 9rem);   /* the title card on a stage, a film's h1 */
```

Measure: `--measure: 40rem` for prose, `--measure-wide: 90rem` for page width.

---

## Spacing, radii, motion

```css
--space-3xs:.25rem  --space-2xs:.5rem  --space-xs:.75rem  --space-s:1rem
--space-m:1.5rem    --space-l:2.5rem   --space-xl:4rem    --space-2xl:6rem
--space-section: clamp(3.5rem, 2rem + 6vw, 7.5rem);
--gutter:        clamp(1.25rem, 0.8rem + 1.8vw, 2.5rem);

--radius-sm:3px  --radius-md:6px  --radius-full:999px      /* frames have no radius at all */

--dur-fast:120ms --dur:220ms --dur-slow:480ms
--ease-out: cubic-bezier(.2,.8,.2,1);
```

Frames of film are square-cornered, always. Rounded corners belong to pills and placeholders.

---

## Layout primitives

```css
.l-container { width: min(100% - var(--gutter)*2, var(--measure-wide)); margin-inline: auto; }
.l-stack > * + * { margin-block-start: var(--stack-space, var(--space-m)); }
.l-grid { display:grid; gap: var(--gap, var(--space-l));
          grid-template-columns: repeat(auto-fit, minmax(min(var(--col-min, 20rem), 100%), 1fr)); }
.l-cluster { display:flex; flex-wrap:wrap; gap: var(--gap, var(--space-2xs)); align-items:center; }
```

`minmax(min(var(--col-min), 100%), 1fr)` is what stops `auto-fit` grids overflowing on narrow
viewports. Do not simplify it.

Full-bleed sections (`.stage`, `.reel`, `.strip`, `.sheet`) are direct children of `<main>` at
`width: 100%`; the container lives inside them. On pages that open on a stage (`.page--index`,
`.page--film`) the header is absolute over the picture and the first section has no top margin.

---

## Components

### The stage

A film edge to edge. `.stage` wraps an `embed` and paints two pseudo-elements over the poster:
`::before` is film grain (an inline SVG `feTurbulence`, `mix-blend-mode: overlay`, opacity 0.26 —
no image request) and `::after` is a left-weighted vignette that carries the title card. Both sit at
`z-index: 1`, under the play control at `2` and the title card at `3`.

- `.stage--hero` (home): 16:9 on a desk, **4:5 in the hand** — a film still is not a banner. Capped
  at `92svh`. The centred play icon is hidden; the title card's pill is the visible affordance and
  the whole frame is the control.
- `.stage--plain` (a landscape film page): grain, no vignette, no card.
- `.stage--portrait` (a vertical film page): the 9:16 frame centred on a dark stage with its own
  poster blurred behind it (`.stage__bg`, `blur(28px) brightness(0.42)`), a soft shadow, and two
  mono notes at the corners. The awkward format becomes a feature.

### The title card

`.title-card` is absolutely positioned inside the stage's frame, `pointer-events: none` except for
its links. Eyebrow (`Now showing · 04 / 16`), the title at `--step-7`, a mono credits line, a Play
pill and a Film page pill, and Next at the right. The Play pill is a `<span>`: the frame itself is
the play link, and the pill lights up through `.embed__play:hover ~ .title-card .btn--play`.

### Frames

`.frame` is a poster that behaves like a film: an `<a>` to the film's page carrying
`data-cursor="play"`, a `view-transition-name`, and — when a strip exists — `data-strip` and
`data-frames`. Hover scales the poster 1.05.

With `label: true` the film's title is set **over** the poster in `.frame__cap`, not under it —
the reel, the Recent side column and the Related list all use it. Two things make that work:

- **`.frame` is a container** (`container-type: inline-size`), so `.frame__title` is sized in
  `cqw` and fills whatever frame it lands in. A reel frame gets ~45px, a Work tile ~29px, and the
  hero's own title card is `--step-7`. One rule, no per-context overrides.
- **The scrim is the caption**, a gradient on `.frame__cap` itself, so it is only ever as tall as
  the text needs. A text-shadow covers the case of a bright poster. Under `forced-colors` the
  gradient is not painted, so the scrim becomes solid `Canvas` and the shadow is dropped.

`.tile__cap` on the Work sheet is the same treatment: it used to appear on hover, which a phone
never does, so the title is always visible and only the round go button waits for intent.

The caption is `aria-hidden`; the accessible name stays a visually-hidden span inside the link,
so a screen reader still hears one link per film, title then type and runtime.

### The reel

`.reel__track` is a horizontal scroller: `overflow-x: auto`, `scroll-snap-type: x proximity`,
`scroll-padding-inline: var(--gutter)` so the first frame snaps to the page margin rather than the
window edge,
`tabindex="0"` with `role="region"`. Items are sized from `--reel-h` (12.5rem on a phone, 18.75rem
on a desk); a portrait item is `--reel-h × 9/16` wide. Prev/next buttons are shown by JS only.

Snap is `proximity`, **not** `mandatory`: a mandatory snap undoes the small scroll an arrow key
makes, so keyboard users could never move the track. `main.js` also maps ArrowLeft/Right to one
frame and Home/End to the ends.

### The sheet (Work)

`.sheet` is an edge-to-edge grid with 4px gutters: 2 columns on a phone, 3 from 46rem, 4 from
72rem. Every cell is 16:9 (`grid-auto-rows` computed from the viewport); a vertical film spans
**three** rows, which lands within a few percent of 9:16 so nothing important is cropped.
`grid-auto-flow: dense` backfills. A `.tile` is the poster with a caption that appears on hover or
focus — and is always visible on `(hover: none)`, because a touch screen has no hover.

### Film page

`.film-head` is a two-column title card: eyebrow, title at `--step-7`, the logline as a lede, Play
and Watch-on-YouTube pills; beside it `.credits`, a mono `<dl>` with hairline rules. Synopsis runs
in `.prose--columns` (two columns from 60rem). `.related__list` is three frames. `.pager` is
previous / next by site order, wrapping.

### Pills

`.btn` is the only button: mono, uppercase, 44px tall, fully rounded. `--primary` is amber,
`--ghost` a 45%-text border (above the 3:1 non-text floor). Nothing else is a button.

### Video embed

Facade: poster + play control, iframe injected only on activation. The box is reserved with
`aspect-ratio` so CLS is zero. `--embed-ratio` and `view-transition-name: film-<slug>` are the
**only** declarations permitted in a `style` attribute; the audit and a test enforce it.

`.embed__play:focus-visible { outline-offset: -5px }` pulls the focus ring inside the clipping
frame, where it is actually visible.

### `placeholder` is first-class

A dashed, monospaced `MISSING: …` block. Making a gap loud is what stops "never invent facts" from
decaying into invented copy.

---

## Focus

```css
:focus-visible { outline: 2px solid var(--c-focus); outline-offset: 3px; border-radius: inherit; }
```

`outline: none` without a replacement is **banned** and grep-tested. Anything with
`overflow: hidden` that contains a focusable control pulls the ring inside with a negative offset:
`.embed__play`, `.frame`, `.tile`, `.reel__track`. A focused frame also draws a Play pill with CSS
(`.frame:focus-visible::after`) — the keyboard gets what the pointer gets.

---

## The five signatures

In order of impact. Every one is progressive enhancement, and every one is off under
`prefers-reduced-motion: reduce`.

1. **Hover-scrub.** Each film may ship a strip of N stills side by side at
   `assets/strips/<id>.jpg` (`scripts/make-posters.sh --strip`). The build reads the frame count off
   the image's proportions and stamps `data-strip` / `data-frames` on the film's frames and tiles.
   On a pointer device, `main.js` appends the strip on first hover (never on load) and slides it so
   the frame under the pointer shows. Motion from stills: not a byte of video is hosted.
2. **The title-card hero.** Above.
3. **The play cursor.** On fine-pointer devices `main.js` appends one `.cursor` pill that eases
   toward the pointer over any `[data-cursor="play"]`; the native cursor is hidden there via
   `.has-cursor`. Purely decorative, `aria-hidden`, and never a substitute for the focus ring.
4. **Page transitions.** `@view-transition { navigation: auto }` — cross-document, native, no
   library. Every frame and tile carries `view-transition-name: film-<slug>`, and the film page's
   stage carries the same name, so the frame you click grows into the stage. The header is named
   too, so it holds still. Browsers without the feature simply navigate. A name must be unique on a
   page: on the home page the reel owns it and the Recent block does not.
5. **The stage for vertical films.** Above.

---

## Motion policy

Reduced motion targets **incidental, unrequested** motion. It does not mean "don't play the video
the user just clicked."

| Behaviour | Under `reduce` |
|---|---|
| User clicks play → `autoplay=1` in the iframe | **Unchanged.** User-initiated. |
| Hover-scrub | JS never runs; the poster stands. |
| Play cursor | Still shown (it is a pointer, not motion), but it stops easing and simply follows. |
| Page transitions | `@view-transition { navigation: none }`. |
| Scroll reveal | Suppressed; the JS bails before touching the DOM. |
| Hover scale, pill transitions | Collapsed to `.01ms`; poster transforms disabled. |
| Autoplaying showreel | **Never shipped** — it would need a YouTube embed on load, which trades away the privacy posture. The hero is a still with a title card. |

### Scroll reveal

Reel items, sheet tiles, strip items, founders, offers, timeline steps, related films, the recent
block, section headings, the statement and the film head fade-rise 18px with a 70ms sibling
stagger. `.reveal` is added by `main.js` only, so with JS off or under reduced motion nothing is
ever hidden. Elements already in the viewport at load are skipped, and a scroll sweep catches
anything a teleport scrolled past.
