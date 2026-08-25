/**
 * Markup and accessibility assertions over the generated HTML.
 *
 * Crude string checks, deliberately — they need no dependency and they catch
 * the overwhelming majority of real regressions. Run: node --test test/
 *
 * These run against the CURRENT output, so run `node build.mjs` first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');

async function pages() {
  const entries = await readdir(ROOT);
  return entries.filter((f) => f.endsWith('.html')).sort();
}

test('every page was generated', async () => {
  const list = await pages();
  for (const expected of ['index.html', 'work.html', 'process.html', 'hire.html', 'about.html', '404.html']) {
    assert.ok(list.includes(expected), `${expected} is missing — run node build.mjs`);
  }
});

test('exactly one <h1> and one <main> per page', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${p}: <h1> count`);
    assert.equal((html.match(/<main[\s>]/g) ?? []).length, 1, `${p}: <main> count`);
  }
});

test('every <img> has an alt attribute (empty allowed, absent not)', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(tag, /\salt="/, `${p}: img without alt — ${tag.slice(0, 100)}`);
    }
  }
});

test('every <iframe> would carry a title (facade sets it from data-embed-title)', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    for (const [, title] of html.matchAll(/data-embed-title="([^"]*)"/g)) {
      assert.ok(title.trim().length > 0, `${p}: empty data-embed-title`);
    }
    // No iframe should be in the static output at all — that is the whole point
    // of the facade. If one appears, the lazy-embed benefit is gone.
    assert.equal((html.match(/<iframe/g) ?? []).length, 0, `${p}: static iframe found`);
  }
});

test('lang is set and the skip link is the first focusable element', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    assert.match(html, /<html lang="[a-z-]+"/, `${p}: missing lang`);
    const body = html.slice(html.indexOf('<body'));
    const firstAnchor = body.indexOf('<a ');
    assert.ok(firstAnchor > -1, `${p}: no links`);
    assert.match(body.slice(firstAnchor, firstAnchor + 60), /class="skip-link"/, `${p}: skip link is not first`);
  }
});

test('no positive tabindex anywhere', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    assert.doesNotMatch(html, /tabindex="[1-9]/, `${p}: positive tabindex`);
  }
});

test('heading levels never skip', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    let prev = 0;
    for (const [, lvl] of html.matchAll(/<h([1-6])[\s>]/g)) {
      const n = Number(lvl);
      if (prev) assert.ok(n <= prev + 1, `${p}: h${prev} → h${n} skips a level`);
      prev = n;
    }
  }
});

test('every internal URL is BASE-anchored', async () => {
  const base = process.env.BASE_PATH ?? '/aifilmmaking-portfolio/';
  for (const p of await pages()) {
    const html = await read(p);
    for (const [, v] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      if (/^(https?:)?\/\//.test(v) || /^(mailto:|tel:|#|data:)/.test(v)) continue;
      assert.ok(v.startsWith(base), `${p}: "${v}" is not under ${base}`);
    }
  }
});

test('JSON-LD parses and is unicode-escaped, not HTML-escaped', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.ok(!body.includes('</'), `${p}: "</" inside JSON-LD is a script breakout risk`);
      assert.ok(!body.includes('&quot;'), `${p}: JSON-LD was HTML-escaped — it must be unicode-escaped`);
      assert.doesNotThrow(() => JSON.parse(body.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')), `${p}: JSON-LD does not parse`);
    }
  }
});

test('no page leads with the AI angle', async () => {
  for (const p of await pages()) {
    const html = await read(p);
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
    for (const banned of ['made with AI', 'AI-powered', 'AI filmmaker', 'powered by AI']) {
      assert.ok(!new RegExp(banned, 'i').test(visible), `${p}: contains "${banned}" — see docs/04-VOICE.md`);
    }
  }
});

test('CSS never removes an outline without replacing it', async () => {
  const css = await read('assets/css/style.css');
  for (const [match, index] of [...css.matchAll(/outline:\s*(none|0)\b/g)].map((m) => [m[0], m.index])) {
    const context = css.slice(Math.max(0, index - 200), index + 200);
    assert.match(context, /outline:\s*\d/, `bare "${match}" with no replacement outline nearby`);
  }
});

test('machine-readable files exist and are well-formed', async () => {
  const robots = await read('robots.txt');
  for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot']) {
    assert.match(robots, new RegExp(`User-agent: ${agent}`), `robots.txt does not welcome ${agent}`);
  }
  assert.match(robots, /^Sitemap: https?:\/\//m, 'robots.txt has no absolute Sitemap line');

  const sitemap = await read('sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0"/, 'sitemap is not XML');
  assert.ok(!/<loc>[^<]*404\.html<\/loc>/.test(sitemap), '404.html must not be in the sitemap');
  for (const [, loc] of sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    assert.match(loc, /^https?:\/\//, `sitemap loc is not absolute: ${loc}`);
  }

  const llms = await read('llms.txt');
  assert.match(llms, /^# /, 'llms.txt does not start with a heading');
});

test('unsafeHtml is never used in page templates', async () => {
  const src = await read('build.mjs');
  const pagesSection = src.slice(src.indexOf('10. Pages'), src.indexOf('11. Machine-readable'));
  assert.ok(!pagesSection.includes('unsafeHtml('), 'unsafeHtml() must not appear in page templates');
});

/**
 * Everything above reads the ALREADY-generated HTML, so a generator that writes
 * every page correctly and then throws on its way out looks entirely healthy
 * here. That happened: a reporting change referenced buildOnce()'s locals from
 * main(), so `node build.mjs` wrote all nine pages and then died with
 * "filmsDoc is not defined" — exit 1, output perfect, suite green.
 *
 * This runs the real binary and insists it exits clean.
 */
test('node build.mjs exits 0 and reports no failure', async () => {
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath, ['build.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const out = stdout + stderr;
  assert.doesNotMatch(out, /Build failed/, `build.mjs reported a failure:\n${out}`);
  assert.match(stdout, /^✓ \d+ pages/m, `build.mjs printed no success line:\n${out}`);
});

test('node build.mjs --check exits 0', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath, ['build.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(stdout, /probe build at .* passed/, 'probe build did not report passing');
});
