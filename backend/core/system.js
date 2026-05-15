// OXKIO SYSTEM V2
// Punto de arranque del sistema operativo Oxkio

const OxkioEngine = require("./engine");
const OxkioOrchestrator = require("./orchestrator");
const OxkioSupervisor = require("./supervisor");
const EmailAgent = require("../agents/emailAgent");
const MemoryEngine = require("../memory/memoryEngine");
const LogEngine = require("../logs/logEngine");

class OxkioSystem {

  constructor() {
    this.engine = new OxkioEngine();
    this.orchestrator = new OxkioOrchestrator();
    this.supervisor = new OxkioSupervisor();
    this.memory = new MemoryEngine();
    this.logs = new LogEngine();

    this.booted = false;
  }

  boot() {
    const emailAgent = new EmailAgent();

    this.orchestrator.registerAgent(emailAgent);

    this.booted = true;

    this.logs.addLog(
  "SYSTEM",
  "Oxkio System V2 iniciado correctamente"
);

    return {
      ok: true,
      message: "Oxkio System V2 iniciado",
      engine: this.engine.getSystemStatus(),
      orchestrator: this.orchestrator.getSystemOverview(),
      supervisor: this.supervisor.getStatus()
    };
  }

   getStatus() {
    return {
      booted: this.booted,
      engine: this.engine.getSystemStatus(),
      orchestrator: this.orchestrator.getSystemOverview(),
      supervisor: this.supervisor.getStatus(),
      memory: this.memory.getStatus(),
      logs: this.logs.getStatus(),
    };
  }

}

module.exports = OxkioSystem;