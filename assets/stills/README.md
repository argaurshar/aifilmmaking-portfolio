# Put your images here

Drop every image for the site into this folder. **Filenames do not matter on upload** — Claude can
open each file, see what it is, and rename it correctly afterwards.

## How to upload

1. Open this folder on GitHub: **`assets/stills/`**
2. **Add file → Upload files**
3. Drag the images in — any names, any sizes
4. **Commit changes**
5. Tell Claude they are in

No renaming, no resizing, no export settings to get right. Oversized files only produce a warning,
never a failed build, and get shrunk during the tidy-up pass.

## What the filenames become

Once sorted, each image is renamed to match its film. The filename is what links an image to a
film, which is why it matters *after* upload but not before.

| Final filename | Film |
|---|---|
| `the-architect-who-built-for-the-soul-1920.jpg` | The Architect Who Built for the Soul |
| `the-beaver-who-had-no-crown-1920.jpg` | The Beaver Who Had No Crown |
| `trapped-alone-in-space-1920.jpg` | Trapped Alone in Space |
| `a-boy-drew-his-dream-on-a-ball-1920.jpg` | A Boy Drew His Dream on a Ball |
| `the-strike-1920.jpg` | The Strike |
| `the-rakhi-that-never-breaks-1920.jpg` | The Rakhi That Never Breaks |
| `he-tried-to-escape-his-fear-1920.jpg` | He Tried to Escape His Fear |
| `sonam-wangchuk-1920.jpg` | Sonam Wangchuk: The Boy the System Failed |
| `the-lunchbox-that-kept-coming-back-1920.jpg` | The Lunchbox That Kept Coming Back |
| `portrait.jpg` | The About page image |

`.jpg`, `.jpeg` and `.png` all work. Filenames are case-sensitive on GitHub Pages, so everything
stays lowercase.

## Responsive variants

Adding `-960` and `-1440` next to a `-1920` makes the build assemble a `srcset` automatically, so
phones download a smaller file:

```
the-strike-960.jpg
the-strike-1440.jpg
the-strike-1920.jpg
```

These are generated during the tidy-up pass from whatever you upload.

## The portrait

`portrait.jpg` is measured at build time and its shape picks the layout: wider than 1.2:1 becomes a
full-width banner above the bio, squarer becomes a side column. Alt text and caption live in
`content/site.json` under `identity.portrait`.

## If something is missing

The build never breaks. It warns, names the exact file it wanted, and renders a quiet placeholder
until the image arrives.
