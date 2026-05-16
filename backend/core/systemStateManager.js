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

    touch() {
        this.state.lastUpdatedAt = new Date().toISOString();
    }
}

module.exports = SystemStateManager;