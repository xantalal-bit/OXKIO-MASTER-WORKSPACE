# EXECUTIVE BRAIN SPECIFICATION V1

## Proposito

Esta especificacion define el Executive Brain oficial de Oxkio como capa ejecutiva de consulta, razonamiento operativo y respuesta sobre el conocimiento persistido del ecosistema XANTALAL.

El Executive Brain utilizara exclusivamente el Knowledge Store como fuente oficial de conocimiento. Los conectores, documentos originales, caches, inventarios y pipelines no son fuentes directas de verdad para responder al usuario. Su funcion es alimentar el Knowledge Store mediante Knowledge Objects V2.

## Objetivo del Executive Brain

Responder preguntas ejecutivas del usuario usando Knowledge Objects V2 persistidos en el Knowledge Store, priorizando informacion trazable, vigente, relevante y compatible con los contratos oficiales del Knowledge Engine.

## Responsabilidades

- Recibir preguntas del usuario.
- Clasificar la intencion ejecutiva inicial de la consulta.
- Recuperar Knowledge Objects V2 relevantes desde el Knowledge Store.
- Usar metadata documental para filtrar y priorizar resultados.
- Construir respuestas ejecutivas claras, trazables y proporcionales a la evidencia disponible.
- Indicar incertidumbre cuando el Knowledge Store no contenga informacion suficiente.
- Diferenciar hechos encontrados, inferencias y recomendaciones.
- Mantener compatibilidad con Knowledge Object V2.
- No depender del formato original de documentos, emails, cursos o notas.

## Que NO debe hacer

- No leer documentos originales directamente.
- No consultar conectores directamente.
- No ejecutar Discovery como sustituto de recuperacion.
- No ejecutar Knowledge Pipeline durante una respuesta ordinaria.
- No modificar Knowledge Objects V2.
- No escribir en Knowledge Store durante la respuesta.
- No inventar hechos no presentes en el Knowledge Store.
- No ocultar incertidumbre.
- No crear agentes nuevos.
- No tomar decisiones irreversibles ni ejecutar acciones externas sin aprobacion.
- No usar fuentes no oficiales como base de conocimiento ejecutivo.

## Entradas

### ExecutiveBrainRequest

Contrato de entrada de una consulta ejecutiva.

```json
{
  "message": "Que decisiones tenemos pendientes sobre Learning Heroes?",
  "userId": "local-user",
  "context": {
    "locale": "es-ES",
    "timezone": "Europe/Madrid",
    "requestedAt": "2026-07-02T10:00:00.000Z"
  },
  "options": {
    "maxResults": 10,
    "includeSources": true
  }
}
```

Campos obligatorios:

- `message`

Campos opcionales:

- `userId`
- `context`
- `options`

Restricciones:

- `message` debe ser texto no vacio.
- `options.maxResults` debe limitar la cantidad de Knowledge Objects usados en la respuesta.
- `context` no debe sustituir al Knowledge Store como fuente de conocimiento.

## Salidas

### ExecutiveBrainResponse

Contrato de salida de una respuesta ejecutiva.

```json
{
  "answer": "No hay decisiones pendientes confirmadas sobre Learning Heroes en el Knowledge Store. Hay documentos clasificados como Learning, pero no contienen una decision explicita.",
  "queryType": "Decisions",
  "confidence": 0.62,
  "evidence": [
    {
      "knowledgeObjectId": "054b96b25d2a094035cad78cfe0780af04cb6670",
      "title": "Learning Heroes Module 01",
      "type": "Learning",
      "reason": "Coincidencia por tipo documental y contenido relacionado."
    }
  ],
  "uncertainty": {
    "hasUncertainty": true,
    "reason": "No se encontraron secciones o metadata especifica de decisiones."
  },
  "recommendedNextAction": "Revisar o enriquecer los Knowledge Objects de Learning Heroes con decisiones explicitas."
}
```

Campos obligatorios:

- `answer`
- `queryType`
- `confidence`
- `evidence`
- `uncertainty`

Campos opcionales:

- `recommendedNextAction`
- `filtersApplied`
- `missingKnowledge`

## Relacion con Knowledge Query Service

El Knowledge Query Service pertenece al proceso de descubrimiento y alimentacion del Knowledge Engine. Puede activar la cadena Discovery -> Inventory -> Pipeline para localizar y procesar activos.

El Executive Brain no debe depender de Knowledge Query Service para responder preguntas ordinarias si el conocimiento ya esta persistido. Su relacion correcta en V1 es:

