# Executive Chat History V1

## Purpose

Session-only conversational history for Cliente Cero Executive Chat.

## Modified files

- `app/executive-chat.html`
- `app/js/executive-chat.js`
- `app/css/executive-chat.css`

## Behavior

- Each question remains visible.
- Each response remains visible.
- Each interaction shows:
  - pregunta
  - respuesta
  - confianza
  - fuentes
  - limitaciones
- Conversation is rendered in chronological order.
- The view scrolls automatically to the latest message.
- `Nueva conversación` clears only the current browser session view.

## Constraints

- No persistence.
- No backend changes.
- No Knowledge Engine changes.
- No Executive Orchestrator changes.
- No Executive Chat Endpoint changes.
- No AI.
- No agents.

## Manual Test Plan

1. Open:

```text
http://localhost:3000/executive-chat.html
```

2. Send three different queries.

Expected:

- The first query remains above the second.
- The second remains above the third.
- Each interaction shows pregunta, respuesta, confianza, fuentes and limitaciones.
- The conversation scrolls to the latest interaction.

3. Click `Nueva conversación`.

Expected:

- Current visible conversation is cleared.
- No backend call is made.
- The input is focused.
- New queries start a fresh session view.

## Manual Test Status

Prepared for browser validation.
