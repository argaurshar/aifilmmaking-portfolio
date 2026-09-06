#!/usr/bin/env node
/**
 * build.mjs — the generator.
 *
 * Reads content/*.json, writes *.html + sitemap.xml + robots.txt + llms.txt.
 * Zero dependencies. Node >= 18. See docs/01-BUILD-SPEC.md.
 *
 *   node build.mjs            normal build; draft films excluded
 *   node build.mjs --drafts   include drafts, for local preview only
 *   node build.mjs --check    also runs a probe build at BASE_PATH=/__probe__/
 *   node build.mjs --strict   promote warnings to errors
 *
 * Never edit the generated .html files. Edit content/*.json, or this file.
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = '/aifilmmaking-portfolio/';
// Where generated files land. Defaults to the repo root, which is what GitHub
// Pages serves. Vercel sets OUT_DIR=dist so it gets a clean directory holding
// only the site, rather than the whole repo.
const OUT = process.env.OUT_DIR ? path.resolve(ROOT, process.env.OUT_DIR) : ROOT;

/* ═══════════════════════════════════════════════════════════════════════════
   1. HTML — escaping is the load-bearing part of this file.

   `html` escapes every interpolation by default. Raw insertion needs the
   deliberately awkward `unsafeHtml({because})`. Misuse degrades visibly
   (literal <p> on screen) rather than dangerously.
   ═══════════════════════════════════════════════════════════════════════════ */

const RAW = Symbol('html');

class Html {
  constructor(s) { this[RAW] = String(s); }
  toString() { return this[RAW]; }
}
const isHtml = (v) => v instanceof Html;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for HTML. Throws on null/undefined so a missing field is loud. */
function text(value) {
  if (value === null || value === undefined) {
    throw new TypeError('text(): refusing to render null/undefined — guard the field first.');
  }
  return String(value).replace(/[&<>"']/g, (c) => ESC[c]);
}

function interpolate(v) {
  if (isHtml(v)) return v.toString();
  if (Array.isArray(v)) return v.map(interpolate).join('');
  if (v === false || v === null || v === undefined) return '';   // enables ${cond && html`…`}
  return text(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1];
  return new Html(out);
}

/**
 * Inline micro-markup, compiled AFTER escaping — so the capture groups can
 * never contain live markup. `[[x]]` → accent em, `**x**` → strong.
 */
function inline(source) {
  if (typeof source !== 'string') throw new TypeError(`inline(): expected string, got ${typeof source}`);
  let out = text(source);
  out = out.replace(/\[\[(.+?)\]\]/gs, '<em class="u-accent">$1</em>');
  out = out.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  return new Html(out);
}

/** Paragraphs from an array of strings. Authors never write \n\n. */
function prose(value, className = 'prose') {
  const paras = (Array.isArray(value) ? value : [value]).filter(Boolean);
  if (!paras.length) return null;
  return html`<div class="${className}">${paras.map((p) => html`<p>${inline(p)}</p>`)}</div>`;
}

function attrs(map) {
  const out = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === false || v === null || v === undefined) continue;
    if (v === true) { out.push(text(k)); continue; }
    out.push(`${text(k)}="${text(v)}"`);
  }
  return new Html(out.join(' '));
}

/** Last resort. Deliberately awkward and greppable. Banned from page templates by test/. */
function unsafeHtml(source, { because } = {}) {
  if (!because) throw new Error('unsafeHtml() requires a { because } justification.');
  return new Html(source);
}

/**
 * <script> is a RAW TEXT element — HTML-escaping inside it is the classic
 * hand-rolled-generator bug. Unicode-escape instead.
 */
function jsonLdScript(graph) {
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return new Html(`<script type="application/ld+json">${json}</script>`);
}

const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/* ═══════════════════════════════════════════════════════════════════════════
   2. URLs — the single chokepoint for the GitHub Pages subpath problem.
   ═══════════════════════════════════════════════════════════════════════════ */

function normalizeBase(raw) {
  if (raw == null || raw === '' || raw === '/') return '/';
  let b = String(raw).trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b = b + '/';
  if (b.includes('//')) throw new Error(`Invalid BASE_PATH: ${JSON.stringify(raw)}`);
  return b;
}

function makeUrls({ base, origin }) {
  const BASE = normalizeBase(base);
  const ORIGIN = String(origin).replace(/\/+$/, '');

  /** Internal path, BASE-relative, NO leading slash. url('') === BASE. */
  const url = (p) => {
    if (typeof p !== 'string') throw new TypeError(`url(): expected string, got ${typeof p}`);
    if (p === '') return BASE;
    if (p.startsWith('#')) return p;
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) {
      throw new Error(`url() is for internal paths only; got "${p}". Use extUrl().`);
    }
    if (p.startsWith('/')) {
      throw new Error(`url(): pass a BASE-relative path with no leading slash. Got "${p}" — did you mean "${p.slice(1)}"?`);
    }
    return BASE + p;
  };

  const absUrl = (p) => ORIGIN + url(p);

  const extUrl = (u) => {
    if (!/^(https:|http:|mailto:|tel:)/i.test(String(u))) {
      throw new Error(`extUrl(): disallowed scheme in "${u}"`);
    }
    return String(u);
  };

  return { BASE, ORIGIN, url, absUrl, extUrl };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Content loading — parse errors name the file and the line.
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadJson(rel) {
  const abs = path.join(ROOT, rel);
  let raw;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new Error(`Cannot read ${rel}. Does it exist?`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const upto = raw.slice(0, Number(m[1]));
      const line = upto.split('\n').length;
      const col = upto.length - upto.lastIndexOf('\n');
      where = ` at line ${line}, column ${col}`;
    }
    throw new Error(`${rel}${where}: ${e.message}\n  (a trailing comma or a missing quote is the usual cause)`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Validation — collect every error, then throw once.
   ═══════════════════════════════════════════════════════════════════════════ */

const FILM_TYPES = ['narrative-short', 'brand-film', 'animation', 'music-video', 'documentary', 'experimental', 'trailer'];
const CRAFTS = ['blocking', 'lighting', 'continuity', 'edit-rhythm', 'sound', 'grade'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATIO = /^\d+(\.\d+)?:\d+(\.\d+)?$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

class Report {
  constructor() { this.errors = []; this.warnings = []; }
  error(pathStr, msg) { this.errors.push({ path: pathStr, msg }); }
  warn(pathStr, msg) { this.warnings.push({ path: pathStr, msg }); }
  get ok() { return this.errors.length === 0; }
}

/** No markup in content, ever. This is what makes the escaping layer airtight. */
function checkStrings(node, pathStr, rep) {
  if (typeof node === 'string') {
    if (/[<>]/.test(node)) {
      rep.error(pathStr, 'content may not contain "<" or ">". Use [[emphasis]] or **strong** instead.');
    }
    return;
  }
  if (Array.isArray(node)) return node.forEach((v, i) => checkStrings(v, `${pathStr}[${i}]`, rep));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '_comment') continue;
      checkStrings(v, `${pathStr}.${k}`, rep);
    }
  }
}

