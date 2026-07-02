# Executive Chat UI V1

## Purpose

Minimal conversational interface for the Executive Brain.

## Files

- `app/executive-chat.html`
- `app/js/executive-chat.js`
- `app/css/executive-chat.css`

## Endpoint

The UI sends:

```http
POST /api/executive/chat
```

Payload:

```json
{
  "query": "..."
}
```

## Responsibilities

- Show the title `Oxkio Executive`.
- Show a query text area.
- Show a `Preguntar` button.
- Display `Pensando...` while waiting.
- Render:
  - Pregunta
  - Respuesta
  - Confianza
  - Fuentes
  - Limitaciones
- Show clear errors.

## Constraints

- No AI.
- No agents.
- No dashboards.
- No charts.
- No Knowledge Engine changes.
- No Executive Orchestrator changes.
- The UI only calls the Executive Chat endpoint.

## Manual Test Plan

1. Start backend:

```powershell
node backend/api/server.js
```

2. Open:

```text
http://localhost:3000/executive-chat.html
```

3. Verify:

- Page title shows `Oxkio Executive`.
- Text area is visible.
- `Preguntar` button is visible.
- Empty submit shows a clear message.
- Valid submit shows `Pensando...`.
- Response renders question, answer, confidence, sources, and limitations.
- Backend errors render a clear error message.

## Manual Test Status

Prepared for browser validation.
