# KNOWLEDGE CONTRACTS SPECIFICATION V1

## Proposito

Esta especificacion define los contratos de datos que circulan por el Knowledge Engine del ecosistema XANTALAL segun la implementacion existente.

El objetivo es fijar una base estable para Discovery, Knowledge Inventory, Knowledge Pipeline, Knowledge Object V2, clasificacion documental, extraccion estructural, persistencia y almacenamiento.

## Alcance

Contratos documentados:

1. DiscoveryResult
2. KnowledgeInventory
3. Asset
4. Document
5. DocumentCatalog
6. KnowledgeCache
7. KnowledgeObject V2
8. DocumentTypeClassification
9. DocumentStructure
10. PersistenceResult
11. KnowledgeStoreRecord

Esta especificacion no introduce componentes nuevos.

## Principios generales

- Los contratos deben reflejar datos reales producidos por la implementacion actual.
- Los campos nuevos futuros deben anadirse sin eliminar campos existentes.
- Los consumidores deben tolerar campos adicionales.
- Los productores no deben cambiar el significado de campos existentes.
- Los Knowledge Objects generados son datos runtime y no deben versionarse.
- Knowledge Object V2 es el contrato central de intercambio semantico.

## Flujo completo de intercambio

```text
OneDrive Connector
  -> folders[]

Discovery Engine
  -> DiscoveryResult

Knowledge Inventory
  -> KnowledgeInventory
  -> Asset[]

Asset Locator
  -> Asset

Knowledge Pipeline
  -> Document[]
  -> DocumentCatalog
  -> KnowledgeCache[]

Universal Knowledge Curator
  -> KnowledgeObject V2

Document Type Classifier
  -> DocumentTypeClassification
  -> KnowledgeObject.metadata.documentTypeClassification

Document Structure Extractor
  -> DocumentStructure
  -> KnowledgeObject.metadata.documentStructure

Knowledge Persistence
  -> PersistenceResult

Knowledge Store
  -> KnowledgeStoreRecord
```

## Relaciones entre contratos

- `DiscoveryResult.assets[]` contiene objetos `Asset`.
- `KnowledgeInventory.assets[]` conserva los objetos `Asset` reconocidos o no clasificados.
- `Asset.name` se usa para localizar una carpeta documental.
- `DocumentCatalog.folder` procede del resultado de localizacion documental.
- `DocumentCatalog.summary.totalItems` procede del resultado de `DocumentDiscovery`.
- `KnowledgeCache[]` se deriva de `Document[]` filtrando solo documentos con `type: "file"`.
- `KnowledgeObject V2.identity` se deriva de `Document`.
- `DocumentTypeClassification` se deriva de `Document` y `KnowledgeObject V2`.
- `DocumentStructure` se deriva de `KnowledgeObject V2.content.raw`.
- `PersistenceResult` describe si el `KnowledgeObject V2` fue guardado o ya existia.
- `KnowledgeStoreRecord` es el `KnowledgeObject V2` persistido con campos runtime adicionales.

## 1. DiscoveryResult

### Proposito

Representar el resultado del descubrimiento y reconocimiento inicial de carpetas o fuentes documentales.

### Productor

- `discoverAndRecognizeFolders(folders)` en `backend/services/knowledge/discovery-engine.js`

### Consumidor

- `buildKnowledgeInventory(discoveryResult)` en `backend/services/knowledge/knowledge-inventory.js`

### Campos obligatorios

- `version`: version del contrato.
- `totalFolders`: numero total de carpetas evaluadas.
- `recognizedCount`: numero de activos reconocidos.
- `unclassifiedCount`: numero de activos no clasificados.
- `assets`: lista de `Asset`.

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- `version` debe ser string.
- `totalFolders`, `recognizedCount` y `unclassifiedCount` deben ser numeros enteros no negativos.
- `assets` debe ser array.
- `recognizedCount + unclassifiedCount` debe corresponder con `totalFolders`.

### Compatibilidad futura

- Se pueden anadir campos como `generatedAt`, `source` o `errors`.
- No se debe cambiar el significado de `assets`.
- Los consumidores deben ignorar campos desconocidos.

### Ejemplo JSON

