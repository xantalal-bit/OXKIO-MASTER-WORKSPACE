# OXKIO MASTER SESSION

## Fecha

01/08/2026

## Bloque de gobernanza actual

G0001-A1 — preparación del cierre documental de activos, custodia y continuidad.

## Estado canónico

- [G0001 Rev. A](./G0001-REV-A-CONSTITUCION-CAPA-COORDINACION-INTELIGENTE-XANTALAL-OXKIO.md) está versionado y es el documento superior.
- [G0001-A1](./G0001-A1-MAPA-MAESTRO-ACTIVOS-LOCALIZACION-CUSTODIA-RECUPERACION-XANTALAL.md) está versionado en el hito `a25361596bf3d5afc1c5c993290f44bd423c1ecc`.
- La actualización de cierre de G0001-A1 está preparada y pendiente de auditoría precommit.
- G0002 permanece cerrado.

El bloque técnico 5C.7B.2 continúa cerrado. PostgreSQL gestionado permanece ratificado como dirección de persistencia, pero proveedor, diseño productivo y migración siguen pendientes y fuera de esta misión.

## Último hito validado

`a253615 docs(governance): formaliza mapa maestro G0001-A1`

## Última evidencia aceptada

- RESTORE-01 — **GO**: OXKIO recuperado desde GitHub fuera de OneDrive, HEAD `a253615…`, 352 archivos y `git fsck` satisfactorio; clone en 7,04 s.
- RESTORE-02 — **GO CON INCIDENCIA EOL**: G0001 y G0001-A1 recuperados con blobs exactos; índice LF, working tree CRLF y diff lógico limpio.
- RESTORE-05 — **GO CON INCIDENCIA EOL**: XANTALALSHOP recuperado desde GitHub, HEAD `c0f259e…`, 15 archivos, 14 assets y clone en 2,20 s.
- Los clones no reconstruyeron `.env`, OAuth ni stores ignorados.
- Los sandboxes permanecen preservados fuera de OneDrive y en el mismo portátil.

## Confirmaciones del Cliente Cero

- Microsoft/OneDrive está bajo control de José Antonio y tiene MFA activo; recuperación desconocida.
- Google/Google One está bajo control, con MFA y recuperación confirmados.
- Firebase y Google Cloud están bajo control mediante la cuenta Google; otros administradores siguen desconocidos.
- OpenAI está bajo control; MFA y recuperación siguen desconocidos.
- LucusHost está activo y cPanel es accesible; backups desconocidos y restore no probado.
- Cinco dominios fueron declarados con LucusHost como registrador y renovación automática; DNS efectivo desconocido.
- No existe una web pública actual confirmada.
- Google One 5 TB es candidato prioritario de continuidad, sin configuración ni copia ejecutadas.

No se registran direcciones de correo, contraseñas, tokens, claves ni recovery codes.

## RTO internos

- Código y gobernanza: objetivo 2–4 horas o antes.
- Datos operativos críticos: objetivo inferior a 8 horas o antes.
- Son objetivos internos, no SLA contractuales.

## Incidencias y deuda abiertas

- Deuda EOL: `core.autocrlf=true` materializa CRLF aunque los blobs Git conserven LF. No modificar ahora `core.autocrlf` ni `.gitattributes`.
- Las pruebas se realizaron en el mismo portátil y no simulan pérdida física total.
- GitHub protege contenido versionado, no secretos, stores ignorados, hosting, DNS ni infraestructura.
- Las 15 marcas estadísticas del working tree deben permanecer intactas.
- `profesor-ia.html` permanece versionado como deuda de nomenclatura orientada a superficie pública y deberá corregirse antes de publicación; Xose es el nombre vigente y `PROFESOR-IA` es legacy físico.
- ecoSoft permanece prohibido como denominación vigente.
- RESTORE-03, RESTORE-04 y RESTORE-06 no están autorizados.
- Los sandboxes no deben limpiarse sin autorización separada.

## Archivos del cierre preparados para auditoría precommit

1. `G0001-A1-MAPA-MAESTRO-ACTIVOS-LOCALIZACION-CUSTODIA-RECUPERACION-XANTALAL.md`
2. `OXKIO-MASTER-SESSION.md`
3. `CLIENTE-CERO-ASSET-REGISTRY.md`
4. `orchestration/PROJECTS.md`

El staging selectivo fue autorizado y ejecutado exclusivamente sobre las cuatro rutas aprobadas.

## Siguiente acción exacta

Completar la auditoría precommit y solicitar autorización expresa para commit y push.

## Exclusiones

Sin código, runtime, Firebase, OAuth, PostgreSQL, datos reales, secretos, Google Drive, nuevos restores, limpieza de sandboxes, repositorio raíz XANTALAL, G0002, commit ni push.

## Propuesta de commit de cierre

`docs(governance): cierra baseline de continuidad G0001-A1`
