'use strict';
const { createSupervisedRuntime } = require('./mission-runtime');
const { freeze, fail } = require('./scope-session');
// The transport MUST pass the identity produced by Firebase authentication.
// No tenant, uid, connection, tokens, scopes or planner may come from the body.
// The existing web client also sends its private-context toggles
// ("calendar"/"gmail" objects); they are accepted only as ignored hints so the
// same client works, and never as identity, scope or connection.
const ALLOWED_KEYS = ['query','conversationId','action','missionId','includeDetails'];
const IGNORED_CLIENT_HINTS = ['calendar','gmail'];
// The web client keeps no conversation id: each user gets one default
// conversation (always keyed by the authenticated uid) so follow-ups work.
const DEFAULT_CONVERSATION = 'executive-default';
const FOLLOW_UP = /^(contin[uú]a|sigue|adelante|reanuda|reint[eé]ntalo|vuelve a intentarlo|ya est[aá] conectad[oa]|ya lo he conectado|ya he conectado.*|listo|hecho|hazlo)[.!\s]*$/i;
const PERMISSIONS = { 'mail.read':'leer tu correo','calendar.read':'leer tu agenda','documents.read':'consultar tus documentos','public.search':'buscar información pública','public.fetch':'leer páginas públicas' };
function createChatGateway({runtime,membershipProvider,adapterFactory=null,storeFactory,approvalFactory,planner,conversationDecider,reasoner,catalog,connectable,privacyPolicy}={}){
 const r=runtime||createSupervisedRuntime({membershipProvider,storeFactory,approvalFactory,planner,conversationDecider,reasoner,catalog,connectable,privacyPolicy});
 const latest=new Map();
 async function handle(identity,body){
  if(!identity||identity.authorized!==true||!['admin','family_member'].includes(identity.role)||typeof identity.uid!=='string')fail('authenticated_identity_required');
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!ALLOWED_KEYS.includes(k)&&!IGNORED_CLIENT_HINTS.includes(k)))fail('chat_request_invalid');
  if(IGNORED_CLIENT_HINTS.some(k=>body[k]!==undefined&&(body[k]===null||typeof body[k]!=='object'||Array.isArray(body[k]))))fail('chat_request_invalid');
  const session=await r.openSession(identity.uid);
  const conversationId=body.conversationId||DEFAULT_CONVERSATION;const key=JSON.stringify([identity.uid,conversationId]);
  let state;const action=body.action||'start';
  // The human resuming a mission ("continúa", "ya lo he conectado", resume)
  // is the reconnection signal: only then is an expired or reduced connection
  // replaced by a fresh adapter (unverified until its first read succeeds).
  const resuming=action==='resume'||(action==='start'&&typeof body.query==='string'&&latest.has(key)&&FOLLOW_UP.test(body.query.trim()));
  // Trusted composition installs the owner's adapters once; an active
  // connection is never replaced mid-flight by a concurrent request, and an
  // expired one is not silently reinstalled by an ordinary question.
  if(adapterFactory){const adapters=await adapterFactory(identity,r.scope(session));for(const[provider,adapter]of Object.entries(adapters||{}))if(!r.connections.installed(session,provider)||(resuming&&(adapter.scopes||[]).some(scope=>!r.connections.inspect(session,provider,scope).ready)))r.connections.install(session,provider,adapter);}
  if(action==='onboarding')return freeze({ok:true,response:r.onboarding(session).message,conversationId,executionEnabled:false});
  if(['resume','cancel','pause','status'].includes(action)){const id=body.missionId||latest.get(key);if(!id)fail('mission_not_found');state=await r[action==='status'?'get':action](session,id);}
  else if(action==='start'){
   if(typeof body.query!=='string')fail('chat_request_invalid');
   state=await r.start(session,{text:body.query,conversationId});
  }else fail('chat_action_invalid');
  if(state.id)latest.set(key,state.id);
  const response=describe(state);
  if(typeof r.recordTurn==='function'&&action!=='status'){const previous=action==='start'?null:r.turnContext(session,conversationId);const query=action==='start'?body.query:previous?.lastUser;if(typeof query==='string')await r.recordTurn(session,conversationId,{query,response,state});}
  return freeze({ok:true,response,conversationId,missionId:state.id||null,outcome:state.outcome||state.status||null,executionEnabled:false,...(body.includeDetails===true?{details:state}:{})});
 }
 function describe(state){
  if(state.message)return state.message;
  if(state.status==='NEEDS_CONNECTION'){
   if(!state.connectionRequests.length)return 'Necesito que vuelvas a autorizar la conexión para continuar. La misión queda guardada y continuará desde este punto.';
   return state.connectionRequests.map(g=>[g.reason,'Permiso solicitado: '+(PERMISSIONS[g.permission]||'consultar la fuente')+'.',g.canDo,g.cannotDo,g.how].join(' ')).join('\n')+'\nLa misión queda guardada y continuará desde este punto.';
  }
  if(state.status==='WAITING_RESOURCE')return 'El recurso de razonamiento no está disponible ahora (límite, cuota, presupuesto o fallo del proveedor) y no hay alternativa autorizada. La misión y sus fuentes quedan guardadas en este punto; di "continúa" para reanudarla. No he ejecutado nada externo.';
  if(state.status==='COMPLETED'&&state.result?.synthesis)return synthesisText(state.result);
  if(state.status==='COMPLETED')return state.result?.capability==='memory.remember'?'He guardado esta información en tu memoria personal.':state.result?.items.length?state.result.items.map(v=>v.text).join('\n'):'No he encontrado resultados en tus fuentes.';
  if(state.status==='NEEDS_APPROVAL')return 'He preparado una propuesta para tu revisión. Necesito que decidas la estructura y autorices los cambios; no he modificado ni enviado nada.';
  if(state.status==='CANCELLED')return 'Misión cancelada.';
  if(state.status==='PAUSED')return 'Misión en pausa. Puedes reanudarla cuando quieras.';
  if(state.diagnosis?.class==='capability_degraded')return 'Esta fuente ha fallado varias veces seguidas. Lo he registrado para revisión y no lo reintento automáticamente ahora; no he ejecutado nada más.';
  if(state.diagnosis?.class==='privacy_gate')return 'No he enviado la búsqueda: contenía datos personales y el proveedor no está autorizado para ellos. Reformúlala sin datos personales si quieres que busque.';
  return 'No puedo dar la misión por completada. El resultado queda pendiente de revisión.';
 }
 // Sources are numbered among those the model actually reasoned over (never
 // internal ids), public ones listed with their link; the resource that
 // reasoned and any rejected resource are always disclosed.
 function synthesisText(result){
  const s=result.synthesis;const used=s.sourceIds||result.items.map(v=>v.id);const position=new Map(used.map((id,i)=>[id,i+1]));
  const cite=ids=>' [fuente '+ids.map(id=>position.get(id)).filter(Boolean).join(', ')+']';
  const listed=used.map((id,i)=>{const item=result.items.find(v=>v.id===id);return item&&item.url?(i+1)+') '+item.url:null;}).filter(Boolean);
  return [s.conclusion,...s.findings.map(f=>'- '+f.claim+cite(f.sourceIds)),...(s.comparison?['Comparación: '+s.comparison]:[]),...(listed.length?['Fuentes: '+listed.join(' · ')]:[]),
   'La respuesta recoge '+used.length+' fuentes con respaldo textual comprobado. No he realizado envíos ni cambios externos.'].join('\n');
 }
 return Object.freeze({handle,runtime:r,defaultConversation:DEFAULT_CONVERSATION});
}
module.exports={createChatGateway};
