'use strict';

// XATAI CORE V2.1: Seller Profile. Who is selling, what they really offer
// and what they may or may not claim is configuration, never code: the same
// company-opportunity circuit serves Business Hunter, ecoSoft or XANTALAL by
// passing a different profile. The profile is the only source of solutions,
// value statements and claims a proposal or email may contain.

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function text(value, field, { max = 400, optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`SELLER_PROFILE_INVALID_${field.toUpperCase()}`);
  return value.trim();
}

function list(value, field, { min = 0, max = 30, itemMax = 200 } = {}) {
  if (value === undefined && min === 0) return Object.freeze([]);
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`SELLER_PROFILE_INVALID_${field.toUpperCase()}`);
  return Object.freeze(value.map((item) => text(item, field, { max: itemMax })));
}

function validateSellerProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('SELLER_PROFILE_REQUIRED');
  if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) fail('SELLER_PROFILE_INVALID_ID');
  if (!Array.isArray(input.services) || input.services.length === 0 || input.services.length > 20) {
    fail('SELLER_PROFILE_INVALID_SERVICES');
  }
  const services = input.services.map((service) => {
    if (!service || typeof service.id !== 'string' || !ID_PATTERN.test(service.id)) fail('SELLER_PROFILE_INVALID_SERVICE_ID');
    return Object.freeze({
      id: service.id,
      name: text(service.name, 'service_name', { max: 120 }),
      description: text(service.description, 'service_description'),
      needLabel: text(service.needLabel, 'need_label', { max: 160 }),
      signals: list(service.signals, 'signals', { min: 1, max: 40, itemMax: 60 }),
      explicitNeedSignals: list(service.explicitNeedSignals, 'explicit_need_signals', { max: 20, itemMax: 120 }),
      valueStatement: text(service.valueStatement, 'value_statement'),
      qualifyingQuestions: list(service.qualifyingQuestions, 'qualifying_questions', { max: 10 }),
    });
  });
  if (new Set(services.map((service) => service.id)).size !== services.length) fail('SELLER_PROFILE_DUPLICATE_SERVICE');
  return Object.freeze({
    id: input.id,
    name: text(input.name, 'name', { max: 120 }),
    offering: text(input.offering, 'offering'),
    services: Object.freeze(services),
    sectors: list(input.sectors, 'sectors'),
    allowedClaims: list(input.allowedClaims, 'allowed_claims'),
    prohibitedClaims: list(input.prohibitedClaims, 'prohibited_claims'),
    scope: text(input.scope, 'scope'),
    callToAction: text(input.callToAction, 'call_to_action', { max: 300 }),
    nextAction: text(input.nextAction, 'next_action', { max: 300 }),
    signature: text(input.signature, 'signature', { max: 300 }),
  });
}

// Every signal the research agents should prioritise, across services.
function profileSignals(profile) {
  return [...new Set(profile.services.flatMap((service) => [...service.signals, ...service.explicitNeedSignals]))];
}

module.exports = { profileSignals, validateSellerProfile };
