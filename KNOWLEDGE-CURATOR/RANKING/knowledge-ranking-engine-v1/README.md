# Knowledge Ranking Engine V1

## Objetivo
Motor determinista para ordenar Knowledge Objects antes de generar respuestas.

## Responsabilidad
- Recibe una lista de Knowledge Objects.
- Calcula un score determinista usando solo datos ya existentes.
- Devuelve la lista ordenada de mayor a menor score.

## Señales usadas
- coincidencia de keywords
- coincidencia de proyecto
- coincidencia de documentType
- coincidencia de nombre
- coincidencia de estructura documental

## Contrato de salida
Cada elemento rankeado devuelve:
- `id`
- `score`
- `rankingPosition`
- `reasons`

## Restricciones
- No usa IA.
- No accede al Knowledge Store.
- No modifica Knowledge Object V2.
- No crea agentes.
- No altera Executive Brain Simulation.

## Evolución futura
- Integración con el Executive Brain.
- Ajuste fino de pesos por tipo de consulta.
- Priorización contextual por proyecto o intención.
