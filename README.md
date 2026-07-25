# Nitish Jain — Filmmaker

Portfolio site. Narrative shorts, brand films and animation.

Static HTML, CSS and vanilla JS. **No framework, no bundler, no dependencies.** Node runs one
generator script; the output is committed and served free by GitHub Pages.

---

## Run it

```bash
node build.mjs                 # regenerate all HTML from content/
python3 -m http.server 8000    # preview at localhost:8000
```

There is no install step. There is no `package.json`, so there is nothing to `npm install`.

| Command | Does |
|---|---|
| `node build.mjs` | Build. Draft films are excluded. |
| `node build.mjs --drafts` | Include drafts, to preview layout locally. **Never commit this output.** |
| `node build.mjs --check` | Build, then rebuild at a probe base to catch hardcoded paths. |
| `node build.mjs --strict` | Promote warnings to errors. Use once the content is complete. |
| `node --test` | Markup and accessibility assertions over the generated HTML. |

Slash commands for Claude Code live in `.claude/commands/`: `/build-site`, `/add-film`,
`/new-page`, `/check`, `/deploy`.

---

## How it works

Content lives in JSON. HTML is generated. Never the other way round.

```
content/site.json      identity, copy, services, process steps, laurels
content/films.json     the films
content/process.json   the four craft breakdown clips
        ↓
   build.mjs           the generator; page templates live here
        ↓
   *.html + sitemap.xml + robots.txt + llms.txt
```

**Never edit the generated `.html` files** — they are overwritten on every build. Change content in
`content/*.json`. Change structure or markup in `build.mjs`.

Safe to hand-edit: `content/*.json`, `assets/css/style.css`, `assets/js/main.js`, `build.mjs`,
`docs/*`, `CLAUDE.md`.

---

## Adding a film

1. Upload it to YouTube (Unlisted is fine) or Vimeo. **Not** to this repo — video is never hosted here.
2. Cut a poster: `./scripts/make-posters.sh media/<file> <film-id> <timestamp>`
3. Add an entry to `content/films.json` with the **bare video ID**, not a pasted URL.
4. Set `"status": "published"` when it is ready.
5. `node build.mjs`, then commit both the JSON and the regenerated HTML.

The validator catches a pasted URL and tells you the exact ID to use. Full field reference:
`docs/03-CONTENT-MODEL.md`. Upload steps: `docs/06-MEDIA-PIPELINE.md`.

---

## Deploying

Generated HTML is committed and Pages serves it from the branch, so `git push` is the deploy.
**Always run `node build.mjs` before committing** — a content edit without a rebuild ships nothing.

Live at `https://argaurshar.github.io/aifilmmaking-portfolio/`. Setup and the custom-domain path
are in `docs/07-DEPLOY.md`.

---

## Docs

| File | Covers |
|---|---|
| `docs/01-BUILD-SPEC.md` | File tree, generator design, every page section by section |
| `docs/02-DESIGN-SYSTEM.md` | Colour, type, spacing, components, motion policy |
| `docs/03-CONTENT-MODEL.md` | The three JSON schemas |
| `docs/04-VOICE.md` | Copy rules with before/after examples |
| `docs/05-SEO-SPEC.md` | Schema markup, llms.txt, robots.txt, AI citability |
| `docs/06-MEDIA-PIPELINE.md` | Video handling, scripts, ffmpeg recipes |
| `docs/07-DEPLOY.md` | GitHub Pages, custom domain, pre-flight |

> The seven `docs/` files are **reconstructed** — the originals were not supplied. Each is marked at
> the top. Replace any of them with the original and rebuild.

---

## What the site also ships

The machine-readable layer that almost no filmmaker portfolio has: `Person` and `VideoObject`
schema, `ItemList`, `BreadcrumbList`, a sitemap, an `llms.txt`, and a `robots.txt` that explicitly
welcomes GPTBot, ClaudeBot and PerplexityBot. That is what makes the site citable when someone asks
an AI assistant for filmmakers.

Films embed behind a lite facade — a poster and a play control, with the iframe injected only on
click — so a Work page with a dozen films loads zero iframes until someone actually wants to watch.
