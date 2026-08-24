# 02 — Design System

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

**Direction: cinema black.** Near-black, full-bleed video, minimal chrome, small precise type. The
work does the talking. Nothing decorative competes with a film still.

---

## Colour

Warm-neutral dark, in `oklch` — sRGB hex ramps band badly at these luminances, and oklch gives a
perceptually even ramp. Film stills are the only saturated thing on the page.

```css
--c-bg:          oklch(0.155 0.006 285);   /* page */
--c-bg-elev-1:   oklch(0.200 0.008 285);   /* cards */
--c-bg-elev-2:   oklch(0.255 0.010 285);   /* wells, video letterbox */
--c-line:        oklch(0.320 0.010 285);
--c-line-strong: oklch(0.440 0.012 285);
--c-text:        oklch(0.960 0.005 285);
--c-text-muted:  oklch(0.760 0.008 285);   /* body-safe */
--c-text-dim:    oklch(0.620 0.008 285);   /* METADATA ONLY — never body copy */
--c-accent:      oklch(0.800 0.145 78);    /* warm amber, film-lab */
--c-accent-ink:  oklch(0.180 0.030 78);    /* text on accent */
--c-focus:       oklch(0.860 0.170 210);   /* cyan — never the accent, so focus never reads as brand */
```

`--c-text-dim` on `--c-bg` is ~7:1 and fine for the metadata it is scoped to; it must never carry
body copy. `--c-text-muted` is ~12:1.

**Dark only.** No light mode and no toggle. A light frame around dark video creates
simultaneous-contrast problems that flatten stills, and a second theme doubles the regression
surface on a project whose premise is fewer moving parts. Declare `color-scheme: dark` so scrollbars
and form controls match. Because no component hardcodes a colour, adding light mode later is one
`@media (prefers-color-scheme: light)` token override with zero component edits.

Ship instead:
- `@media (forced-colors: active)` — restore borders where backgrounds vanish.
- `@media print` — a festival programmer will print the Hire page. Invert to black-on-white, hide
  chrome, and expand link URLs.

---

## Type

Fluid scale via `clamp()`. **Every step keeps a `rem` term** so browser zoom still works (WCAG 1.4.4).

```css
--step--1: clamp(0.875rem, 0.845rem + 0.15vw, 0.95rem);   /* metadata, chips */
--step-0:  clamp(1rem,     0.960rem + 0.20vw, 1.125rem);  /* body */
--step-1:  clamp(1.25rem,  1.150rem + 0.50vw, 1.5rem);    /* lead */
--step-2:  clamp(1.5rem,   1.300rem + 1.00vw, 2.1rem);    /* h3 */
--step-3:  clamp(1.9rem,   1.520rem + 1.90vw, 3rem);      /* h2 */
--step-4:  clamp(2.4rem,   1.700rem + 3.40vw, 4.4rem);    /* h1 */
--step-5:  clamp(3rem,     1.800rem + 6.00vw, 6.5rem);    /* hero only */
```

Measure: `--measure: 38rem` for prose, `--measure-wide: 76rem` for page width.

### Fonts

**In use: Space Grotesk (variable, 300–700), self-hosted at `assets/fonts/space-grotesk-var.woff2`,
OFL-licensed (licence committed alongside).** It is the display voice only — headlines, brand,
kickers, nav, buttons. Body copy stays on the system stack for speed and reading comfort. The
single latin file is 22KB and is preloaded from the document head.

**Self-hosted variable woff2 in `assets/fonts/`.** Not a system stack — the type *is* the design on
a site judged on craft, and a portfolio that renders in Segoe UI on one machine and SF on another
has no typographic identity. Not Google Fonts — a render-blocking third-party request, a privacy
leak on a site whose video embeds were deliberately made privacy-friendly, and a live external
dependency that contradicts "still builds in five years with nothing but Node and a browser".

Subsetting is a **one-time authoring step performed outside the build**, exactly like exporting a
JPEG. The committed `.woff2` is an asset; `build.mjs` never needs a font tool. Faces must be
OFL-licensed to live in a public repo.

Kill the swap shift with a metric-adjusted fallback — pure CSS, no dependency:

```css
@font-face {
  font-family: 'Text Fallback';
  src: local('Arial'), local('Helvetica'), local('Liberation Sans');
  size-adjust: 107%; ascent-override: 90%; descent-override: 22.5%; line-gap-override: 0%;
}
```

Those four numbers **must be measured against the real face**, not guessed. Until the real face
ships, the stack falls back to `system-ui` and the overrides are commented out — a wrong override is
worse than none.

Preload only the text face: `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
`crossorigin` is required even same-origin, or the font is fetched twice.

---

## Spacing, radii, motion

```css
--space-3xs:.25rem  --space-2xs:.5rem  --space-xs:.75rem  --space-s:1rem
--space-m:1.5rem    --space-l:2.5rem   --space-xl:4rem    --space-2xl:6rem
--space-section: clamp(3.5rem, 2rem + 6vw, 8rem);
--gutter:        clamp(1rem, 0.6rem + 2vw, 2.5rem);

--radius-sm:4px --radius-md:10px --radius-lg:18px --radius-full:999px

