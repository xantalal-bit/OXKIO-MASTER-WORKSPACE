class MemoryEngine {

    constructor() {

        this.shortTermMemory = [];

        this.longTermMemory = [];

        this.maxShortTerm = 20;
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
    }

    saveLongTerm(data) {

        this.longTermMemory.push({
            timestamp: new Date(),
            data
        });
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