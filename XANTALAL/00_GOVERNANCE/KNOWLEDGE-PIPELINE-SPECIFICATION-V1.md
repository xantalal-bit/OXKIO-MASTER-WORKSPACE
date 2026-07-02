# KNOWLEDGE PIPELINE SPECIFICATION V1

## Proposito

Esta especificacion define el flujo oficial del Knowledge Pipeline del ecosistema XANTALAL segun la arquitectura existente.

El pipeline convierte activos documentales descubiertos en Knowledge Objects V2, los enriquece con metadatos deterministas y los persiste en el Knowledge Store local.

## Alcance

Componentes incluidos:

1. Discovery
2. Knowledge Inventory
3. Knowledge Query Service
4. Knowledge Pipeline
5. Universal Knowledge Curator
6. Document Type Classifier
7. Document Structure Extractor
8. Knowledge Persistence
9. Knowledge Store

Esta especificacion no introduce componentes nuevos.

## Principios

- Usar solo la arquitectura existente.
- Mantener Knowledge Object V2 como contrato de intercambio.
- Separar descubrimiento, curacion, clasificacion, extraccion estructural y persistencia.
- Mantener la clasificacion documental V1 como proceso determinista.
- No usar IA en el pipeline documental V1.
- No crear agentes para tareas de pipeline documental.
- No versionar Knowledge Objects generados.

## Flujo textual completo

```text
Knowledge Query Service
  |
  | searchKnowledge(assetName)
  v
Discovery
  |
  | discoverKnowledge()
  | - discoverTopLevelFolders()
  | - recognizeAssets()
  v
Knowledge Inventory
  |
  | buildKnowledgeInventory(discoveryResult)
  v
Asset Locator
  |
  | locateAsset(assetName, knowledgeInventory)
  v
Knowledge Pipeline
  |
  | runKnowledgePipeline(asset)
  v
Document Locator
  |
  | locateDocuments(asset, folders)
  v
Document Discovery
  |
  | discoverDocuments(folder)
  v
Document Catalog + Knowledge Cache
  |
  | buildDocumentCatalog(documentDiscovery)
  | buildKnowledgeCache(documentDiscovery.documents)
  v
Universal Knowledge Curator
  |
  | curateDocument(document)
  v
Document Type Classifier
  |
  | classifyDocumentType(document, knowledgeObject)
  v
Document Structure Extractor
  |
  | extractDocumentStructure(knowledgeObject)
  v
Knowledge Persistence
  |
  | persistKnowledgeObject(knowledgeObject)
  v
Knowledge Store
  |
  | saveKnowledgeObject(knowledgeObject)
  v
backend/data/knowledge-store/objects/*.json
```

## 1. Discovery

Modulo principal:

- `backend/services/knowledge/discovery-engine.js`

Modulos dependientes directos:

- `backend/services/knowledge/connectors/onedrive-connector.js`
- `backend/services/knowledge/recognition-engine.js`
- `backend/services/knowledge/knowledge-inventory.js`

### Objetivo

Descubrir fuentes o carpetas disponibles y reconocer activos conocidos del ecosistema XANTALAL.

### Responsabilidad

- Ejecutar descubrimiento de carpetas top-level desde OneDrive local.
- Aplicar reconocimiento de activos por nombre de carpeta.
- Calcular conteos de activos reconocidos y no clasificados.
- Entregar el resultado al Knowledge Inventory.

### Entradas

- Registro de fuentes, para `discoverAllSources(registry)`.
- Carpetas, para `discoverAndRecognizeFolders(folders)`.
- OneDrive local, para `discoverKnowledge()`.

### Salidas

- Lista de fuentes descubiertas con estado pendiente.
- Resultado de descubrimiento con:
  - `version`
  - `totalFolders`
  - `recognizedCount`
  - `unclassifiedCount`
  - `assets`
- Inventario de conocimiento cuando se ejecuta `discoverKnowledge()`.

### Dependencias

- OneDrive Connector para listar carpetas.
- Recognition Engine para reconocer activos.
- Knowledge Inventory para construir inventario operativo.

