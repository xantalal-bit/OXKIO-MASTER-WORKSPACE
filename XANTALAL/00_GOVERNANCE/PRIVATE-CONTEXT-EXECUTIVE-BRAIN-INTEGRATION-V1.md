# PRIVATE CONTEXT EXECUTIVE BRAIN INTEGRATION V1

## Proposito

Este documento define la integracion minima entre Private Context Adapter V1 y el Executive Brain V1 oficial.

La integracion permite que el Executive Brain reciba contexto privado autorizado como contexto de consulta, sin convertirlo en Knowledge Object, sin escribirlo en Knowledge Store y sin promocionarlo a conocimiento global.

## Linea Oficial

La linea tecnica oficial se mantiene:

- `backend/services/executive-brain`
- `backend/services/private-context`
- `backend/services/knowledge`
- `POST /api/executive/chat`

No se crea otro Executive Brain, store, ruta paralela ni arquitectura alternativa.

## Entradas Opcionales

El orquestador ejecutivo puede recibir:

- `query`
- `privateContextMetadata`
- `expectedClientId`
- `privatePayload`

Si no se recibe contexto privado, el flujo ejecutivo funciona como antes.

Si se recibe contexto privado, debe pasar siempre por `preparePrivateContextAdapter()`.

## Flujo Implementado

```text
Consulta del usuario
  |
  v
Executive Orchestrator oficial
  |
  | si existe contexto privado
  v
Private Context Adapter V1
  |
  | valida contrato G004
  | valida autorizacion
  | valida clientId
  | clona payload seguro
  v
Contexto privado autorizado de consulta
  |
  v
Executive Brain V1
  |
  | consulta Knowledge Store como fuente global oficial
  | mantiene contexto privado separado de sources
  v
Respuesta ejecutiva compatible
```

## Reglas De Aislamiento

- El contexto privado no se persiste.
- El contexto privado no se escribe en Knowledge Store.
- El contexto privado no se escribe en memoria.
- El contexto privado no se anade a `sources`.
- El contexto privado no se promociona a conocimiento global.
- El contexto privado no cruza `clientId`.
- El payload privado no se devuelve completo en la respuesta.
- Las fuentes devueltas se sanitizan por whitelist y no exponen rutas locales ni metadatos sensibles.
- La ruta `/api/executive/chat` solo transporta los campos opcionales al orquestador.
- Gmail, Calendar, documentos privados y memoria no se conectan en este sprint.

## Contrato De Respuesta

La respuesta ejecutiva conserva el contrato existente:

- `query`
- `analysis`
- `response`
- `confidence`
- `sources`
- `limitations`

Se anade metadata segura:

- `privateContextUsed`: `true` o `false`

No se devuelven:

- payload privado completo;
- credenciales;
- tokens;
- rutas locales;
- metadatos internos sensibles;
- datos privados innecesarios.

## Sources Sanitizadas

Las fuentes ejecutivas se devuelven solo con campos trazables y seguros:

- `id`
- `name`
- `type`
- `score`
- `rankingPosition`
- `reasons`

No se devuelven `path`, rutas absolutas, tokens, credenciales, metadata interna ni campos no aprobados.

## Uso Del Contexto Privado

En V1 el contexto privado se usa de forma minima para informar al flujo ejecutivo de que existe contexto autorizado relevante.

Para sensibilidad no critica, la respuesta puede incluir una referencia segura y agregada, por ejemplo:

```text
Contexto privado autorizado considerado: 2 elemento(s).
```

Esta referencia no convierte el payload en fuente global, no lo expone completo y no devuelve identificadores internos de fuente.

Para sensibilidad `critical`, la respuesta no incluye conteos de elementos:

```text
Contexto privado autorizado considerado.
```

## Estado V1

Private Context Executive Brain Integration V1 queda implementado como puente minimo entre contexto privado autorizado y Executive Brain oficial.

El siguiente paso natural es conectar proveedores autorizados reales para Cliente Cero, manteniendo el mismo contrato y sin mezclar datos privados con conocimiento global.
