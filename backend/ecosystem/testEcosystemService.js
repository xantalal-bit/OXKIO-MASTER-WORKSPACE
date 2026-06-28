const ecosystemService = require("./ecosystemService");

console.log("Nombre del ecosistema:", ecosystemService.getEcosystemName());
console.log("Ruta raíz:", ecosystemService.getEcosystemRoot());
console.log("Carpeta de gobierno:", ecosystemService.getGovernanceFolder());
console.log(
  "Número de documentos de gobierno:",
  ecosystemService.getGovernanceFiles().length
);
