---
description: Add a page the correct way, through the generator
---

Add a new page for $ARGUMENTS.

Never create an `.html` file by hand — generated HTML is overwritten on every build.

1. Add any new copy to `content/site.json` under `pages.<id>`.
2. Add a `render(ctx)` function in `build.mjs` returning a page descriptor
   (`id`, `title`, `description`, `ogImagePath`, `jsonLd`, `body`).
3. Add one entry to the `PAGES` registry. That registry drives both rendering and `sitemap.xml`,
   so the page cannot end up missing from the sitemap.
4. Add it to `site.nav` if it belongs in the header.
5. Run `node build.mjs` and then `/check`.
