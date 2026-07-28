const path = require("path");
const { createLocalMemoryRepository } = require("../repositories/local-repository-factory");
const { assertRepository } = require("../repositories/repository-contracts");

class MemoryEngine {

    constructor(options = {}) {

        this.memoryPath = options.memoryPath || path.join(__dirname, "memory.json");
        this.repository = assertRepository(
            options.repository || createLocalMemoryRepository(this.memoryPath),
            "MemoryRepository"
        );

        this.maxShortTerm = 20;

        this.shortTermMemory = [];
        this.longTermMemory = [];

        this.loadMemory();
    }

    loadMemory() {

        const parsed = this.repository.loadSnapshot();
        this.shortTermMemory = Array.isArray(parsed.shortTermMemory) ? parsed.shortTermMemory : [];
        this.longTermMemory = Array.isArray(parsed.longTermMemory) ? parsed.longTermMemory : [];
    }

    persistMemory() {

        this.repository.saveSnapshot({
            shortTermMemory: this.shortTermMemory,
            longTermMemory: this.longTermMemory
        });
    }

    saveShortTerm(data) {

        this.shortTermMemory.push({
            timestamp: new Date(),
            data
        });

        if (this.shortTermMemory.length > this.maxShortTerm) {

            const moved = this.shortTermMemory.shift();

            this.longTermMemory.push(moved);
        }

        this.persistMemory();
    }

    saveLongTerm(data) {

        this.longTermMemory.push({
            timestamp: new Date(),
            data
        });

        this.persistMemory();
    }

    getRecentMemory() {

        return this.shortTermMemory;
    }

    getShortTerm() {

        return this.shortTermMemory;
    }

 searchMemory(keyword) {

    const allMemory = [
        ...this.shortTermMemory,
        ...this.longTermMemory
    ];

    return allMemory.filter(item =>
        JSON.stringify(item)
            .toLowerCase()
            .includes(keyword.toLowerCase())
    );
}

getStatus() {

        return {
            shortTerm: this.shortTermMemory.length,
            longTerm: this.longTermMemory.length,
            maxShortTerm: this.maxShortTerm
        };
    }
}

module.exports = MemoryEngine;
