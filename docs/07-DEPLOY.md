# 07 — Deploy

> **Reconstructed.** The original of this file was not supplied. It was written from `CLAUDE.md`
> plus the build plan. If you have the original, replace this file and rebuild.

GitHub Pages, custom domain, and the pre-flight.

---

## The model

Generated HTML is **committed** and Pages serves it straight from the branch. No CI, no build step
on the server, no Actions workflow. `git push` is the deploy.

That means: **always run `node build.mjs` before you commit.** A content edit without a rebuild
ships nothing.

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