```json
{
  "version": "1.0",
  "totalFolders": 3,
  "recognizedCount": 2,
  "unclassifiedCount": 1,
  "assets": [
    {
      "name": "XANTALAL",
      "recognized": true,
      "assetType": "organization",
      "priority": "critical",
      "domain": "governance",
      "status": "recognized"
    }
  ]
}
```

## 2. KnowledgeInventory

### Proposito

Representar un inventario operativo de conocimiento disponible y sugerir un activo prioritario de analisis.

### Productor

- `buildKnowledgeInventory(discoveryResult)` en `backend/services/knowledge/knowledge-inventory.js`

### Consumidor

- `locateAsset(assetName, knowledgeInventory)` en `backend/services/knowledge/asset-locator.js`
- `searchKnowledge(assetName)` en `backend/services/knowledge/knowledge-query-service.js`

### Campos obligatorios

- `version`
- `generatedAt`
- `summary`
- `assets`
- `recommendation`

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- `generatedAt` debe ser string ISO 8601.
- `summary.totalFolders`, `summary.recognizedAssets` y `summary.unclassifiedAssets` deben ser numeros.
- `assets` debe ser array de `Asset`.
- `recommendation.priorityAsset` puede ser string o `null`.
- `recommendation.message` debe ser string.

### Compatibilidad futura

- Se pueden anadir estados de sincronizacion, historico o metricas.
- `summary` debe mantener los contadores existentes.
- `assets` debe seguir siendo array.

### Ejemplo JSON

```json
{
  "version": "1.0",
  "generatedAt": "2026-07-02T10:00:00.000Z",
  "summary": {
    "totalFolders": 3,
    "recognizedAssets": 2,
    "unclassifiedAssets": 1
  },
  "assets": [
    {
      "name": "OXKIO",
      "recognized": true,
      "assetType": "project",
      "priority": "critical",
      "domain": "executive",
      "status": "recognized"
    }
  ],
  "recommendation": {
    "priorityAsset": "OXKIO",
    "message": "Comenzar el analisis por OXKIO."
  }
}
```

## 3. Asset

### Proposito

Representar una carpeta o entidad reconocida como activo potencial de conocimiento.

### Productor

- `recognizeAsset(folder)` en `backend/services/knowledge/recognition-engine.js`

### Consumidor

- `KnowledgeInventory`
- `locateAsset(assetName, knowledgeInventory)`
- `runKnowledgePipeline(asset)`
- `locateDocuments(asset, folders)`

### Campos obligatorios

- `name`
- `recognized`
- `assetType`
- `priority`
- `domain`
- `status`

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- `name` debe corresponder al nombre de carpeta descubierto.
- `recognized` debe ser booleano.
- `priority` usa actualmente `critical`, `high` o `normal`.
- `status` usa actualmente `recognized` o `unclassified`.
- Un activo no reconocido debe usar `assetType: "unknown"` y `domain: "unknown"`.

### Compatibilidad futura

- Se pueden anadir `id`, `source`, `owner` o `lastSync`.
- `name` debe mantenerse para compatibilidad con localizacion documental actual.

### Ejemplo JSON

```json
{
  "name": "KNOWLEDGE-CURATOR",
  "recognized": true,
  "assetType": "project",
  "priority": "high",
  "domain": "knowledge",
  "status": "recognized"
}
```

## 4. Document

### Proposito

Representar un item encontrado dentro de la carpeta documental de un activo.

### Productor

- `discoverDocuments(folder)` en `backend/services/knowledge/document-discovery.js`

### Consumidor

- `buildDocumentCatalog(discoveryResult)`
- `buildKnowledgeCache(documents)`
- `curateDocument(document)`
- `classifyDocumentType(document, knowledgeObject)`

### Campos obligatorios

- `name`
- `type`
- `extension`
- `path`

### Campos opcionales

- `source`, usado por `Universal Knowledge Curator` si existe.

### Restricciones

- `type` debe ser `file` o `directory`.
- `extension` debe ser string para archivos y `null` para directorios.
- `path` debe ser una ruta local accesible para lectura cuando `type` es `file`.

### Compatibilidad futura

- Se pueden anadir `size`, `lastModified`, `source` o `hash`.
- `type`, `name`, `extension` y `path` deben mantenerse.

### Ejemplo JSON

