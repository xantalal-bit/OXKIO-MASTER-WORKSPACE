'use strict';

const { REASONING_RESULT, PROVIDER_STATUS } = require('./executive-reasoning-provider');

// Supervisor V1 (27/09/2026) for one mission: reply to the email José
// selected. Circuit: validate authorized context -> cost gate (CostController)
// -> ask the reasoning provider -> independent verification -> draft only if
// it passes, otherwise clarification or rejection. It never sends, never
// executes and never creates the approval itself: the caller's existing
// approval queue keeps the mandatory human gate.

const SUPERVISION_STATUS = Object.freeze({
  DRAFT: 'draft',
  NEEDS_CLARIFICATION: 'needs_clarification',
  REJECTED: 'rejected',
  CONNECTION_NEEDED: 'connection_needed',
  PROVIDER_ERROR: 'provider_error',
  BUDGET_BLOCKED: 'budget_blocked',
  INSUFFICIENT_CONTEXT: 'insufficient_context',
});

const MAX_SOURCE_CHARS = 6000;
const MAX_OUTPUT_TOKENS = 900;
const MAX_ATTEMPTS = 2;
const MAX_QUESTION_CHARS = 300;
const MIN_BODY_CHARS = 40;
const MAX_BODY_CHARS = 4000;

const MISSION = 'Redactar la respuesta de José Antonio al correo recibido, basada exclusivamente en su contenido real.';
const CONSTRAINTS = Object.freeze([
  'Responde en el idioma del correo recibido.',
  'Responde a lo que el remitente solicita o comunica; demuestra que has entendido el correo.',
  'No inventes datos: ni importes, ni fechas, ni números, ni direcciones, ni hechos que no estén en el correo o en la instrucción de José.',
  'No añadas compromisos, aceptaciones, pagos, renovaciones ni decisiones que José no haya indicado en su instrucción.',
  'Si la respuesta exige una decisión o un dato que José no ha dado, no redactes: needsClarification=true y formula una única pregunta concreta a José.',
  'No cambies el destinatario ni menciones otras direcciones.',
  'No digas que has enviado, adjuntado o ejecutado nada.',
  'No uses frases genéricas de relleno ("He revisado el asunto", "propongo avanzar", "Quedo atento") en lugar de responder al contenido.',
  'evidence debe contener citas literales y breves del correo que sustentan la respuesta.',
  'Cierra con "Un saludo," sin inventar firma ni cargos.',
]);
const OUTPUT_SHAPE = Object.freeze({
  understanding: { sender: 'quién escribe', request: 'qué solicita o comunica', context: 'contexto del asunto' },
  needsClarification: false,
  clarificationQuestion: null,
  replyBody: 'cuerpo de la respuesta o null',
  evidence: ['cita literal del correo'],
  uncertainties: ['dudas o datos que faltan'],
});

const GENERIC_PHRASES = Object.freeze([
  'he revisado el asunto', 'propongo avanzar', 'con prioridad', 'quedo atento', 'quedo atenta',
  'quedo a la espera', 'a la espera de confirmacion', 'a confirmacion', 'gracias por tu mensaje',
  'gracias por su mensaje', 'gracias por el mensaje', 'un saludo', 'saludos', 'hola', 'buenos dias',
  'buenas tardes', 'estimado', 'estimada', 'cordialmente', 'atentamente',
]);
const STOPWORDS = new Set(('de la que el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o '
  + 'este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les '
  + 'ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho '
  + 'quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu te ti tus ellas nosotras vosotros usted '
  + 'ustedes the and for you your with this that are from have has will can our'
).split(/\s+/));
// Decisions José must take himself (accept, renew, pay, authorize, hire,
// sign...). Plain "te confirmo si..." is a normal reply and is not listed.
const COMMITMENT_PATTERN = new RegExp('\\b(acepto|aceptamos|renuevo|renovamos|renovare|renovaremos|pagare|pagaremos'
  + '|procedo al pago|realizare el pago|autorizo|autorizamos|me comprometo|nos comprometemos|contratare|contrataremos'
  + '|quiero contratar|quiero renovar|firmo|firmamos'
  + '|confirm(?:o|amos) (?:la|el) (?:renovacion|contratacion|compra|reserva|pago|pedido|baja|alta))\\b');
const ACTION_CLAIM_PATTERN = /\b(he enviado|hemos enviado|te envio|le envio|adjunto|adjuntamos|ya esta hecho|ya lo he hecho|he realizado el pago)\b/;
const FACT_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|https?:\/\/\S+|\d[\d.,:/-]*/g;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function distinctiveTokens(value) {
  return new Set(words(value).filter((word) => (word.length >= 4 || /\d/.test(word)) && !STOPWORDS.has(word)));
}

