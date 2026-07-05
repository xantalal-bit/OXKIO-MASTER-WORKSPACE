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
const PRIVATE_CONTEXT_IDENTITY = {
  clientId: 'cliente-cero',
  userId: 'usuario-cliente-cero',
  expectedClientId: 'cliente-cero',
};

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

function getPrivateIdentity() {
  return {
    ...PRIVATE_CONTEXT_IDENTITY,
    authorization: {
      status: 'granted',
      provider: 'google-oauth',
    },
  };
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

updatePrivateContextStatus();
