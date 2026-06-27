// OXKIO EXECUTIVE STRATEGIC AGENDA V1

const fs = require("fs");
const path = require("path");
const { readGovernanceSummary } = require("../governance/governanceReader");

const STORE_PATH = path.join(__dirname, "executiveAgendaStore.json");

const ALLOWED_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "BLOCKED",
  "WAITING",
  "COMPLETED",
  "CANCELLED"
];

const ALLOWED_PRIORITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW"
];

const ALLOWED_ORIGINS = [
  "ROADMAP",
  "USER",
  "SYSTEM"
];

const PRIORITY_WEIGHT = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

const STATUS_WEIGHT = {
  ACTIVE: 3,
  PLANNED: 2,
  WAITING: 1
};

function now() {
  return new Date().toISOString();
}

function createId() {
  return `initiative-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePriority(priority) {
  const value = String(priority || "MEDIUM").toUpperCase();

  return ALLOWED_PRIORITIES.includes(value) ? value : "MEDIUM";
}

function normalizeStatus(status) {
  const value = String(status || "PLANNED").toUpperCase();

  return ALLOWED_STATUSES.includes(value) ? value : "PLANNED";
}

function normalizeOrigin(origin) {
  const value = String(origin || "USER").toUpperCase();

  return ALLOWED_ORIGINS.includes(value) ? value : "USER";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeInitiative(input, existing) {
  const current = existing || {};
  const timestamp = now();

  return {
    id: current.id || input.id || createId(),
    title: String(input.title || current.title || "").trim(),
    description: String(input.description || current.description || "").trim(),
    project: String(input.project || current.project || "").trim(),
    priority: normalizePriority(input.priority || current.priority),
    status: normalizeStatus(input.status || current.status),
    createdAt: current.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
    reason: String(input.reason || current.reason || "").trim(),
    dependencies: normalizeArray(input.dependencies || current.dependencies),
    notes: normalizeArray(input.notes || current.notes),
    origin: normalizeOrigin(input.origin || current.origin)
  };
}

function normalizeStoredInitiative(input) {
  const timestamp = now();

  return {
    id: input.id || createId(),
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    project: String(input.project || "").trim(),
    priority: normalizePriority(input.priority),
    status: normalizeStatus(input.status),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || input.createdAt || timestamp,
    reason: String(input.reason || "").trim(),
    dependencies: normalizeArray(input.dependencies),
    notes: normalizeArray(input.notes),
    origin: normalizeOrigin(input.origin)
  };
}

function roadmapPriorityFor(project, roadmapPriorities) {
  const priorities = normalizeArray(roadmapPriorities);
  const projectName = String(project || "").toLowerCase();
  const match = priorities.find((item) => {
    return String(item.product || "").toLowerCase() === projectName;
  });

  return match ? Number(match.priority) || 999 : 999;
}

function priorityFromRoadmapNumber(priority) {
  const value = Number(priority);

  if (value === 1) {
    return "CRITICAL";
  }

  if (value === 2) {
    return "HIGH";
  }

  if (value === 3) {
    return "MEDIUM";
  }

  return "LOW";
}

function statusFromRoadmapNumber(priority) {
  return Number(priority) === 1 ? "ACTIVE" : "PLANNED";
}

function projectDisplayName(project) {
  return String(project || "")
    .replace(/\bCORE\b/g, "Core")
    .trim();
}

function sameInitiative(a, b) {
  return String(a.origin || "").toUpperCase() === String(b.origin || "").toUpperCase()
    && String(a.project || "").toLowerCase() === String(b.project || "").toLowerCase()
    && String(a.title || "").toLowerCase() === String(b.title || "").toLowerCase();
}

class ExecutiveAgenda {
  constructor(storePath) {
    this.storePath = storePath || STORE_PATH;
  }

  readStore() {
    try {
      if (!fs.existsSync(this.storePath)) {
        return { version: "1.0", initiatives: [] };
      }

      const data = JSON.parse(fs.readFileSync(this.storePath, "utf8"));

      return {
        version: data.version || "1.0",
        initiatives: normalizeArray(data.initiatives).map(normalizeStoredInitiative)
      };
    } catch (error) {
      return { version: "1.0", initiatives: [] };
    }
  }

  writeStore(store) {
    const data = {
      version: store.version || "1.0",
      initiatives: normalizeArray(store.initiatives)
    };

    fs.writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    return data;
  }

  addInitiative(input) {
    const store = this.readStore();
    const initiative = normalizeInitiative(input || {});

    const duplicate = store.initiatives.find((item) => sameInitiative(item, initiative));

    if (duplicate) {
      return duplicate;
    }

    store.initiatives.push(initiative);
    this.writeStore(store);

    return initiative;
  }

  updateInitiative(id, updates) {
    const store = this.readStore();
    const index = store.initiatives.findIndex((initiative) => initiative.id === id);

    if (index === -1) {
      return null;
    }

    const updated = normalizeInitiative(updates || {}, store.initiatives[index]);
    store.initiatives[index] = updated;
    this.writeStore(store);

    return updated;
  }

  closeInitiative(id, reason) {
    return this.updateInitiative(id, {
      status: "COMPLETED",
      reason
    });
  }

  pauseInitiative(id, reason) {
    return this.updateInitiative(id, {
      status: "WAITING",
      reason
    });
  }

  listInitiatives() {
    return this.readStore().initiatives;
  }

  isInitialized() {
    return this.listInitiatives().length > 0;
  }

  resetAgenda() {
    return this.writeStore({
      version: "1.0",
      initiatives: []
    });
  }

  initializeAgendaFromGovernance() {
    const store = this.readStore();

    if (store.initiatives.length > 0) {
      return store.initiatives;
    }

    let governance;

    try {
      governance = readGovernanceSummary();
    } catch (error) {
      governance = {};
    }

    const priorities = normalizeArray(governance.priorities);
    const products = normalizeArray(governance.products);
    const initiativesSource = priorities.length > 0
      ? priorities
      : products.map((product, index) => {
        return {
          priority: index + 1,
          product: product.name || product.project || "",
          status: "",
          objective: product.description ? [product.description] : []
        };
      });

    const initiatives = initiativesSource
      .map((item) => {
        const project = String(item.product || item.project || "").trim();
        const titleProject = projectDisplayName(project);

        if (!project) {
          return null;
        }

        return normalizeInitiative({
          title: `Continuar ${titleProject}`,
          description: normalizeArray(item.objective).join(" "),
          project,
          priority: priorityFromRoadmapNumber(item.priority),
          status: statusFromRoadmapNumber(item.priority),
          reason: "Iniciativa inicial generada desde el Roadmap Oficial de XANTALAL.",
          dependencies: [],
          notes: item.status ? [`Estado en Roadmap: ${item.status}`] : [],
          origin: "ROADMAP"
        });
      })
      .filter(Boolean)
      .reduce((unique, initiative) => {
        const duplicate = unique.find((item) => sameInitiative(item, initiative));

        if (!duplicate) {
          unique.push(initiative);
        }

        return unique;
      }, []);

    return this.writeStore({
      version: store.version || "1.0",
      initiatives
    }).initiatives;
  }

  dependenciesCompleted(initiative, initiatives) {
    const dependencies = normalizeArray(initiative.dependencies);

    return dependencies.every((dependencyId) => {
      const dependency = initiatives.find((item) => item.id === dependencyId);

      return dependency && dependency.status === "COMPLETED";
    });
  }

  listBlocked() {
    return this.listInitiatives().filter((initiative) => {
      return initiative.status === "BLOCKED";
    });
  }

  listCompleted() {
    return this.listInitiatives().filter((initiative) => {
      return initiative.status === "COMPLETED";
    });
  }

  getCurrentFocus() {
    const initiatives = this.listInitiatives();

    return initiatives
      .filter((initiative) => initiative.status === "ACTIVE")
      .filter((initiative) => this.dependenciesCompleted(initiative, initiatives))
      .sort((a, b) => {
        return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      });
  }

  getNextRecommendedInitiative(roadmapPriorities) {
    const initiatives = this.listInitiatives();
    const candidates = initiatives
      .filter((initiative) => ["ACTIVE", "PLANNED", "WAITING"].includes(initiative.status))
      .filter((initiative) => this.dependenciesCompleted(initiative, initiatives));

    if (candidates.length === 0) {
      return null;
    }

    return candidates.sort((a, b) => {
      const roadmapA = roadmapPriorityFor(a.project, roadmapPriorities);
      const roadmapB = roadmapPriorityFor(b.project, roadmapPriorities);
      const statusScore = (STATUS_WEIGHT[b.status] || 0) - (STATUS_WEIGHT[a.status] || 0);
      const priorityScore = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];

      if (roadmapA !== roadmapB) {
        return roadmapA - roadmapB;
      }

      if (priorityScore !== 0) {
        return priorityScore;
      }

      if (statusScore !== 0) {
        return statusScore;
      }

      return String(a.createdAt).localeCompare(String(b.createdAt));
    })[0];
  }
}

module.exports = new ExecutiveAgenda();
module.exports.ExecutiveAgenda = ExecutiveAgenda;
module.exports.ALLOWED_STATUSES = ALLOWED_STATUSES;
module.exports.ALLOWED_PRIORITIES = ALLOWED_PRIORITIES;
module.exports.ALLOWED_ORIGINS = ALLOWED_ORIGINS;
