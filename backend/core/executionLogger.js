const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "executionLog.json");

class ExecutionLogger {

    constructor() {
        this.logs = [];
        this.load();
    }

   hasExecuted(approvalId) {

    return this.logs.some(log =>
        log.approvalId === approvalId
    );
}

add(entry) {

    const log = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        ...entry
    };

    this.logs.push(log);
    this.save();

    return log;
}

    getStatus() {
        return {
            total: this.logs.length
        };
    }

    save() {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify({
                logs: this.logs
            }, null, 2)
        );
    }

    load() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const raw = fs.readFileSync(DATA_FILE);
                const data = JSON.parse(raw);
                this.logs = data.logs || [];
            }
        } catch (error) {
            console.log("[ExecutionLogger] Error loading data", error);
        }
    }
}

module.exports = ExecutionLogger;