function validateVideo(v, p, rep, { allowPending = false } = {}) {
  if (!v || typeof v !== 'object') { rep.error(p, 'required object { platform, id }'); return; }
  if (!['youtube', 'vimeo'].includes(v.platform)) {
    rep.error(`${p}.platform`, `must be "youtube" or "vimeo", got ${JSON.stringify(v.platform)}`);
  }
  // A draft may be staged with everything but the id — title, runtime, logline
  // all captured while the id itself is still being copied off the platform.
  // Such a film is held out of every build, --drafts included, so a half-known
  // entry can live in content without ever rendering a broken embed.
  if (v.id === null && allowPending) {
    rep.warn(`${p}.id`, 'awaiting the real id — this film is held out of every build');
    return;
  }
  if (typeof v.id !== 'string' || !v.id) { rep.error(`${p}.id`, 'required string'); return; }

  // Highest-value DX check in the validator: someone pasted a URL.
  if (/^https?:|\//.test(v.id)) {
    const yt = /(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(v.id);
    const vm = /vimeo\.com\/(?:video\/)?(\d{6,12})(?:\/([A-Za-z0-9]+))?/.exec(v.id);
    let hint = '';
    if (yt) hint = ` Use { "platform": "youtube", "id": "${yt[1]}" }`;
    else if (vm) hint = ` Use { "platform": "vimeo", "id": "${vm[1]}"${vm[2] ? `, "hash": "${vm[2]}"` : ''} }`;
    rep.error(`${p}.id`, `looks like a URL, not an ID.${hint || ' See docs/06-MEDIA-PIPELINE.md.'}`);
    return;
  }

  if (v.platform === 'youtube') {
    if (!YT_ID.test(v.id)) rep.error(`${p}.id`, `YouTube ids are 11 chars of [A-Za-z0-9_-]; got "${v.id}"`);
    if (v.hash) rep.error(`${p}.hash`, 'only Vimeo unlisted videos use a hash');
  } else if (v.platform === 'vimeo') {
    if (!VIMEO_ID.test(v.id)) rep.error(`${p}.id`, `Vimeo ids are 6–12 digits; got "${v.id}"`);
    if (v.hash != null && !/^[A-Za-z0-9]+$/.test(v.hash)) rep.error(`${p}.hash`, 'must be alphanumeric');
  }
  if (v.startAt != null && (!Number.isInteger(v.startAt) || v.startAt < 0)) {
    rep.error(`${p}.startAt`, 'must be a non-negative integer (seconds)');
  }
}

function validatePoster(poster, p, rep) {
  if (poster === null) return;                       // explicit null is allowed → placeholder
  if (!poster || typeof poster !== 'object') { rep.error(p, 'must be an object or explicit null'); return; }
  if (typeof poster.src !== 'string' || !poster.src) rep.error(`${p}.src`, 'required string');
  else if (poster.src.startsWith('/')) rep.error(`${p}.src`, 'must be BASE-relative with no leading slash');
  if (typeof poster.alt !== 'string') rep.error(`${p}.alt`, 'required string (may be empty)');
}

function validate(site, filmsDoc, processDoc, rep) {
  checkStrings(site, 'site', rep);
  checkStrings(filmsDoc, 'films', rep);
  checkStrings(processDoc, 'process', rep);

  // ---- site.json
  const s = site.site ?? {};
  if (!s.origin || !/^https?:\/\//.test(s.origin)) rep.error('site.site.origin', 'required absolute URL');
  if (!s.title) rep.error('site.site.title', 'required');
  if (!s.description) rep.error('site.site.description', 'required');
  else if (s.description.length > 160) rep.warn('site.site.description', `${s.description.length} chars; ≤160 reads better in search results`);
  if (!ISO_DATE.test(s.updated ?? '')) rep.error('site.site.updated', 'required ISO date, YYYY-MM-DD');
  if (!s.ogImage) rep.error('site.site.ogImage', 'required');

  if (!site.identity?.name) rep.error('site.identity.name', 'required');
  if (!site.identity?.role) rep.error('site.identity.role', 'required');
  if (/\bAI\b/i.test(site.identity?.role ?? '')) {
    rep.error('site.identity.role', 'must not lead with the AI angle — use "Filmmaker". See docs/04-VOICE.md.');
  }
  if (!site.contact?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(site.contact.email)) {
    rep.error('site.contact.email', 'required, and must be a valid address — the Hire page depends on it');
  }
  for (const [i, soc] of (site.social ?? []).entries()) {
    if (!soc.label) rep.error(`site.social[${i}].label`, 'required');
    if (!/^https?:\/\//.test(soc.url ?? '')) rep.error(`site.social[${i}].url`, 'required absolute URL');
  }
  for (const key of ['index', 'work', 'process', 'hire', 'about', 'notFound']) {
    if (!site.pages?.[key]) rep.error(`site.pages.${key}`, 'required');
  }
  const laurelIds = new Set();
  for (const [i, l] of (site.laurels ?? []).entries()) {
    if (!SLUG.test(l.id ?? '')) rep.error(`site.laurels[${i}].id`, 'required slug');
    if (laurelIds.has(l.id)) rep.error(`site.laurels[${i}].id`, `duplicate "${l.id}"`);
    laurelIds.add(l.id);
    if (!l.festival) rep.error(`site.laurels[${i}].festival`, 'required');
  }

  // ---- films.json
  const films = filmsDoc.films ?? [];
  if (!Array.isArray(films)) { rep.error('films.films', 'must be an array'); return { laurelIds, films: [], clips: [] }; }
  const filmIds = new Set();
  films.forEach((f, i) => {
    const p = `films[${i}]`;
    if (!SLUG.test(f.id ?? '')) rep.error(`${p}.id`, `required slug, got ${JSON.stringify(f.id)}`);
    else if (filmIds.has(f.id)) rep.error(`${p}.id`, `duplicate id "${f.id}"`);
    filmIds.add(f.id);

    if (!f.title) rep.error(`${p}.title`, 'required');
    else if (f.title.length > 120) rep.error(`${p}.title`, 'max 120 chars');
    if (!Number.isInteger(f.year) || f.year < 2000 || f.year > 2100) rep.error(`${p}.year`, 'required integer 2000–2100');
    if (!FILM_TYPES.includes(f.type)) rep.error(`${p}.type`, `must be one of ${FILM_TYPES.join(', ')}`);
    if (!f.logline) rep.error(`${p}.logline`, 'required');
    else if (f.logline.length > 200) rep.error(`${p}.logline`, `max 200 chars, got ${f.logline.length}`);
    if (!Array.isArray(f.roles) || !f.roles.length) rep.error(`${p}.roles`, 'required, at least one');

    validateVideo(f.video, `${p}.video`, rep, { allowPending: (f.status ?? 'published') === 'draft' });
    validatePoster(f.poster, `${p}.poster`, rep);

    if (f.type === 'brand-film' && !f.client) rep.error(`${p}.client`, 'required when type is "brand-film"');
    if (f.type !== 'brand-film' && f.client) rep.error(`${p}.client`, 'must be null unless type is "brand-film"');

    if (f.aspectRatio == null) rep.warn(`${p}.aspectRatio`, 'absent, defaulting to 16:9 — set it if this film is not 16:9');
    else if (!RATIO.test(f.aspectRatio)) rep.error(`${p}.aspectRatio`, 'must look like "16:9"');

    if (f.runtimeSeconds != null && (!Number.isInteger(f.runtimeSeconds) || f.runtimeSeconds <= 0)) {
      rep.error(`${p}.runtimeSeconds`, 'must be a positive integer');
    }
    if (f.published != null && !ISO_DATE.test(f.published)) rep.error(`${p}.published`, 'must be an ISO date');
    if (f.status != null && !['published', 'draft'].includes(f.status)) rep.error(`${p}.status`, 'must be "published" or "draft"');

    for (const [j, id] of (f.laurels ?? []).entries()) {
      if (!laurelIds.has(id)) rep.error(`${p}.laurels[${j}]`, `unknown laurel id "${id}" — add it to site.laurels`);
    }
    if ((f.status ?? 'published') === 'published' && f.published == null) {
      rep.warn(`${p}.published`, `"${f.id}" will not be eligible for video rich results without a publish date`);
    }
  });

  // ---- process.json
  const clips = processDoc.clips ?? [];
  const clipIds = new Set();
  clips.forEach((c, i) => {
    const p = `process.clips[${i}]`;
    if (!SLUG.test(c.id ?? '')) rep.error(`${p}.id`, 'required slug');
    else if (clipIds.has(c.id)) rep.error(`${p}.id`, `duplicate id "${c.id}"`);
    clipIds.add(c.id);
    if (!Number.isInteger(c.order)) rep.error(`${p}.order`, 'required integer');
    if (!c.title) rep.error(`${p}.title`, 'required');
    if (!CRAFTS.includes(c.craft)) rep.error(`${p}.craft`, `must be one of ${CRAFTS.join(', ')}`);
    if (!Array.isArray(c.summary) || !c.summary.length) rep.error(`${p}.summary`, 'required array of paragraphs');
    if (c.aspectRatio != null && !RATIO.test(c.aspectRatio)) rep.error(`${p}.aspectRatio`, 'must look like "16:9"');
    validateVideo(c.video, `${p}.video`, rep);
    validatePoster(c.poster, `${p}.poster`, rep);
    if (c.filmId != null && !filmIds.has(c.filmId)) rep.error(`${p}.filmId`, `unknown film id "${c.filmId}"`);
  });
  if (!clips.length) rep.error('process.clips', 'at least one clip is required');
  else if (clips.length !== 4) rep.warn('process.clips', `${clips.length} clips; the design expects four`);

  for (const [i, l] of (site.laurels ?? []).entries()) {
    if (l.filmId != null && !filmIds.has(l.filmId)) rep.error(`site.laurels[${i}].filmId`, `unknown film id "${l.filmId}"`);
  }

  return { laurelIds, films, clips };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Lint — the voice rules as a check rather than a hope.
   ═══════════════════════════════════════════════════════════════════════════ */

const BANNED = [
  'cutting-edge', 'cutting edge', 'revolutionary', 'seamless', 'elevate', 'unlock',
  'harness', 'leverage', 'passionate about', 'push the boundaries', 'bring your vision to life',
  'next level', 'game-changing', 'state-of-the-art', 'powered by', 'ai-powered', 'made with ai',
  'ai-driven', 'ai filmmaker', 'generative ai', 'best-in-class', 'world-class',
  'ai-generated', 'ai-animated', 'ai animated', 'ai documentary', 'ai short', 'ai film',
];
const TOOL_NAMES = ['midjourney', 'runway', 'sora', 'pika', 'kling', 'stable diffusion', 'veo', 'luma', 'dall-e'];

function lintContent(node, pathStr, rep) {
  if (typeof node === 'string') {
    const low = node.toLowerCase();
    for (const b of BANNED) {
      if (low.includes(b)) rep.warn(pathStr, `agency voice: "${b}" — see docs/04-VOICE.md`);
    }
    for (const t of TOOL_NAMES) {
      if (low.includes(t)) rep.warn(pathStr, `tool name "${t}" in copy — the films come first, not the tooling`);
    }
    return;
  }
  if (Array.isArray(node)) return node.forEach((v, i) => lintContent(v, `${pathStr}[${i}]`, rep));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '_comment') continue;
      lintContent(v, `${pathStr}.${k}`, rep);
    }
  }
}

function collectGaps(node, pathStr, gaps) {
  if (typeof node === 'string') {
    if (/^\s*TODO\b|\bTODO:/.test(node)) gaps.push(pathStr);
    return;
  }
  if (Array.isArray(node)) return node.forEach((v, i) => collectGaps(v, `${pathStr}[${i}]`, gaps));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '_comment') continue;
      collectGaps(v, `${pathStr}.${k}`, gaps);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Assets — case-exact existence, intrinsic dimensions, srcset probing.
   ═══════════════════════════════════════════════════════════════════════════ */

const dirCache = new Map();
async function listDir(absDir) {
  if (!dirCache.has(absDir)) {
    try { dirCache.set(absDir, await readdir(absDir)); }
    catch { dirCache.set(absDir, null); }
  }
  return dirCache.get(absDir);
}

/**
 * Case-EXACT existence. `fs.access` succeeds on a case-insensitive filesystem
 * (macOS) for a file that will 404 on GitHub Pages. This is the bug you find
 * out about from a stranger.
 */
async function assetExists(rel) {
  const abs = path.join(ROOT, rel);
  const entries = await listDir(path.dirname(abs));
  return Array.isArray(entries) && entries.includes(path.basename(abs));
}

/** Intrinsic dimensions from PNG IHDR / JPEG SOFn headers. Zero dependencies. */
async function imageSize(rel) {
  const buf = await readFile(path.join(ROOT, rel));
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  throw new Error(`Cannot read image dimensions from ${rel} (PNG and JPEG only)`);
}

const MAX_ASSET_BYTES = 300 * 1024;

/** Recursive directory copy. Built on readdir rather than fs.cp for stability. */
async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(src, dst);
    else if (e.isFile()) await writeFile(dst, await readFile(src));
  }
}

/**
 * Convention over configuration: if a film has no `poster` in JSON, look for
 * assets/stills/<id>-1920.jpg (or .jpeg/.png, or the bare <id>.<ext>).
 * Drop a correctly-named file in and the build picks it up with no JSON edit.
 */
/**
 * Every `<id>-<width>.<ext>` sibling in `dir`, widest first.
 *
 * Deliberately NOT a fixed ladder of expected widths. A hardcoded list forces
 * whoever makes the files to hit those exact numbers, and a source narrower
 * than the smallest rung then has to be either upscaled or mislabelled — and a
 * 335px file named -1080.jpg makes the srcset lie, so browsers pick a tiny
 * image believing it is large. Read what is actually on disk instead.
 */
