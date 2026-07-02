'use strict';

const statusText = document.getElementById('statusText');
const executiveSummary = document.getElementById('executiveSummary');
const recommendation = document.getElementById('recommendation');
const confidence = document.getElementById('confidence');
const sourcesList = document.getElementById('sourcesList');

const BUSINESS_HUNTER_QUERY = 'Resumen ejecutivo de Business Hunter';

function setStatus(message) {
  statusText.textContent = message;
}

function setLoadingState(isLoading) {
  if (isLoading) {
    setStatus('Pensando...');
    executiveSummary.textContent = 'Cargando datos...';
    recommendation.textContent = 'Cargando datos...';
    confidence.textContent = '--';
    sourcesList.innerHTML = '<li>Cargando datos...</li>';
    return;
  }

  setStatus('Resumen actualizado.');
}

function renderSources(sources) {
  sourcesList.innerHTML = '';

  if (!Array.isArray(sources) || sources.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.textContent = 'Sin fuentes disponibles.';
    sourcesList.appendChild(emptyItem);
    return;
  }

  sources.forEach((source) => {
    const item = document.createElement('li');
    const parts = [
      source.name || source.id || 'Fuente desconocida',
      source.type ? `(${source.type})` : null,
      Number.isFinite(source.score) ? `score ${source.score}` : null,
    ].filter(Boolean);

    item.textContent = parts.join(' - ');
    sourcesList.appendChild(item);
  });
}

function renderDashboard(data) {
  executiveSummary.textContent = data.executiveSummary || data.response || 'Sin resumen disponible.';
  recommendation.textContent = data.recommendation || 'Sin recomendación disponible.';
  confidence.textContent = typeof data.confidence === 'number'
    ? data.confidence.toFixed(2)
    : '--';
  renderSources(data.sources);
}

async function loadBusinessHunterSummary() {
  setLoadingState(true);

  try {
    const response = await fetch('/api/executive/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: BUSINESS_HUNTER_QUERY }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No se pudo cargar el resumen ejecutivo.');
    }

    renderDashboard(data);
    setStatus('Resumen ejecutivo listo.');
  } catch (error) {
    executiveSummary.textContent = 'No se pudo cargar el resumen ejecutivo.';
    recommendation.textContent = error.message || 'Error inesperado.';
    confidence.textContent = '--';
    sourcesList.innerHTML = '<li>Sin fuentes disponibles.</li>';
    setStatus('Error al cargar el resumen.');
  }
}

loadBusinessHunterSummary();
