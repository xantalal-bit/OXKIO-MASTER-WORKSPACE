# OXKIO PROJECTS

Gobernanza aplicable: [G0001 Rev. A](../XANTALAL/00_GOVERNANCE/G0001-REV-A-CONSTITUCION-CAPA-COORDINACION-INTELIGENTE-XANTALAL-OXKIO.md) y [G0001-A1](../XANTALAL/00_GOVERNANCE/G0001-A1-MAPA-MAESTRO-ACTIVOS-LOCALIZACION-CUSTODIA-RECUPERACION-XANTALAL.md). Hito canónico de G0001-A1: `a25361596bf3d5afc1c5c993290f44bd423c1ecc`.

## Proyectos activos supervisados

1. OXKIO
- Ruta verificada: C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\OXKIO
- Rol: Orquestador principal
- Prioridad: Estratégica
- Estado: G0001 Rev. A y G0001-A1 versionados; RESTORE-01/02 cerrados con GO y deuda EOL documentada.
- Objetivo inmediato: cerrar documentalmente G0001-A1 sin abrir G0002.
- Runtime candidato: Cloud Run + Firebase Authentication; no definitivo.
- Persistencia operativa principal: PostgreSQL gestionado, ratificada mediante ADR.
- Firestore: POC superada; no será BBDD operativa principal; colecciones reales intactas y `unknown`.
- LucusHost: activo y cPanel accesible según Cliente Cero; backups y restore desconocidos.
- Primera auditoría Antigravity: recibida; APROBADA CON CORRECCIONES.
- Segunda auditoría Antigravity: después del piloto remoto y antes de probadores.
- Continuidad Git: OXKIO y documentos G0001/G0001-A1 recuperados desde GitHub fuera de OneDrive; no cubre datos privados, secretos ni infraestructura.

2. BUSINESS-HUNTER
- Ruta verificada: C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\BUSINESS-HUNTER
- Rol: Captación comercial y rentabilización rápida
- Prioridad: Muy alta
- Estado: MVP operativo local
- Continuidad: remoto privado y restore pendientes; datasets e imágenes requieren clasificación separada.

3. GIU
- Ruta verificada: C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\GIU
- Rol: Generador Universal de Informes
- Prioridad: Alta
- Estado: RESERVADO; directorio existente sin producto operativo autorizado.

4. XOSE
- Ruta física verificada: C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\PROFESOR-IA
- Rol: Formación, contenido y marca personal
- Prioridad: Media
- Estado: Xose es el nombre vigente; `PROFESOR-IA` se conserva únicamente como referencia física/legacy.
- Continuidad: separar código, multimedia, vídeos, originales e instaladores; no incorporar aproximadamente 769 MB a Git ordinario sin estrategia.

5. LEARNING-HEROES-AGENT
- Ruta verificada: C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\PROFESOR-IA\LEARNING-HEROES-AGENT
- Rol: Bibliotecario IA / extracción de conocimiento
- Prioridad: Alta como soporte
- Estado: Componente integrado en el repositorio físico legacy de Xose; los estados históricos de procesamiento requieren auditoría separada antes de elevarse como vigentes.

## Nomenclatura

- Xose: denominación vigente.
- `PROFESOR-IA`: referencia física/histórica únicamente.
- ecoSoft: denominación legacy/prohibida; no es un proyecto vigente.
