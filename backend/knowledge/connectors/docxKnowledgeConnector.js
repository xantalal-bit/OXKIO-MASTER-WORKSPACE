// OXKIO DOCX KNOWLEDGE CONNECTOR V1

const fs = require("fs");
const path = require("path");
const BaseKnowledgeConnector = require("../baseKnowledgeConnector");

const DOCX_DETECTED_CONTENT = "[DOCX document detected]";

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

  return `local-docx-${Math.abs(hash)}`;
}

function isDocxFile(filePath) {
  return path.extname(filePath).toLowerCase() === ".docx";
}

class DocxKnowledgeConnector extends BaseKnowledgeConnector {
  constructor(config) {
    super({
      ...(config || {}),
      name: (config && config.name) || "DocxKnowledgeConnector",
      source: "Local DOCX"
    });
    this.folderPath = config && config.folderPath;
  }

  connect() {
    if (!this.folderPath) {
      throw new Error("DocxKnowledgeConnector requires config.folderPath.");
    }

    const resolvedPath = path.resolve(this.folderPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`DocxKnowledgeConnector folder not found: ${resolvedPath}`);
    }

    if (!fs.statSync(resolvedPath).isDirectory()) {
      throw new Error(`DocxKnowledgeConnector path is not a folder: ${resolvedPath}`);
    }

    this.folderPath = resolvedPath;
    this.connected = true;

    return this.getStatus();
  }

  disconnect() {
    this.connected = false;

    return this.getStatus();
  }

  fetchItems() {
    if (!this.isConnected()) {
      throw new Error("DocxKnowledgeConnector is not connected.");
    }

    return fs.readdirSync(this.folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(this.folderPath, entry.name))
      .filter(isDocxFile)
      .map((filePath) => {
        return {
          title: path.basename(filePath),
          content: DOCX_DETECTED_CONTENT,
          source: "Local DOCX",
          type: "DOCX"
        };
      });
  }

  normalizeItem(item) {
    const normalizedItem = {
      title: normalizeText(item.title),
      content: normalizeText(item.content || DOCX_DETECTED_CONTENT),
      source: "Local DOCX",
      type: "DOCX"
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

module.exports = DocxKnowledgeConnector;
