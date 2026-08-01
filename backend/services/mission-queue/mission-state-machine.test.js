'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DOMAIN_EVENT_TYPES,
  MISSION_STATES,
  TASK_STATES,
  createMission,
} = require('./mission-contract');
const {
  MISSION_TRANSITIONS,
  TASK_TRANSITIONS,
  addBlocker,
  addTask,
  linkApproval,
  recordEvidence,
  resolveBlocker,
  transitionMission,
  transitionTask,
} = require('./mission-state-machine');

const NOW = '2026-08-01T11:00:00.000Z';
const LATER = '2026-08-01T11:05:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-test-alpha',
  userId: 'user-test-owner',
  clientId: 'client-test-zero',
});

function missionInput(overrides = {}) {
  return {
    missionId: 'mission-state-001',
    title: 'Probar máquina de estados',
    objective: 'Validar transiciones y guards del dominio puro',
    scope: 'Pruebas sintéticas sin runtime',
    clientId: SCOPE.clientId,
    projectId: 'project-test-oxkio',
    workspaceId: 'workspace-test-main',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: 'mission-criterion-1',
      description: 'La misión dispone de evidencia verificable',
    }],
    nextAction: 'Añadir una tarea',
    sourceInteractionId: 'interaction-state-001',
    ...overrides,
  };
}

function taskInput(missionId, overrides = {}) {
  return {
    taskId: 'task-main-001',
    missionId,
    action: 'Ejecutar una comprobación sintética',
    dependencies: [],
    assignee: SCOPE.userId,
    requiredApprovalIds: [],
    evidence: [],
    result: null,
    acceptanceCriteria: [{
      criterionId: 'task-criterion-1',
      description: 'La tarea dispone de evidencia verificable',
    }],
    nextAction: 'Preparar la tarea',
    retryOfTaskId: null,
    interactionId: 'interaction-task-001',
    operationId: null,
    resourceKeys: [],
    ...overrides,
  };
}

function newMission(overrides = {}) {
  return createMission(missionInput(overrides), SCOPE, { now: NOW }).mission;
}

function addBasicTask(mission, overrides = {}) {
  return addTask(
    mission,
    taskInput(mission.missionId, overrides),
    SCOPE,
    { now: NOW },
  ).mission;
}

function missionWithReadyTask() {
  let mission = addBasicTask(newMission());
  mission = transitionTask(mission, 'task-main-001', TASK_STATES.READY, SCOPE, { now: NOW }).mission;
  return mission;
}

function readyMission() {
  return transitionMission(
    missionWithReadyTask(),
    MISSION_STATES.READY,
    SCOPE,
    { now: NOW },
  ).mission;
}

function runningMissionWithRunningTask() {
  let mission = transitionMission(
    readyMission(),
    MISSION_STATES.RUNNING,
    SCOPE,
    { now: NOW },
  ).mission;
  mission = transitionTask(
    mission,
    'task-main-001',
    TASK_STATES.RUNNING,
    SCOPE,
    { now: NOW },
  ).mission;
  return mission;
}

function completeMainTask(mission) {
  let updated = recordEvidence(mission, 'evidence-task-001', SCOPE, {
    now: NOW,
    taskId: 'task-main-001',
    criterionIds: ['task-criterion-1'],
  }).mission;
  updated = transitionTask(updated, 'task-main-001', TASK_STATES.COMPLETED, SCOPE, {
    now: NOW,
    result: { status: 'verified' },
  }).mission;
  return updated;
}

function reviewReadyMission() {
  let mission = completeMainTask(runningMissionWithRunningTask());
  mission = recordEvidence(mission, 'evidence-mission-001', SCOPE, {
    now: NOW,
    criterionIds: ['mission-criterion-1'],
  }).mission;
  return transitionMission(mission, MISSION_STATES.UNDER_REVIEW, SCOPE, {
    now: NOW,
    result: { status: 'ready-for-review' },
  }).mission;
}