- Knowledge Query Service alimenta o actualiza el Knowledge Store.
- Executive Brain consulta el Knowledge Store como fuente oficial.
- Si falta conocimiento, Executive Brain puede recomendar ejecutar una ingesta, pero no debe ejecutarla como parte implicita de la respuesta.

## Relacion con Knowledge Store

El Knowledge Store es la fuente oficial de conocimiento del Executive Brain.

Responsabilidades esperadas del Executive Brain frente al Store:

- Leer KnowledgeStoreRecords.
- Filtrar por metadata, contenido, tipo documental y ruta.
- Priorizar Knowledge Objects.
- Citar o referenciar objetos usados como evidencia.
- Tolerar objetos con metadata incompleta.

No debe:

- Persistir nuevos objetos.
- Reescribir objetos existentes.
- Depender de archivos runtime no gestionados por Knowledge Store.

## Relacion con Knowledge Objects V2

El Executive Brain consume Knowledge Objects V2 con los bloques:

- `identity`
- `technical`
- `content`
- `strategy`
- `metadata`

Metadata relevante para V1:

- `metadata.documentTypeClassification`
- `metadata.documentStructure`
- `metadata.generatedAt`
- `metadata.reviewed`

El Executive Brain puede usar `content.raw`, `content.summary`, `content.keywords`, `strategy` y `metadata`, pero no debe alterar su estructura.

## Flujo completo desde pregunta hasta respuesta

```text
Usuario
  |
  | ExecutiveBrainRequest.message
  v
Executive Brain
  |
  | 1. Normalizar pregunta
  | 2. Detectar tipo de consulta
  | 3. Construir plan de recuperacion
  v
Knowledge Store
  |
  | leer KnowledgeStoreRecords
  v
Knowledge Objects V2
  |
  | filtrar por tipo, contenido, metadata y estrategia
  v
Ranking ejecutivo
  |
  | priorizar evidencia por relevancia, confianza, actualidad y dominio
  v
Sintesis de respuesta
  |
  | separar hechos, inferencias, incertidumbre y recomendacion
  v
ExecutiveBrainResponse
  |
  v
Usuario
```

## Tipos de consultas soportadas inicialmente

### Decisions

Objetivo:

- Responder sobre decisiones registradas, pendientes, tomadas o ausentes.

Recuperacion:

- Buscar Knowledge Objects con senales de decisiones en `content.raw`, headings o listas.
- Priorizar tipos `Governance`, `Meeting`, `Notes` y `Roadmap`.

Respuesta:

- Identificar decision, estado, fuente y grado de certeza.

### Roadmaps

Objetivo:

- Responder sobre fases, prioridades, hitos, estado y proximos pasos.

Recuperacion:

- Priorizar `DocumentTypeClassification.type = "Roadmap"`.
- Usar headings, listas y contenido con senales como `fase`, `estado`, `pendiente`, `en curso`.

Respuesta:

- Resumir estado actual, siguiente fase y bloqueos conocidos.

### Documentation

Objetivo:

- Responder preguntas sobre documentacion tecnica, guias, README o procedimientos.

Recuperacion:

- Priorizar `Documentation`.
- Usar estructura: headings, listas, links, codeBlocks.

Respuesta:

- Dar una respuesta operacional y citar documentos base.

### Learning Heroes

Objetivo:

- Responder sobre conocimiento, cursos, modulos, notas y contenidos Learning Heroes.

Recuperacion:

- Priorizar Knowledge Objects de tipo `Learning`.
- Filtrar por rutas, nombres o contenido relacionado con Learning Heroes.

Respuesta:

- Sintetizar contenido aprendido, modulos disponibles y lagunas de conocimiento.

### Pending Tasks

Objetivo:

- Detectar tareas pendientes, proximos pasos o acciones abiertas.

Recuperacion:

- Buscar senales en contenido y listas: `pendiente`, `tarea`, `todo`, `next step`, `accion`, `action items`.
- Priorizar `Meeting`, `Roadmap`, `Notes` y `Governance`.

Respuesta:

- Distinguir tareas explicitas de inferencias.

### Executive Summaries

Objetivo:

- Producir resumen ejecutivo de un proyecto, area o fuente.

Recuperacion:

- Combinar tipos relevantes por consulta.
- Priorizar objetos de alta relevancia, recientes y con metadata de clasificacion clara.

Respuesta:

- Incluir situacion actual, riesgos, decisiones, tareas y recomendacion.

