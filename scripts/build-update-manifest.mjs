#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'src-tauri', 'tauri.conf.json');
const OUTPUT_DEFAULT = join(ROOT, 'dist', 'desktop', 'latest.json');
// B576: every client is fed from one release; a missing platform fails the build.
const PLATFORMS = ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'];
const ARTIFACT_SUFFIX = {
  'darwin-aarch64': '.app.tar.gz',
  'darwin-x86_64': '.app.tar.gz',
  'windows-x86_64': '-setup.exe',
};
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function readTauriConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function defaultBaseUrl(config) {
  const endpoint = config.plugins?.updater?.endpoints?.[0];
  if (typeof endpoint !== 'string') throw new Error('Updater endpoint is missing from tauri.conf.json.');
  const url = new URL(endpoint);
  url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  url.search = '';
  url.hash = '';
  return url.href;
}

function validateManifestFields(input) {
  if (!SEMVER_PATTERN.test(input.version)) throw new Error('Version must be valid SemVer.');
  if (!RFC3339_PATTERN.test(input.pubDate) || !Number.isFinite(Date.parse(input.pubDate))) {
    throw new Error('Publish date must be RFC 3339.');
  }
  if (typeof input.notes !== 'string') throw new Error('Release notes must be text.');
  const baseUrl = new URL(input.baseUrl);
  if (baseUrl.protocol !== 'https:') throw new Error('Updater artifact URLs must use HTTPS.');
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  return baseUrl;
}

async function readArtifactSignature(artifactPath, platform) {
  const info = await stat(artifactPath).catch(() => null);
  if (!info?.isFile()) throw new Error(`Missing updater artifact for ${platform}.`);
  if (!artifactPath.endsWith(ARTIFACT_SUFFIX[platform])) throw new Error(`Unexpected updater artifact for ${platform}.`);
  const signature = await readFile(`${artifactPath}.sig`, 'utf8').catch(() => '');
  if (!signature.trim()) throw new Error(`Missing signature for ${platform}.`);
  return signature.trim();
}

export function updateSigningStatus(environment = process.env) {
  return environment.TAURI_SIGNING_PRIVATE_KEY?.trim()
    ? 'Updater signing key configured.'
    : 'Updater artifact signing skipped: no signing key configured.';
}

export async function buildUpdateManifest(input) {
  const baseUrl = validateManifestFields(input);
  const platforms = {};
  for (const platform of PLATFORMS) {
    const artifactPath = input.artifacts?.[platform];
    if (!artifactPath) throw new Error(`Missing artifact path for ${platform}.`);
    const signature = await readArtifactSignature(artifactPath, platform);
    platforms[platform] = {
      signature,
      url: new URL(encodeURIComponent(basename(artifactPath)), baseUrl).href,
    };
  }
  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.pubDate,
    platforms,
  };
}

export async function writeUpdateManifest(input, outputPath) {
  const output = resolve(outputPath);
  for (const artifactPath of Object.values(input.artifacts ?? {})) {
    if (typeof artifactPath === 'string' &&
        (output === resolve(artifactPath) || output === resolve(`${artifactPath}.sig`))) {
      throw new Error('Manifest output cannot replace an updater artifact or signature.');
    }
  }
  const manifest = await buildUpdateManifest(input);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function parseOptions(args) {
  const config = readTauriConfig();
  const options = {
    version: config.version,
    notes: '',
    pubDate: new Date().toISOString(),
    baseUrl: defaultBaseUrl(config),
    output: OUTPUT_DEFAULT,
    artifacts: {},
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--artifact') {
      const value = args[++index] ?? '';
      const separator = value.indexOf('=');
      const platform = value.slice(0, separator);
      if (!PLATFORMS.includes(platform) || separator < 1) throw new Error(`Use --artifact <${PLATFORMS.join('|')}>=<path>.`);
      if (options.artifacts[platform]) throw new Error(`Duplicate artifact for ${platform}.`);
      options.artifacts[platform] = resolve(ROOT, value.slice(separator + 1));
    } else if (option === '--version') options.version = args[++index] ?? '';
    else if (option === '--notes') options.notes = args[++index] ?? '';
    else if (option === '--pub-date') options.pubDate = args[++index] ?? '';
    else if (option === '--base-url') options.baseUrl = args[++index] ?? '';
    else if (option === '--output') options.output = resolve(ROOT, requiredValue(args, ++index, option));
    else throw new Error(`Unknown option: ${option}`);
  }
  return options;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

async function main(args) {
  if (args.includes('--check-signing')) {
    process.stdout.write(`${updateSigningStatus()}\n`);
    return;
  }
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/build-update-manifest.mjs --artifact <platform>=<file> [--artifact ...] [--output <file>] [--base-url <https-url>] [--version <semver>] [--notes <text>] [--pub-date <rfc3339>]\n');
    return;
  }
  const options = parseOptions(args);
  const { output, ...manifestOptions } = options;
  await writeUpdateManifest(manifestOptions, output);
  process.stdout.write(`Wrote update manifest: ${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`build-update-manifest: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