function rawMissionForTransition(source, target) {
  const mission = JSON.parse(JSON.stringify(missionWithReadyTask()));
  mission.status = source;
  const task = mission.tasks[0];

  if (target === MISSION_STATES.RUNNING) task.status = TASK_STATES.READY;
  if (target === MISSION_STATES.UNDER_REVIEW || target === MISSION_STATES.COMPLETED) {
    task.status = TASK_STATES.COMPLETED;
    task.evidence = [{ reference: 'evidence-task-matrix', linkedAt: NOW }];
    task.result = { status: 'done' };
    task.acceptanceCriteria[0].satisfied = true;
    task.acceptanceCriteria[0].evidenceReferences = ['evidence-task-matrix'];
  }
  if (target === MISSION_STATES.COMPLETED) {
    mission.evidence = [{ reference: 'evidence-mission-matrix', linkedAt: NOW }];
    mission.result = { status: 'reviewed' };
    mission.acceptanceCriteria[0].satisfied = true;
    mission.acceptanceCriteria[0].evidenceReferences = ['evidence-mission-matrix'];
  }
  return mission;
}

function rawMissionForTaskTransition(source, target) {
  const mission = JSON.parse(JSON.stringify(missionWithReadyTask()));
  mission.status = target === TASK_STATES.RUNNING ? MISSION_STATES.RUNNING : MISSION_STATES.READY;
  const task = mission.tasks[0];
  task.status = source;
  if (target === TASK_STATES.COMPLETED) {
    task.evidence = [{ reference: 'evidence-task-matrix', linkedAt: NOW }];
    task.result = null;
    task.acceptanceCriteria[0].satisfied = true;
    task.acceptanceCriteria[0].evidenceReferences = ['evidence-task-matrix'];
  }
  return mission;
}

test('executes every authorized Mission transition in the matrix', () => {
  Object.entries(MISSION_TRANSITIONS).forEach(([source, targets]) => {
    targets.forEach((target) => {
      const mission = rawMissionForTransition(source, target);
      const result = transitionMission(mission, target, SCOPE, {
        now: LATER,
        ...(target === MISSION_STATES.COMPLETED ? { result: { status: 'complete' } } : {}),
      });
      assert.equal(result.mission.status, target, `${source} -> ${target}`);
      assert.equal(result.mission.version, mission.version + 1, `${source} -> ${target} version`);
    });
  });
});

test('rejects central forbidden Mission transitions and preserves original version', () => {
  const proposed = addBasicTask(newMission());
  const originalVersion = proposed.version;
  assert.throws(
    () => transitionMission(proposed, MISSION_STATES.RUNNING, SCOPE, { now: LATER }),
    { code: 'invalid_mission_transition' },
  );
  assert.equal(proposed.status, MISSION_STATES.PROPOSED);
  assert.equal(proposed.version, originalVersion);

  const waiting = rawMissionForTransition(MISSION_STATES.WAITING_APPROVAL, MISSION_STATES.READY);
  assert.throws(
    () => transitionMission(waiting, MISSION_STATES.RUNNING, SCOPE, { now: LATER }),
    { code: 'invalid_mission_transition' },
  );

  const blocked = rawMissionForTransition(MISSION_STATES.BLOCKED, MISSION_STATES.READY);
  assert.throws(
    () => transitionMission(blocked, MISSION_STATES.RUNNING, SCOPE, { now: LATER }),
    { code: 'invalid_mission_transition' },
  );
});

test('keeps all terminal Mission states immutable', () => {
  [MISSION_STATES.COMPLETED, MISSION_STATES.FAILED, MISSION_STATES.CANCELLED].forEach((status) => {
    const mission = rawMissionForTransition(MISSION_STATES.UNDER_REVIEW, MISSION_STATES.COMPLETED);
    mission.status = status;
    assert.throws(
      () => transitionMission(mission, MISSION_STATES.READY, SCOPE, { now: LATER }),
      { code: 'terminal_mission_immutable' },
    );
  });
});