### Que NO debe hacer

- No leer contenido de documentos.
- No crear Knowledge Objects.
- No persistir datos.
- No clasificar tipo documental.
- No usar IA.

### Posibles errores

- Ruta OneDrive no disponible.
- Permisos insuficientes de lectura.
- Carpetas no reconocidas por reglas actuales.
- Estructura de registro incompleta.

### Futuras ampliaciones

- Descubrimiento incremental.
- Mas conectores registrados.
- Deteccion de cambios por fecha o hash.
- Reglas de reconocimiento configurables.

## 2. Knowledge Inventory

Modulo principal:

- `backend/services/knowledge/knowledge-inventory.js`

### Objetivo

Transformar un resultado de descubrimiento en un inventario resumido y accionable.

### Responsabilidad

- Calcular resumen del descubrimiento.
- Mantener lista de activos reconocidos y no clasificados.
- Seleccionar un activo prioritario segun prioridad `critical` o `high`.
- Generar una recomendacion inicial de analisis.

### Entradas

- Resultado de descubrimiento con:
  - `totalFolders`
  - `recognizedCount`
  - `unclassifiedCount`
  - `assets`

### Salidas

- Objeto de inventario con:
  - `version`
  - `generatedAt`
  - `summary`
  - `assets`
  - `recommendation`

### Dependencias

- Discovery Engine.
- Recognition Engine, indirectamente mediante los activos ya reconocidos.

### Que NO debe hacer

- No buscar archivos dentro de carpetas.
- No ejecutar pipeline documental.
- No leer ni persistir Knowledge Objects.
- No modificar prioridades originales de los activos.

### Posibles errores

- `assets` ausente o no iterable.
- Prioridades no reconocidas.
- Inventario sin activos reconocidos.

### Futuras ampliaciones

- Inventario historico.
- Scoring configurable de prioridad.
- Estado de sincronizacion por activo.
- Integracion con dashboard ejecutivo.

## 3. Knowledge Query Service

Modulo principal:

- `backend/services/knowledge/knowledge-query-service.js`

Modulos dependientes directos:

- `backend/services/knowledge/discovery-engine.js`
- `backend/services/knowledge/asset-locator.js`
- `backend/services/knowledge/knowledge-pipeline.js`

### Objetivo

Resolver una consulta por nombre de activo y ejecutar el pipeline documental sobre el primer activo encontrado.

### Responsabilidad

- Construir un inventario actualizado con `discoverKnowledge()`.
- Localizar activos por nombre con `locateAsset()`.
- Invocar `runKnowledgePipeline(asset)` cuando hay coincidencias.
- Devolver un resultado unificado de busqueda y pipeline.

### Entradas

- `assetName`: texto de busqueda del activo.

### Salidas

Si no encuentra activo:

- `found: false`

Si encuentra activo:

- `found: true`
- `asset`
- `pipeline`

### Dependencias

- Discovery Engine.
- Asset Locator.
- Knowledge Pipeline.

### Que NO debe hacer

- No seleccionar multiples activos para procesamiento simultaneo.
- No persistir directamente.
- No leer documentos directamente.
- No decidir reglas de curacion o clasificacion.

### Posibles errores

- Consulta vacia.
- Inventario sin activos.
- Coincidencias ambiguas; actualmente se procesa la primera coincidencia.
- Fallos heredados del pipeline.

### Futuras ampliaciones

- Seleccion explicita entre multiples coincidencias.
- Busqueda por dominio, tipo o prioridad.
- Filtros por estado de reconocimiento.
- Modo dry-run.

## 4. Knowledge Pipeline

Modulo principal:

- `backend/services/knowledge/knowledge-pipeline.js`

Modulos dependientes directos:

