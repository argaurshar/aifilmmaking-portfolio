# 07 — Deploy

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

GitHub Pages, custom domain, and the pre-flight.

---

## The model

Generated HTML is **committed** and Pages serves it straight from the branch. `git push` is the
deploy — there is no build step on the Pages server.

That means: **always run `node build.mjs` before you commit.** A content edit without a rebuild
ships nothing.

### The browser-edit safety net

That rule is easy to break from github.com, where you can edit `content/films.json` and commit
without ever running the generator — changing the content and leaving the site untouched.

`.github/workflows/build.yml` catches it. On any push to `main` that touches `content/`, `assets/`
or `build.mjs`, it runs `node build.mjs --check`, rebuilds, runs the test suite, and commits the
regenerated HTML back to `main`. So a content edit made in a browser reaches the live site on its
own, a minute or two later.

It cannot loop: its own commit touches only generated HTML, which is not in the workflow's `paths`
filter, and the job additionally skips pushes made by `github-actions[bot]`.

It cannot ship a bad edit either. `--check` fails on invalid content and on any hardcoded root
path, and the tests run before the commit step, so a broken edit stops in CI with the site
unchanged.

This changes nothing about the Pages configuration — source stays **Deploy from a branch**.
Building locally is still the faster loop and still the recommended one.

---

## One-time setup

1. Push the branch to GitHub.
2. **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: `main` (or whichever you merge to), folder: **`/ (root)`**
3. Wait a minute or two. The site appears at:

```
https://argaurshar.github.io/aifilmmaking-portfolio/
```

`.nojekyll` must be present at the repo root. Without it, Pages runs Jekyll over the output and
silently drops any path beginning with an underscore. It is a zero-byte file and it must stay.

---

## The subpath, and why it matters

The repo is `aifilmmaking-portfolio`, not `argaurshar.github.io`. So Pages serves it from a
**subpath**, and any URL written as `/assets/style.css` resolves to
`argaurshar.github.io/assets/style.css` — the wrong repo, a 404.

Every internal URL therefore goes through `url()` in `build.mjs`, which prefixes `BASE`. `BASE`
comes from the `BASE_PATH` env var and defaults to `/aifilmmaking-portfolio/`.

Relative paths are **not** an acceptable alternative: Pages serves `404.html` for a missing path at
*any* depth, so a relative asset URL inside it resolves against the wrong depth and breaks.

Run `node build.mjs --check` before deploying. It rebuilds at `BASE_PATH=/__probe__/` and fails on
any hardcoded root path that a normal build would not catch.

---

## Vercel

### When Vercel stops deploying

Symptom: you push, GitHub has the commit, and Vercel keeps serving an old one. No failed build,
no error — just nothing. That is a dead **webhook**, not a failed build. Vercel's Deployments list
is the tell:

| Deployments list shows | Meaning | Fix |
|---|---|---|
| Nothing newer than the stale commit | The Git webhook is not firing | Deploy hook, below — or reconnect under Settings → Git |
| Entries marked **Error** | Builds run and fail | Open the newest and read the log |
| Entries marked **Ready** | Builds succeed, production never promoted | Promote it, or fix Settings → Git → Production Branch |

**Redeploy does not help.** Its dialog says it builds "the same source code as your current one" —
it rebuilds the stale commit. This trips people up: they click Redeploy, see the old site again,
and conclude the fix failed.

### The deploy hook

`.github/workflows/build.yml` POSTs to a Vercel deploy hook after each build, which triggers a
deployment without going near the webhook. Two steps to arm it:

1. Vercel → project → **Settings → Git → Deploy Hooks** — create one for `main`, copy the URL.
2. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**, named
   `VERCEL_DEPLOY_HOOK`, pasted as the value.

With the secret unset the step is skipped and nothing fails. With it set, a 4xx fails the job
loudly rather than silently doing nothing — which is the failure mode this exists to prevent.

A deploy hook still needs Vercel's read access to the repository. If it 404s, the repo connection
itself is gone, not just the webhook: reconnect under Settings → Git. Note the repo lives under
`argaurshar` while the Vercel account is a different login, so Vercel's GitHub authorisation has to
include this repository.

### How Vercel builds

