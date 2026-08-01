'use strict';

const { randomUUID } = require('node:crypto');

const {
  MISSION_STATES,
  TASK_STATES,
  cloneDomain,
  createMission: createDomainMission,
  freezeDomain,
  validateIdentifier,
  validateMission,
} = require('./mission-contract');
const {
  MISSION_TRANSITIONS,
  addBlocker: addDomainBlocker,
  addTask: addDomainTask,
  transitionMission: transitionDomainMission,
  transitionTask: transitionDomainTask,
} = require('./mission-state-machine');
const {
  assertMissionRepository,
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeMissionFilters,
  normalizeRepositoryScope,
} = require('./mission-repository-contract');

const REQUIRED_TASK_CANCELLED = 'required_task_cancelled';
const REQUIRED_TASK_CANCELLED_NEXT_ACTION = 'Review cancelled required task and replan mission';

class MissionServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MissionServiceError';
    this.code = code;
  }
}

function serviceFail(code, message) {
  throw new MissionServiceError(code, message);
}

function normalizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    serviceFail('invalid_mission_service_options', 'MissionService options must be an object.');
  }
  return options;
}

function domainOptionsFrom(options) {
  const {
    blockerIdFactory,
    expectedVersion,
    idempotencyKey,
    ...domainOptions
  } = options;
  return domainOptions;
}

function validateRepositoryMission(mission, scope) {
  if (!mission) serviceFail('mission_not_found', 'Mission was not found.');
  validateMission(mission);
  if (mission.requester !== scope.userId || mission.clientId !== scope.clientId) {
    serviceFail('mission_not_found', 'Mission was not found.');
  }
  return mission;
}

function freezeMissionResult(mission, events, extra = {}) {
  return freezeDomain({
    mission: cloneDomain(mission),
    events: cloneDomain(events),
    ...extra,
  });
}

function activeRequiredTaskCancellation(mission) {
  return mission.blockers.some((blocker) => blocker.status === 'active'
    && (blocker.type === REQUIRED_TASK_CANCELLED
      || blocker.reasonCode === REQUIRED_TASK_CANCELLED));
}

function createCancellationBlockerId(options, mission, taskId) {
  const candidate = typeof options.blockerIdFactory === 'function'
    ? options.blockerIdFactory({ missionId: mission.missionId, taskId })
    : randomUUID();
  return validateIdentifier(candidate, 'blockerId');
}

class MissionService {
  constructor({ repository } = {}) {
    this.repository = assertMissionRepository(repository);
    Object.freeze(this);
  }

  async createMission(scope, payload, rawOptions = {}) {
    const normalizedScope = normalizeRepositoryScope(scope);
    const options = normalizeOptions(rawOptions);
    const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
    const created = createDomainMission(payload, normalizedScope, domainOptionsFrom(options));
    const repositoryResult = await this.repository.create(
      normalizedScope,
      created.mission,
      idempotencyKey,
    );
    if (!repositoryResult || typeof repositoryResult.created !== 'boolean') {
      serviceFail('invalid_repository_result', 'MissionRepository.create returned an invalid result.');
    }
    const mission = validateRepositoryMission(repositoryResult.mission, normalizedScope);
    return freezeMissionResult(
      mission,
      repositoryResult.created ? created.events : [],
      { created: repositoryResult.created },
    );
  }

  async getMission(scope, missionId) {
    const normalizedScope = normalizeRepositoryScope(scope);
    const normalizedMissionId = validateIdentifier(missionId, 'missionId');
    const mission = await this.repository.get(normalizedScope, normalizedMissionId);
    return freezeDomain(cloneDomain(validateRepositoryMission(mission, normalizedScope)));
  }

  async listMissions(scope, filters = {}) {
    const normalizedScope = normalizeRepositoryScope(scope);
    const normalizedFilters = normalizeMissionFilters(filters);
    const missions = await this.repository.list(normalizedScope, normalizedFilters);
    if (!Array.isArray(missions)) {
      serviceFail('invalid_repository_result', 'MissionRepository.list must return an array.');
    }
    missions.forEach((mission) => validateRepositoryMission(mission, normalizedScope));
    return freezeDomain(cloneDomain(missions));
  }

