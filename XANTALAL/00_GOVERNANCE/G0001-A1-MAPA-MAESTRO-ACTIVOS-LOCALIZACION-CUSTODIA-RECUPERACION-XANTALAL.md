# G0001-A1 — MAPA MAESTRO DE ACTIVOS, LOCALIZACIÓN, CUSTODIA Y RECUPERACIÓN DE XANTALAL

> **Estado documental:** PROPUESTA DE CIERRE DOCUMENTAL DE LA BASELINE CANÓNICA. APROBACIÓN SUJETA A AUDITORÍA PRECOMMIT.

## 1. Control documental

| Campo | Valor |
|---|---|
| Código | G0001-A1 |
| Versión | 0.2.0 — propuesta de cierre documental |
| Fecha | 2026-08-01 |
| Autoridad | José Antonio, CEO de XANTALAL |
| Dirección técnica | ChatGPT |
| Formalización técnica | Codex |
| Documento superior | [G0001 Rev. A — Constitución de la capa de coordinación inteligente XANTALAL/OXKIO](./G0001-REV-A-CONSTITUCION-CAPA-COORDINACION-INTELIGENTE-XANTALAL-OXKIO.md) |
| Repositorio canónico | OXKIO |
| Rama de referencia | `main` |
| Hito canónico de referencia | `a25361596bf3d5afc1c5c993290f44bd423c1ecc` |
| Alcance | Activos, localización, custodia, fuente canónica, continuidad y recuperación |
| Exclusiones | Valores secretos, diseño G0005, restores adicionales, limpieza de sandboxes, cambios de infraestructura y contratación de proveedores |

Este documento es subordinado a G0001 Rev. A. No constituye una segunda constitución, no sustituye las decisiones de la autoridad y no autoriza por sí mismo acciones técnicas, accesos, gastos, despliegues ni tratamientos de datos.

## 2. Propósito y criterio de uso

G0001-A1 establece una vista maestra para responder, de forma auditable:

1. qué activos existen;
2. cuál es su nombre vigente;
3. dónde se encuentran;
4. quién ostenta su autoridad y quién los custodia materialmente;
5. qué fuente es canónica;
6. qué copias conocidas existen;
7. cómo debería demostrarse su recuperación;
8. qué información falta antes de operar con seguridad.

El mapa describe el estado verificado o documentado a 2026-08-01. No convierte una copia en backup validado, una intención en arquitectura implantada ni una referencia histórica en producto vigente.

## 3. Lenguaje de honestidad

| Estado | Significado obligatorio |
|---|---|
| **VERIFICADO** | Comprobado directamente mediante evidencia local estática en esta misión o en las auditorías aprobadas que la preceden. |
| **DOCUMENTADO** | Afirmado por documentación del proyecto, sin verificación operativa completa en esta misión. |
| **PROPUESTO** | Diseño o acción recomendada, todavía no aprobada o no ejecutada. |
| **DESCONOCIDO** | No existe evidencia suficiente para afirmar el estado. |
| **REQUIERE CONFIRMACIÓN** | Debe resolverlo la autoridad o el titular de la cuenta/activo. |
| **PENDIENTE DE AUDITORÍA** | Existe evidencia potencial, pero falta una comprobación autorizada. |
| **PENDIENTE DE RESTORE** | Existe una fuente o copia, pero no se ha demostrado su recuperación. |
| **LEGACY** | Elemento histórico conservado por trazabilidad; no representa la denominación o dirección vigente. |
| **RESERVADO** | Espacio reconocido sin desarrollo operativo autorizado. |

Regla: ante contradicción entre fuentes, prevalecen la decisión más reciente y el documento de mayor autoridad. La contradicción debe permanecer visible hasta su resolución formal.

## 4. Jerarquía y frontera de gobernanza

| Capa | Autoridad y función | Estado |
|---|---|---|
| XANTALAL corporativo | Gobierno transversal de la organización y sus activos | **DOCUMENTADO**; repositorio raíz local identificado |
| G0001 Rev. A | Constitución superior de coordinación para XANTALAL/OXKIO | **VERIFICADO** como documento superior |
| G0001-A1 | Registro maestro subordinado de activos y continuidad | Baseline sujeta a auditoría precommit |
| Documentos de producto | Gobierno, arquitectura, roadmap y operación de cada activo | Sujetos a su autoridad y vigencia concreta |
| G0005 | Diseño futuro de aislamiento y arquitectura multiusuario | **PROPUESTO**; no desarrollado aquí |

El repositorio raíz XANTALAL y el repositorio OXKIO no deben duplicar constituciones divergentes. Este mapa reside canónicamente en OXKIO; el repositorio raíz deberá contener en una microfase posterior solamente el enlace o referencia mínima aprobada.

## 5. Taxonomía maestra de activos

| Activo lógico | Clase | Denominación vigente | Situación |
|---|---|---|---|
| XANTALAL | Organización y gobierno corporativo | XANTALAL | **DOCUMENTADO** |
| OXKIO | Plataforma central de coordinación y producto | OXKIO | **VERIFICADO** |
| Business Hunter | Producto/capacidad especializada | Business Hunter | **VERIFICADO** |
| Xose | Producto/capacidad especializada | Xose | **DOCUMENTADO** como nombre vigente; repositorio físico legado identificado |
| XANTALALSHOP | Producto/sitio | XANTALALSHOP | **VERIFICADO** |
| GIU | Espacio de producto reservado | GIU | **RESERVADO** |
| Knowledge Curator | Capacidad integrada | Knowledge Curator | **VERIFICADO** dentro de OXKIO; no es repositorio independiente |
| Microproductos futuros | Posible familia de activos | Sin nombres canónicos | **PROPUESTO**, no prioritario |

La expresión «Profesor IA» queda limitada a referencias históricas, rutas físicas heredadas y trazabilidad. El activo vigente es **Xose**. `PROFESOR-IA` se clasifica como **REPOSITORIO LEGACY/HISTÓRICO DEL ACTIVO VIGENTE XOSE**.