Vercel serves from a domain **root**, not a subpath, so the HTML committed for GitHub Pages (which
hardcodes `/aifilmmaking-portfolio/`) would 404 on every asset. `vercel.json` solves this by having
Vercel run the generator itself at deploy time:

```
BASE_PATH=/ SITE_ORIGIN="https://${VERCEL_PROJECT_PRODUCTION_URL:-$VERCEL_URL}" node build.mjs
```

`VERCEL_PROJECT_PRODUCTION_URL` is injected by Vercel, so canonical tags, Open Graph URLs, the
sitemap and JSON-LD all point at the real production domain with nothing to configure.

### Deploying

1. Sign in at **vercel.com** with whichever account you want to own the project.
2. **Add New → Project**.
   - If that account is connected to GitHub, pick `aifilmmaking-portfolio` from the list.
   - If not, use **Import Third-Party Git Repository** and paste the repo's HTTPS URL. This works
     for a public repo without connecting a GitHub account at all — useful when the Vercel account
     and the GitHub account are deliberately separate.
3. Leave every build setting alone. `vercel.json` already sets the build command, the output
   directory and an install step that does nothing, because there is nothing to install.
4. **Deploy.**

Live at `https://<project>.vercel.app/` in under a minute. Every push to `main` redeploys.

### Two hosts at once

Running Pages and Vercel together is fine, but pick one as primary. Each build stamps its own
`SITE_ORIGIN` into the canonical tags, so the two copies declare different canonicals and search
engines see duplicate content. Whichever you are not using, either take it down or point a custom
domain at the one you keep.

One thing Vercel does better: `robots.txt` and `llms.txt` are only honoured at an origin **root**.
On Pages at a subpath they are advisory; on Vercel they are authoritative immediately.

---

## Custom domain

1. At your registrar, add a `CNAME` record for `www` → `argaurshar.github.io`.
   For an apex domain add four `A` records to `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153`.
2. **Settings → Pages → Custom domain**, enter the domain, save. GitHub writes a `CNAME` file to
   the repo root — leave it there, it is how Pages remembers.
3. Wait for the certificate, then tick **Enforce HTTPS**.
4. Rebuild with the new base and origin:

```bash
BASE_PATH=/ SITE_ORIGIN=https://yourdomain.com node build.mjs
```

Also update `site.origin` in `content/site.json` so an env-less build matches. Canonical tags, OG
URLs, the sitemap and JSON-LD all follow from those two values.

DNS takes up to 24 hours. `dig yourdomain.com +short` tells you where it actually points.

---

## Pre-flight

```bash
node build.mjs --check      # build + probe build; fails on hardcoded root paths
node --test                 # markup and a11y assertions
git status --short          # nothing under media/ — video must never be committed
```

Then by eye, at `python3 -m http.server 8000`:

- [ ] Every page loads with no console errors
- [ ] Video facades play on click **and** on Enter
- [ ] Nothing scrolls sideways at 375px
- [ ] Tab reaches every control with a visible focus ring; the skip link works
- [ ] With JS disabled, every page still navigates and every film still opens on its platform
- [ ] No placeholder text left on a page you are about to show a client
- [ ] `view-source:` on a page: canonical, OG image, and JSON-LD all look right

Note that `python3 -m http.server` serves from `/`, not from the subpath, so BASE-prefixed URLs will
404 locally. Either preview with `BASE_PATH=/ node build.mjs` (and rebuild properly before
committing), or serve the parent directory so the subpath resolves.

---

## Rollback

Generated HTML is committed, so every deploy is a commit:

```bash
git revert <sha>   # then push
```

Pages redeploys within a minute or two.

---

## What breaks, and what it looks like

| Symptom | Cause |
|---|---|
| Site 404s entirely | Pages source not set, or set to the wrong branch/folder |
| Page loads, no CSS | `BASE_PATH` wrong at build time — rebuild and recommit |
| Works locally, 404 in production | Filename case. Pages is case-sensitive, macOS is not. The build's case-exact check catches this |
| Video shows the poster but never plays | The video is Private, not Unlisted; or a Vimeo unlisted `hash` is missing |
| Content edit did not appear | You forgot `node build.mjs` before committing |
| Underscore paths 404 | `.nojekyll` was deleted |