function stripGeneric(value) {
  let text = normalizeText(value);
  for (const phrase of GENERIC_PHRASES) text = text.split(phrase).join(' ');
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Independent verification: deterministic checks over the model output and
// the authorized source only. It shares no state with the generator.
function verifyEmailReplyDraft({ content, source, instruction }) {
  const reasons = [];
  if (!content || typeof content !== 'object') return { verdict: 'fail', reasons: ['invalid_output'] };

  if (content.needsClarification === true) {
    const question = typeof content.clarificationQuestion === 'string' ? content.clarificationQuestion.trim() : '';
    if (!question || question.length > MAX_QUESTION_CHARS) return { verdict: 'fail', reasons: ['invalid_clarification'] };
    return { verdict: 'clarification', reasons: [] };
  }

  const body = typeof content.replyBody === 'string' ? content.replyBody.trim() : '';
  const sourceText = `${source.subject || ''}\n${source.text || ''}`;
  const normalizedSource = normalizeText(sourceText);
  const normalizedInstruction = normalizeText(instruction);
  const normalizedBody = normalizeText(body);

  if (body.length < MIN_BODY_CHARS || body.length > MAX_BODY_CHARS) reasons.push('body_length');

  const evidence = Array.isArray(content.evidence)
    ? content.evidence.filter((quote) => typeof quote === 'string' && quote.trim())
    : [];
  if (evidence.length === 0) reasons.push('missing_evidence');
  else if (!evidence.every((quote) => {
    const normalizedQuote = normalizeText(quote).replace(/^[\s"'«»“”.,;:…-]+|[\s"'«»“”.,;:…-]+$/g, '');
    return normalizedQuote.length >= 3 && normalizedSource.includes(normalizedQuote);
  })) {
    reasons.push('evidence_not_in_source');
  }

  const sourceTokens = distinctiveTokens(sourceText);
  const shared = [...distinctiveTokens(body)].filter((token) => sourceTokens.has(token));
  if (shared.length < 2) reasons.push('not_grounded');
  if (stripGeneric(body).length < 30) reasons.push('generic_content');

  const facts = body.match(FACT_PATTERN) || [];
  const unsupported = facts
    .map((fact) => normalizeText(fact).replace(/[.,:;]+$/, ''))
    .filter((fact) => fact && !normalizedSource.includes(fact) && !normalizedInstruction.includes(fact));
  if (unsupported.length > 0) reasons.push('unsupported_fact');

  const commitment = normalizedBody.match(COMMITMENT_PATTERN);
  if (commitment && !normalizedInstruction.includes(commitment[0])) reasons.push('unauthorized_commitment');
  if (ACTION_CLAIM_PATTERN.test(normalizedBody)) reasons.push('unsupported_action_claim');

  return { verdict: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

function sanitizeList(values, limit = 3, maxChars = 200) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .slice(0, limit)
    .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, maxChars));
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 3);
}

function defaultLogger(entry) {
  console.info('[executive-reasoning]', JSON.stringify(entry));
}

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function createEmailReplySupervisor({
  provider = null,
  costController = null,
  logger = defaultLogger,
  now = () => Date.now(),
  maxAttempts = MAX_ATTEMPTS,
} = {}) {
  // In-process daily spend fed to the CostController's daily budget. It
  // resets with the process; persistent spend tracking is out of scope.
  const spend = { day: null, usd: 0 };

  function recordSpend(modelId, usage) {
    if (!costController || !usage) return;
    const estimate = costController.estimateCost({
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    if (estimate && Number.isFinite(estimate.estimatedCostUsd)) spend.usd += estimate.estimatedCostUsd;
  }

  async function supervise({ message, instruction } = {}) {
    const startedAt = now();
    const day = utcDay(startedAt);
    if (spend.day !== day) { spend.day = day; spend.usd = 0; }
    const telemetry = {
      mission: 'email_reply',
      provider: provider && provider.provider ? provider.provider : null,
      model: provider && provider.model ? provider.model : null,
      // Derived from configuration only (allowlisted base URL), never content.
      reasoningRegion: provider && (provider.region === 'eu' || provider.region === 'global') ? provider.region : null,
      attempts: 0,
      verdict: null,
      needsClarification: false,
      errorCode: null,
      costLevel: null,
      executionPattern: null,
    };
    const finish = (result) => {
      telemetry.verdict = result.status;
      telemetry.durationMs = Math.max(0, now() - startedAt);
      try { logger({ ...telemetry }); } catch (error) { /* telemetry is best-effort */ }
      return Object.freeze({ ...result, telemetry: Object.freeze({ ...telemetry }) });
    };

    const text = message && typeof message.text === 'string' ? message.text.trim().slice(0, MAX_SOURCE_CHARS) : '';
    if (!message || !text || !message.subject) {
      return finish({ status: SUPERVISION_STATUS.INSUFFICIENT_CONTEXT });
    }
    if (!provider || provider.status !== PROVIDER_STATUS.READY || typeof provider.reason !== 'function') {
      return finish({
        status: SUPERVISION_STATUS.CONNECTION_NEEDED,
        missing: provider && Array.isArray(provider.missing) ? [...provider.missing] : [],
      });
    }

    const source = { from: String(message.from || ''), subject: String(message.subject || ''), date: String(message.date || ''), text };
    const context = {
      instruccionDeJose: String(instruction || ''),
      correoRecibido: source,
    };
    const inputTokens = estimateTokens(`${MISSION}${CONSTRAINTS.join('')}${JSON.stringify(OUTPUT_SHAPE)}${JSON.stringify(context)}`);

    if (!costController || typeof costController.decide !== 'function') {
      telemetry.errorCode = 'cost_controller_missing';
      return finish({ status: SUPERVISION_STATUS.BUDGET_BLOCKED });
    }
    const perCall = costController.estimateCost({ modelId: provider.modelId, inputTokens, outputTokens: MAX_OUTPUT_TOKENS });
    const decision = costController.decide({
      mission: {
        smallModelSufficient: true,
        smallModelEstimatedCostUsd: perCall && Number.isFinite(perCall.estimatedCostUsd)
          ? perCall.estimatedCostUsd * maxAttempts
          : undefined,
        dailySpentUsd: spend.usd,
        requiresIndependentVerification: true,
        sensitiveAction: true,
      },
      costBasis: { modelId: provider.modelId, inputTokens, outputTokens: MAX_OUTPUT_TOKENS },
    });
    telemetry.costLevel = decision && decision.decision ? decision.decision.level : null;
    telemetry.executionPattern = decision && decision.executionPattern ? decision.executionPattern.pattern : null;
    if (!decision || !decision.decision || !decision.decision.level
      || !decision.costEstimate || decision.costEstimate.status !== 'estimated') {
      telemetry.errorCode = decision && decision.costEstimate ? decision.costEstimate.status : 'cost_unknown';
      return finish({ status: SUPERVISION_STATUS.BUDGET_BLOCKED });
    }

    let feedback = null;
    let lastReasons = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      telemetry.attempts = attempt;
      const result = await provider.reason({
        mission: MISSION,
        context: feedback ? { ...context, correccionDelSupervisor: feedback } : context,
        constraints: CONSTRAINTS,
        output: OUTPUT_SHAPE,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      recordSpend(provider.modelId, result && result.usage);
      if (!result || result.status !== REASONING_RESULT.OK) {
        telemetry.errorCode = result && result.errorCode ? result.errorCode : 'reasoning_unavailable';
        if (result && result.errorCode === 'reasoning_invalid_output' && attempt < maxAttempts) {
          feedback = 'La salida anterior no era un objeto JSON válido con la forma pedida.';
          continue;
        }
        return finish({ status: SUPERVISION_STATUS.PROVIDER_ERROR });
      }
      const verification = verifyEmailReplyDraft({ content: result.content, source, instruction });
      if (verification.verdict === 'clarification') {
        telemetry.needsClarification = true;
        return finish({
          status: SUPERVISION_STATUS.NEEDS_CLARIFICATION,
          question: result.content.clarificationQuestion.replace(/\s+/g, ' ').trim(),
        });
      }
      if (verification.verdict === 'pass') {
        return finish({
          status: SUPERVISION_STATUS.DRAFT,
          body: result.content.replyBody.trim(),
          warnings: sanitizeList(result.content.uncertainties),
        });
      }
      lastReasons = verification.reasons;
      feedback = `El verificador rechazó el borrador por: ${verification.reasons.join(', ')}. `
        + 'Corrígelo respetando todas las restricciones o pide aclaración.';
    }
    telemetry.errorCode = lastReasons.join(',') || 'verification_failed';
    return finish({ status: SUPERVISION_STATUS.REJECTED, reasons: lastReasons });
  }

  return Object.freeze({ supervise });
}

module.exports = {
  SUPERVISION_STATUS,
  createEmailReplySupervisor,
  verifyEmailReplyDraft,
};