async function posterVariants(id, dir) {
  const re = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.(jpg|jpeg|png)$`, 'i');
  let entries;
  try { entries = await readdir(path.join(ROOT, dir)); } catch { return []; }
  return entries
    .map((name) => { const m = re.exec(name); return m ? { rel: `${dir}/${name}`, w: Number(m[1]) } : null; })
    .filter(Boolean)
    .sort((a, b) => b.w - a.w);
}

async function autoPoster(id, dir) {
  // The widest variant present becomes the default src.
  const variants = await posterVariants(id, dir);
  if (variants.length) return { src: variants[0].rel, alt: '' };
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const rel = `${dir}/${id}.${ext}`;
    if (await assetExists(rel)) return { src: rel, alt: '' };
  }
  return null;
}

/**
 * Resolve a poster into { src, srcset, width, height, alt }. The srcset is
 * built from whatever `<id>-<width>` siblings exist on disk, so every width
 * descriptor is one a file actually has. Responsive images, no build tooling.
 */
async function resolvePoster(poster, ctx, whereForErrors) {
  if (!poster) return null;
  if (!(await assetExists(poster.src))) {
    ctx.rep.error(whereForErrors, `asset not found (case-exact): ${poster.src}`);
    return null;
  }
  const info = await stat(path.join(ROOT, poster.src));
  if (info.size > MAX_ASSET_BYTES) {
    // A warning, not an error: an oversized upload should never block the build.
    // Shrink it with scripts/make-posters.sh or any exporter.
    ctx.rep.warn(whereForErrors, `${poster.src} is ${Math.round(info.size / 1024)} KB; aim for under ${MAX_ASSET_BYTES / 1024} KB`);
  }
  const { width, height } = await imageSize(poster.src);

  const m = /^(.*\/)?([^/]+)-(\d+)\.(jpg|jpeg|png)$/i.exec(poster.src);
  const sources = m
    ? (await posterVariants(m[2], (m[1] ?? '').replace(/\/$/, ''))).slice().sort((a, b) => a.w - b.w)
    : [];
  const srcset = sources.length > 1
    ? sources.map((s) => `${ctx.u.url(s.rel)} ${s.w}w`).join(', ')
    : null;

  return { src: ctx.u.url(poster.src), srcset, width, height, alt: poster.alt ?? '' };
}

/**
 * A frame strip: N stills of the film side by side in one JPEG at
 * assets/strips/<id>.jpg. main.js slides it under the pointer, so a poster
 * plays without a byte of video being hosted. Frame count is read off the
 * image itself — a 16:9 strip of 24 frames is 24 × (16/9) wide for its height.
 */
async function resolveStrip(film, ctx) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const rel = `assets/strips/${film.id}.${ext}`;
    if (!(await assetExists(rel))) continue;
    const { width, height } = await imageSize(rel);
    const [rw, rh] = String(film.aspectRatio ?? '16:9').split(':').map(Number);
    const frames = Math.round((width / height) / (rw / rh));
    if (frames < 2) { ctx.rep.warn(`films[${film.id}].strip`, `${rel} holds fewer than two frames — ignored`); return null; }
    return { src: ctx.u.url(rel), frames };
  }
  return null;
}

async function hashFile(rel) {
  const buf = await readFile(path.join(ROOT, rel));
  return createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. Components
   ═══════════════════════════════════════════════════════════════════════════ */

const TYPE_LABEL = {
  'narrative-short': 'Narrative short',
  'brand-film': 'Brand film',
  'animation': 'Animation',
  'music-video': 'Music video',
  'documentary': 'Documentary',
  'experimental': 'Experimental',
  'trailer': 'Trailer',
};

function formatRuntime(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isoDuration(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `PT${m ? `${m}M` : ''}${s ? `${s}S` : ''}` || 'PT0S';
}

function spokenRuntime(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function placeholder(what) {
  return html`<div class="placeholder" role="note">MISSING: ${what}</div>`;
}

/** Single source of truth for privacy-friendly embed URLs. JS never builds one. */
function embedSrc({ platform, id, hash, startAt }) {
  if (platform === 'youtube') {
    const p = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', color: 'white' });
    if (startAt) p.set('start', String(startAt));
    return `https://www.youtube-nocookie.com/embed/${id}?${p}`;
  }
  if (platform === 'vimeo') {
    const p = new URLSearchParams({ autoplay: '1', dnt: '1', title: '0', byline: '0', portrait: '0' });
    if (hash) p.set('h', hash);
    if (startAt) p.set('t', `${startAt}s`);
    return `https://player.vimeo.com/video/${id}?${p}`;
  }
  throw new Error(`Unknown video platform: ${platform}`);
}

