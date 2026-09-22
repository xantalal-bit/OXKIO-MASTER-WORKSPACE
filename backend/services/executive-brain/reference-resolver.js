'use strict';

// V0.5 FASE 5: resolves natural-language references to items shown in a
// previous turn ("el primero", "el mas importante", "ese correo",
// "respondele"...) against the short-term context saved by
// conversation-context-store.js. This never guesses: if the query clearly
// contains reference language but nothing resolves cleanly, it reports
// ambiguous=true so the caller can ask instead of assuming.
function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ORDINAL_INDEX = Object.freeze({
  primero: 0, primera: 0, segundo: 1, segunda: 1, tercero: 2, tercera: 2,
});

function resolveOrdinal(normalizedQuery, list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const [word, index] of Object.entries(ORDINAL_INDEX)) {
    if (new RegExp(`\\b${word}\\b`).test(normalizedQuery)) {
      return list[index] || null;
    }
  }
  if (/\bultimo\b|\bultima\b/.test(normalizedQuery)) {
    return list[list.length - 1] || null;
  }
  if (/\banterior\b/.test(normalizedQuery)) {
    return list.length > 1 ? list[list.length - 2] : list[list.length - 1];
  }
  return null;
}

function resolveMostImportant(normalizedQuery, list) {
  if (!/\bmas importante\b/.test(normalizedQuery)) return null;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((item) => item && item.important === true) || list[0];
}

function resolveFromSelection(normalizedQuery, selection, list) {
  if (!selection || !selection.ref) return null;
  if (!/\brespondele\b|\bcontestale\b|\bhazlo\b|\bcon ese\b|\bcon esa\b/.test(normalizedQuery)) return null;
  return (Array.isArray(list) ? list : []).find((item) => item && item.ref === selection.ref) || null;
}

function resolveDemonstrative(normalizedQuery, selection, list) {
  if (!/\bese\b|\besa\b|\beste\b|\besta\b|\beso\b/.test(normalizedQuery)) return null;
  if (selection && selection.ref) {
    const match = (Array.isArray(list) ? list : []).find((item) => item && item.ref === selection.ref);
    if (match) return match;
  }
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

const REFERENCE_LANGUAGE_PATTERN = /\bese\b|\besa\b|\beste\b|\besta\b|\beso\b|\bprimero\b|\bprimera\b|\bsegundo\b|\bsegunda\b|\btercero\b|\btercera\b|\bultimo\b|\bultima\b|\banterior\b|\bmas importante\b|\brespondele\b|\bcontestale\b|\bhazlo\b/;

// entities: the conversation context's entities[listKey] array (e.g.
// entities.messages), each item shaped { ref, ...safe fields }.
// selection: the conversation context's last explicit selection, if any.
function resolveReference(query, { entities, selection } = {}) {
  const normalizedQuery = normalize(query);
  const list = Array.isArray(entities) ? entities : [];

  const bySelection = resolveFromSelection(normalizedQuery, selection, list);
  if (bySelection) return { resolved: true, item: bySelection, via: 'selection' };

  const byMostImportant = resolveMostImportant(normalizedQuery, list);
  if (byMostImportant) return { resolved: true, item: byMostImportant, via: 'most_important' };

  const byOrdinal = resolveOrdinal(normalizedQuery, list);
  if (byOrdinal) return { resolved: true, item: byOrdinal, via: 'ordinal' };

  const byDemonstrative = resolveDemonstrative(normalizedQuery, selection, list);
  if (byDemonstrative) return { resolved: true, item: byDemonstrative, via: 'demonstrative' };

  if (REFERENCE_LANGUAGE_PATTERN.test(normalizedQuery)) {
    // Reference language is present ("el mas importante", "ese correo"...)
    // but nothing resolved cleanly — including the case where there is no
    // recent list at all. Either way this must never be guessed.
    return { resolved: false, ambiguous: true };
  }

  return { resolved: false, ambiguous: false };
}

module.exports = { resolveReference, normalize };
