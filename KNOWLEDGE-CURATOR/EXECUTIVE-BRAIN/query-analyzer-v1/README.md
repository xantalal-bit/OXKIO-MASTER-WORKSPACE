# Executive Query Analyzer V1

## Purpose

First real component of the Executive Brain.

It analyzes user queries and returns deterministic routing metadata. It does not answer questions.

## Runtime module

- `backend/services/executive-brain/query-analyzer.js`

## Test module

- `backend/services/executive-brain/query-analyzer.test.js`

## Responsibilities

- Receive a user query.
- Detect:
  - intent
  - project
  - document types
  - keywords
  - filters
  - priority
  - confidence

## Supported initial domains

- Learning Heroes
- Governance
- Roadmap
- Business Hunter
- Profesor IA
- Oxkio
- tasks
- decisions
- documentation

## Output contract

```json
{
  "intent": "roadmap",
  "project": "Oxkio",
  "documentTypes": ["Roadmap"],
  "keywords": [],
  "filters": {
    "project": "Oxkio",
    "documentTypes": ["Roadmap"],
    "intent": "roadmap"
  },
  "priority": "medium",
  "confidence": 0.8
}
```

## Constraints

- No AI.
- No agents.
- No Knowledge Store access.
- No document retrieval.
- No user-facing answers.
- No Knowledge Object V2 changes.
- No Knowledge Engine changes.