- `backend/services/knowledge/connectors/onedrive-connector.js`
- `backend/services/knowledge/document-locator.js`
- `backend/services/knowledge/document-discovery.js`
- `backend/services/knowledge/document-catalog.js`
- `backend/services/knowledge/knowledge-cache-registry.js`
- `backend/services/knowledge/universal-knowledge-curator.js`
- `backend/services/knowledge/document-type-classifier.js`
- `backend/services/knowledge/document-structure-extractor.js`
- `backend/services/knowledge/knowledge-persistence-service.js`

### Objetivo

Orquestar el procesamiento documental de un activo reconocido hasta obtener Knowledge Objects V2 enriquecidos y persistidos.

### Responsabilidad

- Localizar la carpeta documental del activo.
- Descubrir documentos dentro de la carpeta localizada.
- Crear catalogo documental.
- Crear cache operativo de documentos.
- Curar documentos soportados hacia Knowledge Object V2.
- Enriquecer cada Knowledge Object con clasificacion documental.
- Extraer estructura documental despues de clasificar.
- Persistir Knowledge Objects cuando no existen previamente.
- Devolver resultado completo del procesamiento.

### Entradas

- `asset`: activo reconocido, normalmente procedente del Knowledge Inventory.

### Salidas

Si no encuentra carpeta documental:

- `asset`
- `folder: null`
- `catalog: null`
- `cache: []`
- `knowledgeObjects: []`
- `persistedKnowledge: []`

Si encuentra carpeta:

- `asset`
- `folder`
- `catalog`
- `cache`
- `knowledgeObjects`
- `persistedKnowledge`

### Dependencias

- OneDrive Connector.
- Document Locator.
- Document Discovery.
- Document Catalog.
- Knowledge Cache Registry.
- Universal Knowledge Curator.
- Document Type Classifier.
- Document Structure Extractor.
- Knowledge Persistence.

### Que NO debe hacer

- No descubrir fuentes globales; eso corresponde a Discovery.
- No reconocer activos; eso corresponde a Recognition Engine.
- No definir reglas de clasificacion documental.
- No escribir directamente en disco; debe delegar en Knowledge Persistence.
- No crear agentes.
- No usar IA.

### Posibles errores

- Activo sin nombre.
- Carpeta no localizada.
- Fallos de lectura de directorio.
- Fallos de lectura o stat de archivos.
- Documentos con extension no soportada.
- Knowledge Object duplicado en store.

### Futuras ampliaciones

- Procesamiento incremental.
- Control de errores por documento sin detener todo el pipeline.
- Reporte de documentos omitidos.
- Hash real de contenido.
- Modo sin persistencia para auditoria.

## 5. Universal Knowledge Curator

Modulo principal:

- `backend/services/knowledge/universal-knowledge-curator.js`

### Objetivo

Convertir documentos soportados en Knowledge Objects compatibles con Knowledge Object V2.

### Responsabilidad

- Validar que la entrada sea un archivo.
- Aceptar extensiones soportadas:
  - `.md`
  - `.txt`
  - `.json`
- Leer contenido del archivo como UTF-8.
- Obtener estadisticas tecnicas del archivo.
- Construir los bloques V2:
  - `identity`
  - `technical`
  - `content`
  - `strategy`
  - `metadata`

### Entradas

- `document` con:
  - `name`
  - `type`
  - `extension`
  - `path`
  - `source`, opcional

### Salidas

Si no es soportado:

- `supported: false`
- `reason: unsupported-format`

Si es soportado:

- `supported: true`
- `knowledgeObject`

### Dependencias

- File system local.
- Contrato Knowledge Object V2.

### Que NO debe hacer

- No clasificar tipo documental.
- No extraer estructura documental.
- No resumir con IA.
- No persistir.
- No modificar el archivo original.
- No procesar extensiones no soportadas.

### Posibles errores

- Archivo inexistente.
- Permiso de lectura insuficiente.
- Error de codificacion.
- JSON invalido tratado como texto bruto.
- Extension soportada pero contenido corrupto.

### Futuras ampliaciones

- Calculo de hash de contenido.
- Deteccion de idioma.
- Soporte para PDF, DOCX y otros formatos mediante conectores o extractores autorizados.
- Extraccion controlada de resumen no generativo.

