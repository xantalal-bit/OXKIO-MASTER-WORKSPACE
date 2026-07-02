# Business Hunter Executive Dashboard V1

## Objetivo
Pantalla ejecutiva mínima para resumir Business Hunter usando el Executive Brain.

## Responsabilidad
- Consumir `POST /api/executive/chat`.
- Mostrar resumen ejecutivo, recomendación, confianza y fuentes.
- No acceder directamente a Business Hunter ni al Knowledge Store.

## Contrato de consumo
La pantalla envía:
```json
{
  "query": "Resumen ejecutivo de Business Hunter"
}
```

## Restricciones
- No usa IA.
- No crea agentes.
- No modifica Knowledge Object V2.
- No implementa lógica de negocio.

## Evolución futura
- Resúmenes por consulta variable.
- Filtros por tipo de fuente.
- Integración con otras pantallas ejecutivas.
