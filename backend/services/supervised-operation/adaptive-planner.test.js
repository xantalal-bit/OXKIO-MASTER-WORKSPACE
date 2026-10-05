'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createAdaptivePlanner}=require('./adaptive-planner');const {createCapabilityManager}=require('./capability-manager');
const ctx=()=>({missionId:'fixture',spend:{estimate:()=>0.001,reserve:()=>({}),settle:()=>0.001}});
const input={intention:'Diseña una estrategia comercial general',capabilities:['memory.search','data.analyze']};
const policy={internalProviders:[{providerId:'fixture'}],confidentialProviders:[]};
function planner(content,extra={}) {const calls=[];const provider={status:'ready',provider:'fixture',region:'eu',modelId:'fixture:model',reason:async request=>{calls.push(request);return {status:'ok',content};}};return {calls,p:createAdaptivePlanner({provider,privacyPolicy:policy,approvedDailyBudgetUsd:1,requestFloor:'INTERNAL',...extra})};}
test('planner B permits generic INTERNAL intent while default remains confidential',async()=>{let x=planner({plan:[{key:'source',capability:'memory.search',dependsOn:[]}]});assert.equal((await x.p.plan(input,ctx())).length,1);assert.equal(x.calls.length,1);x=planner({plan:[]},{requestFloor:'CONFIDENTIAL'});await assert.rejects(x.p.plan(input,ctx()));assert.equal(x.calls.length,0);});
test('personal and private-derived contexts never leave under internal-only authorization',async()=>{for(const [data,context] of [[{...input,intention:'Ayuda con mi jefe'},ctx()],[{...input,intention:'Analiza mi préstamo de 20.000 €'},ctx()],[{...input,conversationContext:{lastUser:'mi salario privado'}},ctx()],[input,{...ctx(),derivedFromPrivate:true}],[input,{...ctx(),contextProvenance:['INTERNAL_MEMORY']}],[{...input,conversationContext:{lastResponse:'email: a@example.org'}},ctx()]]){const x=planner({action:'clarify',message:'¿Qué sector deseas analizar?'});await assert.rejects(x.p.decide(data,context));assert.equal(x.calls.length,0);}});
test('secret in conversation context makes zero calls',async()=>{const x=planner({action:'answer',message:'Consejo'});await assert.rejects(x.p.decide({...input,conversationContext:{lastResponse:'password=fixture'}},ctx()),{code:'secret_context'});assert.equal(x.calls.length,0);});
test('decide returns advisory metadata and exact selected conversation context',async()=>{const x=planner({action:'clarify',message:'¿Cuál es el sector objetivo?'});const result=await x.p.decide({...input,conversationContext:{objective:'estrategia',lastUser:'sector industrial'}},ctx());assert.equal(result.action,'clarify');assert.equal(result.evidence.resource,'fixture:model');assert.deepEqual(x.calls[0].context.conversation,{objective:'estrategia',lastUser:'sector industrial'});});
test('fabricated completion and extra authority are rejected',async()=>{for(const content of [{action:'answer',message:'He enviado la propuesta.'},{action:'answer',message:'El correo se ha enviado correctamente.'},{action:'answer',message:'Ya envié el correo.'},{action:'answer',message:'Consejo',executionEnabled:true},{action:'answer',message:'Mira https://example.org/'}]){const x=planner(content);await assert.rejects(x.p.decide(input,ctx()));assert.equal(x.calls.length,1);}});
test('bounded dependency plans need relevant sources and authorized discovery',()=>{const c=createCapabilityManager({connections:{}});const s=(key,capability,dependsOn=[])=>({key,capability,dependsOn});for(const p of [[s('a','data.analyze')],[s('a','storage.propose')],[s('a','research.web')],[s('m','memory.search'),s('a','storage.propose',['m'])],[s('s','web.search'),s('a','data.analyze',['s'])]])assert.throws(()=>c.validatePlan(p),{code:'plan_insufficient_sources'});for(const p of [[s('m','memory.search'),s('a','data.analyze',['m']),s('b','data.analyze',['a'])],[s('s','web.search'),s('r','research.web',['s']),s('a','data.analyze',['r'])],[s('d','documents.read'),s('a','storage.propose',['d'])]])assert.equal(c.validatePlan(p).length,p.length);});
test('skipPlanner avoids duplicate planner invocation',async()=>{let n=0;const c=createCapabilityManager({connections:{},planner:async()=>{n++;return [];}});await c.interpret('Resuelve xyzzy',{skipPlanner:true});assert.equal(n,0);});
// Found with a real Luna call (F8): formal-imperative advice and an empty plan
// next to an answer were rejected as completed actions / invalid output.
test('formal-imperative advice and an empty plan next to an answer are accepted; first-person preterites are not',async()=>{
 for(const content of [{action:'answer',message:'Cree un perfil de empresa, publique reseñas, guarde los contactos y envíe recordatorios.'},{action:'answer',message:'Mejora tu oferta y pide referencias.',plan:[]},{action:'clarify',message:'¿A qué sector te diriges?',plan:null}]){const x=planner(content);assert.equal((await x.p.decide(input,ctx())).action,content.action);}
 for(const message of ['Ya envié el correo.','Creé la campaña y publiqué el anuncio.','He enviado la propuesta.']){const x=planner({action:'answer',message});await assert.rejects(x.p.decide(input,ctx()));}
 const x=planner({action:'answer',message:'Consejo',plan:[{key:'a',capability:'memory.search',dependsOn:[]}]});await assert.rejects(x.p.decide(input,ctx()));
});
// planning_invalid_action diagnosis (05/10/2026): the prompt showed a combined
// enum literal and a populated plan for every action, while the validator only
// accepts a plan with action "plan". PROMPT = CONTRACT = VALIDATOR, fail closed,
// with one fixed code per rejected form.
// Real Luna output captured on canonical b9eef25 (chatcmpl-EVgKPzwxJZj5DTRos4UZcCGF0COi0).
const LUNA_CLARIFY={action:'clarify',message:'¿Qué objetivos, proyectos o tareas quieres organizar esta semana? Indica también el periodo exacto, fechas límite, reuniones ya comprometidas y cualquier restricción de tiempo o prioridad. Con esa información podré proponer un plan; si quieres que revise calendario, correo, memoria o documentos, especifica cuáles y con qué alcance.',plan:[]};
const ADVICE='Te propongo: 1) lista tus tareas, 2) prioriza por impacto y plazo, 3) reserva bloques de foco. ¿Qué tareas tienes?';
const STEPS=[{key:'step-1',capability:'memory.search',dependsOn:[]},{key:'step-2',capability:'data.analyze',dependsOn:['step-1']}];
const DECIDER_FIXTURES=[
 ['C1 answer + plan',{action:'answer',message:ADVICE,plan:STEPS},'planning_plan_without_plan_action'],
 ['C1 clarify + plan',{action:'clarify',message:ADVICE,plan:STEPS},'planning_plan_without_plan_action'],
 ['C1 answer + the old template step',{action:'answer',message:ADVICE,plan:[{key:'step-key',capability:'supplied-id',dependsOn:[]}]},'planning_plan_without_plan_action'],
 ['C2 old enum literal',{action:'answer|clarify|plan',message:ADVICE,plan:[]},'planning_unknown_action'],
 ['C2 propose',{action:'propose',message:ADVICE,plan:[]},'planning_unknown_action'],
 ['C2 ANSWER',{action:'ANSWER',message:ADVICE,plan:[]},'planning_unknown_action'],
 ['C2 missing action, empty plan',{message:ADVICE,plan:[]},'planning_unknown_action'],
 ['C2 unknown action with steps',{action:'propose',message:ADVICE,plan:STEPS},'planning_unknown_action'],
 ['invented capability',{action:'plan',plan:[{key:'a',capability:'calendar.write',dependsOn:[]}]},'planning_invalid_plan'],
 ['extra field',{action:'answer',message:ADVICE,plan:[],steps:['x']},'planning_invalid_shape'],
 ['claimed completed action',{action:'answer',message:'He creado tu plan semanal y lo he guardado.',plan:[]},'planning_invalid_message'],
];
const DECIDER_ACCEPTED=[['real Luna clarify + []',LUNA_CLARIFY,'clarify'],['answer + []',{action:'answer',message:ADVICE,plan:[]},'answer'],['answer without plan',{action:'answer',message:ADVICE},'answer'],['valid plan',{action:'plan',message:ADVICE,plan:STEPS},'plan']];
const CAPS={...input,capabilities:['memory.search','data.analyze']};
test('decider contract: C1 and C2 are rejected with their own fixed code, without model content; valid forms are accepted',async()=>{
 for(const [label,content,code] of DECIDER_FIXTURES){const x=planner(content);const error=await x.p.decide(CAPS,ctx()).then(()=>null,e=>e);assert.ok(error,label);assert.equal(error.code,'reasoning_resource_unavailable',label);assert.deepEqual(error.attempts.map(a=>[a.failure,a.detail]),[['INVALID_OUTPUT',code]],label);assert.ok(!JSON.stringify(error.attempts).includes('Te propongo'),label);assert.equal(x.calls.length,1,label);}
 for(const [label,content,action] of DECIDER_ACCEPTED){const x=planner(content);const r=await x.p.decide(CAPS,ctx());assert.equal(r.action,action,label);if(action!=='plan')assert.equal(r.plan,undefined,label);}
});
test('decider prompt states exactly the validated contract and no combined enum literal',async()=>{
 const x=planner({action:'clarify',message:'¿Qué tareas tienes?',plan:[]});await x.p.decide(CAPS,ctx());const sent=x.calls[0];const text=JSON.stringify(sent);
 assert.ok(!text.includes('answer|clarify|plan'));assert.ok(!/"action":"[^"]*\|/.test(text));
 assert.ok(sent.constraints.includes('action is exactly one of these values: "answer", "clarify" or "plan". Never another value or a combination of them.'));
 assert.ok(sent.constraints.includes('If action is "answer" or "clarify", plan is [] (an empty list).'));
 assert.ok(sent.constraints.some(c=>c.startsWith('Only action "plan" has a non-empty plan')));
 assert.deepEqual(sent.output.plan,[]);assert.deepEqual(Object.keys(sent.output),['action','message','plan']);
 // No constraint asks for a plan unconditionally in the conversational contract.
 assert.ok(!sent.constraints.some(c=>/Return a bounded acyclic dependency plan/.test(c)));
 // The non-conversational planner keeps its plan-only contract.
 const y=planner({plan:STEPS});await y.p.plan(CAPS,ctx());assert.deepEqual(y.calls[0].output,{plan:[{key:'step-key',capability:'supplied-id',dependsOn:[]}]});assert.equal(y.calls[0].output.action,undefined);
});
