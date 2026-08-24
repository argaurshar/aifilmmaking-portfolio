# 01 — Build Spec

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

File tree, generator design, and every page section by section.

---

## File tree

```
.
├── CLAUDE.md                 project memory
├── README.md
├── .gitignore                media/, node_modules/, .DS_Store
├── .nojekyll                 stops GitHub Pages running Jekyll over the output
├── build.mjs                 THE GENERATOR. Page templates live here.
├── content/
│   ├── site.json             identity, copy, services, process steps, laurels
│   ├── films.json            the films
│   └── process.json          the four craft breakdown clips
├── assets/
│   ├── css/style.css         hand-written, single file
│   ├── js/main.js            hand-written, single file
│   ├── fonts/*.woff2         self-hosted, OFL-licensed
│   ├── stills/               film posters: <film-id>-{960,1440,1920}.jpg
│   ├── process/              process clip posters
│   ├── laurels/              festival laurel SVGs
│   └── og/nitish-jain-card-v2.jpg        social share image, ≥ 1200×630
├── scripts/
│   ├── fetch-media.sh        yt-dlp — Nitish's own uploads only
│   └── make-posters.sh       ffmpeg — cut stills from local masters
├── test/build.test.mjs       node --test, asserts over generated HTML
├── docs/                     these specs
├── .claude/commands/         slash commands
├── package.json              NO dependencies — scripts and engines only
└── vercel.json               build command + headers for the Vercel deploy

GENERATED — never hand-edit:
  index.html work.html process.html hire.html about.html 404.html
  work-<type>.html            one per film type with ≥ 2 films
  sitemap.xml robots.txt llms.txt
```

**`package.json` declares no dependencies and no devDependencies.** `npm install` has nothing to
fetch, so the zero-dependency rule holds; it exists only to give `npm run build` / `npm test` as
conventional entry points and to stop tooling assuming the project is broken rather than
deliberately plain.

---

## The generator

Single file, `build.mjs`, plain ESM, Node ≥ 18. Sections in order:

| § | Section | Responsibility |
|---|---|---|
| 1 | `Html` + escaping | branded type, `html` tag, `text`, `inline`, `prose`, `attrs`, `unsafeHtml`, `jsonLdScript` |
| 2 | URLs | `normalizeBase`, `url`, `absUrl`, `extUrl` |
| 3 | Content loading | JSON parse with filename + line:column on error |
| 4 | Validation | declarative schema, aggregated errors, referential integrity |
| 5 | Lint | soft warnings: content gaps, voice violations |
| 6 | Assets | case-exact existence, image dimensions, `srcset` probing, SHA-256 hashing |
| 7 | Components | embed facade, film card, chip, laurel, placeholder, … |
| 8 | Layout | doctype, head, skip link, header, footer |
| 9 | Pages | one `render(ctx)` per page, returns a descriptor |
| 10 | SEO | JSON-LD builders, sitemap, robots, llms.txt |
| 11 | Audit | post-render hard failures |
| 12 | Pipeline | orchestration and writing |

### Pipeline

```
parseArgs → loadContent → validate (hard) → lint (soft) → buildAssets
  → renderAll (in memory) → audit (throws) → renderMachineFiles → writeAll
```

Nothing is written until every page has rendered **and** passed audit. A failed build never leaves
a half-written site.

### CLI

```bash
node build.mjs              # normal build; drafts excluded
node build.mjs --drafts     # include draft films, for local preview only
node build.mjs --check      # normal build + probe build at BASE_PATH=/__probe__/
node build.mjs --strict     # promote warnings to errors (use once content is complete)
```

### Base paths

`BASE` comes from the `BASE_PATH` env var, defaulting to `/aifilmmaking-portfolio/`. It is **not**
in JSON — a value in two places drifts.

Every internal URL goes through `url(path)`, which takes a BASE-relative path **with no leading
slash** and throws on a leading slash, an absolute URL, or a non-string. `absUrl()` prepends the
origin for canonical / OG / sitemap / JSON-LD. `extUrl()` allowlists `https: http: mailto: tel:`.

The helper only catches wrong *usage*. Forgetting it entirely is caught by the **audit**, which
scans every `href`, `src`, `srcset`, `poster`, and inline `style` URL and hard-fails on anything
not BASE-anchored. Because a `BASE` of `/` would mask a hardcoded `/assets/…`, `--check` re-runs
the whole build at `/__probe__/` where such a path fails loudly.

### Determinism

- Explicit sorts everywhere. Never rely on JSON key order.
- **No `new Date()` anywhere in output.** Dates come from content. A build-time timestamp makes
  every build differ and lies about content freshness.
- SHA-256 asset hashes for cache busting.
- Same input → byte-identical output.

### Failing loudly

`JSON.parse` errors are rethrown with filename and line:column. Validation **collects every error
before throwing**, sorted by JSON path, so one round of fixes clears them all. Exit code 1 on any
error; warnings always print.

---

## Pages

Every page: `<html lang>`, skip link, `<header>` with nav, `<main id="main" tabindex="-1">`,
`<footer>`. Exactly one `<h1>`.

### `index.html` — Index

1. **Hero.** Kicker, headline, sub-copy, and the featured film's embed facade. Primary CTA to Work,
   secondary to Hire. No autoplaying video.
2. **Selected work.** Three to four featured films as full-width entries. Link to Work.
3. **Process teaser.** One line on how the work gets made, link to Process.
4. **Services strip.** Titles only, link to Hire.
5. **Contact band.** Email, one line.

### `work.html` — Work

1. Page head: heading, intro.
2. Filter bar — real links to `work-<type>.html`, enhanced by JS into in-page filtering.
3. Film entries, full-width and stacked: embed facade, title, year, type, runtime, logline,
   laurels, and a `<details>` holding synopsis and credits. Each carries `id="film-<id>"` so
   `work.html#film-<id>` is a shareable deep link.
4. Empty state when no published films exist — honest, not fake.

### `process.html` — Process

1. Page head.
2. The four process steps from `site.json`, numbered, as an `<ol>`.
3. The four craft clips from `process.json`: embed facade, title, summary, beats, link to the
   parent film where `filmId` is set.

### `hire.html` — Hire

1. Page head with the offer in one line.
2. Service cards: title, summary, deliverables, timeline and starting price **only where supplied**.
3. How it works — the same four steps, compressed.
4. Contact band: `mailto:` link, response time if supplied, socials. **No form.**

### `about.html` — About

1. Page head, portrait if supplied.
2. Long bio.
3. Credits list — real credits only, may be empty.
4. Laurels.
5. Contact band.

### `404.html`

Heading, one line of copy, links back to Index and Work. Served by GitHub Pages for any missing
path at any depth — which is exactly why asset URLs must be BASE-anchored and not relative.

---

## Adding a page

Add a `render(ctx)` function and one entry to the `PAGES` registry. The registry drives both the
render loop and `sitemap.xml`, so a page cannot be built but left out of the sitemap.
