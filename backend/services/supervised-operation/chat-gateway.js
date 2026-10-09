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
  // A continuation in a conversation without its own waiting mission (the
  // page was left to reconnect a source) is resolved from the owner's
  // persisted missions by the runtime: one mission, a list to choose, or none.
  const target=action==='start'&&typeof body.query==='string'&&typeof r.resumeTarget==='function'?await r.resumeTarget(session,conversationId,body.query):null;
  const resuming=action==='resume'||!!target?.missionId||(action==='start'&&typeof body.query==='string'&&latest.has(key)&&FOLLOW_UP.test(body.query.trim()));
  // Trusted composition installs the owner's adapters once; an active
  // connection is never replaced mid-flight by a concurrent request, and an
  // expired one is not silently reinstalled by an ordinary question.
  if(adapterFactory){const adapters=await adapterFactory(identity,r.scope(session));for(const[provider,adapter]of Object.entries(adapters||{}))if(!r.connections.installed(session,provider)||(resuming&&(adapter.scopes||[]).some(scope=>!r.connections.inspect(session,provider,scope).ready)))r.connections.install(session,provider,adapter);}
  if(action==='onboarding')return freeze({ok:true,response:r.onboarding(session).message,conversationId,executionEnabled:false});
  if(['resume','cancel','pause','status'].includes(action)){const id=body.missionId||latest.get(key);if(!id)fail('mission_not_found');state=await r[action==='status'?'get':action](session,id);}
  else if(action==='start'){
   if(typeof body.query!=='string')fail('chat_request_invalid');
   state=target?.missionId?await r.resume(session,target.missionId):target?.state||await r.start(session,{text:body.query,conversationId});
  }else fail('chat_action_invalid');
  if(state.id)latest.set(key,state.id);
  // The task is named; whether its connection now works is told by its state.
  const response=(target?.missionId?'Retomo la tarea «'+target.task+'» desde donde la dejamos.\n':'')+describe(state);
  if(typeof r.recordTurn==='function'&&action!=='status'){const previous=action==='start'?null:r.turnContext(session,conversationId);const query=action==='start'?body.query:previous?.lastUser;if(typeof query==='string')await r.recordTurn(session,conversationId,{query,response,state,...(target?.objective?{objective:target.objective}:{})});}
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
   // A mission extended after an empty first reading says what it checked.
   const checked=state.diagnosis?.class==='objective_unmet'?[checkedText(state.diagnosis)]:[];
   return [...checked,...lines].join('\n')+'\n'+(state.connectionRequests.some(g=>g.connectable)?RESUME:'He guardado esta tarea, pero no podré continuarla mientras esa conexión no esté disponible para tu cuenta.');
  }
  if(state.status==='WAITING_RESOURCE')return 'El recurso de razonamiento no está disponible ahora (límite, cuota, presupuesto o fallo del proveedor) y no hay alternativa autorizada. La misión y sus fuentes quedan guardadas en este punto; di "continúa" para reanudarla. No he ejecutado nada externo.';
  if(state.status==='COMPLETED'&&state.result?.localAnalysis)return localText(state.result,state.planSources||[]);
  if(state.status==='NEEDS_CAPABILITY'&&state.diagnosis?.class==='analysis_unavailable'&&state.result)return partialText(state.result);
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
 const checkedText=d=>d.consulted.length?'He comprobado '+list(d.consulted)+' y no '+(d.consulted.length>1?'contienen':'contiene')+' información para esto.':'No he encontrado información para esto.';
 // The objective was not certified and no needed source could be decided:
 // what was checked, the decider's own question or where the information may
 // be (labels, never ids or status names), and that nothing was closed.
 function unmetText(d){
  const pending=d.missing.filter(v=>v.needsConnection).map(v=>v.label);
  const ask=d.question||('Dime dónde puede estar esa información'+(d.missing.length?' (por ejemplo, '+list(d.missing.map(v=>v.label))+')':'')+(pending.length?'; '+list(pending)+' primero '+(pending.length>1?'necesitan':'necesita')+' conexión':'')+', o dámela tú y trabajo con ella.');
  return [checkedText(d),ask,'No doy la tarea por terminada y no he realizado envíos ni cambios externos.'].join(' ');
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
 // The analysis the objective needed did not happen: what was read is shown
 // as a partial result and the task is not presented as done.
 function partialText(result){
  return [SKIPPED[result.cognitionSkipped]||SKIPPED.unavailable,'Por eso no doy la tarea por terminada.',...references(result),'No he realizado envíos ni cambios externos.'].join('\n');
 }
 // Local analysis (06/10/2026): every sentence is built from the cited items
 // and fixed reasons, never from text the analysis wrote. Mail is named by
 // sender and subject; agenda events by title and when they happen.
 const BECAUSE={important_unread:'está marcado como importante y todavía no lo has leído',starred_unread:'lo marcaste con estrella y todavía no lo has leído',important:'está marcado como importante',starred:'lo marcaste con estrella'};
 const BECAUSE_MANY={important_unread:'están marcados como importantes y todavía no los has leído',starred_unread:'los marcaste con estrella y todavía no los has leído',important:'están marcados como importantes',starred:'los marcaste con estrella'};
 // P2 UX (09/10/2026): distinct messages with the same sender and subject (exact
 // match after trim, spacing and case) are named once with their count. Only the
 // sentence changes: the items, their ids and the analysis stay as they are.
 const mailKey=item=>item.text.split(' — ').slice(0,2).map(v=>v.trim().replace(/\s+/g,' ').toLocaleLowerCase('es-ES')).join('\u0000');
 function groupMail(entries,byId){
  const groups=[];const index=new Map();
  for(const e of entries){const item=byId.get(e.itemId);const key=e.kind==='event'?null:mailKey(item)+'\u0000'+(e.reason||'');
   if(key!==null&&index.has(key)){index.get(key).items.push(item);continue;}
   const g={kind:e.kind,reason:e.reason,items:[item]};groups.push(g);if(key!==null)index.set(key,g);}
  return groups;
 }
 const countOf=groups=>groups.reduce((n,g)=>n+g.items.length,0);
 function localText(result,planSources){
  const a=result.localAnalysis;const byId=new Map(result.items.map(v=>[v.id,v]));
  const mailOf=(item,count=1)=>{const [who,subject]=item.text.split(' — ');return (count===1?'el correo':count+' correos')+' de '+who+(subject?' («'+subject+'»)':'');};
  const groupOf=g=>g.kind==='event'?eventOf(g.items[0]):mailOf(g.items[0],g.items.length);
  const titleOf=item=>{const start=item.signals?.start;const text=start&&item.text.startsWith(start+' · ')?item.text.slice(start.length+3):item.text;return text.split(' · ')[0];};
  const timeOf=item=>{const start=item.signals?.start;if(!start||item.signals.allDay||start.length===10)return null;const d=new Date(start);return Number.isNaN(d.getTime())?null:d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});};
  const eventOf=item=>titleOf(item)+(timeOf(item)?' a las '+timeOf(item):'');
  const lines=[];
  const todayEvents=[...a.priorities.filter(p=>p.kind==='event').map(p=>byId.get(p.itemId)),...a.context.filter(c=>c.when==='today').map(c=>byId.get(c.itemId))];
  if(planSources.includes('tu agenda')||todayEvents.length)lines.push(todayEvents.length?'Hoy en tu agenda: '+list(todayEvents.map(eventOf))+'.':'Hoy no tienes eventos en la agenda.');
  const tomorrow=a.context.filter(c=>c.when==='tomorrow').map(c=>eventOf(byId.get(c.itemId)));if(tomorrow.length)lines.push('Mañana: '+list(tomorrow)+'.');
  const upcoming=a.context.filter(c=>c.when==='upcoming').map(c=>byId.get(c.itemId));if(upcoming.length)lines.push('Próximos días: '+list(upcoming.slice(0,3).map(eventOf))+(upcoming.length>3?' y '+(upcoming.length-3)+' más':'')+'.');
  const first=a.firstAction&&byId.get(a.firstAction.itemId);
  // The first action is priorities[0]; its group carries every equivalent message of the same level.
  const groups=groupMail(a.priorities,byId);const firstGroup=first&&groups.find(g=>g.items.includes(first));
  if(!first)lines.push('No veo nada en lo que he consultado que pida actuar primero hoy.');
  else if(a.firstAction.reason==='today_event')lines.push('Primero atendería '+eventOf(first)+', que es hoy.');
  else{const n=firstGroup?firstGroup.items.length:1;lines.push('Primero revisaría '+mailOf(first,n)+', porque '+(n===1?BECAUSE:BECAUSE_MANY)[a.firstAction.reason]+'.');}
  const rest=groups.filter(g=>g!==firstGroup);const after=rest.slice(0,3);const more=countOf(rest.slice(3));
  if(after.length)lines.push('Después: '+list(after.map(groupOf))+(more?' y '+more+' más':'')+'.');
  // Unread mail with no other signal is pending review, named but never put first.
  const review=groupMail((a.review||[]).map(itemId=>({itemId,kind:'mail'})),byId);const reviewCount=countOf(review);const one=reviewCount===1;
  if(review.length)lines.push((review.length===1?'Tienes sin leer, '+(one?'pendiente':'pendientes')+' de revisar, '+groupOf(review[0]):'Tienes '+reviewCount+' correos sin leer pendientes de revisar: '+list(review.slice(0,3).map(groupOf))+(review.length>3?' y '+countOf(review.slice(3))+' más':''))+'; no veo en '+(one?'él':'ellos')+' señales que pidan atenderlo'+(one?'':'s')+' primero.');
  if(a.noise.length)lines.push((a.noise.length===1?'Otro mensaje reciente parece una notificación o una promoción':'Otros '+a.noise.length+' mensajes recientes parecen notificaciones o promociones')+'; no '+(a.noise.length===1?'lo':'los')+' pondría por delante.');
  if(a.informational.length)lines.push((a.informational.length===1?'Un correo reciente ya leído no muestra':a.informational.length+' correos recientes ya leídos no muestran')+' señales de urgencia.');
  const notes=a.notes.map(id=>byId.get(id).text).map(t=>t.length>120?t.slice(0,119)+'…':t);
  if(notes.length)lines.push('También tienes: '+list(notes.slice(0,3))+'.');
  lines.push('Lo he analizado aquí, sin enviar tus datos fuera de OXKIO. No he realizado envíos ni cambios externos.');
  return lines.join('\n');
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
