'use strict';

const path = require('path');
const { CLASSIFIER_RULES, DOCUMENT_TYPES } = require('./document-type-classifier-rules');

const supportedTypes = new Set(DOCUMENT_TYPES);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractRawContent(document, knowledgeObject) {
  if (knowledgeObject && knowledgeObject.content && typeof knowledgeObject.content.raw === 'string') {
    return knowledgeObject.content.raw;
  }

  if (document && typeof document.content === 'string') {
    return document.content;
  }

  if (typeof knowledgeObject === 'string') {
    return knowledgeObject;
  }

  return '';
}

function extractHeadings(rawContent) {
  if (!rawContent) {
    return [];
  }

  return rawContent
    .split(/\r?\n/)
    .map((line) => {
      const markdownHeading = line.match(/^\s*#{1,6}\s+(.+)$/);

      if (markdownHeading) {
        return markdownHeading[1].trim();
      }

      const plainHeading = line.match(/^\s*([A-Z0-9][A-Z0-9 _:-]{5,})\s*$/);

      return plainHeading ? plainHeading[1].trim() : null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function buildSignals(document, knowledgeObject) {
  const identity = knowledgeObject && knowledgeObject.identity ? knowledgeObject.identity : {};
  const rawContent = extractRawContent(document, knowledgeObject);
  const filePath = document && document.path ? document.path : identity.path;
  const fileName = document && document.name ? document.name : identity.name || (filePath ? path.basename(filePath) : '');
  const extension = document && document.extension ? document.extension : identity.extension || path.extname(fileName);
  const headings = extractHeadings(rawContent);

  return {
    fileName: normalizeText(fileName),
    path: normalizeText(filePath),
    extension: normalizeText(extension),
    headings: normalizeText(headings.join('\n')),
    content: normalizeText(rawContent.slice(0, 6000)),
    raw: {
      fileName: fileName || null,
      path: filePath || null,
      extension: extension || null,
      headings,
    },
  };
}

function getRuleMatches(rule, signals) {
  const matches = [];

  rule.fields.forEach((field) => {
    const signalValue = signals[field] || '';

    rule.keywords.forEach((keyword) => {
      const normalizedKeyword = normalizeText(keyword);

      if (normalizedKeyword && signalValue.includes(normalizedKeyword)) {
        matches.push({
          field,
          keyword,
        });
      }
    });
  });

  return matches;
}

function calculateConfidence(score, secondScore) {
  if (score <= 0) {
    return 0.2;
  }

  const separation = Math.max(score - secondScore, 0);
  const confidence = 0.35 + Math.min(score, 10) * 0.05 + Math.min(separation, 5) * 0.02;

  return Number(Math.min(confidence, 0.95).toFixed(2));
}

function classifyDocumentType(document, knowledgeObject) {
  const signals = buildSignals(document, knowledgeObject);
  const scores = {};
  const reasonsByType = {};
  const signalMatches = [];

  DOCUMENT_TYPES.forEach((type) => {
    scores[type] = 0;
    reasonsByType[type] = [];
  });

  CLASSIFIER_RULES.forEach((rule) => {
    if (!supportedTypes.has(rule.type)) {
      return;
    }

    const matches = getRuleMatches(rule, signals);

    if (matches.length === 0) {
      return;
    }

    scores[rule.type] += rule.weight * matches.length;
    reasonsByType[rule.type].push({
      ruleId: rule.ruleId,
      reason: rule.reason,
      weight: rule.weight,
      matches,
    });
    signalMatches.push({
      type: rule.type,
      ruleId: rule.ruleId,
      matches,
    });
  });

  const rankedTypes = DOCUMENT_TYPES
    .filter((type) => type !== 'Generic')
    .sort((left, right) => scores[right] - scores[left]);
  const type = scores[rankedTypes[0]] > 0 ? rankedTypes[0] : 'Generic';
  const secondScore = rankedTypes.length > 1 ? scores[rankedTypes[1]] : 0;

  return {
    type,
    confidence: calculateConfidence(scores[type], secondScore),
    reasons: type === 'Generic'
      ? [{ ruleId: 'generic-fallback', reason: 'No clear deterministic document type signals detected.' }]
      : reasonsByType[type],
    signals: {
      fileName: signals.raw.fileName,
      path: signals.raw.path,
      extension: signals.raw.extension,
      headings: signals.raw.headings,
      matches: signalMatches.filter((match) => match.type === type),
      scores,
    },
  };
}

module.exports = {
  classifyDocumentType,
};
