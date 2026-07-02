# Business Hunter Connector V1

## Purpose

Official Knowledge Engine connector for local Business Hunter repositories.

## Runtime module

- `backend/services/knowledge/connectors/business-hunter-connector.js`

## Test module

- `backend/services/knowledge/connectors/business-hunter-connector.test.js`

## Responsibilities

- Enter the official Knowledge Engine chain through Knowledge Query Service.
- Let Discovery and Recognition locate Business Hunter as a knowledge asset.
- Delegate document processing to the existing Knowledge Pipeline.
- Reuse Universal Knowledge Curator, Document Type Classifier and Document Structure Extractor.
- Persist only new Knowledge Objects through Knowledge Persistence and Knowledge Store.
- Keep repeated runs idempotent.

## Recognition

Recognized asset names include:

- `Business Hunter`
- `BUSINESS-HUNTER`
- `BusinessHunter`

## Constraints

- No AI.
- No new agents.
- No Knowledge Object V2 changes.
- No direct Knowledge Store access.
- No parallel path outside the official Knowledge Engine chain.

## Output

`runBusinessHunterConnector()` returns:

- `source`
- `found`
- `asset`
- `pipeline`
