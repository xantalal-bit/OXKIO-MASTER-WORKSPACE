# Learning Heroes Connector V2

## Purpose

Official Knowledge Engine connector for local Learning Heroes repositories.

## Runtime module

- `backend/services/knowledge/connectors/learning-heroes-connector.js`

## Responsibilities

- Enter the official Knowledge Engine chain through Knowledge Query Service.
- Let Discovery and Recognition locate Learning Heroes as a knowledge asset.
- Delegate processing to the existing Knowledge Pipeline.
- Generate Knowledge Object V2 through the Universal Knowledge Curator.
- Reuse Document Type Classifier and Document Structure Extractor.
- Persist only new Knowledge Objects through Knowledge Persistence and Knowledge Store.
- Keep repeated runs idempotent.

## Repository discovery

The connector calls `searchKnowledge("Learning Heroes")`.

Discovery searches:

- `KNOWLEDGE_DISCOVERY_ROOT`, when defined.
- `C:\Users\janta\OneDrive\Documentos`.

Recognized repository folder names include:

- `Learning Heroes`
- `learning-heroes`
- `LearningHeroes`
- `PROFESOR-IA`

Tests can pass a temporary discovery root through `runLearningHeroesConnector({ root })`.

## Supported documents

The connector delegates document handling to the existing pipeline. Current curated extensions are:

- `.md`
- `.txt`
- `.json`

## Output

`runLearningHeroesConnector()` returns:

- `source`
- `found`
- `asset`
- `pipeline`

## Constraints

- No AI.
- No new agents.
- No Executive Brain integration yet.
- No Knowledge Object V2 shape changes.
- No generated Knowledge Objects should be versioned.
