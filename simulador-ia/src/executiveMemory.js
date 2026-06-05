const fs = require("fs");
const path = require("path");

const memoryPath = path.join(
  __dirname,
  "../data/memory/executiveMemory.json"
);

function ensureMemoryFile() {
  const folder = path.dirname(memoryPath);

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, {
      recursive: true
    });
  }

  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(
      memoryPath,
      JSON.stringify(
        {
          goals: [],
          decisions: [],
          priorities: [],
          projects: []
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function readExecutiveMemory() {
  ensureMemoryFile();

  const raw =
    fs.readFileSync(memoryPath, "utf8")
      .replace(/^\uFEFF/, "");

  if (!raw.trim()) {
    return {
      goals: [],
      decisions: [],
      priorities: [],
      projects: []
    };
  }

  return JSON.parse(raw);
}

function writeExecutiveMemory(memory) {
  ensureMemoryFile();

  fs.writeFileSync(
    memoryPath,
    JSON.stringify(memory, null, 2),
    "utf8"
  );

  return memory;
}

function addMemoryItem(type, text, metadata = {}) {
  const allowedTypes = [
    "goals",
    "decisions",
    "priorities",
    "projects"
  ];

  if (!allowedTypes.includes(type)) {
    throw new Error("Tipo de memoria no permitido");
  }

  const memory =
    readExecutiveMemory();

  const item = {
    id: Date.now(),
    type,
    text,
    createdAt: new Date().toISOString(),
    metadata
  };

  memory[type].unshift(item);

  memory[type] =
    memory[type].slice(0, 10);

  writeExecutiveMemory(memory);

  return item;
}

function getExecutiveMemorySummary() {
  const memory =
    readExecutiveMemory();

  return {
    totalGoals: memory.goals.length,
    totalDecisions: memory.decisions.length,
    totalPriorities: memory.priorities.length,
    totalProjects: memory.projects.length,
    latestGoal: memory.goals[0] || null,
    latestDecision: memory.decisions[0] || null,
    latestPriority: memory.priorities[0] || null,
    latestProject: memory.projects[0] || null
  };
}

module.exports = {
  readExecutiveMemory,
  writeExecutiveMemory,
  addMemoryItem,
  getExecutiveMemorySummary
};
