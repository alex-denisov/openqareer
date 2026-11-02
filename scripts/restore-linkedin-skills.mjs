#!/usr/bin/env node
/**
 * One-off (B591): adds the LinkedIn skills a walk lost to a candidate's
 * resume draft. The skills page virtualises its list, and every import since
 * 23.10 read only the rows left in the DOM after the scroll (10–14 of 44);
 * the shell now collects rows at every step, this repairs the drafts saved
 * before that.
 *
 * Self-contained so it runs on the host with the bundled node and the
 * service's env file. Dry-run by default; prints counts and skill names
 * (skill names are public profile captions, not private text).
 *
 *   node restore-linkedin-skills.mjs --candidate <id> --skills <names.json> [--db <path>] [--env <file>] [--write]
 *
 * Idempotent and additive: a skill already in the draft (any case or
 * punctuation) is skipped, and no existing entry, status or order changes.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RESTORED_SOURCE = 'LinkedIn';
const MAX_NAME = 120;

function nameKey(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function planSkillRestore(draft, names) {
  const skills = draft.skills ?? [];
  const seen = new Set(skills.map((skill) => nameKey(skill.name ?? '')));
  const added = [];
  for (const raw of names) {
    const name = String(raw).trim();
    const key = nameKey(name);
    if (!key || name.length > MAX_NAME || seen.has(key)) continue;
    seen.add(key);
    added.push(name);
  }
  const restored = added.map((name) => ({
    id: `skill-li-${createHash('sha256').update(nameKey(name)).digest('hex').slice(0, 8)}`,
    name,
    source: RESTORED_SOURCE,
  }));
  return { added, draft: { ...draft, skills: [...skills, ...restored] } };
}

function sealer(key) {
  return {
    open(sealed, aad) {
      const [, iv, tag, body] = sealed.split('.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
        authTagLength: 16,
      });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(body, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
    seal(plain, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        body.toString('base64url'),
      ].join('.');
    },
  };
}

function readKey(envFile) {
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('OPENQAREER_DATA_ENCRYPTION_KEY='));
  if (!line) throw new Error(`OPENQAREER_DATA_ENCRYPTION_KEY not found in ${envFile}`);
  const key = Buffer.from(
    line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, ''),
    'base64',
  );
  if (key.length !== 32) throw new Error('data encryption key must decode to 32 bytes');
  return key;
}

function parseArgs(argv) {
  const value = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const candidateId = value('--candidate');
  const skills = value('--skills');
  if (!candidateId || !skills)
    throw new Error('--candidate <id> and --skills <names.json> are required');
  return {
    candidateId,
    skills,
    db: value('--db', '/var/lib/openqareer/openqareer.db'),
    env: value('--env', '/etc/openqareer/openqareer.env'),
    write: argv.includes('--write'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = JSON.parse(readFileSync(args.skills, 'utf8'));
  if (!Array.isArray(names)) throw new Error('--skills must be a JSON array of names');
  const { DatabaseSync } = await import('node:sqlite');
  const box = sealer(readKey(args.env));
  const db = new DatabaseSync(args.db, { readOnly: !args.write });
  const c = args.candidateId;
  const row = db.prepare('SELECT draft_cipher FROM resume_drafts WHERE candidate_id = ?').get(c);
  if (!row) throw new Error('candidate has no resume draft');
  const draftAad = `candidate:${c}:resume:draft`;
  const envelope = JSON.parse(box.open(row.draft_cipher, draftAad));
  const isEnvelope = envelope && typeof envelope === 'object' && 'draft' in envelope;
  const draft = isEnvelope ? envelope.draft : envelope;
  const plan = planSkillRestore(draft, names);
  console.log(
    JSON.stringify(
      {
        mode: args.write ? 'write' : 'dry-run',
        candidateId: c,
        skillsBefore: (draft.skills ?? []).length,
        skillsAfter: plan.draft.skills.length,
        added: plan.added,
      },
      null,
      2,
    ),
  );
  if (!args.write || plan.added.length === 0) return;
  const stored = isEnvelope ? { ...envelope, draft: plan.draft } : plan.draft;
  db.prepare(
    'UPDATE resume_drafts SET draft_cipher = ?, updated_at = ? WHERE candidate_id = ?',
  ).run(box.seal(JSON.stringify(stored), draftAad), new Date().toISOString(), c);
  console.log('written');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
