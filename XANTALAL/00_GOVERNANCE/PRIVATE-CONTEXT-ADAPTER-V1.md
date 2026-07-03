# PRIVATE CONTEXT ADAPTER V1

## Proposito

Private Context Adapter V1 prepara contexto privado autorizado para futuros consumidores del Executive Brain oficial sin crear otro cerebro, sin persistir datos privados y sin mezclar datos de clientes con conocimiento global.

Este adaptador recibe datos ya obtenidos por proveedores autorizados futuros. No accede directamente a Gmail, Calendar, memoria, documentos ni Knowledge Store.

## Implementacion

Modulo:

```text
backend/services/private-context/private-context-adapter.js
```

Tests:

```text
backend/services/private-context/private-context-adapter.test.js
```

## Entradas

El adaptador recibe:

- `privateContext`: metadata validada mediante Private Context Contract Cliente Cero V1.
- `expectedClientId`: cliente autorizado esperado.
- `payload`: datos ya obtenidos por un proveedor autorizado.
- `allowedScopes`: scopes permitidos opcionales.
- `requiredPurpose`: finalidad requerida opcional.

## Reglas

- Todo contexto `private:*` debe pasar por el contrato G004.
- Todo contexto `private:*` requiere `expectedClientId`.
- Se rechaza `clientId` incompatible.
- Se rechaza payload ausente.
- Se rechaza payload `null`.
- Se rechaza payload primitivo.
- Se rechaza payload con tipos complejos o prototipos no seguros.
- El payload aceptado debe ser JSON-like simple.
- El payload de salida se clona en profundidad.
- El payload de salida se congela en profundidad para evitar mutacion accidental.
- No se escribe ningun archivo.
- No se escribe en Knowledge Store.
- No se escribe en memoria.
- No se llama al Executive Brain.
- No se ejecuta discovery ni ingesta.

## Contrato De Salida

El adaptador devuelve:

```json
{
  "clientId": "cliente-cero",
  "userId": "cliente-cero-user",
  "scope": "private:user",
  "sensitivity": "confidential",
  "sourceType": "authorized-provider",
  "sourceId": "provider-source",
  "purpose": "executive-context",
  "promotionPolicy": "NEVER_PROMOTE",
  "retentionPolicy": "CLIENT_CONTROLLED",
  "private": true,
  "persistable": false,
  "promotable": false,
  "authorized": true,
  "payload": {}
}
```

## Payload Permitido

El payload raiz solo puede ser:

- plain object con prototipo `Object.prototype`;
- plain object con prototipo `null`;
- array simple.

Los valores internos solo pueden ser:

- string;
- number;
- boolean;
- `null`;
- plain object;
- array.

Se rechazan:

- `Date`;
- `Map`;
- `Set`;
- `Function`;
- instancias de clase;
- objetos con prototipo distinto de `Object.prototype` o `null`;
- valores raiz primitivos;
- `undefined`;
- `null` como payload raiz.

El adaptador no conserva referencias compartidas con el input original.

## Semantica Por Scope

### private:*

- `private`: `true`
- `persistable`: `false`
- `promotable`: `false`
- `promotionPolicy`: `NEVER_PROMOTE`

### platform:capability

- `private`: `false`
- `persistable`: `true`
- `promotable`: `true`
- `promotionPolicy`: `REUSABLE_CAPABILITY`

La reutilizacion aplica a la capacidad funcional, no a datos privados.

### runtime:temporary

- `private`: `false`
- `persistable`: `false`
- `promotable`: `false`
- `retentionPolicy`: `NO_PERSISTENCE_BY_DEFAULT`

## Estado V1

Private Context Adapter V1 queda preparado como puente minimo entre proveedores autorizados futuros y consumidores ejecutivos posteriores.

No modifica Knowledge Object V2, no modifica rutas API, no conecta Gmail ni Calendar y no migra memoria.
