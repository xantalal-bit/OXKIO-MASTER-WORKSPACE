'use strict';

const { REASONING_RESULT, PROVIDER_STATUS } = require('./executive-reasoning-provider');
const { DEFAULT_PRIVACY_POLICY, PRIVACY_CLASSES, classifyContext, evaluateProviderRouting } = require('./privacy-gate');
const {
  CONVERGENCE_ACTIONS,
  VERIFICATION_VERDICTS,
  createMissionContract,
  createVerificationRequest,
  decideSupervision,
  evaluateConvergence,
  runVerification,
} = require('./xatai-core');

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
  PRIVACY_BLOCKED: 'privacy_blocked',
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

// XATAI CORE V1: the governance contract of this mission. A1 (reason and
// prepare) with read + draft only; sending and every baseline prohibition
// stay out of reach, and the draft always goes to the human approval queue.
const EMAIL_REPLY_CONTRACT = createMissionContract({
  objective: MISSION,
  constraints: CONSTRAINTS,
  knownContext: ['Correo seleccionado por José (remitente, asunto, fecha y texto).', 'Instrucción de José.'],
  autonomyLevel: 'A1',
  authorizedTools: ['gmail.read', 'gmail.draft'],
  passCriteria: ['El verificador independiente aprueba el borrador con evidencia literal del correo.'],
  stopCriteria: [
    'Falta una decisión o dato de José: se pide aclaración.',
    'El proveedor falla o el presupuesto lo bloquea.',
    'Se agotan los intentos sin pasar la verificación.',
  ],
  requiredEvidence: ['Citas literales del correo recibido.'],
});
const VERIFIER_ID = 'email-reply-verifier';
// Provider error codes whose fix is a human connection (credential, access,
// quota) rather than another attempt.
const CONNECTION_ERROR_CODES = new Set(['reasoning_auth_failed', 'reasoning_rate_limited']);
const FAILURE_KIND_BY_ERROR = Object.freeze({
  reasoning_invalid_output: 'invalid_output',
  reasoning_auth_failed: 'auth',
  reasoning_rate_limited: 'budget',
  reasoning_timeout: 'timeout',
});
// Corrective actions this supervisor can apply by itself inside the loop.
const APPLICABLE_ACTIONS = new Set([CONVERGENCE_ACTIONS.REFINE_PROMPT, CONVERGENCE_ACTIONS.CHANGE_HYPOTHESIS]);

