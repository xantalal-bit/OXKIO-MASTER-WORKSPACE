// TEST SYSTEM OXKIO V2
// Prueba de arranque del sistema completo

const OxkioSystem = require("./core/system");

const oxkio = new OxkioSystem();

const bootResult = oxkio.boot();

console.log("=== OXKIO SYSTEM BOOT ===");
console.log(JSON.stringify(bootResult, null, 2));

console.log("=== OXKIO SYSTEM STATUS ===");
console.log(JSON.stringify(oxkio.getStatus(), null, 2));