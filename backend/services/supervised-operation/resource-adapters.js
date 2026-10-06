'use strict';
const { createPublicWebFetcher, parsePublicUrl, siteOf } = require('../executive-brain/mission-capabilities/public-web-fetcher');
const { textRuns } = require('../executive-brain/mission-capabilities/company-research-extract');
const { copy, freeze, fail } = require('./scope-session');
const { extractSenderName } = require('../private-context/mail-priority');
// Factories run in the trusted composition root/OAuth callback, not in a prompt.
// The credential-bearing client stays in a closure and never enters agent input.
// Provider contract (any new source — Drive, OneDrive, Outlook… — plugs in here
// without changing the runtime): read({query,urls,strategy,limits,scope,signal})
// -> items [{text, url?}], plus declared scopes, origin and, for anything that
// sends data out, an egress descriptor {providerId, region} for the Privacy Gate.
function createReadonlyAdapter({scope,permissions,read,origin='live',egress=null}){
 if(!scope||typeof read!=='function')fail('adapter_invalid');
 const owner=freeze(copy(scope));
 return Object.freeze({...owner,scopes:Object.freeze([...permissions]),origin,...(egress?{egress:freeze(copy(egress))}:{}),read:async input=>{
  if(JSON.stringify([input.scope.tenantId,input.scope.clientId,input.scope.userId])!==JSON.stringify([owner.tenantId,owner.clientId,owner.userId]))fail('adapter_scope_invalid');
  const items=await read({query:input.query,urls:input.urls,strategy:input.strategy,limits:input.limits,scope:copy(owner),signal:input.signal});
  return {...owner,items};
 }});
}
// The fetcher returns the page markup; a source item carries its readable
// text (paragraphs first, else every visible run), never the HTML head.
function readableText(html){
 const paragraphs=[...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(m=>textRuns(m[1]).join(' ')).filter(t=>t.length>=40);
 return (paragraphs.length?paragraphs:textRuns(String(html))).join(' ').replace(/\s+/g,' ').trim();
}
// A source is cut at its last complete sentence, so a quoted sentence can
// never be a truncated one that lost its trailing qualification.
function clipSentences(text,max=2000){
 if(text.length<=max)return text;
 const cut=text.slice(0,max);const end=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '));
 return end>0?cut.slice(0,end+1):cut;
}
function createPublicResearchAdapters({scope,search,searchEgress=null,fetcher=createPublicWebFetcher(),origin='live'}){
 const fetch=createReadonlyAdapter({scope,permissions:['public.fetch'],origin,read:async({urls})=>{
  const items=[];for(const url of urls){parsePublicUrl(url);const page=await fetcher.fetchPage(url,{allowedSite:siteOf(new URL(url).hostname)});items.push({text:clipSentences(readableText(page.text)),url});}return items;
 }});
 const discovery=typeof search==='function'?createReadonlyAdapter({scope,permissions:['public.search'],origin,egress:searchEgress,read:async({query})=>{
  const result=await search(query);if(!Array.isArray(result))fail('search_output_invalid');return result.slice(0,5).map(item=>{parsePublicUrl(item.url);return {text:String(item.title||item.snippet||item.url).slice(0,2000),url:item.url};});
 }}):null;
 return Object.freeze({fetch,...(discovery?{search:discovery}:{})});
}
// Controlled public discovery: a reviewed catalogue of public references matched
// locally against the minimized query terms. Nothing leaves OXKIO to search;
// the pages themselves are then read by the public fetcher. Not a web search.
const searchTerm=value=>String(value).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function createCuratedDiscovery(entries){
 if(!Array.isArray(entries))fail('catalogue_invalid');
 const list=entries.map(e=>{
  if(!e||typeof e.title!=='string'||typeof e.url!=='string'||!Array.isArray(e.keywords)||e.keywords.length===0)fail('catalogue_invalid');
  parsePublicUrl(e.url);return freeze({title:e.title,url:e.url,keywords:e.keywords.map(searchTerm)});
 });
 return async query=>{const terms=searchTerm(query||'').match(/[a-z0-9]+/g)||[];return list.filter(e=>e.keywords.some(k=>terms.includes(k))).map(e=>({title:e.title,url:e.url}));};
}
// Source text hygiene (06/10/2026, third real mission): marketing mail pads
// its preview with invisible format characters (U+034F, ZWNJ…). They are
// removed and spaces normalized; letters, accents and emoji stay.
const cleanSourceText=value=>typeof value==='string'?value.replace(/[\p{Cf}͏]/gu,'').replace(/\s+/g,' ').trim():'';
// Reuses the existing OAuth-backed private-context readers (the same ones the
// Executive Chat dashboard uses). They exist only for Cliente Cero's Google
// authorization today; any other owner gets no adapter, i.e. NEEDS_CONNECTION.
// readers: { gmailReader(), calendarReader() } from buildDashboardReaders.
function createPrivateContextAdapters({scope,readers,origin='live'}){
 if(!readers||typeof readers.gmailReader!=='function'||typeof readers.calendarReader!=='function')return freeze({});
 const payload=async(reader,field)=>{
  const context=await reader();
  if(!context||context.capabilityGap||!context.privatePayload||!Array.isArray(context.privatePayload[field]))throw Object.assign(new Error('connection_required'),{code:'connection_required',failureKind:'connection'});
  return context.privatePayload[field];
 };
 const limit=(limits,list)=>list.slice(0,Math.min(Math.max(Number(limits&&limits.maxItems)||10,1),10));
 // Each item carries its readable text plus a closed set of signals for the
 // local analysis (validateItems keeps only those); the sender is shown by
 // name when the header has one, never with its address.
 const mail=createReadonlyAdapter({scope,permissions:['mail.read'],origin,read:async({limits})=>limit(limits,await payload(readers.gmailReader,'messages')).map(m=>({
  text:[m.from?cleanSourceText(extractSenderName(m.from)).replace(/^"(.*)"$/,'$1'):'',cleanSourceText(m.subject),cleanSourceText(m.snippet)].filter(Boolean).join(' — ').slice(0,2000)||'(sin asunto)',
  signals:{type:'mail',unread:m.unread===true,important:m.important===true,starred:m.starred===true,category:m.category||null,date:m.date||null}}))});
 const calendar=createReadonlyAdapter({scope,permissions:['calendar.read'],origin,read:async({limits})=>limit(limits,await payload(readers.calendarReader,'events')).map(e=>({
  text:[e.start,cleanSourceText(e.title),cleanSourceText(e.location)].filter(Boolean).join(' · ').slice(0,2000),
  signals:{type:'calendar',start:e.start||null,allDay:e.allDay===true}}))});
 return freeze({mail:{...mail,authorizationVerified:false},calendar:{...calendar,authorizationVerified:false}});
}
module.exports={createReadonlyAdapter,createPublicResearchAdapters,createPrivateContextAdapters,createCuratedDiscovery,readableText,cleanSourceText};
