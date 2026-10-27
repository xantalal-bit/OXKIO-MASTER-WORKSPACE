'use strict';
const path=require('node:path');const {createHash}=require('node:crypto');const ApprovalQueue=require('../../core/approvalQueue');const {PostgresApprovalRepository}=require('../../repositories/postgres-approval-repository');const {fail,freeze,copy}=require('./scope-session');
// Cloud Run filesystems are ephemeral. With the Approval PostgreSQL pool the
// queue lives in oxkio.approval_items (RLS by client_id): each V3 owner gets an
// opaque client_id derived from its full scope, so owners never share rows and
// V3 approvals never mix with the classic 'cliente-cero' queue.
function createScopedApprovalFactory({root,pool=null}={}){
 if(!pool&&!path.isAbsolute(root||''))fail('approval_root_invalid');const queues=new Map();
 return async scope=>{
  const owner=JSON.stringify([scope.tenantId,scope.clientId,scope.userId]);
  if(!queues.has(owner)){const digest=createHash('sha256').update(owner).digest('hex');
   if(pool){const durable={clientId:'v3-owner-'+digest};queues.set(owner,new ApprovalQueue({repository:new PostgresApprovalRepository({pool,scope:durable}),scope:durable}));}
   else queues.set(owner,new ApprovalQueue({dataFile:path.join(root,digest+'.approvals.json'),scope:{clientId:scope.clientId}}));}
  return Object.freeze({scope:freeze(copy(scope)),queue:queues.get(owner)});
 };
}
module.exports={createScopedApprovalFactory};
