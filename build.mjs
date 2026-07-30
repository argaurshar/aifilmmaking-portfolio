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

function validateVideo(v, p, rep) {
  if (!v || typeof v !== 'object') { rep.error(p, 'required object { platform, id }'); return; }
  if (!['youtube', 'vimeo'].includes(v.platform)) {
    rep.error(`${p}.platform`, `must be "youtube" or "vimeo", got ${JSON.stringify(v.platform)}`);
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

    validateVideo(f.video, `${p}.video`, rep);
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

/**
 * Convention over configuration: if a film has no `poster` in JSON, look for
 * assets/stills/<id>-1920.jpg (or .jpeg/.png, or the bare <id>.<ext>).
 * Drop a correctly-named file in and the build picks it up with no JSON edit.
 */
async function autoPoster(id, dir) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    for (const name of [`${id}-1920.${ext}`, `${id}.${ext}`]) {
      const rel = `${dir}/${name}`;
      if (await assetExists(rel)) return { src: rel, alt: '' };
    }
  }
  return null;
}

/**
 * Resolve a poster into { src, srcset, width, height, alt } by probing which
 * of the -960 / -1440 / -1920 variants exist. A complete responsive-images
 * story with no build tooling.
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

  const m = /^(.*)-(\d+)\.(jpg|jpeg|png)$/i.exec(poster.src);
  const sources = [];
  if (m) {
    for (const w of [960, 1440, 1920]) {
      const cand = `${m[1]}-${w}.${m[3]}`;
      if (await assetExists(cand)) sources.push({ rel: cand, w });
    }
  }
  const srcset = sources.length > 1
    ? sources.map((s) => `${ctx.u.url(s.rel)} ${s.w}w`).join(', ')
    : null;

  return { src: ctx.u.url(poster.src), srcset, width, height, alt: poster.alt ?? '' };
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
function embed({ video, poster, title, ratio, runtimeSeconds, eager = false, caption = null, noteGaps = false }) {
  const ratioCss = (ratio ?? '16:9').replace(':', ' / ');
  const spoken = spokenRuntime(runtimeSeconds);
  return html`<figure class="embed" data-embed
    data-embed-src="${embedSrc(video)}"
    data-embed-origin="${embedOrigin(video.platform)}"
    data-embed-title="${title}"
    data-watch-url="${watchUrl(video)}"
    style="--embed-ratio: ${ratioCss}">
    <div class="embed__frame">
      ${poster
        ? html`<img class="embed__poster" src="${poster.src}"
            ${poster.srcset ? attrs({ srcset: poster.srcset, sizes: '(min-width: 60rem) 60rem, 100vw' }) : ''}
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

  return html`<article class="film-entry" id="film-${film.id}">
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

function filmCard(film, ctx) {
  return html`<li class="film-card">
    <a class="film-card__link" href="${ctx.u.url('work.html')}#film-${film.id}">
      <div class="film-card__media">
        ${film.resolvedPoster
          ? html`<img src="${film.resolvedPoster.src}" width="${film.resolvedPoster.width}"
              height="${film.resolvedPoster.height}" alt="" loading="lazy" decoding="async">`
          : html`<span class="film-card__noposter" aria-hidden="true"></span>`}
      </div>
      <span class="film-card__title">${film.title}</span>
      <span class="film-card__meta">${TYPE_LABEL[film.type]} · ${film.year}</span>
    </a>
  </li>`;
}

function contactBand(ctx, { heading = 'Get in touch' } = {}) {
  const { site, u } = ctx;
  return html`<section class="callout l-stack" aria-labelledby="contact-heading">
    <h2 class="callout__heading" id="contact-heading">${heading}</h2>
    <p class="callout__body">
      <a class="btn btn--primary" href="${u.extUrl(`mailto:${site.contact.email}`)}">${site.contact.email}</a>
    </p>
    ${site.contact.responseTime ? html`<p class="callout__note">${inline(site.contact.responseTime)}</p>` : ''}
    ${site.social?.length
      ? html`<ul class="l-cluster callout__social">
          ${site.social.map((s) => html`<li><a href="${u.extUrl(s.url)}" rel="me noopener">${s.label}</a></li>`)}
        </ul>`
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
<meta property="og:video:width" content="1280">
<meta property="og:video:height" content="720">`
    : ''}
<meta name="twitter:card" content="summary_large_image">
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
      <span class="site-header__role">${site.identity.role}</span>
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

function personNode(ctx) {
  const { site, u } = ctx;
  const node = {
    '@type': 'Person',
    '@id': u.absUrl('about.html') + '#person',
    name: site.identity.name,
    url: u.absUrl(''),
    jobTitle: site.identity.role,
    knowsAbout: ['Directing', 'Editing', 'Narrative short film', 'Brand film', 'Animation'],
  };
  const bio = (site.identity.shortBio ?? []).join(' ').trim();
  if (bio && !/TODO/.test(bio)) node.description = bio;
  if (site.identity.portrait) node.image = ctx.ORIGIN + u.url(site.identity.portrait.src);
  if (site.social?.length) node.sameAs = site.social.map((s) => s.url);
  return node;
}

const personRef = (ctx) => ({ '@id': ctx.u.absUrl('about.html') + '#person' });

function videoObject(film, ctx) {
  const { u } = ctx;
  const node = {
    '@type': 'VideoObject',
    '@id': u.absUrl('work.html') + `#film-${film.id}`,
    name: film.title,
    description: film.logline,
    embedUrl: embedSrc(film.video).split('?')[0],
    url: u.absUrl('work.html') + `#film-${film.id}`,
    genre: TYPE_LABEL[film.type],
    inLanguage: ctx.site.site.locale ?? 'en',
    creator: personRef(ctx),
    director: personRef(ctx),
  };
  if (film.resolvedPoster) node.thumbnailUrl = [ctx.ORIGIN + film.resolvedPoster.src];
  if (film.published) node.uploadDate = film.published;         // omitted, never invented
  if (film.runtimeSeconds) node.duration = isoDuration(film.runtimeSeconds);
  // contentUrl is deliberately never emitted — the file is not hosted here.
  return node;
}

function breadcrumb(page, ctx) {
  const { u } = ctx;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: u.absUrl('') },
      { '@type': 'ListItem', position: 2, name: page.breadcrumbName ?? page.title, item: u.absUrl(page.path) },
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. Pages
   ═══════════════════════════════════════════════════════════════════════════ */

