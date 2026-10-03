'use strict';
const { randomUUID } = require('node:crypto');
const { createSupervisedRuntime } = require('./mission-runtime');
const { freeze, fail } = require('./scope-session');
// The transport MUST pass the identity produced by Firebase authentication.
// No tenant, uid, connection, tokens, scopes or planner may come from the body.
function createChatGateway({runtime,membershipProvider,adapterFactory=null,storeFactory,costController,approvalFactory}={}){
 const r=runtime||createSupervisedRuntime({membershipProvider,storeFactory,costController,approvalFactory});
 const latest=new Map();
 async function handle(identity,body){
  if(!identity||identity.authorized!==true||!['admin','family_member'].includes(identity.role)||typeof identity.uid!=='string')fail('authenticated_identity_required');
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['query','conversationId','action','missionId','includeDetails'].includes(k)))fail('chat_request_invalid');
  const session=await r.openSession(identity.uid);
  if(adapterFactory){const adapters=await adapterFactory(identity);for(const[provider,adapter]of Object.entries(adapters||{}))r.connections.install(session,provider,adapter);}
  const conversationId=body.conversationId||randomUUID();const key=JSON.stringify([identity.uid,conversationId]);
  let state;const action=body.action||'start';
  if(action==='onboarding')return {ok:true,response:r.onboarding(session).message,conversationId,executionEnabled:false};
  if(['resume','cancel','pause','status'].includes(action)){const id=body.missionId||latest.get(key);if(!id)fail('mission_not_found');state=await r[action==='status'?'get':action](session,id);}
  else if(action==='start'){
   const prior=latest.get(key);
   if(prior&&/^(contin[uú]a|reanuda|ya est[aá] conectado|hazlo)[.!\s]*$/i.test(body.query||''))state=await r.resume(session,prior);
   else state=await r.start(session,{text:body.query,conversationId});
  }else fail('chat_action_invalid');
  if(state.id)latest.set(key,state.id);
  let response=state.message||'No puedo dar la misión por completada. El resultado queda pendiente.';
  if(state.status==='NEEDS_CONNECTION')response=state.connectionRequests.map(g=>[g.reason,'Permiso solicitado: '+({ 'mail.read':'leer tu correo','calendar.read':'leer tu agenda','documents.read':'consultar tus documentos','public.search':'buscar información pública','public.fetch':'leer páginas públicas' }[g.permission]||'consultar la fuente'),g.canDo,g.cannotDo,g.how].join(' ')).join('\n');
  else if(state.status==='COMPLETED')response=state.result?.capability==='memory.remember'?'He guardado esta información en tu memoria personal.':state.result?.items.length?state.result.items.map(v=>v.text).join('\n'):'No he encontrado resultados en tus fuentes.';
  else if(state.status==='NEEDS_APPROVAL')response='He preparado una propuesta para tu revisión. Necesito que decidas la estructura y autorices los cambios; no he modificado ni enviado nada.';
  else if(state.status==='CANCELLED')response='Misión cancelada.';
  else if(state.status==='PAUSED')response='Misión en pausa. Puedes reanudarla cuando quieras.';
  return freeze({ok:true,response,conversationId,missionId:state.id||null,executionEnabled:false,...(body.includeDetails===true?{details:state}:{})});
 }
 return Object.freeze({handle,runtime:r});
}
module.exports={createChatGateway};
