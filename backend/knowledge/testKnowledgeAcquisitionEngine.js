// OXKIO KNOWLEDGE ACQUISITION ENGINE MANUAL TEST

const fs = require("fs");
const os = require("os");
const path = require("path");

const { KnowledgeCurator } = require("./knowledgeCurator");
const { KnowledgeAcquisitionEngine } = require("./knowledgeAcquisitionEngine");

function removePathSafe(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (error) {
    console.error("No se pudo limpiar temporal:", error.message || String(error));
  }
}

const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tempFolderPath = path.join(os.tmpdir(), `oxkio-knowledge-acquisition-${tempId}`);
const knowledgeStorePath = path.join(os.tmpdir(), `oxkio-knowledge-acquisition-store-${tempId}.json`);

try {
  fs.mkdirSync(tempFolderPath, { recursive: true });

  const learningHeroesPath = path.join(tempFolderPath, "learning-heroes.json");

  fs.writeFileSync(learningHeroesPath, JSON.stringify([
    {
      title: "Oxkio Learning Heroes",
      description: "Contenido temporal para probar adquisicion de conocimiento."
    }
  ], null, 2), "utf8");
  fs.writeFileSync(path.join(tempFolderPath, "nota.txt"), "Nota temporal de OXKIO.", "utf8");
  fs.writeFileSync(path.join(tempFolderPath, "guia.md"), "# Guia temporal\nContenido markdown.", "utf8");
  fs.writeFileSync(path.join(tempFolderPath, "manual.pdf"), "%PDF-1.4 fake", "ascii");
  fs.writeFileSync(path.join(tempFolderPath, "plan.docx"), "DOCX fake bytes", "ascii");

  const curator = new KnowledgeCurator(knowledgeStorePath);
  const engine = new KnowledgeAcquisitionEngine({ curator });
  const registration = engine.registerDefaultConnectors({
    learningHeroesFilePath: learningHeroesPath,
    localFolderPath: tempFolderPath,
    pdfFolderPath: tempFolderPath,
    docxFolderPath: tempFolderPath,
    projectPath: tempFolderPath
  });
  const runAllResult = engine.runAll();
  const engineStatus = engine.getStatus();

  console.log("Registered connectors:");
  console.log(JSON.stringify(registration, null, 2));

  console.log("RunAll result:");
  console.log(JSON.stringify(runAllResult, null, 2));

  console.log("Engine status:");
  console.log(JSON.stringify(engineStatus, null, 2));
} finally {
  removePathSafe(tempFolderPath);
  removePathSafe(knowledgeStorePath);
}
