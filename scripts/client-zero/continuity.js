#!/usr/bin/env node
// OXKIO CLIENTE CERO — punto de entrada del registro de continuidad (Issue #49).
//
// Antes de planificar, cualquier misión (Xatai, Claude, Codex) ejecuta:
//   node scripts/client-zero/continuity.js preflight --mission "<texto>" [--work-on <tema>]... [--action <accion>]...
// Salida 3 = REFUSE_REOPEN: el frente está CLOSED y no hay evidencia material nueva.
//
// Otros comandos:
//   ask <tema>                       qué sabe OXKIO y cuál es el estado canónico
//   observe [--branch b]... [--limit n] [--record]   automatización: CI de GitHub → evidencia
//   audit [--record]                 contrasta los CLOSED con los hechos de las PR en GitHub
//   apply <ops.json>                 upsert / transition / close / event (con evidencia)
//   daily [--date AAAA-MM-DD] [--since ISO] [--write]   Parte Diario desde el registro
//
// GitHub se lee con `gh` (solo lectura, la sesión que ya tenga el operador).
// Nada aquí hace push, merge, deploy ni toca secretos.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const continuity = require("../../backend/projects/continuity-registry");

const ROOT = path.join(__dirname, "../..");
const DAILY_DIR = path.join(ROOT, "orchestration", "PARTE-DIARIO");