test('enforces READY, UNDER_REVIEW, and COMPLETED Mission guards', () => {
  const empty = newMission();
  assert.throws(
    () => transitionMission(empty, MISSION_STATES.READY, SCOPE, { now: LATER }),
    { code: 'mission_tasks_required' },
  );

  const running = rawMissionForTransition(MISSION_STATES.RUNNING, MISSION_STATES.BLOCKED);
  assert.throws(
    () => transitionMission(running, MISSION_STATES.COMPLETED, SCOPE, { now: LATER }),
    { code: 'invalid_mission_transition' },
  );
  assert.throws(
    () => transitionMission(running, MISSION_STATES.UNDER_REVIEW, SCOPE, { now: LATER }),
    { code: 'mission_review_tasks_incomplete' },
  );

  const missingEvidence = rawMissionForTransition(
    MISSION_STATES.UNDER_REVIEW,
    MISSION_STATES.COMPLETED,
  );
  missingEvidence.evidence = [];
  assert.throws(
    () => transitionMission(missingEvidence, MISSION_STATES.COMPLETED, SCOPE, {
      now: LATER,
      result: { status: 'done' },
    }),
    { code: 'mission_evidence_required' },
  );

  const missingResult = rawMissionForTransition(
    MISSION_STATES.UNDER_REVIEW,
    MISSION_STATES.COMPLETED,
  );
  missingResult.result = null;
  assert.throws(
    () => transitionMission(missingResult, MISSION_STATES.COMPLETED, SCOPE, { now: LATER }),
    { code: 'mission_result_required' },
  );

  const completed = transitionMission(
    reviewReadyMission(),
    MISSION_STATES.COMPLETED,
    SCOPE,
    { now: LATER },
  );
  assert.equal(completed.mission.status, MISSION_STATES.COMPLETED);
  assert.deepEqual(completed.events.map((event) => event.eventType), [
    DOMAIN_EVENT_TYPES.MISSION_STATUS_CHANGED,
    DOMAIN_EVENT_TYPES.MISSION_COMPLETED,
  ]);

  const returnedToReady = transitionMission(
    reviewReadyMission(),
    MISSION_STATES.READY,
    SCOPE,
    { now: LATER },
  );
  assert.equal(returnedToReady.mission.result, null);

  assert.throws(
    () => transitionMission(
      reviewReadyMission(),
      MISSION_STATES.RUNNING,
      SCOPE,
      { now: LATER },
    ),
    { code: 'invalid_mission_transition' },
  );

  let rework = addBasicTask(returnedToReady.mission, {
    taskId: 'task-rework-001',
    interactionId: 'interaction-rework-001',
  });
  rework = transitionTask(
    rework,
    'task-rework-001',
    TASK_STATES.READY,
    SCOPE,
    { now: LATER },
  ).mission;
  const restarted = transitionMission(rework, MISSION_STATES.RUNNING, SCOPE, { now: LATER });
  assert.equal(restarted.mission.status, MISSION_STATES.RUNNING);
});

test('executes every authorized Task transition in the matrix', () => {
  Object.entries(TASK_TRANSITIONS).forEach(([source, targets]) => {
    targets.forEach((target) => {
      const mission = rawMissionForTaskTransition(source, target);
      const result = transitionTask(mission, 'task-main-001', target, SCOPE, {
        now: LATER,
        ...(target === TASK_STATES.COMPLETED ? { result: { status: 'done' } } : {}),
      });
      assert.equal(result.mission.tasks[0].status, target, `${source} -> ${target}`);
      assert.equal(result.mission.version, mission.version + 1, `${source} -> ${target} version`);
    });
  });
});