```json
{
  "name": "MASTER-ROADMAP-XANTALAL.md",
  "type": "file",
  "extension": ".md",
  "path": "C:\\Users\\janta\\OneDrive\\Documentos\\XANTALAL\\00_GOVERNANCE\\MASTER-ROADMAP-XANTALAL.md"
}
```

## 5. DocumentCatalog

### Proposito

Resumir el contenido documental encontrado dentro de una carpeta de activo.

### Productor

- `buildDocumentCatalog(discoveryResult)` en `backend/services/knowledge/document-catalog.js`

### Consumidor

- Resultado devuelto por `runKnowledgePipeline(asset)`.

### Campos obligatorios

- `generatedAt`
- `folder`
- `summary`
- `extensions`

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- `generatedAt` debe ser string ISO 8601.
- `folder` debe incluir `name` y `path`.
- `summary.totalItems`, `summary.files` y `summary.directories` deben ser numeros.
- `extensions` debe incluir contadores para `pdf`, `doc`, `docx`, `xlsx`, `txt`, `md`, `json` y `other`.

### Compatibilidad futura

- Se pueden anadir nuevos contadores de extension.
- Los contadores actuales deben mantenerse.

### Ejemplo JSON

```json
{
  "generatedAt": "2026-07-02T10:00:00.000Z",
  "folder": {
    "name": "XANTALAL",
    "path": "C:\\Users\\janta\\OneDrive\\Documentos\\XANTALAL"
  },
  "summary": {
    "totalItems": 4,
    "files": 3,
    "directories": 1
  },
  "extensions": {
    "pdf": 0,
    "doc": 0,
    "docx": 0,
    "xlsx": 0,
    "txt": 0,
    "md": 3,
    "json": 0,
    "other": 0
  }
}
```

## 6. KnowledgeCache

### Proposito

Representar una entrada operativa de cache para cada archivo descubierto.

### Productor

- `buildKnowledgeCache(documents)` en `backend/services/knowledge/knowledge-cache-registry.js`

### Consumidor

- Resultado devuelto por `runKnowledgePipeline(asset)`.

### Campos obligatorios

- `id`
- `path`
- `name`
- `extension`
- `size`
- `lastModified`
- `processed`
- `processedAt`
- `knowledgeVersion`

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- Solo se genera para documentos con `type: "file"`.
- `id` sigue el formato `knowledge-cache-0001`.
- `processed` se inicializa en `false`.
- `processedAt` se inicializa en `null`.
- `knowledgeVersion` se inicializa en `null`.

### Compatibilidad futura

- Se pueden anadir `hash`, `status`, `error` o `source`.
- `id`, `path` y `processed` deben mantenerse.

### Ejemplo JSON

```json
{
  "id": "knowledge-cache-0001",
  "path": "C:\\Users\\janta\\OneDrive\\Documentos\\XANTALAL\\00_GOVERNANCE\\MASTER-ROADMAP-XANTALAL.md",
  "name": "MASTER-ROADMAP-XANTALAL.md",
  "extension": ".md",
  "size": 2048,
  "lastModified": "2026-07-01T18:00:00.000Z",
  "processed": false,
  "processedAt": null,
  "knowledgeVersion": null
}
```

## 7. KnowledgeObject V2

### Proposito

Representar el formato universal de conocimiento consumido por el ecosistema XANTALAL.

### Productor

- `curateDocument(document)` en `backend/services/knowledge/universal-knowledge-curator.js`

### Consumidor

- `classifyDocumentType(document, knowledgeObject)`
- `extractDocumentStructure(knowledgeObject)`
- `persistKnowledgeObject(knowledgeObject)`
- futuros consumidores del Knowledge Engine.

### Campos obligatorios

Bloques obligatorios de V2:

- `identity`
- `technical`
- `content`
- `strategy`
- `metadata`

Campos de `identity`:

- `id`
- `source`
- `sourceType`
- `path`
- `name`
- `extension`
- `hash`
- `version`

Campos de `technical`:

- `size`
- `createdAt`
- `modifiedAt`
- `indexedAt`
- `language`
- `encoding`

Campos de `content`:

- `raw`
- `summary`
- `keywords`

Campos de `strategy`:

- `ecosystem`
- `primaryProject`
- `secondaryProjects`
- `strategicArea`
- `priority`
- `roadmapPhase`

Campos de `metadata`:

