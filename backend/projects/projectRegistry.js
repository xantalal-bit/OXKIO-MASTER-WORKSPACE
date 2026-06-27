// OXKIO PROJECT REGISTRY V1

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "projectRegistryStore.json");

const DEFAULT_PROJECTS = [
  "OXKIO",
  "Business Hunter",
  "Profesor IA",
  "GIU",
  "XANTALALSHOP"
];

function now() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeProject(input) {
  const timestamp = now();

  return {
    name: normalizeText(input.name),
    path: input.path || null,
    enabled: input.enabled !== false,
    category: normalizeText(input.category || "ECOSYSTEM"),
    description: normalizeText(input.description),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp
  };
}

function normalizeProjectList(value) {
  return Array.isArray(value) ? value : [];
}

function createDefaultProject(name) {
  return normalizeProject({
    name,
    path: null,
    enabled: true,
    category: "ECOSYSTEM",
    description: ""
  });
}

function createDefaultProjects() {
  return DEFAULT_PROJECTS.map(createDefaultProject);
}

function sameProjectName(a, b) {
  return normalizeSearchText(a) === normalizeSearchText(b);
}

function mergeDefaultProjects(projects) {
  const merged = normalizeProjectList(projects).map(normalizeProject);

  createDefaultProjects().forEach((defaultProject) => {
    const exists = merged.some((project) => sameProjectName(project.name, defaultProject.name));

    if (!exists) {
      merged.push(defaultProject);
    }
  });

  return merged;
}

class ProjectRegistry {
  constructor(storePath) {
    this.storePath = storePath || STORE_PATH;
    this.ensureInitialized();
  }

  ensureInitialized() {
    const store = this.readStore();

    this.writeStore({
      version: store.version || "1.0",
      projects: mergeDefaultProjects(store.projects)
    });
  }

  readStore() {
    try {
      if (!fs.existsSync(this.storePath)) {
        return { version: "1.0", projects: createDefaultProjects() };
      }

      const data = JSON.parse(fs.readFileSync(this.storePath, "utf8"));

      return {
        version: data.version || "1.0",
        projects: mergeDefaultProjects(data.projects)
      };
    } catch (error) {
      return { version: "1.0", projects: createDefaultProjects() };
    }
  }

  writeStore(store) {
    const data = {
      version: store.version || "1.0",
      projects: normalizeProjectList(store.projects).map(normalizeProject)
    };

    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    return data;
  }

  registerProject(project) {
    const normalizedProject = normalizeProject(project || {});

    if (!normalizedProject.name) {
      throw new Error("Project name is required.");
    }

    const store = this.readStore();
    const existing = store.projects.find((item) => sameProjectName(item.name, normalizedProject.name));

    if (existing) {
      return existing;
    }

    store.projects.push(normalizedProject);
    this.writeStore(store);

    return normalizedProject;
  }

  listProjects() {
    return this.readStore().projects;
  }

  getProject(name) {
    const projectName = normalizeText(name);

    return this.listProjects().find((project) => sameProjectName(project.name, projectName)) || null;
  }

  updateProject(name, data) {
    const projectName = normalizeText(name);
    const store = this.readStore();
    const index = store.projects.findIndex((project) => sameProjectName(project.name, projectName));

    if (index === -1) {
      return null;
    }

    const current = store.projects[index];
    const updated = normalizeProject({
      ...current,
      ...(data || {}),
      name: current.name,
      createdAt: current.createdAt,
      updatedAt: now()
    });

    store.projects[index] = updated;
    this.writeStore(store);

    return updated;
  }

  removeProject(name) {
    const projectName = normalizeText(name);
    const store = this.readStore();
    const initialLength = store.projects.length;
    const projects = store.projects.filter((project) => {
      return !sameProjectName(project.name, projectName);
    });

    if (projects.length === initialLength) {
      return null;
    }

    this.writeStore({
      version: store.version,
      projects
    });

    return {
      removed: true,
      name: projectName
    };
  }

  initializeDefaultPaths(paths) {
    const input = paths || {};
    const store = this.readStore();
    const updatedProjects = [];
    const skippedProjects = [];

    DEFAULT_PROJECTS.forEach((projectName) => {
      const index = store.projects.findIndex((project) => sameProjectName(project.name, projectName));
      const projectPath = input[projectName];

      if (index === -1 || !projectPath) {
        skippedProjects.push(projectName);
        return;
      }

      store.projects[index] = {
        ...store.projects[index],
        path: projectPath,
        updatedAt: now()
      };
      updatedProjects.push(projectName);
    });

    this.writeStore(store);

    return {
      ok: updatedProjects.length > 0,
      updatedProjects,
      skippedProjects,
      initializedAt: now()
    };
  }

  getStatus() {
    const projects = this.listProjects();
    const enabledProjects = projects.filter((project) => project.enabled);

    return {
      name: "ProjectRegistry",
      version: "1.0",
      totalProjects: projects.length,
      enabledProjects: enabledProjects.length,
      disabledProjects: projects.length - enabledProjects.length,
      defaultProjects: DEFAULT_PROJECTS.slice()
    };
  }
}

module.exports = new ProjectRegistry();
module.exports.ProjectRegistry = ProjectRegistry;
module.exports.DEFAULT_PROJECTS = DEFAULT_PROJECTS;