test('requires completed dependencies before PENDING -> READY', () => {
  let mission = addBasicTask(newMission(), { taskId: 'task-dependency-001' });
  mission = addBasicTask(mission, {
    taskId: 'task-dependent-001',
    dependencies: ['task-dependency-001'],
    acceptanceCriteria: [{
      criterionId: 'task-criterion-2',
      description: 'La dependencia fue satisfecha',
    }],
  });

  assert.throws(
    () => transitionTask(mission, 'task-dependent-001', TASK_STATES.READY, SCOPE, { now: LATER }),
    { code: 'task_dependencies_incomplete' },
  );

  const candidate = JSON.parse(JSON.stringify(mission));
  candidate.tasks[0].status = TASK_STATES.COMPLETED;
  const result = transitionTask(candidate, 'task-dependent-001', TASK_STATES.READY, SCOPE, {
    now: LATER,
  });
  assert.equal(result.mission.tasks[1].status, TASK_STATES.READY);
});

test('separates Task authorization from execution', () => {
  const waiting = rawMissionForTaskTransition(TASK_STATES.WAITING_APPROVAL, TASK_STATES.READY);
  waiting.status = MISSION_STATES.RUNNING;
  assert.throws(
    () => transitionTask(waiting, 'task-main-001', TASK_STATES.RUNNING, SCOPE, { now: LATER }),
    { code: 'invalid_task_transition' },
  );

  const blocked = rawMissionForTaskTransition(TASK_STATES.BLOCKED, TASK_STATES.READY);
  blocked.status = MISSION_STATES.RUNNING;
  assert.throws(
    () => transitionTask(blocked, 'task-main-001', TASK_STATES.RUNNING, SCOPE, { now: LATER }),
    { code: 'invalid_task_transition' },
  );

  const ready = rawMissionForTaskTransition(TASK_STATES.READY, TASK_STATES.RUNNING);
  const running = transitionTask(ready, 'task-main-001', TASK_STATES.RUNNING, SCOPE, {
    now: LATER,
  });
  assert.equal(running.mission.tasks[0].status, TASK_STATES.RUNNING);
});

test('keeps terminal Task states immutable', () => {
  [TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.CANCELLED].forEach((status) => {
    const mission = rawMissionForTaskTransition(status, TASK_STATES.READY);
    assert.throws(
      () => transitionTask(mission, 'task-main-001', TASK_STATES.READY, SCOPE, { now: LATER }),
      { code: 'invalid_task_transition' },
    );
  });
});

test('rejects Task COMPLETED when its acceptance criterion is not satisfied', () => {
  const running = runningMissionWithRunningTask();
  const withUnmatchedEvidence = recordEvidence(running, 'evidence-task-unmatched', SCOPE, {
    now: LATER,
    taskId: 'task-main-001',
    criterionIds: [],
  }).mission;
  assert.throws(
    () => transitionTask(withUnmatchedEvidence, 'task-main-001', TASK_STATES.COMPLETED, SCOPE, {
      now: LATER,
      result: { status: 'done' },
    }),
    { code: 'task_acceptance_incomplete' },
  );
});

test('rejects Task COMPLETED when evidence is missing', () => {
  const running = JSON.parse(JSON.stringify(runningMissionWithRunningTask()));
  running.tasks[0].acceptanceCriteria[0].satisfied = true;
  assert.throws(
    () => transitionTask(running, 'task-main-001', TASK_STATES.COMPLETED, SCOPE, {
      now: LATER,
      result: { status: 'done' },
    }),
    { code: 'task_evidence_required' },
  );
});

test('rejects Task COMPLETED when result is null', () => {
  const running = runningMissionWithRunningTask();
  const evidenced = recordEvidence(running, 'evidence-task-001', SCOPE, {
    now: LATER,
    taskId: 'task-main-001',
    criterionIds: ['task-criterion-1'],
  }).mission;
  assert.throws(
    () => transitionTask(evidenced, 'task-main-001', TASK_STATES.COMPLETED, SCOPE, { now: LATER }),
    { code: 'task_result_required' },
  );
});

