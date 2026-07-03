# PRIVATE CONTEXT CONTRACT CLIENTE CERO V1

## Proposito

Este documento define el contrato minimo de aislamiento privado para Cliente Cero y futuros clientes de Oxkio.

El contrato existe separado de Knowledge Object V2 para no contaminar el formato universal de conocimiento con datos privados de usuarios o clientes.

## Principio Fundamental

Los datos privados pertenecen al cliente.

Oxkio puede consultarlos para trabajar para ese cliente cuando exista autorizacion, pero:

- no los incorpora al conocimiento global;
- no los reutiliza para otros clientes;
- no los promociona automaticamente a plataforma;
- no mezcla scopes;
- no expone nombres de proyectos privados a otros clientes.

Los desarrollos funcionales, patrones tecnicos y capacidades reutilizables pueden pertenecer a XANTALAL/Oxkio Plataforma si estan separados de los datos privados.

## Contrato Minimo

Un contexto privado autorizado debe contener:

- `clientId`: identificador del cliente propietario del contexto.
- `userId`: identificador del usuario autorizado.
- `scope`: ambito de uso del contexto.
- `sensitivity`: sensibilidad del dato o contexto.
- `sourceType`: tipo de fuente.
- `sourceId`: identificador de la fuente autorizada.
- `authorization`: estado y metadatos de autorizacion.
- `purpose`: finalidad autorizada.
- `retentionPolicy`: regla de retencion.
- `promotionPolicy`: regla de promocion.

`clientId`, `userId`, `sourceType`, `sourceId` y `purpose` deben ser strings reales y no vacios tras `trim`.

No son validos:

- objetos;
- arrays;
- numeros;
- booleanos;
- `null`;
- `undefined`;
- strings vacios;
- strings compuestos solo por espacios.

## Scopes Oficiales V1

- `private:user`: datos privados de un usuario concreto.
- `private:client`: datos privados de un cliente.
- `private:project`: datos privados de un proyecto.
- `platform:knowledge`: conocimiento de plataforma gobernado.
- `platform:capability`: capacidad funcional reutilizable.
- `runtime:temporary`: contexto temporal de ejecucion.

## Sensibilidades Oficiales V1

- `normal`
- `internal`
- `confidential`
- `critical`

## Politica De Promocion

Reglas por defecto:

- `private:*` -> `NEVER_PROMOTE`
- `platform:knowledge` -> `GOVERNED_BY_KNOWLEDGE_RULES`
- `platform:capability` -> `REUSABLE_CAPABILITY`
- `runtime:temporary` -> `TEMPORARY_ONLY`

Ningun dato con scope privado puede promocionarse al conocimiento global.

Si un contexto `private:*` declara una politica de promocion distinta o promotable, la implementacion V1 normaliza siempre `promotionPolicy` a `NEVER_PROMOTE`.

Una capacidad funcional solo puede convertirse en plataforma si se separa de los datos privados y queda aprobada por gobierno.

## Politica De Retencion

Reglas por defecto:

- `private:*` -> `CLIENT_CONTROLLED`
- `platform:*` -> `GOVERNED`
- `runtime:temporary` -> `NO_PERSISTENCE_BY_DEFAULT`

## Reglas De Aislamiento

1. Todo contexto privado debe declarar `clientId`.
2. Todo contexto privado debe declarar `userId`.
3. Todo uso debe tener autorizacion concedida.
4. Todo uso debe tener finalidad explicita.
5. Un contexto de un cliente no puede usarse para otro cliente.
6. Los scopes privados no son promocionables.
7. El runtime temporal no es persistente por defecto.
8. Los nombres, proyectos y activos privados de Cliente Cero no deben exponerse a clientes finales.
9. Los clientes finales solo ven su asistente, su empresa, sus documentos y sus proyectos.
10. El contrato puede ser consumido por Executive Brain, integraciones, memoria, documentos y aprobaciones sin alterar Knowledge Object V2.
11. `prepareAuthorizedContext()` debe recibir `expectedClientId` cuando el scope sea `private:*`.
12. `expectedClientId` debe ser un string real y no vacio.

## Implementacion V1

Modulo:

```text
backend/services/private-context/private-context-contract.js
```

Responsabilidades:

- Validar contexto privado.
- Comprobar scope.
- Comprobar autorizacion.
- Impedir promocion de datos privados.
- Preparar contexto autorizado para futuros consumidores.
- Rechazar cruces de `clientId` incompatibles.

Tests:

```text
backend/services/private-context/private-context-contract.test.js
```

## Estado V1

Private Context Contract Cliente Cero V1 queda establecido como contrato minimo de aislamiento privado.

Este sprint no modifica Knowledge Object V2, no conecta Gmail ni Calendar, no ingiere documentos personales y no migra memoria existente.
