function getMemory(timestamp) {
  return {
    summary: "Memoria preparada para agregacion futura sin lectura real.",
    signals: [],
    counters: {
      shortTermItems: 0,
      strategicItems: 0
    },
    updatedAt: timestamp,
    source: "mock"
  };
}

module.exports = {
  getMemory
};
