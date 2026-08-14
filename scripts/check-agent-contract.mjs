#!/usr/bin/env node
/**
 * Сторож единого контракта агентов — `tools-skills-agents.md` §3.
 *
 * ПОЧЕМУ ЭТО СКРИПТ, А НЕ ПУНКТ В ИНСТРУКЦИИ. Контракт обещает: «`.claude/skills`,
 * `.gemini/skills`, `.qwen/skills`, `.opencode/skills`, `.antigravity/skills` и
 * `.zcode/skills` — симлинки на `.agents/skills`; добавь скилл один раз, получат
 * все». 11 августа 2026 в соседнем репозитории обнаружилось три симлинка из шести:
 * OpenCode, Antigravity и ZCode месяцами работали без единого проектного скилла
 * и никто этого не замечал — расхождение молчаливое, агент не жалуется на
 * скилл, о существовании которого не знает.
 *
 * ПОЧЕМУ НЕ ПРОГОН JEST. Каталоги харнессов и entry-файлы вне репозитория
 * (`.gitignore`), поэтому в CI их нет. Сторож живёт в `scripts/` (каталог
 * отслеживается) и молча выходит с нулём, когда рядом нет `.agents/skills`: в CI
 * ему проверять нечего, а падать на этом значило бы валить каждую сборку.
 *
 * Запуск:  node scripts/check-agent-contract.mjs
 *          node scripts/check-agent-contract.mjs --fix   (создаёт недостающие симлинки)
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const CANON = path.join(ROOT, ".agents/skills");
const FIX = process.argv.includes("--fix");

if (!existsSync(CANON)) {
  console.log("check-agent-contract: .agents/skills рядом нет (каталог вне репозитория) — пропускаем");
  process.exit(0);
}

/** Каталог харнесса → entry-файл, который этот рантайм читает в корне. */
const RUNTIMES = [
  { dir: ".claude", entry: "CLAUDE.md" },
  { dir: ".gemini", entry: "GEMINI.md" },
  { dir: ".qwen", entry: "QWEN.md" },
  { dir: ".opencode", entry: null }, // читает AGENTS.md нативно
  { dir: ".antigravity", entry: null }, // legacy skill path; current Antigravity reads .agents/* natively
  { dir: ".zcode", entry: "ZCODE.md" },
];

const problems = [];
const fixed = [];

if (!existsSync(path.join(ROOT, "AGENTS.md"))) {
  problems.push("нет AGENTS.md в корне — единственная точка входа контракта");
}

for (const { dir, entry } of RUNTIMES) {
  const link = path.join(ROOT, dir, "skills");
  const rel = `${dir}/skills`;

  if (!existsSync(path.join(ROOT, dir))) {
    if (FIX) {
      mkdirSync(path.join(ROOT, dir), { recursive: true });
    } else {
      problems.push(`нет каталога ${dir}/ — рантайм не подхватит ни контракт, ни скиллы`);
      continue;
    }
  }

  let stat = null;
  try {
    stat = lstatSync(link);
  } catch {
    /* нет вовсе */
  }

  if (!stat) {
    if (FIX) {
      symlinkSync("../.agents/skills", link);
      fixed.push(`создан ${rel} -> ../.agents/skills`);
    } else {
      problems.push(`нет ${rel} — этот рантайм работает без проектных скиллов`);
    }
  } else if (!stat.isSymbolicLink()) {
    // Настоящий каталог вместо симлинка — худший случай: скиллы разъезжаются
    // молча, две копии живут своей жизнью, и никто не знает, какая свежее.
    problems.push(`${rel} — настоящий каталог, а не симлинк на ../.agents/skills (копии разъедутся)`);
  } else {
    const target = readlinkSync(link);
    if (target !== "../.agents/skills") {
      problems.push(`${rel} указывает на ${target}, ожидалось ../.agents/skills`);
    } else if (!existsSync(link)) {
      problems.push(`${rel} — битый симлинк`);
    }
  }

  if (entry && !existsSync(path.join(ROOT, entry))) {
    problems.push(`нет ${entry} в корне — ${dir} не найдёт редирект на AGENTS.md`);
  }
}

const agRule = path.join(ROOT, ".agents/rules/00-agents-contract.md");
if (!existsSync(agRule)) {
  problems.push(".agents/rules/00-agents-contract.md отсутствует — current Antigravity не загрузит контракт автоматически");
}

const deliverySkill = path.join(ROOT, ".agents/skills/openqareer-delivery/SKILL.md");
if (!existsSync(deliverySkill)) {
  problems.push("нет openqareer-delivery skill — Antigravity может остановиться после кода или unit-тестов");
}

const legacyAgRule = path.join(ROOT, ".antigravity/rules/00-agents-contract.md");
if (!existsSync(legacyAgRule)) {
  problems.push("нет legacy .antigravity rule — старые Antigravity IDE не увидят редирект");
}

const legacyMcp = path.join(ROOT, ".mcp.json");
const antigravityMcp = path.join(ROOT, ".agents/mcp_config.json");
if (!existsSync(antigravityMcp)) {
  problems.push("нет .agents/mcp_config.json — Antigravity не увидит workspace MCP servers");
} else if (existsSync(legacyMcp)) {
  try {
    const legacyServers = Object.keys(
      JSON.parse(readFileSync(legacyMcp, "utf8")).mcpServers ?? {},
    ).sort();
    const antigravityServers = Object.keys(
      JSON.parse(readFileSync(antigravityMcp, "utf8")).mcpServers ?? {},
    ).sort();
    if (JSON.stringify(legacyServers) !== JSON.stringify(antigravityServers)) {
      problems.push(
        `.agents/mcp_config.json расходится с .mcp.json: ${antigravityServers.join(", ")} вместо ${legacyServers.join(", ")}`,
      );
    }
  } catch (error) {
    problems.push(`не удалось прочитать MCP config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const skillCount = readdirSync(CANON).filter((n) => !n.startsWith(".") && n !== "README.md").length;

for (const line of fixed) console.log(`check-agent-contract: ${line}`);

if (problems.length > 0) {
  console.error(`check-agent-contract: расхождений — ${problems.length}`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error("Починить симлинки: node scripts/check-agent-contract.mjs --fix");
  process.exit(1);
}

console.log(`check-agent-contract: ок — 6 рантаймов видят одни и те же ${skillCount} скиллов`);
