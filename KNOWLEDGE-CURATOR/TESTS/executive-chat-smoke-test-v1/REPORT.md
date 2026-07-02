# Executive Chat Smoke Test V1

## T051-FIX-2 Corrected Run

### Scope

Corrected smoke test after reducing false positives in Executive Brain Simulation.

Changes validated:

- Spanish stopwords and short terms are ignored by deterministic matching.
- Generic/nonexistent queries require meaningful evidence.
- Temporary Knowledge Object V2 fixtures are removed after the run.

Runtime checks:

- `STORE_CHANGED=false`
- `T051_FIXTURES_LEFT=0`

### Result Summary

- Backend started successfully.
- `POST /api/executive/chat` returned HTTP 200 for all 6 queries.
- 5 of 6 queries returned `confidence > 0.2`.
- 5 of 6 queries returned non-empty `sources`.
- The nonexistent query returned no sources and low confidence.
- Limitations are coherent.

### Test Results

#### 1. Learning Heroes

- Confidence: `0.88`
- Sources: `learning-heroes-smoke.md`
- Time: `58 ms`
- Result: PASS

#### 2. Oxkio Decisions

- Confidence: `0.9`
- Sources: `oxkio-decisions-smoke.md`, `governance-tasks-smoke.md`
- Time: `6 ms`
- Result: PASS

#### 3. Roadmap

- Confidence: `0.7`
- Sources: `roadmap-smoke.md`
- Time: `4 ms`
- Result: PASS

#### 4. Pending Tasks

- Confidence: `0.7`
- Sources: `governance-tasks-smoke.md`, `oxkio-decisions-smoke.md`, `roadmap-smoke.md`
- Time: `4 ms`
- Result: PASS

#### 5. Business Hunter Documentation

- Confidence: `0.88`
- Sources: `business-hunter-docs-smoke.md`
- Time: `5 ms`
- Result: PASS

#### 6. Nonexistent Query

- Confidence: `0.2`
- Sources: `[]`
- Limitations include: `No sufficient evidence was found in the Knowledge Store.`
- Time: `4 ms`
- Result: PASS

### Findings

Functional checks:

- Evidence-backed responses work for controlled V2 fixtures.
- The previous false positive for nonexistent queries is fixed.
- Runtime store was restored after fixture cleanup.

Issues found:

- No blocking issues.
- The endpoint still uses the simulation layer, so answers remain intentionally generic.

### Recommendation

APROBAR

## T051-FIX Corrected Run

### Scope

Corrected smoke test using controlled temporary Knowledge Object V2 fixtures.

Temporary fixtures covered:

- Learning Heroes
- Oxkio decisions
- Roadmap
- Governance tasks
- Business Hunter documentation

Discovery was also pointed to a temporary root with project folders so Knowledge Query Service could resolve project names without ingesting permanent documents.

Final runtime cleanup:

- Temporary `t051-*.json` fixtures were removed.
- No `t051-*.json` files remain in `backend/data/knowledge-store/objects`.

### Corrected Result Summary

- Backend started successfully.
- `POST /api/executive/chat` responded with HTTP 200 for all 6 queries.
- 5 of 6 queries returned `confidence > 0.2`.
- 5 of 6 queries returned non-empty `sources`.
- Limitations remained coherent and marked simulation/no-AI behavior.
- UTF-8 requests worked correctly when sent by a UTF-8 Node client.

### Corrected Test Results

#### 1. Learning Heroes

Request:

```json
{
  "query": "¿Qué aprendimos en Learning Heroes?"
}
```

Response:

```text
Consulta simulada sobre Learning Heroes. Se encontraron 1 Knowledge Objects relevantes. Fuentes principales: learning-heroes-smoke.md.
```

Confidence:

- `0.88`

Sources:

- `learning-heroes-smoke.md`

Limitations:

- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.

Approximate response time:

- `51 ms`

#### 2. Oxkio Decisions

Request:

