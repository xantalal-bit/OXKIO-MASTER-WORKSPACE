# Firebase Admin en Windows

## Objetivo

OXKIO usa variables persistentes del usuario Windows y un unico script versionado para validar Firebase Admin antes de arrancar. Los secretos no se guardan en Git ni en `.env`.

## Requisitos

- Windows 11 y PowerShell 5.1 o posterior.
- Node y las dependencias del repositorio instaladas.
- Un archivo JSON de service account autorizado.

## Credencial

Guarde la credencial fuera del repositorio y fuera de OneDrive. Una ubicacion conceptual adecuada es una carpeta privada de OXKIO bajo `LOCALAPPDATA`. No copie la credencial al repositorio ni la comparta.

## Configuracion de usuario

Ejecute una sola vez en PowerShell, sustituyendo exclusivamente los placeholders:

```powershell
[Environment]::SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", "<ruta-credencial>", "User")
[Environment]::SetEnvironmentVariable("FIREBASE_PROJECT_ID", "<firebase-project-id>", "User")
[Environment]::SetEnvironmentVariable("OXKIO_ADMIN_FIREBASE_UIDS", "<firebase-admin-uid>", "User")
```

Cierre la consola y abra una nueva para que reciba las variables persistentes.

## Validacion y arranque

Desde la raiz del repositorio:

```powershell
npm start -- --ValidateOnly
npm start
```

En algunos equipos Windows, PowerShell puede bloquear `npm.ps1` por la politica de ejecucion. En ese caso, use los equivalentes:

```powershell
npm.cmd start -- --ValidateOnly
npm.cmd start
```

No cambie la politica global de ejecucion; use la variante `npm.cmd` o el BAT existente si PowerShell restringe `npm.ps1`.

El BAT existente delega en el mismo script oficial y acepta los mismos argumentos:

```powershell
.\scripts\INICIAR_OXKIO.bat -ValidateOnly
.\scripts\INICIAR_OXKIO.bat
```

## Cambio o rotacion

Guarde la nueva credencial fuera del repositorio, actualice las variables de usuario necesarias, abra una consola nueva y vuelva a ejecutar la validacion. Reinicie OXKIO despues de cualquier cambio.

Para eliminar la configuracion:

```powershell
[Environment]::SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", $null, "User")
[Environment]::SetEnvironmentVariable("FIREBASE_PROJECT_ID", $null, "User")
[Environment]::SetEnvironmentVariable("OXKIO_ADMIN_FIREBASE_UIDS", $null, "User")
```

## Fallos habituales

- Consola antigua: abra una nueva despues de cambiar variables.
- Ruta inexistente: corrija `GOOGLE_APPLICATION_CREDENTIALS` sin copiar el JSON al repo.
- JSON invalido: use el archivo service-account original.
- Project ID incoherente: alinee la variable con la credencial.
- Allowlist vacia: configure al menos un UID.
- `node_modules` ausente: restaure las dependencias antes de arrancar.

El script nunca debe mostrar UID, project ID, client email, private key, tokens ni contenido de la credencial. Firebase Admin no debe configurarse en `.env`.
