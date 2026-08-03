'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const resolverModule = require('./project-access-resolver');
const {
  ProjectAccessResolutionError,
  createClientZeroProjectBootstrapProvider,
  createProjectAccessResolver,
} = resolverModule;

const SCOPE = Object.freeze({
  tenantId: 'tenant-synthetic-alpha',
  userId: 'user-synthetic-alpha',
  clientId: 'client-synthetic-alpha',
  roles: Object.freeze(['operator']),
});
const GRANT = Object.freeze({
  capability: 'mission:create',
  tenantId: SCOPE.tenantId,
  userId: SCOPE.userId,
  clientId: SCOPE.clientId,
});
const PROJECT_ID = 'project-synthetic-alpha';
const WORKSPACE_ID = 'workspace-synthetic-alpha';

function project(overrides = {}) {
  return {
    tenantId: SCOPE.tenantId,
    clientId: SCOPE.clientId,
    projectId: PROJECT_ID,
    status: 'ACTIVE',
    workspaceIds: [WORKSPACE_ID],
    ...overrides,
  };
}

function providerReturning(value) {
  return { findProjects: async () => value };
}

function resolverWith(value) {
  return createProjectAccessResolver({ provider: providerReturning(value) });
}

function request(overrides = {}) {
  return {
    scope: SCOPE,
    capabilityGrant: GRANT,
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => (
    error instanceof ProjectAccessResolutionError && error.code === code
  ));
}

test('exports only the minimal frozen resolver surface', () => {
  assert.equal(Object.isFrozen(resolverModule), true);
  assert.deepEqual(Object.keys(resolverModule).sort(), [
    'ProjectAccessResolutionError',
    'createClientZeroProjectBootstrapProvider',
    'createProjectAccessResolver',
  ]);
});

test('resolves exactly one active project and explicit workspace', async () => {
  const resolver = resolverWith([project()]);
  const access = await resolver.resolveProjectAccess(request());
  assert.deepEqual(access, { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID });
  assert.equal(Object.isFrozen(resolver), true);
  assert.equal(Object.isFrozen(access), true);
});

test('accepts workspaceId null for an authorized project', async () => {
  const access = await resolverWith([project()]).resolveProjectAccess(request({ workspaceId: null }));
  assert.deepEqual(access, { projectId: PROJECT_ID, workspaceId: null });
});

test('rejects nonexistent, spoofed, and foreign project authority without disclosure', async () => {
  const privateValues = [
    'tenant-private-foreign',
    'client-private-foreign',
    'project-private-foreign',
  ];
  for (const candidates of [
    [],
    [project({ projectId: 'project-private-foreign' })],
    [project({ tenantId: 'tenant-private-foreign' })],
    [project({ clientId: 'client-private-foreign' })],
  ]) {
    try {
      await resolverWith(candidates).resolveProjectAccess(request());
      assert.fail('Expected project access denial.');
    } catch (error) {
      assert.equal(error.code, 'project_access_not_available');
      for (const value of privateValues) assert.equal(error.message.includes(value), false);
    }
  }
});

test('rejects nonexistent, other-project, and cross-scope workspace authority', async () => {
  for (const workspaceIds of [
    [],
    ['workspace-synthetic-other-project'],
    ['workspace-synthetic-foreign-scope'],
  ]) {
    await expectCode(
      resolverWith([project({ workspaceIds })]).resolveProjectAccess(request()),
      'project_access_not_available',
    );
  }
});

test('rejects inactive and unknown project states', async () => {
  for (const status of ['SUSPENDED', 'REVOKED', 'UNKNOWN', undefined]) {
    await expectCode(
      resolverWith([project({ status })]).resolveProjectAccess(request()),
      'project_access_not_available',
    );
  }
});

test('requires exactly one applicable project', async () => {
  await expectCode(
    resolverWith([project(), project()]).resolveProjectAccess(request()),
    'project_access_ambiguous',
  );
});

test('rejects absent, invalid, throwing, and malformed providers', async () => {
  assert.throws(
    () => createProjectAccessResolver(),
    (error) => error.code === 'project_access_provider_invalid',
  );
  assert.throws(
    () => createProjectAccessResolver({ provider: {} }),
    (error) => error.code === 'project_access_provider_invalid',
  );
  await expectCode(
    createProjectAccessResolver({
      provider: { findProjects: async () => { throw new Error('private provider detail'); } },
    }).resolveProjectAccess(request()),
    'project_access_provider_unavailable',
  );
  await expectCode(resolverWith({ project: project() }).resolveProjectAccess(request()), 'project_access_data_invalid');
  for (const candidate of [null, {}, { ...project(), path: 'private-path' }, project({ workspaceIds: 'invalid' })]) {
    await expectCode(resolverWith([candidate]).resolveProjectAccess(request()), 'project_access_data_invalid');
  }
});

test('binds the exact mission:create grant to tenant, user, and client', async () => {
  for (const capabilityGrant of [
    { ...GRANT, capability: 'mission:read' },
    { ...GRANT, tenantId: 'tenant-synthetic-other' },
    { ...GRANT, userId: 'user-synthetic-other' },
    { ...GRANT, clientId: 'client-synthetic-other' },
    { ...GRANT, projectId: PROJECT_ID },
  ]) {
    await expectCode(
      resolverWith([project()]).resolveProjectAccess(request({ capabilityGrant })),
      'project_access_grant_invalid',
    );
  }
});

