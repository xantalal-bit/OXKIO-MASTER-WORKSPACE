const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { createLocalApprovalRepository } = require("../repositories/local-repository-factory");
const { assertRepository } = require("../repositories/repository-contracts");

const DATA_FILE = path.join(__dirname, "approvalQueue.json");
const PREPARATION_TTL_MS = 2 * 60 * 60 * 1000;
const APPROVAL_TTL_MS = 30 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREPARATION_LIMITS = Object.freeze({ recipient: 320, subject: 200, body: 5000 });
const ALLOWED_STATUSES = new Set([
    "pending",
    "approved",
    "rejected",
    "executing",
    "executed",
    "execution_failed"
]);
const EXECUTION_ACTION_TYPES = Object.freeze({
    email_draft: "propose_email",
    meeting_proposal: "propose_meeting",
    task_proposal: "create_task_proposal"
});

function normalizeExecutionPayload(payload) {
    if (!payload || typeof payload !== "object") return null;

    return {
        to: typeof payload.to === "string" && payload.to.trim() ? payload.to.trim() : null,
        subject: typeof payload.subject === "string" ? payload.subject : "",
        body: typeof payload.body === "string" ? payload.body : "",
        replyMessageId: typeof payload.replyMessageId === "string" && payload.replyMessageId.trim()
            ? payload.replyMessageId.trim()
            : null,
        threadId: typeof payload.threadId === "string" && payload.threadId.trim()
            ? payload.threadId.trim()
            : null
    };
}

function calculatePayloadHash(payload) {
    const normalizedPayload = normalizeExecutionPayload(payload);
    if (!normalizedPayload) return null;

    return createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");
}

function normalizePublicProposal(proposal) {
    if (!proposal || typeof proposal !== "object") return proposal;
    if (proposal.actionType === "prepare-email-draft") {
        return {
            preparationId: typeof proposal.preparationId === "string" ? proposal.preparationId : null,
            actionType: "prepare-email-draft",
            type: "email_draft",
            status: proposal.status === "prepared" ? "prepared" : "not_ready",
            recipient: typeof proposal.recipient === "string" ? proposal.recipient : "",
            subject: typeof proposal.subject === "string" ? proposal.subject : "",
            body: typeof proposal.body === "string" ? proposal.body : "",
            summary: typeof proposal.summary === "string" ? proposal.summary : "",
            risk: proposal.risk === "medium" ? "medium" : "low",
            requiresApproval: proposal.requiresApproval === true,
            executionEnabled: false
        };
    }

    const {
        executionPayload,
        payloadHash,
        to,
        subject,
        body,
        replyMessageId,
        threadId,
        ...publicProposal
    } = proposal;
    return publicProposal;
}

function normalizeStoredItem(item) {
    if (!item || typeof item !== "object") return item;

    const publicProposal = normalizePublicProposal(item.publicProposal || item.proposal);
    const interactionId = item.interactionId
        || (item.context && typeof item.context.interactionId === "string"
            ? item.context.interactionId
            : null);

    return {
        ...item,
        interactionId,
        publicProposal,
        executionPayload: normalizeExecutionPayload(item.executionPayload),
        payloadHash: typeof item.payloadHash === "string"
            ? item.payloadHash
            : calculatePayloadHash(item.executionPayload)
    };
}

function normalizeSafeResult(result) {
    if (!result || typeof result !== "object") return null;

    return {
        type: typeof result.type === "string" ? result.type : null,
        mode: typeof result.mode === "string" ? result.mode : null,
        externalId: typeof result.externalId === "string" ? result.externalId : null,
        secondaryExternalId: typeof result.secondaryExternalId === "string"
            ? result.secondaryExternalId
            : null
    };
}

function normalizeSafeError(error) {
    if (!error || typeof error !== "object") return null;

    return {
        code: typeof error.code === "string" && error.code.trim()
            ? error.code.trim()
            : "execution_failed",
        retryable: error.retryable === true
    };
}

