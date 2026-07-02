# Executive Brain Simulation V1

## Purpose

Minimal deterministic simulation of the future Executive Brain using the existing Knowledge Store.

This is not the definitive Executive Brain.

## Runtime module

- `backend/services/knowledge/executive-brain-simulation.js`

## Test module

- `backend/services/knowledge/executive-brain-simulation.test.js`

## Responsibilities

- Read persisted Knowledge Objects from Knowledge Store.
- Accept simple test questions.
- Search relevant Knowledge Objects by:
  - `metadata.documentTypeClassification`
  - `identity.name`
  - `content.raw`
  - `metadata.documentStructure`
- Return a simulated response.

## Supported initial query areas

- Learning Heroes
- Roadmap
- Governance
- Pending tasks
- Documentation

## Output contract

The simulation returns:

- `query`
- `answer`
- `confidence`
- `sources`
- `reasoningSummary`
- `limitations`

## Constraints

- No AI.
- No new agents.
- No Knowledge Object V2 changes.
- No Knowledge Pipeline changes.
- No writes to runtime Knowledge Store during tests.
- Deterministic matching only.

## Notes

Tests use a temporary Knowledge Store fixture and remove it after execution.