- `generatedBy`
- `generatedAt`
- `reviewed`
- `reviewer`

### Campos opcionales

Campos de enriquecimiento actuales dentro de `metadata`:

- `documentTypeClassification`
- `documentStructure`

Campos previstos por evolucion del estandar:

- `knowledge`
- `relationships`
- `intelligence`
- `memory`
- `history`

### Restricciones

- `identity.version` debe ser `"2.0"` para V2 actual.
- `content.raw` debe contener el texto bruto original.
- `content.keywords` debe ser array.
- `strategy.secondaryProjects` debe ser array.
- `metadata.generatedBy` identifica el productor.
- El contenido original no debe modificarse durante la curacion.

### Compatibilidad futura

- Las versiones V2.x deben mantener compatibilidad hacia atras.
- Los nuevos bloques deben ser aditivos.
- Si se rompe compatibilidad, debe existir migracion explicita.
- Consumidores deben tolerar campos desconocidos.

### Ejemplo JSON

```json
{
  "identity": {
    "id": null,
    "source": null,
    "sourceType": null,
    "path": "C:\\Users\\janta\\OneDrive\\Documentos\\XANTALAL\\00_GOVERNANCE\\MASTER-ROADMAP-XANTALAL.md",
    "name": "MASTER-ROADMAP-XANTALAL.md",
    "extension": ".md",
    "hash": null,
    "version": "2.0"
  },
  "technical": {
    "size": 2048,
    "createdAt": "2026-07-01T10:00:00.000Z",
    "modifiedAt": "2026-07-01T18:00:00.000Z",
    "indexedAt": null,
    "language": null,
    "encoding": "utf8"
  },
  "content": {
    "raw": "# MASTER ROADMAP XANTALAL\n\n## Fase 1\nEstado: EN CURSO",
    "summary": null,
    "keywords": []
  },
  "strategy": {
    "ecosystem": null,
    "primaryProject": null,
    "secondaryProjects": [],
    "strategicArea": null,
    "priority": null,
    "roadmapPhase": null
  },
  "metadata": {
    "generatedBy": "universal-knowledge-curator",
    "generatedAt": "2026-07-02T10:00:00.000Z",
    "reviewed": false,
    "reviewer": null
  }
}
```

## 8. DocumentTypeClassification

### Proposito

Representar la clasificacion determinista del tipo documental.

### Productor

- `classifyDocumentType(document, knowledgeObject)` en `backend/services/knowledge/document-type-classifier.js`

### Consumidor

- `Knowledge Pipeline`, que lo incorpora en `knowledgeObject.metadata.documentTypeClassification`.
- consumidores futuros de metadata documental.

### Campos obligatorios

- `type`
- `confidence`
- `reasons`
- `signals`

### Campos opcionales

- Ninguno en la salida raiz actual.

### Restricciones

- `type` debe ser uno de:
  - `Governance`
  - `Roadmap`
  - `Documentation`
  - `Learning`
  - `Meeting`
  - `Notes`
  - `Email`
  - `Generic`
- `confidence` debe ser numero.
- `reasons` debe ser array.
- `signals` debe incluir:
  - `fileName`
  - `path`
  - `extension`
  - `headings`
  - `matches`
  - `scores`
- La clasificacion V1 no debe usar IA ni llamadas externas.

### Compatibilidad futura

- Se pueden anadir `version`, `ruleSet`, `threshold` o `tieBreak`.
- La raiz debe mantener `type`, `confidence`, `reasons` y `signals`.
- Los tipos nuevos requieren una version posterior o actualizacion formal de contrato.

### Ejemplo JSON

```json
{
  "type": "Roadmap",
  "confidence": 0.95,
  "reasons": [
    {
      "ruleId": "roadmap-title-or-path",
      "reason": "Roadmap naming or title detected.",
      "weight": 5,
      "matches": [
        {
          "field": "fileName",
          "keyword": "roadmap"
        }
      ]
    }
  ],
  "signals": {
    "fileName": "MASTER-ROADMAP-XANTALAL.md",
    "path": "C:\\Users\\janta\\OneDrive\\Documentos\\XANTALAL\\00_GOVERNANCE\\MASTER-ROADMAP-XANTALAL.md",
    "extension": ".md",
    "headings": [
      "MASTER ROADMAP XANTALAL",
      "Fase 1"
    ],
    "matches": [
      {
        "type": "Roadmap",
        "ruleId": "roadmap-title-or-path",
        "matches": [
          {
            "field": "fileName",
            "keyword": "roadmap"
          }
        ]
      }
    ],
    "scores": {
      "Governance": 0,
      "Roadmap": 5,
      "Documentation": 0,
      "Learning": 0,
      "Meeting": 0,
      "Notes": 0,
      "Email": 0,
      "Generic": 0
    }
  }
}
```

