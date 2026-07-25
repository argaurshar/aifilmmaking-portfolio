# 06 — Media Pipeline

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

How video gets from a master file to the site.

---

## The rule that shapes everything

**Video is never hosted from this repo.** GitHub caps files at 100 MB, Pages caps the whole site at
1 GB with a 100 GB/month soft bandwidth limit, and a `.mp4` served from Pages does not
range-request properly, so it will not scrub. Films go to YouTube or Vimeo; the site embeds by ID.

`media/` is gitignored and must never reach a commit. `build.mjs` does not read it and does not
need it.

**The scripts are for Nitish's own uploads only.** If asked to pull third-party content, decline
and say why.

---

## The flow

```
master.mov  ──▶  YouTube / Vimeo  ──▶  video ID  ──▶  content/films.json
     │
     └──▶ scripts/make-posters.sh ──▶ assets/stills/<id>-{960,1440,1920}.jpg ──▶ committed
```

Posters are cut from the local master, so **the grid looks right before anything is uploaded.** You
do not have to wait for a platform to generate a thumbnail, and you are not stuck with the frame it
picked.

---

## Uploading

Either platform works; the content model supports both per film.

**YouTube** — better discovery, better SEO, free. Use **Unlisted** for unreleased work: it is
embeddable but not indexed and not on your channel page. Do not use Private — private videos cannot
be embedded at all, which is the single most common way this breaks.

**Vimeo** — cleaner player, no suggested-video clutter at the end, the industry norm for reels. Free
tier has a weekly upload cap. Unlisted videos get a **hash** in the URL (`vimeo.com/123456789/abc123def`)
— that hash goes in the `hash` field, not glued onto the ID. Without it the embed 404s.

Then add the film to `content/films.json`:

```jsonc
"video": { "platform": "youtube", "id": "dQw4w9WgXcQ", "hash": null, "startAt": null }
```

The **bare ID**, never a pasted URL. If you paste a URL the validator will catch it and tell you
the exact ID to use.

| Platform | Where the ID is |
|---|---|
| `youtube.com/watch?v=**dQw4w9WgXcQ**` | after `v=`, 11 chars |
| `youtu.be/**dQw4w9WgXcQ**` | the path |
| `youtube.com/shorts/**dQw4w9WgXcQ**` | the path |
| `vimeo.com/**123456789**` | the path |
| `vimeo.com/**123456789**/**abc123def**` | id, then hash |

---

## Posters

Naming convention, which the generator relies on:

```
assets/stills/<film-id>-960.jpg
assets/stills/<film-id>-1440.jpg
assets/stills/<film-id>-1920.jpg
```

`build.mjs` **probes which of the three exist** and builds `srcset`/`sizes` from whatever it finds —
a complete responsive-images story with zero build tooling. One file is enough to start; add the
others later and the build picks them up with no content edit.

`poster.src` in `films.json` points at the **largest** one.

Pick a frame that reads at thumbnail size: a face, a strong silhouette, one clear subject. Avoid a
frame mid-camera-move, and avoid your title card — the title is already next to it in the markup.

Budget: keep each JPEG under 300 KB. The build fails past that. Twelve 400 KB stills is a 5 MB page
and no dependency here can resize them for you.

---

## `scripts/make-posters.sh`

```bash
./scripts/make-posters.sh media/the-long-quiet.mov the-long-quiet 00:01:23
```

Cuts the frame at the given timestamp to all three widths with `ffmpeg`, writes into
`assets/stills/`, and prints the resulting file sizes. Requires `ffmpeg` on your machine — it is
**not** a build dependency, and `node build.mjs` never invokes it.

The relevant recipe, if you would rather run it by hand:

```bash
ffmpeg -ss 00:01:23 -i master.mov -frames:v 1 -vf "scale=1920:-2:flags=lanczos" -q:v 3 out-1920.jpg
```

`-ss` **before** `-i` seeks fast; `-2` keeps the height even; `-q:v 3` is a good quality/size point
for stills.

---

## `scripts/fetch-media.sh`

```bash
./scripts/fetch-media.sh https://vimeo.com/123456789
```

Pulls one of **your own** uploads into `media/` with `yt-dlp`, for re-editing or for cutting posters
when you no longer have the master. Refuses to write anywhere except `media/`.

---

## Aspect ratios

Set `aspectRatio` on any film that is not 16:9. Vertical is `9:16`, cinemascope `2.39:1`, 4:3 `4:3`.

If it is absent the build assumes 16:9 **and warns**, because silently letterboxing a vertical film
is worse than a noisy build.

---

## Checklist per film

1. Upload to YouTube (Unlisted) or Vimeo. Copy the ID — and the hash, if Vimeo unlisted.
2. Cut a poster: `./scripts/make-posters.sh media/<file> <film-id> <timestamp>`
3. Add the entry to `content/films.json`, or run `/add-film`.
4. Set `"status": "published"` when it is ready to be public.
5. `node build.mjs` and check the warnings.
