class LogEngine {

    constructor() {

        this.logs = [];
    }

    addLog(type, message, data = null) {

        const log = {
            timestamp: new Date(),
            type,
            message,
            data
        };

        this.logs.push(log);

        console.log(`[${type}] ${message}`);
    }

    getLogs() {

        return this.logs;
    }

    getLogsByType(type) {

        return this.logs.filter(log => log.type === type);
    }

    getStatus() {

        return {
            totalLogs: this.logs.length
        };
    }
}

module.exports = LogEngine;