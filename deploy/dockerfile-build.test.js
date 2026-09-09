'use strict';

// 5C.7B.6B.3D/6B.3E — Verificacion real de build para el Dockerfile
// multi-stage, incluida la invocacion explicita del runner de backup
// dentro del target ya construido.
//
// A diferencia de `dockerfile.test.js` (estatico, siempre corre), este
// archivo construye de verdad ambas imagenes locales (`--target runtime`
// y `--target backup`) y las inspecciona. Se omite por completo
// (`t.skip`) si Docker no esta instalado o el daemon no esta arrancado —
// mismo patron que la prueba de toolchain local en
// `backend/services/backup/pg-dump-wrapper.test.js`.
//
// Este archivo NUNCA conecta con Neon, NUNCA ejecuta pg_dump contra datos
// reales y NUNCA hace `docker push`. Las imagenes se etiquetan con un
// sufijo unico por ejecucion y se eliminan (`docker rmi`) al terminar,
// para no dejar residuos locales mas alla de la cache de capas de Docker.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const runSuffix = `6b3d-test-${process.pid}-${Date.now()}`;
const apiTag = `oxkio-api:${runSuffix}`;
const backupTag = `oxkio-backup:${runSuffix}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  return result;
}

function dockerAvailable() {
  const result = run('docker', ['info']);
  return result.status === 0;
}

let builtImages = [];

test('build (skipped without Docker): runtime y backup se construyen y se inspeccionan', async (t) => {
  if (!dockerAvailable()) {
    t.skip('Docker no disponible (no instalado o daemon apagado) en esta maquina.');
    return;
  }

  await t.test('build --target runtime', () => {
    const build = run('docker', ['build', '--target', 'runtime', '-t', apiTag, repositoryRoot], {
      timeout: 300000,
    });
    assert.equal(build.status, 0, build.stderr);
    builtImages.push(apiTag);
  });

  await t.test('build --target backup', () => {
    const build = run('docker', ['build', '--target', 'backup', '-t', backupTag, repositoryRoot], {
      timeout: 300000,
    });
    assert.equal(build.status, 0, build.stderr);
    builtImages.push(backupTag);
  });

  await t.test('runtime: pg_dump/pg_restore/psql ausentes (separacion de superficie)', () => {
    for (const binary of ['pg_dump', 'pg_restore', 'psql']) {
      const check = run('docker', ['run', '--rm', apiTag, 'which', binary]);
      assert.notEqual(check.status, 0, `${binary} no deberia existir en el target HTTP`);
    }
  });

  await t.test('backup: pg_dump/pg_restore/psql presentes en version 18.x', () => {
    for (const binary of ['pg_dump', 'pg_restore', 'psql']) {
      const check = run('docker', ['run', '--rm', backupTag, binary, '--version']);
      assert.equal(check.status, 0, check.stderr);
      assert.match(check.stdout, /\(PostgreSQL\) 18\./);
    }
  });

  await t.test('backup: trust store presente y contiene ISRG Root X1', () => {
    const check = run('docker', [
      'run', '--rm', backupTag, 'node', '-e',
      "const fs=require('fs');const crypto=require('crypto');"
      + "const raw=fs.readFileSync('/etc/ssl/certs/ca-certificates.crt','utf8');"
      + "const blocks=raw.match(/-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----/g)||[];"
      + "let found=false;for(const b of blocks){try{const c=new crypto.X509Certificate(b);"
      + "if(/ISRG Root X1/i.test(c.subject))found=true;}catch(e){}}"
      + "process.stdout.write(found?'FOUND':'MISSING');",
    ]);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stdout, 'FOUND');
  });

  await t.test('backup: no se anadio ningun root.crt/CA propia', () => {
    // Corre como usuario no root: `find /` reporta "Permission denied" en
    // directorios que no puede leer (p. ej. /root) y sale con status != 0
    // aunque SI haya podido listar el resto del arbol correctamente — por
    // eso aqui se valida el contenido de stdout, no el exit code.
    const check = run('docker', ['run', '--rm', backupTag, 'find', '/', '-xdev', '-iname', '*.crt']);
    const files = check.stdout.split(/\r?\n/).filter(Boolean);
    assert.deepEqual(files, ['/etc/ssl/certs/ca-certificates.crt']);
  });

  await t.test('backup: no corre como root por defecto', () => {
    const check = run('docker', ['run', '--rm', backupTag, 'whoami']);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stdout.trim(), 'node');
  });

  await t.test('ambas imagenes no exponen secretos en variables de entorno', () => {
    for (const tag of [apiTag, backupTag]) {
      const inspect = run('docker', ['image', 'inspect', tag, '--format', '{{json .Config.Env}}']);
      assert.equal(inspect.status, 0, inspect.stderr);
      assert.doesNotMatch(inspect.stdout, /postgres(ql)?:\/\//i);
      assert.doesNotMatch(inspect.stdout, /PASSWORD/i);
    }
  });

  // 5C.7B.6B.3E: el runner llega al target backup solo porque ya vive
  // bajo backend/ (copiado por la etapa "app" compartida) — no hizo
  // falta ningun cambio de Dockerfile. Invocacion explicita, sin CMD
  // automatico: sin providers reales inyectados (ninguno existe todavia
  // en este repositorio), debe fallar cerrado con exit code != 0 y sin
  // conectar a ningun sitio.
  await t.test('backup: el runner explicito falla cerrado sin providers reales (validate-only)', () => {
    const which = run('docker', ['run', '--rm', backupTag, 'which', 'pg_dump']);
    assert.equal(which.status, 0, which.stderr);
    const pgDumpPath = which.stdout.trim();

    const invocation = run('docker', [
      'run', '--rm', backupTag,
      'node', 'backend/services/backup/backup-runner.js',
      '--validate-only',
      '--execution-id=exec-6b3e-container-check',
      '--output-dir=/tmp',
      `--pg-dump-path=${pgDumpPath}`,
    ]);
    assert.notEqual(invocation.status, 0);
    const parsed = JSON.parse(invocation.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.failure.code, 'runner_secret_provider_missing');
    assert.doesNotMatch(invocation.stdout, /postgres(ql)?:\/\//i);
    assert.doesNotMatch(invocation.stdout, /PASSWORD/i);
  });

  await t.test('backup: el runner no se ejecuta automaticamente (sin CMD de backup)', () => {
    const inspect = run('docker', ['image', 'inspect', backupTag, '--format', '{{json .Config.Cmd}} {{json .Config.Entrypoint}}']);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.doesNotMatch(inspect.stdout, /backup-runner/);
    assert.doesNotMatch(inspect.stdout, /--execute/);
  });
});

test.after(() => {
  for (const tag of builtImages) {
    run('docker', ['rmi', '-f', tag]);
  }
});