function pageIndex(ctx) {
  const { site, films, u } = ctx;
  const featured = films.filter((f) => f.featured);
  const hero = featured[0] ?? films[0] ?? null;
  const rest = films.filter((f) => f !== hero).slice(0, 3);
  const p = site.pages.index;

  const jsonLd = [
    { '@type': 'WebSite', '@id': u.absUrl('') + '#website', url: u.absUrl(''), name: site.site.title, publisher: personRef(ctx) },
    personNode(ctx),
    ...(hero ? [videoObject(hero, ctx)] : []),
  ];

  return {
    id: 'index', path: '', navMatch: null,
    title: site.site.title,
    description: p.metaDescription,
    ogType: hero ? 'video.other' : 'website',
    ogVideo: hero ? { url: embedSrc(hero.video) } : null,
    ogImagePath: hero?.poster?.src ?? null,
    jsonLd,
    body: html`
<section class="hero l-container l-stack">
  <p class="hero__kicker">${p.heroKicker}</p>
  <h1 class="hero__headline">${inline(p.heroHeadline)}</h1>
  ${prose(p.heroSub, 'hero__sub')}
  <p class="hero__actions l-cluster">
    <a class="btn btn--primary" href="${u.url('work.html')}">See the work</a>
    <a class="btn btn--ghost" href="${u.url('hire.html')}">Hire me</a>
  </p>
</section>

${hero
      ? html`<section class="hero-reel u-bleed" aria-label="Featured film">
    <div class="l-container">
      ${embed({ video: hero.video, poster: hero.resolvedPoster, title: hero.title, ratio: hero.aspectRatio, runtimeSeconds: hero.runtimeSeconds, eager: true, noteGaps: hero.status === 'draft' })}
      <p class="hero-reel__caption">
        <strong>${hero.title}</strong> — ${inline(hero.logline)}
      </p>
    </div>
  </section>`
      : ''}

${rest.length
      ? html`<section class="section l-container l-stack" aria-labelledby="selected-heading">
    <h2 class="section__heading" id="selected-heading">Selected work</h2>
    <ul class="film-grid l-grid">${rest.map((f) => filmCard(f, ctx))}</ul>
    <p><a class="btn btn--ghost" href="${u.url('work.html')}">All work</a></p>
  </section>`
      : html`<section class="section l-container l-stack">
    <p class="u-muted">${site.pages.work.emptyState}</p>
  </section>`}

<section class="section l-container l-stack" aria-labelledby="process-teaser">
  <h2 class="section__heading" id="process-teaser">How it gets made</h2>
  ${prose(site.pages.process.intro)}
  <p><a class="btn btn--ghost" href="${u.url('process.html')}">Read the breakdowns</a></p>
</section>

<section class="section l-container l-stack" aria-labelledby="services-teaser">
  <h2 class="section__heading" id="services-teaser">Commissions</h2>
  <ul class="l-cluster chips">${site.services.map((s) => chip(s.title))}</ul>
  <p><a class="btn btn--ghost" href="${u.url('hire.html')}">What it costs and how long</a></p>
</section>

<div class="l-container">${contactBand(ctx)}</div>`,
  };
}

