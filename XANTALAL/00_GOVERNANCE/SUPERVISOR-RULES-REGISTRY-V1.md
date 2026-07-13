# SUPERVISOR RULES REGISTRY V1

## Proposito

Este registro define las reglas oficiales del Supervisor para Oxkio/XANTALAL.

Su objetivo es mantener el desarrollo ordenado, auditable y alineado con la arquitectura aprobada.

## Alcance

Estas reglas aplican a:

- Oxkio
- XANTALAL
- Knowledge Engine
- Knowledge Curator
- Executive Brain
- Codex
- procesos de validacion, auditoria, commit y cierre de hitos

## Reglas activas del Supervisor

1. Trabajar paso a paso, fase a fase.
2. No desviarse del sprint activo.
3. No crear componentes innecesarios.
4. Arquitectura antes de implementacion.
5. Validacion antes de auditoria.
6. Auditoria antes de commit.
7. Commit y push solo con cambios aprobados.
8. Backup al cerrar hitos importantes.
9. Antes de Git verificar carpeta:
   - `pwd`
   - `git status`
10. Separar:
   - codigo
   - configuracion
   - runtime
   - laboratorio `KNOWLEDGE-CURATOR`
   - gobernanza `XANTALAL`
11. No versionar archivos runtime.
12. No asumir acciones no confirmadas por el usuario.
13. Usar `npm.cmd` en PowerShell si `npm` falla por politica.
14. Cada 4-5 sprints hacer sprint de integracion.
15. Mantener salidas claras:
   - archivos creados
   - archivos modificados
   - tests
   - resumen ejecutivo
16. Si una auditoria recomienda `CORREGIR`, no aprobar ni hacer commit.
17. Si hay riesgo arquitectonico, detener y corregir antes de avanzar.
18. Oxkio debe seguir siendo orquestador, no un conjunto desordenado de agentes.
19. Knowledge Object V2 es contrato universal.
20. Executive Brain debe crecer modularmente.
21. El Supervisor y Knowledge Watcher, como guardián/avisador, deben mantener visible la propuesta aprobada `Knowledge Discovery & Intelligence Agent`, detectar oportunidades relacionadas y avisar de tecnologías, fuentes o cambios relevantes, evitando que quede fuera del roadmap. Esto no autoriza su implementación ni la creación de un sistema paralelo.
22. Aplicar la política `MODEL-GOVERNANCE-GPT-5-6.md`: Terra como preferente si está disponible y autorizado, con fallback aprobado y registrado si no lo está; Luna para bajo riesgo y alto volumen; Sol para alto riesgo, trabajo crítico o dificultad elevada. El Supervisor puede reasignar el modelo y debe exigir escalado ante baja confianza o alto riesgo.

## Reglas de Git

- No hacer commit sin aprobacion explicita.
- No hacer push sin aprobacion explicita.
- Antes de cualquier operacion Git relevante, verificar:
  - directorio actual con `pwd`
  - estado con `git status`
- No mezclar cambios de distintos sprints en un commit.
- No incluir archivos runtime, caches, logs, stores locales ni datos temporales.
- No revertir cambios del usuario sin autorizacion explicita.
- Si una auditoria recomienda `CORREGIR`, el estado no es apto para commit.
- Commit y push solo pueden ocurrir despues de:
  - implementacion completada
  - tests ejecutados
  - auditoria aprobada
  - aprobacion del usuario

## Reglas de Codex

- Ejecutar la tarea definida, no redefinir arquitectura.
- No crear agentes nuevos salvo instruccion explicita.
- No usar IA en componentes marcados como deterministas.
- No inventar componentes para resolver problemas puntuales.
- Mantener respuestas finales claras y trazables.
- Reportar siempre archivos creados, archivos modificados, tests y resumen cuando la tarea lo solicite.
- Si aparece un riesgo arquitectonico, detener avance funcional y proponer correccion.
- Si se detecta que una auditoria pide `CORREGIR`, no presentar el trabajo como aprobado.
- No asumir acciones no confirmadas por el usuario.
- No hacer commit por iniciativa propia.
- En PowerShell, si `npm` falla por politica, usar `npm.cmd`.

## Reglas de arquitectura

- Arquitectura antes de implementacion.
- No crear componentes duplicados.
- Reutilizar infraestructura existente siempre que sea coherente.
- Separar claramente:
  - codigo
  - configuracion
  - datos runtime
  - conocimiento persistido
  - laboratorio `KNOWLEDGE-CURATOR`
  - gobernanza `XANTALAL`
- Knowledge Object V2 es el contrato universal de conocimiento.
- No modificar Knowledge Object V2 sin version y migracion aprobadas.
- Knowledge Engine debe mantener su cadena oficial:
  - Discovery
  - Knowledge Inventory
  - Knowledge Query Service
  - Knowledge Pipeline
  - Universal Knowledge Curator
  - Document Type Classifier
  - Document Structure Extractor
  - Knowledge Persistence
  - Knowledge Store
- Executive Brain debe crecer modularmente:
  - primero analisis de consulta
  - despues recuperacion
  - despues ranking
  - despues respuesta
  - despues supervision y aprobaciones
- Oxkio debe actuar como orquestador y no degradarse en un conjunto desordenado de agentes.
- Cada 4-5 sprints debe planificarse un sprint de integracion para consolidar componentes.

## Reglas de cierre de sesion

- Cerrar hitos importantes con backup.
- Confirmar estado de Git antes de cierre:
  - `pwd`
  - `git status`
- Confirmar si existen archivos runtime no versionables.
- Resumir:
  - que se hizo
  - que archivos se crearon
  - que archivos se modificaron
  - que tests se ejecutaron
  - que queda pendiente
- No dejar procesos necesarios sin reportar.
- No cerrar como aprobado un sprint que tenga auditoria pendiente o recomendacion `CORREGIR`.
- Si hay riesgo arquitectonico abierto, documentarlo antes de avanzar a la siguiente fase.

## Estado V1

Supervisor Rules Registry V1 queda establecido como referencia oficial de reglas operativas para Oxkio/XANTALAL.

Toda evolucion futura debe preservar estas reglas o declarar explicitamente su sustitucion mediante una version posterior.
