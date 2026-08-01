# Inventario operativo del Cliente Cero

Este registro es un consumidor operativo subordinado a [G0001 Rev. A](./G0001-REV-A-CONSTITUCION-CAPA-COORDINACION-INTELIGENTE-XANTALAL-OXKIO.md) y al [Mapa Maestro G0001-A1](./G0001-A1-MAPA-MAESTRO-ACTIVOS-LOCALIZACION-CUSTODIA-RECUPERACION-XANTALAL.md). G0001-A1 prevalece para activos, custodia y recuperación.

No contiene direcciones de correo, contraseñas, tokens, claves, códigos de recuperación ni valores sensibles. «Cuenta controlada» no significa «integración conectada».

## 1. Identidad y cuentas críticas

| Servicio | Estado confirmado por Cliente Cero | Pendiente |
|---|---|---|
| Microsoft / OneDrive | Cuenta controlada; MFA activo | Recuperación |
| GitHub / `xantalal-bit` | Cuenta controlada; remotos OXKIO y XANTALALSHOP recuperados | MFA y recuperación alternativa |
| Google / Google One | Cuenta controlada; MFA y recuperación disponibles | Diseño de copia y restore |
| Firebase | Proyecto controlado; MFA mediante Google | Otros administradores y auditoría del proyecto real |
| Google Cloud | Misma cuenta Google; acceso y control actuales | MFA específico y administración adicional |
| OpenAI / ChatGPT / Codex | Cuenta y facturación controladas | MFA y recuperación |
| Correo administrativo | Existe y está controlado | MFA y recuperación propia |

## 2. Cloud y continuidad

| Activo | Estado |
|---|---|
| OneDrive 1 TB | Workspace y sincronización activa; no es backup universal |
| Google One 5 TB | Candidato prioritario de continuidad; no configurado y no validado como backup |
| Google Drive | No configurado como copia; prohibida la sincronización bidireccional sin diseño aprobado |
| Disco externo | No disponible |
| Otro ordenador | Desconocido |
| Otra nube | Desconocida |

Los secretos no deben copiarse como archivos ordinarios entre nubes.

## 3. Desarrollo y recuperación Git

| Activo | Estado |
|---|---|
| OXKIO | Versionado; RESTORE-01 **GO** desde GitHub |
| G0001 y G0001-A1 | RESTORE-02 **GO CON INCIDENCIA EOL**; blobs exactos |
| XANTALALSHOP | Versionado; RESTORE-05 **GO CON INCIDENCIA EOL** |
| XANTALAL raíz | Repositorio local; remoto privado pendiente |
| Business Hunter | Repositorio local; remoto privado pendiente |
| Xose | Repositorio físico legacy local; estrategia de código/multimedia pendiente |

Las pruebas se realizaron fuera de OneDrive pero en el mismo portátil. No restauraron `.env`, OAuth, stores ignorados, hosting, DNS ni infraestructura.

## 4. Productos y capacidades

| Nombre vigente | Estado |
|---|---|
| OXKIO | Plataforma central; hito G0001-A1 `a253615…` |
| Business Hunter | Producto local verificado |
| Xose | Nombre vigente; ruta física `PROFESOR-IA` clasificada como legacy |
| XANTALALSHOP | Repositorio recuperable; no hay web pública confirmada |
| Knowledge Curator | Capacidad integrada en OXKIO |
| GIU | Reservado |

`profesor-ia.html` permanece versionado como deuda de nomenclatura orientada a superficie pública y deberá corregirse antes de publicación. ecoSoft permanece como denominación legacy/prohibida y no es una empresa o producto vigente del inventario.

## 5. Hosting y dominios

| Elemento | Estado declarado |
|---|---|
| LucusHost | Contrato activo; cuenta y cPanel accesibles |
| Backups de hosting | Desconocidos; restore no probado |
| WordPress | Desconocido |
| DNS efectivo | Desconocido |
| Web pública actual | No existente según Cliente Cero |
| Renovación | Automática, declarada por Cliente Cero |

Dominios declarados, sin verificación externa:

- `xantalalshop.com`
- `xantalalshop.es`
- `oxkio.ia`
- `oxkio.es`
- `oxkio.com`

## 6. Datos, documentación y multimedia

- Documentos locales y PDFs: inventariados parcialmente en G0001-A1.
- Stores operativos privados: locales; no recuperados por Git.
- Multimedia Xose: aproximadamente 769 MB fuera de Git, pendiente de catálogo y copia independiente.
- Business Hunter: datasets e imágenes requieren separación y revisión de privacidad.
- Instaladores: no ejecutar ni copiar sin auditoría.

## 7. Credenciales y break-glass

- No existe un Credential Vault autorizado en esta fase.
- No registrar secretos en este inventario.
- Persona de confianza: aceptada para estudio, no designada.
- Mecanismo break-glass: pendiente de diseño gobernado, limitado y revocable.

## 8. Objetivos de recuperación

- Código y gobernanza: 2–4 horas o antes.
- Datos operativos críticos: menos de 8 horas o antes.
- Son objetivos internos, no SLA contractuales.

## 9. Estado de cierre

Confirmaciones y restores Git incorporados. Continúan pendientes la copia independiente, datos privados, secretos, DNS, backups de hosting, recuperación de cuentas incompleta y simulación de pérdida física total.
