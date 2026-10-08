'use strict';
const { classifyMailSignals } = require('../private-context/mail-priority');
const { freeze } = require('./scope-session');
// Local, deterministic analysis of the person's own sources (06/10/2026,
// third real Cliente Cero mission). It is what data.analyze does when no
// reasoning resource may receive the content (Privacy Gate): nothing leaves
// OXKIO. It reuses the Executive Chat mail classification over the signals the
// sources already return, plus how close each agenda event is. Its output holds
// only item ids and fixed codes, never text: the answer is written from the
// cited items themselves, so the analysis cannot add a fact of its own.
const LEVEL_ORDER = { urgent: 0, important: 1, review: 2, informational: 3, noise: 4 };
// Unread alone means "pending review", never "do this first" (08/10/2026,
// fourth real mission: an unread Google Play notification became the first
// action). Such mail is listed in review, by id, and never in priorities.
const REASONS = ['important_unread', 'starred_unread', 'today_event', 'important', 'starred'];
const WHEN = ['today', 'tomorrow', 'upcoming'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value, size = 2) => String(value).padStart(size, '0');
const localDay = date => { const d = new Date(date); return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const nextDay = day => { const [y, m, d] = day.split('-').map(Number); return localDay(new Date(y, m - 1, d + 1)); };

function mailReason(signals, level) {
 if (level === 'urgent') return signals.important ? 'important_unread' : 'starred_unread';
 return signals.important ? 'important' : 'starred';
}

// items: the data.analyze input (each with a unique id). now: a Date or ISO string.
function analyzePrivateItems(items, { now }) {
 const today = localDay(now); const tomorrow = nextDay(today); const nowMs = Date.parse(new Date(now).toISOString());
 const mail = []; const events = []; const notes = [];
 for (const item of items) {
  const s = item.signals;
  if (s && s.type === 'mail') mail.push({ item, level: classifyMailSignals(s) });
  else if (s && s.type === 'calendar' && s.start) events.push(item);
  else notes.push(item.id);
 }
 // Most relevant level first; within a level, the most recent message first.
 mail.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || String(b.item.signals.date || '').localeCompare(String(a.item.signals.date || '')));
 const dated = events.map(item => {
  const { start, allDay } = item.signals; const timed = !allDay && !DATE_ONLY.test(start);
  const day = DATE_ONLY.test(start) ? start : localDay(start);
  return { item, timed, when: day < today ? 'past' : day === today ? 'today' : day === tomorrow ? 'tomorrow' : 'upcoming' };
 }).filter(e => e.when !== 'past').sort((a, b) => String(a.item.signals.start).localeCompare(String(b.item.signals.start)));
 // A timed event still ahead today is a commitment of today; an all-day one
 // (a birthday) or one of another day is context, never today's first action.
 const ahead = e => e.when === 'today' && e.timed && Date.parse(e.item.signals.start) >= nowMs - 60 * 60 * 1000;
 const asMail = m => ({ itemId: m.item.id, kind: 'mail', reason: mailReason(m.item.signals, m.level) });
 const priorities = [
  ...mail.filter(m => m.level === 'urgent').map(asMail),
  ...dated.filter(ahead).map(e => ({ itemId: e.item.id, kind: 'event', reason: 'today_event' })),
  ...mail.filter(m => m.level === 'important').map(asMail),
 ];
 return freeze({
  analyzedLocally: true,
  priorities: freeze(priorities.map(freeze)),
  firstAction: priorities.length ? freeze({ itemId: priorities[0].itemId, reason: priorities[0].reason }) : null,
  review: freeze(mail.filter(m => m.level === 'review').map(m => m.item.id)),
  context: freeze(dated.filter(e => !ahead(e)).map(e => freeze({ itemId: e.item.id, when: e.when }))),
  noise: freeze(mail.filter(m => m.level === 'noise').map(m => m.item.id)),
  informational: freeze(mail.filter(m => m.level === 'informational').map(m => m.item.id)),
  notes: freeze(notes),
 });
}

// The local analysis never certifies itself. Exactly these keys and codes;
// every cited id is an input item, cited once; the first action is the first
// priority, or explicitly none when there is no actionable priority.
function verifyLocalAnalysis(analysis, items) {
 const ids = new Set(items.map(item => item.id)); const cited = new Set();
 const fail = code => freeze({ verified: false, code });
 const cite = id => { if (typeof id !== 'string' || !ids.has(id) || cited.has(id)) return false; cited.add(id); return true; };
 if (!analysis || typeof analysis !== 'object' || analysis.analyzedLocally !== true) return fail('local_analysis_missing');
 if (Object.keys(analysis).sort().join() !== 'analyzedLocally,context,firstAction,informational,noise,notes,priorities,review') return fail('local_analysis_shape');
 if (![analysis.priorities, analysis.review, analysis.context, analysis.noise, analysis.informational, analysis.notes].every(Array.isArray)) return fail('local_analysis_shape');
 for (const p of analysis.priorities) if (!p || Object.keys(p).sort().join() !== 'itemId,kind,reason' || !['mail', 'event'].includes(p.kind) || !REASONS.includes(p.reason) || !cite(p.itemId)) return fail('local_analysis_priority_invalid');
 for (const c of analysis.context) if (!c || Object.keys(c).sort().join() !== 'itemId,when' || !WHEN.includes(c.when) || !cite(c.itemId)) return fail('local_analysis_context_invalid');
 for (const id of [...analysis.review, ...analysis.noise, ...analysis.informational, ...analysis.notes]) if (!cite(id)) return fail('local_analysis_reference_invalid');
 const first = analysis.firstAction; const top = analysis.priorities[0];
 if (first === null ? top !== undefined : !top || first.itemId !== top.itemId || first.reason !== top.reason || Object.keys(first).sort().join() !== 'itemId,reason') return fail('local_analysis_first_action_invalid');
 return freeze({ verified: true });
}

module.exports = { analyzePrivateItems, verifyLocalAnalysis };
