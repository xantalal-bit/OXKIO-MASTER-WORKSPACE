'use strict';
const { containsSecretMarker } = require('./privacy-gate');
const INSUFFICIENT_SOURCES = 'Las fuentes no permiten concluir.';
const normalize = value => value.trim().replace(/\s+/gu, ' ');
// Extractive support only. Issued source ids alone cannot certify an inference.
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
  issued.set(id,normalize(text));
 }
 if(!issued.size)return 'synthesis_sources_unavailable';
 const claims=new Set();
 for(const f of content.findings){
  const claim=defect(f&&f.claim,2000,'claim');if(claim)return claim;
  const quote=defect(f.quote,2000,'quote');if(quote)return quote;
  if(!Array.isArray(f.sourceIds)||!f.sourceIds.length||f.sourceIds.length>10)return 'citation_missing';
  if(!f.sourceIds.every(id=>issued.has(id)))return 'citation_unissued';
  if(normalize(f.claim)!==normalize(f.quote))return 'claim_not_extractive';
  // Require the full supplied text: substring extraction could omit a negation
  // or qualification ("no incluye soporte" -> "incluye soporte").
  if(!f.sourceIds.every(id=>issued.get(id)===normalize(f.quote)))return 'quote_not_supported';
  claims.add(normalize(f.claim));
 }
 // Only verified claims joined by newlines. Added prose could imply causality.
 const supported=v=>v.split(/\r?\n/u).filter(s=>s.trim()).every(s=>claims.has(normalize(s)));
 const conclusion=defect(content.conclusion,16000,'conclusion');if(conclusion)return conclusion;
 if(normalize(content.conclusion)!==INSUFFICIENT_SOURCES&&!supported(content.conclusion))return 'conclusion_not_supported';
 if(content.comparison!==undefined&&content.comparison!==''){
  const comparison=defect(content.comparison,16000,'comparison');if(comparison)return comparison;
  if(!supported(content.comparison))return 'comparison_not_supported';
 }
 return true;
}
module.exports={verifySynthesis,INSUFFICIENT_SOURCES};
