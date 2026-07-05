'use strict';

const CLIENTE_CERO_IDENTITY = Object.freeze({
  clientId: 'cliente-cero',
  userId: 'usuario-cliente-cero',
  expectedClientId: 'cliente-cero',
  authorization: Object.freeze({
    status: 'granted',
    provider: 'google-oauth',
  }),
});

function getClienteCeroIdentity() {
  return {
    clientId: CLIENTE_CERO_IDENTITY.clientId,
    userId: CLIENTE_CERO_IDENTITY.userId,
    expectedClientId: CLIENTE_CERO_IDENTITY.expectedClientId,
    authorization: {
      status: CLIENTE_CERO_IDENTITY.authorization.status,
      provider: CLIENTE_CERO_IDENTITY.authorization.provider,
    },
  };
}

module.exports = {
  getClienteCeroIdentity,
};