function toPublicItem(item) {
    const normalizedItem = normalizeStoredItem(item);
    if (!normalizedItem || typeof normalizedItem !== "object") return normalizedItem;
    let publicProposal = normalizedItem.publicProposal;
    if (
        publicProposal && publicProposal.actionType === "prepare-email-draft"
        && (
            ["rejected", "expired", "executed"].includes(normalizedItem.status)
            || (
                normalizedItem.status === "execution_failed"
                && !(normalizedItem.error && normalizedItem.error.retryable === true)
            )
        )
    ) {
        const { recipient, subject, body, ...terminalProposal } = publicProposal;
        publicProposal = terminalProposal;
    }

    const publicItem = {
        id: normalizedItem.id,
        interactionId: normalizedItem.interactionId,
        status: normalizedItem.status,
        publicProposal,
        proposal: publicProposal,
        createdAt: normalizedItem.createdAt
    };

    [
        "resolvedAt",
        "approvedAt",
        "rejectedAt",
        "executionId",
        "executionStartedAt",
        "executionCompletedAt",
        "executionFailedAt",
        "expiresAt",
        "approvalExpiresAt"
    ].forEach((field) => {
        if (typeof normalizedItem[field] === "string") {
            publicItem[field] = normalizedItem[field];
        }
    });

    if (normalizedItem.result) publicItem.result = normalizeSafeResult(normalizedItem.result);
    if (normalizedItem.error) publicItem.error = normalizeSafeError(normalizedItem.error);

    return publicItem;
}

function transitionError(code, error) {
    return { ok: false, code, error };
}

function attachInternalCompatibility(publicItem, storedItem) {
    Object.defineProperties(publicItem, {
        context: {
            enumerable: false,
            configurable: false,
            get() {
                return storedItem.context;
            }
        },
        execution: {
            enumerable: false,
            configurable: false,
            get() {
                return storedItem.execution;
            },
            set(value) {
                storedItem.execution = value;
            }
        }
    });

    return publicItem;
}

class ApprovalQueue {

   constructor(options = {}) {

    this.pending = [];
    this.history = [];
    this.sequence = 0;
    this.dataFile = options.dataFile || DATA_FILE;
    this.repository = assertRepository(
        options.repository || createLocalApprovalRepository(this.dataFile),
        "ApprovalRepository"
    );

    this.load();
}

    add(proposal, context = {}, executionPayload = null) {

        const publicProposal = normalizePublicProposal(proposal);
        const normalizedPayload = normalizeExecutionPayload(executionPayload);
        const interactionId = context && typeof context.interactionId === "string"
            ? context.interactionId
            : null;

        const item = {
            id: `${Date.now()}-${++this.sequence}`,
            status: "pending",
            interactionId,
            publicProposal,
            executionPayload: normalizedPayload,
            payloadHash: calculatePayloadHash(normalizedPayload),
            createdAt: new Date().toISOString(),
            context
        };

        this.pending.push(item);
        this.save();

        return toPublicItem(item);
    }

    addPreparedEmailDraft(preparation = {}, context = {}) {
        const recipient = typeof preparation.recipient === "string"
            ? preparation.recipient.trim() : "";
        const subject = typeof preparation.subject === "string"
            ? preparation.subject.trim() : "";
        const body = typeof preparation.body === "string"
            ? preparation.body.trim() : "";
        if (
            !EMAIL_PATTERN.test(recipient)
            || !subject || subject.length > PREPARATION_LIMITS.subject
            || !body || body.length > PREPARATION_LIMITS.body
            || recipient.length > PREPARATION_LIMITS.recipient
            || /[\r\n]/.test(recipient) || /[\r\n]/.test(subject)
            || /<\s*script|javascript:|<[^>]+>/i.test(body)
        ) {
            return transitionError("preparation_not_ready", "La preparación no está completa");
        }

        const preparationId = randomUUID();
        const risk = preparation.risk === "medium" ? "medium" : "low";
        const item = this.add({
            preparationId,
            actionType: "prepare-email-draft",
            type: "email_draft",
            status: "prepared",
            recipient,
            subject,
            body,
            summary: "Borrador preparado para aprobación humana.",
            risk,
            requiresApproval: true,
            executionEnabled: false
        }, {
            ...context,
            preparationId,
            actionType: "prepare-email-draft",
            risk
        }, {
            to: recipient,
            subject,
            body,
            replyMessageId: preparation.replyMessageId || null,
            threadId: preparation.threadId || null
        });
        const stored = this.findStoredItem(item.id);
        stored.expiresAt = new Date(Date.now() + PREPARATION_TTL_MS).toISOString();
        this.save();
        return toPublicItem(stored);
    }

    listPending() {
        this.expirePendingPreparations();
        return this.pending.map(toPublicItem);
    }

    listPendingInternal() {
        this.expirePendingPreparations();
        return this.pending.map(normalizeStoredItem);
    }

