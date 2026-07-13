# Política de modelos GPT-5.6

## Estado y alcance

Decisión aprobada y de aplicación inmediata como criterio metodológico para XANTALAL/Oxkio. No modifica todavía llamadas reales a APIs ni autoriza una arquitectura paralela.

Este documento es la referencia canónica para seleccionar y escalar entre GPT-5.6 Luna, Terra y Sol.

## Asignación

- **Terra**: GPT-5.6 Terra será el modelo operativo preferente cuando esté disponible y autorizado en el producto, plan y entorno correspondiente. Si no está disponible, el orquestador seleccionará el mejor modelo aprobado equivalente y registrará el fallback.
- **Sol**: estrategia, arquitectura, auditorías críticas, seguridad, decisiones irreversibles, integración compleja y depuración difícil.
- **Luna**: clasificación, extracción, transformación, tareas repetitivas, alto volumen y bajo riesgo.

La elección debe considerar coste, dificultad, riesgo, urgencia, reversibilidad, privacidad y calidad requerida.

La disponibilidad debe verificarse por producto, cuenta y despliegue. Terra y Luna pueden no estar disponibles en conversaciones estándar de ChatGPT. Esta política define roles y preferencias, no garantiza acceso; no se configurarán llamadas reales ni se inventarán IDs de modelos habilitados.

## Supervisión y escalado

El escalado permitido es `Luna → Terra → Sol`. El Supervisor puede reasignar el modelo antes o durante una tarea.

El futuro orquestador de Oxkio deberá aplicar la preferencia y el fallback anteriores y escalar automáticamente ante baja confianza o alto riesgo, respetando disponibilidad, privacidad, permisos y supervisión. No se permite reducir de nivel cuando el riesgo o la irreversibilidad exijan uno superior solo para ahorrar coste o tiempo.

## Métricas futuras

Cuando exista enrutamiento real, cada ejecución deberá registrar de forma auditable:

- modelo solicitado;
- modelo realmente utilizado;
- motivo del fallback, cuando exista;
- coste;
- duración;
- calidad;
- errores;
- escalados.

La instrumentación deberá integrarse en el orquestador, supervisores y auditores existentes, sin crear un sistema paralelo y sin registrar contenido privado innecesario.
