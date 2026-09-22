'use strict';

// V0.5: a minimal, ephemeral, in-memory store for short-term conversational
// context ("el mas importante", "el primero"...). This is NOT persistent
// memory (that remains the separate, permanent memory.searchMemory system)
// and NOT a new infrastructure dependency — a plain Map with a TTL and a
// size cap, lost on restart, which is an explicitly accepted tradeoff for
// V0.5. Every entry is bound to (uid, conversationId) together, never to
// conversationId alone, so one user can never read another user's context
// even if they guessed or reused a conversationId.
const DEFAULT_TTL_MS = 20 * 60 * 1000;
const DEFAULT_MAX_CONVERSATIONS = 200;
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function isValidConversationId(value) {
  return typeof value === 'string' && CONVERSATION_ID_PATTERN.test(value);
}

function isValidUid(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function createConversationContextStore({
  ttlMs = DEFAULT_TTL_MS,
  maxConversations = DEFAULT_MAX_CONVERSATIONS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map(); // key -> { uid, conversationId, data, expiresAt }

  function key(uid, conversationId) {
    return `${uid}::${conversationId}`;
  }

  function sweepExpired() {
    for (const [entryKey, record] of entries) {
      if (record.expiresAt <= now()) entries.delete(entryKey);
    }
  }

  function evictOldestIfOverCapacity() {
    while (entries.size > maxConversations) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  function get(uid, conversationId) {
    if (!isValidUid(uid) || !isValidConversationId(conversationId)) return null;
    const entryKey = key(uid, conversationId);
    const record = entries.get(entryKey);
    if (!record) return null;
    if (record.expiresAt <= now()) {
      entries.delete(entryKey);
      return null;
    }
    return record.data;
  }

  function save(uid, conversationId, data) {
    if (!isValidUid(uid) || !isValidConversationId(conversationId)) return false;
    sweepExpired();
    const entryKey = key(uid, conversationId);
    entries.delete(entryKey); // re-insert so Map order tracks recency for eviction
    entries.set(entryKey, { uid, conversationId, data, expiresAt: now() + ttlMs });
    evictOldestIfOverCapacity();
    return true;
  }

  function clear(uid, conversationId) {
    if (!isValidUid(uid) || !isValidConversationId(conversationId)) return;
    entries.delete(key(uid, conversationId));
  }

  function size() {
    return entries.size;
  }

  return Object.freeze({ get, save, clear, size, isValidConversationId, isValidUid });
}

module.exports = {
  createConversationContextStore,
  isValidConversationId,
  isValidUid,
};
