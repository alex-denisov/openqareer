#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
const result = spawnSync('npx', ['tauri', 'build', ...process.argv.slice(2), '--bundles', 'app'], {
  stdio: 'inherit',
  env: { ...process.env, OPENQAREER_COMMIT_SHA: sha },
});
if (result.status !== 0) process.exit(result.status ?? 1);

if (process.platform === 'darwin') {
  const bundleRoot = join(process.cwd(), 'src-tauri', 'target', 'release', 'bundle');
  const macosRoot = join(bundleRoot, 'macos');
  const app = join(macosRoot, 'OpenQareer.app');
  const dmgRoot = join(bundleRoot, 'dmg');
  const executable = join(app, 'Contents', 'MacOS', 'openqareer-desktop');
  const appVersion = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const imageName = `OpenQareer_${appVersion}_${architecture}.dmg`;
  const originalImage = join(dmgRoot, imageName);
  const imageCopy = join(macosRoot, imageName);
  const temporaryImage = join(dmgRoot, `.${imageName}.${process.pid}.tmp.dmg`);
  const temporaryCopy = join(macosRoot, `.${imageName}.${process.pid}.tmp.dmg`);
  if (!existsSync(executable) || statSync(executable).mtimeMs < startedAt - 2_000) {
    throw new Error('Fresh OpenQareer.app must exist after the macOS build');
  }
  const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  if (signed.status !== 0) throw new Error('Could not ad-hoc sign the local OpenQareer.app');

  mkdirSync(dmgRoot, { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), 'openqareer-dmg-'));
  try {
    const stagedApp = join(staging, 'OpenQareer.app');
    const copied = spawnSync('ditto', [app, stagedApp], { stdio: 'inherit' });
    if (copied.status !== 0) throw new Error('Could not stage OpenQareer.app for the DMG');
    symlinkSync('/Applications', join(staging, 'Applications'));
    const created = spawnSync('hdiutil', [
      'create', '-volname', 'OpenQareer', '-srcfolder', staging, '-format', 'UDZO', temporaryImage,
    ], { stdio: 'inherit' });
    if (created.status !== 0 || !existsSync(temporaryImage) || statSync(temporaryImage).mtimeMs < startedAt - 2_000) {
      throw new Error('Could not create a fresh OpenQareer disk image');
    }
    const verified = spawnSync('hdiutil', ['verify', temporaryImage], { stdio: 'inherit' });
    if (verified.status !== 0) throw new Error('The generated OpenQareer disk image did not verify');
    renameSync(temporaryImage, originalImage);
    copyFileSync(originalImage, temporaryCopy);
    renameSync(temporaryCopy, imageCopy);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(temporaryImage, { force: true });
    rmSync(temporaryCopy, { force: true });
  }
  console.log(`kept release artifacts: ${app} and ${imageCopy} (DMG source: ${originalImage})`);
}
