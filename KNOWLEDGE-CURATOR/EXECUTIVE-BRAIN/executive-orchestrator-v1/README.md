# Executive Orchestrator V1

## Purpose

First functional orchestrator of the Executive Brain.

It coordinates existing components. It does not implement AI, retrieval logic, agents, or Knowledge Object changes.

## Runtime module

- `backend/services/executive-brain/executive-orchestrator.js`

## Test module

- `backend/services/executive-brain/executive-orchestrator.test.js`

## Flow

```text
User query
  -> Executive Query Analyzer V1
  -> Knowledge Query Service, when a project is detected
  -> Executive Brain Simulation V1
  -> unified orchestrator response
```

## Responsibilities

- Receive a user query.
- Send the query to Query Analyzer.
- Use Knowledge Query Service when the analysis detects a project.
- Use Executive Brain Simulation to generate the response.
- Return one response object.

## Output contract

```json
{
  "query": "Resumen del roadmap de Oxkio",
  "analysis": {
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
  },
  "response": "Respuesta simulada.",
  "confidence": 0.7,
  "sources": [],
  "limitations": ["Simulation only."]
}
```

## Constraints

- No AI.
- No new agents.
- No direct Knowledge Store access.
- No manual document retrieval.
- No Knowledge Object V2 changes.
- No Knowledge Engine changes beyond coordination.