function workBody(ctx, list, activeType) {
  const { site, u, films } = ctx;
  const p = site.pages.work;
  const types = [...new Set(films.map((f) => f.type))]
    .filter((t) => films.filter((f) => f.type === t).length >= 2)
    .sort();

  return html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
  ${prose(p.intro, 'page-head__intro')}
</header>

${types.length
      ? html`<nav class="filter-bar l-container" aria-label="Filter by type">
  <ul class="l-cluster" data-filter-bar>
    <li><a href="${u.url('work.html')}" data-filter="all"${!activeType ? new Html(' aria-current="page"') : ''}>All</a></li>
    ${types.map((t) => html`<li><a href="${u.url(`work-${t}.html`)}" data-filter="${t}"${activeType === t ? new Html(' aria-current="page"') : ''}>${TYPE_LABEL[t]}</a></li>`)}
  </ul>
  <p class="filter-bar__status u-visually-hidden" role="status" data-filter-status></p>
</nav>`
      : ''}

${list.length
      ? html`<div class="film-list l-container l-stack" data-film-list>
  ${list.map((f, i) => html`<div class="film-list__item" data-type="${f.type}">${filmEntry(f, ctx, { eager: i === 0 })}</div>`)}
</div>`
      : html`<div class="l-container"><p class="u-muted">${p.emptyState}</p></div>`}

<div class="l-container">${contactBand(ctx, { heading: 'Want something like this?' })}</div>`;
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
      personNode(ctx),
      {
        '@type': 'ItemList',
        itemListElement: films.map((f, i) => ({
          '@type': 'ListItem', position: i + 1, url: u.absUrl('work.html') + `#film-${f.id}`,
        })),
      },
      ...films.map((f) => videoObject(f, ctx)),
      breadcrumb({ path: 'work.html', title: 'Work' }, ctx),
    ],
    body: workBody(ctx, films, null),
  };
}

function pageWorkFiltered(ctx, type) {
  const { site, films } = ctx;
  const list = films.filter((f) => f.type === type);
  return {
    id: 'work', path: `work-${type}.html`, navMatch: 'work.html',
    title: `${TYPE_LABEL[type]} — ${site.identity.name}`,
    description: `${TYPE_LABEL[type]} work by ${site.identity.name}.`,
    ogImagePath: list[0]?.poster?.src ?? null,
    jsonLd: [personNode(ctx), ...list.map((f) => videoObject(f, ctx))],
    body: workBody(ctx, list, type),
  };
}

function pageProcess(ctx) {
  const { site, clips, films, u } = ctx;
  const p = site.pages.process;
  return {
    id: 'process', path: 'process.html', navMatch: 'process.html',
    title: `Process — ${site.identity.name}`,
    description: p.metaDescription,
    ogImagePath: clips[0]?.poster?.src ?? null,
    jsonLd: [personNode(ctx), breadcrumb({ path: 'process.html', title: 'Process' }, ctx)],
    body: html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
  ${prose(p.intro, 'page-head__intro')}
</header>

<section class="section l-container l-stack" aria-labelledby="steps-heading">
  <h2 class="section__heading" id="steps-heading">The shape of a job</h2>
  <ol class="process-steps l-stack">
    ${site.processSteps.map((s) => html`<li class="process-step">
      <span class="process-step__n" aria-hidden="true">${String(s.n).padStart(2, '0')}</span>
      <div class="process-step__body">
        <h3 class="process-step__title">${s.title}</h3>
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
        ${film ? html`<p class="process-clip__from">From <a href="${u.url('work.html')}#film-${film.id}">${film.title}</a></p>` : ''}
      </div>
    </article>`;
      })}
</section>`
      : ''}

<div class="l-container">${contactBand(ctx)}</div>`,
  };
}

