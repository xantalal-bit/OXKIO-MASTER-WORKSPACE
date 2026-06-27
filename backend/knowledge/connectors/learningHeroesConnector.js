// OXKIO LEARNING HEROES CONNECTOR V1

const fs = require("fs");
const path = require("path");
const BaseKnowledgeConnector = require("../baseKnowledgeConnector");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => normalizeText(tag)).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((tag) => normalizeText(tag)).filter(Boolean);
  }

  return [];
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

  return `learning-heroes-${Math.abs(hash)}`;
}

class LearningHeroesConnector extends BaseKnowledgeConnector {
  constructor(config) {
    super({
      ...(config || {}),
      name: (config && config.name) || "LearningHeroesConnector",
      source: "Learning Heroes"
    });
    this.filePath = config && config.filePath;
  }

  connect() {
    if (!this.filePath) {
      throw new Error("LearningHeroesConnector requires config.filePath.");
    }

    const resolvedPath = path.resolve(this.filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`LearningHeroesConnector file not found: ${resolvedPath}`);
    }

    this.filePath = resolvedPath;
    this.connected = true;

    return this.getStatus();
  }

  disconnect() {
    this.connected = false;

    return this.getStatus();
  }

  fetchItems() {
    if (!this.isConnected()) {
      throw new Error("LearningHeroesConnector is not connected.");
    }

    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    const items = Array.isArray(data) ? data : data.items;

    if (!Array.isArray(items)) {
      return [];
    }

    return items.map((item) => {
      return {
        title: normalizeText(item.title || item.name),
        content: normalizeText(item.content || item.description || item.summary),
        source: "Learning Heroes",
        type: "COURSE"
      };
    });
  }

  normalizeItem(item) {
    const normalizedItem = {
      title: normalizeText(item.title || item.name),
      content: normalizeText(item.content || item.description || item.summary),
      source: "Learning Heroes",
      type: "COURSE"
    };
    const timestamp = new Date().toISOString();

    return {
      id: item.id || createId(normalizedItem),
      title: normalizedItem.title,
      source: normalizedItem.source,
      type: normalizedItem.type,
      content: normalizedItem.content,
      summary: normalizeText(item.summary),
      tags: normalizeTags(item.tags),
      classification: normalizeText(item.classification || "GENERAL"),
      createdAt: item.createdAt || timestamp,
      updatedAt: item.updatedAt || timestamp
    };
  }
}

module.exports = LearningHeroesConnector;