test('accepts Task COMPLETED when result, evidence, and criteria are valid', () => {
  const running = runningMissionWithRunningTask();
  const evidenced = recordEvidence(running, 'evidence-task-001', SCOPE, {
    now: LATER,
    taskId: 'task-main-001',
    criterionIds: ['task-criterion-1'],
  }).mission;
  const completed = transitionTask(
    evidenced,
    'task-main-001',
    TASK_STATES.COMPLETED,
    SCOPE,
    { now: LATER, result: { status: 'done' } },
  );
  assert.equal(completed.mission.tasks[0].status, TASK_STATES.COMPLETED);
});

test('valid mutation increments version while rejected mutation leaves input untouched', () => {
  const mission = missionWithReadyTask();
  const before = mission.version;
  const ready = transitionMission(mission, MISSION_STATES.READY, SCOPE, { now: LATER }).mission;
  assert.equal(ready.version, before + 1);

  assert.throws(
    () => transitionMission(mission, MISSION_STATES.COMPLETED, SCOPE, { now: LATER }),
    { code: 'invalid_mission_transition' },
  );
  assert.equal(mission.version, before);
  assert.equal(mission.status, MISSION_STATES.PROPOSED);
});

test('links approvals conceptually without consulting Approval Queue', () => {
  const mission = addBasicTask(newMission());
  const result = linkApproval(
    mission,
    'task-main-001',
    'approval-test-001',
    SCOPE,
    { now: LATER },
  );
  assert.deepEqual(result.mission.requiredApprovals, ['approval-test-001']);
  assert.deepEqual(result.mission.tasks[0].requiredApprovalIds, ['approval-test-001']);
  assert.equal(result.events[0].eventType, DOMAIN_EVENT_TYPES.APPROVAL_LINKED);
});

test('adds and resolves blockers with in-memory domain events', () => {
  const mission = addBasicTask(newMission());
  const added = addBlocker(mission, {
    blockerId: 'blocker-test-001',
    taskId: 'task-main-001',
    type: 'synthetic_blocker',
    reasonCode: 'dependency-wait',
  }, SCOPE, { now: NOW, nextAction: 'Review the synthetic blocker' });
  assert.equal(added.mission.blockers[0].status, 'active');
  assert.equal(added.mission.blockers[0].type, 'synthetic_blocker');
  assert.equal(added.mission.tasks[0].blocker.blockerId, 'blocker-test-001');
  assert.equal(added.mission.nextAction, 'Review the synthetic blocker');
  assert.equal(added.events[0].eventType, DOMAIN_EVENT_TYPES.BLOCKER_ADDED);

  const resolved = resolveBlocker(added.mission, 'blocker-test-001', SCOPE, { now: LATER });
  assert.equal(resolved.mission.blockers[0].status, 'resolved');
  assert.equal(resolved.mission.blockers[0].resolvedAt, LATER);
  assert.equal(resolved.mission.tasks[0].blocker, null);
  assert.equal(resolved.events[0].eventType, DOMAIN_EVENT_TYPES.BLOCKER_RESOLVED);
});

test('records evidence by opaque reference and emits no private content', () => {
  const mission = addBasicTask(newMission({ title: 'Privado no observable' }));
  const result = recordEvidence(mission, 'evidence-mission-001', SCOPE, {
    now: LATER,
    criterionIds: ['mission-criterion-1'],
  });
  const event = result.events[0];
  assert.equal(event.eventType, DOMAIN_EVENT_TYPES.EVIDENCE_LINKED);
  assert.deepEqual(event.evidenceReferences, ['evidence-mission-001']);
  assert.equal(event.tenantId, SCOPE.tenantId);
  assert.equal(event.userId, SCOPE.userId);
  assert.equal(JSON.stringify(event).includes('Privado no observable'), false);
});

test('cancellation preserves the mission and prevents every later mutation', () => {
  const original = newMission();
  const cancelled = transitionMission(original, MISSION_STATES.CANCELLED, SCOPE, {
    now: LATER,
  });
  assert.equal(cancelled.mission.missionId, original.missionId);
  assert.equal(cancelled.mission.status, MISSION_STATES.CANCELLED);
  assert.equal(cancelled.mission.version, original.version + 1);
  assert.equal(cancelled.events[1].eventType, DOMAIN_EVENT_TYPES.MISSION_CANCELLED);
  assert.throws(
    () => addBasicTask(cancelled.mission),
    { code: 'terminal_mission_immutable' },
  );
});

