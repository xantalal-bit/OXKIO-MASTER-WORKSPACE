class ApprovalQueue {

    constructor() {
        this.pending = [];
        this.history = [];
    }

    add(proposal, context = {}) {

        const item = {
            id: Date.now().toString(),
            status: "pending",
            createdAt: new Date().toISOString(),
            proposal,
            context
        };

        this.pending.push(item);

        return item;
    }

    listPending() {
        return this.pending;
    }

    approve(id) {

        const index = this.pending.findIndex(item => item.id === id);

        if (index === -1) {
            return {
                ok: false,
                error: "Propuesta no encontrada"
            };
        }

        const item = this.pending.splice(index, 1)[0];

        item.status = "approved";
        item.resolvedAt = new Date().toISOString();

        this.history.push(item);

        return {
            ok: true,
            action: "approved",
            item
        };
    }

    reject(id) {

        const index = this.pending.findIndex(item => item.id === id);

        if (index === -1) {
            return {
                ok: false,
                error: "Propuesta no encontrada"
            };
        }

        const item = this.pending.splice(index, 1)[0];

        item.status = "rejected";
        item.resolvedAt = new Date().toISOString();

        this.history.push(item);

        return {
            ok: true,
            action: "rejected",
            item
        };
    }

    getHistory() {
        return this.history;
    }

    getStatus() {
        return {
            pending: this.pending.length,
            history: this.history.length
        };
    }
}

module.exports = ApprovalQueue;