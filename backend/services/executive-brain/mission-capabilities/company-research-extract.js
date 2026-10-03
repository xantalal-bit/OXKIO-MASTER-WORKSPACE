'use strict';

const { containsSecretMarker } = require('../privacy-gate');
// One strict definition of "same site" for the whole circuit.
const { sameSite } = require('./public-web-fetcher');

// XATAI CORE V2.1: deterministic fact extraction from a normalized public
// page (entities decoded, whitespace collapsed, see public-web-fetcher).
// Every fact carries an `excerpt` that is a literal substring of the page
// text, so the trusted toolbox can prove it was found, not written. Nothing
// here interprets page content as an instruction: text is only data.

const MAX_EXCERPT = 280;

// Content that tries to steer an automated reader. It is kept out of every
// conclusion and reported, never obeyed.
const INJECTION_PATTERN = /(ignor\w*|olvid\w*|disregard|override)\b[^.]{0,60}\b(instruc\w*|previous|anterior\w*|prompt|rules|reglas)|system prompt|you are now|eres ahora|act as an?\b|send (an )?e-?mail|env[ií]a\w* (un )?(correo|e-?mail|mensaje)|transfer\w* (money|funds|dinero)|<\s*\/?\s*(system|assistant)\s*>/i;

const SIZE_PATTERN = /\b(\d{1,3}(?:[.,]\d{3})+|\d{1,5})\s+(tiendas|establecimientos|centros|sedes|oficinas|delegaciones|almacenes|empleados|trabajadores|profesionales|clientes|pa[ií]ses|stores|employees|workers|offices|locations|customers|countries|warehouses)\b/gi;
// A size fact quotes the figure and the rest of its sentence (up to this
// many characters), so an explicit scope ("en España", "en 2024") is kept.
const SIZE_CONTEXT = 120;
const SIZE_BEFORE = 60;
const LINK_KEYWORDS = /(empresa|nosotros|quienes|qui[eé]nes|about|historia|servicios|productos|soluciones|contacto|contact|company|equipo|sectores)/i;

function isSuspicious(text) {
  return INJECTION_PATTERN.test(String(text || ''));
}

// Text runs between tags, skipping script/style/noscript bodies. Each run is
// a literal substring of the page text.
function textRuns(text) {
  const runs = [];
  const token = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>|[^<]+/gi;
  let match;
  while ((match = token.exec(text)) !== null) {
    if (match[0][0] !== '<') {
      const run = match[0].trim();
      if (run.length >= 2) runs.push(run);
    }
  }
  return runs;
}

function windowAround(run, index, length) {
  if (run.length <= MAX_EXCERPT) return run;
  const start = Math.max(0, Math.min(index - 100, run.length - MAX_EXCERPT));
  return run.slice(start, start + MAX_EXCERPT).trim();
}

function metaContent(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forward = new RegExp(`<meta\\s[^>]*?(?:name|property)=["']${escaped}["'][^>]*?content=["']([^"'<>]{2,400})["']`, 'i');
  const backward = new RegExp(`<meta\\s[^>]*?content=["']([^"'<>]{2,400})["'][^>]*?(?:name|property)=["']${escaped}["']`, 'i');
  const found = forward.exec(text) || backward.exec(text);
  return found ? found[1].trim() : null;
}

