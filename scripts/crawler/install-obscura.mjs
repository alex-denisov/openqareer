#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmodSync, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OBSCURA_VERSION = 'v0.2.2';

function resolvePlatformAsset() {
  const os = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null;
  if (!os) {
    throw new Error(`Unsupported OS for Obscura binary: ${process.platform}`);
  }
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : null;
  if (!arch) {
    throw new Error(`Unsupported CPU architecture for Obscura binary: ${process.arch}`);
  }
  const assetName = `obscura-${arch}-${os}-no-render-stealth.tar.gz`;
  const url = `https://github.com/h4ckf0r0day/obscura/releases/download/${OBSCURA_VERSION}/${assetName}`;
  return { os, arch, assetName, url };
}

async function downloadAsset(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download Obscura binary from ${url}: HTTP ${res.status}`);
  }
  const out = createWriteStream(destPath);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
  }
  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.on('error', reject);
  });
}

function extractBinary(archivePath, targetDir) {
  execFileSync('tar', ['-xzf', archivePath, '-C', targetDir], { stdio: 'inherit' });
}

export async function installObscura(options = {}) {
  const rootDir = options.rootDir ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
  const binDir = join(rootDir, 'bin');
  mkdirSync(binDir, { recursive: true });

  const { assetName, url } = resolvePlatformAsset();
  const archivePath = join(binDir, assetName);
  const binaryPath = join(binDir, 'obscura');

  console.log(`[obscura] Downloading ${url}...`);
  await downloadAsset(url, archivePath);

  console.log(`[obscura] Extracting to ${binDir}...`);
  extractBinary(archivePath, binDir);
  chmodSync(binaryPath, 0o755);
  rmSync(archivePath, { force: true });

  const version = execFileSync(binaryPath, ['--version'], { encoding: 'utf-8' }).trim();
  console.log(`[obscura] Installed successfully: ${version} at ${binaryPath}`);
  return binaryPath;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  installObscura().catch((err) => {
    console.error(`[obscura] Install error:`, err);
    process.exit(1);
  });
}