function parse(argv) {
  const options = { _: [], workOn: [], action: [], branch: [], scope: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { options._.push(arg); continue; }
    const key = arg.slice(2);
    if (key === "record" || key === "write" || key === "json") { options[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw Object.assign(new Error(`missing value for ${arg}`), { code: "argument_missing" });
    if (key === "work-on") options.workOn.push(value);
    else if (key === "action") options.action.push(value);
    else if (key === "branch") options.branch.push(value);
    else if (key === "scope") {
      const [name, raw] = value.split("=");
      options.scope[name] = /^\d+$/.test(raw) ? Number(raw) : raw;
    } else options[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return options;
}

function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function print(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""));
}

function answer(result) {
  if (!result.known) {
    return [
      "OXKIO no tiene registro de este tema.",
      "No se finge memoria: recuperar la mejor evidencia disponible, registrar el gap de continuidad y continuar sin inventar.",
    ].join("\n");
  }
  const lines = [`Estado canónico (registro de continuidad, revisión ${result.registryRevision}; canon ${result.canon.sha256.slice(0, 12)}):`];
  result.fronts.forEach((front) => {
    lines.push("", `${front.id} — ${front.title}`);
    lines.push(`  Estado: ${front.state} [${front.priority}] · confianza ${front.confidence} · actualizado ${front.updatedAt}`);
    if (front.blockedBy) lines.push(`  Bloqueado por: ${front.blockedBy}`);
    lines.push(`  Decisión: ${front.decision}`);
    lines.push(`  Evidencia: ${front.evidence.map((item) => `${item.ref} (${item.kind}/${item.result})`).join("; ")}`);
    lines.push(`  Reapertura solo si: ${front.reopenCondition}`);
    lines.push(`  Siguiente acción: ${front.nextAction}`);
  });
  return lines.join("\n");
}

function observe(registry, options) {
  const branches = options.branch.length ? options.branch : ["main"];
  const limit = String(Number(options.limit) || 3);
  const runs = [];
  branches.forEach((branch) => {
    gh(["run", "list", "--branch", branch, "--limit", limit, "--json", "databaseId,headSha,event,headBranch,updatedAt,status"])
      .filter((run) => run.status === "completed")
      .forEach((run) => {
        const { jobs } = gh(["run", "view", String(run.databaseId), "--json", "jobs"]);
        runs.push({ id: run.databaseId, branch: run.headBranch, event: run.event, sha: run.headSha, updatedAt: run.updatedAt, jobs });
      });
  });
  return { runs, observations: continuity.observationsFromRuns(registry, runs) };
}

function prFacts(registry) {
  const numbers = new Set();
  registry.entries.filter((entry) => entry.state === "CLOSED").forEach((entry) => entry.evidence.forEach((item) => {
    const match = item.kind === "pr_merged" && item.ref.match(/^pr:(\d+)$/);
    if (match) numbers.add(match[1]);
  }));
  const facts = {};
  numbers.forEach((number) => {
    const pr = gh(["pr", "view", number, "--json", "state,mergeCommit"]);
    facts[number] = { state: pr.state, mergeCommit: pr.mergeCommit && pr.mergeCommit.oid };
  });
  return facts;
}

function applyOps(registry, ops, now) {
  return ops.reduce((current, op) => {
    if (op.op === "upsert") return continuity.upsert({ registry: current, entry: op.entry, now }).registry;
    if (op.op === "transition") return continuity.transition({ registry: current, ...op, now });
    if (op.op === "close") return continuity.close({ registry: current, ...op, now });
    if (op.op === "observe") return continuity.reconcile({ registry: current, observations: op.observations, now }).registry;
    if (op.op === "event") return continuity.recordEvent({ registry: current, event: op.event, now });
    throw Object.assign(new Error(`unknown op ${op.op}`), { code: "op_invalid" });
  }, registry);
}

function main(argv) {
  const options = parse(argv);
  const command = options._.shift();
  const now = new Date().toISOString();
  const registry = continuity.loadRegistry();

  if (command === "ask") {
    const topic = options._.join(" ");
    const result = continuity.preflight({ registry, canon: continuity.loadCanon(), mission: topic, now });
    print(options.json ? result : answer(result));
    return 0;
  }

  if (command === "preflight") {
    const mission = options.missionFile ? fs.readFileSync(path.resolve(options.missionFile), "utf8") : options.mission || "";
    const evidence = options.evidenceFile ? readJson(options.evidenceFile) : [];
    const result = continuity.preflight({
      registry, canon: continuity.loadCanon(), mission, workOn: options.workOn, evidence,
      actions: options.action, context: options.scope, now,
    });
    if (options.record) {
      let next = continuity.recordEvent({ registry, event: result.event, now });
      result.refusals.forEach((refusal) => {
        next = continuity.recordEvent({ registry: next, event: { type: "reopen_refused", at: now, entry: refusal.id, note: refusal.reason } });
      });
      continuity.saveRegistry(next);
    }
    print(result);
    return result.verdict === "REFUSE_REOPEN" ? 3 : 0;
  }

  if (command === "observe") {
    const { runs, observations } = observe(registry, options);
    const { registry: next, changes } = continuity.reconcile({ registry, observations, now });
    if (options.record) {
      const summary = changes.reduce((acc, change) => ({ ...acc, [change.type]: (acc[change.type] || 0) + 1 }), {});
      continuity.saveRegistry(continuity.recordEvent({ registry: next, now, event: {
        type: "automation_run", at: now, name: "observe-github-ci", result: "ok",
        note: `${runs.length} runs, ${observations.length} observaciones: ${JSON.stringify(summary)}`,
      } }));
    }
    print({ runs: runs.map((run) => ({ id: run.id, branch: run.branch, sha: run.sha.slice(0, 7) })), changes, recorded: Boolean(options.record) });
    return 0;
  }

  if (command === "audit") {
    const findings = continuity.auditClosures(registry, prFacts(registry));
    const result = findings.some((f) => f.status === "contradicted") ? "contradicted" : findings.every((f) => f.status === "verified") ? "verified" : "partial";
    if (options.record) {
      continuity.saveRegistry(continuity.recordEvent({ registry, now, event: {
        type: "automation_run", at: now, name: "audit-closures-github", result,
        note: `${findings.filter((f) => f.status === "verified").length}/${findings.length} cierres verificados contra GitHub`,
      } }));
    }
    print({ result, findings, recorded: Boolean(options.record) });
    return result === "contradicted" ? 4 : 0;
  }

  if (command === "apply") {
    const ops = readJson(options._[0]);
    const next = continuity.saveRegistry(applyOps(registry, Array.isArray(ops) ? ops : [ops], now));
    print({ revision: next.revision, updatedAt: next.updatedAt });
    return 0;
  }

  if (command === "daily") {
    const date = options.date || now.slice(0, 10);
    const report = continuity.buildDailyReport({ registry, date, since: options.since, now });
    if (options.write) {
      fs.mkdirSync(DAILY_DIR, { recursive: true });
      fs.writeFileSync(path.join(DAILY_DIR, `${date}.md`), report.markdown, "utf8");
      continuity.saveRegistry(continuity.recordEvent({ registry, now, event: {
        type: "daily_report", at: now, name: `orchestration/PARTE-DIARIO/${date}.md`, result: "ok",
      } }));
    }
    print(options.json ? report.summary : report.markdown);
    return 0;
  }

  print("Uso: continuity.js <ask|preflight|observe|audit|apply|daily> ... (ver cabecera)");
  return 2;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`continuity: ${error.code || "error"} ${error.details || error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { main, parse };
