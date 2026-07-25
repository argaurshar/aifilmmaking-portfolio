# 05 — SEO Spec

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

The machine-readable layer. This is what makes the site citable when someone asks an AI assistant
for filmmakers, and it is the part almost no filmmaker portfolio has.

---

## Per-page head

Every page, no exceptions:

```html
<title>…</title>
<meta name="description" content="…">          <!-- ≤ 160 chars, validated -->
<link rel="canonical" href="{absUrl(page.path)}">
<meta property="og:type" content="website">     <!-- video.other on index -->
<meta property="og:title" …> <meta property="og:description" …>
<meta property="og:url" …>                      <!-- absolute, equals canonical -->
<meta property="og:site_name" …> <meta property="og:locale" …>
<meta property="og:image" …>                    <!-- absolute -->
<meta property="og:image:width" …> <meta property="og:image:height" …>
<meta property="og:image:alt" …>
<meta name="twitter:card" content="summary_large_image">
```

Canonical is what stops `argaurshar.github.io/aifilmmaking-portfolio/` and a future custom domain
competing with each other. When the origin changes, every canonical changes in one place.

`twitter:*` beyond `twitter:card` is **omitted** — X falls back to OG for title, description and
image, and duplicated metadata is duplicated drift. `twitter:card` has no OG equivalent, so it is
emitted explicitly.

### OG images

Resolution order: `page.ogImagePath` → featured film's poster → `site.ogImage`.

**Not generated at build time.** With zero dependencies you can only emit SVG, and Facebook, X,
Slack, iMessage and LinkedIn all decline to render SVG for `og:image`. Dead end. Use committed
JPEGs. The build **hard-fails** if the resolved OG image is missing from disk or smaller than
1200×630.

Stills are 16:9 (1.78) against OG's preferred 1.91:1 — a minor top-and-bottom crop. Known trade,
documented here so it is not a surprise.

### Index only

`og:type = video.other` plus `og:video:url`, `og:video:secure_url`, `og:video:type`,
`og:video:width`, `og:video:height` for the featured film. This produces an inline player in X and
Facebook cards, which is worth a lot for a film portfolio.

---

## JSON-LD

One `<script type="application/ld+json">` per page containing
`{"@context":"https://schema.org","@graph":[…]}`.

**It is unicode-escaped, not HTML-escaped.** `<script>` is a raw-text element; HTML-escaping inside
it is the classic hand-rolled-generator bug and produces literal `&quot;` in the JSON. Escape `<`,
`>`, `&`, U+2028 and U+2029 as `\uXXXX`. The audit asserts no `</` survives inside any script body.

### `Person` — full node on About, referenced by `@id` elsewhere

```json
{ "@type": "Person",
  "@id": "{origin}{base}about.html#person",
  "name": "…", "url": "{origin}{base}", "jobTitle": "Filmmaker",
  "description": "…", "image": "…absolute…", "sameAs": ["…socials…"],
  "knowsAbout": ["Directing","Editing","Narrative short film","Brand film","Animation"] }
```

`jobTitle` is **"Filmmaker"**, not "AI filmmaker". Rule 6 applies to structured data too — this is
the single place it is most likely to be forgotten, because nobody reads it.

### `WebSite` — index only

`@id: {origin}{base}#website`, `publisher` → the Person `@id`.

### `VideoObject` — one per film

Emitted on Work (all published films) and Index (featured only).

```json
{ "@type": "VideoObject",
  "@id": "{origin}{base}work.html#film-{id}",
  "name": "…", "description": "{logline}",
  "thumbnailUrl": ["…absolute…"],
  "uploadDate": "2026-03-01",        // OMITTED when `published` is absent
  "duration": "PT6M52S",             // OMITTED when `runtimeSeconds` is absent
  "embedUrl": "https://www.youtube-nocookie.com/embed/{id}",
  "url": "{origin}{base}work.html#film-{id}",
  "genre": "Narrative short", "inLanguage": "en",
  "creator": { "@id": "…#person" }, "director": { "@id": "…#person" } }
```

**`contentUrl` is never emitted.** The files are not hosted here, and claiming otherwise is both
false and a rich-result validation failure.

Google requires `name`, `description`, `thumbnailUrl` and `uploadDate` for video rich results. When
`published` is absent the build warns **by name** — "`the-long-quiet` will not be eligible for video
rich results: no `published` date" — rather than fabricating a date.

### Also

- `ItemList` on Work, enumerating films in display order.
- `BreadcrumbList` on inner pages.
- `Person.makesOffer[]` → `Offer` → `Service` on Hire. `priceSpecification` is **omitted entirely**
  when `startingAt` is null — never `"price": "0"`, which reads as free.

---

## `sitemap.xml`

Generated from the same `PAGES` registry that drives rendering, so a page cannot be built but left
out. `loc` via `absUrl()`. `lastmod` from content dates — `site.updated`, or the newest `published`
across films for Work.

**No `changefreq` and no `priority`.** Google has ignored both for years; they are noise.

XML-escaped through a **separate** escaper (`& < > " '`), never the HTML one.

---

## `robots.txt`

```
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /

Sitemap: {origin}{base}sitemap.xml
```

**Caveat the build prints, rather than papering over:** `robots.txt` is only honoured at the
**origin root**. At `argaurshar.github.io/aifilmmaking-portfolio/robots.txt` it is not the origin's
robots file — `argaurshar.github.io/robots.txt` is, and that path belongs to a different repo. In
practice a 404 there is treated as "allow all", which is the desired outcome anyway. Generate the
file regardless: it costs nothing, documents intent, and becomes authoritative the day a custom
apex domain lands.

---

## `llms.txt`

Markdown, generated from the same content so it cannot drift from the site.

```
# Gaurav Sharma — Filmmaker

> Narrative shorts, brand films and animation.

## Work
- [Title (2026, narrative short)]({url}): {logline}

## Process
- [Blocking a scene]({url}): {first sentence of summary}

## Services
- {title}: {summary}

## Contact
- Email: …
- Site: …
```

No AI-tooling framing anywhere in it. This file is the most likely place for it to leak back in,
because it reads like a spec sheet — the lint pass covers it.

Same origin-root discovery caveat as `robots.txt`. One `llms.txt` is enough; per-page `.md` mirrors
are redundant when the HTML is already semantic and JSON-LD annotated.

---

## Citability checklist

What actually gets a site quoted by an assistant, in rough order of impact:

1. Plain, factual sentences near the top of each page. Loglines are ideal — they are already
   one-sentence answers.
2. Correct `VideoObject` per film with a real thumbnail.
3. A `Person` node with `sameAs` links that corroborate identity across platforms.
4. `llms.txt` for a fast, unambiguous summary.
5. `robots.txt` that does not block AI crawlers.
6. Semantic HTML — one `<h1>`, real headings, real lists.

Marketing language actively hurts here: it is unquotable. Another reason the voice rules matter.
