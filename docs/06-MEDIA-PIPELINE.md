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

`build.mjs` **reads the directory** and builds `srcset` from every `<film-id>-<width>` sibling it
finds, whatever the widths — so a portrait still at 640/810/1080 works exactly like a landscape one
at 960/1440/1920, and a 335px source can honestly ship as `-335.jpg` rather than lie about its size.
One file is enough to start; add others later and the build picks them up with no content edit.

**No JSON edit is needed.** Leave `poster` as `null` and the generator finds
`assets/stills/<film-id>-1920.jpg` by filename. Set `poster.src` explicitly only to point somewhere
that breaks the convention.

Pick a frame that reads at thumbnail size: a face, a strong silhouette, one clear subject. Avoid a
frame mid-camera-move, and avoid your title card — the title is already next to it in the markup.

Budget: aim under 300 KB per JPEG. Past that the build **warns** but still succeeds — an oversized
upload should never block a deploy. Twelve 400 KB stills is a 5 MB page, so shrink them when you
can; `scripts/make-posters.sh` does it in one command.

---

## Frame strips — the hover-scrub

```
assets/strips/<film-id>.jpg
```

N stills of the film laid side by side in one JPEG. On a pointer device, moving across the film's
poster slides the strip so the frame under the cursor shows — the poster plays, and not a byte of
video is hosted. The build finds the file by name and reads the frame count off the image's own
proportions (a 16:9 strip of 24 frames is 24 × 16/9 as wide as it is tall), so no JSON edit is
needed. Each frame is 320px on its long edge; a 24-frame strip is around 150–300 KB and is fetched
on first hover, never on load. Without a strip the poster simply stands.

```bash
./scripts/make-posters.sh --strip media/ramayana.mov ramayana        # 24 frames
./scripts/make-posters.sh --strip media/ramayana.mov ramayana 36     # or any count
```

---

## `scripts/make-posters.sh`

```bash
./scripts/make-posters.sh media/the-long-quiet.mov the-long-quiet 00:01:23   # from a master
./scripts/make-posters.sh ~/Desktop/frame.png qutub-minar                     # from a still
./scripts/make-posters.sh --strip media/ramayana.mov ramayana                 # a frame strip
```

Detects orientation and emits the right ladder (960/1440/1920 landscape, 640/810/1080 portrait),
never upscaling and never naming a file for a width it does not have. Takes a still as readily as
a master — a screenshot of a paused Short is the realistic source for a vertical film. Writes into
`assets/stills/` and prints sizes. Requires `ffmpeg` on your machine — it is **not** a build
dependency, and `node build.mjs` never invokes it.

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
