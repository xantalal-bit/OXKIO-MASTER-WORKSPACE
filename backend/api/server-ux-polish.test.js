'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appPath = path.join(__dirname, '..', '..', 'app');
const entry = fs.readFileSync(path.join(appPath, 'index.html'), 'utf8');

test('written queries never trigger automatic TTS by default', () => {
  assert.match(entry, /window\.enviarChatTexto = async function\(\) \{[\s\S]*?await procesarComandoVoz\(texto\);/);
  assert.doesNotMatch(
    entry.match(/window\.enviarChatTexto = async function\(\)[\s\S]*?\};/)[0],
    /procesarComandoVoz\(texto,\s*true\)/,
  );
  assert.match(entry, /if \(porVoz \|\| responderConVoz\) hablarTexto\(data\.response\);/);
});

test('a voice-initiated query is allowed to answer by voice', () => {
  assert.match(entry, /await procesarComandoVoz\(texto, true\);/);
  assert.match(entry, /async function procesarComandoVoz\(textoOriginal, porVoz = false\)/);
});

test('the "Responder con voz" toggle exists, defaults off, and flips the session preference', () => {
  assert.match(entry, /id="voiceReplyToggle"[^>]*aria-pressed="false"/);
  assert.match(entry, />Responder con voz</);
  assert.match(entry, /let responderConVoz = false;/);
  assert.match(entry, /window\.toggleVoiceReply = function\(\) \{ responderConVoz = !responderConVoz; actualizarToggleVoz\(\); \};/);
  assert.doesNotMatch(entry, /localStorage|sessionStorage/);
});

test('"Te escucho." is never shown as a chat bubble when starting to listen', () => {
  assert.doesNotMatch(entry, /setOxkioRespuesta\("Te escucho\."\)/);
  assert.match(entry, /setEstadoVoz\("Escuchando\.\.\.", true\); setOxkioAvatarState\("listening"\);/);
});

test('the recognized transcript is never repeated as "Oido: <texto>"', () => {
  assert.doesNotMatch(entry, /Oído: \$\{texto\}/);
  assert.match(entry, /setEstadoVoz\("Procesando\.\.\.", false\); appendChatMessage\("user", texto\);/);
});

test('confidence labels never reach the visible chat bubble (they stay in the hidden diagnostic panel)', () => {
  // data.response is exactly what reaches the chat bubble and TTS; the
  // backend (executive-orchestrator.js) is responsible for stripping any
  // "Confianza alta/media/baja." suffix from it before it gets here, and
  // that contract is covered by executive-orchestrator.test.js. Here we
  // only confirm the frontend passes it through unmodified, and that the
  // one place "Confianza:" is still built (the #sugerencia diagnostic
  // panel) stays inside #avanzadoPanel, never inside the chat bubble path.
  assert.match(entry, /appendChatMessage\('oxkio', data\.response\);/);
  assert.doesNotMatch(entry, /appendChatMessage\('oxkio', `.*Confianza/);
  const avanzadoStart = entry.indexOf('<div id="avanzadoPanel"');
  const sugerenciaIndex = entry.indexOf('id="sugerenciaCard"');
  assert.ok(avanzadoStart >= 0 && sugerenciaIndex > avanzadoStart);
});

test('the password field has a working show/hide toggle that never logs the value', () => {
  assert.match(entry, /<div class="password-field">[\s\S]*?<input id="password" type="password"[\s\S]*?<button type="button" id="togglePasswordBtn"/);
  assert.match(entry, /window\.togglePasswordVisibility = function\(\)/);
  assert.match(entry, /input\.type = showing \? "password" : "text";/);
  assert.doesNotMatch(entry, /console\.[a-z]+\([^)]*password/i);
});

test('the greeting only uses a real Firebase displayName, never an email-derived name', () => {
  assert.match(entry, /currentUser && typeof currentUser\.displayName === "string"/);
  assert.doesNotMatch(entry, /currentUser\.email\.split\("@"\)/);
});
