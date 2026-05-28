const fs = require("fs");
const path = require("path");

const historyPath = path.join(__dirname, "../data/history/simulations.json");

function readHistory() {
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const raw = fs.readFileSync(historyPath, "utf8");

  if (!raw.trim()) {
    return [];
  }

  return JSON.parse(raw);
}

function saveSimulation(entry) {
  const history = readHistory();

  const savedEntry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    ...entry
  };

  history.unshift(savedEntry);

  fs.writeFileSync(
    historyPath,
    JSON.stringify(history, null, 2),
    "utf8"
  );

  return savedEntry;
}

function getHistory() {
  return readHistory();
}

module.exports = {
  saveSimulation,
  getHistory
};
