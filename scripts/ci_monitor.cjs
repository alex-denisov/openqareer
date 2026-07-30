#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HELP = `OpenQareer GitHub Actions monitor

Usage:
  node scripts/ci_monitor.cjs --help
  node scripts/ci_monitor.cjs runs [--branch <name>]
  node scripts/ci_monitor.cjs watch <run-id>
  node scripts/ci_monitor.cjs log-failed <run-id>
  node scripts/ci_monitor.cjs check-actions [workflow-file]
  node scripts/ci_monitor.cjs secrets
  node scripts/ci_monitor.cjs variables
  node scripts/ci_monitor.cjs deploy-keys
  node scripts/ci_monitor.cjs whoami
  node scripts/ci_monitor.cjs delete-deploy-key <exact-title>
  node scripts/ci_monitor.cjs set-secret <NAME> --body-file <path>
  node scripts/ci_monitor.cjs set-variable <NAME> <value>
`;

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function validateName(value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value ?? "")) fail("invalid Actions name");
  return value;
}

function validateRunId(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) fail("invalid run id");
  return value;
}

function gh(args, input) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    env: { ...process.env, GH_PAGER: "cat", NO_COLOR: "1" },
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  });
  if (result.error) fail(`cannot run gh: ${result.error.message}`, 1);
  if (result.status !== 0) fail(`gh exited with ${result.status}`, result.status || 1);
}

function ghCapture(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: { ...process.env, GH_PAGER: "cat", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) fail(`cannot run gh: ${result.error.message}`, 1);
  if (result.status !== 0) fail(`gh exited with ${result.status}`, result.status || 1);
  return result.stdout.trim();
}

function workflowFiles(target) {
  if (target) return [path.resolve(target)];
  const directory = path.resolve(".github/workflows");
  return fs.readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => path.join(directory, name));
}

function checkActions(target) {
  for (const file of workflowFiles(target)) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*uses:\s*([^\s#]+)/);
      if (!match) return;
      const reference = match[1];
      const separator = reference.lastIndexOf("@");
      const ref = separator > 0 ? reference.slice(separator + 1) : "";
      const policy = /^[0-9a-f]{40}$/i.test(ref) ? "sha-pinned" : "not-pinned";
      process.stdout.write(
        `${path.relative(process.cwd(), file)}:${index + 1}\t${reference}\t${policy}\n`,
      );
    });
  }
}

function main(args) {
  const [command, first, second] = args;
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "runs") {
    const ghArgs = [
      "run", "list", "--limit", "20",
      "--json", "databaseId,status,conclusion,workflowName,headSha,url",
    ];
    const branch = option(args, "--branch");
    if (branch) ghArgs.push("--branch", branch);
    gh(ghArgs);
    return;
  }
  if (command === "watch") {
    gh(["run", "watch", validateRunId(first), "--interval", "10", "--exit-status"]);
    return;
  }
  if (command === "log-failed") {
    gh(["run", "view", validateRunId(first), "--log-failed"]);
    return;
  }
  if (command === "check-actions") {
    checkActions(first);
    return;
  }
  if (command === "secrets") {
    gh(["secret", "list", "--json", "name,updatedAt"]);
    return;
  }
  if (command === "variables") {
    gh(["variable", "list", "--json", "name,updatedAt"]);
    return;
  }
  if (command === "deploy-keys") {
    gh([
      "api", "repos/alex-denisov/openqareer/keys",
      "--jq", ".[] | {title: .title, read_only: .read_only, verified: .verified}",
    ]);
    return;
  }
  if (command === "whoami") {
    gh(["api", "user", "--jq", ".login"]);
    return;
  }
  if (command === "delete-deploy-key") {
    if (!first) fail("delete-deploy-key requires an exact title");
    const ids = ghCapture([
      "api", "repos/alex-denisov/openqareer/keys",
      "--jq", `.[] | select(.title == ${JSON.stringify(first)}) | .id`,
    ]).split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) {
      fail(`expected exactly one deploy key titled ${JSON.stringify(first)}`);
    }
    gh(["api", "--method", "DELETE", `repos/alex-denisov/openqareer/keys/${ids[0]}`]);
    return;
  }
  if (command === "set-secret") {
    const bodyFile = option(args, "--body-file");
    if (!bodyFile) fail("--body-file is required");
    const body = fs.readFileSync(path.resolve(bodyFile));
    gh(["secret", "set", validateName(first)], body);
    return;
  }
  if (command === "set-variable") {
    if (second === undefined) fail("set-variable requires a value");
    gh(["variable", "set", validateName(first), "--body", second]);
    return;
  }
  fail(`unknown command: ${command}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ci-monitor: ${error.message}\n`);
  process.exitCode = error.exitCode || 1;
}
