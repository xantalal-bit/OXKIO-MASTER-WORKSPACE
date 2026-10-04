'use strict';
const { containsSecretMarker } = require('./privacy-gate');
const INSUFFICIENT_SOURCES = 'Las fuentes no permiten concluir.';
const freeze = Object.freeze;
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
// A quote may join several sentences that are not consecutive in the source
// (a model skips the ones in between): each sentence is matched, and its
// context protected, on its own.
function quotedIn(quote, source) {
 const q = canon(quote);
 for (const [s, e] of spans(q)) { const verdict = fragmentIn(q.slice(s, e), source); if (verdict) return verdict; }
 return null;
}
function fragmentIn(fragment, source) {
 const q = fragment.trim().replace(/[.!?]+$/u, '');
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
// Multi-word negations ("en lugar de conferir" = "no confiere"). Each one only
// counts when it negates the same word as a negation of the quote (its scope:
// the next content word, past clitics, compared on 4 letters), so it can never
// be used to move a negation onto another verb.
const EQUIVALENT_NEGATIONS = [['en','lugar','de'],['en','vez','de']];
const CLITICS = new Set(['se','le','lo','la','les','los','las','me','te','nos','os','el','al','a','de']);
function negationMarks(ws) {
 const marks = [];
 for (let i = 0; i < ws.length; i++) {
  const equivalent = EQUIVALENT_NEGATIONS.find(e => e.every((w, k) => ws[i + k] === w));
  const end = equivalent ? i + equivalent.length : NEGATIONS.has(ws[i]) ? i + 1 : null;
  if (end === null) continue;
  let scope = null;
  for (let k = end; k < Math.min(ws.length, end + 4) && !scope; k++) if (!CLITICS.has(ws[k]) && ws[k].length >= 4 && !/^\d/u.test(ws[k])) scope = ws[k].slice(0, 4);
  marks.push({ equivalent: !!equivalent, scope });
  if (equivalent) i = end - 1;
 }
 return marks;
}
function faithful(claim, quote) {
 const c = words(claim);
 const quoteNumbers = new Set(numbers(quote));
 if (!numbers(claim).every(n => quoteNumbers.has(n))) return 'claim_number_unsupported';
 // Negations and qualifiers are required for every quote sentence the claim
 // asserts (it shares 2+ stems, or a third of the sentence's stems, with it).
 // A sentence the claim does not touch does not constrain it. If no sentence
 // qualifies, the whole quote applies (as before).
 const claimStems = new Set(stems(claim)), canonical = canon(quote);
 const sentencesOfQuote = spans(canonical).map(([s, e]) => canonical.slice(s, e));
 const asserted = sentencesOfQuote.filter(s => { const own = [...new Set(stems(s))]; const shared = own.filter(x => claimStems.has(x)).length; return shared >= 2 || (own.length > 0 && shared / own.length >= 0.34); });
 const scope = (asserted.length ? asserted : sentencesOfQuote).map(words);
 const quoteMarks = scope.flatMap(negationMarks), claimMarks = negationMarks(c);
 if (claimMarks.length !== quoteMarks.length) return 'claim_negation_changed';
 if (claimMarks.some(m => m.equivalent && (!m.scope || !quoteMarks.some(q => q.scope === m.scope)))) return 'claim_negation_changed';
 if (![...new Set(scope.flat().filter(w => QUALIFIERS.has(w)))].every(w => c.includes(w))) return 'claim_qualifier_dropped';
 // Each stem counts once: expanding "EU" to "European Union" twice must not
 // weigh as two unsupported words.
 const own = [...new Set(stems(claim))], available = new Set(stems(quote));
 if (!own.length || own.filter(s => available.has(s)).length / own.length < 0.6) return 'claim_not_supported';
 return null;
}
const defect = (v,max,name) => typeof v!=='string'||!v.trim()?name+'_missing':v.length>max?name+'_too_long':containsSecretMarker(v)?name+'_secret':/https?:\/\//i.test(v)?name+'_link':null;
// Shape and issued sources: a defect here invalidates the whole output.
function prepare(content, sources) {
 if(!content||typeof content!=='object'||!Array.isArray(content.findings))return {error:'synthesis_shape'};
 if(content.findings.length<1||content.findings.length>8)return {error:'findings_count'};
 let entries;
 if(sources instanceof Map)entries=[...sources.entries()];
 else if(Array.isArray(sources))entries=sources.map(s=>[s&&s.id,s]);
 else return {error:'synthesis_sources_unavailable'};
 const issued=new Map();
 for(const [id,source] of entries){
  const text=typeof source==='string'?source:source&&source.text;
  if(typeof id!=='string'||!id||typeof text!=='string'||issued.has(id))return {error:'synthesis_sources_invalid'};
  const c=canon(text);issued.set(id,{text:c,spans:spans(c)});
 }
 if(!issued.size)return {error:'synthesis_sources_unavailable'};
 return {issued};
}
// One finding, all rules: a fixed defect code, or null when it fully passes.
function checkFinding(f, issued) {
 const claim=defect(f&&f.claim,600,'claim');if(claim)return claim;
 const quote=defect(f.quote,1200,'quote');if(quote)return quote;
 if(!Array.isArray(f.sourceIds)||!f.sourceIds.length||f.sourceIds.length>10)return 'citation_missing';
 if(!f.sourceIds.every(id=>issued.has(id)))return 'citation_unissued';
 for(const id of f.sourceIds){const quoted=quotedIn(f.quote,issued.get(id));if(quoted)return quoted;}
 return faithful(f.claim,f.quote);
}
const inference=(value,name,verifiedNumbers)=>{const d=defect(value,1200,name);if(d)return d;return numbers(value).every(n=>verifiedNumbers.has(n))?null:name+'_number_unsupported';};
const numbersOf=findings=>new Set(findings.flatMap(f=>numbers(f.quote)));
const isInsufficient=value=>normalize(String(value||''))===INSUFFICIENT_SOURCES;
// Findings are verified against literal quotes; conclusion and comparison are
// an inference over those findings, allowed only without new figures and
// presented to the person as an inference, never as a verified fact.
// All-or-nothing form: any defect rejects the whole output.
function verifySynthesis(content, sources) {
 const prepared=prepare(content,sources);if(prepared.error)return prepared.error;
 for(const f of content.findings){const code=checkFinding(f,prepared.issued);if(code)return code;}
 const verifiedNumbers=numbersOf(content.findings);
 const conclusion=isInsufficient(content.conclusion)?null:inference(content.conclusion,'conclusion',verifiedNumbers);if(conclusion)return conclusion;
 if(content.comparison!==undefined&&content.comparison!==''){const comparison=inference(content.comparison,'comparison',verifiedNumbers);if(comparison)return comparison;}
 return true;
}
// Partial form: the same rules applied PER FINDING. A finding either passes
// every rule and may be shown, or is dropped whole; a dropped finding is never
// shown and is recorded only as its index and fixed defect code. Most of the
// output must verify, otherwise it is treated as unreliable and rejected.
// Conclusion and comparison may rest on a dropped finding, so whenever one is
// dropped (or they fail their own checks) they are not reused: the answer
// carries a limited conclusion instead of the model's inference.
const LIMITED_CONCLUSION='Solo presento los hallazgos que he podido comprobar en las fuentes; con ellos no hay una valoración de conjunto verificable.';
function verifyPartial(content, sources, { minVerifiedRatio = 0.5 } = {}) {
 const prepared=prepare(content,sources);if(prepared.error)return freeze({accepted:false,verdict:prepared.error});
 const discarded=[],kept=[];
 content.findings.forEach((f,index)=>{const code=checkFinding(f,prepared.issued);if(code)discarded.push(freeze({index,code}));else kept.push(freeze({claim:f.claim,quote:f.quote,sourceIds:freeze([...f.sourceIds])}));});
 const proposed=content.findings.length;
 if(!kept.length)return freeze({accepted:false,verdict:'no_verified_findings',proposed,discarded:freeze(discarded)});
 if(kept.length/proposed<minVerifiedRatio)return freeze({accepted:false,verdict:'too_many_unverified_findings',proposed,discarded:freeze(discarded)});
 const verifiedNumbers=numbersOf(kept);
 const comparisonGiven=content.comparison!==undefined&&content.comparison!=='';
 const inferenceOk=!discarded.length&&!isInsufficient(content.conclusion)&&!inference(content.conclusion,'conclusion',verifiedNumbers)&&(!comparisonGiven||!inference(content.comparison,'comparison',verifiedNumbers));
 const conclusionKind=isInsufficient(content.conclusion)&&!discarded.length?'insufficient':inferenceOk?'inference':'limited';
 return freeze({accepted:true,verdict:true,proposed,discarded:freeze(discarded),conclusionKind,
  content:freeze({findings:freeze(kept),conclusion:conclusionKind==='inference'?content.conclusion:conclusionKind==='insufficient'?INSUFFICIENT_SOURCES:LIMITED_CONCLUSION,comparison:conclusionKind==='inference'&&comparisonGiven?content.comparison:''})});
}
module.exports={verifySynthesis,verifyPartial,INSUFFICIENT_SOURCES,LIMITED_CONCLUSION};
