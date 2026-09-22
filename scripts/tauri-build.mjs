#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { desktopBuildSha } from './desktopBuildSha.mjs';

/**
 * B159 — сборка десктопа, которая помечает себя коммитом. Без метки
 * установленное приложение не может сравнить себя с продакшеном и молча
 * стареет у пилотного пользователя.
 */
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

const { sha, reason } = desktopBuildSha(
  git(['rev-parse', 'HEAD']),
  git(['status', '--porcelain']),
);

if (reason === 'head') {
  console.log(`desktop build marked as ${sha.slice(0, 7)}`);
} else {
  console.log(
    reason === 'dirty-tree'
      ? 'desktop build stays unmarked: рабочее дерево изменено, метка коммита была бы неправдой'
      : 'desktop build stays unmarked: git не назвал HEAD',
  );
}

const startedAt = Date.now();
const result = spawnSync('npx', ['tauri', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OPENQAREER_COMMIT_SHA: sha },
});
if (result.status !== 0) process.exit(result.status ?? 1);

if (process.platform === 'darwin') {
  const bundleRoot = join(process.cwd(), 'src-tauri', 'target', 'release', 'bundle');
  const macosRoot = join(bundleRoot, 'macos');
  const app = join(macosRoot, 'OpenQareer.app');
  const dmgRoot = join(bundleRoot, 'dmg');
  const diskImages = existsSync(dmgRoot)
    ? readdirSync(dmgRoot).filter((name) => name.endsWith('.dmg'))
    : [];
  const newestDmg = diskImages
    .map((name) => ({ name, modified: statSync(join(dmgRoot, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified)[0];
  if (!existsSync(app) || !newestDmg || newestDmg.modified < startedAt - 2_000) {
    throw new Error('Fresh OpenQareer.app and .dmg must both exist after the macOS build');
  }
  const destination = join(macosRoot, newestDmg.name);
  copyFileSync(join(dmgRoot, newestDmg.name), destination);
  console.log(`kept release artifacts: ${app} and ${destination}`);
}