ecoSoft no figura como producto vigente. Solo puede aparecer como referencia **LEGACY**, prohibición o deuda documental pendiente de saneamiento.

## 6. Arquitectura de custodia por cliente

### 6.1 Principio central

OXKIO aporta capacidades, runtime, servicios y plataforma comunes. Esta centralidad funcional no autoriza un espacio privado compartido entre clientes.

### 6.2 Frontera privada obligatoria

Cada cliente deberá disponer de un espacio privado aislado para, como mínimo:

- datos y documentos;
- memoria y conocimiento;
- secretos, tokens y credenciales;
- OAuth e integraciones;
- registros, evidencias y backups;
- claves, herramientas, contexto y permisos.

No se autoriza acceso cruzado entre clientes. La implantación técnica, los límites de tenancy, la administración y las pruebas de aislamiento quedan diferidos a G0005. Por tanto, este mapa registra el principio; no afirma que el aislamiento esté implementado.

## 7. Cliente Cero: doble plano de autoridad

José Antonio actúa simultáneamente en dos planos que deben permanecer separados:

| Plano | Alcance | Límite |
|---|---|---|
| Cliente Cero | Su espacio privado, datos, memoria, integraciones y operación personal | No habilita acceso a futuros espacios de otros clientes |
| Administrador/CEO | Gobierno, soporte autorizado, configuración y continuidad de la plataforma | No concede acceso irrestricto a datos privados de clientes |

Todo acceso administrativo excepcional a un espacio de cliente deberá tener finalidad explícita, autorización, privilegio mínimo, duración limitada, trazabilidad, revocación y evidencia revisable. Este criterio es constitucional; su mecanismo técnico permanece **PROPUESTO** para G0005.

## 8. Registro maestro de repositorios

Estado de Git y tamaños según auditoría local aprobada. La titularidad jurídica formal de cada activo **REQUIERE CONFIRMACIÓN**; la tabla refleja autoridad operativa documentada.

| ID | Activo lógico | Ruta física | Rama / HEAD | Remoto | Estado y custodia | Fuente canónica / recuperación |
|---|---|---|---|---|---|---|
| REP-XAN-01 | XANTALAL corporativo | `C:\Users\janta\OneDrive\Documentos\XANTALAL` | `main` / `d472e0bd4eda807d689ec076a9432cd68cdf0b5d` | Ninguno **VERIFICADO** | 10 archivos versionados; `50_ARCHIVE/` sin seguimiento. Autoridad: XANTALAL/CEO. Custodia física: portátil + OneDrive. | Git local es la fuente versionada actual. Remoto privado independiente **PROPUESTO**. **PENDIENTE DE RESTORE**. |
| REP-OX-01 | OXKIO | `C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\OXKIO` | `main` / `d1354650859e97e835e1bebcc8ae61d9db19d820` | `xantalal-bit/OXKIO-MASTER-WORKSPACE` **VERIFICADO** localmente; visibilidad **DESCONOCIDO** | 351 archivos versionados. Autoridad: XANTALAL/CEO; dirección técnica según G0001. Custodia: portátil + OneDrive + remoto Git. | Git `main` y remoto configurado para material versionado. Restauración remota **PENDIENTE DE RESTORE**. |
| REP-BH-01 | Business Hunter | `C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\BUSINESS-HUNTER` | `master` / `1ec3c732476ef7044ed8104fc19ac73569d41a66` | Ninguno **VERIFICADO** | 76 archivos versionados; `IMAGENES/` sin seguimiento. Custodia: portátil + OneDrive. | Git local actual; remoto privado **PROPUESTO**. **PENDIENTE DE RESTORE**. |
| REP-XOSE-LEG-01 | Xose | `C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\PROFESOR-IA` | `main` / `f9da673c50dff45b84a317240d1891b168e81683` | Ninguno **VERIFICADO** | 265 archivos versionados; gran volumen no Git. Repositorio **LEGACY** del activo vigente Xose. | Git local para código/documentos; multimedia requiere catálogo y copia independiente. **PENDIENTE DE RESTORE**. |
| REP-SHOP-01 | XANTALALSHOP | `C:\Users\janta\OneDrive\Documentos\XANTALAL\10_PRODUCTS\XANTALALSHOP` | `main` / `c0f259e8f4403da7730814ea70429453087651d4` | `xantalal-bit/XANTALALSHOP` **VERIFICADO** localmente; visibilidad **DESCONOCIDO** | 15 archivos versionados; estado limpio en auditoría. Custodia: portátil + OneDrive + remoto Git. | Git es fuente versionada. Publicación actual no demostrada. **PENDIENTE DE RESTORE**. |

### 8.1 Copias Git históricas de OXKIO

| ID | Ruta | HEAD | Clasificación |
|---|---|---|---|
| COPY-OX-01 | `C:\Users\janta\Documents\Codex\oxkio-5c7b1-close-local` | `d0d30b714808b1c9c191a627d6ea425773799d73` | Copia histórica limpia, fuera de OneDrive pero en el mismo portátil; **COPIA NO VALIDADA** |
| COPY-OX-02 | `C:\Users\janta\Documents\Codex\oxkio-head-98b2998` | `98b299826e8611affc25fb1b8c47eae7fdeda1ca` | Copia histórica limpia, fuera de OneDrive pero en el mismo portátil; **COPIA NO VALIDADA** |

Estas copias no sustituyen el HEAD vigente ni aportan independencia frente a pérdida total del portátil.

## 9. Activos no Git y espacios integrados