  async #applyMutation(scope, missionId, rawOptions, mutator) {
    const normalizedScope = normalizeRepositoryScope(scope);
    const normalizedMissionId = validateIdentifier(missionId, 'missionId');
    const options = normalizeOptions(rawOptions);
    const expectedVersion = normalizeExpectedVersion(options.expectedVersion);
    const mission = validateRepositoryMission(
      await this.repository.get(normalizedScope, normalizedMissionId),
      normalizedScope,
    );
    if (mission.version !== expectedVersion) {
      serviceFail('version_conflict', 'Mission version does not match expectedVersion.');
    }

    const outcome = mutator(mission, normalizedScope, options);
    if (!outcome || !outcome.mission || !Array.isArray(outcome.events)) {
      serviceFail('invalid_domain_result', 'Mission domain mutation returned an invalid result.');
    }
    const saved = await this.repository.saveIfVersion(
      normalizedScope,
      outcome.mission,
      expectedVersion,
    );
    return freezeMissionResult(
      validateRepositoryMission(saved, normalizedScope),
      outcome.events,
    );
  }

  async addTask(scope, missionId, taskPayload, options = {}) {
    return this.#applyMutation(scope, missionId, options, (mission, normalizedScope, serviceOptions) => {
      if (!taskPayload || typeof taskPayload !== 'object' || Array.isArray(taskPayload)) {
        serviceFail('invalid_task', 'Task payload is required.');
      }
      if (taskPayload.missionId && taskPayload.missionId !== missionId) {
        serviceFail('task_mission_mismatch', 'Task missionId does not match its mission.');
      }
      return addDomainTask(
        mission,
        { ...taskPayload, missionId },
        normalizedScope,
        domainOptionsFrom(serviceOptions),
      );
    });
  }

  async transitionMission(scope, missionId, nextStatus, options = {}) {
    return this.#applyMutation(scope, missionId, options, (mission, normalizedScope, serviceOptions) => {
      if (nextStatus === MISSION_STATES.READY && activeRequiredTaskCancellation(mission)) {
        serviceFail(
          'required_task_cancelled_blocker_active',
          'Mission cannot become READY while a required Task cancellation blocker is active.',
        );
      }
      return transitionDomainMission(
        mission,
        nextStatus,
        normalizedScope,
        domainOptionsFrom(serviceOptions),
      );
    });
  }

  async transitionTask(scope, missionId, taskId, nextStatus, options = {}) {
    return this.#applyMutation(scope, missionId, options, (mission, normalizedScope, serviceOptions) => {
      const domainOptions = domainOptionsFrom(serviceOptions);
      const taskOutcome = transitionDomainTask(
        mission,
        taskId,
        nextStatus,
        normalizedScope,
        domainOptions,
      );
      if (nextStatus !== TASK_STATES.CANCELLED) return taskOutcome;

      const blockerOutcome = addDomainBlocker(taskOutcome.mission, {
        blockerId: createCancellationBlockerId(serviceOptions, taskOutcome.mission, taskId),
        taskId,
        type: REQUIRED_TASK_CANCELLED,
        reasonCode: REQUIRED_TASK_CANCELLED,
      }, normalizedScope, {
        now: domainOptions.now,
        idFactory: domainOptions.idFactory,
        nextAction: REQUIRED_TASK_CANCELLED_NEXT_ACTION,
      });
      const events = [...taskOutcome.events, ...blockerOutcome.events];
      const blockedAllowed = MISSION_TRANSITIONS[blockerOutcome.mission.status]
        .includes(MISSION_STATES.BLOCKED);
      if (!blockedAllowed) {
        return freezeDomain({ mission: blockerOutcome.mission, events });
      }

      const blockedOutcome = transitionDomainMission(
        blockerOutcome.mission,
        MISSION_STATES.BLOCKED,
        normalizedScope,
        {
          now: domainOptions.now,
          idFactory: domainOptions.idFactory,
          nextAction: REQUIRED_TASK_CANCELLED_NEXT_ACTION,
        },
      );
      return freezeDomain({
        mission: blockedOutcome.mission,
        events: [...events, ...blockedOutcome.events],
      });
    });
  }
}

module.exports = {
  REQUIRED_TASK_CANCELLED,
  REQUIRED_TASK_CANCELLED_NEXT_ACTION,
  MissionService,
  MissionServiceError,
};
