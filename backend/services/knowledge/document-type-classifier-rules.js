'use strict';

const DOCUMENT_TYPES = [
  'Governance',
  'Roadmap',
  'Documentation',
  'Learning',
  'Meeting',
  'Notes',
  'Email',
  'Generic',
];

const CLASSIFIER_RULES = [
  {
    type: 'Email',
    ruleId: 'email-headers',
    fields: ['headings', 'content'],
    keywords: ['from:', 'to:', 'subject:', 'cc:', 'bcc:', 'sent:', 'date:'],
    weight: 4,
    reason: 'Email header fields detected.',
  },
  {
    type: 'Email',
    ruleId: 'email-location-or-extension',
    fields: ['fileName', 'path', 'extension'],
    keywords: ['gmail', 'email', 'correo', '.eml', '.msg'],
    weight: 3,
    reason: 'Email source, location, or extension detected.',
  },
  {
    type: 'Roadmap',
    ruleId: 'roadmap-title-or-path',
    fields: ['fileName', 'path', 'headings'],
    keywords: ['roadmap', 'master-roadmap', 'backlog estrategico', 'milestone'],
    weight: 5,
    reason: 'Roadmap naming or title detected.',
  },
  {
    type: 'Roadmap',
    ruleId: 'roadmap-structure',
    fields: ['headings', 'content'],
    keywords: ['fase ', 'phase ', 'estado:', 'pendiente', 'en curso', 'milestones'],
    weight: 2,
    reason: 'Roadmap planning structure detected.',
  },
  {
    type: 'Learning',
    ruleId: 'learning-source',
    fields: ['fileName', 'path', 'headings', 'content'],
    keywords: ['learning heroes', 'learning-heroes', 'curso', 'modulo', 'leccion', 'lesson', 'training'],
    weight: 4,
    reason: 'Learning source or training terminology detected.',
  },
  {
    type: 'Governance',
    ruleId: 'governance-location',
    fields: ['fileName', 'path', 'headings'],
    keywords: ['governance', 'gobierno', '00_governance', 'policy', 'standard', 'registry'],
    weight: 4,
    reason: 'Governance naming or location detected.',
  },
  {
    type: 'Governance',
    ruleId: 'governance-structure',
    fields: ['headings', 'content'],
    keywords: ['regla', 'principio', 'decision registry', 'compatibilidad', 'estandar', 'aprobacion'],
    weight: 2,
    reason: 'Governance structure or control terminology detected.',
  },
  {
    type: 'Meeting',
    ruleId: 'meeting-structure',
    fields: ['fileName', 'path', 'headings', 'content'],
    keywords: ['meeting', 'reunion', 'acta', 'minutes', 'asistentes', 'agenda', 'action items'],
    weight: 4,
    reason: 'Meeting structure detected.',
  },
  {
    type: 'Documentation',
    ruleId: 'documentation-naming',
    fields: ['fileName', 'path', 'headings'],
    keywords: ['documentation', 'documentacion', 'docs', 'readme', 'quickstart', 'manual', 'guide', 'guia'],
    weight: 3,
    reason: 'Documentation naming detected.',
  },
  {
    type: 'Documentation',
    ruleId: 'documentation-structure',
    fields: ['headings', 'content'],
    keywords: ['instalacion', 'usage', 'uso', 'api', 'configuracion', 'ejemplo'],
    weight: 2,
    reason: 'Documentation structure detected.',
  },
  {
    type: 'Notes',
    ruleId: 'notes-naming-or-structure',
    fields: ['fileName', 'path', 'headings', 'content'],
    keywords: ['notes', 'nota', 'notas', 'apuntes', 'ideas sueltas', 'draft', 'borrador'],
    weight: 3,
    reason: 'Notes naming or informal structure detected.',
  },
];

module.exports = {
  DOCUMENT_TYPES,
  CLASSIFIER_RULES,
};
