const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "approvalQueue.json");

class ApprovalQueue {

   constructor() {

    this.pending = [];
    this.history = [];

    this.load();
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
        this.save();

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
        this.save();
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
        this.save();

        return {
            ok: true,
            action: "rejected",
            item
        };
    }

    getHistory() {
        return this.history;
    }
save() {

    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({
            pending: this.pending,
            history: this.history
        }, null, 2)
    );
}

load() {

    try {

        if (fs.existsSync(DATA_FILE)) {

            const raw = fs.readFileSync(DATA_FILE);

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