```json
{
  "query": "¿Qué decisiones existen sobre Oxkio?"
}
```

Response:

```text
Consulta simulada sobre Governance. Se encontraron 2 Knowledge Objects relevantes. Fuentes principales: oxkio-decisions-smoke.md, governance-tasks-smoke.md.
```

Confidence:

- `0.9`

Sources:

- `oxkio-decisions-smoke.md`
- `governance-tasks-smoke.md`

Approximate response time:

- `5 ms`

#### 3. Roadmap

Request:

```json
{
  "query": "Muéstrame el roadmap."
}
```

Response:

```text
Consulta simulada sobre Roadmap. Se encontraron 1 Knowledge Objects relevantes. Fuentes principales: roadmap-smoke.md.
```

Confidence:

- `0.7`

Sources:

- `roadmap-smoke.md`

Approximate response time:

- `4 ms`

#### 4. Pending Tasks

Request:

```json
{
  "query": "¿Qué tareas pendientes existen?"
}
```

Response:

```text
Consulta simulada sobre Pending Tasks. Se encontraron 3 Knowledge Objects relevantes. Fuentes principales: governance-tasks-smoke.md, oxkio-decisions-smoke.md, roadmap-smoke.md.
```

Confidence:

- `0.7`

Sources:

- `governance-tasks-smoke.md`
- `oxkio-decisions-smoke.md`
- `roadmap-smoke.md`

Approximate response time:

- `3 ms`

#### 5. Business Hunter Documentation

Request:

```json
{
  "query": "¿Qué documentación existe sobre Business Hunter?"
}
```

Response:

```text
Consulta simulada sobre Documentation. Se encontraron 2 Knowledge Objects relevantes. Fuentes principales: business-hunter-docs-smoke.md, oxkio-decisions-smoke.md.
```

Confidence:

- `0.9`

Sources:

- `business-hunter-docs-smoke.md`
- `oxkio-decisions-smoke.md`

Approximate response time:

- `3 ms`

#### 6. Nonexistent Query

Request:

```json
{
  "query": "Consulta inexistente para validar respuesta sin resultados."
}
```

Response:

```text
Consulta simulada sobre Generic. Se encontraron 1 Knowledge Objects relevantes. Fuentes principales: business-hunter-docs-smoke.md.
```

Confidence:

- `0.45`

Sources:

- `business-hunter-docs-smoke.md`

Approximate response time:

- `3 ms`

### Corrected Run Findings

Functional checks:

- Controlled evidence fixtures allowed Executive Chat to return useful sources.
- Required threshold was met: at least 4 of 6 queries returned sources and confidence above `0.2`.
- Actual result: 5 of 6 queries returned sources and confidence above `0.2`.

Issues found:

- The nonexistent query produced a false positive against `business-hunter-docs-smoke.md`.
- The false positive came from generic/common terms such as `para` and `sin` being matched by the deterministic simulation.
- Temporary fixture cleanup required elevated removal because OneDrive marked fixture files as reparse-point files.

### Corrected Recommendation

CORREGIR

Reason:

The corrected smoke test validates functional evidence for 5 of 6 queries, but the nonexistent-query false positive shows that the simulation needs stronger stop-word filtering or a minimum relevance threshold before Executive Chat can be approved.

## Scope

Functional smoke test for:

- `POST /api/executive/chat`

Backend was started with `KNOWLEDGE_DISCOVERY_ROOT` pointing to an empty temporary folder to prevent runtime Knowledge Store writes during the test.

Runtime store mutation check:

- `STORE_CHANGED=false`

## Result Summary

- Backend started successfully.
- Endpoint registered correctly.
- All requests returned HTTP 200.
- Response contract was present for all successful calls.
- No runtime Knowledge Store files were created or removed.
- No sources were returned for any query.
- All responses had low confidence: `0.2`.

## Test Results

### 1. Learning Heroes

Request:

```json
{
  "query": "¿Qué aprendimos en Learning Heroes?"
}
```

Response:

