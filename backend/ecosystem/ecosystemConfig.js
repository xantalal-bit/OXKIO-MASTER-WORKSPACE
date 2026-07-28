const path = require("path");

const ecosystemConfig = {
  ecosystemName: "XANTALAL",
  ecosystemRoot:
    process.env.XANTALAL_ROOT || path.resolve(__dirname, "..", "..", "XANTALAL"),
  governanceFolder: "00_GOVERNANCE",
  governanceFiles: [
    "README.md",
    "00_GOVERNANCE/MANUAL_DE_GOBIERNO_XANTALAL.md",
    "00_GOVERNANCE/DECISIONES_APROBADAS.md",
    "00_GOVERNANCE/ORGANIGRAMA.md",
    "00_GOVERNANCE/ROADMAP_GENERAL.md",
    "00_GOVERNANCE/AGENTES.md",
    "00_GOVERNANCE/ESTADO_GLOBAL.md",
  ],
};

module.exports = ecosystemConfig;
