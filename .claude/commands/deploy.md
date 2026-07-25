---
description: Pre-flight then push to GitHub Pages
---

1. Run `/check`. **Stop if anything fails.**
2. Confirm `.nojekyll` exists at the repo root.
3. Confirm `git status` shows nothing under `media/` — video must never be committed.
4. Run `node build.mjs` one final time so the committed HTML matches the current content.
5. Commit the regenerated HTML together with the content change that caused it.
6. `git push -u origin <branch>`. On network failure retry up to 4 times with backoff.
7. Open a draft PR if one is not already open for the branch.
8. Report the live URL and remind Gaurav that Pages takes a minute or two.

See `docs/07-DEPLOY.md` for Pages settings and the custom-domain path.
