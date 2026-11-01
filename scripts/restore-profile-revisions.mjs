#!/usr/bin/env node
/**
 * One-off: re-applies a candidate's accepted, non-reverted consultant
 * revisions (`profile_revisions`) onto the current resume draft after a
 * LinkedIn re-import replaced it (01.11, candidate 81d104dc…).
 *
 * Self-contained so it runs on the host with the bundled node and the
 * service's env file; no server build needed. Dry-run by default; prints only
 * counts, ids and skill keys, never profile text.
 *
 *   node restore-profile-revisions.mjs --candidate <id> [--db <path>] [--env <file>] [--write]
 *
 * Idempotent: a target that already carries the applied state is skipped. A
 * skill whose current confirmation is newer than the revision (a later quiz)
 * is kept as it is.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SKILL_PREFIX = 'skill:';
const ABSENT_SKILL = 'null';
const SKILL_FIELDS = ['level', 'status', 'source', 'verifiedAt'];

export function skillKey(name) {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 70);
  return key || 'skill';
}

function sameSkillState(skill, state) {
  if (!skill || state === null) return !skill && state === null;
  return skill.name === state.name && SKILL_FIELDS.every((field) => (skill[field] ?? null) === (state[field] ?? null));
}

function writeSkill(draft, key, state) {
  const skills = draft.skills ?? [];
  const existing = skills.find((skill) => skillKey(skill.name) === key);
  if (state === null) return { ...draft, skills: skills.filter((skill) => skill !== existing) };
  const next = {
    id: existing?.id ?? `skill-${randomUUID().slice(0, 8)}`,
    ...(existing?.evidenceMemoryId ? { evidenceMemoryId: existing.evidenceMemoryId } : {}),
    name: state.name,
    ...Object.fromEntries(SKILL_FIELDS.filter((field) => state[field]).map((field) => [field, state[field]])),
  };
  return { ...draft, skills: existing ? skills.map((skill) => (skill === existing ? next : skill)) : [...skills, next] };
}

/** Latest live revision per target wins; earlier ones were superseded by it. */
function latestPerTarget(revisions) {
  const live = revisions.filter((revision) => !revision.revertedAt);
  const ordered = [...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byTarget = new Map(ordered.map((revision) => [`${revision.section}|${revision.experienceId ?? ''}`, revision]));
  return [...byTarget.values()];
}

function restoreOne(draft, revision) {
  const { experienceId, appliedText } = revision;
  if (revision.section === 'experience' && experienceId?.startsWith(SKILL_PREFIX)) {
    const key = experienceId.slice(SKILL_PREFIX.length);
    const state = appliedText === ABSENT_SKILL ? null : JSON.parse(appliedText);
    const current = (draft.skills ?? []).find((skill) => skillKey(skill.name) === key);
    if (sameSkillState(current, state)) return { draft, outcome: 'already' };
    if (current?.status && current.verifiedAt && state?.verifiedAt && current.verifiedAt >= state.verifiedAt
      && current.status === state.status) {
      return { draft, outcome: 'kept-newer' };
    }
    return { draft: writeSkill(draft, key, state), outcome: current ? 'updated' : 'added' };
  }
  if (revision.section === 'headline' || revision.section === 'about') {
    const field = revision.section;
    if (draft.candidate?.[field] === appliedText) return { draft, outcome: 'already' };
    return { draft: { ...draft, candidate: { ...draft.candidate, [field]: appliedText } }, outcome: 'updated' };
  }
  const index = draft.experience.findIndex((role) => role.id === experienceId);
  if (index < 0) return { draft, outcome: 'target-missing' };
  if (draft.experience[index].title === appliedText) return { draft, outcome: 'already' };
  const experience = draft.experience.map((role, i) => (i === index ? { ...role, title: appliedText } : role));
  return { draft: { ...draft, experience }, outcome: 'updated' };
}

/** Pure plan: the restored draft plus one id-only line per revision. */
export function planRestore(draft, revisions) {
  const report = [];
  let next = draft;
  for (const revision of latestPerTarget(revisions)) {
    const result = restoreOne(next, revision);
    next = result.draft;
    report.push({ revisionId: revision.id, target: revision.experienceId ?? revision.section, outcome: result.outcome });
  }
  const superseded = revisions.filter((r) => !r.revertedAt && !report.some((line) => line.revisionId === r.id));
  for (const revision of superseded) {
    report.push({ revisionId: revision.id, target: revision.experienceId ?? revision.section, outcome: 'superseded' });
  }
  return { draft: next, report, changed: report.some((line) => ['updated', 'added'].includes(line.outcome)) };
}

function sealer(key) {
  return {
    open(sealed, aad) {
      const [, iv, tag, body] = sealed.split('.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    },
    seal(plain, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    },
  };
}

function readKey(envFile) {
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('OPENQAREER_DATA_ENCRYPTION_KEY='));
  if (!line) throw new Error(`OPENQAREER_DATA_ENCRYPTION_KEY not found in ${envFile}`);
  const key = Buffer.from(line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''), 'base64');
  if (key.length !== 32) throw new Error('data encryption key must decode to 32 bytes');
  return key;
}

function parseArgs(argv) {
  const value = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const candidateId = value('--candidate');
  if (!candidateId) throw new Error('--candidate <id> is required');
  return {
    candidateId,
    db: value('--db', '/var/lib/openqareer/openqareer.db'),
    env: value('--env', '/etc/openqareer/openqareer.env'),
    write: argv.includes('--write'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
  const revisions = db
    .prepare('SELECT * FROM profile_revisions WHERE candidate_id = ? ORDER BY created_at')
    .all(c)
    .map((r) => ({
      id: r.id,
      section: r.section,
      experienceId: r.experience_id,
      revertedAt: r.reverted_at,
      createdAt: r.created_at,
      appliedText: box.open(r.applied_text_cipher, `candidate:${c}:profile-revision:${r.id}:applied`),
    }));
  const plan = planRestore(draft, revisions);
  console.log(JSON.stringify({
    mode: args.write ? 'write' : 'dry-run',
    candidateId: c,
    revisions: revisions.length,
    live: revisions.filter((r) => !r.revertedAt).length,
    skillsBefore: (draft.skills ?? []).length,
    skillsAfter: (plan.draft.skills ?? []).length,
    report: plan.report,
    changed: plan.changed,
  }, null, 2));
  if (!args.write || !plan.changed) return;
  const stored = isEnvelope ? { ...envelope, draft: plan.draft } : plan.draft;
  db.prepare('UPDATE resume_drafts SET draft_cipher = ?, updated_at = ? WHERE candidate_id = ?')
    .run(box.seal(JSON.stringify(stored), draftAad), new Date().toISOString(), c);
  console.log('written');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