| ID | Activo | Localización | Evidencia | Riesgo / fuente canónica |
|---|---|---|---|---|
| NGT-XAN-01 | `50_ARCHIVE/` corporativo | Repositorio raíz XANTALAL | **VERIFICADO** sin seguimiento | Contenido histórico fuera del control de Git; requiere inventario y política de retención |
| NGT-BH-01 | Imágenes de Business Hunter | `BUSINESS-HUNTER\IMAGENES` | **VERIFICADO** sin seguimiento | Dependencia de OneDrive; catalogar antes de decidir versionado o almacén de activos |
| NGT-BH-02 | Datasets de leads | Árbol local de Business Hunter | **VERIFICADO**; ficheros de 523.432 y 387.800 bytes identificados | Naturaleza, base legal, sensibilidad y fuente vigente **REQUIEREN CONFIRMACIÓN** |
| NGT-XOSE-01 | Multimedia y materiales de Xose | Árbol físico `PROFESOR-IA` | **VERIFICADO**; aproximadamente 769 MB fuera de Git | OneDrive es el único dominio de copia conocido; requiere catálogo, clasificación y copia independiente |
| NGT-XOSE-02 | Instalador Google Drive Setup | `PROFESOR-IA\IMAGENES\Pruebas\GoogleDriveSetup.exe` | **VERIFICADO**, 258.439.320 bytes | Binario histórico de procedencia y necesidad **PENDIENTES DE AUDITORÍA**; no ejecutar |
| NGT-XOSE-03 | Vídeos y fotografías originales | Árbol físico `PROFESOR-IA` | **VERIFICADO**; dos vídeos de 93.563.528 bytes y fotos de 7–8,5 MB | Activos de propiedad intelectual; titularidad, consentimientos y retención **REQUIEREN CONFIRMACIÓN** |
| INT-OX-KC-01 | Knowledge Curator | Dentro de OXKIO | **VERIFICADO** | Capacidad integrada, no crear repositorio paralelo sin autorización |
| INT-XOSE-LH-01 | Learning Heroes Agent | Dentro del repositorio físico legado de Xose | **VERIFICADO** | Componente anidado; clasificación futura pendiente |
| INT-OX-SIM-01 | Simulador IA | Dentro de OXKIO | **VERIFICADO** | Laboratorio/**LEGACY**; no elevar a fuente productiva |
| RSV-GIU-01 | GIU | `XANTALAL\10_PRODUCTS\GIU` | Directorio vacío **VERIFICADO** | **RESERVADO**; no implica producto activo |
| NGT-RPT-01 | Informes PDF | Carpeta local Descargas | **VERIFICADO**: 14 PDF, 733.757 bytes | Copia dispersa, no canónica; catalogar origen y destino |

## 10. OneDrive como dominio común de fallo

Los cinco repositorios físicos principales, multimedia, almacenes locales, secretos locales, zips y snapshots se encuentran dentro del árbol sincronizado por OneDrive. Esto crea un dominio común de fallo para borrado sincronizado, corrupción, ransomware, bloqueo de cuenta, errores de operador y pérdida del portátil.

Solo OXKIO y XANTALALSHOP tienen remotos Git configurados, y estos cubren material versionado, no necesariamente datos, multimedia ni secretos. Las dos copias históricas de OXKIO fuera de OneDrive residen en el mismo portátil.

**Conclusión:** OneDrive es espacio de trabajo y sincronización; no es por sí solo una estrategia de backup ni una fuente canónica universal. Se **PROPONE** una estrategia proporcional 3-2-1, con proveedor, cifrado, presupuesto y calendario todavía **PENDIENTES DE DECISIÓN**.

Google One, con una capacidad de 5 TB declarada por el Cliente Cero, queda autorizado como **CANDIDATO PRIORITARIO DE CONTINUIDAD**, sin configuración ni copia ejecutadas. No se considera backup fiable hasta diseñar selección, exclusiones, versionado y restore. Los secretos no deben copiarse como archivos ordinarios entre nubes.

## 11. Registro lógico de cuentas críticas

No se registran correos, identificadores sensibles, códigos, factores, valores secretos ni materiales de recuperación.

| ID | Servicio / función | Titular o administrador | MFA | Recuperación | Estado |
|---|---|---|---|---|---|
| ACC-MS-01 | Microsoft / OneDrive | Control de José Antonio **CONFIRMADO POR CLIENTE CERO** | Activo, **CONFIRMADO POR CLIENTE CERO** | **DESCONOCIDA** | Crítica por concentración de activos |
| ACC-GH-ORG-01 | GitHub / organización `xantalal-bit` | Control de José Antonio **CONFIRMADO POR CLIENTE CERO** | **DESCONOCIDO** | **DESCONOCIDA** | Remotos OXKIO y Shop recuperados con éxito |
| ACC-GOOGLE-01 | Google / identidad e integraciones | Control de José Antonio **CONFIRMADO POR CLIENTE CERO** | Activo, **CONFIRMADO POR CLIENTE CERO** | Disponible, **CONFIRMADA POR CLIENTE CERO** | Cuenta compartida por Google One, Firebase y GCP |
| ACC-FB-01 | Firebase | Control de José Antonio **CONFIRMADO POR CLIENTE CERO** | Mediante Google, **CONFIRMADO POR CLIENTE CERO** | Otros administradores **DESCONOCIDOS** | Proyecto, reglas y datos reales no auditados |
| ACC-GCP-01 | Google Cloud | Misma cuenta Google y control actual **CONFIRMADOS POR CLIENTE CERO** | MFA específico **DESCONOCIDO** | Administración adicional **DESCONOCIDA** | Infraestructura real no verificada |
| ACC-OAI-01 | OpenAI / API / ChatGPT / Codex | Cuenta y facturación bajo control **CONFIRMADAS POR CLIENTE CERO** | **DESCONOCIDO** | **DESCONOCIDA** | Cuenta crítica de capacidad y continuidad |
| ACC-HOST-01 | Hosting / LucusHost | Contrato activo, cuenta y cPanel accesibles **CONFIRMADOS POR CLIENTE CERO** | **DESCONOCIDO** | Backups **DESCONOCIDOS**; restore no probado | No se accedió al hosting en estas misiones |
| ACC-DNS-01 | Registrador / DNS | LucusHost y control de José Antonio **DECLARADOS POR CLIENTE CERO** | **DESCONOCIDO** | Renovación automática **DECLARADA**; DNS efectivo **DESCONOCIDO** | Propiedad no verificada externamente |
| ACC-MAIL-ADMIN-01 | Correo administrativo | Existencia y control **CONFIRMADOS POR CLIENTE CERO** | **DESCONOCIDO** | **DESCONOCIDA** | No se registra su dirección |
| ACC-BACKUP-01 | Continuidad adicional | Google One 5 TB, candidato prioritario **DECLARADO** | Hereda la cuenta Google confirmada | Restore **PENDIENTE** | No configurado; no es todavía backup validado |

## 12. Dominios, DNS y hosting

| Activo | Estado honesto | Evidencia / limitación |
|---|---|---|
| `xantalalshop.com`, `xantalalshop.es`, `oxkio.ia`, `oxkio.es`, `oxkio.com` | **DECLARADOS POR CLIENTE CERO** | Registrador declarado: LucusHost; renovación automática declarada; no verificados externamente |
| `oxkio.xantalalshop.com` | **DOCUMENTADO** | Referido históricamente; resolución, propiedad, SSL y operación no comprobadas en esta misión |
| LucusHost / cPanel | **CONFIRMADO POR CLIENTE CERO** | Contrato activo, cuenta y cPanel accesibles; backups desconocidos y restore no probado |
| WordPress | **DESCONOCIDO** | No se afirma implantación vigente |
| Firebase Hosting | **PROPUESTO** | No se afirma despliegue vigente |
| Cloud Run | **PROPUESTO** | No se afirma despliegue vigente |
| Railway / Render | Alternativas **DOCUMENTADAS** | Sin elección ni contratación aprobada |
| Registrador y renovación | **DECLARADOS POR CLIENTE CERO** | LucusHost y renovación automática; requieren verificación posterior |
| DNS y SSL efectivos | **DESCONOCIDO** | No se realizaron consultas externas |
| Web pública XANTALAL/XANTALALSHOP | No existente, **DECLARADO POR CLIENTE CERO** | XANTALALSHOP fue recuperado desde Git, pero no desplegado ni publicado |

Las confirmaciones del Cliente Cero actualizan el estado declarado, pero no sustituyen una futura auditoría de cuenta, DNS, SSL, backups o restore de hosting.

## 13. Frontera de datos y persistencia

### 13.1 Almacenes locales identificados

La auditoría fue exclusivamente de existencia, ruta, seguimiento Git y tamaño; no se leyeron ni se muestran valores.

| ID | Componente | Ruta relativa | Tamaño auditado | Git | Estado |
|---|---|---|---:|---|---|
| DAT-OX-APPROVAL | Approval Queue | `backend/core/approvalQueue.json` | 34.479 B | Ignorado | Fuente operativa local **VERIFICADA**; privacidad y backup pendientes |
| DAT-OX-MEMORY | Memory | `backend/memory/memory.json` | 31.392 B | Ignorado | Fuente operativa local **VERIFICADA** |
| DAT-OX-EXEC | Execution Log | `backend/core/executionLog.json` | 13.130 B | Versionado | Mezcla de estado operativo y control de versión; riesgo de diseño |
| DAT-OX-AGENDA | Executive Agenda | `backend/executive/executiveAgendaStore.json` | 3.270 B | Versionado | Fuente local identificada |
| DAT-OX-PROJECT | Project Registry | `backend/projects/projectRegistryStore.json` | 1.311 B | Ignorado | Fuente local identificada |
| DAT-OX-SEC | Security Inventory | `backend/security/securityInventoryStore.json` | 412 B | Ignorado | Fuente local identificada |
| DAT-OX-KNOW-LEG | Knowledge Store legacy | `backend/knowledge/knowledgeStore.json` | 4.198 B | Ignorado | **LEGACY**; relación con el store vigente requiere auditoría |
| DAT-OX-KO | Knowledge Objects | `backend/data/knowledge-store/objects` | 26 objetos / 136.798 B | 1 versionado, 25 ignorados | Frontera híbrida; requiere política explícita |
| DAT-OX-KSUP | Knowledge Supervisor state | `backend/data/knowledge-supervisor/github-releases-state.json` | 510 B | Ignorado | Estado local técnico |
| DAT-OX-STRAT | Strategic Memory Store | Ruta esperada por código | Archivo ausente | No aplica | **VERIFICADO** ausente; comportamiento requiere auditoría |

### 13.2 Firestore

El frontend utiliza directamente las colecciones `bitacora`, `config`, `documentos`, `drive`, `incidencias`, `reglas` y `tareas`. La auditoría estática identificó lecturas, creaciones, actualizaciones y eliminaciones, con 66 operaciones de acceso en el frontend auditado.

Solo se localizaron reglas Firestore versionadas de una prueba de concepto bajo `backend/repositories/poc/firebase`. No se identificó un conjunto raíz demostrado como reglas productivas. Proyecto real, colecciones reales, reglas desplegadas, datos, cuentas de servicio y aislamiento entre clientes permanecen **DESCONOCIDOS**.

No existe evidencia suficiente para afirmar aislamiento de Cliente Cero. Obtenerla exigirá posteriormente una auditoría autorizada de solo lectura: identificar proyecto y entorno; exportar metadatos de reglas sin datos; comparar reglas desplegadas con versión; enumerar nombres y esquemas mínimos sin contenido; verificar permisos con identidades de prueba; registrar fecha, actor y huellas; y no escribir ni activar servicios.

### 13.3 PostgreSQL

La dirección PostgreSQL está **DOCUMENTADA** mediante ADR ratificada, pero solo se verificaron esquema y adaptadores de prueba de concepto. Base operativa, proveedor, migración y continuidad son **DESCONOCIDOS**. No se autoriza migración en este documento.

## 14. Registro de secretos por metadatos

| ID | Componente | Ubicación esperada/observada | Clasificación | Estado y riesgo |
|---|---|---|---|---|
| SEC-OX-ENV | Configuración local | `.env` en la raíz de OXKIO, dentro de OneDrive | S2 potencial | Archivo ignorado de 504 B **VERIFICADO**. Variables realmente pobladas **DESCONOCIDAS**; no se leyó contenido |
| SEC-OX-OAUTH | Tokens OAuth Google | `backend/auth/googleTokens.json`, dentro de OneDrive | S2 | Archivo ignorado de 656 B **VERIFICADO**; no se leyó contenido |
| SEC-FB-ADMIN | Firebase Admin | Variables individuales o credenciales predeterminadas de aplicación, según código | S2/S3 | Ubicación y valores reales **DESCONOCIDOS** |
| SEC-GH | Credenciales GitHub | Fuera del repositorio | S2/S3 | Existencia, ubicación y recuperación **DESCONOCIDAS** |
| SEC-RECOVERY | MFA y recuperación de cuentas críticas | Fuera del repositorio | S3 | **REQUIERE CONFIRMACIÓN** del titular, sin registrar valores |

Clasificación: I1/I2 para identificadores técnicos o personales limitados; S2 para tokens, claves API y secretos cliente; S3 para material administrativo o de recuperación. La sincronización de `.env` y tokens por OneDrive es un riesgo alto. Se **PROPONE** aislar las pruebas con credenciales sintéticas, directorio temporal fuera de OneDrive, permisos mínimos, entorno separado y limpieza verificable. Un gestor seguro futuro permanece **PENDIENTE DE DECISIÓN**; este mapa no lo selecciona ni configura.

## 15. Catálogo de copias y preservaciones

Todas las entradas se consideran **COPIA NO VALIDADA** salvo aquellas cuyo restore figure expresamente como ejecutado y satisfactorio. Un restore Git satisfactorio valida únicamente el contenido versionado, no datos privados, secretos ni infraestructura.

| ID | Activo / fuente | Localización o referencia | Tamaño / referencia | Riesgo principal |
|---|---|---|---|---|
| BKP-OX-01 | Snapshot Approval Queue | OneDrive; nombre fechado 2026-07-06, mtime 2026-07-01 | 15.518 B | Fecha contradictoria; sin checksum ni restore |
| BKP-OX-02 | Snapshot Memory | OneDrive; nombre fechado 2026-07-06, mtime 2026-07-01 | 7.918 B | Igual dominio de fallo; sin restore |
| BKP-OX-03 | Universal Knowledge Supervisor ZIP | `50_ARCHIVE` | 498.283 B, 2026-07-15 | Integridad, cifrado y alcance desconocidos |
| BKP-SHOP-01 | XANTALALSHOP ZIP | OneDrive | 4.385.643 B, 2026-07-14 | Duplicación local; sin restore |
| BKP-BH-01 | Business Hunter ZIP | OneDrive | 72.657 B, 2026-06-22 | Cobertura incompleta posible |
| BKP-BH-02 | Directorio de fase Business Hunter | OneDrive | 6 archivos / 482.825 B | Finalidad y vigencia pendientes |
| BKP-BH-03 | Opportunity Hunter | OneDrive | 5 archivos / 44.742 B | Clasificación pendiente |
| BKP-BH-04 | Archivo de leads | OneDrive | 523.432 B | Posibles datos; privacidad pendiente |
| BKP-BH-05 | Leads pre-clean | OneDrive | 387.800 B | Posibles datos; privacidad pendiente |
| ARC-BH-01 | Pre-Autohunter | OneDrive | 4 archivos / 17.276 B | Archivo histórico no validado |
| BKP-XOSE-01 | ZIP de fotografías Xose | OneDrive | 2.766.679 B | Mismo dominio de fallo; derechos pendientes |
| BKP-XOSE-02 | Snapshot Learning Heroes | OneDrive | 3.648 B | Cobertura mínima; restore pendiente |
| COPY-OX-01 | Copia Git histórica OXKIO | Fuera de OneDrive, mismo portátil | HEAD `d0d30b7…`; 2.422.131 B versionados | No cubre pérdida del portátil |
| COPY-OX-02 | Copia Git histórica OXKIO | Fuera de OneDrive, mismo portátil | HEAD `98b2998…`; 2.368.418 B versionados | No cubre pérdida del portátil |
| COPY-OX-GH | Remoto Git OXKIO | GitHub configurado | HEAD `a25361596bf3d5afc1c5c993290f44bd423c1ecc` restaurado | **RESTORE VERSIONADO VALIDADO**; no cubre secretos ni stores ignorados |
| COPY-SHOP-GH | Remoto Git Shop | GitHub configurado | HEAD `c0f259e8f4403da7730814ea70429453087651d4` restaurado | **RESTORE VERSIONADO VALIDADO**; no demuestra hosting |
| COPY-REPORTS-01 | Informes PDF | Descargas | 14 archivos / 733.757 B | Dispersión y fuente incierta |
| PRES-STASH-01 | Preservación Git M0001 | `stash@{0}` en OXKIO | `81bcf4a97a7cf6c0afde328c0242ff0718297cc9` | Preservación de trabajo, no backup |

RESTORE-01/02/05 demostraron recuperación e integridad de los remotos Git indicados. Para las demás copias no se ha demostrado cifrado, checksum lateral, inmutabilidad, retención ni recuperación.

## 16. Estado de los planes de recuperación

RESTORE-01, RESTORE-02 y RESTORE-05 fueron ejecutados con autorización separada. Los demás planes permanecen **PENDIENTES DE EJECUCIÓN**.

| Plan | Objetivo y fuente | Destino controlado | Evidencia de éxito | Riesgo / rollback |
|---|---|---|---|---|
| RESTORE-01 — **GO** | OXKIO clonado desde GitHub | Sandbox nuevo fuera de OneDrive, preservado | HEAD `a253615…`, 352 archivos, árbol limpio y `git fsck` satisfactorio; clone 7,04 s | Mismo portátil; no recupera secretos, stores ignorados ni infraestructura |
| RESTORE-02 — **GO CON INCIDENCIA EOL** | G0001 y G0001-A1 recuperados desde el clone RESTORE-01 | Mismo sandbox preservado | Blobs Git exactos; auditoría principal 1,03 s | Working tree CRLF por `core.autocrlf=true`; índice LF y diff lógico limpio |
| RESTORE-03 | Recuperar Business Hunter desde Git local o mejor copia | Temporal aislado | HEAD y catálogo/datasets esperados | Sin escrituras sobre datos activos |
| RESTORE-04 | Recuperar Xose desde repositorio legado | Temporal aislado | Separación Git/multimedia/instaladores y catálogo verificable | No ejecutar binarios; no renombrar origen |
| RESTORE-05 — **GO CON INCIDENCIA EOL** | XANTALALSHOP clonado desde GitHub | Sandbox nuevo fuera de OneDrive, preservado | HEAD `c0f259e…`, 15 archivos, 14 assets y `git fsck` satisfactorio; clone 2,20 s | No demuestra hosting; 9 textos CRLF y 6 binarios preservados |
| RESTORE-06 | Validar snapshot JSON | Sandbox sin datos reales activos | Parseo, esquema y recuentos válidos | Nunca sobrescribir store operativo |
| RESTORE-07 | Simular pérdida de OneDrive | Fuentes independientes solamente | Lista de activos recuperables y brechas documentada | No desconectar ni borrar OneDrive |
| RESTORE-08 | Ejercicio de recuperación de cuentas | Tabletop o solo lectura | Propietario, MFA, canales y tiempos confirmados sin exponer secretos | No cambiar cuentas, factores ni códigos |

Las pruebas se realizaron en el mismo portátil y no simulan una pérdida física total. No se iniciaron runtimes, instalaron dependencias, recuperaron secretos ni reconstruyeron datos privados. Los sandboxes permanecen preservados y su limpieza requiere autorización separada.

## 17. RPO y RTO preliminares

> **OBJETIVOS INTERNOS PARCIALMENTE RATIFICADOS — NO SON SLA CONTRACTUALES**

| Clase | Ejemplos | RPO propuesto | RTO objetivo | Estado |
|---|---|---|---|---|
| Identidad, secretos y dominio | Cuentas admin, DNS, recuperación | Cercano a cero por cada cambio autorizado | 4–8 horas | Preliminar |
| Datos operativos críticos | Aprobaciones, memoria, agenda, registros esenciales | ≤ 4 horas | Menos de 8 horas o antes | **RATIFICADO COMO OBJETIVO INTERNO** |
| Constitución y código | Gobierno, repositorios, releases | Cada commit aprobado | 2–4 horas o antes | **RATIFICADO COMO OBJETIVO INTERNO** |
| Productos e IP | Datasets, documentación, multimedia vigente | 24 horas | 24–48 horas | Preliminar |
| Histórico | Archivos y snapshots no operativos | 7 días | 3–7 días | Preliminar |
| Temporal/regenerable | Cachés, salidas reproducibles | Mejor esfuerzo / regeneración | Según coste de regeneración | Preliminar |

Los restores Git realizados quedaron muy por debajo del objetivo de código y gobernanza en este entorno, pero no prueban pérdida total del portátil ni capacidad contractual. Los objetivos restantes requieren impacto, presupuesto, volumen y obligaciones legales antes de ratificarse.

## 18. Matriz de fuente canónica

| Dominio | Fuente canónica actual o futura | Exclusiones |
|---|---|---|
| Constitución | G0001 en Git `main` de OXKIO | Chats, copias y resúmenes no prevalecen |
| Mapa de activos | G0001-A1 en Git `main` tras aprobación y commit | Este working tree no es canónico hasta completar el ciclo |
| Gobierno corporativo | Repositorio raíz XANTALAL; remoto privado futuro | No duplicar constituciones |
| Gobierno OXKIO | G0001 y documentos subordinados aprobados | Roadmaps históricos no prevalecen |
| Código | Git del producto correspondiente | ZIP y copias históricas no prevalecen |
| Datos | Persistencia aprobada; actualmente stores locales identificados | Firestore/PG no se asumen operativos |
| Memoria | Store operativo autorizado | Chats no son memoria canónica |
| Conocimiento | Fuente documental original + Knowledge Objects gobernados | Resúmenes no trazables no prevalecen |
| Secretos | Gestor seguro futuro; hoy solo se gobiernan metadatos locales | Git, documentación y chats nunca contienen valores |
| Identidad | Firebase mientras continúe aprobado | No implica aislamiento demostrado |
| Dominio/DNS | Registrador y proveedor DNS confirmados | Documentación histórica no prueba control actual |
| Hosting | Proveedor efectivo + configuración versionada | Propuestas no equivalen a despliegue |
| Propiedad intelectual y media | Repositorio o almacén de activos aprobado | Carpetas dispersas no son catálogo canónico |
| Conversaciones y herramientas IA | Evidencia de procedencia | Nunca fuente única de autoridad |
| OneDrive | Workspace/sincronización | No fuente universal ni backup suficiente |
| Copias y backups | Copias de continuidad | No canónicas mientras exista una fuente vigente válida |

## 19. Red Team de continuidad

| Escenario | Impacto | Defensa/recuperación actual | Riesgo residual | Próxima evidencia |
|---|---|---|---|---|
| Pérdida o avería del portátil | Pérdida de activos locales, secretos y copias | Remotos OXKIO y XANTALALSHOP con restore versionado validado | Crítico para datos privados y activos no Git | RESTORE-07 y copia independiente |
| Bloqueo o pérdida de OneDrive/Microsoft | Indisponibilidad transversal | Remotos Git parciales | Crítico por dominio común | ACC-MS-01 + copia independiente |
| Pérdida de GitHub | Repositorios remotos inaccesibles | Git local y sandboxes restaurados en el mismo portátil | Alto; XANTALAL/BH/Xose sin remoto y sin independencia física | Auditoría de cuenta + remotos aprobados |
| Pérdida de Google | OAuth, Drive e identidad afectados | No demostrada | Alto | ACC-GOOGLE-01 y RESTORE-08 |
| Pérdida de OpenAI | Capacidad de IA y flujos asociados | Código/documentos locales | Medio/alto | Plan de continuidad funcional |
| Pérdida de Firebase | Login y datos potenciales afectados | Reglas/estado reales desconocidos | Crítico antes de Cliente Cero | Auditoría estática/solo lectura autorizada |
| Revocación/corrupción OAuth | Integraciones interrumpidas o acceso indebido | Token local identificado | Alto | Aislamiento, rotación gobernada y prueba futura |
| Pérdida de hosting | Servicio no disponible | LucusHost y cPanel declarados activos; backups desconocidos | Alto | Auditar backups y restore de configuración |
| Pérdida o secuestro de dominio | Identidad pública y acceso comprometidos | Registrador y renovación declarados; DNS efectivo desconocido | Crítico | Confirmar DNS, MFA y evidencia de propiedad |
| Ransomware/borrado sincronizado | Daño simultáneo local + nube sincronizada | Copias no validadas | Crítico | Copia independiente e inmutable proporcional |
| Corrupción silenciosa | Copias replican datos dañados | Sin checksums/restore periódicos | Alto | Catálogo, hashes y pruebas de restore |
| Error de agente u operador | Cambios, borrados o accesos indebidos | Git y aprobaciones parciales | Alto | Privilegio mínimo, límites y trazabilidad |
| Indisponibilidad de José Antonio | Bloqueo de cuentas, decisiones y continuidad | Persona de confianza no designada | Crítico | Decisión de continuidad y RESTORE-08 |

## 20. Persona de confianza y continuidad humana

La designación de una persona de confianza está **PENDIENTE DE DECISIÓN**. Este documento no propone nombres ni registra accesos, códigos o canales de recuperación.

La decisión deberá definir alcance, activación, doble control, información mínima, revocación, revisión periódica, custodia física/digital y evidencia. Hasta entonces existe un punto único de fallo humano en José Antonio.

## 21. Nomenclatura legacy y deuda de identidad

| Hallazgo | Clasificación | Regla de tratamiento |
|---|---|---|
| Ruta/repositorio físico `PROFESOR-IA` | **LEGACY** | Conservar por trazabilidad; el activo vigente se denomina Xose |
| Usos públicos o actuales de «Profesor IA» | Deuda P1 | Auditar y corregir antes de publicación, sin renombrado físico automático |
| `profesor-ia.html` en XANTALALSHOP | Archivo versionado; deuda de nomenclatura orientada a superficie pública pendiente antes de publicación, **VERIFICADA** por RESTORE-05 | Sustituir identidad visible por Xose en una misión específica; no sanear durante este cierre |
| ecoSoft | **LEGACY** / prohibición / deuda | No presentarlo como producto vigente |
| Rutas antiguas en `orchestration/PROJECTS.md` | Deuda P1 | Corregidas en la propuesta de cierre con rutas físicamente verificadas |
| Comentario de `.gitignore` raíz sobre habilitar OXKIO posteriormente | Deuda documental | Revisar sin alterar la separación de repositorios |
| Estados divergentes en README y gobierno raíz | Doble gobernanza | Consolidar mediante enlaces y autoridad, no copias divergentes |

Antes de cualquier publicación deberán auditarse UI/web, README, roadmaps, documentación vigente, activos gráficos y metadatos. La migración de rutas físicas es una decisión separada con plan de compatibilidad y rollback.

## 22. Microproductos futuros

**OPORTUNIDAD ESTRATÉGICA FUTURA — NO PRIORITARIA.**

Podrían existir microagentes, pequeñas aplicaciones, automatizaciones especializadas, herramientas de venta o utilidades de propósito único que reutilicen OXKIO. Cualquier propuesta deberá:

- tener alcance limitado y resultado medible;
- reutilizar capacidades centrales sin crear arquitectura paralela;
- aplicar permisos mínimos y aislamiento;
- evitar deuda de producto y costes no aprobados;
- no desplazar la prioridad de Cliente Cero;
- recibir misión y autorización propias.

Este documento no inicia ningún microproducto.

## 23. Decisiones pendientes por clase

### Clase A — pueden permanecer desconocidas en esta baseline

- visibilidad efectiva de los remotos GitHub;
- backups, restore y configuración exacta del hosting;
- proveedor futuro de backups;
- contenido real de Google Drive;
- vigencia de copias históricas no operativas;
- detalles no críticos de archivos legacy.

### Clase B — necesarias antes de Cliente Cero estable

- campos aún desconocidos de MFA, recuperación y administradores adicionales;
- DNS efectivo, SSL y evidencia externa de los dominios declarados;
- persona de confianza y protocolo de continuidad;
- presupuesto y proveedor de copia independiente;
- ratificación de los RPO/RTO todavía preliminares;
- política de retención, privacidad y propiedad intelectual;
- visibilidad y protección real de los remotos;
- fuente canónica aprobada de cada dato operativo.

### Clase C — requieren misión técnica futura

- crear remotos privados donde proceda;
- crear copia independiente de OneDrive;
- ejecutar RESTORE-03, RESTORE-04 y RESTORE-06 a RESTORE-08; RESTORE-01/02/05 están cerrados con GO;
- auditar Firestore en solo lectura;
- diseñar e implantar aislamiento bajo G0005;
- implantar gestor seguro de secretos;
- decidir/implantar PostgreSQL;
- migrar nomenclatura y rutas legacy;
- automatizar backup, checksums, retención y alertas.

## 24. Enlaces de cierre y referencia corporativa futura

La propuesta de cierre actualiza únicamente los tres consumidores mínimos que contienen estado operativo o inventario obsoleto:

1. `OXKIO-MASTER-SESSION.md`: hito `a253615…`, restores y continuidad pendiente;
2. `CLIENTE-CERO-ASSET-REGISTRY.md`: subordinación a G0001-A1, confirmaciones sin secretos y nomenclatura vigente;
3. `orchestration/PROJECTS.md`: rutas verificadas, Xose vigente y enlace al mapa.

G0001 Rev. A permanece como documento superior y no necesita modificación para registrar estos hechos. En el repositorio raíz XANTALAL se propone, en otra microfase y sin duplicar este texto, añadir desde `README.md` una referencia al repositorio OXKIO y a G0001/G0001-A1. `orchestration/ROADMAP.md` y `orchestration/TASKS.md` no requieren cambios para este cierre.

## 25. Condiciones de continuidad por activo

Un activo solo podrá declararse recuperable cuando exista:

1. fuente canónica identificada;
2. custodio y autoridad confirmados;
3. al menos una copia independiente adecuada a su criticidad;
4. cifrado y control de acceso proporcionales;
5. retención y RPO/RTO aprobados;
6. restore ejecutado con evidencia;
7. incidencias y brechas registradas;
8. revisión periódica asignada.

OXKIO y XANTALALSHOP cumplen de forma demostrada la recuperación de contenido Git versionado desde sus remotos. No cumplen todavía continuidad integral: los tests se realizaron en el mismo portátil y no cubren datos privados, secretos, hosting, DNS, multimedia no Git ni infraestructura.

## 26. Reglas de mantenimiento del mapa

- Toda alta, baja, cambio de custodio, fuente canónica, ubicación o criticidad debe actualizar este mapa mediante misión aprobada.
- No se registrarán valores secretos ni datos personales innecesarios.
- Las rutas y cuentas se documentarán al nivel mínimo suficiente para recuperación.
- Una copia no cambiará a «backup validado» sin restore documentado.
- Un estado **PROPUESTO** no cambiará a **VERIFICADO** por mera aprobación documental.
- Los activos legacy conservarán trazabilidad hasta que exista migración y rollback aprobados.
- Las contradicciones se resolverán por autoridad y fecha, nunca borrando evidencia histórica sin política de retención.

## 27. Limitaciones de la baseline

Esta baseline se construyó con inspección estática local, declaraciones aprobadas del Cliente Cero y conexiones a GitHub limitadas a los clones autorizados de RESTORE-01 y RESTORE-05. No se realizaron conexiones a Firebase, Google APIs, Microsoft, OpenAI, hosting ni DNS. No se iniciaron servicios, ejecutaron logins, leyeron valores de secretos ni restauraron stores ignorados.

RESTORE-01/02/05 probaron recuperación versionada en sandboxes fuera de OneDrive, pero dentro del mismo portátil. La incidencia EOL `i/lf, w/crlf` causada por `core.autocrlf=true` queda registrada como deuda técnica no bloqueante porque blobs, árboles, `git fsck`, status y diff fueron íntegros. No se modifican ahora `core.autocrlf` ni `.gitattributes`.

Los tamaños, rutas, HEAD y estados corresponden a la evidencia auditada; pueden cambiar después de la fecha de referencia. La titularidad jurídica, obligaciones regulatorias, licencias, consentimientos y fiscalidad están fuera del alcance técnico y **REQUIEREN CONFIRMACIÓN** profesional cuando proceda.

## 28. Auditoría documental requerida antes de aprobación

La auditoría precommit deberá comprobar:

- ruta única y nombre exacto;
- relación subordinada con G0001 Rev. A;
- presencia de los estados de honestidad;
- cinco repositorios y activos no Git;
- arquitectura central + aislamiento privado y Cliente Cero dual;
- cuentas sin valores sensibles;
- dominios, datos, secretos y OneDrive sin afirmaciones no demostradas;
- catálogo de copias distinguiendo restores validados y pendientes;
- RESTORE-01/02/05 cerrados y los restantes pendientes;
- RTO de código/gobernanza y datos críticos como objetivos internos ratificados, no SLA;
- Xose vigente, `PROFESOR-IA` legacy y ecoSoft no vigente;
- microproductos no prioritarios;
- decisiones A/B/C y enlaces propuestos;
- ausencia de valores secretos, correos privados y credenciales;
- diff limitado a G0001-A1 y los tres consumidores mínimos autorizados antes de `git add`.

## 29. Fuentes utilizadas

1. G0001 Rev. A, documento constitucional superior.
2. Informes aprobados G0001 Fase 1 y Fase 2, incluida la Matriz de Consolidación.
3. Auditorías aprobadas M0001.1, M0001.1B y M0001.1B.1.
4. Evidencia Git local de los cinco repositorios identificados.
5. Documentación de gobernanza, roadmap, orquestación, arquitectura, stores y pruebas de concepto del proyecto.
6. Decisiones posteriores expresamente aprobadas por José Antonio y consolidadas para esta misión.
7. Informes ratificados RESTORE-01, RESTORE-02 y RESTORE-05, ejecutados el 2026-08-01.

Las conversaciones y herramientas de IA son fuentes de procedencia y trabajo, no autoridad canónica independiente.

## 30. Historial de versión

| Versión | Fecha | Cambio | Estado |
|---|---|---|---|
| 0.1.0 | 2026-08-01 | Primera formalización física del mapa maestro | Baseline sujeta a auditoría precommit y aprobación |
| 0.2.0 | 2026-08-01 | Confirmaciones del Cliente Cero, restores Git, RTO internos y enlaces mínimos de cierre | Propuesta de cierre sujeta a auditoría precommit |

---

**Fin de G0001-A1.** Ninguna acción de infraestructura, acceso, restore, gasto, despliegue, migración o tratamiento de datos queda autorizada por la mera existencia de este documento.
