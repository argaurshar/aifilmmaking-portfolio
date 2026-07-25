# Portfolio Site Build Kit

Instruction files for Claude Code. Drop this into an empty folder, open it in VS Code, and Claude Code builds the whole site.

---

## Use it

1. Put these files in an empty folder
2. Open the folder in VS Code
3. Open Claude Code
4. Type `/build-site`

It reads `CLAUDE.md`, works through the specs in `docs/`, and produces the complete site. Takes a few minutes.

Then tell it what to fill in:

```
/add-film The Long Way Home, 2026, 1:32, narrative short,
a woman returns to a demolished house and finds it standing,
https://youtube.com/watch?v=YOUR_ID
```

---

## What is here

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project memory. Claude Code reads this automatically every session. |
| `docs/01-BUILD-SPEC.md` | File tree, generator design, every page section by section |
| `docs/02-DESIGN-SYSTEM.md` | Exact colours, type scale, components, JS behaviour |
| `docs/03-CONTENT-MODEL.md` | The three JSON schemas |
| `docs/04-VOICE.md` | Copy rules with worked before and after examples |
| `docs/05-SEO-SPEC.md` | Schema markup, llms.txt, robots.txt, AI citability |
| `docs/06-MEDIA-PIPELINE.md` | Video handling, scripts, ffmpeg recipes, the reel structure |
| `docs/07-DEPLOY.md` | GitHub Pages, custom domain, pre-flight |

---

## Commands

| Command | Does |
|---|---|
| `/build-site` | Builds everything from scratch, eight phases |
| `/add-film` | Adds a film and rebuilds |
| `/new-page` | Adds a page the correct way, through the generator |
| `/check` | Full verification pass |
| `/deploy` | Pre-flight then push to GitHub Pages |

---

## What it produces

A five-page static site. Index, Work, Process, Hire, About. Dark and typographic, video-forward, no framework and no dependencies.

Content lives in three JSON files. One Node script generates the HTML. Adding a film is a JSON edit and one command.

It also generates the machine-readable layer that almost no filmmaker portfolio has: Person and VideoObject schema, a sitemap, an `llms.txt`, and a `robots.txt` that explicitly welcomes GPTBot, ClaudeBot and PerplexityBot. That is what makes the site citable when someone asks an AI assistant for AI filmmakers.

---

## You will need

Node, to run the generator. Git, to deploy. That is all.

For the media scripts, `yt-dlp` and `ffmpeg`, but only when you want to pull your own films down for editing.

---

## Editing the kit

The docs are the source of truth. If you want a different colour, change it in `docs/02-DESIGN-SYSTEM.md` rather than in the generated CSS, then ask Claude Code to rebuild. Same for structure, voice and anything else.

Keep `CLAUDE.md` lean. It loads into every conversation, so detail belongs in `docs/` where it is read on demand.