function supervisorDecisionFor(result, telemetry, verification) {
  const decide = (signals) => decideSupervision({ contract: EMAIL_REPLY_CONTRACT, capabilityId: 'gmail.draft', ...signals });
  switch (result.status) {
    case SUPERVISION_STATUS.DRAFT: return decide({ verification });
    case SUPERVISION_STATUS.NEEDS_CLARIFICATION:
    case SUPERVISION_STATUS.INSUFFICIENT_CONTEXT: return decide({ missingInformation: [result.status] });
    case SUPERVISION_STATUS.CONNECTION_NEEDED: return decide({ connectionAvailable: false });
    case SUPERVISION_STATUS.PROVIDER_ERROR:
      return CONNECTION_ERROR_CODES.has(telemetry.errorCode)
        ? decide({ connectionAvailable: false })
        : decide({ blockedReason: telemetry.errorCode || 'provider_error' });
    case SUPERVISION_STATUS.REJECTED: return decide({ verification });
    default: return decide({ blockedReason: result.status });
  }
}

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
  // XATAI CORE V2 Privacy Gate policy. The canonical default approves no
  // external provider for CONFIDENTIAL data, so mail never leaves unless a
  // human explicitly approves a provider and region for it.
  privacyPolicy = DEFAULT_PRIVACY_POLICY,
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
      // XATAI CORE V1: enums only (never content).
      verification: null,
      convergenceAction: null,
      supervisorDecision: null,
      privacyClass: null,
    };
    let independentVerification = null;
    const finish = (result) => {
      telemetry.verdict = result.status;
      const decision = supervisorDecisionFor(result, telemetry, independentVerification);
      telemetry.supervisorDecision = decision.decision;
      telemetry.durationMs = Math.max(0, now() - startedAt);
      try { logger({ ...telemetry }); } catch (error) { /* telemetry is best-effort */ }
      return Object.freeze({ ...result, decision, telemetry: Object.freeze({ ...telemetry }) });
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
    // Privacy Gate before any cost decision or provider call: a received email
    // is private data (gmail.* -> at least CONFIDENTIAL) and any credential
    // marker in it or in the instruction makes it SECRET, which never leaves.
    // A blocked context makes zero provider calls.
    const privacy = classifyContext({
      declaredClass: PRIVACY_CLASSES.CONFIDENTIAL,
      capabilities: EMAIL_REPLY_CONTRACT.authorizedTools,
      texts: [context.instruccionDeJose, source.from, source.subject, source.date, source.text],
    });
    telemetry.privacyClass = privacy.privacyClass;
    const routing = evaluateProviderRouting({
      privacyClass: privacy.privacyClass,
      provider: { external: true, providerId: provider.provider, region: provider.region },
      policy: privacyPolicy,
    });
    if (!routing.allowed) {
      telemetry.errorCode = routing.reason;
      return finish({ status: SUPERVISION_STATUS.PRIVACY_BLOCKED });
    }

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

    // Convergence Sentinel: every retry must apply a corrective action the
    // sentinel chose (never the same attempt again); anything it cannot fix
    // in-loop ends the mission with the recommended action recorded.
    let feedback = null;
    let lastReasons = [];
    const attempts = [];
    const nextCorrection = (failureKind, correctiveFeedback) => {
      attempts.push({ prompt: feedback, outcome: 'fail', failureKind, correctiveAction: telemetry.convergenceAction });
      const convergence = evaluateConvergence({ attempts, maxAttempts });
      telemetry.convergenceAction = convergence.action;
      if (!APPLICABLE_ACTIONS.has(convergence.action)) return false;
      feedback = correctiveFeedback;
      return true;
    };
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
        const failureKind = FAILURE_KIND_BY_ERROR[telemetry.errorCode] || 'tool_error';
        if (failureKind === 'invalid_output'
          && nextCorrection(failureKind, 'La salida anterior no era un objeto JSON válido con la forma pedida.')) {
          continue;
        }
        if (failureKind !== 'invalid_output') nextCorrection(failureKind, null);
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
      // Verifier Contract: the deterministic checks run as an independent
      // verifier over the model's claim; the model never certifies itself.
      independentVerification = runVerification(createVerificationRequest({
        claimedResult: 'email_reply_draft',
        evidence: Array.isArray(result.content.evidence) ? result.content.evidence : [],
        constraints: CONSTRAINTS,
        checks: [{
          id: 'email_reply_grounding',
          run: () => ({
            verdict: verification.verdict === 'pass' ? VERIFICATION_VERDICTS.PASS : VERIFICATION_VERDICTS.FAIL,
            reasons: verification.reasons,
          }),
        }],
      }), { verifierId: VERIFIER_ID, executorId: provider.modelId || 'reasoning-provider' });
      telemetry.verification = independentVerification.verdict;
      if (independentVerification.verdict === VERIFICATION_VERDICTS.PASS) {
        return finish({
          status: SUPERVISION_STATUS.DRAFT,
          body: result.content.replyBody.trim(),
          warnings: sanitizeList(result.content.uncertainties),
        });
      }
      lastReasons = verification.reasons.length > 0 ? verification.reasons : [...independentVerification.reasons];
      if (!nextCorrection('verification_failed', `El verificador rechazó el borrador por: ${lastReasons.join(', ')}. `
        + 'Corrígelo respetando todas las restricciones o pide aclaración.')) break;
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
