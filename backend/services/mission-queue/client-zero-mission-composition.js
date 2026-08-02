'use strict';

const {
  createClientZeroBootstrapProvider,
  createMembershipResolver,
} = require('../../security/membership-resolver');
const { createMissionIntake } = require('./mission-intake');
const { MissionService } = require('./mission-service');

function createClientZeroMissionComposition({
  bootstrapConfig = {},
  missionRepository,
} = {}) {
  const bootstrapProvider = createClientZeroBootstrapProvider(bootstrapConfig);
  const membershipResolver = createMembershipResolver({ provider: bootstrapProvider });
  const missionService = new MissionService({ repository: missionRepository });
  const missionIntake = createMissionIntake({ membershipResolver, missionService });

  return Object.freeze({
    createMissionFromConfirmedPlan: missionIntake.createMissionFromConfirmedPlan,
  });
}

module.exports = {
  createClientZeroMissionComposition,
};