function extractFacts(page, { prefix, signals = [], broad = false, maxSignalFacts = 8 } = {}) {
  const facts = [];
  const seen = new Set();
  // A fact candidate is only an id, a closed label, a literal excerpt and
  // its source. The statement is written by the trusted semantic canon.
  const add = (label, excerpt) => {
    const clean = String(excerpt || '').trim().slice(0, MAX_EXCERPT).trim();
    // Never quote something that looks like a credential.
    if (clean.length < 2 || !page.text.includes(clean) || containsSecretMarker(clean)) return;
    const key = `${label}|${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ id: `${prefix}:${facts.length + 1}`, label, excerpt: clean, sourceRef: page.sourceRef });
  };

  const title = /<title[^>]*>([^<]{2,200})<\/title>/i.exec(page.text);
  if (title) add('title', title[1]);
  const siteName = metaContent(page.text, 'og:site_name');
  if (siteName) add('site_name', siteName);
  const description = metaContent(page.text, 'description') || metaContent(page.text, 'og:description');
  if (description) add('description', description);

  const headingPattern = /<h([12])[^>]*>([^<]{2,200})<\/h\1>/gi;
  let heading;
  let headings = 0;
  while ((heading = headingPattern.exec(page.text)) !== null && headings < 8) {
    headings += 1;
    add(heading[1] === '1' ? 'heading_main' : 'heading', heading[2]);
  }

  // schema.org fields quoted with their key, so the excerpt proves the field.
  const schema = /"(legalName|addressLocality|addressRegion|addressCountry|foundingDate|numberOfEmployees)"\s*:\s*("[^"]{1,120}"|\{[^{}]{0,200}\}|\d{1,7})/g;
  let field;
  while ((field = schema.exec(page.text)) !== null) add(`schema_${field[1]}`, field[0]);

  const runs = textRuns(page.text);
  for (const run of runs) {
    let size;
    SIZE_PATTERN.lastIndex = 0;
    while ((size = SIZE_PATTERN.exec(run)) !== null) {
      // Same sentence only: a bounded window before the figure (scope such
      // as "En España tenemos", "En 2024") and after it ("en Francia").
      const head = run.slice(Math.max(0, size.index - SIZE_BEFORE), size.index);
      const boundary = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '), head.lastIndexOf('! '), head.lastIndexOf('? '));
      const before = boundary === -1 ? head : head.slice(boundary + 2);
      const rest = run.slice(size.index, size.index + SIZE_CONTEXT);
      const stop = rest.search(/[.;!?](\s|$)/);
      add('size', `${before}${stop === -1 ? rest : rest.slice(0, stop)}`.trim());
    }
  }

  const lowered = signals.map((signal) => String(signal).toLowerCase()).filter(Boolean);
  let signalFacts = 0;
  for (const run of runs) {
    if (signalFacts >= maxSignalFacts) break;
    const lower = run.toLowerCase();
    const signal = lowered.find((item) => lower.includes(item));
    if (!signal) continue;
    const excerpt = windowAround(run, lower.indexOf(signal), signal.length);
    const before = facts.length;
    add('signal', excerpt);
    if (facts.length > before) signalFacts += 1;
  }

  // Broader hypothesis (used after a rejected first attempt): substantial
  // text passages, still quoted literally.
  if (broad) {
    let passages = 0;
    for (const run of runs) {
      if (passages >= 6) break;
      if (run.length < 40) continue;
      const before = facts.length;
      const excerpt = windowAround(run, 0, 0);
      add('content', excerpt);
      if (facts.length > before) passages += 1;
    }
  }
  return facts;
}

function extractLinks(page, { max = 4 } = {}) {
  const base = new URL(page.url);
  const links = [];
  const pattern = /<a\s[^>]*?href=["']([^"'#<>\s]{1,300})["'][^>]*>([^<]{0,80})/gi;
  let match;
  while ((match = pattern.exec(page.text)) !== null && links.length < max) {
    let url;
    try { url = new URL(match[1], base); } catch (error) { continue; }
    if (url.protocol !== 'https:' || !sameSite(url.hostname, base.hostname)) continue;
    url.hash = '';
    if (url.href === base.href || links.some((link) => link.url === url.href)) continue;
    if (!LINK_KEYWORDS.test(`${url.pathname} ${match[2]}`)) continue;
    links.push({ url: url.href, label: match[2].trim().slice(0, 80) });
  }
  return links;
}

module.exports = { INJECTION_PATTERN, extractFacts, extractLinks, isSuspicious, sameSite, textRuns };
