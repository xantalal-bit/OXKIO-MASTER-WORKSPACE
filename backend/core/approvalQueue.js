const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { createLocalApprovalRepositoryV2 } = require("../repositories/local-repository-factory");
const { assertRepository } = require("../repositories/repository-contracts");

// FASE A2: ApprovalQueue ya no trata un snapshot en memoria como fuente de
// verdad. Cada operación relevante lee y escribe contra ApprovalRepositoryV2
// (async, item-level, CAS por version+status). El backend por defecto es
// JsonApprovalRepositoryV2 sobre un fichero NUEVO (`approvalQueue.v2.json`,
// no el `approvalQueue.json` legado de V1) — ese fichero legado se preserva
// intacto y no se lee ni se consume automaticamente aqui.
const DEFAULT_DATA_FILE = path.join(__dirname, "approvalQueue.v2.json");
const DEFAULT_SCOPE = Object.freeze({ clientId: "cliente-cero" });

const PREPARATION_TTL_MS = 2 * 60 * 60 * 1000;
const APPROVAL_TTL_MS = 30 * 60 * 1000;
const EXECUTION_LEASE_TTL_MS = 5 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREPARATION_LIMITS = Object.freeze({ recipient: 320, subject: 200, body: 5000 });

// "expired" se formaliza como estado real desde FASE A2 (V2 lo declara en su
// propio conjunto de estados). Se mantiene aqui unicamente para los mensajes
// de error existentes; no es una lista de control independiente.
const EXECUTION_ACTION_TYPES = Object.freeze({
    email_draft: "propose_email",
    meeting_proposal: "propose_meeting",
    task_proposal: "create_task_proposal",
    // Registrado para retirar el bypass de universal-knowledge-supervisor:
    // antes mutaba el item directamente; ahora usa begin/complete/failExecution
    // como cualquier otro consumidor.
    knowledge_ingestion: "ingest_knowledge_release",
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

// ── Traduccion V2 <-> forma "legada" que ya entendian toPublicItem() y el
// resto de funciones puras de esta clase. `record` guarda el payload de
// negocio inmutable desde la creacion; el resto vive en el envelope V2
// (status/version/timestamps/executionId/lease/result/error).
function toLegacyItem(v2Item) {
    if (!v2Item) return null;
    const record = v2Item.record || {};
    const approvalExpiresAt = v2Item.approvedAt
        ? new Date(Date.parse(v2Item.approvedAt) + APPROVAL_TTL_MS).toISOString()
        : null;

    return {
        id: v2Item.id,
        version: v2Item.version,
        status: v2Item.status,
        interactionId: record.interactionId ?? null,
        publicProposal: record.publicProposal ?? null,
        proposal: record.publicProposal ?? null,
        executionPayload: record.executionPayload ?? null,
        payloadHash: record.payloadHash ?? null,
        context: record.context ?? {},
        createdAt: v2Item.createdAt,
        expiresAt: record.expiresAt ?? null,
        approvedAt: v2Item.approvedAt,
        approvalExpiresAt,
        rejectedAt: v2Item.rejectedAt,
        resolvedAt: v2Item.resolvedAt,
        approvedBy: v2Item.approvedBy,
        executionId: v2Item.executionId,
        executionAttemptCount: v2Item.executionAttemptCount,
        executionStartedAt: v2Item.executionStartedAt,
        executionCompletedAt: v2Item.executionCompletedAt,
        executionFailedAt: v2Item.executionFailedAt,
        result: v2Item.result,
        error: v2Item.error,
    };
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

    // `context` se expone a llamadores internos (mismo proceso) sin
    // serializarse nunca en JSON.stringify — necesario para flujos como
    // universal-knowledge-supervisor, que necesita el candidate completo tras
    // aprobar. Ya NO existe un setter de `execution`: cualquier mutacion debe
    // pasar por begin/complete/failExecution.
    Object.defineProperty(publicItem, "context", {
        enumerable: false,
        configurable: false,
        get() { return normalizedItem.context; },
    });

    return publicItem;
}

function transitionError(code, error) {
    return { ok: false, code, error };
}

// ── Traduce un conflicto de ApprovalRepositoryV2 (not_found / stale_version /
// status_conflict / execution_id_mismatch) al vocabulario de error publico
// que ya exponia la API HTTP (invalid_transition / approval_not_found / ...).
function conflictToLegacyError(result, { notFoundCode = "approval_not_found", notFoundMessage = "Propuesta no encontrada" } = {}) {
    if (result.code === "not_found") {
        return { ok: false, code: notFoundCode, error: notFoundMessage };
    }
    if (result.code === "execution_id_mismatch") {
        return transitionError("execution_id_mismatch", "El identificador de ejecución no coincide");
    }
    // stale_version y status_conflict: otra transicion (u otra instancia) ya
    // resolvio el item entre la lectura fresca y esta mutacion. Se reporta
    // como conflicto de transicion, nunca como exito silencioso.
    return transitionError("invalid_transition", "La operación no pudo completarse: el estado cambió antes de aplicarla");
}

class ApprovalQueue {

    constructor(options = {}) {
        this.dataFile = options.dataFile || DEFAULT_DATA_FILE;
        this.scope = options.scope || DEFAULT_SCOPE;
        this.now = typeof options.now === "function" ? options.now : Date.now;
        this.repository = assertRepository(
            options.repository || createLocalApprovalRepositoryV2(this.dataFile),
            "ApprovalRepositoryV2"
        );
    }

    // Lectura fresca de un item, traducido a forma legada. null si no existe.
    async _getFreshLegacyItem(id) {
        const result = await this.repository.getById(id, this.scope);
        return result.ok ? toLegacyItem(result.item) : null;
    }

    async add(proposal, context = {}, executionPayload = null) {
        const publicProposal = normalizePublicProposal(proposal);
        const normalizedPayload = normalizeExecutionPayload(executionPayload);
        const interactionId = context && typeof context.interactionId === "string"
            ? context.interactionId
            : null;

        const record = {
            interactionId,
            publicProposal,
            executionPayload: normalizedPayload,
            payloadHash: calculatePayloadHash(normalizedPayload),
            context,
            expiresAt: null,
        };

        const created = await this.repository.create(record, this.scope);
        return toPublicItem(toLegacyItem(created.item));
    }

    async addPreparedEmailDraft(preparation = {}, context = {}) {
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
        const publicProposal = normalizePublicProposal({
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
            executionEnabled: false,
        });
        const executionPayload = normalizeExecutionPayload({
            to: recipient,
            subject,
            body,
            replyMessageId: preparation.replyMessageId || null,
            threadId: preparation.threadId || null,
        });
        const mergedContext = { ...context, preparationId, actionType: "prepare-email-draft", risk };

        const record = {
            interactionId: typeof mergedContext.interactionId === "string" ? mergedContext.interactionId : null,
            publicProposal,
            executionPayload,
            payloadHash: calculatePayloadHash(executionPayload),
            context: mergedContext,
            expiresAt: new Date(this.now() + PREPARATION_TTL_MS).toISOString(),
        };

        const created = await this.repository.create(record, this.scope);
        return toPublicItem(toLegacyItem(created.item));
    }

    // Barrido perezoso de expiracion de preparaciones pendientes, equivalente
    // al de V1 pero async e item por item (V2 no mantiene un array cacheado
    // que reescribir de golpe).
    async _expirePendingPreparations() {
        const pending = await this.repository.listPending(this.scope);
        for (const v2Item of pending) {
            const legacy = toLegacyItem(v2Item);
            const proposal = normalizePublicProposal(legacy.publicProposal);
            if (
                proposal
                && proposal.actionType === "prepare-email-draft"
                && legacy.expiresAt
                && Date.parse(legacy.expiresAt) <= this.now()
            ) {
                // Mejor esfuerzo: si otra instancia ya la transicionó, no pasa nada.
                await this.repository.expire(v2Item.id, {
                    expectedVersion: v2Item.version,
                    expectedStatus: "pending",
                });
            }
        }
    }

    async listPending() {
        await this._expirePendingPreparations();
        const pending = await this.repository.listPending(this.scope);
        return pending.map((v2Item) => toPublicItem(toLegacyItem(v2Item)));
    }

    async listPendingInternal() {
        await this._expirePendingPreparations();
        const pending = await this.repository.listPending(this.scope);
        return pending.map((v2Item) => normalizeStoredItem(toLegacyItem(v2Item)));
    }

    async getHistory() {
        await this._expirePendingPreparations();
        const history = await this.repository.listHistory(this.scope);
        return history.map((v2Item) => toPublicItem(toLegacyItem(v2Item)));
    }

    async getHistoryInternal() {
        const history = await this.repository.listHistory(this.scope);
        return history.map((v2Item) => normalizeStoredItem(toLegacyItem(v2Item)));
    }

    async getInternalById(id) {
        const legacy = await this._getFreshLegacyItem(id);
        return legacy ? normalizeStoredItem(legacy) : null;
    }

    async approve(id, authorizedIdentity = null) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) {
            return { ok: false, code: "approval_not_found", error: "Propuesta no encontrada" };
        }
        if (current.status !== "pending") {
            return transitionError("invalid_transition", "La propuesta no está pendiente");
        }
        if (current.expiresAt && Date.parse(current.expiresAt) <= this.now()) {
            await this.repository.expire(id, { expectedVersion: current.version, expectedStatus: "pending" });
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        const approvedBy = authorizedIdentity && typeof authorizedIdentity === "object"
            ? { clientId: authorizedIdentity.clientId || null, userId: authorizedIdentity.userId || null }
            : null;

        const result = await this.repository.approve(id, {
            expectedVersion: current.version,
            expectedStatus: "pending",
            approvedBy,
        });
        if (!result.ok) return conflictToLegacyError(result);

        const item = toLegacyItem(result.item);
        return { ok: true, action: "approved", item: toPublicItem(item) };
    }

    async reject(id) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) {
            return { ok: false, code: "approval_not_found", error: "Propuesta no encontrada" };
        }
        if (current.status !== "pending") {
            return transitionError("invalid_transition", "La propuesta no está pendiente");
        }

        const result = await this.repository.reject(id, {
            expectedVersion: current.version,
            expectedStatus: "pending",
        });
        if (!result.ok) return conflictToLegacyError(result);

        const item = toLegacyItem(result.item);
        return { ok: true, action: "rejected", item: toPublicItem(item) };
    }

    // Devuelve null si la aprobacion sigue vigente; en caso contrario la
    // expira (approved -> expired) y devuelve el item legado ya expirado.
    async _expireApprovedIfNeeded(current) {
        if (current.status !== "approved" || !current.approvedAt) return null;
        const deadline = Date.parse(current.approvedAt) + APPROVAL_TTL_MS;
        if (this.now() < deadline) return null;
        await this.repository.expire(current.id, {
            expectedVersion: current.version,
            expectedStatus: "approved",
        });
        return true;
    }

    _verifyExecutionPayload(current) {
        const executionPayload = normalizeExecutionPayload(current && current.executionPayload);
        if (!executionPayload || typeof current.payloadHash !== "string") {
            return transitionError("execution_payload_unavailable", "execution payload unavailable");
        }
        if (calculatePayloadHash(executionPayload) !== current.payloadHash) {
            return transitionError("execution_payload_integrity_failed", "execution payload integrity check failed");
        }
        return { ok: true, executionPayload };
    }

    _resolveActionType(current) {
        const publicProposal = normalizePublicProposal(current.publicProposal || current.proposal);
        return publicProposal && typeof publicProposal.type === "string"
            ? EXECUTION_ACTION_TYPES[publicProposal.type]
            : null;
    }

    async _claim(id, expectedStatus) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) return transitionError("approval_not_found", "Propuesta no encontrada");
        if (current.status !== expectedStatus) {
            return transitionError("invalid_transition", "La aprobación no está lista para ejecutar");
        }
        if (await this._expireApprovedIfNeeded(current)) {
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        const integrity = this._verifyExecutionPayload(current);
        if (!integrity.ok) return integrity;

        const actionType = this._resolveActionType(current);
        if (!actionType) {
            return {
                ok: false,
                code: "execution_action_type_unavailable",
                message: "Execution action type is unavailable.",
            };
        }

        const executionId = randomUUID();
        const claim = await this.repository.claimExecution(id, {
            expectedVersion: current.version,
            expectedStatus,
            executionId,
            leaseTtlMs: EXECUTION_LEASE_TTL_MS,
        });
        if (!claim.ok) return conflictToLegacyError(claim);

        const item = toLegacyItem(claim.item);
        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            actionType,
            executionPayload: integrity.executionPayload,
            payloadHash: item.payloadHash,
            status: "executing",
            executionStartedAt: item.executionStartedAt,
        };
    }

    async beginExecution(id) {
        return this._claim(id, "approved");
    }

    async validateForExecution(id) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) return transitionError("approval_not_found", "Propuesta no encontrada");
        if (current.status !== "approved") {
            return transitionError("invalid_transition", "La aprobación no está lista para ejecutar");
        }
        if (await this._expireApprovedIfNeeded(current)) {
            return transitionError("approval_expired", "La aprobación ha expirado");
        }

        const integrity = this._verifyExecutionPayload(current);
        if (!integrity.ok) return integrity;
        const actionType = this._resolveActionType(current);
        if (actionType !== "propose_email") {
            return transitionError("execution_action_type_unavailable", "Execution action type is unavailable");
        }

        return {
            ok: true,
            approvalId: current.id,
            interactionId: current.interactionId || null,
            actionType,
            status: current.status,
        };
    }

    async completeExecution(id, safeResultMetadata = {}) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) return transitionError("approval_not_found", "Propuesta no encontrada");
        if (current.status !== "executing") {
            return transitionError("invalid_transition", "La aprobación no tiene una ejecución activa");
        }
        if (current.executionId !== safeResultMetadata.executionId) {
            return transitionError("execution_id_mismatch", "El identificador de ejecución no coincide");
        }

        const result = await this.repository.completeExecution(id, {
            expectedVersion: current.version,
            executionId: safeResultMetadata.executionId,
            result: normalizeSafeResult(safeResultMetadata.result),
        });
        if (!result.ok) return conflictToLegacyError(result);

        const item = toLegacyItem(result.item);
        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            status: item.status,
            executionCompletedAt: item.executionCompletedAt,
            result: item.result,
        };
    }

    async failExecution(id, safeErrorMetadata = {}) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) return transitionError("approval_not_found", "Propuesta no encontrada");
        if (current.status !== "executing") {
            return transitionError("invalid_transition", "La aprobación no tiene una ejecución activa");
        }
        if (current.executionId !== safeErrorMetadata.executionId) {
            return transitionError("execution_id_mismatch", "El identificador de ejecución no coincide");
        }

        const result = await this.repository.failExecution(id, {
            expectedVersion: current.version,
            executionId: safeErrorMetadata.executionId,
            error: normalizeSafeError(safeErrorMetadata.error),
        });
        if (!result.ok) return conflictToLegacyError(result);

        const item = toLegacyItem(result.item);
        return {
            ok: true,
            approvalId: item.id,
            interactionId: item.interactionId || null,
            executionId: item.executionId,
            status: item.status,
            executionFailedAt: item.executionFailedAt,
            error: item.error,
        };
    }

    async retryExecution(id) {
        const current = await this._getFreshLegacyItem(id);
        if (!current) return transitionError("approval_not_found", "Propuesta no encontrada");
        if (current.status !== "execution_failed") {
            return transitionError("invalid_transition", "La ejecución no está disponible para reintento");
        }
        if (!current.error || current.error.retryable !== true) {
            return transitionError("execution_not_retryable", "La ejecución fallida no admite reintento");
        }
        if (Number(current.executionAttemptCount || 1) >= 2) {
            return transitionError("execution_retry_exhausted", "La ejecución ya utilizó su único reintento");
        }

        return this._claim(id, "execution_failed");
    }

    async getStatus() {
        const [pending, history] = await Promise.all([
            this.repository.listPending(this.scope),
            this.repository.listHistory(this.scope),
        ]);
        return { pending: pending.length, history: history.length };
    }
}

module.exports = ApprovalQueue;
module.exports.calculatePayloadHash = calculatePayloadHash;
module.exports.normalizeExecutionPayload = normalizeExecutionPayload;
module.exports.PREPARATION_TTL_MS = PREPARATION_TTL_MS;
module.exports.APPROVAL_TTL_MS = APPROVAL_TTL_MS;