## Estrategia de recuperacion de conocimiento

La recuperacion V1 debe ser determinista y trazable:

1. Normalizar la pregunta.
2. Detectar tipo de consulta.
3. Construir filtros iniciales:
   - tipo documental
   - palabras clave
   - ruta o nombre
   - dominio o proyecto si aparece
4. Leer registros del Knowledge Store.
5. Evaluar coincidencias en:
   - `identity.name`
   - `identity.path`
   - `content.raw`
   - `content.summary`
   - `content.keywords`
   - `strategy`
   - `metadata.documentTypeClassification`
   - `metadata.documentStructure.headings`
6. Rankear resultados.
7. Seleccionar evidencia maxima segun `options.maxResults`.

## Estrategia de priorizacion

Orden recomendado de prioridad:

1. Coincidencia directa con tipo de consulta.
2. Coincidencia de entidad o proyecto mencionado.
3. Tipo documental mas fiable para la pregunta.
4. Mayor confianza en `DocumentTypeClassification.confidence`.
5. Metadata revisada si `metadata.reviewed = true`.
6. Actualidad por `technical.modifiedAt` o `storedAt`.
7. Densidad de senales en headings, listas y contenido.

Tipos preferentes por consulta:

- Decisions: `Governance`, `Meeting`, `Notes`
- Roadmaps: `Roadmap`, `Governance`
- Documentation: `Documentation`
- Learning Heroes: `Learning`
- Pending Tasks: `Meeting`, `Roadmap`, `Notes`
- Executive Summaries: combinacion priorizada por entidad consultada

## Reglas para respuestas con incertidumbre

El Executive Brain debe declarar incertidumbre cuando:

- No encuentre Knowledge Objects relevantes.
- Encuentre objetos relevantes pero sin evidencia directa.
- Existan senales contradictorias.
- La clasificacion tenga baja confianza.
- La pregunta requiera conocimiento no persistido.
- El dato parezca inferido y no explicitamente documentado.

Reglas de respuesta:

- No convertir inferencias en hechos.
- Usar frases como `No consta en el Knowledge Store`, `Hay indicios`, `No hay evidencia suficiente`.
- Recomendar ingesta, revision o enriquecimiento si falta conocimiento.
- Incluir evidencia cuando `includeSources = true`.
- Reducir `confidence` cuando la respuesta dependa de contenido parcial.

## Contratos de entrada y salida

### ExecutiveBrainRequest

```json
{
  "message": "Resumen ejecutivo del roadmap de XANTALAL",
  "userId": "local-user",
  "context": {
    "locale": "es-ES",
    "timezone": "Europe/Madrid",
    "requestedAt": "2026-07-02T10:00:00.000Z"
  },
  "options": {
    "maxResults": 8,
    "includeSources": true
  }
}
```

### ExecutiveBrainResponse

```json
{
  "answer": "El roadmap de XANTALAL esta en fase de gobierno y plataforma de conocimiento. La prioridad documentada es consolidar runtime, registry, discovery, curator, index y search.",
  "queryType": "Roadmaps",
  "confidence": 0.84,
  "evidence": [
    {
      "knowledgeObjectId": "knowledge-object-id",
      "title": "MASTER-ROADMAP-XANTALAL.md",
      "type": "Roadmap",
      "reason": "Documento clasificado como Roadmap con headings y contenido coincidente."
    }
  ],
  "uncertainty": {
    "hasUncertainty": false,
    "reason": null
  },
  "recommendedNextAction": "Revisar tareas pendientes de la fase Knowledge Platform."
}
```

## Futuras ampliaciones

- Indice de busqueda sobre Knowledge Store.
- Recuperacion por embeddings si se aprueba una fase posterior con IA.
- Validacion formal de respuestas contra evidencia.
- Historial de preguntas y respuestas.
- Seguimiento de decisiones y tareas como estructuras V2.x.
- Scoring configurable por proyecto o dominio.
- Integracion con aprobaciones supervisadas.
- Modo auditoria con trazabilidad completa de cada respuesta.
- Respuestas multifuente con comparacion entre Knowledge Objects.
- Soporte de Knowledge Object V2.1, V2.2, V2.3 y V2.4.

## Estado V1

Executive Brain Specification V1 define el comportamiento objetivo de la capa ejecutiva sobre Knowledge Store. Cualquier implementacion debe mantener el principio central: el Executive Brain responde desde Knowledge Objects V2 persistidos, no desde fuentes originales ni rutas paralelas.