    approve(id, authorizedIdentity = null) {

        const index = this.pending.findIndex(item => item.id === id);

        if (index === -1) {
            if (this.findStoredItem(id)) {
                return transitionError("invalid_transition", "La propuesta no está pendiente");
            }

            return {
                ok: false,
                code: "approval_not_found",
                error: "Propuesta no encontrada"
            };
        }

        const item = this.pending.splice(index, 1)[0];

        if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) {
            item.status = "expired";
            item.resolvedAt = new Date().toISOString();
            this.history.push(item);
            this.save();
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        item.status = "approved";
        item.approvedAt = new Date().toISOString();
        item.approvalExpiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
        item.resolvedAt = item.approvedAt;
        item.approvedBy = authorizedIdentity && typeof authorizedIdentity === "object"
            ? {
                clientId: authorizedIdentity.clientId || null,
                userId: authorizedIdentity.userId || null
            }
            : null;

        this.history.push(item);
        this.save();
        return {
            ok: true,
            action: "approved",
            item: attachInternalCompatibility(toPublicItem(item), item)
        };
    }

    reject(id) {

        const index = this.pending.findIndex(item => item.id === id);

        if (index === -1) {
            if (this.findStoredItem(id)) {
                return transitionError("invalid_transition", "La propuesta no está pendiente");
            }

            return {
                ok: false,
                code: "approval_not_found",
                error: "Propuesta no encontrada"
            };
        }

        const item = this.pending.splice(index, 1)[0];

        item.status = "rejected";
        item.rejectedAt = new Date().toISOString();
        item.resolvedAt = item.rejectedAt;

        this.history.push(item);
        this.save();

        return {
            ok: true,
            action: "rejected",
            item: toPublicItem(item)
        };
    }

    getHistory() {
        this.expirePendingPreparations();
        return this.history.map(toPublicItem);
    }

    getHistoryInternal() {
        return this.history.map(normalizeStoredItem);
    }

    getInternalById(id) {
        const item = this.pending.find(candidate => candidate.id === id)
            || this.history.find(candidate => candidate.id === id);

        return item ? normalizeStoredItem(item) : null;
    }

    beginExecution(id) {
        const item = this.findStoredItem(id);

        if (!item) {
            return transitionError("approval_not_found", "Propuesta no encontrada");
        }

        if (!ALLOWED_STATUSES.has(item.status) || item.status !== "approved") {
            return transitionError("invalid_transition", "La aprobación no está lista para ejecutar");
        }
        if (this.expireApprovedItem(item)) {
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        const integrity = this.verifyExecutionPayload(item);
        if (!integrity.ok) return integrity;

        const publicProposal = normalizePublicProposal(item.publicProposal || item.proposal);
        const actionType = publicProposal && typeof publicProposal.type === "string"
            ? EXECUTION_ACTION_TYPES[publicProposal.type]
            : null;

        if (!actionType) {
            return {
                ok: false,
                code: "execution_action_type_unavailable",
                message: "Execution action type is unavailable."
            };
        }

        item.executionPayload = integrity.executionPayload;
        item.status = "executing";
        item.executionId = randomUUID();
        item.executionAttemptCount = 1;
        item.executionStartedAt = new Date().toISOString();
        delete item.executionCompletedAt;
        delete item.executionFailedAt;
        delete item.result;
        delete item.error;
        this.save();

        return this.buildInternalExecutionResult(item, actionType);
    }

    validateForExecution(id) {
        const item = this.findStoredItem(id);

        if (!item) {
            return transitionError("approval_not_found", "Propuesta no encontrada");
        }

        if (!ALLOWED_STATUSES.has(item.status) || item.status !== "approved") {
            return transitionError("invalid_transition", "La aprobación no está lista para ejecutar");
        }
        if (this.expireApprovedItem(item)) {
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        const integrity = this.verifyExecutionPayload(item);
        if (!integrity.ok) return integrity;
        const publicProposal = normalizePublicProposal(item.publicProposal || item.proposal);
        const actionType = publicProposal && typeof publicProposal.type === "string"
            ? EXECUTION_ACTION_TYPES[publicProposal.type]
            : null;
        if (actionType !== "propose_email") {
            return transitionError("execution_action_type_unavailable", "Execution action type is unavailable");
        }

        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            actionType,
            status: item.status
        };
    }

    completeExecution(id, safeResultMetadata = {}) {
        const item = this.findStoredItem(id);
        const validation = this.validateActiveExecution(item, safeResultMetadata.executionId);
        if (!validation.ok) return validation;

        item.status = "executed";
        item.executionCompletedAt = new Date().toISOString();
        item.result = normalizeSafeResult(safeResultMetadata.result);
        this.save();

        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            status: item.status,
            executionCompletedAt: item.executionCompletedAt,
            result: item.result
        };
    }

