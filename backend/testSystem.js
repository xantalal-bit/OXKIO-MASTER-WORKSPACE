// TEST SYSTEM OXKIO V2
// Prueba de arranque del sistema completo

const OxkioSystem = require("./core/system");
const EmailAgent = require("./agents/emailAgent");
const EmailWorkflow = require("./workflows/emailWorkflow");
const oxkio = new OxkioSystem();
const emailAgent = new EmailAgent();

const workflow = new EmailWorkflow(emailAgent);
const bootResult = oxkio.boot();

console.log("=== OXKIO SYSTEM BOOT ===");
console.log(JSON.stringify(bootResult, null, 2));

console.log("=== OXKIO SYSTEM STATUS ===");
console.log(JSON.stringify(oxkio.getStatus(), null, 2));
const testEmail = {
    from: "ceo@empresa.com",
    subject: "URGENTE: reunión consejo",
    body: "Necesitamos confirmar asistencia antes de las 18:00"
};

const result = workflow.process(testEmail);

console.log("\n=== RESULTADO WORKFLOW ===");

console.log(JSON.stringify(result, null, 2));