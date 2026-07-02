# Executive Chat Endpoint V1

## Purpose

First conversational HTTP endpoint for the Executive Brain.

## Runtime route

- `backend/api/routes/executive-chat.js`

## Test module

- `backend/api/routes/executive-chat.test.js`

## Endpoint

```http
POST /api/executive/chat
```

## Request

```json
{
  "query": "Resumen del roadmap de Oxkio"
}
```

## Response

```json
{
  "query": "Resumen del roadmap de Oxkio",
  "analysis": {},
  "response": "Respuesta simulada.",
  "confidence": 0.7,
  "sources": [],
  "limitations": []
}
```

## Responsibilities

- Receive HTTP POST requests.
- Parse the JSON body.
- Validate `query`.
- Invoke only Executive Orchestrator.
- Return the orchestrator response.

## Constraints

- No AI.
- No new agents.
- No direct Knowledge Store access.
- No direct Query Analyzer calls.
- No business logic.
- No Knowledge Object V2 changes.
