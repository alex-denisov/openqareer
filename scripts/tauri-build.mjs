#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
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

const result = spawnSync('npx', ['tauri', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OPENQAREER_COMMIT_SHA: sha },
});
process.exit(result.status ?? 1);