function pageHire(ctx) {
  const { site, u } = ctx;
  const p = site.pages.hire;
  const offers = site.services.map((s) => {
    const offer = { '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title, description: s.summary } };
    if (s.startingAt) {
      offer.priceSpecification = { '@type': 'PriceSpecification', minPrice: s.startingAt.amount, priceCurrency: s.startingAt.currency };
    }
    return offer;                                      // no priceSpecification when there is no rate
  });
  const person = personNode(ctx);
  person.makesOffer = offers;

  return {
    id: 'hire', path: 'hire.html', navMatch: 'hire.html',
    title: `Hire — ${site.identity.name}`,
    description: p.metaDescription,
    ogImagePath: null,
    jsonLd: [person, breadcrumb({ path: 'hire.html', title: 'Hire' }, ctx)],
    body: html`
<header class="page-head l-container l-stack">
  <h1 class="page-head__title">${inline(p.heading)}</h1>
  ${prose(p.intro, 'page-head__intro')}
  ${site.contact.availability ? html`<p class="page-head__note">${inline(site.contact.availability)}</p>` : ''}
</header>

<section class="section l-container l-stack" aria-labelledby="services-heading">
  <h2 class="section__heading" id="services-heading">What I make</h2>
  <ul class="l-grid l-grid--services">
    ${site.services.map((s) => html`<li class="service-card l-stack">
      <h3 class="service-card__title">${s.title}</h3>
      <p class="service-card__summary">${inline(s.summary)}</p>
      ${s.deliverables?.length
        ? html`<ul class="service-card__list">${s.deliverables.map((d) => html`<li>${inline(d)}</li>`)}</ul>`
        : ''}
      ${s.timeline ? html`<p class="service-card__meta">${inline(s.timeline)}</p>` : ''}
      ${s.startingAt ? html`<p class="service-card__meta">From ${s.startingAt.currency} ${s.startingAt.amount}</p>` : ''}
    </li>`)}
  </ul>
</section>

<section class="section l-container l-stack" aria-labelledby="how-heading">
  <h2 class="section__heading" id="how-heading">How it goes</h2>
  <ol class="process-steps process-steps--compact l-stack">
    ${site.processSteps.map((s) => html`<li class="process-step">
      <span class="process-step__n" aria-hidden="true">${String(s.n).padStart(2, '0')}</span>
      <div class="process-step__body"><h3 class="process-step__title">${s.title}</h3></div>
    </li>`)}
  </ol>
</section>

<div class="l-container">${contactBand(ctx, { heading: 'Start a project' })}</div>`,
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
    jsonLd: [personNode(ctx), breadcrumb({ path: 'about.html', title: 'About' }, ctx)],
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

<section class="section l-container about">
  ${site.identity.portrait && !site.identity.portraitWide
      ? html`<img class="about__portrait" src="${ctx.u.url(site.identity.portrait.src)}"
          alt="${site.identity.portrait.alt}" width="${site.identity.portraitSize.width}"
          height="${site.identity.portraitSize.height}" loading="lazy" decoding="async">`
      : ''}
  <div class="about__body l-stack">
    ${prose(site.identity.longBio)}
    ${site.identity.location ? html`<p class="u-muted">Based in ${site.identity.location}.</p>` : ''}
  </div>
</section>

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

<div class="l-container">${contactBand(ctx)}</div>`,
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
      L.push(`- [${f.title} (${bits})](${u.absUrl('work.html')}#film-${f.id}): ${f.logline}`);
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
  for (const [, v] of out.matchAll(STYLE_ATTR)) {
    if (!/^--embed-ratio: [\d./ ]+$/.test(v)) bad.push(`style="${v}" — only --embed-ratio may reach a style attribute`);
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

  let films = (filmsDoc.films ?? []).filter((f) => includeDrafts || (f.status ?? 'published') === 'published');
  films = films.slice().sort(sortFilms);
  let clips = (processDoc.clips ?? []).filter((c) => includeDrafts || (c.status ?? 'published') === 'published');
  clips = clips.slice().sort((a, b) => a.order - b.order);

  if (films.length && !films.some((f) => f.featured)) {
    rep.error('films', 'no film has "featured": true — the home page has no hero without one');
    throw new ReportError(rep);
  }

  const ctx = { site, films, clips, u, ORIGIN: u.ORIGIN, rep, assets: {} };

  // Assets
  for (const f of films) {
    const poster = f.poster ?? await autoPoster(f.id, 'assets/stills');
    if (!poster) rep.warn(`films[${f.id}].poster`, `no poster — add assets/stills/${f.id}-1920.jpg`);
    // Write the auto-detected poster back, so page templates reading `poster.src`
    // for ogImagePath see it too. Without this, every film relying on filename
    // detection has poster === null and every page falls back to site.ogImage.
    // Must be the raw repo-relative path: resolveOg() does its own assetExists()
    // and url(), so a BASE-prefixed resolvedPoster.src would silently fail.
    f.poster = poster;
    f.resolvedPoster = await resolvePoster(poster, ctx, `films[${f.id}].poster`);
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

  const filterTypes = [...new Set(films.map((f) => f.type))]
    .filter((t) => films.filter((f) => f.type === t).length >= 2)
    .sort();
  for (const t of filterTypes) descriptors.push(pageWorkFiltered(ctx, t));

  descriptors.push(pageNotFound(ctx));

  const newestFilm = films.map((f) => f.published).filter(Boolean).sort().at(-1);
  for (const d of descriptors) {
    if (d.path === 'work.html' && newestFilm) d.lastmod = newestFilm;
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

  await mkdir(path.join(ROOT, 'assets'), { recursive: true });
  for (const { d, out } of rendered) {
    await writeFile(path.join(ROOT, d.path || 'index.html'), out, 'utf8');
  }
  await writeFile(path.join(ROOT, 'sitemap.xml'), sitemap(descriptors, ctx), 'utf8');
  await writeFile(path.join(ROOT, 'robots.txt'), robots(ctx), 'utf8');
  await writeFile(path.join(ROOT, 'llms.txt'), llmsTxt(ctx), 'utf8');

  // ---- report
  const pageCount = rendered.length;
  console.log(`✓ ${pageCount} pages, ${films.length} film${films.length === 1 ? '' : 's'}, ${clips.length} process clip${clips.length === 1 ? '' : 's'}`);
  console.log(`  base ${ctx.u.BASE}   origin ${ctx.ORIGIN}`);
  if (includeDrafts) console.log('  ⚠ --drafts: draft entries are INCLUDED. Do not commit this output.');

  if (rep.warnings.length) {
    console.log(`\n${rep.warnings.length} warning${rep.warnings.length === 1 ? '' : 's'}:`);
    const pad = Math.min(38, Math.max(0, ...rep.warnings.map((w) => w.path.length)));
    for (const w of rep.warnings) console.log(`  WARN  ${w.path.padEnd(pad)} — ${w.msg}`);
  }

  const gaps = [];
  collectGaps(site, 'site', gaps);
  collectGaps({ films: films.map((f) => ({ ...f, resolvedPoster: undefined })) }, 'films', gaps);
  collectGaps({ clips: clips.map((c) => ({ ...c, resolvedPoster: undefined })) }, 'process', gaps);
  if (gaps.length) {
    console.log(`\n${gaps.length} content gap${gaps.length === 1 ? '' : 's'} still to fill:`);
    for (const g of gaps) console.log(`  TODO  ${g}`);
  }

  const draftCount = (await loadJson('content/films.json')).films.filter((f) => (f.status ?? 'published') === 'draft').length;
  if (draftCount && !includeDrafts) {
    console.log(`\n  ${draftCount} draft film${draftCount === 1 ? '' : 's'} excluded. Preview with: node build.mjs --drafts`);
  }

  console.log(`\n  note: robots.txt is only honoured at an origin root. At ${ctx.u.BASE} it is advisory`);
  console.log('        until a custom domain is attached. A 404 at the root means "allow all" anyway.');
}

main().catch((err) => {
  console.error('\n' + (err.name === 'ContentError' ? err.message : `Build failed: ${err.message}`) + '\n');
  process.exitCode = 1;
});
