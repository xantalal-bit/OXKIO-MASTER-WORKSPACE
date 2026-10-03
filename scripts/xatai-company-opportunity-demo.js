'use strict';

// XATAI CORE V2.1 — controlled real test of the company-opportunity circuit.
//
//   node scripts/xatai-company-opportunity-demo.js --company "Name" \
//        --website https://www.example.com/ --profile path/to/seller-profile.json
//
// What it does: reads the company's PUBLIC official website (plain HTTPS
// GET, robots.txt honoured, same domain only) and runs the full mission
// locally: research -> analysis -> opportunities -> proposal -> draft ->
// human review gate. What it never does: contact the company, send or
// publish anything, write to Gmail, call a paid API or use credentials.
// Memory and Gmail are not connected here, so they are reported as skipped.

const fs = require('node:fs');
const path = require('node:path');
const { createPublicWebFetcher } = require('../backend/services/executive-brain/mission-capabilities/public-web-fetcher');
const { runCompanyOpportunity } = require('../backend/services/executive-brain/mission-capabilities/company-opportunity');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const company = argument('company');
  const website = argument('website');
  const profilePath = argument('profile');
  if (!company || !profilePath) {
    console.error('Uso: --company "Nombre" [--website https://...] --profile perfil.json [--json]');
    process.exit(2);
  }
  const sellerProfile = JSON.parse(fs.readFileSync(path.resolve(profilePath), 'utf8'));
  const { state, review } = await runCompanyOpportunity({
    target: { company, website },
    sellerProfile,
    fetcher: createPublicWebFetcher(),
    sourceOrigin: 'live',
  });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ review, tasks: state.tasks.map(summaryOf), trace: state.engine.history }, null, 2));
    return;
  }
  console.log(`\n=== ${review.status} — ${company} ===`);
  console.log(`Misión: ${state.engine.state} · verificación: ${review.verification} · coste estimado: ${review.estimatedCostUsd} USD`);
  if (review.questionForHuman) console.log(`\nPREGUNTA PARA EL HUMANO: ${review.questionForHuman}`);
  review.blocking.forEach((item) => console.log(`  bloqueo: ${item.task} ${item.status} (${item.reason}; último fallo: ${item.lastFailure})`));
  console.log('\nTAREAS');
  state.tasks.forEach((task) => console.log(`  ${task.key.padEnd(22)} ${task.status.padEnd(16)} ${task.assignedAgent || '-'} (${task.gate.reason})`));
  console.log('\nDOSSIER (hechos citados)');
  review.dossier.forEach((fact) => console.log(`  [FACT] ${fact.statement}\n         ${fact.source}`));
  console.log('\nOPORTUNIDADES');
  [...review.opportunities.observed, ...review.opportunities.inferred]
    .forEach((item) => console.log(`  [${item.level}] ${item.need}\n         → ${item.solution}`));
  console.log(`\nRECOMENDACIÓN: ${review.recommendation} — ${review.proposedAction}`);
  console.log('\nINCERTIDUMBRES');
  review.uncertainties.forEach((item) => console.log(`  - ${item}`));
  if (review.draft) console.log(`\nBORRADOR (NO ENVIADO)\n  Asunto: ${review.draft.subject}\n\n${review.draft.body}`);
  console.log('\nEVIDENCIA');
  review.evidence.forEach((item) => console.log(`  ${item.origin} ${item.kind} ${item.url} ${item.fetchedAt}`));
  console.log(`\nDecisión humana: ${review.decisions.join(' / ')} · executionEnabled=${review.executionEnabled}`);
}

function summaryOf(task) {
  return { key: task.key, status: task.status, agent: task.assignedAgent, reason: task.gate.reason, attempts: task.agentPath };
}

main().catch((error) => {
  console.error(`ERROR: ${error.code || error.message}`);
  process.exit(1);
});
