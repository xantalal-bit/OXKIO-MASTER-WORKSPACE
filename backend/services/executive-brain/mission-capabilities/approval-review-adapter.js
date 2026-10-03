'use strict';

// XATAI CORE V2.1: hands a ready commercial review to the EXISTING Approval
// Queue (backend/core/approvalQueue.js) as a prepared email draft. It reuses
// addPreparedEmailDraft as is — same validation, same TTL, same
// executionEnabled=false — and never approves, sends or executes anything.
//
// The Approval Queue needs a real recipient address. OXKIO never invents
// one: without a recipient given by a human the hand-off is not submitted
// and says exactly what is missing.

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function submitCommercialReview({ approvalQueue, review, recipient = null, missionId, interactionId = null }) {
  if (!approvalQueue || typeof approvalQueue.addPreparedEmailDraft !== 'function') {
    return Object.freeze({ submitted: false, reason: 'approval_queue_not_connected' });
  }
  if (!review || review.status !== 'LISTO PARA REVISIÓN' || !review.draft) {
    return Object.freeze({ submitted: false, reason: 'review_not_ready' });
  }
  if (typeof recipient !== 'string' || !EMAIL_PATTERN.test(recipient)) {
    return Object.freeze({ submitted: false, reason: 'recipient_unknown' });
  }
  const item = await approvalQueue.addPreparedEmailDraft(
    { recipient, subject: review.draft.subject, body: review.draft.body, risk: 'medium' },
    { interactionId, source: 'xatai-mission-engine', missionId },
  );
  if (!item || item.ok === false || item.error) {
    return Object.freeze({ submitted: false, reason: (item && (item.code || item.error)) || 'approval_queue_rejected' });
  }
  return Object.freeze({ submitted: true, approvalId: item.id, status: item.status, executionEnabled: false });
}

module.exports = { submitCommercialReview };
