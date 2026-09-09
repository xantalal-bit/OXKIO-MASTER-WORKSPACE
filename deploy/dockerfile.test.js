'use strict';

// 5C.7B.6B.3D — Contrato estatico del Dockerfile multi-stage.
//
// Estos tests leen el texto del Dockerfile: no requieren Docker, no
// construyen ninguna imagen y no ejecutan ningun contenedor. Verifican
// unicamente que el contrato de separacion HTTP/backup declarado en el
// canon se mantiene en el archivo fuente. La verificacion con Docker real
// (build + inspeccion de las imagenes) vive en `dockerfile-build.test.js`,
// que se omite automaticamente si Docker no esta disponible.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const dockerfilePath = path.join(repositoryRoot, 'Dockerfile');
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

// Extrae el bloque de texto de una etapa (`FROM ... AS <name>` hasta la
// siguiente directiva `FROM` o el final del archivo), para poder afirmar
// propiedades por-etapa en vez de sobre el archivo completo.
function stageBlock(name) {
  const marker = new RegExp(`^FROM .*\\bAS ${name}\\b.*$`, 'm');
  const match = marker.exec(dockerfile);
  assert.ok(match, `stage "${name}" not found in Dockerfile`);
  const start = match.index;
  const rest = dockerfile.slice(start + match[0].length);
  const nextFrom = /^FROM /m.exec(rest);
  const end = nextFrom ? start + match[0].length + nextFrom.index : dockerfile.length;
  return dockerfile.slice(start, end);
}

test('la base pinneada es node:22-alpine3.24, no el tag flotante node:22-alpine', () => {
  assert.match(dockerfile, /^FROM node:22-alpine3\.24 AS dependencies$/m);
  assert.match(dockerfile, /^FROM node:22-alpine3\.24 AS app$/m);
  // El tag flotante sin rama no debe quedar en ningun FROM.
  const fromLines = dockerfile.match(/^FROM .*$/gm) || [];
  for (const line of fromLines) {
    assert.doesNotMatch(line, /FROM node:22-alpine(?!3\.24)\b/);
  }
});

test('no hay digest SHA fijo perpetuo en el Dockerfile todavia', () => {
  // PRE-6B.3D/6B.3D: se pinnea por rama Alpine, no por digest — el digest
  // se registra como evidencia de build en el canon, no en el Dockerfile.
  assert.doesNotMatch(dockerfile, /node:22-alpine3\.24@sha256:/);
});

test('el target HTTP (runtime) no instala postgresql18-client', () => {
  const runtime = stageBlock('runtime');
  assert.doesNotMatch(runtime, /postgresql18-client/);
  assert.doesNotMatch(runtime, /apk add/);
  assert.match(runtime, /CMD \["node", "backend\/api\/server\.js"\]/);
});

test('el target backup instala postgresql18-client sin fijar version exacta', () => {
  const backup = stageBlock('backup');
  assert.match(backup, /RUN apk add --no-cache postgresql18-client\s*$/m);
  // Version deliberadamente sin fijar (permite parches dentro de Alpine 3.24).
  assert.doesNotMatch(backup, /postgresql18-client=/);
});

test('el target backup deriva de la misma etapa compartida que runtime (sin duplicar COPY)', () => {
  assert.match(dockerfile, /^FROM app AS backup$/m);
  assert.match(dockerfile, /^FROM app AS runtime$/m);
  const backup = stageBlock('backup');
  const runtime = stageBlock('runtime');
  // Ninguno de los dos targets repite las COPY/RUN de construccion de la
  // aplicacion: esas viven solo en la etapa "app" compartida.
  assert.doesNotMatch(backup, /COPY --chown=node:node backend/);
  assert.doesNotMatch(runtime, /COPY --chown=node:node backend/);
});

test('el target backup no corre como root por defecto', () => {
  const backup = stageBlock('backup');
  const userDirectives = backup.match(/^USER .*/gm) || [];
  assert.ok(userDirectives.length > 0, 'backup stage must declare USER');
  assert.equal(userDirectives[userDirectives.length - 1], 'USER node');
});

test('no se anade ningun certificado propio (root.crt/CA empaquetada)', () => {
  assert.doesNotMatch(dockerfile, /root\.crt/i);
  assert.doesNotMatch(dockerfile, /\.pem['"]?\s*$/im);
  assert.doesNotMatch(dockerfile, /COPY .*\.crt/i);
  assert.doesNotMatch(dockerfile, /PGSSLROOTCERT/);
});

test('no hay secretos, connectionString ni credenciales en el Dockerfile', () => {
  assert.doesNotMatch(dockerfile, /postgres(ql)?:\/\//i);
  assert.doesNotMatch(dockerfile, /PGPASSWORD\s*=/);
  assert.doesNotMatch(dockerfile, /password\s*=/i);
  assert.doesNotMatch(dockerfile, /secret\s*=/i);
  assert.doesNotMatch(dockerfile, /token\s*=/i);
  assert.doesNotMatch(dockerfile, /connectionString/i);
  assert.doesNotMatch(dockerfile, /runtimeUrl/i);
});

test('no se anadio ningun comando de push a registry ni de deploy', () => {
  assert.doesNotMatch(dockerfile, /docker push/i);
  assert.doesNotMatch(dockerfile, /gcloud (run deploy|builds submit)/i);
  assert.doesNotMatch(dockerfile, /docker\.pkg\.dev/i);
});

test('ambos targets terminados en usuario no root heredan de la misma etapa "app"', () => {
  assert.match(dockerfile, /^FROM node:22-alpine3\.24 AS app$/m);
  const runtimeFrom = /^FROM app AS runtime$/m.test(dockerfile);
  const backupFrom = /^FROM app AS backup$/m.test(dockerfile);
  assert.ok(runtimeFrom, 'runtime debe derivar de app');
  assert.ok(backupFrom, 'backup debe derivar de app');
});
