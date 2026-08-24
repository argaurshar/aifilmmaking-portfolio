# 03 — Content Model

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

Three JSON files. They are the only place content lives.

**Rule that governs everything below: absent optional fields omit output. They never invent it.**

**No markup in content.** The validator rejects any string containing `<` or `>`. For emphasis use
the inline micro-markup: `[[emphasis]]` → accent `<em>`, `**strong**` → `<strong>`. It is compiled
*after* HTML escaping, so it cannot inject markup.

---

## `content/site.json`

```jsonc
{
  "site": {
    "origin": "https://argaurshar.github.io",  // no trailing slash; SITE_ORIGIN env overrides
    "title": "Nitish Jain — Filmmaker",
    "description": "…",                        // ≤ 160 chars, validated
    "locale": "en",
    "updated": "2026-07-25",                   // ISO date; drives sitemap lastmod
    "ogImage": "assets/og/nitish-jain-card-v2.jpg"         // BASE-relative, NO leading slash
  },
  "identity": {
    "name": "Nitish Jain",
    "role": "Filmmaker",                       // NOT "AI filmmaker" — see 04-VOICE
    "tagline": "…",                            // supports [[emphasis]]
    "location": null,
    "shortBio": ["…"],                         // array of paragraphs
    "longBio": ["…"],
    "portrait": { "src": "assets/portrait.jpg", "alt": "…" }   // or null
  },
  "contact": {
    "email": "…",                              // required
    "responseTime": null,                      // e.g. "Usually within two days"
    "availability": null
  },
  "social": [{ "label": "Vimeo", "url": "https://vimeo.com/…" }],
  "nav": [{ "label": "Work", "path": "work.html" }, …],
  "pages": {
    "index":    { "heroKicker": "…", "heroHeadline": "…", "heroSub": ["…"], "metaDescription": "…" },
    "work":     { "heading": "…", "intro": ["…"], "metaDescription": "…", "emptyState": "…" },
    "process":  { "heading": "…", "intro": ["…"], "metaDescription": "…" },
    "hire":     { "heading": "…", "intro": ["…"], "metaDescription": "…" },
    "about":    { "heading": "…", "metaDescription": "…" },
    "notFound": { "heading": "…", "body": ["…"] }
  },
  "services": [{
    "id": "narrative", "title": "…", "summary": "…",
    "deliverables": ["…"], "timeline": null, "startingAt": null, "order": 10
  }],
  "processSteps": [{ "n": 1, "title": "…", "body": ["…"] }],
  "laurels": [{
    "id": "…", "festival": "…", "award": "Official Selection",
    "year": 2026, "filmId": null, "url": null, "image": null   // image null → text-only chip
  }],
  "credits": []                                // About page. Real credits only. May be [].
}
```

`basePath` deliberately does not appear — it comes from the `BASE_PATH` env var.

---

## `content/films.json`

```jsonc
{
  "films": [{
    "id": "the-long-quiet",            // REQ, ^[a-z0-9]+(-[a-z0-9]+)*$, unique
    "title": "The Long Quiet",         // REQ, ≤ 120
    "year": 2026,                      // REQ, int 2000–2100
    "type": "narrative-short",         // REQ, enum below
    "logline": "…",                    // REQ, ≤ 200, one sentence
    "roles": ["Director", "Editor"],   // REQ, ≥ 1
    "video": {                         // REQ
      "platform": "youtube",           //   "youtube" | "vimeo"
      "id": "dQw4w9WgXcQ",             //   BARE ID, never a URL
      "hash": null,                    //   Vimeo unlisted only; rejected for youtube
      "startAt": null                  //   seconds
    },
    "poster": null,                    // OPT — see auto-detection below

    "runtimeSeconds": 412,             // OPT
    "synopsis": ["…"],                 // OPT, array of paragraphs
    "client": null,                    // REQUIRED iff type === "brand-film"; else must be null
    "collaborators": [{ "name": "…", "role": "Composer" }],   // OPT
    "laurels": ["berlin-shorts-2026"], // OPT, ids into site.laurels
    "aspectRatio": "16:9",             // OPT, ^\d+(\.\d+)?:\d+(\.\d+)?$
    "featured": true,                  // OPT, default false
    "order": 10,                       // OPT, default 1000
    "status": "published",             // OPT, default "published"; "draft" is excluded from output
    "published": "2026-03-01"          // OPT, ISO date
  }]
}
```

