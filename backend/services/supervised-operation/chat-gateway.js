'use strict';
const { createSupervisedRuntime } = require('./mission-runtime');
const { INSUFFICIENT_SOURCES } = require('../executive-brain/synthesis-verifier');
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
   const RESUME='He guardado esta tarea: en cuanto la conexión esté lista, di «continúa» y seguiré desde este punto sin que tengas que repetir la petición.';
   if(!state.connectionRequests.length)return 'Necesito que vuelvas a autorizar la conexión para continuar. '+RESUME;
   // What the permission allows and what it never allows are labelled, and
   // continuation is promised only when this account can actually connect.
   const lower=v=>v.charAt(0).toLowerCase()+v.slice(1);
   const lines=state.connectionRequests.map(g=>[g.reason,'Permiso solicitado: '+(PERMISSIONS[g.permission]||'consultar la fuente')+'.','Con él podré '+lower(g.canDo),'Nunca podré '+lower(g.cannotDo),g.how].join(' '));
   return lines.join('\n')+'\n'+(state.connectionRequests.some(g=>g.connectable)?RESUME:'He guardado esta tarea, pero no podré continuarla mientras esa conexión no esté disponible para tu cuenta.');
  }
  if(state.status==='WAITING_RESOURCE')return 'El recurso de razonamiento no está disponible ahora (límite, cuota, presupuesto o fallo del proveedor) y no hay alternativa autorizada. La misión y sus fuentes quedan guardadas en este punto; di "continúa" para reanudarla. No he ejecutado nada externo.';
  if(state.status==='COMPLETED'&&state.result?.synthesis)return synthesisText(state.result);
  if(state.status==='COMPLETED'&&state.result?.cognitionSkipped)return skippedText(state.result);
  if(state.status==='COMPLETED'&&state.result?.items?.some(v=>v.provenance==='PUBLIC_WEB'))return publicReadText(state.result);
  if(state.status==='NEEDS_INFORMATION'&&state.diagnosis?.class==='objective_unmet')return unmetText(state.diagnosis);
  // An empty lookup names what was actually consulted, never "your sources".
  if(state.status==='COMPLETED')return state.result?.capability==='memory.remember'?'He guardado esta información en tu memoria personal.':state.result?.items.length?state.result.items.map(v=>v.text).join('\n'):state.planSources?.length?'He consultado '+list(state.planSources)+' y no he encontrado resultados.':'No he encontrado resultados.';
  if(state.status==='NEEDS_APPROVAL')return 'He preparado una propuesta para tu revisión. Necesito que decidas la estructura y autorices los cambios; no he modificado ni enviado nada.';
  if(state.status==='CANCELLED')return 'Misión cancelada.';
  if(state.status==='PAUSED')return 'Misión en pausa. Puedes reanudarla cuando quieras.';
  if(state.diagnosis?.class==='capability_degraded')return 'Esta fuente ha fallado varias veces seguidas. Lo he registrado para revisión y no lo reintento automáticamente ahora; no he ejecutado nada más.';
  if(state.diagnosis?.class==='privacy_gate')return 'No he enviado la búsqueda: contenía datos personales y el proveedor no está autorizado para ellos. Reformúlala sin datos personales si quieres que busque.';
  return 'No puedo dar la misión por completada. El resultado queda pendiente de revisión.';
 }
 const list=items=>items.length>1?items.slice(0,-1).join(', ')+' y '+items.at(-1):items[0]||'';
 // The objective was not met: what was checked (and found empty), where the
 // information may be (labels from the capability view, never ids or status
 // names), and that nothing was closed, sent or changed.
 function unmetText(d){
  const pending=d.missing.filter(v=>v.needsConnection).map(v=>v.label);const ready=d.missing.filter(v=>!v.needsConnection).map(v=>v.label);
  return [(d.consulted.length?'He comprobado '+list(d.consulted)+' y no '+(d.consulted.length>1?'contienen':'contiene')+' información para esto.':'No he encontrado información para esto.'),
   'Para hacerlo de verdad necesito consultar las fuentes donde puede estar'+(pending.length?', como '+list(pending)+', que primero hay que conectar'+(ready.length?'; también puedo consultar '+list(ready):''):', como '+list(ready))+'.',
   'También puedes darme tú esa información y trabajo con ella. No doy la tarea por terminada y no he realizado envíos ni cambios externos.'].join(' ');
 }
 // No analysis was possible: say why in plain words and list what was read.
 // Public pages are referenced (first sentence + link), never dumped whole;
 // discovery snippets are dropped when the pages themselves were read.
 const SKIPPED={privacy:'Para proteger tus datos no he enviado este contenido a analizar fuera de OXKIO, así que no hay análisis.',secret:'El contenido incluía un dato sensible, así que no lo he enviado a analizar.',unverified:'No he obtenido un análisis con respaldo comprobable en las fuentes, así que no presento conclusiones.',unavailable:'El análisis automático no está disponible ahora, así que no presento conclusiones.'};
 function references(result){
  const items=result.items.some(v=>v.provenance==='PUBLIC_WEB')?result.items.filter(v=>v.provenance!=='PUBLIC_DISCOVERY'):result.items;
  const shown=items.slice(0,10).map((v,i)=>{if(!v.url)return '- '+(v.text.length>300?v.text.slice(0,300)+'…':v.text);const first=(v.text.match(/^.{1,240}?[.!?](?=\s|$)/u)||[v.text.slice(0,240)+'…'])[0];return (i+1)+') '+first+' — '+v.url;});
  return shown.length?[items.some(v=>v.url)?'Fuentes consultadas:':'Información encontrada:',...shown]:[];
 }
 function skippedText(result){
  return [SKIPPED[result.cognitionSkipped]||SKIPPED.unavailable,...references(result),'No he realizado envíos ni cambios externos.'].join('\n');
 }
 // Public pages read without an analysis step are referenced, not dumped.
 function publicReadText(result){
  return ['He leído estas fuentes públicas; si quieres, puedo compararlas o resumirlas.',...references(result),'No he realizado envíos ni cambios externos.'].join('\n');
 }
 // Sources are numbered among those the model actually reasoned over (never
 // internal ids), public ones listed with their link. Findings are checked
 // against literal quotes; the assessment and comparison are labelled as an
 // inference over them. The resource stays in the details, not in the answer.
 function synthesisText(result){
  const s=result.synthesis;const used=s.sourceIds||result.items.map(v=>v.id);const position=new Map(used.map((id,i)=>[id,i+1]));
  const cite=ids=>' [fuente '+ids.map(id=>position.get(id)).filter(Boolean).join(', ')+']';
  const listed=used.map((id,i)=>{const item=result.items.find(v=>v.id===id);return item&&item.url?(i+1)+') '+item.url:null;}).filter(Boolean);
  // Only an inference over fully verified findings is shown as an assessment;
  // otherwise the limited or insufficient conclusion is shown as it is.
  const kind=s.conclusionKind||(s.conclusion.trim()===INSUFFICIENT_SOURCES?'insufficient':'inference');
  const dropped=(s.discarded||[]).length;
  return [kind==='inference'?'Valoración (inferencia a partir de los hallazgos): '+s.conclusion:s.conclusion,'Hallazgos:',...s.findings.map(f=>'- '+f.claim+cite(f.sourceIds)),...(kind==='inference'&&s.comparison?['Comparación (inferencia): '+s.comparison]:[]),
   ...(dropped===1?['He descartado 1 hallazgo que no pude comprobar en el texto de las fuentes; no lo presento como cierto.']:dropped>1?['He descartado '+dropped+' hallazgos que no pude comprobar en el texto de las fuentes; no los presento como ciertos.']:[]),
   ...(listed.length?['Fuentes: '+listed.join(' · ')]:[]),
   'Cada hallazgo mostrado tiene respaldo textual comprobado en '+used.length+' fuentes'+(kind==='inference'?'; la valoración y la comparación son inferencias sobre ellos':'')+'. No he realizado envíos ni cambios externos.'].join('\n');
 }
 return Object.freeze({handle,runtime:r,defaultConversation:DEFAULT_CONVERSATION});
}
module.exports={createChatGateway};
