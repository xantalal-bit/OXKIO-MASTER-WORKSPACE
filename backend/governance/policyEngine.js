// OXKIO POLICY ENGINE V1
// Leyes Oficiales de XANTALAL

const POLICIES = [
  {
    id: "operational_simplicity",
    name: "Ley de Simplicidad Operativa",
    statement: "Nunca crear un nuevo agente si una capacidad puede a\u00f1adirse a uno existente."
  },
  {
    id: "minimal_activation",
    name: "Ley de Activaci\u00f3n M\u00ednima",
    statement: "Solo participar\u00e1n los componentes estrictamente necesarios para resolver una tarea."
  }
];

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function collectDecisionText(context) {
  const fields = [
    context.action,
    context.architecture,
    context.decision,
    context.proposal,
    context.recommendation,
    context.summary,
    context.type
  ];

  return normalizeText(fields.filter(Boolean).join(" "));
}

function getReusableAgent(context) {
  return (
    context.reusableAgent ||
    context.existingAgent ||
    context.targetAgent ||
    context.preferredAgent ||
    "Governance Guardian"
  );
}

function violatesOperationalSimplicity(context) {
  const text = collectDecisionText(context);
  const proposesNewAgent =
    context.createNewAgent === true ||
    context.newAgent === true ||
    text.includes("crear nuevo agente") ||
    text.includes("crear un nuevo agente") ||
    text.includes("nuevo agente") ||
    text.includes("new agent");

  const canReuseExisting =
    context.capabilityCanBeAddedToExisting === true ||
    context.canReuseExistingAgent === true ||
    Boolean(context.reusableAgent || context.existingAgent || context.targetAgent);

  return proposesNewAgent && canReuseExisting;
}

function countItems(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (Number.isFinite(value)) {
    return value;
  }

  return 0;
}

function violatesMinimalActivation(context) {
  const unnecessaryComponents = Array.isArray(context.unnecessaryComponents)
    ? context.unnecessaryComponents
    : [];
  const participatingCount = countItems(context.components || context.participatingComponents);
  const requiredCount = countItems(context.requiredComponents || context.strictlyNecessaryComponents);

  return (
    context.strictMinimum === false ||
    unnecessaryComponents.length > 0 ||
    (requiredCount > 0 && participatingCount > requiredCount)
  );
}

function loadPolicies() {
  return POLICIES.map((policy) => ({ ...policy }));
}

function listPolicies() {
  return loadPolicies();
}

function validateDecision(context = {}) {
  if (!context || typeof context !== "object") {
    return { approved: true };
  }

  if (violatesOperationalSimplicity(context)) {
    return {
      approved: false,
      violatedPolicy: "Ley de Simplicidad Operativa",
      recommendation: `Reutilizar ${getReusableAgent(context)}.`
    };
  }

  if (violatesMinimalActivation(context)) {
    return {
      approved: false,
      violatedPolicy: "Ley de Activaci\u00f3n M\u00ednima",
      recommendation: "Reducir la participaci\u00f3n a los componentes estrictamente necesarios."
    };
  }

  return { approved: true };
}

module.exports = {
  loadPolicies,
  listPolicies,
  validateDecision
};