    failExecution(id, safeErrorMetadata = {}) {
        const item = this.findStoredItem(id);
        const validation = this.validateActiveExecution(item, safeErrorMetadata.executionId);
        if (!validation.ok) return validation;

        item.status = "execution_failed";
        item.executionFailedAt = new Date().toISOString();
        item.error = normalizeSafeError(safeErrorMetadata.error);
        this.save();

        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            status: item.status,
            executionFailedAt: item.executionFailedAt,
            error: item.error
        };
    }

    retryExecution(id) {
        const item = this.findStoredItem(id);

        if (!item) {
            return transitionError("approval_not_found", "Propuesta no encontrada");
        }

        if (!ALLOWED_STATUSES.has(item.status) || item.status !== "execution_failed") {
            return transitionError("invalid_transition", "La ejecución no está disponible para reintento");
        }

        if (!item.error || item.error.retryable !== true) {
            return transitionError("execution_not_retryable", "La ejecución fallida no admite reintento");
        }
        if (Number(item.executionAttemptCount || 1) >= 2) {
            return transitionError("execution_retry_exhausted", "La ejecución ya utilizó su único reintento");
        }
        if (this.expireApprovedItem(item)) {
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        const integrity = this.verifyExecutionPayload(item);
        if (!integrity.ok) return integrity;

        item.executionPayload = integrity.executionPayload;
        item.status = "executing";
        item.executionId = randomUUID();
        item.executionAttemptCount = Number(item.executionAttemptCount || 1) + 1;
        item.executionStartedAt = new Date().toISOString();
        delete item.executionCompletedAt;
        delete item.executionFailedAt;
        delete item.result;
        delete item.error;
        this.save();

        return this.buildInternalExecutionResult(item);
    }

    expirePendingPreparations() {
        const now = Date.now();
        const active = [];
        let changed = false;
        this.pending.forEach((item) => {
            const proposal = normalizePublicProposal(item.publicProposal || item.proposal);
            if (
                proposal
                && proposal.actionType === "prepare-email-draft"
                && item.expiresAt
                && Date.parse(item.expiresAt) <= now
            ) {
                item.status = "expired";
                item.resolvedAt = new Date(now).toISOString();
                this.history.push(item);
                changed = true;
            } else {
                active.push(item);
            }
        });
        if (changed) {
            this.pending = active;
            this.save();
        }
    }

    expireApprovedItem(item) {
        if (!item || !item.approvalExpiresAt || Date.parse(item.approvalExpiresAt) > Date.now()) {
            return false;
        }
        item.status = "expired";
        item.resolvedAt = new Date().toISOString();
        this.save();
        return true;
    }

    verifyExecutionPayload(item) {
        const executionPayload = normalizeExecutionPayload(item && item.executionPayload);

        if (!executionPayload || typeof item.payloadHash !== "string") {
            return transitionError("execution_payload_unavailable", "execution payload unavailable");
        }

        if (calculatePayloadHash(executionPayload) !== item.payloadHash) {
            return transitionError("execution_payload_integrity_failed", "execution payload integrity check failed");
        }

        return { ok: true, executionPayload };
    }

    findStoredItem(id) {
        return this.pending.find(candidate => candidate.id === id)
            || this.history.find(candidate => candidate.id === id)
            || null;
    }

    validateActiveExecution(item, executionId) {
        if (!item) {
            return transitionError("approval_not_found", "Propuesta no encontrada");
        }

        if (!ALLOWED_STATUSES.has(item.status) || item.status !== "executing") {
            return transitionError("invalid_transition", "La aprobación no tiene una ejecución activa");
        }

        if (typeof executionId !== "string" || executionId !== item.executionId) {
            return transitionError("execution_id_mismatch", "El identificador de ejecución no coincide");
        }

        return { ok: true };
    }

    buildInternalExecutionResult(item, actionType) {
        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            ...(actionType ? { actionType } : {}),
            executionPayload: normalizeExecutionPayload(item.executionPayload),
            payloadHash: item.payloadHash,
            status: "executing",
            executionStartedAt: item.executionStartedAt
        };
    }
save() {
    this.repository.saveSnapshot({
        pending: this.pending,
        history: this.history
    });
}

load() {
    const data = this.repository.loadSnapshot();
    this.pending = Array.isArray(data.pending) ? data.pending : [];
    this.history = Array.isArray(data.history) ? data.history : [];
}
    getStatus() {
        return {
            pending: this.pending.length,
            history: this.history.length
        };
    }
}

module.exports = ApprovalQueue;
module.exports.calculatePayloadHash = calculatePayloadHash;
module.exports.normalizeExecutionPayload = normalizeExecutionPayload;
module.exports.PREPARATION_TTL_MS = PREPARATION_TTL_MS;
module.exports.APPROVAL_TTL_MS = APPROVAL_TTL_MS;
