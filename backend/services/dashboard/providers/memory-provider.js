const { getMemory: getRuntimeMemory } = require("../../../runtime/executive-runtime");

function getMemory(timestamp) {
  const memory = getRuntimeMemory();
  const status = memory.getStatus();

  return {
    summary: `Memoria ejecutiva activa con ${status.shortTerm} registros recientes y ${status.longTerm} registros históricos.`,
    signals: [],
    counters: {
      shortTermItems: status.shortTerm,
      longTermItems: status.longTerm,
      maxShortTerm: status.maxShortTerm
    },
    updatedAt: timestamp,
    source: "runtime-memory"
  };
}

module.exports = {
  getMemory
};
