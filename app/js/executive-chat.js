'use strict';

const form = document.getElementById('executiveChatForm');
const input = document.getElementById('queryInput');
const conversation = document.getElementById('conversation');
const newConversationButton = document.getElementById('newConversationButton');
const calendarEnabled = document.getElementById('calendarEnabled');
const gmailEnabled = document.getElementById('gmailEnabled');
const calendarRange = document.getElementById('calendarRange');
const gmailMaxMessages = document.getElementById('gmailMaxMessages');
const privateContextStatus = document.getElementById('privateContextStatus');
const privateContextDetails = document.getElementById('privateContextDetails');
const askButton = document.getElementById('askButton');
const voiceButton = document.querySelector('.voice-button');
const PRIVATE_CONTEXT_IDENTITY = {
  clientId: 'cliente-cero',
  userId: 'usuario-cliente-cero',
  expectedClientId: 'cliente-cero',
};
let loadedPrivateIdentity = null;
let voiceRecognition = null;
let isVoiceListening = false;

function scrollToLatestMessage(target = conversation.lastElementChild) {
  window.requestAnimationFrame(() => {
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }

    conversation.scrollTop = conversation.scrollHeight;
  });
}

function clearEmptyState() {
  const emptyState = conversation.querySelector('.empty-state');

  if (emptyState) {
    emptyState.remove();
  }
}

function renderEmptyState() {
  conversation.innerHTML = '';
  const emptyState = createElement('div', 'empty-state');

  emptyState.appendChild(createElement('p', 'empty-title', 'Hola, soy Oxkio.'));
  emptyState.appendChild(createElement(
    'p',
    null,
    'Pregunta por tu agenda, correo o siguiente prioridad. Si necesitas datos privados, activa el contexto antes de enviar.',
  ));
  conversation.appendChild(emptyState);
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (typeof text === 'string') {
    element.textContent = text;
  }

  return element;
}

function renderList(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) {
    return createElement('p', 'text', emptyText);
  }

  const list = createElement('ul', 'meta-list');

  items.forEach((item) => {
    const label = typeof item === 'string'
      ? item
      : [item.name, item.type, item.path].filter(Boolean).join(' | ');
    const listItem = createElement('li', null, label || 'Sin detalle');

    list.appendChild(listItem);
  });

  return list;
}

function getConfidenceLabel(confidence) {
  if (typeof confidence !== 'number') {
    return null;
  }

  if (confidence >= 0.8) {
    return 'Confianza alta';
  }

  if (confidence >= 0.5) {
    return 'Confianza media';
  }

  return 'Confianza baja';
}

function appendMetadataGroup(exchange, title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const details = createElement('details', 'message-details');
  const summary = createElement('summary', null, title);

  details.appendChild(summary);
  details.appendChild(renderList(items, ''));
  exchange.appendChild(details);
}

function renderExchange(query, data) {
  clearEmptyState();

  conversation.querySelectorAll('.exchange').forEach((item) => {
    item.classList.remove('is-latest');
    item.classList.add('is-past');
  });

  const exchange = createElement('article', 'exchange is-latest');
  const userMessage = createElement('div', 'message user-message');
  const assistantMessage = createElement('div', 'message assistant-message');
  const confidenceLabel = getConfidenceLabel(data.confidence);

  userMessage.appendChild(createElement('p', 'message-text', query));
  assistantMessage.appendChild(createElement('p', 'message-text', data.response || 'Sin respuesta.'));

  if (confidenceLabel) {
    assistantMessage.appendChild(createElement('p', 'message-meta', confidenceLabel));
  }

  exchange.appendChild(userMessage);
  exchange.appendChild(assistantMessage);
  appendMetadataGroup(exchange, 'Fuentes', data.sources);
  appendMetadataGroup(exchange, 'Limitaciones', data.limitations);

  conversation.appendChild(exchange);
  scrollToLatestMessage(exchange);
}

function setThinking(isThinking) {
  let status = conversation.querySelector('.status');

  if (isThinking) {
    clearEmptyState();

    if (!status) {
      status = createElement('p', 'status', 'Pensando...');
      conversation.appendChild(status);
      scrollToLatestMessage();
    }
  } else if (status) {
    status.remove();
  }

  askButton.disabled = isThinking;
  input.disabled = isThinking;
}

function renderError(message) {
  clearEmptyState();
  conversation.appendChild(createElement('p', 'error', message));
  scrollToLatestMessage();
}

function setVoiceButtonState(state) {
  if (!voiceButton) {
    return;
  }

  voiceButton.classList.remove('is-listening', 'is-processing');
  voiceButton.dataset.voiceState = state;

  if (state === 'listening') {
    voiceButton.classList.add('is-listening');
    voiceButton.dataset.voiceLabel = 'Escuchando';
    voiceButton.title = 'Detener voz';
    voiceButton.setAttribute('aria-label', 'Detener voz');
    return;
  }

  if (state === 'processing') {
    voiceButton.classList.add('is-processing');
    voiceButton.dataset.voiceLabel = 'Procesando';
    voiceButton.title = 'Procesando voz';
    voiceButton.setAttribute('aria-label', 'Procesando voz');
    return;
  }

  voiceButton.dataset.voiceLabel = '';
  voiceButton.title = 'Voz';
  voiceButton.setAttribute('aria-label', 'Voz');
}

function getVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return null;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  return recognition;
}

function normalizeVoiceTranscript(text) {
  return String(text || '').replace(/\b(oxio|oskio|ostio|hostio|oxkio)\b/gi, 'Oxkio');
}

