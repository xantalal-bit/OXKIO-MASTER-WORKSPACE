'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDocumentType } = require('./document-type-classifier');

function classifyFixture(document, raw) {
  return classifyDocumentType(document, {
    identity: {
      path: document.path,
      name: document.name,
      extension: document.extension,
      version: '2.0',
    },
    content: {
      raw,
      summary: null,
      keywords: [],
    },
    metadata: {},
  });
}

test('classifies governance documents as Governance', () => {
  const result = classifyFixture({
    name: 'KNOWLEDGE_OBJECT_STANDARD.md',
    path: 'XANTALAL/00_GOVERNANCE/KNOWLEDGE_OBJECT_STANDARD.md',
    extension: '.md',
  }, '# Knowledge Object Standard\n\n## Regla de compatibilidad\n\nDecision Registry.');

  assert.equal(result.type, 'Governance');
  assert.ok(result.confidence > 0.2);
  assert.ok(result.reasons.length > 0);
  assert.ok(result.signals.matches.length > 0);
});

test('classifies roadmap documents as Roadmap', () => {
  const result = classifyFixture({
    name: 'MASTER-ROADMAP-XANTALAL.md',
    path: 'XANTALAL/00_GOVERNANCE/MASTER-ROADMAP-XANTALAL.md',
    extension: '.md',
  }, '# Master Roadmap Xantalal\n\n## Fase 1\n\nEstado: EN CURSO');

  assert.equal(result.type, 'Roadmap');
});

test('classifies Learning Heroes documents as Learning', () => {
  const result = classifyFixture({
    name: 'learning-heroes-module-01.txt',
    path: 'exports/learning-heroes/module-01.txt',
    extension: '.txt',
  }, '# Curso Learning Heroes\n\nLesson notes and training material.');

  assert.equal(result.type, 'Learning');
});

test('classifies email-like text as Email', () => {
  const result = classifyFixture({
    name: 'message.txt',
    path: 'gmail/inbox/message.txt',
    extension: '.txt',
  }, 'From: ana@example.com\nTo: jose@example.com\nSubject: Reunion\n\nHola.');

  assert.equal(result.type, 'Email');
});

test('falls back to Generic without clear signals', () => {
  const result = classifyFixture({
    name: 'file.bin',
    path: 'misc/file.bin',
    extension: '.bin',
  }, 'Unstructured content without any meaningful classification hints.');

  assert.equal(result.type, 'Generic');
  assert.equal(result.confidence, 0.2);
});
