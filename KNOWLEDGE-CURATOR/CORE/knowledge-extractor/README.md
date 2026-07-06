\# KNOWLEDGE EXTRACTOR V1



\## Objetivo



Convertir cualquier contenido autorizado en un Knowledge Object estándar para Oxkio.



\## Entrada



Contenido bruto procedente de un conector:



\- Gmail

\- Learning Heroes

\- Google Drive

\- OneDrive

\- Discord

\- Telegram

\- GitHub

\- archivos locales

\- futuras fuentes



\## Responsabilidad del extractor



El extractor debe intentar detectar y extraer:



\- título

\- resumen

\- enlaces

\- documentos

\- imágenes

\- vídeos

\- prompts

\- herramientas

\- proyectos relacionados

\- etiquetas

\- prioridad

\- confianza



\## Recursos enlazados o adjuntos



Si detecta recursos comunes, debe intentar procesarlos automáticamente cuando sea posible:



\- PDF

\- DOCX

\- XLSX

\- PPTX

\- TXT

\- MD

\- ZIP

\- imágenes

\- vídeos

\- enlaces web



\## Regla de recursos



\- Si puede extraerlo directamente, lo extrae.

\- Si no puede extraerlo, lo registra como recurso pendiente.

\- Si no reconoce el tipo, lo guarda como enlace pendiente de revisión.



\## Salida



Debe generar un Knowledge Object compatible con:



CORE/knowledge-object/knowledge-object.schema.json



\## Límites



El extractor no accede directamente a Gmail, Drive, Discord ni ninguna otra fuente.



Los conectores obtienen los datos.



El extractor solo procesa contenido.



\## Principio Xantalal



Un solo extractor genérico para múltiples fuentes.



No crear extractores específicos si el problema puede resolverse con un motor común.

