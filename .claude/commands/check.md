---
description: Full verification pass
---

Run every check and report failures with file and line. Do not fix anything without saying so.

```bash
node build.mjs --check     # build + probe build at /__probe__/; catches hardcoded root paths
node --test                # markup and accessibility assertions
git status --short         # must show nothing under media/
```

Then verify in a browser (Chromium is at `/opt/pw-browsers`; never run `playwright install`):

- All pages at 375px and 1440px, zero console errors
- No horizontal scroll at 375px
- Tab order reaches every control with a visible focus ring; skip link works
- Video facade mounts its iframe on click and on Enter, and focus lands in the player
- Every page still works with JavaScript disabled
- Every JSON-LD block parses
- No page references a missing asset

Report the content-gap list from the build so Nitish can see what is still unfilled.
