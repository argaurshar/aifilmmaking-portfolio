---
description: Add a film and rebuild
---

Add a film to `content/films.json` from the details in $ARGUMENTS, then run `node build.mjs`.

Expected: title, year, runtime, type, logline, and a video URL — in any order, comma separated.

Rules:
- Derive `id` as a slug of the title. It must be unique.
- Extract the **bare video ID** from the URL. Never store the URL. For an unlisted Vimeo link,
  put the trailing hash in `hash`, not glued to the id.
- `type` must be one of: narrative-short, brand-film, animation, music-video, documentary,
  experimental. Ask if it is ambiguous.
- Convert runtime to `runtimeSeconds`.
- `client` is required for a brand-film and must be null otherwise.
- **Never invent** a synopsis, credit, laurel or client. Omit the field or leave a clear TODO.
- Set `poster` to `assets/stills/<id>-1920.jpg` and remind Gaurav to cut it with
  `scripts/make-posters.sh` if it does not exist yet.
- Leave `status` as `draft` until he confirms it is ready to be public.

Then rebuild and report any warnings.