## 6. Document Type Classifier

Modulos principales:

- `backend/services/knowledge/document-type-classifier.js`
- `backend/services/knowledge/document-type-classifier-rules.js`

### Objetivo

Clasificar de forma determinista el tipo documental de un Knowledge Object antes de la extraccion estructural.

### Responsabilidad

- Construir senales desde:
  - nombre de archivo
  - ruta
  - extension
  - encabezados
  - contenido inicial
- Aplicar reglas locales trazables.
- Calcular puntuaciones por tipo.
- Devolver clasificacion con confianza, razones y senales.
- Usar solo tipos documentales permitidos:
  - `Governance`
  - `Roadmap`
  - `Documentation`
  - `Learning`
  - `Meeting`
  - `Notes`
  - `Email`
  - `Generic`

### Entradas

- `document`
- `knowledgeObject`

### Salidas

Objeto de clasificacion:

- `type`
- `confidence`
- `reasons`
- `signals`

En el pipeline actual se almacena en:

- `knowledgeObject.metadata.documentTypeClassification`

### Dependencias

- Reglas locales del clasificador.
- Knowledge Object V2 generado por Universal Knowledge Curator.
- Modulo `path` de Node.js para derivar nombres cuando sea necesario.

### Que NO debe hacer

- No usar IA.
- No llamar servicios externos.
- No persistir resultados por si mismo.
- No crear ni modificar Knowledge Objects fuera del enriquecimiento que realiza el pipeline.
- No introducir tipos fuera de la lista permitida.
- No sustituir el extractor de estructura.

### Posibles errores

- Falsos positivos por coincidencia de palabras clave.
- Documentos mixtos con senales de varios tipos.
- Baja confianza cuando no hay senales claras.
- Encabezados no detectados si el formato no es Markdown o texto plano reconocible.

### Futuras ampliaciones

- Reglas configurables por dominio.
- Umbrales explicitos por tipo.
- Auditoria de empates.
- Nuevas senales deterministas sin IA.
- Validacion contra corpus de prueba.

## 7. Document Structure Extractor

Modulo principal:

- `backend/services/knowledge/document-structure-extractor.js`

### Objetivo

Extraer estructura basica de documentos textuales desde el contenido bruto del Knowledge Object.

### Responsabilidad

- Leer `knowledgeObject.content.raw`.
- Detectar encabezados Markdown.
- Detectar listas simples.
- Detectar enlaces Markdown y URLs directas.
- Detectar tablas Markdown.
- Detectar bloques de codigo fenced.
- Devolver una estructura normalizada.

### Entradas

- `knowledgeObject` con `content.raw`.

### Salidas

Objeto estructural con:

- `headings`
- `lists`
- `links`
- `tables`
- `codeBlocks`

En el pipeline actual se almacena en:

- `knowledgeObject.metadata.documentStructure`

### Dependencias

- Knowledge Object V2.
- Contenido textual bruto.

### Que NO debe hacer

- No clasificar tipo documental.
- No leer archivos desde disco.
- No persistir.
- No resumir.
- No interpretar significado estrategico.
- No usar IA.

### Posibles errores

- Contenido vacio o no textual.
- Markdown mal formado.
- Tablas incompletas.
- Bloques de codigo sin cierre.
- URLs detectadas con puntuacion final no deseada.

### Futuras ampliaciones

- Soporte estructural para otros formatos.
- Extraccion de tareas, decisiones y riesgos.
- Normalizacion avanzada de tablas.
- Deteccion de secciones por tipo documental.

## 8. Knowledge Persistence

Modulo principal:

- `backend/services/knowledge/knowledge-persistence-service.js`

Modulo dependiente directo:

- `backend/services/knowledge/knowledge-store.js`

### Objetivo

Controlar la persistencia de Knowledge Objects y evitar duplicados segun identificador calculado.

### Responsabilidad

- Calcular identificador SHA-1.
- Comprobar si el Knowledge Object ya existe en el store.
- Devolver `already-exists` si ya esta persistido.
- Delegar guardado en Knowledge Store cuando no existe.