function insertVoiceTranscript(transcript) {
  const text = normalizeVoiceTranscript(transcript).trim();

  if (!text) {
    return;
  }

  input.value = input.value.trim()
    ? `${input.value.trim()} ${text}`
    : text;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function stopVoiceInput() {
  if (voiceRecognition && isVoiceListening) {
    voiceRecognition.stop();
  }
}

function startVoiceInput() {
  const recognition = getVoiceRecognition();
  let didReceiveResult = false;
  let didFail = false;

  if (!recognition) {
    renderError('La voz no esta disponible en este navegador.');
    return;
  }

  voiceRecognition = recognition;

  recognition.onstart = () => {
    isVoiceListening = true;
    setVoiceButtonState('listening');
  };

  recognition.onresult = (event) => {
    didReceiveResult = true;
    setVoiceButtonState('processing');

    const result = event.results && event.results[0] && event.results[0][0];

    insertVoiceTranscript(result && result.transcript);
  };

  recognition.onerror = (event) => {
    didFail = true;

    if (event && event.error === 'not-allowed') {
      renderError('Permiso de microfono denegado.');
      return;
    }

    if (event && event.error === 'no-speech') {
      renderError('No he detectado voz. Intentalo de nuevo.');
      return;
    }

    if (event && event.error !== 'aborted') {
      renderError('No he podido transcribir la voz.');
    }
  };

  recognition.onend = () => {
    isVoiceListening = false;
    voiceRecognition = null;
    setVoiceButtonState('normal');

    if (!didReceiveResult && !didFail) {
      input.focus();
    }
  };

  try {
    recognition.start();
  } catch (error) {
    isVoiceListening = false;
    voiceRecognition = null;
    setVoiceButtonState('normal');
    renderError('No he podido iniciar la voz.');
  }
}

function toggleVoiceInput() {
  if (isVoiceListening) {
    stopVoiceInput();
    return;
  }

  startVoiceInput();
}

function isValidExecutiveIdentityPayload(data) {
  const identity = data && data.identity;
  const authorization = identity && identity.authorization;

  return data && data.ok === true
    && identity
    && typeof identity.clientId === 'string'
    && typeof identity.userId === 'string'
    && typeof identity.expectedClientId === 'string'
    && authorization
    && authorization.status === 'granted'
    && authorization.provider === 'google-oauth';
}

function copyPrivateIdentity(identity) {
  return {
    clientId: identity.clientId,
    userId: identity.userId,
    expectedClientId: identity.expectedClientId,
    authorization: {
      status: identity.authorization.status,
      provider: identity.authorization.provider,
    },
  };
}

async function loadExecutiveIdentity() {
  try {
    const response = await fetch('/api/executive/identity');

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    if (!isValidExecutiveIdentityPayload(data)) {
      return;
    }

    loadedPrivateIdentity = copyPrivateIdentity(data.identity);
  } catch (error) {
    loadedPrivateIdentity = null;
  }
}

function getPrivateIdentity() {
  if (loadedPrivateIdentity) {
    return copyPrivateIdentity(loadedPrivateIdentity);
  }

  return copyPrivateIdentity({
    ...PRIVATE_CONTEXT_IDENTITY,
    authorization: {
      status: 'granted',
      provider: 'google-oauth',
    },
  });
}

function clampGmailMaxMessages(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 3;
  }

  return Math.min(Math.max(parsed, 1), 10);
}

function buildExecutiveChatPayload(query) {
  const payload = { query };
  const useCalendar = calendarEnabled.checked;
  const useGmail = gmailEnabled.checked;

  if (!useCalendar && !useGmail) {
    return payload;
  }

  const privateIdentity = getPrivateIdentity();

  if (useCalendar) {
    payload.calendar = {
      enabled: true,
      ...privateIdentity,
      range: calendarRange.value,
      maxResults: 10,
    };
  }

  if (useGmail) {
    payload.gmail = {
      enabled: true,
      ...privateIdentity,
      maxMessages: clampGmailMaxMessages(gmailMaxMessages.value),
    };
  }

  return payload;
}

function updatePrivateContextStatus() {
  const useCalendar = calendarEnabled.checked;
  const useGmail = gmailEnabled.checked;

  if (useCalendar && useGmail) {
    privateContextStatus.textContent = 'Agenda + Correo';
    return;
  }

  if (useCalendar) {
    privateContextStatus.textContent = 'Agenda';
    return;
  }

  if (useGmail) {
    privateContextStatus.textContent = 'Correo';
    return;
  }

  privateContextStatus.textContent = 'Privado desactivado';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const query = input.value.trim();

  if (!query) {
    renderError('Escribe una consulta antes de preguntar.');
    return;
  }

  setThinking(true);

  try {
    const response = await fetch('/api/executive/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildExecutiveChatPayload(query)),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No se pudo completar la consulta.');
    }

    renderExchange(query, data);
    privateContextDetails.open = false;
    input.value = '';
  } catch (error) {
    renderError(error.message || 'Error inesperado al consultar Executive Brain.');
  } finally {
    setThinking(false);
  }
});

newConversationButton.addEventListener('click', () => {
  renderEmptyState();
  input.value = '';
  input.focus();
});

[calendarEnabled, gmailEnabled].forEach((control) => {
  control.addEventListener('change', updatePrivateContextStatus);
});

if (voiceButton) {
  voiceButton.addEventListener('click', toggleVoiceInput);
  setVoiceButtonState('normal');
}

updatePrivateContextStatus();
loadExecutiveIdentity();
