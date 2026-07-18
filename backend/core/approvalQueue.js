const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");

const DATA_FILE = path.join(__dirname, "approvalQueue.json");
const ALLOWED_STATUSES = new Set([
    "pending",
    "approved",
    "rejected",
    "executing",
    "executed",
    "execution_failed"
]);

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

    const publicItem = {
        id: normalizedItem.id,
        interactionId: normalizedItem.interactionId,
        status: normalizedItem.status,
        publicProposal: normalizedItem.publicProposal,
        proposal: normalizedItem.publicProposal,
        createdAt: normalizedItem.createdAt
    };

    [
        "resolvedAt",
        "approvedAt",
        "rejectedAt",
        "executionId",
        "executionStartedAt",
        "executionCompletedAt",
        "executionFailedAt"
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

    listPending() {
        return this.pending.map(toPublicItem);
    }

    listPendingInternal() {
        return this.pending.map(normalizeStoredItem);
    }

    approve(id) {

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

        item.status = "approved";
        item.approvedAt = new Date().toISOString();
        item.resolvedAt = item.approvedAt;

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

        const integrity = this.verifyExecutionPayload(item);
        if (!integrity.ok) return integrity;

        item.executionPayload = integrity.executionPayload;
        item.status = "executing";
        item.executionId = randomUUID();
        item.executionStartedAt = new Date().toISOString();
        delete item.executionCompletedAt;
        delete item.executionFailedAt;
        delete item.result;
        delete item.error;
        this.save();

        return this.buildInternalExecutionResult(item);
    }

    validateForExecution(id) {
        const item = this.findStoredItem(id);

        if (!item) {
            return transitionError("approval_not_found", "Propuesta no encontrada");
        }

        if (!ALLOWED_STATUSES.has(item.status) || item.status !== "approved") {
            return transitionError("invalid_transition", "La aprobación no está lista para ejecutar");
        }

        const integrity = this.verifyExecutionPayload(item);
        if (!integrity.ok) return integrity;

        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
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

        const integrity = this.verifyExecutionPayload(item);
        if (!integrity.ok) return integrity;

        item.executionPayload = integrity.executionPayload;
        item.status = "executing";
        item.executionId = randomUUID();
        item.executionStartedAt = new Date().toISOString();
        delete item.executionCompletedAt;
        delete item.executionFailedAt;
        delete item.result;
        delete item.error;
        this.save();

        return this.buildInternalExecutionResult(item);
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

    buildInternalExecutionResult(item) {
        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            executionPayload: normalizeExecutionPayload(item.executionPayload),
            payloadHash: item.payloadHash,
            status: "executing",
            executionStartedAt: item.executionStartedAt
        };
    }
save() {

    fs.writeFileSync(
        this.dataFile,
        JSON.stringify({
            pending: this.pending,
            history: this.history
        }, null, 2)
    );
}

load() {

    try {

        if (fs.existsSync(this.dataFile)) {

            const raw = fs.readFileSync(this.dataFile);

            const data = JSON.parse(raw);

            this.pending = data.pending || [];
            this.history = data.history || [];
        }

    } catch (error) {

        console.log("[ApprovalQueue] Error loading data", error);
    }
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
