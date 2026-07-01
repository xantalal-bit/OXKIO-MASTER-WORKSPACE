# KNOWLEDGE OBJECT STANDARD

## Propósito

Definir el formato universal de conocimiento del ecosistema XANTALAL.

Este estándar será usado por:

- Oxkio
- Knowledge Platform
- Business Hunter
- Profesor IA
- Learning Heroes
- Gmail
- Google Drive
- Discord
- Telegram
- futuros conectores

## Principio

Todo origen de información debe transformarse en un Knowledge Object común.

No importa si procede de:

- documento
- email
- conversación
- curso
- nota
- archivo
- base de datos

## Versión actual

Knowledge Object V2.0

## Estructura V2.0

### identity

Campos:

- id
- source
- sourceType
- path
- name
- extension
- hash
- version

### technical

Campos:

- size
- createdAt
- modifiedAt
- indexedAt
- language
- encoding

### content

Campos:

- raw
- summary
- keywords

### strategy

Campos:

- ecosystem
- primaryProject
- secondaryProjects
- strategicArea
- priority
- roadmapPhase

### metadata

Campos:

- generatedBy
- generatedAt
- reviewed
- reviewer

## Evolución prevista

### V2.1

knowledge:

- projects
- decisions
- tasks
- risks
- opportunities
- ideas
- questions

### V2.2

relationships:

- relatedObjects
- relatedProjects
- references

### V2.3

intelligence:

- importance
- confidence
- validationStatus

### V2.4

memory:

- firstSeen
- lastSeen
- accessCount
- lastAccess

history:

- date
- action
- agent
- notes

## Regla de compatibilidad

Cada nueva versión deberá mantener compatibilidad hacia atrás con los objetos existentes o incluir una función de migración.

## Regla XANTALAL

El Executive Brain nunca debe depender del formato original de una fuente.

Siempre debe consumir Knowledge Objects.
