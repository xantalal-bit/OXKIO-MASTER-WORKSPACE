const fs = require("fs");
const path = require("path");

const PROJECT_ORDER = [
  "OXKIO",
  "BUSINESS-HUNTER",
  "GIU",
  "PROFESOR-IA",
  "LEARNING-HEROES-AGENT"
];

const PROJECT_ALIASES = {
  OXKIO: ["oxkio", "centro de mando"],
  "BUSINESS-HUNTER": ["business hunter"],
  GIU: ["giu"],
  "PROFESOR-IA": ["profesor ia"],
  "LEARNING-HEROES-AGENT": ["learning heroes", "knowledge hub"]
};

const ORCHESTRATION_PATH = path.join(__dirname, "../../orchestration");

function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .trim();
}

function readDocument(fileName) {
  return fs
    .readFileSync(path.join(ORCHESTRATION_PATH, fileName), "utf8")
    .replace(/^\uFEFF/, "");
}

function parseProjects(markdown) {
  const projects = new Map();
  let currentProject = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const projectMatch = line.match(/^\d+\.\s+(.+)$/);

    if (projectMatch && PROJECT_ORDER.includes(projectMatch[1].trim())) {
      currentProject = projectMatch[1].trim();
      projects.set(currentProject, {
        name: currentProject,
        status: "No definido",
        priority: "No definida"
      });
      continue;
    }

    if (!currentProject) continue;

    const fieldMatch = line.match(/^-\s+(Estado|Prioridad):\s*(.+)$/i);
    if (!fieldMatch) continue;

    const project = projects.get(currentProject);
    const field = normalize(fieldMatch[1]);

    if (field === "estado") project.status = fieldMatch[2].trim();
    if (field === "prioridad") project.priority = fieldMatch[2].trim();
  }

  return projects;
}

function parseNextStepCandidates(tasksMarkdown, roadmapMarkdown) {
  const taskLines = tasksMarkdown
    .split(/\r?\n/)
    .map(line => line.trim().match(/^\d+\.\s+(.+)$/))
    .filter(Boolean)
    .map(match => match[1].trim());

  const roadmapLines = roadmapMarkdown
    .split(/\r?\n/)
    .map(line => line.trim().match(/^-\s+(.+)$/))
    .filter(Boolean)
    .map(match => match[1].trim());

  return [...taskLines, ...roadmapLines];
}

function findNextStep(projectName, candidates) {
  const aliases = PROJECT_ALIASES[projectName] || [];

  return candidates.find(candidate => {
    const normalizedCandidate = normalize(candidate);
    return aliases.some(alias => normalizedCandidate.includes(alias));
  }) || "Pendiente de definir";
}

function getProjects() {
  const projects = parseProjects(readDocument("PROJECTS.md"));
  const candidates = parseNextStepCandidates(
    readDocument("TASKS.md"),
    readDocument("ROADMAP.md")
  );

  return PROJECT_ORDER.map(name => {
    const project = projects.get(name) || {
      name,
      status: "No definido",
      priority: "No definida"
    };

    return {
      ...project,
      nextStep: findNextStep(name, candidates)
    };
  });
}

module.exports = {
  getProjects
};