## 9. DocumentStructure

### Proposito

Representar la estructura textual extraida de un Knowledge Object.

### Productor

- `extractDocumentStructure(knowledgeObject)` en `backend/services/knowledge/document-structure-extractor.js`

### Consumidor

- `Knowledge Pipeline`, que lo incorpora en `knowledgeObject.metadata.documentStructure`.
- consumidores futuros de indexacion, busqueda o analisis estructural.

### Campos obligatorios

- `headings`
- `lists`
- `links`
- `tables`
- `codeBlocks`

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- Todos los campos deben ser arrays.
- `headings[]` contiene `level` y `title`.
- `lists[]` contiene `text`.
- `links[]` contiene `url`.
- `tables[]` contiene `columnCount` y `rowCount`.
- `codeBlocks[]` contiene `language` y `code`.
- Si no hay contenido valido, todos los arrays deben devolverse vacios.

### Compatibilidad futura

- Se pueden anadir `sections`, `tasks`, `decisions` o `mentions`.
- Los arrays actuales deben mantenerse.

### Ejemplo JSON

```json
{
  "headings": [
    {
      "level": 1,
      "title": "MASTER ROADMAP XANTALAL"
    }
  ],
  "lists": [
    {
      "text": "Knowledge Runtime"
    }
  ],
  "links": [
    {
      "url": "https://example.com"
    }
  ],
  "tables": [
    {
      "columnCount": 3,
      "rowCount": 2
    }
  ],
  "codeBlocks": [
    {
      "language": "text",
      "code": "example"
    }
  ]
}
```

## 10. PersistenceResult

### Proposito

Representar el resultado de intentar persistir un Knowledge Object.

### Productor

- `persistKnowledgeObject(knowledgeObject)` en `backend/services/knowledge/knowledge-persistence-service.js`
- `saveKnowledgeObject(knowledgeObject)` en `backend/services/knowledge/knowledge-store.js`, cuando guarda correctamente.

### Consumidor

- `Knowledge Pipeline`, dentro de `persistedKnowledge`.

### Campos obligatorios

Para duplicados:

- `persisted`
- `reason`

Para guardado correcto:

- `saved`
- `id`
- `path`

### Campos opcionales

- Ninguno en la implementacion actual.

### Restricciones

- `reason` usa actualmente `already-exists`.
- `id` es SHA-1 segun la funcion actual.
- `path` apunta al JSON persistido en Knowledge Store.
- La forma de resultado no es uniforme actualmente entre duplicado y guardado correcto.

### Compatibilidad futura

- Se recomienda normalizar en una version futura con `status`, `saved`, `id`, `path` y `reason`.
- La version actual debe seguir aceptando ambas formas.

### Ejemplo JSON

Guardado correcto:

```json
{
  "saved": true,
  "id": "054b96b25d2a094035cad78cfe0780af04cb6670",
  "path": "C:\\Users\\janta\\OneDrive\\Documentos\\OXKIO\\backend\\data\\knowledge-store\\objects\\054b96b25d2a094035cad78cfe0780af04cb6670.json"
}
```

Duplicado:

```json
{
  "persisted": false,
  "reason": "already-exists"
}
```

## 11. KnowledgeStoreRecord

### Proposito

Representar el registro persistido en disco dentro del Knowledge Store.

### Productor

- `saveKnowledgeObject(knowledgeObject)` en `backend/services/knowledge/knowledge-store.js`

### Consumidor

- `getKnowledgeObject(id)` en `backend/services/knowledge/knowledge-store.js`
- consumidores futuros del store.

### Campos obligatorios

- Todos los campos del `KnowledgeObject V2` recibido.
- `id`
- `storedAt`

### Campos opcionales

- Campos opcionales o futuros heredados del `KnowledgeObject V2`.

