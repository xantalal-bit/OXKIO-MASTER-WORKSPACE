'use strict';
const { createChatGateway } = require('./chat-gateway');
const { createMemoryStoreFactory } = require('./memory-store');
const { fail } = require('./scope-session');
const { createScopedApprovalFactory } = require('./approval-factory');
const { createHmacIntegrity } = require('./integrity');
const { createAdaptivePlanner } = require('./adaptive-planner');
const { createPrivateContextAdapters } = require('./resource-adapters');
const { createGovernedReasoner } = require('./governed-reasoning');
// Opt-in only; installing code never activates a pilot or grants a new service.
// Identities enter solely from the existing verified Firebase request boundary.
// Routing is per identity: only uids listed in the cohort reach V3; everyone
// else (Cliente Cero included, unless explicitly listed) keeps the existing
// Executive Chat. Rollback = remove the uid (or the flag) and restart; V3 data
// stays sealed in its own root and the existing chat is untouched.
const parseCohort = value => new Set(String(value || '').split(',').map(v => v.trim()).filter(v => /^[A-Za-z0-9:_-]{3,128}$/.test(v)));
const STATUS = { membership_not_available: 403, permission_denied: 403, authenticated_identity_required: 403, session_authority_changed: 403, backpressure: 429, mission_capacity: 429, store_capacity: 429, mission_busy: 409, stored_integrity_invalid: 409, stored_scope_invalid: 409 };
function createServerComposition({enabled=false,cohortUids='',memoryRoot,integrityKey,authorizeIdentity,adapterFactory=null,privateContextReaders=null,publicResearch=null,reasoning=null}={}){
 if(!enabled)return null;
 const cohort=parseCohort(cohortUids);
 if(cohort.size===0)return null;
 if(typeof authorizeIdentity!=='function')fail('authorizer_required');
 // Fail closed: without a valid integrity key V3 is not composed at all.
 const integrity=createHmacIntegrity({key:integrityKey});
 const identities=new Map();
 const planner=reasoning&&reasoning.provider?createAdaptivePlanner({provider:reasoning.provider,privacyPolicy:reasoning.privacyPolicy,approvedDailyBudgetUsd:Number(reasoning.approvedDailyBudgetUsd)||0}).plan:null;
 // Reasoning resources in preference order (primary first). Cognition stays
 // off unless a provider is configured and a positive budget is approved.
 const providers=reasoning?(Array.isArray(reasoning.providers)?reasoning.providers:reasoning.provider?[reasoning.provider]:[]):[];
 const reasoner=reasoning?createGovernedReasoner({providers,privacyPolicy:reasoning.privacyPolicy,approvedDailyBudgetUsd:Number(reasoning.approvedDailyBudgetUsd)||0,...(reasoning.requestPrivacyFloor?{requestFloor:reasoning.requestPrivacyFloor}:{})}):null;
 const catalog=Object.assign({},reasoning&&reasoning.catalog,...providers.map(p=>(p&&p.catalog)||{}));
 const privateFactory=adapterFactory||(typeof privateContextReaders==='function'?async(identity,scope)=>createPrivateContextAdapters({scope,readers:privateContextReaders(identity)}):null);
 // Public research adapters (search + fetch) are added per owner scope next to
 // the private ones; they carry no credential and read only public pages.
 const factory=privateFactory||typeof publicResearch==='function'?async(identity,scope)=>({...(privateFactory?await privateFactory(identity,scope):{}),...(typeof publicResearch==='function'?publicResearch(scope):{})}):null;
 const gateway=createChatGateway({approvalFactory:createScopedApprovalFactory({root:memoryRoot}),storeFactory:createMemoryStoreFactory({root:memoryRoot,integrity}),adapterFactory:factory,planner,reasoner,
  catalog,privacyPolicy:reasoning&&reasoning.privacyPolicy,
  // Only Cliente Cero has a connection flow today (its existing Google OAuth).
  connectable:(scope,provider)=>scope.clientId==='cliente-cero'&&['mail','calendar'].includes(provider),
  membershipProvider:{findMemberships:async({authenticatedUserId})=>{
   const identity=identities.get(authenticatedUserId);if(!identity)return [];
   const current=authorizeIdentity({uid:identity.uid,email:identity.email,email_verified:identity.emailVerified});
   if(!current.ok||current.identity.clientId!==identity.clientId||!cohort.has(identity.uid))return [];
   // 'owner' of the identity's own partition [clientId, clientId, uid] only:
   // V3 exposes no tenant-wide or global administration to any role.
   return [{tenantId:identity.clientId,userId:identity.uid,clientId:identity.clientId,roles:['owner'],status:'ACTIVE'}];
  }}
 });
 function accepts(identity){return Boolean(identity&&identity.authorized===true&&['admin','family_member'].includes(identity.role)&&typeof identity.uid==='string'&&cohort.has(identity.uid));}
 async function handle(req,res){
  const identity=req.oxkioIdentity;
  if(!identity?.authorized){res.writeHead(401);res.end();return;}
  if(!accepts(identity)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,code:'v3_not_enabled_for_identity',executionEnabled:false}));return;}
  identities.set(identity.uid,identity);
  try{
   let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>8192)fail('body_too_large');}
   const response=await gateway.handle(identity,JSON.parse(text||'{}'));
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-OXKIO-Handler':'supervised-operation'});res.end(JSON.stringify(response));
  }catch(error){
   const code=/^[a-z_]+$/.test(error.code||'')?error.code:'chat_request_invalid';
   res.writeHead(STATUS[code]||400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   res.end(JSON.stringify({ok:false,code,response:'No he ejecutado la petición. Revisa la conexión o el permiso solicitado.',executionEnabled:false}));
  }
 }
 return Object.freeze({handle,accepts});
}
// Authorization B (04/10/2026) as one explicit switch: only with
// OXKIO_V3_REASONING_INTERNAL_EGRESS=true may PUBLIC and non-sensitive INTERNAL
// text reach the configured reasoning provider. There is deliberately no
// switch for CONFIDENTIAL or SECRET: confidentialProviders stays empty.
function reasoningEgressFromEnv(env,provider){
 if(env.OXKIO_V3_REASONING_INTERNAL_EGRESS!=='true'||!provider||provider.status!=='ready'||typeof provider.provider!=='string')return {};
 return {requestPrivacyFloor:'INTERNAL',privacyPolicy:Object.freeze({publicExternalAllowed:true,internalProviders:Object.freeze([Object.freeze({providerId:provider.provider})]),confidentialProviders:Object.freeze([])})};
}
// V3 reasons through its OWN Executive Reasoning Provider instance, configured
// by OXKIO_V3_REASONING_* (mapped onto the provider's existing contract). The
// shared provider used by Executive Chat and the email supervisor stays as it
// is, so enabling V3 cognition never enables model calls on their (private)
// context. Only the API key secret is shared, and alone it enables nothing.
const V3_REASONING_FIELDS=['PROVIDER','MODEL','BASE_URL','INPUT_USD_PER_MILLION','OUTPUT_USD_PER_MILLION','PRICING_REVIEWED_AT'];
function v3ReasoningEnv(env){
 const mapped={};
 for(const field of V3_REASONING_FIELDS)if(typeof env['OXKIO_V3_REASONING_'+field]==='string')mapped['OXKIO_REASONING_'+field]=env['OXKIO_V3_REASONING_'+field];
 return mapped;
}
module.exports={createServerComposition,parseCohort,reasoningEgressFromEnv,v3ReasoningEnv};
