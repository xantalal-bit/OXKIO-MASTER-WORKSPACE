// OXKIO GOVERNANCE READER V1
// Lee los documentos oficiales del Ecosistema XANTALAL

const fs = require("fs");
const path = require("path");

const GOVERNANCE_PATH = path.join(
  "C:",
  "Users",
  "janta",
  "OneDrive",
  "Documentos",
  "XANTALAL",
  "00_GOVERNANCE"
);

const FILES = {
  manual: "MANUAL_DE_GOBIERNO_XANTALAL.md",
  decisions: "DECISIONES_APROBADAS.md",
  roadmap: "ROADMAP_GENERAL.md",
  organigram: "ORGANIGRAMA.md",
  agents: "AGENTES.md"
};

function readFileSafe(filename) {
  const filePath = path.join(GOVERNANCE_PATH, filename);

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      filename,
      content: "",
      error: "Archivo no encontrado"
    };
  }

  return {
    ok: true,
    filename,
    content: fs.readFileSync(filePath, "utf8")
  };
}

function readGovernance() {
  return {
    ecosystem: "XANTALAL",
    version: "1.0",
    owner: "José Antonio Álvarez",
    sourcePath: GOVERNANCE_PATH,
    loadedAt: new Date().toISOString(),
    documents: {
      manual: readFileSafe(FILES.manual),
      decisions: readFileSafe(FILES.decisions),
      roadmap: readFileSafe(FILES.roadmap),
      organigram: readFileSafe(FILES.organigram),
      agents: readFileSafe(FILES.agents)
    }
  };
}

module.exports = {
  readGovernance
};