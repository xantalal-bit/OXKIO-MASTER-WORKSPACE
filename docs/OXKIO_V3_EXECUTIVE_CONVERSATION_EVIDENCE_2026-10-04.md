# OXKIO V3 — conversación ejecutiva integrada — evidencia 2026-10-04

## Decisión y alcance

Continuación autorizada por failover. Se reutilizó `exec-conversation`, rama `feat/oxkio-v3-executive-conversation`, inicialmente limpia y basada en `45c9ef01fab23d2727f8e34a92e4f598e2e03538` (main tras PR #25). No se creó otro runtime, proveedor ni endpoint. No merge, despliegue, consentimiento OAuth, nuevas credenciales, gasto real ni apertura familiar.

## Ejecución

Adaptive Planner usa Governed Reasoning y clasifica el JSON completo que sale. El piso predeterminado sigue CONFIDENTIAL; INTERNAL requiere configuración humana existente. Contexto privado y referencias personales elevan la clasificación. Answer/clarify no crean misión; plan pasa validación canónica y usa Mission Engine. Orientación general se separa de introspección técnica y de investigación pública explícita.

Contexto mínimo por propietario/conversación en el almacén sellado existente: objetivo, último turno y respuesta, procedencia, auditoría acotada y caducidad de 20 minutos. No se envía toda la memoria. Hazlo conserva aprobaciones; solo reanuda estados reanudables. Un workflow verificado evita repetir decisiones pagadas.

Verifier exige igualdad textual entre afirmación, cita y texto completo de cada fuente citada. IDs válidos, números coincidentes o fragmentos aislados no certifican una inferencia. Conclusión/comparación solo combinan afirmaciones verificadas, o declaran evidencia insuficiente. Esto comprueba respaldo extractivo, NO verdad universal ni inferencias semánticas generales. Fuentes completas hasta 2000 caracteres; no se recortan para forzar aceptación.

Análisis requiere fuentes pertinentes; propuestas de organización requieren documentos/correo; lectura web requiere descubrimiento público directo. Toda ejecución material continúa deshabilitada.

## Evidencia

- Nuevos tests: 25 PASS / 0 FAIL / 0 SKIP, proveedor simulado y frontera HTTP local efímera.
- Suite completa secuencial: `node --test --test-concurrency=1`: 1750 total, 1734 PASS / 0 FAIL / 16 SKIP. Los SKIP corresponden a PostgreSQL aislado, Docker y Firestore Emulator no disponibles. No se declaran validados esos servicios.
- Una ejecución paralela previa mostró interferencia en fixtures del chat heredado. La ejecución secuencial completa pasó; no se modificó ese chat ni se atribuyó el fallo a una causa probada.
- Escenarios A/B: orientación útil e introspección real; cero misiones y cero llamadas.
- C/I: asesoramiento gobernado con ledger, sin misión operativa.
- D/G: objetivo personal y seguimiento mantienen privacidad, cero llamadas externas.
- E: continuidad pertinente, separación por usuario/conversación.
- F: investigación sin tema pide aclaración; hazlo no amplía autoridad.
- H: afirmación inventada con ID válido falla; fallback autorizado conserva respaldo.
- J: trabajo público usa misión, descubrimiento, fuentes y respuesta con referencias.
- Reinicio de composición fixture conserva contexto; manipulación de fila sellada falla cerrado.
- Regresiones: reutilización de workflow sin nueva llamada, falsas afirmaciones de envío rechazadas, fuente mayor de 600 caracteres conserva calificadores.
- Llamadas reales a Luna/proveedores: 0. Coste externo real: 0 USD. Los importes de tests son sintéticos; no se afirma calidad validada con modelo real.
- Escaneo de patrones de credenciales en los 12 archivos de código/tests cambiados: 0 coincidencias. Esto no sustituye una revisión humana general de secretos.
- `git diff --check`: PASS.

## Auditoría independiente

Revisor en solo lectura: no encontró P1 concreto de fuga entre propietarios o ampliación de autoridad. P1 de síntesis corregido con regresiones. P2 de límites de fuentes, doble llamada al reutilizar workflow y dos formas de falsa ejecución corregidos; revisor comprobó cierre por inspección. No quedan esos hallazgos abiertos.

## Estado operativo separado y siguiente

Checkout canónico comprobado limpio en `45c9ef0`. Al finalizar la suite, GET al puerto 3000 devuelve conexión rechazada y no se observa listener. No se reinició ni reconfiguró el servidor; causa pendiente, no atribuida a estos cambios. Esta PR no activa las mejoras en el servidor actual. Revisar la disponibilidad persistente por separado y obtener decisión humana antes de merge, restart/activación o despliegue. La beta familiar permanece cerrada.
