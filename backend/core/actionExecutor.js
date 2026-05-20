const systemConfig = require("../config/systemConfig");
const { getGmailClient } = require("../integrations/googleOAuth");

class ActionExecutor {

    execute(approvalItem, integrations = {}) {

        if (!approvalItem || approvalItem.status !== "approved") {
            return {
                ok: false,
                error: "La acción no está aprobada"
            };
        }

        const proposal =
            approvalItem.proposal.proposal || approvalItem.proposal;

        if (!proposal) {
            return {
                ok: false,
                error: "No hay propuesta para ejecutar"
            };
        }

        if (proposal.type === "email_draft") {
            return this.executeEmailDraft(
                proposal,
                approvalItem
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

    async executeEmailDraft(proposal, approvalItem) {

        if (systemConfig.gmail.mode !== "SAFE_DRAFT_ONLY") {
            return {
                ok: false,
                error: "Bloqueado por seguridad: Gmail no está en SAFE_DRAFT_ONLY"
            };
        }

        const gmail = getGmailClient();

        const to = proposal.to || "";
        const subject = proposal.subject || "Borrador Oxkio";
        const body = proposal.body || "Borrador generado por Oxkio pendiente de revisión.";

        const rawMessage = [
            `To: ${to}`,
            `Subject: ${subject}`,
            "Content-Type: text/plain; charset=utf-8",
            "",
            body
        ].join("\n");

        const encodedMessage = Buffer
            .from(rawMessage)
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

        const draftResponse = await gmail.users.drafts.create({
            userId: "me",
            requestBody: {
                message: {
                    raw: encodedMessage
                }
            }
        });

        return {
            ok: true,
            executed: true,
            type: "email_draft",
            action: "gmail_real_draft_created",
            mode: "SAFE_DRAFT_ONLY",
            message: "Borrador real creado en Gmail. No se ha enviado.",
            draft: {
                id: draftResponse.data.id,
                messageId: draftResponse.data.message.id,
                to,
                subject
            },
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