function watchUrl({ platform, id, hash }) {
  return platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${id}`
    : `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`;
}

function embedOrigin(platform) {
  return platform === 'youtube' ? 'https://www.youtube-nocookie.com' : 'https://player.vimeo.com';
}

/**
 * The lite-embed facade. The control stays a real <a href> to the watch page,
 * so it genuinely works with JS off; JS upgrades it in place. Never role=button.
 */
/**
 * "9:16" → { css: "9 / 16", portrait: true }. One parse drives three things:
 * the frame's aspect-ratio, the layout modifier, and the srcset sizes hint.
 */
function parseRatio(ratio) {
  const [w, h] = String(ratio ?? '16:9').split(':').map(Number);
  return { css: `${w} / ${h}`, portrait: h > w };
}

/**
 * og:video:width/height were hardcoded 1280x720. With 9:16 films on the site
 * that told every scraper a portrait film was landscape. Derive from the ratio,
 * normalised to a 720px long edge.
 */
function ogVideoSize(ratio) {
  const [w, h] = String(ratio ?? '16:9').split(':').map(Number);
  const scale = 720 / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function embed({ video, poster, title, ratio, runtimeSeconds, eager = false, caption = null, noteGaps = false, sizes = null, overlay = null, vtName = null }) {
  const { css: ratioCss, portrait } = parseRatio(ratio);
  const spoken = spokenRuntime(runtimeSeconds);
  // The only two things that may reach a style attribute; the audit enforces it.
  const styleAttr = `--embed-ratio: ${ratioCss}` + (vtName ? `; view-transition-name: ${vtName}` : '');
  const sizesAttr = sizes ?? (portrait ? '(min-width: 40rem) 21rem, 92vw' : '(min-width: 60rem) 60rem, 100vw');
  return html`<figure class="embed${portrait ? ' embed--portrait' : ''}" data-embed
    data-embed-src="${embedSrc(video)}"
    data-embed-origin="${embedOrigin(video.platform)}"
    data-embed-title="${title}"
    data-watch-url="${watchUrl(video)}"
    style="${styleAttr}">
    <div class="embed__frame">
      ${poster
        ? html`<img class="embed__poster" src="${poster.src}"
            ${poster.srcset ? attrs({ srcset: poster.srcset, sizes: sizesAttr }) : ''}
            width="${poster.width}" height="${poster.height}" alt=""
            ${attrs({ loading: eager ? 'eager' : 'lazy', fetchpriority: eager ? 'high' : false, decoding: 'async' })}>`
        : html`<span class="embed__noposter" aria-hidden="true"></span>`}
      <a class="embed__play" href="${watchUrl(video)}" rel="noopener">
        <span class="embed__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
        </span>
        <span class="embed__label">Play <i>${title}</i></span>
        <span class="u-visually-hidden">${spoken ? `, ${spoken}` : ''}<span class="embed__nojs"> (opens on ${video.platform === 'youtube' ? 'YouTube' : 'Vimeo'})</span></span>
      </a>
      ${overlay ?? ''}
    </div>
    ${!poster && noteGaps ? placeholder(html`poster — cut one with <b>scripts/make-posters.sh</b>`) : ''}
    ${caption ? html`<figcaption class="embed__caption">${inline(caption)}</figcaption>` : ''}
  </figure>`;
}

function chip(label) {
  return html`<li class="chip">${label}</li>`;
}

function filmChips(film) {
  const rt = formatRuntime(film.runtimeSeconds);
  return html`<ul class="chips l-cluster">
    ${chip(TYPE_LABEL[film.type])}
    ${chip(film.year)}
    ${rt ? chip(rt) : ''}
    ${film.client ? chip(film.client) : ''}
  </ul>`;
}

function laurelRow(ids, site) {
  const list = (ids ?? []).map((id) => site.laurels.find((l) => l.id === id)).filter(Boolean);
  if (!list.length) return '';
  return html`<ul class="laurel-row l-cluster">
    ${list.map((l) => html`<li class="laurel">
      <span class="laurel__award">${l.award ?? 'Official Selection'}</span>
      <span class="laurel__festival">${l.festival}${l.year ? `, ${l.year}` : ''}</span>
    </li>`)}
  </ul>`;
}

function filmEntry(film, ctx, { eager = false, headingLevel = 'h2' } = {}) {
  const { site } = ctx;
  const H = headingLevel;
  const details = [];
  if (film.synopsis?.length) details.push(html`<div class="film-entry__synopsis">${prose(film.synopsis)}</div>`);
  const creditRows = [];
  if (film.roles?.length) creditRows.push({ k: film.roles.length > 1 ? 'Roles' : 'Role', v: film.roles.join(', ') });
  if (film.client) creditRows.push({ k: 'Client', v: film.client });
  for (const c of film.collaborators ?? []) creditRows.push({ k: c.role, v: c.name });
  if (creditRows.length) {
    details.push(html`<dl class="meta-list">
      ${creditRows.map((r) => html`<div class="meta-list__row"><dt>${r.k}</dt><dd>${r.v}</dd></div>`)}
    </dl>`);
  }

  const portrait = parseRatio(film.aspectRatio).portrait;
  return html`<article class="film-entry${portrait ? ' film-entry--portrait' : ''}" id="film-${film.id}">
    ${embed({
      video: film.video, poster: film.resolvedPoster, title: film.title,
      ratio: film.aspectRatio, runtimeSeconds: film.runtimeSeconds, eager,
      noteGaps: film.status === 'draft',
    })}
    <div class="film-entry__body l-stack">
      <${new Html(H)} class="film-entry__title">${film.title}</${new Html(H)}>
      ${filmChips(film)}
      <p class="film-entry__logline">${inline(film.logline)}</p>
      ${laurelRow(film.laurels, site)}
      ${details.length
        ? html`<details class="film-entry__details">
            <summary>Details</summary>
            <div class="film-entry__details-body l-stack">${details}</div>
          </details>`
        : ''}
    </div>
  </article>`;
}

/** Where a film lives. One URL per film; every link to a film goes through this. */
const filmPath = (film) => `films/${film.id}.html`;

/** Zero to ninety-nine, for copy that states a count without rotting. */
function numberWord(n) {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  return String(n);
}
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const playGlyph = () => html`<svg viewBox="0 0 10 12" aria-hidden="true" focusable="false"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg>`;

/**
 * A poster that behaves like a film: a link to the film's page, the play
 * cursor over it, a frame strip under the pointer when one exists, and a
 * view-transition name so the click grows into the film page's stage.
 *
 * The accessible name lives inside the link; the caption beside it is plain
 * text, so a screen reader hears one link per film, not two.
 */
function frame(film, ctx, { sizes = '(min-width: 60rem) 34rem, 90vw', eager = false, vt = true, label = false } = {}) {
  const { u } = ctx;
  const portrait = parseRatio(film.aspectRatio).portrait;
  const p = film.resolvedPoster;
  const bits = filmBits(film);
  return html`<a class="frame${portrait ? ' frame--portrait' : ''}${label ? ' frame--titled' : ''}" href="${u.url(filmPath(film))}" data-cursor="play"
      ${film.strip ? attrs({ 'data-strip': film.strip.src, 'data-frames': String(film.strip.frames) }) : ''}
      ${vt ? new Html(` style="view-transition-name: film-${film.id}"`) : ''}>
    ${p
      ? html`<img class="frame__poster" src="${p.src}" ${p.srcset ? attrs({ srcset: p.srcset, sizes }) : ''}
          width="${p.width}" height="${p.height}" alt=""
          ${attrs({ loading: eager ? 'eager' : 'lazy', fetchpriority: eager ? 'high' : false, decoding: 'async' })}>`
      : html`<span class="frame__noposter" aria-hidden="true"></span>`}
    ${label
      ? html`<span class="frame__cap" aria-hidden="true">
          <span class="frame__title display">${film.title}</span>
          ${bits ? html`<span class="frame__meta">${bits}</span>` : ''}
        </span>`
      : ''}
    <span class="u-visually-hidden">${film.title}${label && bits ? `, ${bits}` : ''}</span>
  </a>`;
}

/** Type, runtime, and orientation when it is the point — one spoken line. */
function filmBits(film) {
  const bits = [TYPE_LABEL[film.type], formatRuntime(film.runtimeSeconds)];
  if (parseRatio(film.aspectRatio).portrait) bits.push('Vertical');
  return bits.filter(Boolean).join(' · ');
}

/** A tile on the Work sheet: the poster, with the title revealed on intent. */
function filmTile(film, ctx) {
  const { u } = ctx;
  const portrait = parseRatio(film.aspectRatio).portrait;
  const p = film.resolvedPoster;
  const bits = filmBits(film);
  return html`<div class="sheet__item${portrait ? ' sheet__item--portrait' : ''}" data-type="${film.type}"
      data-orientation="${portrait ? 'portrait' : 'landscape'}" id="film-${film.id}">
    <a class="tile" href="${u.url(filmPath(film))}" data-cursor="play"
        ${film.strip ? attrs({ 'data-strip': film.strip.src, 'data-frames': String(film.strip.frames) }) : ''}
        ${new Html(` style="view-transition-name: film-${film.id}"`)}>
      ${p
        ? html`<img class="tile__poster" src="${p.src}" ${p.srcset ? attrs({ srcset: p.srcset, sizes: '(min-width: 72rem) 25vw, (min-width: 46rem) 34vw, 50vw' }) : ''}
            width="${p.width}" height="${p.height}" alt="" loading="lazy" decoding="async">`
        : html`<span class="frame__noposter" aria-hidden="true"></span>`}
      <span class="tile__cap" aria-hidden="true">
        <span><span class="tile__title display">${film.title}</span><span class="tile__meta">${bits}</span></span>
        <span class="tile__go">${playGlyph()}</span>
      </span>
      <span class="u-visually-hidden">${film.title}${bits ? `, ${bits}` : ''}</span>
    </a>
  </div>`;
}

/**
 * The contact band, set like a closing title card. `.callout` and the
 * mailto link are what main.js looks for to add the copy button.
 */
function contactBand(ctx, { heading = 'Get in touch', eyebrow = 'Contact', aside = true } = {}) {
  const { site, u } = ctx;
  return html`<section class="callout" aria-labelledby="contact-heading">
    <div class="callout__main">
      <p class="eyebrow">${eyebrow}</p>
      <h2 class="callout__heading" id="contact-heading">${inline(heading)}</h2>
      <p class="callout__body">
        <a class="callout__email" href="${u.extUrl(`mailto:${site.contact.email}`)}">${site.contact.email}</a>
      </p>
      ${site.contact.responseTime ? html`<p class="callout__note">${inline(site.contact.responseTime)}</p>` : ''}
      ${site.social?.length
        ? html`<ul class="l-cluster callout__social">
            ${site.social.map((s) => html`<li><a href="${u.extUrl(s.url)}" rel="me noopener">${s.label}</a></li>`)}
          </ul>`
        : ''}
    </div>
    ${aside && site.services?.length
      ? html`<div class="callout__aside">
        ${site.services.map((s) => html`<span>${s.title}</span>`)}
        <br>${[...new Set(site.services.flatMap((s) => s.deliverables ?? []))].slice(0, 2).map((d) => html`${inline(d)}<br>`)}
      </div>`
      : ''}
  </section>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. Layout
   ═══════════════════════════════════════════════════════════════════════════ */

function head(page, ctx) {
  const { site, u, assets } = ctx;
  const ogAbs = ctx.ORIGIN + page.ogImage.src;
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<link rel="canonical" href="${u.absUrl(page.path)}">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="${page.ogType ?? 'website'}">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${u.absUrl(page.path)}">
<meta property="og:site_name" content="${site.site.title}">
<meta property="og:locale" content="${site.site.locale ?? 'en'}">
<meta property="og:image" content="${ogAbs}">
<meta property="og:image:width" content="${page.ogImage.width}">
<meta property="og:image:height" content="${page.ogImage.height}">
<meta property="og:image:alt" content="${page.ogImage.alt || site.site.title}">
${page.ogVideo
    ? html`<meta property="og:video:url" content="${page.ogVideo.url}">
<meta property="og:video:secure_url" content="${page.ogVideo.url}">
<meta property="og:video:type" content="text/html">
<meta property="og:video:width" content="${String(page.ogVideo.width)}">
<meta property="og:video:height" content="${String(page.ogVideo.height)}">`
    : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" as="font" type="font/woff2" href="${u.url('assets/fonts/archivo-var.woff2')}" crossorigin>
<link rel="icon" href="${u.url('assets/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${u.url(`assets/css/style.css?v=${assets.cssHash}`)}">
${jsonLdScript(page.jsonLd ?? [])}`;
}

function header(page, ctx) {
  const { site, u } = ctx;
  return html`<header class="site-header">
  <div class="site-header__inner l-container">
    <a class="site-header__brand" href="${u.url('')}"${page.id === 'index' ? new Html(' aria-current="page"') : ''}>
      <span class="site-header__name">${site.identity.name}</span>
      <span class="site-header__role u-visually-hidden">${site.identity.role}</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <button class="site-nav__toggle" type="button" aria-expanded="false" aria-controls="site-nav-panel">
        <span class="u-visually-hidden">Menu</span>
        <span class="site-nav__bars" aria-hidden="true"></span>
      </button>
      <ul class="site-nav__panel" id="site-nav-panel">
        ${site.nav.map((n) => html`<li><a href="${u.url(n.path)}"${page.navMatch === n.path ? new Html(' aria-current="page"') : ''}>${n.label}</a></li>`)}
      </ul>
    </nav>
  </div>
</header>`;
}

function footer(ctx) {
  const { site, u } = ctx;
  const year = String(site.site.updated).slice(0, 4);
  return html`<footer class="site-footer">
  <div class="site-footer__inner l-container">
    <p class="site-footer__copy">© ${year} ${site.identity.name}</p>
    <ul class="site-footer__links l-cluster">
      ${site.nav.map((n) => html`<li><a href="${u.url(n.path)}">${n.label}</a></li>`)}
      <li><a href="${u.extUrl(`mailto:${site.contact.email}`)}">Email</a></li>
      ${site.social.map((s) => html`<li><a href="${u.extUrl(s.url)}" rel="me noopener">${s.label}</a></li>`)}
    </ul>
  </div>
</footer>`;
}

function layout(page, ctx) {
  if (!isHtml(page.body)) throw new TypeError(`page "${page.id}": body must be an Html value`);
  const { site, u, assets } = ctx;
  return `<!doctype html>
<!-- GENERATED by build.mjs. Edit content/*.json, not this file. -->
<html lang="${site.site.locale ?? 'en'}" class="no-js">
<head>
${head(page, ctx)}
<script>document.documentElement.classList.replace('no-js','js')</script>
</head>
<body class="page page--${page.id}">
<a class="skip-link" href="#main">Skip to content</a>
${header(page, ctx)}
<main id="main" tabindex="-1">
${page.body}
</main>
${footer(ctx)}
<script type="module" src="${u.url(`assets/js/main.js?v=${assets.jsHash}`)}"></script>
</body>
</html>
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. SEO builders
   ═══════════════════════════════════════════════════════════════════════════ */

const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The site's own identity. An Organization when identity.person is set (the
 * site belongs to a studio), a Person when it is not (a solo filmmaker).
 * schema.org treats these very differently, so this is not a name swap.
 */
function identityNode(ctx) {
  const { site, u } = ctx;
  const isOrg = Boolean(site.identity.founders?.length);
  const node = {
    '@type': isOrg ? 'Organization' : 'Person',
    '@id': u.absUrl('about.html') + '#identity',
    name: site.identity.name,
    url: u.absUrl(''),
  };
  if (isOrg) node.founder = site.identity.founders.map((f) => founderRef(ctx, f));
  else {
    node.jobTitle = site.identity.role;
    node.knowsAbout = ['Directing', 'Editing', 'Narrative short film', 'Brand film', 'Animation'];
  }
  const bio = (site.identity.shortBio ?? []).join(' ').trim();
  if (bio && !/TODO/.test(bio)) node.description = bio;
  if (site.identity.portrait) node.image = ctx.ORIGIN + u.url(site.identity.portrait.src);
  if (site.social?.length) node.sameAs = site.social.map((s) => s.url);
  return node;
}

const identityRef = (ctx) => ({ '@id': ctx.u.absUrl('about.html') + '#identity' });

/**
 * The named human who directs the films. VideoObject.director expects a Person,
 * so an Organization cannot fill that slot — and festivals credit a director,
 * not a studio. Falls back to the identity when the site is one person.
 */
const founderRef = (ctx, f) => ({ '@id': ctx.u.absUrl('about.html') + '#' + slugify(f.name) });

/** One Person node per founder, each linked back to the studio. */
function founderNodes(ctx) {
  const { site, u } = ctx;
  return (site.identity.founders ?? []).map((f) => {
    const node = {
      '@type': 'Person',
      '@id': u.absUrl('about.html') + '#' + slugify(f.name),
      name: f.name,
      jobTitle: f.role,
      worksFor: identityRef(ctx),
    };
    if (f.bio) node.description = f.bio;
    if (f.director) node.knowsAbout = ['Directing', 'Editing', 'Narrative short film', 'Brand film', 'Animation'];
    return node;
  });
}

/**
 * Who gets the VideoObject.director credit. A studio cannot direct — schema.org
 * wants a Person there — so this resolves to the founder flagged as director,
 * falling back to the first, and to the identity itself for a solo site.
 */
function personNode(ctx) {
  const nodes = founderNodes(ctx);
  return nodes.length ? nodes : identityNode(ctx);
}

const personRef = (ctx) => {
  const fs = ctx.site.identity.founders ?? [];
  const director = fs.find((f) => f.director) ?? fs[0];
  return director
    ? { '@id': ctx.u.absUrl('about.html') + '#' + slugify(director.name) }
    : { '@id': ctx.u.absUrl('about.html') + '#identity' };
};

function videoObject(film, ctx) {
  const { u } = ctx;
  const node = {
    '@type': 'VideoObject',
    '@id': u.absUrl(filmPath(film)),
    name: film.title,
    description: film.logline,
    embedUrl: embedSrc(film.video).split('?')[0],
    url: u.absUrl(filmPath(film)),
    genre: TYPE_LABEL[film.type],
    inLanguage: ctx.site.site.locale ?? 'en',
    creator: identityRef(ctx),   // the studio produced it
    director: personRef(ctx),   // a person directed it
  };
  if (film.resolvedPoster) node.thumbnailUrl = [ctx.ORIGIN + film.resolvedPoster.src];
  if (film.published) node.uploadDate = film.published;         // omitted, never invented
  if (film.runtimeSeconds) node.duration = isoDuration(film.runtimeSeconds);
  // contentUrl is deliberately never emitted — the file is not hosted here.
  return node;
}

/** Home, then each step of the trail: [{ name, path }, ...]. */
function breadcrumb(trail, ctx) {
  const { u } = ctx;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: u.absUrl('') },
      ...trail.map((t, i) => ({ '@type': 'ListItem', position: i + 2, name: t.name, item: u.absUrl(t.path) })),
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. Pages
   ═══════════════════════════════════════════════════════════════════════════ */

function pageIndex(ctx) {
  const { site, films, clips, u } = ctx;
  const featured = films.filter((f) => f.featured);
  const hero = featured[0] ?? films[0] ?? null;
  const heroIndex = films.indexOf(hero);
  const next = hero ? films[(heroIndex + 1) % films.length] : null;
  const recent = films.filter((f) => f !== hero).slice(0, 3);
  const p = site.pages.index;
  const director = (site.identity.founders ?? []).find((f) => f.director) ?? null;
  const pad = (n) => String(n).padStart(2, '0');

  const jsonLd = [
    { '@type': 'WebSite', '@id': u.absUrl('') + '#website', url: u.absUrl(''), name: site.site.title, publisher: identityRef(ctx) },
    identityNode(ctx),
    ...[personNode(ctx)].flat(),
    ...(hero ? [videoObject(hero, ctx)] : []),
  ];

  const heroMeta = [TYPE_LABEL[hero?.type], hero?.year, formatRuntime(hero?.runtimeSeconds),
    director ? `Directed by ${director.name}` : null].filter(Boolean).join(' · ');

  const titleCard = hero ? html`<div class="title-card">
      <div class="title-card__main">
        <p class="eyebrow eyebrow--accent">Now showing · ${pad(heroIndex + 1)} / ${pad(films.length)}</p>
        <h1 class="title-card__title display">${hero.title}</h1>
        <p class="title-card__meta">${heroMeta}</p>
        <div class="title-card__actions">
          <span class="btn btn--primary btn--play" aria-hidden="true">${playGlyph()}Play</span>
          <a class="btn btn--ghost" href="${u.url(filmPath(hero))}">Film page</a>
        </div>
      </div>
      ${next ? html`<a class="title-card__next meta" href="${u.url(filmPath(next))}">Next<span>${next.title} →</span></a>` : ''}
    </div>` : null;

  const statement = (p.statement ?? '').replace('{count}', capitalise(numberWord(films.length)));

  return {
    id: 'index', path: '', navMatch: null,
    title: site.site.title,
    description: p.metaDescription,
    ogType: hero ? 'video.other' : 'website',
    ogVideo: hero ? { url: embedSrc(hero.video), ...ogVideoSize(hero.aspectRatio) } : null,
    ogImagePath: hero?.poster?.src ?? null,
    jsonLd,
    body: html`
${hero
      ? html`<section class="stage stage--hero" aria-label="Featured film">
  ${embed({ video: hero.video, poster: hero.resolvedPoster, title: hero.title, ratio: hero.aspectRatio, runtimeSeconds: hero.runtimeSeconds, eager: true, sizes: '100vw', noteGaps: hero.status === 'draft', overlay: titleCard })}
</section>`
      : html`<header class="page-head l-container l-stack"><h1 class="page-head__title">${site.identity.name}</h1></header>`}

<section class="statement l-container" aria-label="The studio">
  <div>
    <p class="statement__text display">${inline(statement)}</p>
    <p class="statement__actions">
      <a class="btn btn--primary" href="${u.url('work.html')}">See all work</a>
      <a class="btn btn--ghost" href="${u.url('hire.html')}">Work with us</a>
    </p>
  </div>
  <div class="statement__aside">
    ${inline(p.heroHeadline)}<br><br>
    ${(site.identity.founders ?? []).map((f) => html`<b>${f.name}</b> · ${f.role}<br>`)}
  </div>
</section>

${films.length
      ? html`<section class="reel" aria-labelledby="reel-heading">
  <div class="l-container reel__head">
    <h2 class="eyebrow" id="reel-heading">The reel · all ${numberWord(films.length)}</h2>
    <div class="reel__nav" data-reel-nav>
      <button class="reel__btn" type="button" data-reel-prev aria-label="Previous films"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2L4 8l6 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
      <button class="reel__btn" type="button" data-reel-next aria-label="Next films"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
    </div>
  </div>
  <div class="reel__track" tabindex="0" role="region" aria-label="All films, scrolls sideways" data-reel>
    ${films.map((f) => html`<div class="reel__item${parseRatio(f.aspectRatio).portrait ? ' reel__item--portrait' : ''}">
      ${frame(f, ctx, { sizes: '(min-width: 46rem) 34rem, 22rem', label: true })}
    </div>`)}
  </div>
</section>`
      : ''}

${recent.length
      ? html`<section class="section l-container" aria-labelledby="recent-heading">
  <div class="section__head-row">
    <h2 class="section__heading" id="recent-heading">Recent</h2>
    <a class="section__more" href="${u.url('work.html')}">All work →</a>
  </div>
  <div class="recent">
    <div class="recent__lead">
      ${frame(recent[0], ctx, { sizes: '(min-width: 60rem) 56rem, 100vw', vt: false })}
      <div class="recent__lead-card">
        <p class="display">${recent[0].title}</p>
        <p class="meta">${[TYPE_LABEL[recent[0].type], recent[0].year, formatRuntime(recent[0].runtimeSeconds)].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
    <div class="recent__side">
      ${recent.slice(1).map((f) => html`<div>${frame(f, ctx, { sizes: '(min-width: 60rem) 30rem, 45vw', vt: false, label: true })}</div>`)}
    </div>
  </div>
</section>`
      : ''}

<section class="strip" aria-labelledby="how-heading">
  <div class="l-container">
    <div class="strip__head">
      <h2 class="eyebrow" id="how-heading">How it gets made</h2>
      <a class="section__more" href="${u.url('process.html')}">${clips.length ? 'Read the breakdowns →' : 'Process →'}</a>
    </div>
    <ol class="strip__list">
      ${site.processSteps.map((s) => html`<li class="strip__item">
        <span class="strip__n" aria-hidden="true">${String(s.n).padStart(2, '0')}</span>
        <h3 class="strip__title">${s.title}</h3>
        <p class="strip__body">${inline((s.body?.[0] ?? '').split(/(?<=[.!?])\s/)[0])}</p>
      </li>`)}
    </ol>
  </div>
</section>

<div class="l-container">${contactBand(ctx, { eyebrow: 'Commissions', heading: site.pages.hire.intro?.[0] ?? 'Get in touch' })}</div>`,
  };
}

/* ── Work: the contact sheet ────────────────────────────────────────────── */

const isPortrait = (f) => parseRatio(f.aspectRatio).portrait;

function workFilters(ctx) {
  const { films } = ctx;
  const types = [...new Set(films.map((f) => f.type))]
    .filter((t) => films.filter((f) => f.type === t).length >= 2)
    .sort();
  const filters = types.map((t) => ({ key: t, label: TYPE_LABEL[t], path: `work-${t}.html`, count: films.filter((f) => f.type === t).length }));
  const vertical = films.filter(isPortrait).length;
  if (vertical >= 2) filters.push({ key: 'vertical', label: 'Vertical', path: 'work-vertical.html', count: vertical });
  return filters;
}

function workBody(ctx, list, active) {
  const { site, u, films } = ctx;
  const p = site.pages.work;
  const filters = workFilters(ctx);

  return html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
  ${prose(p.intro, 'page-head__intro')}
</header>

${filters.length
      ? html`<nav class="filter-bar l-container" aria-label="Filter by type">
  <ul class="l-cluster" data-filter-bar>
    <li><a href="${u.url('work.html')}" data-filter="all"${!active ? new Html(' aria-current="page"') : ''}>All <b>${films.length}</b></a></li>
    ${filters.map((f) => html`<li><a href="${u.url(f.path)}" data-filter="${f.key}"${active === f.key ? new Html(' aria-current="page"') : ''}>${f.label} <b>${f.count}</b></a></li>`)}
  </ul>
  <p class="filter-bar__status u-visually-hidden" role="status" data-filter-status></p>
</nav>`
      : ''}

${list.length
      ? html`<div class="sheet u-bleed" data-film-list>
  ${list.map((f) => filmTile(f, ctx))}
</div>`
      : html`<div class="l-container"><p class="u-muted">${p.emptyState}</p></div>`}

<div class="l-container">${contactBand(ctx, { eyebrow: 'Commissions', heading: 'Want something like this?' })}</div>`;
}

function pageWork(ctx) {
  const { site, films, u } = ctx;
  const p = site.pages.work;
  return {
    id: 'work', path: 'work.html', navMatch: 'work.html',
    title: `Work — ${site.identity.name}`,
    description: p.metaDescription,
    ogImagePath: films[0]?.poster?.src ?? null,
    jsonLd: [
      identityNode(ctx), ...[personNode(ctx)].flat(),
      {
        '@type': 'ItemList',
        itemListElement: films.map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: u.absUrl(filmPath(f)) })),
      },
      breadcrumb([{ name: 'Work', path: 'work.html' }], ctx),
    ],
    body: workBody(ctx, films, null),
  };
}

function pageWorkFiltered(ctx, filter) {
  const { site, films } = ctx;
  const list = filter.key === 'vertical' ? films.filter(isPortrait) : films.filter((f) => f.type === filter.key);
  return {
    id: 'work', path: filter.path, navMatch: 'work.html',
    title: `${filter.label} — ${site.identity.name}`,
    description: filter.key === 'vertical'
      ? `Vertical films by ${site.identity.name}, made for the phone.`
      : `${filter.label} work by ${site.identity.name}.`,
    ogImagePath: list[0]?.poster?.src ?? null,
    jsonLd: [
      identityNode(ctx), ...[personNode(ctx)].flat(),
      { '@type': 'ItemList', itemListElement: list.map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.u.absUrl(filmPath(f)) })) },
      breadcrumb([{ name: 'Work', path: 'work.html' }, { name: filter.label, path: filter.path }], ctx),
    ],
    body: workBody(ctx, list, filter.key),
  };
}

/* ── Film page: one per film ────────────────────────────────────────────── */

function pageFilm(ctx, film) {
  const { site, films, u } = ctx;
  const i = films.indexOf(film);
  const prev = films[(i - 1 + films.length) % films.length];
  const next = films[(i + 1) % films.length];
  const portrait = isPortrait(film);
  const director = (site.identity.founders ?? []).find((f) => f.director) ?? null;
  const pad = (n) => String(n).padStart(2, '0');

  // Related: the same strand first — vertical explainers keep company with
  // each other — then the same type, never itself, three at most.
  const others = films.filter((f) => f !== film);
  const related = [
    ...others.filter((f) => f.type === film.type && isPortrait(f) === portrait),
    ...others.filter((f) => f.type === film.type && isPortrait(f) !== portrait),
    ...others.filter((f) => f.type !== film.type),
  ].filter((f, k, arr) => arr.indexOf(f) === k).slice(0, 3);
  const relatedLabel = others.some((f) => f.type === film.type)
    ? `More ${TYPE_LABEL[film.type].toLowerCase()}${portrait && others.some((f) => f.type === film.type && isPortrait(f)) ? ', vertical' : ''}`
    : 'More films';

  const credits = [];
  if (director) credits.push({ k: 'Director', v: html`<a href="${u.url('about.html')}#${slugify(director.name)}">${director.name}</a>` });
  if (film.roles?.length) credits.push({ k: film.roles.length > 1 ? 'Roles' : 'Role', v: film.roles.join(', ') });
  if (film.client) credits.push({ k: 'Client', v: film.client });
  for (const c of film.collaborators ?? []) credits.push({ k: c.role, v: c.name });
  credits.push({ k: 'Studio', v: site.identity.name });
  credits.push({ k: 'Year', v: String(film.year) });
  credits.push({ k: 'Format', v: `${film.aspectRatio ?? '16:9'}${portrait ? ' · vertical' : ''}` });
  if (film.runtimeSeconds) credits.push({ k: 'Runtime', v: `${formatRuntime(film.runtimeSeconds)} · ${spokenRuntime(film.runtimeSeconds)}` });
  if (film.published) credits.push({ k: 'Published', v: film.published });

  const eyebrow = [TYPE_LABEL[film.type], portrait ? 'Vertical' : null, film.year].filter(Boolean).join(' · ');
  const stageEmbed = embed({
    video: film.video, poster: film.resolvedPoster, title: film.title, ratio: film.aspectRatio,
    runtimeSeconds: film.runtimeSeconds, eager: true, sizes: portrait ? '30rem' : '100vw',
    noteGaps: film.status === 'draft', vtName: `film-${film.id}`,
  });

  return {
    id: 'film', path: filmPath(film), navMatch: 'work.html',
    title: `${film.title} — ${site.identity.name}`,
    description: film.logline,
    ogType: 'video.other',
    ogVideo: { url: embedSrc(film.video), ...ogVideoSize(film.aspectRatio) },
    ogImagePath: film.poster?.src ?? null,
    lastmod: film.published ?? null,
    jsonLd: [
      identityNode(ctx), ...[personNode(ctx)].flat(),
      videoObject(film, ctx),
      breadcrumb([{ name: 'Work', path: 'work.html' }, { name: film.title, path: filmPath(film) }], ctx),
    ],
    body: html`
${portrait
      ? html`<section class="stage stage--portrait" aria-label="The film">
  ${film.resolvedPoster ? html`<img class="stage__bg" src="${film.resolvedPoster.src}" alt="" aria-hidden="true" loading="eager" decoding="async">` : ''}
  ${stageEmbed}
  <p class="stage__note stage__note--start">Film ${pad(i + 1)} / ${pad(films.length)}</p>
  <p class="stage__note stage__note--end">${film.aspectRatio} · Made for the phone</p>
</section>`
      : html`<section class="stage stage--plain" aria-label="The film">
  ${stageEmbed}
</section>`}

<section class="film-head l-container">
  <div class="film-head__main">
    <p class="eyebrow eyebrow--accent">${eyebrow}</p>
    <h1 class="film-head__title display">${film.title}</h1>
    <p class="film-head__lede">${inline(film.logline)}</p>
    ${laurelRow(film.laurels, site)}
    <div class="film-head__actions">
      <a class="btn btn--primary" href="${watchUrl(film.video)}" rel="noopener" data-play-embed>${playGlyph()}Play</a>
      <a class="btn btn--ghost" href="${watchUrl(film.video)}" rel="noopener">Watch on ${film.video.platform === 'youtube' ? 'YouTube' : 'Vimeo'}</a>
    </div>
  </div>
  <dl class="credits" aria-label="Credits">
    ${credits.map((c) => html`<div class="credits__row"><dt>${c.k}</dt><dd>${c.v}</dd></div>`)}
  </dl>
</section>

${film.synopsis?.length
      ? html`<section class="section section--split l-container" aria-labelledby="about-film-heading">
  <h2 class="section__heading" id="about-film-heading">About the film</h2>
  ${prose(film.synopsis, 'prose prose--columns')}
</section>`
      : ''}

${related.length
      ? html`<section class="section l-container related" aria-labelledby="related-heading">
  <div class="section__head-row">
    <h2 class="section__heading" id="related-heading">${relatedLabel}</h2>
    <a class="section__more" href="${u.url('work.html')}">All work →</a>
  </div>
  <div class="related__list">
    ${related.map((f) => html`<div class="related__item${isPortrait(f) ? ' related__item--portrait' : ''}">
      ${frame(f, ctx, { sizes: '(min-width: 46rem) 28rem, 90vw', label: true })}
    </div>`)}
  </div>
</section>`
      : ''}

<nav class="pager l-container" aria-label="Previous and next film">
  <a href="${u.url(filmPath(prev))}"><span class="eyebrow">← Previous</span><span class="pager__title display">${prev.title}</span></a>
  <a class="pager__next" href="${u.url(filmPath(next))}"><span class="eyebrow">Next →</span><span class="pager__title display">${next.title}</span></a>
</nav>

<div class="l-container">${contactBand(ctx, { eyebrow: 'Commissions', heading: 'Want something like this?' })}</div>`,
  };
}

/* ── Process, Hire, About, 404 ──────────────────────────────────────────── */

function pageProcess(ctx) {
  const { site, clips, films, u } = ctx;
  const p = site.pages.process;
  return {
    id: 'process', path: 'process.html', navMatch: 'process.html',
    title: `Process — ${site.identity.name}`,
    description: p.metaDescription,
    ogImagePath: clips[0]?.poster?.src ?? null,
    jsonLd: [identityNode(ctx), ...[personNode(ctx)].flat(), breadcrumb([{ name: 'Process', path: 'process.html' }], ctx)],
    body: html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
  ${prose(p.intro, 'page-head__intro')}
</header>

<section class="section l-container" aria-labelledby="steps-heading">
  <h2 class="u-visually-hidden" id="steps-heading">The four stages</h2>
  <ol class="timeline">
    ${site.processSteps.map((s) => html`<li class="timeline__step">
      <span class="timeline__n" aria-hidden="true">${String(s.n).padStart(2, '0')}</span>
      <div class="timeline__body">
        <h3 class="timeline__title">${s.title}</h3>
        ${prose(s.body)}
      </div>
    </li>`)}
  </ol>
</section>

${clips.length
      ? html`<section class="section l-container l-stack" aria-labelledby="clips-heading">
  <h2 class="section__heading" id="clips-heading">Breakdowns</h2>
  ${clips.map((c) => {
        const film = c.filmId ? films.find((f) => f.id === c.filmId) : null;
        return html`<article class="process-clip l-stack" id="${c.id}">
      ${embed({ video: c.video, poster: c.resolvedPoster, title: c.title, ratio: c.aspectRatio, runtimeSeconds: c.durationSeconds, noteGaps: c.status === 'draft' })}
      <div class="process-clip__body l-stack">
        <h3 class="process-clip__title">${c.title}</h3>
        ${prose(c.summary)}
        ${c.beats?.length
          ? html`<dl class="meta-list">
            ${c.beats.map((b) => html`<div class="meta-list__row"><dt>${b.label}</dt><dd>${inline(b.body)}</dd></div>`)}
          </dl>`
          : ''}
        ${film ? html`<p class="process-clip__from">From <a href="${u.url(filmPath(film))}">${film.title}</a></p>` : ''}
      </div>
    </article>`;
      })}
</section>`
      : ''}

<div class="l-container">${contactBand(ctx, { eyebrow: 'Commissions' })}</div>`,
  };
}

function pageHire(ctx) {
  const { site } = ctx;
  const p = site.pages.hire;
  const offers = site.services.map((s) => {
    const offer = { '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title, description: s.summary } };
    if (s.startingAt) {
      offer.priceSpecification = { '@type': 'PriceSpecification', minPrice: s.startingAt.amount, priceCurrency: s.startingAt.currency };
    }
    return offer;                                      // no priceSpecification when there is no rate
  });
  const seller = identityNode(ctx);
  seller.makesOffer = offers;

  return {
    id: 'hire', path: 'hire.html', navMatch: 'hire.html',
    title: `Hire — ${site.identity.name}`,
    description: p.metaDescription,
    ogImagePath: null,
    jsonLd: [seller, ...[personNode(ctx)].flat(), breadcrumb([{ name: 'Hire', path: 'hire.html' }], ctx)],
    body: html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
  ${prose(p.intro, 'page-head__intro')}
  ${site.contact.availability ? html`<p class="page-head__note">${inline(site.contact.availability)}</p>` : ''}
</header>

<section class="section l-container l-stack" aria-labelledby="services-heading">
  <h2 class="section__heading" id="services-heading">What we make</h2>
  <ul class="offers">
    ${site.services.map((s) => html`<li class="offer">
      <h3 class="offer__title">${s.title}</h3>
      <p class="offer__summary">${inline(s.summary)}</p>
      <div>
        ${s.deliverables?.length ? html`<ul class="offer__list">${s.deliverables.map((d) => html`<li>${inline(d)}</li>`)}</ul>` : ''}
        ${s.timeline ? html`<p class="offer__meta">${inline(s.timeline)}</p>` : ''}
        ${s.startingAt ? html`<p class="offer__meta">From ${s.startingAt.currency} ${s.startingAt.amount}</p>` : ''}
      </div>
    </li>`)}
  </ul>
</section>

<section class="strip" aria-labelledby="how-heading">
  <div class="l-container">
    <div class="strip__head"><h2 class="eyebrow" id="how-heading">How it goes</h2></div>
    <ol class="strip__list">
      ${site.processSteps.map((s) => html`<li class="strip__item">
        <span class="strip__n" aria-hidden="true">${String(s.n).padStart(2, '0')}</span>
        <h3 class="strip__title">${s.title}</h3>
      </li>`)}
    </ol>
  </div>
</section>

<div class="l-container">${contactBand(ctx, { eyebrow: 'Start a project', heading: 'Tell us what you need and roughly when.', aside: false })}</div>`,
  };
}

function pageAbout(ctx) {
  const { site } = ctx;
  const p = site.pages.about;
  return {
    id: 'about', path: 'about.html', navMatch: 'about.html',
    title: `About — ${site.identity.name}`,
    description: p.metaDescription,
    ogImagePath: site.identity.portrait?.src ?? null,
    jsonLd: [identityNode(ctx), ...[personNode(ctx)].flat(), breadcrumb([{ name: 'About', path: 'about.html' }], ctx)],
    body: html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
</header>

${site.identity.portrait && site.identity.portraitWide
      ? html`<figure class="about-figure l-container">
    <img src="${ctx.u.url(site.identity.portrait.src)}" alt="${site.identity.portrait.alt}"
      width="${site.identity.portraitSize.width}" height="${site.identity.portraitSize.height}"
      loading="lazy" decoding="async">
    ${site.identity.portrait.caption
        ? html`<figcaption>${inline(site.identity.portrait.caption)}</figcaption>` : ''}
  </figure>`
      : ''}

${site.identity.portrait && !site.identity.portraitWide
      ? html`<section class="section l-container about about--split">
  <img class="about__portrait" src="${ctx.u.url(site.identity.portrait.src)}"
      alt="${site.identity.portrait.alt}" width="${site.identity.portraitSize.width}"
      height="${site.identity.portraitSize.height}" loading="lazy" decoding="async">
  <div class="about__body l-stack">
    ${prose(site.identity.longBio)}
    ${site.identity.location ? html`<p class="u-muted">Based in ${site.identity.location}.</p>` : ''}
  </div>
</section>`
      : html`<section class="section section--split l-container" aria-labelledby="studio-heading">
  <h2 class="section__heading" id="studio-heading">The studio</h2>
  <div class="about__body l-stack">
    ${prose(site.identity.longBio, 'prose prose--lede')}
    ${site.identity.location ? html`<p class="u-muted">Based in ${site.identity.location}.</p>` : ''}
  </div>
</section>`}

${site.identity.founders?.length
      ? html`<section class="section l-container l-stack" aria-labelledby="founders-heading">
  <h2 class="section__heading" id="founders-heading">Founders</h2>
  <ul class="founders">
    ${site.identity.founders.map((f) => html`<li class="founder" id="${slugify(f.name)}">
      <h3 class="founder__name">${f.name}</h3>
      <p class="founder__role">${f.role}</p>
      ${f.bio ? html`<p class="founder__bio">${inline(f.bio)}</p>` : ''}
    </li>`)}
  </ul>
</section>`
      : ''}

${site.credits?.length
      ? html`<section class="section l-container l-stack" aria-labelledby="credits-heading">
  <h2 class="section__heading" id="credits-heading">Credits</h2>
  <dl class="meta-list">
    ${site.credits.map((c) => html`<div class="meta-list__row"><dt>${c.year ?? ''}</dt><dd>${c.title}${c.role ? ` — ${c.role}` : ''}</dd></div>`)}
  </dl>
</section>`
      : ''}

${site.laurels?.length
      ? html`<section class="section l-container l-stack" aria-labelledby="laurels-heading">
  <h2 class="section__heading" id="laurels-heading">Selections</h2>
  ${laurelRow(site.laurels.map((l) => l.id), site)}
</section>`
      : ''}

<div class="l-container">${contactBand(ctx, { eyebrow: 'Commissions' })}</div>`,
  };
}

function pageNotFound(ctx) {
  const { site, u } = ctx;
  const p = site.pages.notFound;
  return {
    id: 'notfound', path: '404.html', navMatch: null,
    title: `Not found — ${site.identity.name}`,
    description: p.heading,
    ogImagePath: null,
    noIndex: true,
    jsonLd: [],
    body: html`
<section class="page-head l-container l-stack">
  <h1 class="page-head__title">${p.heading}</h1>
  ${prose(p.body, 'page-head__intro')}
  <p class="l-cluster">
    <a class="btn btn--primary" href="${u.url('')}">Home</a>
    <a class="btn btn--ghost" href="${u.url('work.html')}">Work</a>
  </p>
</section>`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. Machine-readable files
   ═══════════════════════════════════════════════════════════════════════════ */

function sitemap(pages, ctx) {
  const { site, u } = ctx;
  const rows = pages
    .filter((p) => !p.noIndex)
    .map((p) => {
      const lastmod = p.lastmod ?? site.site.updated;
      return `  <url>\n    <loc>${xmlEscape(u.absUrl(p.path))}</loc>\n    <lastmod>${xmlEscape(lastmod)}</lastmod>\n  </url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

const AI_AGENTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended',
];

function robots(ctx) {
  const blocks = ['User-agent: *', 'Allow: /', ''];
  for (const a of AI_AGENTS) blocks.push(`User-agent: ${a}`, 'Allow: /', '');
  blocks.push(`Sitemap: ${ctx.u.absUrl('sitemap.xml')}`, '');
  return blocks.join('\n');
}

function llmsTxt(ctx) {
  const { site, films, clips, u } = ctx;
  const L = [];
  L.push(`# ${site.identity.name} — ${site.identity.role}`, '');
  L.push(`> ${site.site.description}`, '');

  if (films.length) {
    L.push('## Work', '');
    for (const f of films) {
      const bits = [f.year, TYPE_LABEL[f.type], formatRuntime(f.runtimeSeconds)].filter(Boolean).join(', ');
      L.push(`- [${f.title} (${bits})](${u.absUrl(filmPath(f))}): ${f.logline}`);
    }
    L.push('');
  }
  if (clips.length) {
    L.push('## Process', '');
    for (const c of clips) {
      const first = (c.summary?.[0] ?? '').split('. ')[0];
      L.push(`- [${c.title}](${u.absUrl('process.html')}#${c.id}): ${first}`);
    }
    L.push('');
  }
  if (site.services?.length) {
    L.push('## Services', '');
    for (const s of site.services) L.push(`- ${s.title}: ${s.summary}`);
    L.push('');
  }
  L.push('## Contact', '');
  L.push(`- Email: ${site.contact.email}`);
  L.push(`- Site: ${u.absUrl('')}`);
  for (const s of site.social ?? []) L.push(`- ${s.label}: ${s.url}`);
  L.push('');
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   12. Audit — turns the design's rules into enforcement.
   ═══════════════════════════════════════════════════════════════════════════ */

const URL_ATTR = /\s(?:href|src|poster|data-watch-url)="([^"]*)"/g;
const SRCSET_ATTR = /\ssrcset="([^"]*)"/g;
const STYLE_ATTR = /\sstyle="([^"]*)"/g;

function auditPage(id, out, ctx) {
  const { BASE } = ctx.u;
  const bad = [];

  const checkUrl = (value, label) => {
    if (/^(https?:)?\/\//.test(value)) return;
    if (/^(mailto:|tel:|#|data:)/.test(value)) return;
    if (!value.startsWith('/')) bad.push(`${label}="${value}" — not BASE-anchored`);
    else if (!value.startsWith(BASE)) bad.push(`${label}="${value}" — root-absolute but missing BASE (${BASE})`);
  };

  for (const [, v] of out.matchAll(URL_ATTR)) checkUrl(v, 'url attr');
  for (const [, v] of out.matchAll(SRCSET_ATTR)) {
    for (const part of v.split(',')) checkUrl(part.trim().split(/\s+/)[0], 'srcset');
  }
  // Two declarations may reach a style attribute, alone or together: the
  // embed's aspect ratio, and a view-transition name built from a film slug.
  // Anything else is content leaking into presentation.
  const STYLE_OK = [/^--embed-ratio: [\d./ ]+$/, /^view-transition-name: film-[a-z0-9-]+$/];
  for (const [, v] of out.matchAll(STYLE_ATTR)) {
    const parts = v.split(/;\s*/).filter(Boolean);
    if (!parts.length || !parts.every((p) => STYLE_OK.some((re) => re.test(p)))) {
      bad.push(`style="${v}" — only --embed-ratio and view-transition-name: film-<slug> may reach a style attribute`);
    }
  }

  // JSON-LD must be unicode-escaped, never HTML-escaped, and must never break out.
  for (const [, body] of out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    if (body.includes('</')) bad.push('JSON-LD contains "</" — script breakout risk');
    try { JSON.parse(body.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')); }
    catch (e) { bad.push(`JSON-LD does not parse: ${e.message}`); }
  }

  const count = (re) => (out.match(re) ?? []).length;
  if (count(/<main[\s>]/g) !== 1) bad.push(`expected exactly one <main>, found ${count(/<main[\s>]/g)}`);
  if (count(/<h1[\s>]/g) !== 1) bad.push(`expected exactly one <h1>, found ${count(/<h1[\s>]/g)}`);
  for (const [tag] of out.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(tag)) bad.push(`<img> without alt: ${tag.slice(0, 90)}`);
  }
  if (/tabindex="[1-9]/.test(out)) bad.push('positive tabindex found');
  if (!/<html lang="/.test(out)) bad.push('<html> is missing lang');

  if (bad.length) throw new Error(`[${id}] audit failed:\n  ` + bad.join('\n  '));
}

/* ═══════════════════════════════════════════════════════════════════════════
   13. Pipeline
   ═══════════════════════════════════════════════════════════════════════════ */

function sortFilms(a, b) {
  return (a.order ?? 1000) - (b.order ?? 1000) || b.year - a.year || a.id.localeCompare(b.id);
}

async function buildOnce({ base, includeDrafts, strict, quiet }) {
  const rep = new Report();

  const site = await loadJson('content/site.json');
  const filmsDoc = await loadJson('content/films.json');
  const processDoc = await loadJson('content/process.json');

  validate(site, filmsDoc, processDoc, rep);
  lintContent(site, 'site', rep);
  lintContent(filmsDoc, 'films', rep);
  lintContent(processDoc, 'process', rep);

  if (!rep.ok) throw new ReportError(rep);

  const origin = process.env.SITE_ORIGIN || site.site.origin;
  const u = makeUrls({ base, origin });

  // A film with no video id has nothing to embed, so it never renders — not
  // even under --drafts. See validateVideo's allowPending.
  let films = (filmsDoc.films ?? [])
    .filter((f) => f.video?.id)
    .filter((f) => includeDrafts || (f.status ?? 'published') === 'published');
  films = films.slice().sort(sortFilms);
  let clips = (processDoc.clips ?? []).filter((c) => includeDrafts || (c.status ?? 'published') === 'published');
  clips = clips.slice().sort((a, b) => a.order - b.order);

  // process.html renders the four processSteps whether or not any clip ships,
  // so a fully-drafted process.json produces a page that looks finished while
  // promising craft breakdowns it does not contain. Nothing caught that.
  if ((processDoc.clips ?? []).length && !clips.length) {
    rep.warn('process.clips', `all ${(processDoc.clips ?? []).length} clips are drafts — process.html ships with none. Check site.pages.process.intro does not promise them`);
  }

  if (films.length && !films.some((f) => f.featured)) {
    rep.error('films', 'no film has "featured": true — the home page has no hero without one');
    throw new ReportError(rep);
  }

  const ctx = { site, films, clips, u, ORIGIN: u.ORIGIN, rep, assets: {} };

  // Assets
  for (const f of films) {
    const poster = f.poster ?? await autoPoster(f.id, 'assets/stills');
    if (!poster) {
      // Named separately from the generic gap report because a missing poster
      // also strips thumbnailUrl from the film's VideoObject, and Google
      // requires it for video rich results. A poster-less film is invisible
      // to video search, not merely plain-looking.
      const want = (f.aspectRatio ?? '16:9').startsWith('9:') ? '1080' : '1920';
      rep.warn(`films[${f.id}].poster`,
        `no poster — add assets/stills/${f.id}-${want}.jpg. Without one this film ships no thumbnailUrl and cannot earn a video rich result`);
    }
    // Write the auto-detected poster back, so page templates reading `poster.src`
    // for ogImagePath see it too. Without this, every film relying on filename
    // detection has poster === null and every page falls back to site.ogImage.
    // Must be the raw repo-relative path: resolveOg() does its own assetExists()
    // and url(), so a BASE-prefixed resolvedPoster.src would silently fail.
    f.poster = poster;
    f.resolvedPoster = await resolvePoster(poster, ctx, `films[${f.id}].poster`);
    f.strip = await resolveStrip(f, ctx);
  }
  for (const c of clips) {
    const poster = c.poster ?? await autoPoster(c.id, 'assets/process');
    if (!poster) rep.warn(`process.clips[${c.id}].poster`, `no poster — add assets/process/${c.id}-1920.jpg`);
    c.poster = poster;
    c.resolvedPoster = await resolvePoster(poster, ctx, `process.clips[${c.id}].poster`);
  }
  // Portrait follows the same convention as posters: assets/portrait.<ext> if
  // nothing is set in JSON. A missing portrait warns; it never fails the build.
  if (!site.identity.portrait) {
    // assets/stills/ first, so every image in the site has one place to live.
    const found = (await autoPoster('portrait', 'assets/stills'))
      ?? (await autoPoster('portrait', 'assets'));
    if (found) site.identity.portrait = { src: found.src, alt: '', caption: null };
  }
  if (site.identity.portrait) {
    if (!(await assetExists(site.identity.portrait.src))) {
      rep.warn('site.identity.portrait.src', `not found, skipping: ${site.identity.portrait.src}`);
      site.identity.portrait = null;
    } else {
      site.identity.portraitSize = await imageSize(site.identity.portrait.src);
      // A landscape image in an 18rem column looks broken. Let the shape pick the layout.
      site.identity.portraitWide =
        site.identity.portraitSize.width / site.identity.portraitSize.height > 1.2;
    }
  }
  if (!(await assetExists('assets/css/style.css'))) rep.error('assets', 'assets/css/style.css is missing');
  if (!(await assetExists('assets/js/main.js'))) rep.error('assets', 'assets/js/main.js is missing');
  if (!rep.ok) throw new ReportError(rep);

  ctx.assets.cssHash = await hashFile('assets/css/style.css');
  ctx.assets.jsHash = await hashFile('assets/js/main.js');

  // OG image: hard-fail if missing or too small. Never generated — SVG is refused by every platform.
  const ogFallback = site.site.ogImage;
  if (!(await assetExists(ogFallback))) {
    rep.error('site.site.ogImage', `not found: ${ogFallback} — social shares need a real JPEG or PNG`);
    throw new ReportError(rep);
  }
  const ogFallbackSize = await imageSize(ogFallback);
  if (ogFallbackSize.width < 1200 || ogFallbackSize.height < 630) {
    rep.error('site.site.ogImage', `is ${ogFallbackSize.width}×${ogFallbackSize.height}; needs at least 1200×630`);
    throw new ReportError(rep);
  }

  const resolveOg = async (relPath, alt) => {
    if (relPath && await assetExists(relPath)) {
      const size = await imageSize(relPath);
      if (size.width >= 1200 && size.height >= 630) return { src: u.url(relPath), ...size, alt: alt ?? '' };
    }
    return { src: u.url(ogFallback), ...ogFallbackSize, alt: site.site.title };
  };

  // Pages. The registry drives rendering AND the sitemap, so a page cannot be built but unlisted.
  const registry = [pageIndex, pageWork, pageProcess, pageHire, pageAbout];
  const descriptors = registry.map((fn) => fn(ctx));
  for (const filter of workFilters(ctx)) descriptors.push(pageWorkFiltered(ctx, filter));
  // One page per film. The registry drives the sitemap, so every film page is listed.
  for (const f of films) descriptors.push(pageFilm(ctx, f));
  descriptors.push(pageNotFound(ctx));

  const newestFilm = films.map((f) => f.published).filter(Boolean).sort().at(-1);
  for (const d of descriptors) {
    // Work's lastmod is the newest film publish date, but never older than
    // site.updated — films added without a `published` date still changed the
    // page, and reporting a stale date tells crawlers not to bother re-reading.
    if (d.path === 'work.html') {
      d.lastmod = [newestFilm, site.site.updated].filter(Boolean).sort().at(-1);
    }
    d.ogImage = await resolveOg(d.ogImagePath, d.title);
  }

  const rendered = descriptors.map((d) => ({ d, out: layout(d, ctx) }));
  for (const { d, out } of rendered) auditPage(d.id + ':' + (d.path || 'index'), out, ctx);

  if (strict && rep.warnings.length) {
    rep.warnings.forEach((w) => rep.error(w.path, w.msg));
    throw new ReportError(rep);
  }

  return { ctx, descriptors, rendered, rep, site, films, clips, u };
}

class ReportError extends Error {
  constructor(rep) {
    const lines = [];
    lines.push(`Content validation failed (${rep.errors.length} error${rep.errors.length === 1 ? '' : 's'}, ${rep.warnings.length} warning${rep.warnings.length === 1 ? '' : 's'}):`, '');
    const pad = Math.min(38, Math.max(0, ...rep.errors.map((e) => e.path.length)));
    for (const e of [...rep.errors].sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(`  ERROR  ${e.path.padEnd(pad)} — ${e.msg}`);
    }
    for (const w of rep.warnings) lines.push(`  WARN   ${w.path.padEnd(pad)} — ${w.msg}`);
    super(lines.join('\n'));
    this.name = 'ContentError';
    this.report = rep;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const includeDrafts = argv.includes('--drafts');
  const strict = argv.includes('--strict');
  const check = argv.includes('--check');
  const base = process.env.BASE_PATH ?? DEFAULT_BASE;

  const result = await buildOnce({ base, includeDrafts, strict });
  const { rendered, rep, ctx, descriptors, site, films, clips } = result;

  // Probe build: a BASE of "/" would mask a hardcoded "/assets/…". This catches it.
  if (check) {
    await buildOnce({ base: '/__probe__/', includeDrafts, strict, quiet: true });
    console.log('✓ probe build at /__probe__/ passed — no hardcoded root paths');
  }

  await mkdir(OUT, { recursive: true });
  if (OUT !== ROOT) {
    // A separate output dir needs the static assets carried across; serving
    // HTML without them is the classic "site loads but has no styling".
    await copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));
    await writeFile(path.join(OUT, '.nojekyll'), '', 'utf8');
  }
  for (const { d, out } of rendered) {
    const dest = path.join(OUT, d.path || 'index.html');
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, out, 'utf8');
  }
  await writeFile(path.join(OUT, 'sitemap.xml'), sitemap(descriptors, ctx), 'utf8');
  await writeFile(path.join(OUT, 'robots.txt'), robots(ctx), 'utf8');
  await writeFile(path.join(OUT, 'llms.txt'), llmsTxt(ctx), 'utf8');

  // ---- report
  const pageCount = rendered.length;
  console.log(`✓ ${pageCount} pages, ${films.length} film${films.length === 1 ? '' : 's'}, ${clips.length} process clip${clips.length === 1 ? '' : 's'}`);
  console.log(`  base ${ctx.u.BASE}   origin ${ctx.ORIGIN}`);
  if (OUT !== ROOT) console.log(`  output ${path.relative(ROOT, OUT) || '.'}/`);
  if (includeDrafts) console.log('  ⚠ --drafts: draft entries are INCLUDED. Do not commit this output.');

  if (rep.warnings.length) {
    console.log(`\n${rep.warnings.length} warning${rep.warnings.length === 1 ? '' : 's'}:`);
    const pad = Math.min(38, Math.max(0, ...rep.warnings.map((w) => w.path.length)));
    for (const w of rep.warnings) console.log(`  WARN  ${w.path.padEnd(pad)} — ${w.msg}`);
  }

  // Collected from the UNFILTERED documents. Reporting only what shipped hid
  // every TODO sitting in a draft, which is precisely where unfinished content
  // lives — the report was quietest exactly when it had most to say.
  // filmsDoc/processDoc are local to buildOnce(); re-read them here rather than
  // widening that scope, which is also what the draft report below already does.
  const allFilms = (await loadJson('content/films.json')).films ?? [];
  const allClips = (await loadJson('content/process.json')).clips ?? [];

  const gaps = [];
  const strip = (o) => ({ ...o, resolvedPoster: undefined });
  collectGaps(site, 'site', gaps);
  collectGaps({ films: allFilms.map(strip) }, 'films', gaps);
  collectGaps({ clips: allClips.map(strip) }, 'process', gaps);
  if (gaps.length) {
    console.log(`\n${gaps.length} content gap${gaps.length === 1 ? '' : 's'} still to fill:`);
    for (const g of gaps) console.log(`  TODO  ${g}`);
  }

  const pending = allFilms.filter((f) => !f.video?.id);
  const draftCount = allFilms.filter((f) => (f.status ?? 'published') === 'draft' && f.video?.id).length;
  if (draftCount && !includeDrafts) {
    console.log(`\n  ${draftCount} draft film${draftCount === 1 ? '' : 's'} excluded. Preview with: node build.mjs --drafts`);
  }
  if (pending.length) {
    console.log(`\n  ${pending.length} film${pending.length === 1 ? '' : 's'} awaiting a video id, held out of every build:`);
    for (const f of pending) console.log(`    ${f.id}`);
    console.log('    Set video.id in content/films.json to the 11 characters after /shorts/ or ?v=');
  }

  console.log(`\n  note: robots.txt is only honoured at an origin root. At ${ctx.u.BASE} it is advisory`);
  console.log('        until a custom domain is attached. A 404 at the root means "allow all" anyway.');
}

main().catch((err) => {
  console.error('\n' + (err.name === 'ContentError' ? err.message : `Build failed: ${err.message}`) + '\n');
  process.exitCode = 1;
});
