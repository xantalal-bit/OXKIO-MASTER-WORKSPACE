'use strict';

const form = document.getElementById('executiveChatForm');
const input = document.getElementById('queryInput');
const conversation = document.getElementById('conversation');

function clearEmptyState() {
  const emptyState = conversation.querySelector('.empty-state');

  if (emptyState) {
    emptyState.remove();
  }
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

function renderExchange(query, data) {
  clearEmptyState();

  const exchange = createElement('article', 'exchange');
  const questionGroup = createElement('div');
  const answerGroup = createElement('div');
  const confidenceGroup = createElement('div');
  const sourcesGroup = createElement('div');
  const limitationsGroup = createElement('div');

  questionGroup.appendChild(createElement('p', 'label', 'Pregunta'));
  questionGroup.appendChild(createElement('p', 'text', query));

  answerGroup.appendChild(createElement('p', 'label', 'Respuesta'));
  answerGroup.appendChild(createElement('p', 'text', data.response || 'Sin respuesta.'));

  confidenceGroup.appendChild(createElement('p', 'label', 'Confianza'));
  confidenceGroup.appendChild(createElement(
    'p',
    'text confidence',
    typeof data.confidence === 'number' ? String(data.confidence) : 'No disponible',
  ));

  sourcesGroup.appendChild(createElement('p', 'label', 'Fuentes'));
  sourcesGroup.appendChild(renderList(data.sources, 'Sin fuentes.'));

  limitationsGroup.appendChild(createElement('p', 'label', 'Limitaciones'));
  limitationsGroup.appendChild(renderList(data.limitations, 'Sin limitaciones.'));

  [
    questionGroup,
    answerGroup,
    confidenceGroup,
    sourcesGroup,
    limitationsGroup,
  ].forEach((group) => exchange.appendChild(group));

  conversation.prepend(exchange);
}

function setThinking(isThinking) {
  let status = conversation.querySelector('.status');

  if (isThinking) {
    clearEmptyState();

    if (!status) {
      status = createElement('p', 'status', 'Pensando...');
      conversation.prepend(status);
    }
  } else if (status) {
    status.remove();
  }

  form.querySelector('button').disabled = isThinking;
  input.disabled = isThinking;
}

function renderError(message) {
  clearEmptyState();
  conversation.prepend(createElement('p', 'error', message));
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
      body: JSON.stringify({ query }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No se pudo completar la consulta.');
    }

    renderExchange(query, data);
    input.value = '';
  } catch (error) {
    renderError(error.message || 'Error inesperado al consultar Executive Brain.');
  } finally {
    setThinking(false);
  }
});
