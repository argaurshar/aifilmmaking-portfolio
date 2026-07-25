# Put your images here

**This folder is the one place every image on the site lives.** Drop files in with the exact
filenames below and run `node build.mjs` — nothing else to edit. The generator finds each image by
its filename and wires it to the right film on its own.

`.jpg`, `.jpeg` and `.png` all work.

## Upload without installing anything

1. Open this folder on GitHub: **`assets/stills/`**
2. **Add file → Upload files**
3. Drag all ten images in
4. **Commit changes**

Rename them to match the table first — **the filename is the only thing linking an image to its
film**, so a typo means it will not be picked up.

## The ten files

| Filename | Where it appears | The frame |
|---|---|---|
| `the-architect-who-built-for-the-soul-1920.jpg` | Work + home page hero | Older man, glasses, holding a white architectural model |
| `the-beaver-who-had-no-crown-1920.jpg` | Work | Orange beaver, wide eyes, peeking over a log |
| `trapped-alone-in-space-1920.jpg` | Work | Man in a worn jacket, red-lit ship corridor |
| `a-boy-drew-his-dream-on-a-ball-1920.jpg` | Work | Anime player mid-cheer, blue India jersey, stadium |
| `the-strike-1920.jpg` | Work | Soldier firing a rocket launcher, full moon, watchtower |
| `the-rakhi-that-never-breaks-1920.jpg` | Work | Brother holding a blue gift box, sister in the doorway |
| `he-tried-to-escape-his-fear-1920.jpg` | Work | Otter in a glass bubble helmet, forest stream |
| `sonam-wangchuk-1920.jpg` | Work | Man reclining under a HUNGER STRIKE banner |
| `the-lunchbox-that-kept-coming-back-1920.jpg` | Work | Dabbawala with a red tiffin on a colourful street |
| `portrait.jpg` | About page | Times Square billboard |

## Two rules the build enforces

- **Under 300 KB each.** The build fails past that. Export around 1920px wide at quality ~80.
- **Exact lowercase filenames.** GitHub Pages is case-sensitive, so `.JPG` will not match `.jpg`.

Missing images never break the site — the build warns, names the file it wanted, and renders a
quiet placeholder in the meantime.

## Optional: smaller files for phones

Add `-960` and `-1440` versions next to a `-1920` and the build assembles a `srcset` automatically,
so phones download a smaller image:

```
the-strike-960.jpg
the-strike-1440.jpg
the-strike-1920.jpg
```

`scripts/make-posters.sh` cuts all three from a video master in one command.

## About the portrait

`portrait.jpg` is measured at build time and the layout follows its shape: wider than 1.2:1 renders
as a full-width banner above the bio, squarer renders as a side column. Its alt text and caption are
set in `content/site.json` under `identity.portrait`.
