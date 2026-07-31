# ARQUITECTURA OBJETIVO MINIMA OXKIO V1

## Proposito

Este documento declara la arquitectura objetivo minima de Oxkio/XANTALAL tras la revision G001.

No sustituye la vision aprobada. Ordena la arquitectura existente, fija limites conceptuales y define la linea oficial provisional para continuar el desarrollo sin duplicar motores, mezclar datos privados ni confundir laboratorio con producto final.

Este documento queda subordinado a [G0001 Rev. A — Constitución de la Capa de
Coordinación Inteligente de XANTALAL / OXKIO](./G0001-REV-A-CONSTITUCION-CAPA-COORDINACION-INTELIGENTE-XANTALAL-OXKIO.md),
que actúa como Constitución superior. Ante contradicción, debe aplicarse la
precedencia declarada por G0001 Rev. A y registrarse la desviación sin ocultarla.

## 1. XANTALAL

XANTALAL es la empresa propietaria del ecosistema.

Responsabilidades:

- Definir gobierno, reglas y limites.
- Aprobar decisiones estrategicas.
- Mantener roadmap, backlog y arquitectura.
- Gestionar productos y desarrollos.
- Custodiar los contratos oficiales de plataforma.
- Decidir que capacidades pasan a producto.

XANTALAL contiene:

- Gobernanza.
- Roadmaps.
- Decisiones.
- Especificaciones.
- Contratos.
- Productos.
- Desarrollos aprobados.

XANTALAL no contiene:

- Datos privados de Jose.
- Datos privados de clientes finales.
- Correos personales.
- Agenda personal.
- Documentos privados.
- Credenciales.
- Runtime.
- Caches.
- Knowledge Objects generados.
- Logs operativos.

## 2. Oxkio Plataforma

Oxkio Plataforma es la base tecnica reutilizable del ecosistema XANTALAL.

Su objetivo es proporcionar motores, capacidades comunes, integraciones y componentes que puedan ser usados por Cliente Cero y futuros clientes finales sin mezclar datos privados entre ellos.

Componentes oficiales de plataforma:

- Knowledge Engine V2.
- Executive Brain V1.
- Executive Context.
- Executive Briefing.
- Conectores.
- Integraciones.
- Sistema de aprobaciones.
- Seguridad y auditoria.
- Clasificadores.
- Ranking.
- Persistencia controlada.
- Componentes comunes de interfaz.

Oxkio Plataforma puede contener:

- Codigo reutilizable.
- Motores.
- Contratos.
- Adaptadores.
- Plantillas.
- Reglas comunes.
- Capacidades funcionales aprobadas.

Oxkio Plataforma no contiene:

- Datos privados de Cliente Cero.
- Datos privados de clientes finales.
- Nombres internos visibles para clientes finales.
- Correos, agenda o documentos de usuarios concretos.
- Runtime privado.
- Knowledge Objects privados fuera de su espacio autorizado.

## 3. Cliente Cero

Cliente Cero es el primer espacio privado real de uso de Oxkio.

El Cliente Cero es Jose, con doble papel:

- Usuario final que debe poder usar Oxkio operativamente.
- Desarrollador y aprobador del ecosistema XANTALAL.

El espacio Cliente Cero debe contener un contexto privado y aislado:

- Identidad y preferencias de Jose.
- Correo autorizado.
- Agenda autorizada.
- Documentos privados.
- Proyectos propios.
- Memoria personal.
- Datos privados.
- Patrones aprendidos.
- Aprobaciones.
- Consultas operativas.
- Acciones supervisadas.

Reglas del Cliente Cero:

- Sus datos privados no pasan al conocimiento global.
- Sus proyectos internos no se muestran a otros clientes.
- Sus nombres internos no aparecen en experiencias de clientes finales.
- Sus patrones pueden mejorar su propia experiencia.
- Una capacidad funcional creada durante Cliente Cero puede convertirse en plataforma si se limpia de datos privados y se aprueba.

## 4. Clientes Finales

Cada cliente final tiene su propio espacio privado.

Reglas obligatorias:

- Cada cliente consulta solo su informacion autorizada.
- Los datos de cada cliente pertenecen a ese cliente.
- Los datos de clientes finales no se mezclan con XANTALAL.
- Los datos de clientes finales no se mezclan con Cliente Cero.
- Un cliente no ve proyectos, nombres ni activos internos de Jose.
- Un cliente no ve nombres internos como Learning Heroes, Business Hunter, Knowledge Curator o Executive Brain.
- Un cliente solo ve su asistente, su empresa, sus documentos, sus proyectos y sus acciones autorizadas.

La experiencia de clientes finales debe ocultar la arquitectura interna salvo necesidad tecnica, auditoria o consulta autorizada.

## 5. Separacion Obligatoria

La arquitectura debe separar siempre:

### Datos privados

Informacion perteneciente a una persona, empresa o cliente concreto.

Ejemplos:

