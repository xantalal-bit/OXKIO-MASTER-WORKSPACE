// OXKIO DEFAULT MCP TOOLS V1

const defaultTools = [
  {
    name: "gmail.read",
    description: "Leer correos de Gmail bajo permisos supervisados.",
    status: "PLANNED",
    requiresApproval: true
  },
  {
    name: "gmail.draft",
    description: "Crear borradores de respuesta en Gmail.",
    status: "AVAILABLE_SAFE_MODE",
    requiresApproval: true
  },
  {
    name: "calendar.read",
    description: "Leer eventos del calendario.",
    status: "PLANNED",
    requiresApproval: true
  },
  {
    name: "calendar.create",
    description: "Crear eventos de calendario bajo aprobación supervisada.",
    status: "PLANNED",
    requiresApproval: true
  },
  {
    name: "calendar.update",
    description: "Modificar eventos de calendario bajo aprobación supervisada.",
    status: "PLANNED",
    requiresApproval: true
  },
  {
    name: "memory.search",
    description: "Buscar información en la memoria de Oxkio.",
    status: "AVAILABLE",
    requiresApproval: false
  },
  {
    name: "memory.write",
    description: "Guardar información en la memoria de Oxkio.",
    status: "AVAILABLE_SAFE_MODE",
    requiresApproval: false
  },
  {
    name: "document.search",
    description: "Buscar documentos procesados por Oxkio.",
    status: "AVAILABLE",
    requiresApproval: false
  }
];

module.exports = defaultTools;