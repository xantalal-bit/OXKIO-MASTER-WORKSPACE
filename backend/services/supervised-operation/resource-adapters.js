'use strict';
const { createPublicWebFetcher, parsePublicUrl, siteOf } = require('../executive-brain/mission-capabilities/public-web-fetcher');
const { copy, freeze, fail } = require('./scope-session');
// Factories run in the trusted composition root/OAuth callback, not in a prompt.
// The credential-bearing client stays in a closure and never enters agent input.
function createReadonlyAdapter({scope,permissions,read,origin='live'}){
 if(!scope||typeof read!=='function')fail('adapter_invalid');
 const owner=freeze(copy(scope));
 return Object.freeze({...owner,scopes:Object.freeze([...permissions]),origin,read:async input=>{
  if(JSON.stringify([input.scope.tenantId,input.scope.clientId,input.scope.userId])!==JSON.stringify([owner.tenantId,owner.clientId,owner.userId]))fail('adapter_scope_invalid');
  const items=await read({query:input.query,urls:input.urls,strategy:input.strategy,scope:copy(owner),signal:input.signal});
  return {...owner,items};
 }});
}
function createPublicResearchAdapters({scope,search,fetcher=createPublicWebFetcher(),origin='live'}){
 const fetch=createReadonlyAdapter({scope,permissions:['public.fetch'],origin,read:async({urls})=>{
  const items=[];for(const url of urls){parsePublicUrl(url);const page=await fetcher.fetchPage(url,{allowedSite:siteOf(new URL(url).hostname)});items.push({text:page.text.slice(0,2000),url});}return items;
 }});
 const discovery=typeof search==='function'?createReadonlyAdapter({scope,permissions:['public.search'],origin,read:async({query})=>{
  const result=await search(query);if(!Array.isArray(result))fail('search_output_invalid');return result.slice(0,5).map(item=>{parsePublicUrl(item.url);return {text:String(item.title||item.snippet||item.url).slice(0,2000),url:item.url};});
 }}):null;
 return Object.freeze({fetch,...(discovery?{search:discovery}:{})});
}
module.exports={createReadonlyAdapter,createPublicResearchAdapters};