--dur-fast:120ms --dur:220ms --dur-slow:420ms
--ease-out: cubic-bezier(.2,.8,.2,1);  --ease-in-out: cubic-bezier(.4,0,.2,1);
```

All three durations collapse to `.01ms` under `prefers-reduced-motion: reduce`, together with a
global `*` override for animation, transition and `scroll-behavior`.

---

## Layout primitives

```css
.l-container { width: min(100% - var(--gutter)*2, var(--measure-wide)); margin-inline: auto; }
.l-stack > * + * { margin-block-start: var(--stack-space, var(--space-m)); }
.l-grid { display:grid; gap: var(--gap, var(--space-l));
          grid-template-columns: repeat(auto-fit, minmax(min(var(--col-min, 22rem), 100%), 1fr)); }
.l-cluster { display:flex; flex-wrap:wrap; gap: var(--gap, var(--space-2xs)); align-items:center; }
```

`minmax(min(var(--col-min), 100%), 1fr)` is the detail that stops `auto-fit` grids overflowing on
narrow viewports. Do not simplify it to `minmax(22rem, 1fr)`.

Full-bleed inside a contained page uses a named-line grid (`full` / `content`) rather than negative
margins or `100vw`, which causes horizontal overflow when a scrollbar is present.

---

## Components

`skip-link`, `site-header` + `site-nav`, `hero`, `embed`, `film-entry`, `film-card` + `film-grid`,
`meta-list` (`<dl>` for credits), `chip`, `laurel-row` + `laurel`, `process-step` (`<ol>`),
`service-card`, `callout`, `btn` (`--primary`, `--ghost`), `prose`, `site-footer`, `placeholder`.

### `placeholder` is first-class, not an afterthought

```css
.placeholder {
  display:grid; place-items:center; min-height:8rem;
  border:2px dashed var(--c-line-strong); border-radius: var(--radius-md);
  color: var(--c-text-muted); font-family: ui-monospace, monospace;
  font-size: var(--step--1); text-align:center; padding: var(--space-m);
}
```

It renders `MISSING: poster for the-long-quiet`. Making the gap visually loud is what stops
"never invent facts" from quietly decaying into invented copy.

### Video embed

Facade: poster + play control, iframe injected only on activation. The box is reserved with
`aspect-ratio` before the poster loads, so CLS is zero on a page with a dozen films.

```css
.embed__frame { position:relative; aspect-ratio: var(--embed-ratio, 16/9); overflow:hidden;
                border-radius: var(--radius-md); background: var(--c-bg-elev-2); }
.embed__poster, .embed__iframe { position:absolute; inset:0; width:100%; height:100%; }
.embed__poster { object-fit:cover; }
.embed__iframe { border:0; }
```

`--embed-ratio` is the **only** place content data reaches a `style` attribute. It is regex-gated in
the validator and re-asserted by the audit.

**Portrait films (9:16 — Shorts).** When the parsed ratio is taller than wide, `embed()` adds
`embed--portrait` and the entry gets `film-entry--portrait`. Uncapped, a 9:16 frame in a 46rem
column stands over 1200px tall. Instead the frame caps at `max-width: 21rem` (centred on mobile),
the play icon steps down a size, and at ≥60rem the entry grid inverts to
`minmax(0, 21rem) minmax(0, 1fr)` with the copy vertically centred — narrow column for the film,
wide one for the words. The first-child "statement" layout is overridden for portrait entries so a
vertical film opening the page does not run full width.

---

## Focus

```css
:focus-visible { outline:2px solid var(--c-focus); outline-offset:3px; border-radius:inherit; }
:target { scroll-margin-block-start: calc(var(--header-h) + var(--space-l)); }
```

`outline: none` without a replacement is **banned** and grep-tested in `test/`.

---

## Motion policy

Reduced motion targets **incidental, unrequested** motion. It does not mean "don't play the video
the user just clicked."

| Behaviour | Under `reduce` |
|---|---|
| User clicks play → `autoplay=1` in the iframe | **Unchanged.** User-initiated. |
| Hover video preview | **Never shipped** — would need self-hosted video, which the rules forbid. |
| Autoplaying hero reel | **Never shipped**, same reason. Hero is a still + play facade. |
| Scroll reveal, parallax | Suppressed by the global block; the JS never runs. |
| Hover scale, focus transitions | Collapsed to `.01ms`. |

### The motion system that shipped

- **Scroll reveal** — film entries, cards, founders, steps and section headings fade-rise 18px with
  a 70ms sibling stagger. The `.reveal` class is added by `main.js` only: with JS off or under
  `prefers-reduced-motion` nothing is ever hidden. Elements already in the viewport at load are
  skipped — reveals are for content that scrolls in, never a curtain over first paint.
- **Gradient ink** — one word of the hero headline (`[[…]]` in content) carries a slow 14s
  drifting warm gradient. Solid amber fallback without `background-clip: text` support; solid
  `CanvasText` under forced colors; frozen under reduced motion.
- **Hover** — cards lift 4px with an amber-tinted shadow, posters scale 1.045 and brighten,
  the play button gains a glow ring, primary buttons run a single sheen sweep, nav links grow a
  1px amber underline. All transform/opacity/background-size — nothing that triggers layout.
- **Ambient** — a static two-point radial glow behind the home hero. No animation, no texture
  loops; depth comes from light, not movement.
