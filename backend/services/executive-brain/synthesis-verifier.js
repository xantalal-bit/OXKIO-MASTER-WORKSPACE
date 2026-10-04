'use strict';
const { containsSecretMarker } = require('./privacy-gate');
const INSUFFICIENT_SOURCES = 'Las fuentes no permiten concluir.';
const normalize = value => value.trim().replace(/\s+/gu, ' ');
const plain = value => normalize(value).normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase();
const words = value => plain(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Negations and qualifiers change what a sentence asserts: a claim must keep
// every one its quote carries and cannot add a negation the quote lacks.
const NEGATIONS = new Set(['no','nunca','jamas','ni','tampoco','sin','ningun','ninguno','ninguna','nada','nadie','not','never','without','none','neither','nor']);
const QUALIFIERS = new Set(['solo','solamente','unicamente','excepto','salvo','hasta','maximo','minimo','menos','mas','aproximadamente','casi','only','except','unless','least','most']);
const STOP = new Set(['para','como','este','esta','estos','estas','pero','sobre','entre','cada','todo','toda','todos','todas','tiene','tienen','that','this','with','from','have','which']);
const numbers = value => (value.match(/\d+(?:[.,]\d+)*/gu) || []).map(n => n.replace(/,/gu, '.'));
const count = (list, set) => list.filter(w => set.has(w)).length;
const stems = value => words(value).filter(w => w.length >= 4 && !STOP.has(w) && !/^\d/u.test(w)).map(w => w.slice(0, 5));
// Quotes are matched on a canonical form, because real extracted pages carry
// artefacts a model tidies when quoting ("GDPR , is", stripped parentheses,
// typographic quotes, a missing or added final full stop, letter case).
const canon = value => value.normalize('NFC').replace(/[“”«»"]/gu, '').replace(/[‘’`´]/gu, "'").replace(/[()[\]]/gu, ' ').replace(/[–—]/gu, '-')
 .replace(/\s+([,.;:!?])/gu, '$1').replace(/\s+/gu, ' ').trim().toLowerCase();
// Sentence spans of the canonical source (abbreviations do not end one).
const ABBREVIATION = /(?:^|\s)(?:art|arts|núm|num|ej|pág|pag|vol|cap|apdo|etc|sr|sra|dr|dra|vs|no|nos|e\.g|i\.e|\p{L})\.$/u;
function spans(text) {
 const result = []; let start = 0;
 for (const m of text.matchAll(/[.!?]\s/gu)) {
  const end = m.index + 1;
  if (ABBREVIATION.test(text.slice(start, end))) continue;
  result.push([start, end]); start = end + 1;
 }
 if (start < text.length) result.push([start, text.length]);
 return result;
}
// A quote may be a fragment, but never one that leaves out a negation or a
// qualifier of the sentence(s) it was taken from: "no incluye soporte" can't
// be quoted as "incluye soporte", nor "solo en inglés" as "en inglés".
function quotedIn(quote, source) {
 const q = canon(quote).replace(/[.!?]+$/u, '');
 if (q.split(' ').length < 3) return 'quote_too_short';
 let verdict = 'quote_not_supported';
 for (let at = source.text.indexOf(q); at !== -1; at = source.text.indexOf(q, at + 1)) {
  const context = source.spans.filter(([s, e]) => s < at + q.length && e > at).map(([s, e]) => source.text.slice(s, e)).join(' ');
  const cw = words(context), qw = words(q);
  if (count(cw, NEGATIONS) === count(qw, NEGATIONS) && [...new Set(cw.filter(w => QUALIFIERS.has(w)))].every(w => qw.includes(w))) return null;
  verdict = 'quote_drops_context';
 }
 return verdict;
}
// The claim must say what its quote says: same figures, same negations, every
// qualifier kept, and mostly the quote's own vocabulary. This is a fidelity
// check, not a proof of meaning; synonyms that drop a negation fail closed.
function faithful(claim, quote) {
 const c = words(claim), q = words(quote);
 const quoteNumbers = new Set(numbers(quote));
 if (!numbers(claim).every(n => quoteNumbers.has(n))) return 'claim_number_unsupported';
 if (count(c, NEGATIONS) !== count(q, NEGATIONS)) return 'claim_negation_changed';
 if (![...new Set(q.filter(w => QUALIFIERS.has(w)))].every(w => c.includes(w))) return 'claim_qualifier_dropped';
 const own = stems(claim), available = new Set(stems(quote));
 if (!own.length || own.filter(s => available.has(s)).length / own.length < 0.6) return 'claim_not_supported';
 return null;
}
// Findings are verified against literal quotes; conclusion and comparison are
// an inference over those findings, allowed only without new figures and
// presented to the person as an inference, never as a verified fact.
function verifySynthesis(content, sources) {
 const defect = (v,max,name) => typeof v!=='string'||!v.trim()?name+'_missing':v.length>max?name+'_too_long':containsSecretMarker(v)?name+'_secret':/https?:\/\//i.test(v)?name+'_link':null;
 if(!content||typeof content!=='object'||!Array.isArray(content.findings))return 'synthesis_shape';
 if(content.findings.length<1||content.findings.length>8)return 'findings_count';
 let entries;
 if(sources instanceof Map)entries=[...sources.entries()];
 else if(Array.isArray(sources))entries=sources.map(s=>[s&&s.id,s]);
 else return 'synthesis_sources_unavailable';
 const issued=new Map();
 for(const [id,source] of entries){
  const text=typeof source==='string'?source:source&&source.text;
  if(typeof id!=='string'||!id||typeof text!=='string'||issued.has(id))return 'synthesis_sources_invalid';
  const c=canon(text);issued.set(id,{text:c,spans:spans(c)});
 }
 if(!issued.size)return 'synthesis_sources_unavailable';
 const verifiedNumbers=new Set();
 for(const f of content.findings){
  const claim=defect(f&&f.claim,600,'claim');if(claim)return claim;
  const quote=defect(f.quote,1200,'quote');if(quote)return quote;
  if(!Array.isArray(f.sourceIds)||!f.sourceIds.length||f.sourceIds.length>10)return 'citation_missing';
  if(!f.sourceIds.every(id=>issued.has(id)))return 'citation_unissued';
  for(const id of f.sourceIds){const quoted=quotedIn(f.quote,issued.get(id));if(quoted)return quoted;}
  const unfaithful=faithful(f.claim,f.quote);if(unfaithful)return unfaithful;
  numbers(f.quote).forEach(n=>verifiedNumbers.add(n));
 }
 const inference=(value,name,max)=>{const d=defect(value,max,name);if(d)return d;return numbers(value).every(n=>verifiedNumbers.has(n))?null:name+'_number_unsupported';};
 const conclusion=normalize(String(content.conclusion||''))===INSUFFICIENT_SOURCES?null:inference(content.conclusion,'conclusion',1200);if(conclusion)return conclusion;
 if(content.comparison!==undefined&&content.comparison!==''){const comparison=inference(content.comparison,'comparison',1200);if(comparison)return comparison;}
 return true;
}
module.exports={verifySynthesis,INSUFFICIENT_SOURCES};
