# CLAUDE.md

Project memory and build instructions for Claude Code.

---

## The project

Personal portfolio site for **Gaurav Sharma**, AI filmmaker. Narrative shorts, brand films and animation made with generative video tools.

Two audiences, one site:

- **Studios and production houses** judging craft → served by Work and Process
- **Clients looking to hire** → served by Hire

Everything else is in service of those two.

**Stack:** static HTML, CSS and vanilla JS. No framework, no bundler, no runtime dependencies. Node is used only to run a generator script. Deploys to GitHub Pages.

---

## If the repo is empty, build it

Work through the phases below in order. Do not skip ahead. Finish and verify each phase before starting the next.

| Phase | Do this | Spec |
|---|---|---|
| 0 | Scaffold folders and config files | `docs/01-BUILD-SPEC.md` |
| 1 | Write the three content JSON files | `docs/03-CONTENT-MODEL.md` |
| 2 | Write `assets/css/style.css` | `docs/02-DESIGN-SYSTEM.md` |
| 3 | Write `assets/js/main.js` | `docs/02-DESIGN-SYSTEM.md` |
| 4 | Write `build.mjs`, the generator | `docs/01-BUILD-SPEC.md` + `docs/03-CONTENT-MODEL.md` |
| 5 | Add SEO and machine files to the generator | `docs/05-SEO-SPEC.md` |
| 6 | Write the media scripts | `docs/06-MEDIA-PIPELINE.md` |
| 7 | Run `node build.mjs` and verify | `.claude/commands/check.md` |
| 8 | Prepare for deploy | `docs/07-DEPLOY.md` |

Report at the end of each phase in one line. Do not narrate every file write.

When the build finishes, tell Gaurav exactly what is still needed from him: video IDs, social URLs, his real GitHub Pages URL, and the About copy.

---

## How the site works

Content lives in JSON. HTML is generated. Never the other way round.

```
content/site.json      identity, copy, services, process steps, laurels
content/films.json     the films
content/process.json   the four craft breakdown clips
        ↓
   build.mjs           the generator, page templates live here
        ↓
   *.html + sitemap.xml + robots.txt + llms.txt
```

**Never edit the generated `.html` files.** They are overwritten on every build. Change content in JSON. Change structure or markup in `build.mjs`.

Safe to hand-edit: `content/*.json`, `assets/css/style.css`, `assets/js/main.js`, `build.mjs`, `docs/*`, this file.

---

## Commands

```bash
node build.mjs                 # regenerate all HTML from content/
python3 -m http.server 8000    # preview at localhost:8000
```

No install step, no test suite, no linter. If a change would need one, ask first.

Slash commands live in `.claude/commands/`: `/build-site`, `/add-film`, `/new-page`, `/check`, `/deploy`.

---

## Non-negotiables

These hold for every task in this repo.

1. **Zero dependencies.** No framework, no bundler, no npm package. The site must still build in five years with nothing but Node and a browser.
2. **Never edit generated HTML.** Edit JSON or `build.mjs`.
3. **Never host video from this repo.** Always embed from YouTube or Vimeo. `media/` is gitignored and must never reach a commit.
4. **Never fetch video Gaurav did not create.** The media scripts are for his own uploads. If asked to pull third-party content, decline and say why.
5. **Never invent facts.** No made-up film titles, credits, client names, festival selections or testimonials. If content is missing, leave the placeholder and say what is needed.
6. **Never lead with the AI angle.** The films come first. AI is how they were made, not what they are. No tool logos, no "made with AI" badges.
7. **Follow the voice rules** in `docs/04-VOICE.md` for any copy you write.
8. **Accessibility is not optional.** Semantic landmarks, focus states, alt text, keyboard-operable players, respect `prefers-reduced-motion`.

---

## Reference docs

| File | What it covers |
|---|---|
| `docs/01-BUILD-SPEC.md` | File tree, every page, section by section |
| `docs/02-DESIGN-SYSTEM.md` | Colour, type, spacing, components, JS behaviour |
| `docs/03-CONTENT-MODEL.md` | JSON schemas and field meanings |
| `docs/04-VOICE.md` | Copy rules and worked examples |
| `docs/05-SEO-SPEC.md` | Schema markup, llms.txt, robots.txt, AI citability |
| `docs/06-MEDIA-PIPELINE.md` | Video handling, scripts, ffmpeg recipes |
| `docs/07-DEPLOY.md` | GitHub Pages, custom domain, pre-flight checks |

Read the relevant doc before starting a phase. Do not guess at values that are specified there.
