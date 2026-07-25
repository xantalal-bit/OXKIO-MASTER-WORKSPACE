class SystemStateManager {
    constructor() {
        this.state = {
            status: "running",
            startedAt: new Date().toISOString(),
            safeMode: true,
            integrations: {},
            workflows: {},
            alerts: [],
            lastUpdatedAt: new Date().toISOString()
        };
    }

    updateIntegration(name, status, details = {}) {
        this.state.integrations[name] = {
            status,
            details,
            updatedAt: new Date().toISOString()
        };

        this.touch();

        return this.state.integrations[name];
    }

    updateWorkflow(name, status, details = {}) {
        this.state.workflows[name] = {
            status,
            details,
            updatedAt: new Date().toISOString()
        };

        this.touch();

        return this.state.workflows[name];
    }

    addAlert(type, message, details = {}) {
        const alert = {
            id: Date.now(),
            type,
            message,
            details,
            createdAt: new Date().toISOString()
        };

        this.state.alerts.push(alert);
        this.touch();

        return alert;
    }

    getState() {
        return this.state;
    }

    getPublicView() {
        const summarize = (collection) => Object.freeze(
            Object.entries(collection || {}).map(([name, value]) => Object.freeze({
                name: String(name).slice(0, 80),
                status: value && typeof value.status === "string"
                    ? value.status.slice(0, 40)
                    : "unknown"
            }))
        );
        const alertsSummary = Object.freeze(
            this.state.alerts.slice(-5).map((alert) => Object.freeze({
                type: typeof alert.type === "string" ? alert.type.slice(0, 40) : "unknown",
                message: typeof alert.message === "string" ? alert.message.slice(0, 180) : ""
            }))
        );

        return Object.freeze({
            state: typeof this.state.status === "string" ? this.state.status : "unknown",
            integrationsSummary: summarize(this.state.integrations),
            workflowsSummary: summarize(this.state.workflows),
            alertsSummary
        });
    }

    touch() {
        this.state.lastUpdatedAt = new Date().toISOString();
    }
}

module.exports = SystemStateManager;