**`type` enum:** `narrative-short`, `brand-film`, `animation`, `music-video`, `documentary`,
`experimental`, `trailer`.

### Why `{ platform, id }` and not a URL

One ID derives five strings: the privacy embed URL, the no-JS watch URL, the JSON-LD `embedUrl`,
`og:video:url`, and the `llms.txt` link. Parsing once beats parsing five times. YouTube has six URL
shapes and Vimeo three. Share URLs carry `?si=` tracking params that would defeat the privacy
posture. And **Vimeo unlisted videos need a separate `h=` hash** that a naive URL parser drops
silently — breaking exactly the videos most worth gating.

The validator detects a pasted URL and tells you the exact ID to use instead.

### Staging a film before its ID is known

A **draft** may set `"video": { "platform": "youtube", "id": null }`. Everything else — title,
logline, runtime, order — is captured while the ID is still being copied off the platform. A film
with a null ID is held out of **every** build, `--drafts` included: there is nothing to embed, so
it never renders as a broken player. The build summary lists what is waiting. Fill in `video.id`
and flip `status` to `"published"` to release it. A published film with a null ID is an error.

### No authored image dimensions

`poster.width` / `height` do not exist. The generator reads intrinsic dimensions off disk, so they
cannot be mistyped or drift.

### Behaviour when an optional field is absent

| Absent | Generator does |
|---|---|
| `runtimeSeconds` | Runtime chip omitted; JSON-LD `duration` omitted. Never estimated. |
| `synopsis` | The whole `<details>` block is dropped — no empty heading. |
| `poster` | Auto-detected from `assets/stills/<id>-1920.jpg` (also `.jpeg`/`.png`, also the bare `<id>.<ext>`). If nothing is found: a quiet striped block, plus a build warning naming the exact file it wanted. The loud dashed `placeholder` shows for **drafts only** — nine of them on a client-facing page read as broken. Never a stock image, never a YouTube-hosted thumbnail. |
| `aspectRatio` | Defaults to `16:9` **with a warning**, so a vertical film is never silently letterboxed. A ratio taller than wide (`9:16` — Shorts) switches the entry to the portrait layout: the frame caps at 21rem and the copy takes the wide column. |
| `laurels` | Laurel row omitted. |
| `published` | JSON-LD `uploadDate` omitted, plus a named warning that the film loses video rich-result eligibility. |
| `order` | 1000. |
| `featured` | `false`. If **zero** films are featured the build fails — the homepage has no hero without one. |

### Sort order

`order` ascending → `year` descending → `id` ascending. Always explicit, never JSON key order.

---

## `content/process.json`

```jsonc
{
  "clips": [{
    "id": "blocking",                  // REQ, unique slug
    "order": 1,                        // REQ
    "title": "Blocking a scene",       // REQ
    "craft": "blocking",               // REQ, enum: blocking|lighting|continuity|edit-rhythm|sound|grade
    "summary": ["…"],                  // REQ, array of paragraphs
    "video": { … },                    // REQ, same shape as films
    "poster": { … },                   // REQ or explicit null
    "beats": [{ "label": "The problem", "body": "…" }],  // OPT
    "filmId": "the-long-quiet",        // OPT, validated against films.json
    "durationSeconds": 45,             // OPT
    "status": "published"              // OPT, default "published"
  }]
}
```

At least one clip is required. The build **warns** if the count is not four — a hard failure would
make adding a fifth an emergency.

---

## Referential integrity, enforced at build

- `films[].laurels[]` → `site.laurels[].id`
- `process.clips[].filmId` → `films[].id`
- `site.laurels[].filmId` → `films[].id`
- `films[].id` and `process.clips[].id` are unique within their file
- every referenced asset exists on disk, **case-exact**
