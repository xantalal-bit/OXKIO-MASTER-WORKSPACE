'use strict';

const { DEFAULT_CATALOG } = require('../runtime/model-cost-catalog');
const { createSecretRuntime } = require('../../security/secret-runtime');

// Executive Reasoning Provider (Supervisor V1, 27/09/2026): the single entry
// point through which the canonical runtime asks a real model to reason. It
// is configured only from the runtime environment contract:
//   OXKIO_REASONING_PROVIDER, OXKIO_REASONING_MODEL (config),
//   OXKIO_REASONING_INPUT_USD_PER_MILLION, OXKIO_REASONING_OUTPUT_USD_PER_MILLION,
//   OXKIO_REASONING_PRICING_REVIEWED_AT (reviewed pricing, config),
//   OXKIO_REASONING_API_KEY (secret).
// With anything missing it reports NOT_CONFIGURED and never answers: there
// is no fake or template fallback behind it.

const PROVIDER_STATUS = Object.freeze({ READY: 'ready', NOT_CONFIGURED: 'not_configured' });
const REASONING_RESULT = Object.freeze({ OK: 'ok', ERROR: 'error', NOT_CONFIGURED: 'not_configured' });
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 900;
const REVIEWED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function createOpenAIChatAdapter({ apiKey, model, timeoutMs }) {
  // Reuses the openai SDK already declared in package.json; no retries so
  // every model call stays visible to the Supervisor's own attempt budget.
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  return async function complete({ system, user, maxOutputTokens }) {
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_completion_tokens: maxOutputTokens,
    });
    const choice = completion && Array.isArray(completion.choices) ? completion.choices[0] : null;
    const usage = completion && completion.usage ? completion.usage : {};
    return {
      text: choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '',
      usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
    };
  };
}

const ADAPTERS = Object.freeze({ openai: createOpenAIChatAdapter });

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeNumber(value) {
  const number = Number(trimmed(value));
  return trimmed(value) !== '' && Number.isFinite(number) && number >= 0 ? number : null;
}

function readReasoningConfig(env, secretRuntime) {
  const missing = [];
  const provider = trimmed(env.OXKIO_REASONING_PROVIDER).toLowerCase();
  const model = trimmed(env.OXKIO_REASONING_MODEL);
  if (!provider || !Object.hasOwn(ADAPTERS, provider)) missing.push('OXKIO_REASONING_PROVIDER');
  if (!model) missing.push('OXKIO_REASONING_MODEL');
  const inputUsdPerMillion = nonNegativeNumber(env.OXKIO_REASONING_INPUT_USD_PER_MILLION);
  const outputUsdPerMillion = nonNegativeNumber(env.OXKIO_REASONING_OUTPUT_USD_PER_MILLION);
  const reviewedAt = trimmed(env.OXKIO_REASONING_PRICING_REVIEWED_AT);
  if (inputUsdPerMillion === null) missing.push('OXKIO_REASONING_INPUT_USD_PER_MILLION');
  if (outputUsdPerMillion === null) missing.push('OXKIO_REASONING_OUTPUT_USD_PER_MILLION');
  if (!REVIEWED_AT_PATTERN.test(reviewedAt)) missing.push('OXKIO_REASONING_PRICING_REVIEWED_AT');
  let apiKey = null;
  try {
    apiKey = secretRuntime.getSecret('OXKIO_REASONING_API_KEY');
  } catch (error) {
    missing.push('OXKIO_REASONING_API_KEY');
  }
  return { missing, provider, model, apiKey, inputUsdPerMillion, outputUsdPerMillion, reviewedAt };
}

function classifyProviderError(error) {
  const status = error && Number.isInteger(error.status) ? error.status : null;
  const name = error && typeof error.name === 'string' ? error.name : '';
  if (status === 401 || status === 403) return 'reasoning_auth_failed';
  if (status === 429) return 'reasoning_rate_limited';
  if (/timeout/i.test(name)) return 'reasoning_timeout';
  if (status && status >= 500) return 'reasoning_upstream_error';
  if (status && status >= 400) return 'reasoning_request_rejected';
  return 'reasoning_unavailable';
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function notConfigured(missing, provider, model) {
  return Object.freeze({
    status: PROVIDER_STATUS.NOT_CONFIGURED,
    missing: Object.freeze([...missing]),
    provider: provider || null,
    model: model || null,
    modelId: null,
    catalog: Object.freeze({}),
    async reason() {
      return { status: REASONING_RESULT.NOT_CONFIGURED };
    },
  });
}

// Contract: reason({ mission, context, constraints, output }) where
//   mission: what must be achieved; context: authorized data only;
//   constraints: rules the answer must respect; output: the JSON shape.
// Returns { status: 'ok', content, usage } with content = the parsed JSON
// object, or { status: 'error', errorCode } with a fixed sanitized code.
function createExecutiveReasoningProvider({
  env = process.env,
  secretRuntime = createSecretRuntime(),
  adapters = ADAPTERS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = readReasoningConfig(env, secretRuntime);
  if (config.missing.length > 0 || !Object.hasOwn(adapters, config.provider)) {
    return notConfigured(config.missing, config.provider, config.model);
  }
  const modelId = `${config.provider}:${config.model}`;
  const complete = adapters[config.provider]({ apiKey: config.apiKey, model: config.model, timeoutMs });
  const catalog = Object.freeze({
    [modelId]: Object.freeze({
      provider: config.provider,
      tier: 'small_model',
      inputUsdPerMillion: config.inputUsdPerMillion,
      outputUsdPerMillion: config.outputUsdPerMillion,
      residency: 'external',
      privacy: 'provider_api',
      pricingVersion: `operator-${config.reviewedAt}`,
      pricingSource: 'operator-config',
      reviewedAt: config.reviewedAt,
    }),
  });

  async function reason({ mission, context, constraints, output, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS } = {}) {
    const system = [
      `MISIÓN: ${mission}`,
      'RESTRICCIONES:',
      ...(Array.isArray(constraints) ? constraints : []).map((rule) => `- ${rule}`),
      `SALIDA: responde solo con un objeto JSON con esta forma: ${JSON.stringify(output)}`,
    ].join('\n');
    try {
      const result = await complete({ system, user: JSON.stringify(context), maxOutputTokens });
      const content = parseJsonObject(result && result.text);
      if (!content) return { status: REASONING_RESULT.ERROR, errorCode: 'reasoning_invalid_output', usage: result && result.usage };
      return { status: REASONING_RESULT.OK, content, usage: (result && result.usage) || {} };
    } catch (error) {
      return { status: REASONING_RESULT.ERROR, errorCode: classifyProviderError(error) };
    }
  }

  return Object.freeze({
    status: PROVIDER_STATUS.READY,
    missing: Object.freeze([]),
    provider: config.provider,
    model: config.model,
    modelId,
    catalog,
    reason,
  });
}

// CostController catalog for this process: the reviewed built-in entries
// plus the operator-reviewed pricing of the configured reasoning model.
function buildReasoningCostCatalog(provider) {
  return { ...DEFAULT_CATALOG, ...((provider && provider.catalog) || {}) };
}

module.exports = {
  ADAPTERS,
  PROVIDER_STATUS,
  REASONING_RESULT,
  buildReasoningCostCatalog,
  createExecutiveReasoningProvider,
};
