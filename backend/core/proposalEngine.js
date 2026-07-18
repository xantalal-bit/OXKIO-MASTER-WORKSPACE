class ProposalEngine {

    generate(brainResult) {

        const analysis = brainResult.analysis;
        const decision = brainResult.decision;

        if (analysis.intent === "email") {
            return this.generateEmailProposal(brainResult);
        }

        if (analysis.intent === "meeting") {
            return this.generateMeetingProposal(brainResult);
        }

        if (analysis.intent === "task") {
            return this.generateTaskProposal(brainResult);
        }

        return {
            type: "general",
            summary: "Propuesta informativa generada.",
            proposal: decision.recommendation,
            requiresApproval: decision.requiresApproval
        };
    }

    generateEmailProposal(brainResult) {

        return {
            type: "email_draft",
            summary: "Borrador de email preparado para revisión.",
            requiresApproval: true,
            executionPayload: {
                to: null,
                subject: "Respuesta pendiente",
                body: "Hola,\n\nHe revisado el asunto y propongo avanzar con prioridad.\n\nQuedo atento a confirmación.\n\nUn saludo,",
                replyMessageId: null,
                threadId: null
            }
        };
    }

    generateMeetingProposal(brainResult) {

        return {
            type: "meeting_proposal",
            summary: "Propuesta de reunión preparada.",
            title: "Reunión de seguimiento",
            agenda: [
                "Revisar contexto",
                "Alinear próximos pasos",
                "Definir responsables"
            ],
            requiresApproval: true
        };
    }

    generateTaskProposal(brainResult) {

        return {
            type: "task_proposal",
            summary: "Propuesta de tarea preparada.",
            title: brainResult.message,
            priority: brainResult.analysis.urgency,
            requiresApproval: true
        };
    }
}

module.exports = ProposalEngine;
