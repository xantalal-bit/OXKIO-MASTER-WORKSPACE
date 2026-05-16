const fs = require("fs");
const path = require("path");

class MemoryEngine {

    constructor() {

        this.memoryPath = path.join(__dirname, "memory.json");

        this.maxShortTerm = 20;

        this.shortTermMemory = [];
        this.longTermMemory = [];

        this.loadMemory();
    }

    loadMemory() {

        try {

            const raw = fs.readFileSync(this.memoryPath);

            const parsed = JSON.parse(raw);

            this.shortTermMemory = parsed.shortTermMemory || [];
            this.longTermMemory = parsed.longTermMemory || [];

        } catch (error) {

            console.log("No se pudo cargar memory.json");
        }
    }

    persistMemory() {

        fs.writeFileSync(
            this.memoryPath,
            JSON.stringify({
                shortTermMemory: this.shortTermMemory,
                longTermMemory: this.longTermMemory
            }, null, 2)
        );
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

        return this.longTermMemory.filter(item =>
            JSON.stringify(item.data)
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