// OXKIO PROJECT FOLDER CONNECTOR V1

const fs = require("fs");
const path = require("path");
const BaseKnowledgeConnector = require("../baseKnowledgeConnector");

const PDF_DETECTED_CONTENT = "[PDF document detected]";
const DOCX_DETECTED_CONTENT = "[DOCX document detected]";

const SUPPORTED_TYPES = {
  ".txt": "TXT",
  ".md": "MARKDOWN",
  ".json": "JSON",
  ".pdf": "PDF",
  ".docx": "DOCX"
};

function normalizeText(value) {
  return String(value || "").trim();
}

function createId(item) {
  const base = [
    item.title,
    item.content,
    item.source,
    item.type
  ].join("|").toLowerCase();
  let hash = 0;

  for (let index = 0; index < base.length; index += 1) {
    hash = ((hash << 5) - hash) + base.charCodeAt(index);
    hash |= 0;
  }

  return `project-folder-${Math.abs(hash)}`;
}

function typeFromFilePath(filePath) {
  return SUPPORTED_TYPES[path.extname(filePath).toLowerCase()] || null;
}

function contentFromFilePath(filePath, type) {
  if (type === "PDF") {
    return PDF_DETECTED_CONTENT;
  }

  if (type === "DOCX") {
    return DOCX_DETECTED_CONTENT;
  }

  return fs.readFileSync(filePath, "utf8");
}

class ProjectFolderConnector extends BaseKnowledgeConnector {
  constructor(config) {
    super({
      ...(config || {}),
      name: (config && config.name) || "ProjectFolderConnector",
      source: "Project Folder"
    });
    this.projectPath = config && config.projectPath;
  }

  connect() {
    if (!this.projectPath) {
      throw new Error("ProjectFolderConnector requires config.projectPath.");
    }

    const resolvedPath = path.resolve(this.projectPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`ProjectFolderConnector project not found: ${resolvedPath}`);
    }

    if (!fs.statSync(resolvedPath).isDirectory()) {
      throw new Error(`ProjectFolderConnector path is not a folder: ${resolvedPath}`);
    }

    this.projectPath = resolvedPath;
    this.connected = true;

    return this.getStatus();
  }

  disconnect() {
    this.connected = false;

    return this.getStatus();
  }

  fetchItems() {
    if (!this.isConnected()) {
      throw new Error("ProjectFolderConnector is not connected.");
    }

    return fs.readdirSync(this.projectPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(this.projectPath, entry.name))
      .map((filePath) => {
        return {
          filePath,
          type: typeFromFilePath(filePath)
        };
      })
      .filter((file) => Boolean(file.type))
      .map((file) => {
        return {
          title: path.basename(file.filePath),
          content: contentFromFilePath(file.filePath, file.type),
          source: "Project Folder",
          type: file.type
        };
      });
  }

  normalizeItem(item) {
    const normalizedItem = {
      title: normalizeText(item.title),
      content: normalizeText(item.content),
      source: "Project Folder",
      type: normalizeText(item.type || "TXT")
    };
    const timestamp = new Date().toISOString();

    return {
      id: item.id || createId(normalizedItem),
      title: normalizedItem.title,
      source: normalizedItem.source,
      type: normalizedItem.type,
      content: normalizedItem.content,
      summary: normalizeText(item.summary),
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => normalizeText(tag)).filter(Boolean) : [],
      classification: normalizeText(item.classification || "GENERAL"),
      createdAt: item.createdAt || timestamp,
      updatedAt: item.updatedAt || timestamp
    };
  }
}

module.exports = ProjectFolderConnector;
