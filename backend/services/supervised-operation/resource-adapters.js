'use strict';
const { createPublicWebFetcher, parsePublicUrl, siteOf } = require('../executive-brain/mission-capabilities/public-web-fetcher');
const { textRuns } = require('../executive-brain/mission-capabilities/company-research-extract');
const { copy, freeze, fail } = require('./scope-session');
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
function createPublicResearchAdapters({scope,search,searchEgress=null,fetcher=createPublicWebFetcher(),origin='live'}){
 const fetch=createReadonlyAdapter({scope,permissions:['public.fetch'],origin,read:async({urls})=>{
  const items=[];for(const url of urls){parsePublicUrl(url);const page=await fetcher.fetchPage(url,{allowedSite:siteOf(new URL(url).hostname)});items.push({text:readableText(page.text).slice(0,2000),url});}return items;
 }});
 const discovery=typeof search==='function'?createReadonlyAdapter({scope,permissions:['public.search'],origin,egress:searchEgress,read:async({query})=>{
  const result=await search(query);if(!Array.isArray(result))fail('search_output_invalid');return result.slice(0,5).map(item=>{parsePublicUrl(item.url);return {text:String(item.title||item.snippet||item.url).slice(0,2000),url:item.url};});
 }}):null;
 return Object.freeze({fetch,...(discovery?{search:discovery}:{})});
}
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
 const mail=createReadonlyAdapter({scope,permissions:['mail.read'],origin,read:async({limits})=>limit(limits,await payload(readers.gmailReader,'messages')).map(m=>({text:[m.from,m.subject,m.snippet].filter(Boolean).join(' — ').slice(0,2000)||'(sin asunto)'}))});
 const calendar=createReadonlyAdapter({scope,permissions:['calendar.read'],origin,read:async({limits})=>limit(limits,await payload(readers.calendarReader,'events')).map(e=>({text:[e.start,e.title,e.location].filter(Boolean).join(' · ').slice(0,2000)}))});
 return freeze({mail:{...mail,authorizationVerified:false},calendar:{...calendar,authorizationVerified:false}});
}
module.exports={createReadonlyAdapter,createPublicResearchAdapters,createPrivateContextAdapters,readableText};