### Entradas

- `knowledgeObject`.

### Salidas

Si ya existe:

- `persisted: false`
- `reason: already-exists`

Si se guarda:

- Resultado de `saveKnowledgeObject()`, actualmente:
  - `saved: true`
  - `id`
  - `path`

### Dependencias

- Crypto de Node.js.
- Knowledge Store.

### Que NO debe hacer

- No decidir que documentos procesar.
- No modificar contenido del Knowledge Object.
- No generar catalogos.
- No leer documentos fuente.
- No exponer Knowledge Objects generados a versionado.

### Posibles errores

- Identificador pobre si el Knowledge Object no incluye ruta esperada.
- Inconsistencia si el calculo de ID difiere del usado por Knowledge Store.
- Fallo de escritura delegado al store.

### Futuras ampliaciones

- ID basado en `identity.path` y hash de contenido.
- Versionado controlado de Knowledge Objects.
- Politicas de actualizacion.
- Registro de historial de persistencia.

## 9. Knowledge Store

Modulo principal:

- `backend/services/knowledge/knowledge-store.js`

Directorio runtime:

- `backend/data/knowledge-store/objects`

### Objetivo

Guardar y recuperar Knowledge Objects en el sistema de archivos local.

### Responsabilidad

- Asegurar que existe el directorio de store.
- Calcular ruta de archivo por ID.
- Guardar Knowledge Objects como JSON.
- Anadir `id` y `storedAt` al objeto persistido.
- Recuperar Knowledge Objects por ID.
- Comprobar existencia por ID.

### Entradas

- `knowledgeObject`, para guardado.
- `id`, para recuperacion o comprobacion de existencia.

### Salidas

En guardado:

- `saved: true`
- `id`
- `path`

En recuperacion:

- Knowledge Object parseado.
- `null` si no existe.

En comprobacion:

- Booleano.

### Dependencias

- File system local.
- Crypto de Node.js.
- Directorio `backend/data/knowledge-store/objects`.

### Que NO debe hacer

- No descubrir documentos.
- No clasificar documentos.
- No validar semanticamente Knowledge Object V2.
- No decidir politicas de duplicado.
- No versionar archivos generados en Git.

### Posibles errores

- Permisos insuficientes de escritura.
- JSON corrupto en lectura.
- Ruta de store no disponible.
- ID calculado desde un campo no poblado.

### Futuras ampliaciones

- Validacion formal contra schema V2.
- Indices por tipo documental.
- Almacenamiento por fuente o activo.
- Migraciones entre versiones de Knowledge Object.
- Compactacion o archivado.

## Orden oficial de enriquecimiento documental

El orden actual dentro del Knowledge Pipeline es:

```text
curateDocument(document)
  -> classifyDocumentType(document, knowledgeObject)
  -> extractDocumentStructure(knowledgeObject)
  -> persistKnowledgeObject(knowledgeObject)
```

La clasificacion documental debe ejecutarse antes del Document Structure Extractor.

## Contrato Knowledge Object V2

El Universal Knowledge Curator crea objetos con los bloques:

- `identity`
- `technical`
- `content`
- `strategy`
- `metadata`

Los enriquecimientos actuales del pipeline se incorporan en `metadata`:

- `metadata.documentTypeClassification`
- `metadata.documentStructure`

Esto mantiene compatibilidad con Knowledge Object V2 sin alterar los bloques principales.

## Politica de versionado

Los Knowledge Objects generados se guardan en:

- `backend/data/knowledge-store/objects/*.json`

Estos archivos son datos runtime y no deben versionarse.

La politica actual de `.gitignore` debe mantener:

```text
backend/data/knowledge-store/objects/*.json
!backend/data/knowledge-store/objects/.gitkeep
```

## Estado V1

Knowledge Pipeline Specification V1 documenta el comportamiento existente del sistema. Cualquier ampliacion futura debe mantener compatibilidad con esta especificacion o declarar una version posterior.
