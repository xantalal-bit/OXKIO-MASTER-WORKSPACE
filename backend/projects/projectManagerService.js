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
  OXKIO: ["oxkio", "centro de mando", "ecosystem observer"],
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

function findProjectRole(projectsMarkdown, projectName) {
  const lines = projectsMarkdown.split(/\r?\n/);
  let inProject = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const projectMatch = line.match(/^\d+\.\s+(.+)$/);
    if (projectMatch) {
      inProject = projectMatch[1].trim() === projectName;
      continue;
    }
    if (!inProject) continue;
    const roleMatch = line.match(/^-\s+Rol:\s*(.+)$/i);
    if (roleMatch) return roleMatch[1].trim();
  }
  return "";
}

function findProjectField(projectsMarkdown, projectName, label) {
  const lines = projectsMarkdown.split(/\r?\n/);
  let inProject = false;
  const fieldPattern = new RegExp(`^-\\s+${label}:\\s*(.+)$`, "i");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const projectMatch = line.match(/^\d+\.\s+(.+)$/);
    if (projectMatch) {
      inProject = projectMatch[1].trim() === projectName;
      continue;
    }
    if (!inProject) continue;
    const fieldMatch = line.match(fieldPattern);
    if (fieldMatch) return fieldMatch[1].trim();
  }
  return "";
}

function findLabeledValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^-\\s+${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

function findActiveTask(tasksMarkdown) {
  const activeSection = tasksMarkdown.match(
    /^##\s+Prioridad inmediata vigente\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/im
  );
  if (!activeSection) return "";
  const task = activeSection[1].match(/^\s*1\.\s+(.+)$/m);
  return task ? task[1].trim() : "";
}

function findSection(markdown, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "im")
  );
  return match ? match[1] : "";
}

function findNumberedItems(markdown, heading, limit = 5) {
  return findSection(markdown, heading)
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^\d+\.\s+(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .slice(0, limit);
}

function findBulletItems(markdown, heading, limit = 5) {
  return findSection(markdown, heading)
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^-\s+(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .slice(0, limit);
}

function completionValue(value) {
  const status = normalize(value);
  if (/^(completad|actualizad)/.test(status)) return true;
  if (/^(pendiente|en curso|bloquead)/.test(status)) return false;
  return null;
}

function buildClosureEvidence(roadmap) {
  const section = findSection(roadmap, "Evidencia de cierre");
  const fields = {
    implementation: "Implementación",
    integration: "Integración",
    tests: "Pruebas",
    manualPilot: "Piloto manual",
    audit: "Auditoría",
    documentation: "Documentación canónica",
    observerAligned: "Observer alineado",
    supervisorValidation: "Validación del Supervisor",
    stagingPrepared: "Staging selectivo preparado",
    commit: "Commit",
    publication: "Publicación"
  };
  return Object.freeze(Object.entries(fields).reduce((result, [key, label]) => {
    result[key] = completionValue(findLabeledValue(section, label));
    return result;
  }, {}));
}

function deriveRoadmapAlignment({
  currentBlock,
  currentPhase,
  roadmapObjective,
  projectObjective,
  roadmapNextStep,
  activeTask
}) {
  const required = [
    currentBlock,
    currentPhase,
    roadmapObjective,
    projectObjective,
    roadmapNextStep,
    activeTask
  ];
  if (required.every(Boolean)) {
    const objectivesAgree = normalize(roadmapObjective) === normalize(projectObjective);
    const nextStepsAgree = normalize(roadmapNextStep) === normalize(activeTask);
    return objectivesAgree && nextStepsAgree ? "aligned" : "attention";
  }
  return required.some(Boolean) ? "attention" : "unknown";
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

function getProjectStateView(projectName = "OXKIO") {
  const project = getProjects().find(item => item.name === projectName);
  if (!project) {
    return Object.freeze({
      project: "",
      blockPhase: "",
      activeSubphase: "",
      currentBlock: "",
      currentPhase: "",
      currentObjective: "",
      roadmapAlignment: "unknown",
      nextRecommendedStep: "",
      lastMilestone: "",
      nextPlannedPhase: "",
      remainingSteps: Object.freeze([]),
      doNotOpenYet: Object.freeze([]),
      driftEvidence: Object.freeze([]),
      reuseEvidence: Object.freeze([]),
      duplicationEvidence: Object.freeze([]),
      sessionAchievements: Object.freeze([]),
      consolidatedCapabilities: Object.freeze([]),
      closureEvidence: buildClosureEvidence(""),
      sessionSummary: ""
    });
  }

  const roadmap = readDocument("ROADMAP.md");
  const projects = readDocument("PROJECTS.md");
  const tasks = readDocument("TASKS.md");
  const currentBlock = findLabeledValue(roadmap, "Bloque actual");
  const blockPhase = findLabeledValue(roadmap, "Código de bloque");
  const activeSubphase = findLabeledValue(roadmap, "Subfase activa");
  const currentPhase = findLabeledValue(roadmap, "Fase actual");
  const currentObjective = findLabeledValue(roadmap, "Objetivo inmediato");
  const projectObjective = findProjectField(projects, project.name, "Objetivo inmediato");
  const roadmapNextStep = findLabeledValue(roadmap, "Siguiente paso recomendado");
  const activeTask = findActiveTask(tasks);
  const nextRecommendedStep = activeTask || roadmapNextStep;
  const lastMilestone = findLabeledValue(roadmap, "Último hito publicado");
  const nextPlannedPhase = findLabeledValue(roadmap, "Siguiente fase prevista");
  const remainingSteps = Object.freeze(findNumberedItems(tasks, "Prioridad inmediata vigente"));
  const doNotOpenYet = Object.freeze(findBulletItems(roadmap, "No abrir todavía"));
  const driftEvidence = Object.freeze(findBulletItems(roadmap, "Advertencias evidenciadas", 3));
  const reuseEvidence = Object.freeze(findBulletItems(roadmap, "Elementos a reutilizar", 3));
  const duplicationEvidence = Object.freeze(
    findBulletItems(roadmap, "Duplicación eliminada o evitada", 3)
  );
  const sessionAchievements = Object.freeze(findBulletItems(roadmap, "Logros de la sesión", 5));
  const consolidatedCapabilities = Object.freeze(
    findBulletItems(roadmap, "Capacidades consolidadas y publicadas", 20)
      .map((capability) => capability.replace(/[.;:]$/, "").trim())
      .filter(Boolean)
  );
  const closureEvidence = buildClosureEvidence(roadmap);
  const sessionSummary = findLabeledValue(roadmap, "Resumen de la sesión");

  return Object.freeze({
    project: project.name,
    blockPhase,
    activeSubphase,
    currentBlock,
    currentPhase,
    currentObjective,
    roadmapAlignment: deriveRoadmapAlignment({
      currentBlock,
      currentPhase,
      roadmapObjective: currentObjective,
      projectObjective,
      roadmapNextStep,
      activeTask
    }),
    nextRecommendedStep,
    lastMilestone,
    nextPlannedPhase,
    remainingSteps,
    doNotOpenYet,
    driftEvidence,
    reuseEvidence,
    duplicationEvidence,
    sessionAchievements,
    consolidatedCapabilities,
    closureEvidence,
    sessionSummary
  });
}

module.exports = {
  getProjectStateView,
  getProjects
};
