class ActionExecutor {

    execute(approvalItem, integrations = {}) {

        if (!approvalItem || approvalItem.status !== "approved") {
            return {
                ok: false,
                error: "La acción no está aprobada"
            };
        }

        const proposal = approvalItem.proposal;

        if (!proposal) {
            return {
                ok: false,
                error: "No hay propuesta para ejecutar"
            };
        }

        if (proposal.type === "email_draft") {
           return this.executeEmailDraft(
    proposal,
    approvalItem,
    integrations.gmailConnector
);
        }

        if (proposal.type === "meeting_proposal") {
            return this.executeMeetingProposal(proposal, approvalItem, integrations.gmailConnector);
        }

        if (proposal.type === "task_proposal") {
            return this.executeTaskProposal(proposal, approvalItem);
        }

        return {
            ok: true,
            executed: false,
            type: proposal.type,
            message: "Tipo de propuesta registrado, ejecución real pendiente"
        };
    }

  executeEmailDraft(proposal, approvalItem, gmailConnector) {

    const gmailResult = gmailConnector
        ? gmailConnector.createDraft({
            subject: proposal.subject,
            body: proposal.body
          })
        : null;

    return {
        ok: true,
        executed: true,
        type: "email_draft",
        action: "draft_prepared",
        message: "Borrador de email aprobado y preparado para envío futuro.",
        draft: {
            subject: proposal.subject,
            body: proposal.body
        },
        gmailResult,
        approvalId: approvalItem.id
    };
}

    executeTaskProposal(proposal, approvalItem) {
        return {
            ok: true,
            executed: true,
            type: "task_proposal",
            action: "task_prepared",
            message: "Propuesta de tarea aprobada y preparada para creación futura.",
            task: {
                title: proposal.title,
                priority: proposal.priority
            },
            approvalId: approvalItem.id
        };
    }
}

module.exports = ActionExecutor;