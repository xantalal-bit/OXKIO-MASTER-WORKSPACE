'use strict';
const { createChatGateway } = require('./chat-gateway');
const { createMemoryStoreFactory } = require('./memory-store');
const { fail } = require('./scope-session');
const { createScopedApprovalFactory } = require('./approval-factory');
// Opt-in only; installing code never activates a pilot or grants a new service.
// Identities enter solely from the existing verified Firebase request boundary.
function createServerComposition({enabled=false,memoryRoot,authorizeIdentity,costController,adapterFactory=null}={}){
 if(!enabled)return null;
 if(typeof authorizeIdentity!=='function')fail('authorizer_required');
 const identities=new Map();
 const gateway=createChatGateway({costController,approvalFactory:createScopedApprovalFactory({root:memoryRoot}),storeFactory:createMemoryStoreFactory({root:memoryRoot}),adapterFactory,
  membershipProvider:{findMemberships:async({authenticatedUserId})=>{
   const identity=identities.get(authenticatedUserId);if(!identity)return [];
   const current=authorizeIdentity({uid:identity.uid,email:identity.email,email_verified:identity.emailVerified});
   if(!current.ok||current.identity.clientId!==identity.clientId)return [];
   return [{tenantId:identity.clientId,userId:identity.uid,clientId:identity.clientId,roles:['owner'],status:'ACTIVE'}];
  }}
 });
 async function handle(req,res){
  const identity=req.oxkioIdentity;
  if(!identity?.authorized){res.writeHead(401);res.end();return;}
  identities.set(identity.uid,identity);
  try{
   let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>8192)fail('body_too_large');}
   const response=await gateway.handle(identity,JSON.parse(text||'{}'));
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(response));
  }catch(error){
   const code=/^[a-z_]+$/.test(error.code||'')?error.code:'chat_request_invalid';
   res.writeHead(['membership_not_available','permission_denied','authenticated_identity_required'].includes(code)?403:400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   res.end(JSON.stringify({ok:false,code,response:'No he ejecutado la petición. Revisa la conexión o el permiso solicitado.',executionEnabled:false}));
  }
 }
 return Object.freeze({handle});
}
module.exports={createServerComposition};
