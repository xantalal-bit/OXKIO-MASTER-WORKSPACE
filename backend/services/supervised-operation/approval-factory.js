'use strict';
const path=require('node:path');const {createHash}=require('node:crypto');const ApprovalQueue=require('../../core/approvalQueue');const {fail,freeze,copy}=require('./scope-session');
function createScopedApprovalFactory({root}){
 if(!path.isAbsolute(root||''))fail('approval_root_invalid');const queues=new Map();
 return async scope=>{
  const owner=JSON.stringify([scope.tenantId,scope.clientId,scope.userId]);
  if(!queues.has(owner)){const file=path.join(root,createHash('sha256').update(owner).digest('hex')+'.approvals.json');queues.set(owner,new ApprovalQueue({dataFile:file,scope:{clientId:scope.clientId}}));}
  return Object.freeze({scope:freeze(copy(scope)),queue:queues.get(owner)});
 };
}
module.exports={createScopedApprovalFactory};
