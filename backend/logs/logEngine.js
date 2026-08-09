'use strict';

const { redact } = require('../security/secret-runtime');

class LogEngine {

    constructor({ redactor = redact, consoleRef = console } = {}) {

        this.logs = [];
        this.redactor = redactor;
        this.consoleRef = consoleRef;
    }

    addLog(type, message, data = null) {

        const safeType = this.redactor(type);
        const safeMessage = this.redactor(message);
        const log = {
            timestamp: new Date(),
            type: safeType,
            message: safeMessage,
            data: this.redactor(data)
        };

        this.logs.push(log);

        this.consoleRef.log(`[${safeType}] ${safeMessage}`);
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
