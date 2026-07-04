# Gmail Readonly Private Context Plan

Fecha: 2026-07-04

Estado: propuesta aprobada para siguiente fase, no implementada.

## Contexto

Calendar privado V1 ya fue validado como proveedor privado autorizado para el Executive Brain, con identidad explicita, no persistencia, no promocion a Knowledge Store y sin exposicion de payload completo en sources globales.

## Decision

La proxima fase sera Gmail readonly como contexto privado del Cliente Cero.

No se implementara Gmail write ni drafts como parte de esta fase. La lectura readonly debe mantenerse separada de flujos legacy de borradores, aprobaciones y escritura en Gmail.

## Reutilizar

- `backend/integrations/googleOAuth.js`
- `getGmailClient()`
- Patron Calendar private provider:
  - identidad privada explicita;
  - `privateContextMetadata`;
  - `expectedClientId`;
  - `privatePayload`;
  - `purpose`;
  - `promotionPolicy: NEVER_PROMOTE`;
  - `retentionPolicy: CLIENT_CONTROLLED`.

## No Reutilizar Directamente

- `backend/integrations/gmail/connector.js`, porque es conector simulado.
- `/api/gmail/analyze`, porque crea propuestas y puede persistir metadata privada en approval queue.
- `approvalQueue`, porque no debe almacenar contexto privado Gmail readonly.
- MCP `gmail.draft`, porque pertenece a flujo write/draft supervisado, no a lectura privada readonly.

## Reglas De Privacidad

- Identidad explicita obligatoria:
  - `clientId`;
  - `userId`;
  - `expectedClientId`;
  - `authorization.status = granted`;
  - `authorization.provider = google-oauth`.
- No persistencia de payload privado.
- No escritura en Knowledge Store.
- No escritura en memoria.
- No inclusion de emails privados en sources globales.
- Whitelist estricta de campos.
- Limite bajo de mensajes.

## Riesgos Detectados

- Los scopes Gmail actuales son amplios e incluyen permisos de compose/send ademas de readonly.
- Las rutas legacy de Gmail devuelven datos privados directamente.
- `approvalQueue` puede persistir `emailData` cuando se usa el flujo `/api/gmail/analyze`.

## Siguiente Fase Minima Propuesta

- Crear `backend/services/private-context/gmail-private-provider.js`.
- Agregar soporte `gmail.enabled` en `/api/executive/chat`.
- Agregar tests de privacidad:
  - bloqueo sin identidad privada explicita;
  - aceptacion con identidad privada explicita;
  - no persistencia;
  - no Knowledge Store;
  - no memoria;
  - no sources globales;
  - no exposicion de payload completo;
  - no uso de Gmail write/drafts.