### Restricciones

- Se guarda como JSON en `backend/data/knowledge-store/objects/{id}.json`.
- `storedAt` debe ser string ISO 8601.
- Los registros generados no deben versionarse en Git.
- El contrato actual anade `id` en raiz aunque `identity.id` pueda seguir siendo `null`.

### Compatibilidad futura

- Se puede mover o duplicar `id` hacia `identity.id` en una version futura con migracion.
- Se pueden anadir metadatos de store como `storeVersion`.
- Los consumidores deben tolerar campos adicionales.

### Ejemplo JSON

```json
{
  "identity": {
    "id": null,
    "source": null,
    "sourceType": null,
    "path": "C:\\Users\\janta\\OneDrive\\Documentos\\XANTALAL\\00_GOVERNANCE\\MASTER-ROADMAP-XANTALAL.md",
    "name": "MASTER-ROADMAP-XANTALAL.md",
    "extension": ".md",
    "hash": null,
    "version": "2.0"
  },
  "technical": {
    "size": 2048,
    "createdAt": "2026-07-01T10:00:00.000Z",
    "modifiedAt": "2026-07-01T18:00:00.000Z",
    "indexedAt": null,
    "language": null,
    "encoding": "utf8"
  },
  "content": {
    "raw": "# MASTER ROADMAP XANTALAL",
    "summary": null,
    "keywords": []
  },
  "strategy": {
    "ecosystem": null,
    "primaryProject": null,
    "secondaryProjects": [],
    "strategicArea": null,
    "priority": null,
    "roadmapPhase": null
  },
  "metadata": {
    "generatedBy": "universal-knowledge-curator",
    "generatedAt": "2026-07-02T10:00:00.000Z",
    "reviewed": false,
    "reviewer": null,
    "documentTypeClassification": {
      "type": "Roadmap",
      "confidence": 0.95,
      "reasons": [],
      "signals": {}
    },
    "documentStructure": {
      "headings": [],
      "lists": [],
      "links": [],
      "tables": [],
      "codeBlocks": []
    }
  },
  "id": "054b96b25d2a094035cad78cfe0780af04cb6670",
  "storedAt": "2026-07-02T10:01:00.000Z"
}
```

## Reglas de compatibilidad entre versiones

- V1 de esta especificacion documenta contratos existentes, no contratos ideales.
- Cualquier version V1.x debe ser aditiva.
- No se deben eliminar campos obligatorios sin version mayor.
- No se debe cambiar el tipo de un campo obligatorio sin migracion.
- Los consumidores deben ignorar campos desconocidos.
- Los productores deben conservar los campos existentes aunque esten temporalmente en `null`.
- Knowledge Object V2 debe evolucionar como V2.x manteniendo compatibilidad hacia atras.
- Si una version futura cambia IDs, ubicacion de store o estructura raiz, debe incluir migracion.

## Principios de evolucion

### Backward Compatibility

Un consumidor preparado para V1 debe poder leer contratos V1.x siempre que:

- Los campos obligatorios sigan presentes.
- Los tipos de datos existentes se conserven.
- Los valores `null` sigan permitidos donde la implementacion actual los usa.
- Los nuevos campos sean opcionales para consumidores existentes.

### Forward Tolerance

Un consumidor V1 debe:

- Ignorar campos desconocidos.
- No fallar por metadata adicional.
- No asumir que arrays futuros estaran vacios.
- No depender del orden de propiedades JSON.

### Evolucion controlada

Los cambios que requieren nueva version formal incluyen:

- Nuevos tipos documentales fuera de la lista actual.
- Cambio de forma de `PersistenceResult`.
- Cambio de ubicacion de `id` principal.
- Cambio de estructura de `KnowledgeObject V2`.
- Sustitucion de rutas locales por URIs de store.

## Politica de datos runtime

Los registros generados por Knowledge Store se guardan en:

```text
backend/data/knowledge-store/objects/*.json
```

Estos archivos son datos runtime y no deben versionarse. Solo debe versionarse:

```text
backend/data/knowledge-store/objects/.gitkeep
```

## Estado V1

Knowledge Contracts Specification V1 queda preparada como base oficial de contratos del Knowledge Engine. Las ampliaciones futuras deben declarar compatibilidad o version nueva.
