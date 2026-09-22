'use strict';

// OXKIO ECOSYSTEM OBSERVER FAILS - IMPLEMENTACION CANONICA DE CONTINUIDAD
// (22/09/2026): tests unitarios de la extraccion de continuityPolicy /
// canonicalReentryPolicy desde XANTALAL/00_GOVERNANCE/
// SUPERVISOR-RULES-REGISTRY-V1.md, usando fixtures markdown controlados
// (nunca el documento real) para probar el contrato de forma/estructura,
// no la redaccion literal actual.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { readGovernanceStateView } = require('./governanceReader');

const SUPERVISOR_RULES_FILENAME = 'SUPERVISOR-RULES-REGISTRY-V1.md';

function withMockedSupervisorRules(content, run) {
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  fs.existsSync = function existsSyncWithFixture(filePath, ...args) {
    if (String(filePath).endsWith(SUPERVISOR_RULES_FILENAME)) return content !== null;
    return originalExistsSync.call(fs, filePath, ...args);
  };
  fs.readFileSync = function readFileSyncWithFixture(filePath, ...args) {
    if (String(filePath).endsWith(SUPERVISOR_RULES_FILENAME)) return content;
    return originalReadFileSync.call(fs, filePath, ...args);
  };
  try {
    run();
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
  }
}

// TEST A: extracts continuityPolicy from a controlled fixture, with
// deliberately different wording than the real document, proving the
// extraction is coupled to the ### heading structure, not to specific prose.
test('extracts continuityPolicy from the Continuity Policy section', () => {
  withMockedSupervisorRules(
    `## Politica de continuidad canonica

### Continuity Policy

- Item de prueba uno sobre continuidad.
- Item de prueba dos sobre continuidad.

### Canonical Reentry Policy

- Item de reentrada de prueba.
`,
    () => {
      const view = readGovernanceStateView();
      assert.equal(typeof view.continuityPolicy, 'string');
      assert.match(view.continuityPolicy, /Item de prueba uno sobre continuidad/);
      assert.match(view.continuityPolicy, /Item de prueba dos sobre continuidad/);
    },
  );
});

// TEST B: extracts canonicalReentryPolicy the same way, independently of
// continuityPolicy's content (each section extracted on its own boundary).
test('extracts canonicalReentryPolicy from the Canonical Reentry Policy section', () => {
  withMockedSupervisorRules(
    `### Continuity Policy

- Contenido de continuidad, no debe aparecer en canonicalReentryPolicy.

### Canonical Reentry Policy

- Localizar estado canonico de prueba.
- Verificar evidencia de prueba.
`,
    () => {
      const view = readGovernanceStateView();
      assert.equal(typeof view.canonicalReentryPolicy, 'string');
      assert.match(view.canonicalReentryPolicy, /Localizar estado canonico de prueba/);
      assert.match(view.canonicalReentryPolicy, /Verificar evidencia de prueba/);
      assert.doesNotMatch(view.canonicalReentryPolicy, /no debe aparecer en canonicalReentryPolicy/);
    },
  );
});

// TEST C: if the section is entirely absent (document rewritten without
// preserving it), the reader fails safely to an empty string - it never
// invents policy content.
test('returns an empty continuityPolicy/canonicalReentryPolicy when the section is absent, never invents content', () => {
  withMockedSupervisorRules(
    '## Otras reglas\n\n- Una regla sin relacion con continuidad.\n',
    () => {
      const view = readGovernanceStateView();
      assert.equal(view.continuityPolicy, '');
      assert.equal(view.canonicalReentryPolicy, '');
    },
  );
});

test('returns an empty continuityPolicy/canonicalReentryPolicy when the file itself is missing', () => {
  withMockedSupervisorRules(null, () => {
    const view = readGovernanceStateView();
    assert.equal(view.continuityPolicy, '');
    assert.equal(view.canonicalReentryPolicy, '');
  });
});

// TEST D: minor rewording under the same heading structure keeps working -
// the parser is coupled to the ### headings, not to any specific sentence.
test('minor rewording under the same headings does not break extraction', () => {
  withMockedSupervisorRules(
    `### Continuity Policy

- Formulacion alternativa: recuperar el ultimo estado conocido antes de avanzar.

### Canonical Reentry Policy

- Formulacion alternativa: revisar el historial de ChatGPT antes de reanudar.
`,
    () => {
      const view = readGovernanceStateView();
      assert.match(view.continuityPolicy, /Formulacion alternativa: recuperar el ultimo estado conocido/);
      assert.match(view.canonicalReentryPolicy, /Formulacion alternativa: revisar el historial de ChatGPT/);
    },
  );
});

test('readGovernanceStateView always returns the same 7 frozen contract keys', () => {
  withMockedSupervisorRules('## Sin secciones reconocidas\n', () => {
    const view = readGovernanceStateView();
    assert.deepEqual(Object.keys(view), [
      'strategicObjective', 'priorities', 'reminders', 'learnedLessons',
      'continuityPolicy', 'canonicalReentryPolicy', 'strategicRecommendations',
    ]);
    assert.equal(Object.isFrozen(view), true);
  });
});
