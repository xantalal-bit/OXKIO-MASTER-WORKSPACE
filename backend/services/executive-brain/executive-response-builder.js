'use strict';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractTopSources(sources) {
  return toArray(sources)
    .slice()
    .sort((left, right) => {
      const leftPosition = Number.isFinite(left && left.rankingPosition) ? left.rankingPosition : Number.MAX_SAFE_INTEGER;
      const rightPosition = Number.isFinite(right && right.rankingPosition) ? right.rankingPosition : Number.MAX_SAFE_INTEGER;

      if (leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
      }

      const leftScore = Number.isFinite(left && left.score) ? left.score : 0;
      const rightScore = Number.isFinite(right && right.score) ? right.score : 0;

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return String(left && left.id ? left.id : '').localeCompare(String(right && right.id ? right.id : ''));
    });
}

function buildExecutiveSummary(answer, confidence, sources) {
  const confidenceLabel = confidence >= 0.8 ? 'alta' : confidence >= 0.5 ? 'media' : 'baja';

  if (!sources.length) {
    return `${answer || 'No se encontró evidencia suficiente para construir una respuesta ejecutiva.'} Confianza ${confidenceLabel}.`;
  }

  const topSource = sources[0];
  const sourceName = topSource && topSource.name ? topSource.name : topSource && topSource.id ? topSource.id : 'fuente principal';

  return `${answer || 'Respuesta ejecutiva disponible.'} Evidencia principal: ${sourceName}. Confianza ${confidenceLabel}.`;
}

function buildKeyFindings(answer, sources, reasoningSummary) {
  const findings = [];

  if (answer) {
    findings.push(answer);
  }

  if (sources.length > 0) {
    findings.push(`Se identificaron ${sources.length} fuentes relevantes.`);
    sources.slice(0, 3).forEach((source) => {
      const label = source && source.name ? source.name : source && source.id ? source.id : 'fuente desconocida';
      findings.push(`Fuente prioritaria: ${label}.`);
    });
  } else {
    findings.push('No hay evidencia suficiente en Knowledge Store.');
  }

  if (reasoningSummary && reasoningSummary.queryType) {
    findings.push(`Tipo de consulta: ${reasoningSummary.queryType}.`);
  }

  return findings;
}

function buildRecommendation(confidence, sources) {
  if (!sources.length || confidence < 0.35) {
    return 'Recopilar más evidencia antes de decidir.';
  }

  if (confidence < 0.7) {
    return 'Revisar la evidencia disponible y validar manualmente antes de ejecutar.';
  }

  return 'Proceder con base en la evidencia disponible.';
}

function buildExecutiveResponse(input) {
  const answer = input && typeof input.answer === 'string' ? input.answer : '';
  const confidence = Number.isFinite(input && input.confidence) ? Number(input.confidence) : 0;
  const sources = extractTopSources(input && input.sources);
  const reasoningSummary = input && input.reasoningSummary ? input.reasoningSummary : {};
  const limitations = toArray(input && input.limitations);

  return {
    executiveSummary: buildExecutiveSummary(answer, confidence, sources),
    keyFindings: buildKeyFindings(answer, sources, reasoningSummary),
    recommendation: buildRecommendation(confidence, sources),
    confidence: Number(confidence.toFixed(2)),
    sources,
    limitations,
  };
}

module.exports = {
  buildExecutiveResponse,
};
