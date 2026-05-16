class GmailConnector {

    constructor() {
        this.mode = "SAFE_DRAFT_ONLY";
        this.connected = false;
    }

    connect(config = {}) {

        this.connected = true;

        return {
            ok: true,
            provider: "gmail",
            mode: this.mode,
            connected: this.connected,
            message: "GmailConnector inicializado en modo seguro. No envía emails reales todavía."
        };
    }

    createDraft(draft = {}) {

        if (!this.connected) {
            return {
                ok: false,
                error: "GmailConnector no conectado"
            };
        }

        return {
            ok: true,
            provider: "gmail",
            mode: this.mode,
            action: "draft_created_simulated",
            draft: {
                to: draft.to || "",
                subject: draft.subject || "Sin asunto",
                body: draft.body || ""
            },
            message: "Borrador simulado creado. Envío real pendiente de integración OAuth."
        };
    }

    getStatus() {

        return {
            provider: "gmail",
            mode: this.mode,
            connected: this.connected
        };
    }
}

module.exports = GmailConnector;