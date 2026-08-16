'use strict';

const MAX_RECENT = 5;
const STATUS_COUNTERS = Object.freeze({
  pending: 'pending',
  approved: 'approved',
  executing: 'executing',
  executed: 'executed',
  execution_failed: 'failed',
  rejected: 'rejected',
});
const TYPE_LABELS = Object.freeze({
  email_draft: 'Borrador de correo',
  meeting_proposal: 'Propuesta de reunión',
  task_proposal: 'Propuesta de tarea',
});

function emptyResult(available, source) {
  return {
    title: 'Compromisos ejecutivos',
    pending: 0,
    approved: 0,
    executing: 0,
    executed: 0,
    failed: 0,
    rejected: 0,
    recent: [],
    source,
    available,
  };
}

function safeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getProposal(record) {
  if (record && record.publicProposal && typeof record.publicProposal === 'object') {
    return record.publicProposal;
  }
  if (record && record.proposal && typeof record.proposal === 'object') {
    return record.proposal;
  }
  return {};
}

function fallbackSummary(type) {
  return TYPE_LABELS[type] || 'Compromiso ejecutivo';
}

function getUpdatedAt(record) {
  const fields = [
    'executionCompletedAt',
    'executionFailedAt',
    'executionStartedAt',
    'resolvedAt',
    'approvedAt',
    'rejectedAt',
    'createdAt',
  ];
  return fields.map((field) => safeText(record && record[field])).find(Boolean) || null;
}

function normalizeRecent(record) {
  const proposal = getProposal(record);
  const type = safeText(proposal.type) || 'unknown';

  return {
    id: safeText(record && record.id),
    interactionId: safeText(record && record.interactionId),
    type,
    summary: safeText(proposal.summary) || fallbackSummary(type),
    status: STATUS_COUNTERS[record && record.status] || 'unknown',
    createdAt: safeText(record && record.createdAt),
    updatedAt: getUpdatedAt(record),
  };
}

function timestampValue(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function getAutomations(timestamp, approvalQueue) {
  try {
    if (
      !approvalQueue
      || typeof approvalQueue.listPending !== 'function'
      || typeof approvalQueue.getHistory !== 'function'
    ) {
      throw new Error('approval_queue_unavailable');
    }

    const pendingRecords = await approvalQueue.listPending();
    const historyRecords = await approvalQueue.getHistory();
    if (!Array.isArray(pendingRecords) || !Array.isArray(historyRecords)) {
      throw new Error('approval_queue_invalid_response');
    }

    const recordsById = new Map();
    [...pendingRecords, ...historyRecords].forEach((record) => {
      if (!record || typeof record !== 'object') return;
      const key = safeText(record.id) || `legacy-${recordsById.size}`;
      recordsById.set(key, record);
    });

    const result = emptyResult(true, 'approval-queue');
    const records = Array.from(recordsById.values());
    records.forEach((record) => {
      const counter = STATUS_COUNTERS[record.status];
      if (counter) result[counter] += 1;
    });

    result.recent = records
      .map(normalizeRecent)
      .sort((left, right) => (
        timestampValue(right.updatedAt || right.createdAt)
        - timestampValue(left.updatedAt || left.createdAt)
      ))
      .slice(0, MAX_RECENT);

    return result;
  } catch (error) {
    return emptyResult(false, 'unavailable');
  }
}

module.exports = {
  MAX_RECENT,
  getAutomations,
  normalizeRecent,
};
