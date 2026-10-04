# OXKIO V3 — conversación ejecutiva integrada — evidencia 2026-10-04

## Decisión y alcance

Continuación autorizada por failover. Se reutilizó `exec-conversation`, rama `feat/oxkio-v3-executive-conversation`, inicialmente limpia y basada en `45c9ef01fab23d2727f8e34a92e4f598e2e03538` (main tras PR #25). No se creó otro runtime, proveedor ni endpoint. No merge, despliegue, consentimiento OAuth, nuevas credenciales, gasto real ni apertura familiar.

## Ejecución

Adaptive Planner usa Governed Reasoning y clasifica el JSON completo que sale. El piso predeterminado sigue CONFIDENTIAL; INTERNAL requiere configuración humana existente. Contexto privado y referencias personales elevan la clasificación. Answer/clarify no crean misión; plan pasa validación canónica y usa Mission Engine. Orientación general se separa de introspección técnica y de investigación pública explícita.

Contexto mínimo por propietario/conversación en el almacén sellado existente: objetivo, último turno y respuesta, procedencia, auditoría acotada y caducidad de 20 minutos. No se envía toda la memoria. Hazlo conserva aprobaciones; solo reanuda estados reanudables. Un workflow verificado evita repetir decisiones pagadas.

Verifier (corregido en la segunda pasada, ver abajo): cada hallazgo lleva una cita formada por frases completas y consecutivas de cada fuente que cita, y una afirmación fiel a esa cita (mismas cifras, mismas negaciones, salvedades conservadas y vocabulario mayoritariamente de la cita). Conclusión y comparación son inferencias sobre los hallazgos, sin cifras nuevas, y se presentan a la persona etiquetadas como inferencia. Esto comprueba fidelidad textual de los hallazgos, NO verdad universal ni la validez semántica de la inferencia. Las páginas públicas se recortan en su última frase completa dentro de 2000 caracteres.

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

## Segunda pasada de corrección (auditoría de Claude, 04/10/2026)

Hallazgos de la auditoría tras el failover y su corrección:

- P1 — Verifier: la primera versión exigía claim = quote = texto íntegro de la fuente, y conclusión/comparación = copia de los hallazgos. Eso anulaba el análisis (la respuesta repetía cada fuente tres veces) y no cabía en `SYNTHESIS_MAX_OUTPUT_TOKENS=2000` con fuentes reales. Ahora se aplica el diseño F6 descrito arriba; el límite de salida pasa a 4000; el claim va en el idioma de la cita para que su fidelidad sea verificable; la respuesta muestra «Valoración (inferencia…)», «Hallazgos» y «Comparación (inferencia)».
- P2 — «¿Qué puedes hacer?» vuelve a ser introspección técnica (diseño F2) y se restaura en su test. La orientación ejecutiva cubre «qué puedes hacer por mí», «en qué/cómo me puedes ayudar» y «por dónde empezamos».
- P2 — El TTL de 20 minutos limita solo el contexto que puede ver el modelo. El puntero a la última misión se conserva y se evalúa por su estado vivo, de modo que «continúa» o «ya lo he conectado» reanudan una misión `NEEDS_CONNECTION`, `WAITING_RESOURCE` o `PAUSED` aunque haya pasado el TTL. Una aprobación pendiente sigue sin concederse.
- P3 — Una petición BLOCKED se registra sin contenido; un «hazlo» posterior responde que sigue bloqueada, en lugar de recurrir a un objetivo anterior. Las misiones creadas por un plan conversacional se registran en su conversación.
- Nota: `FOLLOW_UP` del gateway no es código muerto (decide la reinstalación del adaptador al reconectar); se mantiene.

Evidencia de la segunda pasada:

- Tests del verifier reescritos (10): sustentan valoración y comparación inferidas; rechazan ID válido inventado, fragmento que omite una negación, cifra, negación o salvedad cambiadas, cita ausente en una fuente atribuida, cifras nuevas en la inferencia, enlaces e instrucciones de la fuente.
- Restaurados los fixtures con análisis real en continuidad cognitiva («conviene Alfa», «Son complementarios»).
- Nuevos: reanudación tras TTL más «hazlo» tras bloqueo; recorte de página por frase completa.
- Suite local secuencial (sin los 2 tests que lanzan PowerShell/lanzadores, no tocados aquí y ejecutados por CI): 1717 tests, 1701 PASS / 0 FAIL / 16 SKIP. Puerto 3000 de producción `ready` antes y después.
- F8 (1–2 llamadas reales a Luna dentro de B): NO ejecutado. La lectura de la clave del proveedor desde Secret Manager requiere una autorización explícita del operador para esta sesión. Llamadas reales: 0. Coste real: 0 USD.

## Estado operativo separado y siguiente

Checkout canónico comprobado limpio en `45c9ef0`. Al finalizar la primera pasada, el puerto 3000 rechazaba conexiones: la tarea programada había terminado con 0xC000013A (señal de consola) entre las 17:01 y las 17:33. No hay relación causal demostrable con esta PR, que no está desplegada. Se recuperó a las 18:04 relanzando la tarea existente, y se verificaron health, ready, 401, sellos, coste y logs. Esta PR no activa las mejoras en el servidor actual. Revisar la disponibilidad persistente por separado y obtener decisión humana antes de merge, restart/activación o despliegue. La beta familiar permanece cerrada.
