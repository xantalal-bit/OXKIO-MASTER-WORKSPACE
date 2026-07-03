# CALENDAR READONLY PROVIDER CLIENTE CERO V1

## Proposito

Este documento define G007: conexion readonly de Google Calendar como proveedor privado autorizado para el Executive Brain oficial.

Calendar es dato privado del cliente. Sus eventos pueden usarse para briefing ejecutivo autorizado, pero no se escriben en Knowledge Store, no se promocionan, no se persisten en memoria y no se mezclan con otros clientes.

## Auditoria Del Calendar Existente

Conector real existente:

- `backend/integrations/calendar/connector.js`

Autenticacion:

- Reutiliza `backend/integrations/googleOAuth.js`.
- Usa OAuth Google con scope `https://www.googleapis.com/auth/calendar.readonly`.
- Los tokens se gestionan por el modulo OAuth existente.

Funciones readonly disponibles:

- `listUpcomingEvents(options)`
- Ejecuta `calendar.events.list`.
- Usa `singleEvents: true`.
- Usa `orderBy: "startTime"`.

Consumidores existentes:

- `backend/services/dashboard/providers/agenda-provider.js`

Partes mock:

- `agenda-provider.js` usa fallback mock si falla el conector real.

Partes no reutilizadas para G007:

- `backend/agents/tools/calendarAgent.js` porque expone tambien `calendar.create` y `calendar.update`.
- Herramientas MCP `calendar.create` y `calendar.update`.

Conclusion:

- Se reutiliza el conector Calendar real readonly.
- No se crea un segundo conector Google Calendar.
- Se crea un provider privado minimo para adaptar eventos al contrato G004/G005.

## Implementacion

Provider:

```text
backend/services/private-context/calendar-private-provider.js
```

Tests:

```text
backend/services/private-context/calendar-private-provider.test.js
```

Integracion con endpoint oficial:

```text
POST /api/executive/chat
```

## Flujo Real

```text
Google Calendar autorizado
  |
  v
backend/integrations/calendar/connector.js
  |
  v
Calendar Private Provider V1
  |
  v
Private Context Contract G004
  |
  v
Private Context Adapter G005
  |
  v
Executive Brain oficial G006
  |
  v
Briefing ejecutivo seguro
```

## Contrato Calendar Del Endpoint

Ejemplo de body:

```json
{
  "query": "Que tengo hoy?",
  "calendar": {
    "enabled": true,
    "clientId": "cliente-cero",
    "userId": "usuario-cliente-cero",
    "expectedClientId": "cliente-cero",
    "authorization": {
      "status": "granted"
    },
    "sourceId": "google-calendar-primary",
    "range": "today",
    "maxResults": 10
  }
}
```

Rangos permitidos:

- `today`
- `next24Hours`
- `next7Days`
- `custom` con `timeMin` y `timeMax`

Limites:

- rango maximo: 7 dias;
- eventos maximos: 20;
- `maxResults` por defecto: 10.

## Metadata Privada

El provider genera metadata:

```json
{
  "scope": "private:user",
  "sensitivity": "confidential",
  "sourceType": "calendar",
  "purpose": "executive-briefing",
  "promotionPolicy": "NEVER_PROMOTE"
}
```

No se hardcodea identidad personal real.

## Whitelist De Eventos

Cada evento se normaliza a:

- `id`
- `title`
- `start`
- `end`

Se eliminan:

- tokens;
- credenciales;
- descripcion;
- asistentes;
- enlaces internos;
- metadata interna;
- campos no aprobados.

Un evento sin titulo se representa como:

```text
Evento sin titulo
```

## Reglas De Seguridad

- Calendar no se escribe en Knowledge Store.
- Calendar no se escribe en memoria.
- Calendar no se anade a `sources`.
- Calendar no se promociona.
- Calendar no cruza `clientId`.
- Calendar no habilita crear, modificar ni borrar eventos.
- La respuesta ejecutiva puede resumir agenda autorizada, pero no devuelve el payload completo.
- Para sensibilidad `critical`, no se devuelven conteos ni titulos.

## Prueba Manual

1. Tener OAuth Google configurado con Calendar readonly.
2. Arrancar el servidor existente.
3. Enviar:

```http
POST /api/executive/chat
Content-Type: application/json
```

```json
{
  "query": "Resume mi agenda de las proximas 24 horas.",
  "calendar": {
    "enabled": true,
    "clientId": "cliente-cero",
    "userId": "usuario-cliente-cero",
    "expectedClientId": "cliente-cero",
    "authorization": {
      "status": "granted"
    },
    "range": "next24Hours",
    "maxResults": 10
  }
}
```

4. Verificar:

- `privateContextUsed: true`;
- respuesta con resumen de agenda;
- `sources` sin eventos privados;
- ausencia de `path`, tokens y credenciales;
- no cambios en Knowledge Store ni memoria.

## Estado V1

Calendar Readonly Provider Cliente Cero V1 queda integrado como primer proveedor privado real para el Executive Brain oficial.

No crea otro Executive Brain, no crea otro conector Google Calendar, no modifica Knowledge Object V2, no toca `/api/chat`, no conecta operaciones write de Calendar y no persiste eventos privados.
