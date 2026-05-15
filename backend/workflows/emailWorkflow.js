class EmailWorkflow {

    constructor(emailAgent) {
        this.emailAgent = emailAgent;
        this.name = "EMAIL_WORKFLOW";
    }

    process(email) {

        const priority = this.emailAgent.detectPriority(email);

        const suggestion = this.emailAgent.suggestAction(email);

        const reply = this.emailAgent.generateReplyProposal(email);

        return {
            workflow: this.name,
            processed: true,
            email,
            priority,
            suggestion,
            reply
        };
    }

}

module.exports = EmailWorkflow;