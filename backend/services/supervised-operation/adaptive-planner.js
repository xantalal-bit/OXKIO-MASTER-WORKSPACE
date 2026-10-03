'use strict';
const { containsSecretMarker, evaluateProviderRouting } = require('../executive-brain/privacy-gate');
const { fail, freeze } = require('./scope-session');
// Optional natural-language reasoning uses the existing provider and CostController.
// No credentials, new provider or paid call is created here. The operator must
// explicitly supply a positive approved budget; default is a closed human gate.
function createAdaptivePlanner({provider,costController,privacyPolicy,approvedBudgetUsd=0,maxAttempts=2}={}){
 const ledger=new Map();
 async function plan(input,{scope}={}){
  if(!scope||!provider||provider.status!=='ready'||!costController)fail('planning_connection_required');
  if(containsSecretMarker(input.intention))fail('secret_context');
  if(!evaluateProviderRouting({privacyClass:'CONFIDENTIAL',provider:{external:true,providerId:provider.provider,region:provider.region},policy:privacyPolicy}).allowed)fail('planning_privacy_gate');
  const owner=JSON.stringify([scope.tenantId,scope.clientId,scope.userId]);const day=new Date().toISOString().slice(0,10);const key=JSON.stringify([owner,day]);
  const usage=ledger.get(key)||{reserved:0,estimated:0,actual:null,knownActual:0,calls:0,tokens:0};ledger.set(key,usage);
  const basis={modelId:provider.modelId,inputTokens:Math.ceil(input.intention.length/3)+500,outputTokens:900};
  const estimate=costController.estimateCost(basis);
  if(!Number.isFinite(estimate.estimatedCostUsd)||approvedBudgetUsd<=0)fail('planning_budget_gate');
  for(let attempt=0;attempt<maxAttempts;attempt++){
   if(usage.estimated+usage.reserved+estimate.estimatedCostUsd>approvedBudgetUsd)fail('planning_budget_gate');
   const routed=costController.decide({mission:{deterministicAvailable:false,smallModelSufficient:true,smallModelEstimatedCostUsd:estimate.estimatedCostUsd,missionSpentUsd:usage.estimated+usage.reserved,dailySpentUsd:usage.estimated+usage.reserved,requiresPlanning:true,requiresIndependentVerification:true},costBasis:basis});
   if(!routed.decision?.level)fail('planning_budget_gate');
   usage.reserved+=estimate.estimatedCostUsd;usage.calls++;
   let result;
   try{result=await provider.reason({mission:input.intention,context:{capabilities:input.capabilities},constraints:['Select only supplied capabilities. Never invent tools, authority, sources or success. No external actions. Return a bounded acyclic dependency plan.'],output:{plan:[{key:'step-key',capability:'supplied-id',dependsOn:[]}]}});}finally{usage.reserved-=estimate.estimatedCostUsd;usage.estimated+=estimate.estimatedCostUsd;}
   if(result?.status!=='ok')continue;
   const tokens=result.usage||{};if(Number.isFinite(tokens.inputTokens)&&Number.isFinite(tokens.outputTokens)){const priced=costController.estimateCost({modelId:provider.modelId,...tokens});if(Number.isFinite(priced.estimatedCostUsd)){usage.knownActual+=priced.estimatedCostUsd;usage.actual=usage.knownActual;usage.estimated=Math.max(usage.estimated,usage.actual);usage.tokens+=tokens.inputTokens+tokens.outputTokens;}}
   const plan=result.content?.plan;
   if(Array.isArray(plan)&&plan.length>0&&plan.length<=12&&plan.every(s=>input.capabilities.includes(s.capability)))return plan;
  }
  fail('planning_exhausted');
 }
 return Object.freeze({plan,usage:scope=>freeze(structuredClone([...ledger].filter(([k])=>JSON.parse(k)[0]===JSON.stringify([scope.tenantId,scope.clientId,scope.userId])).map(([,v])=>v)))});
}
module.exports={createAdaptivePlanner};