test('task failure keeps evidence and retry creates a new linked Task', () => {
  let mission = runningMissionWithRunningTask();
  mission = recordEvidence(mission, 'evidence-failure-001', SCOPE, {
    now: NOW,
    taskId: 'task-main-001',
    criterionIds: ['task-criterion-1'],
  }).mission;
  mission = transitionTask(mission, 'task-main-001', TASK_STATES.FAILED, SCOPE, {
    now: LATER,
    result: { errorCode: 'synthetic-failure' },
  }).mission;

  const retry = addBasicTask(mission, {
    taskId: 'task-retry-001',
    retryOfTaskId: 'task-main-001',
    interactionId: 'interaction-retry-001',
  });
  assert.equal(retry.tasks[0].status, TASK_STATES.FAILED);
  assert.deepEqual(retry.tasks[0].evidence, mission.tasks[0].evidence);
  assert.equal(retry.tasks[1].retryOfTaskId, 'task-main-001');
  assert.equal(retry.tasks[1].status, TASK_STATES.PENDING);

  assert.throws(
    () => addBasicTask(mission, {
      taskId: 'task-invalid-retry',
      retryOfTaskId: 'task-retry-001',
    }),
    { code: 'retry_task_not_found' },
  );
});

test('external workspace changes and lateral ideas cannot mutate the active Mission', () => {
  const mission = newMission();
  const objective = mission.objective;
  const lateralIdea = Object.freeze({ objective: 'Crear una misión diferente' });

  assert.throws(() => {
    mission.workspaceId = 'workspace-foreign';
  }, TypeError);
  assert.equal(mission.workspaceId, 'workspace-test-main');
  assert.equal(mission.objective, objective);
  assert.equal(lateralIdea.objective === mission.objective, false);
});

test('minimum domain event types are produced in memory with synthetic scope', () => {
  const seen = new Set();
  const created = createMission(missionInput(), SCOPE, { now: NOW });
  created.events.forEach((event) => seen.add(event.eventType));

  const added = addTask(created.mission, taskInput(created.mission.missionId), SCOPE, { now: NOW });
  added.events.forEach((event) => seen.add(event.eventType));
  const taskReady = transitionTask(added.mission, 'task-main-001', TASK_STATES.READY, SCOPE, { now: NOW });
  taskReady.events.forEach((event) => seen.add(event.eventType));
  const approval = linkApproval(taskReady.mission, 'task-main-001', 'approval-event-001', SCOPE, { now: NOW });
  approval.events.forEach((event) => seen.add(event.eventType));
  const blocked = addBlocker(approval.mission, {
    blockerId: 'blocker-event-001',
    reasonCode: 'synthetic-block',
  }, SCOPE, { now: NOW });
  blocked.events.forEach((event) => seen.add(event.eventType));
  const unblocked = resolveBlocker(blocked.mission, 'blocker-event-001', SCOPE, { now: LATER });
  unblocked.events.forEach((event) => seen.add(event.eventType));
  const evidenced = recordEvidence(unblocked.mission, 'evidence-event-001', SCOPE, {
    now: LATER,
    criterionIds: ['mission-criterion-1'],
  });
  evidenced.events.forEach((event) => seen.add(event.eventType));
  const cancelled = transitionMission(evidenced.mission, MISSION_STATES.CANCELLED, SCOPE, { now: LATER });
  cancelled.events.forEach((event) => seen.add(event.eventType));

  const completed = transitionMission(reviewReadyMission(), MISSION_STATES.COMPLETED, SCOPE, { now: LATER });
  completed.events.forEach((event) => seen.add(event.eventType));

  Object.values(DOMAIN_EVENT_TYPES).forEach((eventType) => {
    assert.equal(seen.has(eventType), true, eventType);
  });
});