- Emails.
- Agenda.
- Documentos.
- Memoria personal.
- Proyectos privados.
- Credenciales.
- Historial de uso.

Los datos privados viven en espacios autorizados y no deben promocionarse al conocimiento global.

### Conocimiento de plataforma

Conocimiento reutilizable sobre como funciona el ecosistema.

Ejemplos:

- Contratos.
- Reglas.
- Arquitectura.
- Roadmaps.
- Decisiones aprobadas.
- Patrones tecnicos generales.

### Capacidades reutilizables

Funciones, motores o componentes que pueden aplicarse a mas de un usuario o cliente.

Ejemplos:

- Clasificacion documental.
- Lectura autorizada de agenda.
- Analisis de correo.
- Sistema de aprobaciones.
- Ranking de conocimiento.
- Briefing ejecutivo.

### Runtime

Datos generados por ejecucion.

Ejemplos:

- Logs.
- Caches.
- Stores locales.
- Tokens.
- Knowledge Objects generados.
- Colas de aprobacion.

El runtime no es gobernanza y no debe versionarse salvo archivos placeholder o contratos expresamente aprobados.

### Laboratorio

Espacio de prueba, validacion y prototipado.

Ejemplos actuales:

- `KNOWLEDGE-CURATOR`.
- `executive-chat.html`.
- `business-hunter-dashboard.html`.

El laboratorio puede demostrar capacidades, pero no define por si mismo el producto final.

### Producto final

Experiencia usable por Cliente Cero o clientes finales.

Debe ser minimalista, operativa, segura y orientada a informacion relevante. La arquitectura interna debe permanecer oculta salvo consulta o necesidad.

## 6. Linea Oficial Actual

La linea oficial provisional queda declarada asi:

- `backend/services/knowledge` es el Knowledge Engine V2 oficial.
- `backend/services/executive-brain` es el Executive Brain V1 oficial.
- `/api/executive/chat` es el endpoint ejecutivo oficial provisional.

Esta linea debe crecer sin crear motores paralelos.

El Executive Brain V1 debe responder desde Knowledge Objects V2 persistidos en el Knowledge Store oficial. No debe consultar fuentes originales como sustituto de recuperacion ordinaria.

## 7. Legacy Y Provisional

Los siguientes elementos se consideran legacy o provisionales hasta migracion, consolidacion o sustitucion aprobada:

- `backend/core/executiveBrain.js`: legacy hasta migracion.
- `backend/knowledge/knowledgeStore.json`: store antiguo.
- `/api/chat`: ruta antigua pendiente de revision.
- `app/index.html`: prototipo historico, no UI final.
- `executive-chat.html`: laboratorio Cliente Cero, no producto final.
- `business-hunter-dashboard.html`: laboratorio Cliente Cero, no producto final.

Estos elementos no deben borrarse ni moverse por este documento. Solo se fija su clasificacion conceptual para evitar que sigan dirigiendo la arquitectura objetivo.

## 8. Principios Obligatorios

- Oxkio no es un chatbot.
- Oxkio trabaja, el usuario dirige.
- La informacion debe permanecer oculta salvo relevancia, necesidad o consulta.
- Los datos privados nunca pasan al conocimiento global.
- Las capacidades desarrolladas si pertenecen a XANTALAL/Oxkio Plataforma cuando son reutilizables y estan limpias de datos privados.
- Las confirmaciones deben reducirse mediante aprendizaje progresivo de patrones.
- Las acciones criticas siempre requieren aprobacion.
- El sistema debe distinguir hechos, inferencias, recomendaciones e incertidumbre.
- La arquitectura interna no debe mostrarse a clientes finales salvo necesidad autorizada.
- No se deben crear cerebros, stores o rutas paralelas sin aprobacion expresa.

## 9. Proxima Arquitectura De Trabajo

El orden de trabajo queda fijado:

1. Cliente Cero privado.
2. Clientes finales aislados.
3. Escalado de capacidades reutilizables.

### Paso 1: Cliente Cero privado

Prioridad:

- Identidad de Jose.
- Agenda real.
- Gmail real.
- Documentos privados.
- Proyectos propios.
- Memoria personal.
- Renovaciones y caducidades.
- Aprobaciones.
- Briefing minimo util.

### Paso 2: Clientes finales aislados

Prioridad:

- Crear modelo de espacios privados por cliente.
- Impedir mezcla de datos.
- Ocultar nombres internos.
- Permitir que cada cliente opere sobre su empresa, documentos y proyectos.

### Paso 3: Capacidades reutilizables

Prioridad:

- Extraer capacidades funcionales validadas.
- Limpiarlas de datos privados.
- Incorporarlas a Oxkio Plataforma.
- Documentarlas en gobierno si pasan a arquitectura oficial.

## Estado V1

Arquitectura Objetivo Minima Oxkio V1 queda declarada como referencia oficial para los proximos sprints.

La recomendacion derivada de G001 se mantiene: REORGANIZAR sin reconstruccion total.
