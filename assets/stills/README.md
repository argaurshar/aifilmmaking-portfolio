# Poster stills

Drop image files in here with the **exact filenames below** and `node build.mjs` picks them up
automatically. No JSON edit needed — the generator looks for `<film-id>-1920.jpg` for every film
that has no `poster` set in `content/films.json`.

`.jpg`, `.jpeg` and `.png` all work. `<film-id>.jpg` (no size suffix) works too.

## The nine files

| Filename | Film | The frame you sent |
|---|---|---|
| `the-architect-who-built-for-the-soul-1920.jpg` | The Architect Who Built for the Soul | Older man, glasses, holding a white architectural model |
| `the-beaver-who-had-no-crown-1920.jpg` | The Beaver Who Had No Crown | Orange beaver, wide eyes, peeking over a log |
| `trapped-alone-in-space-1920.jpg` | Trapped Alone in Space | Man in a worn jacket, red-lit ship corridor |
| `a-boy-drew-his-dream-on-a-ball-1920.jpg` | A Boy Drew His Dream on a Ball | Anime player mid-cheer, blue India jersey, stadium |
| `the-strike-1920.jpg` | The Strike | Soldier firing a rocket launcher, full moon, watchtower |
| `the-rakhi-that-never-breaks-1920.jpg` | The Rakhi That Never Breaks | Brother holding a blue gift box, sister in the doorway |
| `he-tried-to-escape-his-fear-1920.jpg` | He Tried to Escape His Fear | Otter in a glass bubble helmet, forest stream |
| `sonam-wangchuk-1920.jpg` | Sonam Wangchuk: The Boy the System Failed | Man reclining under a HUNGER STRIKE banner |
| `the-lunchbox-that-kept-coming-back-1920.jpg` | The Lunchbox That Kept Coming Back | Dabbawala with a red tiffin on a colourful street |

## Rules the build enforces

- **Under 300 KB each.** The build fails past that. Export at quality ~80 and 1920px wide.
- **Case-exact.** GitHub Pages is case-sensitive; `.JPG` will not match `.jpg`.
- **16:9** to match the players. Other ratios work but set `aspectRatio` on the film.

## Responsive variants (optional)

Add `-960` and `-1440` versions alongside the `-1920` and the build assembles a `srcset` on its
own, so phones download a smaller file:

```
the-strike-960.jpg
the-strike-1440.jpg
the-strike-1920.jpg
```

`scripts/make-posters.sh` cuts all three from a video master in one go.

## Uploading without a local clone

On github.com: open `assets/stills/`, click **Add file → Upload files**, drag the images in, then
**Commit changes**. Rename them to match the table above first — the filename is what links each
image to its film.
