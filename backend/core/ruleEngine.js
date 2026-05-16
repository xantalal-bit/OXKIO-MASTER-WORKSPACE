class RuleEngine {

    constructor() {

        this.rules = [];
    }

    addRule(rule) {

        this.rules.push({
            createdAt: new Date().toISOString(),
            ...rule
        });

        return {
            ok: true,
            totalRules: this.rules.length
        };
    }

    evaluate(context = {}) {

        const matchedRules = [];

        for (const rule of this.rules) {

            if (this.matches(rule, context)) {

                matchedRules.push(rule);
            }
        }

        return matchedRules;
    }

    matches(rule, context) {

        if (!rule.keyword) return false;

        const text = JSON.stringify(context).toLowerCase();

        return text.includes(rule.keyword.toLowerCase());
    }

    getRules() {

        return this.rules;
    }

    getStatus() {

        return {
            totalRules: this.rules.length
        };
    }
}

module.exports = RuleEngine;