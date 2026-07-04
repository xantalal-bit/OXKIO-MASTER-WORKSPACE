# Multi Private Context Plan

Fecha: 2026-07-04

Estado: propuesta tecnica, no implementada

## Contexto

- Calendar privado V1 funciona.
- Gmail readonly privado V1 funciona.
- Executive Chat actualmente solo admite un contexto privado por peticion.

## Limitacion actual

- `buildOrchestratorOptions()` retorna Calendar antes de evaluar Gmail.
- Adapter, contract y orchestrator actuales tratan un unico contexto privado.

## Decision

- No forzar Calendar+Gmail dentro de un unico payload artificial.
- Disenar soporte explicito para multiples contextos privados.

## Reglas

- Cada contexto se valida individualmente.
- Todos deben compartir `clientId`, `userId` y `expectedClientId`.
- Todos deben ser `executive-briefing`.
- Todos deben mantener `NEVER_PROMOTE`.
- `sources` debe permanecer vacio si la respuesta se basa en privados.
- Limites visibles por fuente.

## Riesgos

- Mezcla accidental de datos privados.
- Inferencias sensibles al combinar correo+agenda.
- Cruce de cliente.
- Exposicion por `sources`, logs o memoria.

## Fase minima futura

- `privateContexts[]`.
- Tests de combinacion Calendar+Gmail.
- Respuesta ejecutiva combinada sin Knowledge Store noise.