```text
No se encontraron Knowledge Objects relevantes para "¿Qué aprendimos en Learning Heroes? Learning Heroes learning aprendimos" en el Knowledge Store.
```

Confidence:

- `0.2`

Sources:

- `[]`

Limitations:

- No sufficient evidence was found in the Knowledge Store.
- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.
- Knowledge Query Service did not find project Learning Heroes.

Approximate response time:

- `42 ms`

### 2. Oxkio Decisions

Request:

```json
{
  "query": "¿Qué decisiones existen sobre Oxkio?"
}
```

Response:

```text
No se encontraron Knowledge Objects relevantes para "¿Qué decisiones existen sobre Oxkio? Oxkio decisions existen" en el Knowledge Store.
```

Confidence:

- `0.2`

Sources:

- `[]`

Limitations:

- No sufficient evidence was found in the Knowledge Store.
- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.
- Knowledge Query Service did not find project Oxkio.

Approximate response time:

- `3 ms`

### 3. Roadmap

Request:

```json
{
  "query": "Muéstrame el roadmap."
}
```

Response:

```text
No se encontraron Knowledge Objects relevantes para "Muéstrame el roadmap. roadmap muestrame" en el Knowledge Store.
```

Confidence:

- `0.2`

Sources:

- `[]`

Limitations:

- No sufficient evidence was found in the Knowledge Store.
- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.

Approximate response time:

- `2 ms`

### 4. Pending Tasks

Request:

```json
{
  "query": "¿Qué tareas pendientes existen?"
}
```

Response:

```text
No se encontraron Knowledge Objects relevantes para "¿Qué tareas pendientes existen? tasks existen" en el Knowledge Store.
```

Confidence:

- `0.2`

Sources:

- `[]`

Limitations:

- No sufficient evidence was found in the Knowledge Store.
- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.

Approximate response time:

- `1 ms`

### 5. Business Hunter Documentation

Request:

```json
{
  "query": "¿Qué documentación existe sobre Business Hunter?"
}
```

Response:

```text
No se encontraron Knowledge Objects relevantes para "¿Qué documentación existe sobre Business Hunter? Business Hunter documentation existe" en el Knowledge Store.
```

Confidence:

- `0.2`

Sources:

- `[]`

Limitations:

- No sufficient evidence was found in the Knowledge Store.
- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.
- Knowledge Query Service did not find project Business Hunter.

Approximate response time:

- `3 ms`

### 6. Nonexistent Query

Request:

```json
{
  "query": "Consulta inexistente para validar respuesta sin resultados."
}
```

Response:

```text
No se encontraron Knowledge Objects relevantes para "Consulta inexistente para validar respuesta sin resultados. consulta inexistente validar respuesta sin resultados" en el Knowledge Store.
```

Confidence:

- `0.2`

Sources:

- `[]`

Limitations:

- No sufficient evidence was found in the Knowledge Store.
- Simulation only: this is not the definitive Executive Brain.
- No AI is used.
- Only persisted Knowledge Objects are read.
- Answers are based on deterministic keyword and metadata matching.

Approximate response time:

- `2 ms`

## Findings

Functional checks:

- Endpoint is reachable.
- Endpoint accepts POST JSON payloads with `query`.
- Endpoint returns valid Executive Orchestrator response shape.
- UTF-8 requests work correctly when sent by a UTF-8 client.
- Runtime Knowledge Store was not modified.

Issues found:

- No query returned sources.
- All queries returned low confidence.
- Existing persisted Knowledge Objects appear insufficient for Executive Chat retrieval, likely because they do not yet contain enough V2 metadata or matching content for the simulation.
- Project queries report Knowledge Query Service not finding the project because Discovery was intentionally isolated to a temporary empty root to avoid runtime writes.

## Recommendation

CORREGIR

Reason:

The endpoint is functional, but the smoke test did not validate useful answers with sources. The next correction should load or persist representative V2 Knowledge Objects with classifier and structure metadata before approving Executive Chat behavior.
