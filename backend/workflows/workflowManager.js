class WorkflowManager {
    constructor() {
        this.workflows = [];
    }

    registerWorkflow(workflow) {
        this.workflows.push(workflow);

        return {
            success: true,
            workflow
        };
    }

    getWorkflows() {
        return this.workflows;
    }

    executeWorkflow(name) {
        const workflow = this.workflows.find(
            wf => wf.name === name
        );

        if (!workflow) {
            return {
                success: false,
                error: "Workflow no encontrado"
            };
        }

        return {
            success: true,
            message: `Workflow ejecutado: ${name}`
        };
    }
}

module.exports = WorkflowManager;