test('rejects a fabricated mission:create grant when current tenant roles do not authorize it', async () => {
  await expectCode(
    resolverWith([project()]).resolveProjectAccess(request({
      scope: { ...SCOPE, roles: ['viewer'] },
      capabilityGrant: GRANT,
    })),
    'project_access_grant_invalid',
  );
});

test('rejects invalid scope, caller authority fields, and local paths before provider access', async () => {
  let providerCalls = 0;
  const resolver = createProjectAccessResolver({
    provider: { findProjects: async () => { providerCalls += 1; return [project()]; } },
  });
  const invalidRequests = [
    request({ scope: { ...SCOPE, tenantId: '' } }),
    request({ scope: { ...SCOPE, platformRole: 'admin' } }),
    { ...request(), authorized: true },
    request({ projectId: 'C:\\private\\project' }),
    request({ workspaceId: 'C:\\private\\workspace' }),
  ];
  for (const input of invalidRequests) {
    await expectCode(
      resolver.resolveProjectAccess(input),
      input.scope && Object.hasOwn(input.scope, 'platformRole')
        ? 'project_access_scope_invalid'
        : (Object.hasOwn(input, 'authorized') ? 'project_access_request_invalid'
          : (input.scope && input.scope.tenantId === ''
            ? 'project_access_scope_invalid'
            : 'project_access_request_invalid')),
    );
  }
  assert.equal(providerCalls, 0);
});

test('does not infer authority from human or legacy names', async () => {
  const resolver = resolverWith([project()]);
  for (const projectId of ['OXKIO', 'PROFESOR-IA', 'XANTALALSHOP']) {
    await expectCode(
      resolver.resolveProjectAccess(request({ projectId })),
      'project_access_not_available',
    );
  }
});

test('disabled bootstrap exposes no project authority', async () => {
  for (const configuration of [undefined, {}, { enabled: false }]) {
    const provider = createClientZeroProjectBootstrapProvider(configuration);
    assert.equal(Object.isFrozen(provider), true);
    assert.deepEqual(Object.keys(provider), ['findProjects']);
    await expectCode(
      createProjectAccessResolver({ provider }).resolveProjectAccess(request()),
      'project_access_not_available',
    );
  }
});

test('enabled bootstrap resolves only explicit synthetic project authority', async () => {
  const provider = createClientZeroProjectBootstrapProvider({
    enabled: true,
    tenantId: SCOPE.tenantId,
    clientId: SCOPE.clientId,
    projects: [{ projectId: PROJECT_ID, workspaceIds: [WORKSPACE_ID] }],
  });
  const resolver = createProjectAccessResolver({ provider });
  assert.deepEqual(await resolver.resolveProjectAccess(request()), {
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
  });
  await expectCode(
    resolver.resolveProjectAccess(request({ projectId: 'project-synthetic-missing' })),
    'project_access_not_available',
  );
});

test('bootstrap rejects partial, unexpected, duplicate, and malformed configuration', () => {
  const configurations = [
    { enabled: true },
    { enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId },
    { enabled: true, tenantId: '', clientId: SCOPE.clientId, projects: [] },
    { enabled: true, tenantId: SCOPE.tenantId, clientId: '', projects: [] },
    { enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId, projects: {} },
    { enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId, projects: [{}] },
    {
      enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId,
      projects: [{ projectId: PROJECT_ID, workspaceIds: [] }, { projectId: PROJECT_ID, workspaceIds: [] }],
    },
    {
      enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId,
      projects: [{ projectId: PROJECT_ID, workspaceIds: [WORKSPACE_ID, WORKSPACE_ID] }],
    },
    {
      enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId,
      projects: [
        { projectId: PROJECT_ID, workspaceIds: [WORKSPACE_ID] },
        { projectId: 'project-synthetic-beta', workspaceIds: [WORKSPACE_ID] },
      ],
    },
    {
      enabled: true, tenantId: SCOPE.tenantId, clientId: SCOPE.clientId,
      projects: [{ projectId: PROJECT_ID, workspaceIds: [], path: 'private-path' }],
    },
    { enabled: false, projects: [] },
  ];
  for (const configuration of configurations) {
    assert.throws(
      () => createClientZeroProjectBootstrapProvider(configuration),
      (error) => error.code === 'project_bootstrap_configuration_invalid',
    );
  }
});

test('bootstrap snapshots and freezes injected authority configuration', async () => {
  const workspaceIds = [WORKSPACE_ID];
  const projects = [{ projectId: PROJECT_ID, workspaceIds }];
  const configuration = {
    enabled: true,
    tenantId: SCOPE.tenantId,
    clientId: SCOPE.clientId,
    projects,
  };
  const provider = createClientZeroProjectBootstrapProvider(configuration);
  configuration.tenantId = 'tenant-mutated';
  configuration.clientId = 'client-mutated';
  projects[0].projectId = 'project-mutated';
  workspaceIds[0] = 'workspace-mutated';
  assert.deepEqual(await provider.findProjects({
    tenantId: SCOPE.tenantId,
    clientId: SCOPE.clientId,
    projectId: PROJECT_ID,
  }), [project()]);
});

test('successful access is minimal and provides no mutation or fallback surface', async () => {
  const resolver = resolverWith([project()]);
  assert.deepEqual(Object.keys(resolver), ['resolveProjectAccess']);
  const access = await resolver.resolveProjectAccess(request());
  assert.deepEqual(Object.keys(access).sort(), ['projectId', 'workspaceId']);
  for (const field of ['authorized', 'provider', 'projects', 'path', 'name', 'memory', 'mission']) {
    assert.equal(Object.hasOwn(access, field), false);
  }
  assert.throws(() => { access.workspaceId = null; }, TypeError);
});
