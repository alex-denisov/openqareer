import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildUpdateManifest,
  updateSigningStatus,
  writeUpdateManifest,
} from './build-update-manifest.mjs';

const directories = [];

async function signedArtifact(name, signature) {
  const directory = await mkdtemp(join(tmpdir(), 'openqareer-update-'));
  directories.push(directory);
  const artifact = join(directory, name);
  await writeFile(artifact, 'fixture archive');
  await writeFile(`${artifact}.sig`, signature);
  return artifact;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('build update manifest', () => {
  it('builds Tauri static-manifest entries from both signed macOS artifacts', async () => {
    const arm = await signedArtifact('OpenQareer-aarch64.app.tar.gz', 'arm-signature');
    const intel = await signedArtifact('OpenQareer-x86_64.app.tar.gz', 'intel-signature');
    const manifest = await buildUpdateManifest({
      version: '1.0.1',
      notes: 'Исправления',
      pubDate: '2026-10-21T00:00:00.000Z',
      baseUrl: 'https://openqareer.com/desktop/',
      artifacts: { 'darwin-aarch64': arm, 'darwin-x86_64': intel },
    });

    expect(manifest).toEqual({
      version: '1.0.1',
      notes: 'Исправления',
      pub_date: '2026-10-21T00:00:00.000Z',
      platforms: {
        'darwin-aarch64': {
          signature: 'arm-signature',
          url: `https://openqareer.com/desktop/${basename(arm)}`,
        },
        'darwin-x86_64': {
          signature: 'intel-signature',
          url: `https://openqareer.com/desktop/${basename(intel)}`,
        },
      },
    });
  });

  it('writes the generated manifest as JSON to the requested output', async () => {
    const arm = await signedArtifact('OpenQareer-aarch64.app.tar.gz', 'arm-signature');
    const intel = await signedArtifact('OpenQareer-x86_64.app.tar.gz', 'intel-signature');
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-manifest-'));
    directories.push(directory);
    const output = join(directory, 'latest.json');
    const input = {
      version: '1.0.1',
      notes: 'Исправления',
      pubDate: '2026-10-21T00:00:00.000Z',
      baseUrl: 'https://openqareer.com/desktop/',
      artifacts: { 'darwin-aarch64': arm, 'darwin-x86_64': intel },
    };

    const manifest = await writeUpdateManifest(input, output);

    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(manifest);
  });

  it('fails closed when an artifact signature is absent or empty', async () => {
    const artifact = await signedArtifact('OpenQareer-aarch64.app.tar.gz', '   ');

    await expect(buildUpdateManifest({
      version: '1.0.1',
      notes: '',
      pubDate: '2026-10-21T00:00:00.000Z',
      baseUrl: 'https://openqareer.com/desktop/',
      artifacts: { 'darwin-aarch64': artifact, 'darwin-x86_64': artifact },
    })).rejects.toThrow(/signature/u);
  });

  it('requires both supported macOS architecture artifacts', async () => {
    const arm = await signedArtifact('OpenQareer-aarch64.app.tar.gz', 'arm-signature');

    await expect(buildUpdateManifest({
      version: '1.0.1',
      notes: '',
      pubDate: '2026-10-21T00:00:00.000Z',
      baseUrl: 'https://openqareer.com/desktop/',
      artifacts: { 'darwin-aarch64': arm },
    })).rejects.toThrow(/darwin-x86_64/u);
  });

  it('reports signing as skipped without a key and configured when secret text is present', () => {
    expect(updateSigningStatus({})).toBe('Updater artifact signing skipped: no signing key configured.');
    expect(updateSigningStatus({ TAURI_SIGNING_PRIVATE_KEY_PATH: '/secure/openqareer-dev.key' })).toBe(
      'Updater artifact signing skipped: no signing key configured.',
    );
    expect(updateSigningStatus({ TAURI_SIGNING_PRIVATE_KEY: 'key content' })).toBe(
      'Updater signing key configured.',
    );
  });
});
