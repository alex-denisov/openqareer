import { createHash } from 'node:crypto';
import type { StoredCandidateDocument } from '../data/candidateStore';
import type { ResumeDocument } from '../domain/resumeStudioTypes';
import type { StoredResumeVersion } from '../domain/resumeVersions';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from './deps';
import { candidatePlan } from './helpers';
import { buildVersionContent, currentMaster, type CandidateResumeMaster } from './resumeMaster';

/** Пределы схемы версии резюме (`resumeVersionContentSchema`). */
const MAX_TITLE_LENGTH = 160;
const MAX_REQUIREMENTS = 50;
const MAX_REQUIREMENT_LENGTH = 160;
const SNAPSHOT_PREFIX = 'approved-resume-';

/**
 * `targeted` — резюме под вакансию (Basic и выше), `master` — снимок общего резюме без подгонки (Free),
 * `general` — уже готовое общее резюме кандидата, которое он приложил сам, когда снимок не создался.
 */
export type AttachedResumeKind = 'targeted' | 'master' | 'general';

export interface AttachedResume {
  readonly kind: AttachedResumeKind;
  readonly versionId: string | null;
  readonly documentId: string;
  /** Когда снят снимок резюме. */
  readonly snapshotAt: string;
}

export interface LetterResumeState {
  /** Есть опыт работы: резюме существует и приложится к отклику. */
  readonly available: boolean;
  readonly kind: 'targeted' | 'master';
}

export interface GeneralResume {
  readonly documentId: string;
  readonly fileName: string;
}

/** Снимок резюме не создался: письмо не одобряется молча без резюме (решение владельца 08.11). */
export class ResumeSnapshotError extends Error {
  constructor(cause: unknown) {
    super('letter approval resume snapshot failed', { cause });
    this.name = 'ResumeSnapshotError';
  }
}

/**
 * Резюме есть, если в собранном мастер-документе есть хотя бы одно место работы. Проверяется документ,
 * а не черновик: место без подтверждённого факта в снимок не попадает. «О себе» не считается: снимок
 * под вакансию отбрасывает его, если он не совпадает с требованиями, и приложилась бы одна шапка.
 */
export function hasAttachableResume(document: ResumeDocument): boolean {
  return document.experience.length > 0;
}

/** Резюме под вакансию — функция Basic и выше; Free прикладывает общее резюме. Тариф — `candidatePlan`. */
export function letterResumeKind(deps: RouteDeps, candidateId: string): LetterResumeState['kind'] {
  return candidatePlan(deps, candidateId) === 'free' ? 'master' : 'targeted';
}

export function letterResumeState(deps: RouteDeps, candidateId: string, document: ResumeDocument): LetterResumeState {
  return { available: hasAttachableResume(document), kind: letterResumeKind(deps, candidateId) };
}

/**
 * Одна версия на вакансию и ревизию мастер-резюме: повторное одобрение находит ту же версию,
 * а изменённое резюме даёт новую. Формат UUID нужен маршруту версий.
 */
function stableVersionId(candidateId: string, vacancyId: string, masterRevision: string): string {
  const hex = createHash('sha256')
    .update(['letter-approval-resume', candidateId, vacancyId, masterRevision].join('\u0000'))
    .digest('hex');
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return [hex.slice(0, 8), hex.slice(8, 12), '5' + hex.slice(13, 16), variant + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

function versionTarget(cluster: VacancyCluster): { title: string; requirements: string[] } {
  const title = cluster.canonicalTitle.trim().slice(0, MAX_TITLE_LENGTH) || 'Резюме под вакансию';
  const requirements = cluster.skills
    .map((skill) => skill.trim().slice(0, MAX_REQUIREMENT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_REQUIREMENTS);
  return { title, requirements };
}

/** Существующая механика версий: черновик из мастер-резюме, затем одобрение тем же содержимым. */
function approvedVersion(
  deps: RouteDeps,
  candidateId: string,
  master: CandidateResumeMaster,
  cluster: VacancyCluster,
): StoredResumeVersion {
  const { candidateStore } = deps;
  const versionId = stableVersionId(candidateId, cluster.id, master.revision);
  const { title, requirements } = versionTarget(cluster);
  const created = candidateStore.createResumeVersion(
    candidateId,
    versionId,
    master.revision,
    buildVersionContent(master, title, requirements),
  );
  const version = created.status === 'id_conflict'
    ? candidateStore.getResumeVersion(candidateId, versionId)
    : created.version;
  if (!version) throw new Error('letter approval resume version could not be read');
  if (version.status !== 'draft') return version;
  const approved = candidateStore.updateResumeVersion(
    candidateId,
    versionId,
    version.revision,
    master.revision,
    buildVersionContent(master, title, requirements, 'approved'),
  );
  return approved.status === 'updated' ? approved.version : version;
}

function snapshotFilePrefix(applicationId: string): string {
  return SNAPSHOT_PREFIX + applicationId + '-';
}

function newest(documents: readonly StoredCandidateDocument[]): StoredCandidateDocument | undefined {
  return documents.reduce<StoredCandidateDocument | undefined>(
    (latest, document) => (!latest || document.createdAt > latest.createdAt ? document : latest),
    undefined,
  );
}

/**
 * Привязанный снимок заявки — последний созданный: каждая привязка создаёт новый документ, а повтор
 * с тем же снимком ничего не создаёт. Так дубль виден без отдельного чтения материалов заявки.
 */
function linkedSnapshot(deps: RouteDeps, candidateId: string, applicationId: string) {
  const { candidateStore } = deps;
  if (!candidateStore.getApplication(candidateId, applicationId)?.materials.resume) return undefined;
  const prefix = snapshotFilePrefix(applicationId);
  return newest(
    candidateStore
      .getSnapshot(candidateId)
      .documents.filter((document) => document.kind === 'resume' && document.fileName.startsWith(prefix)),
  );
}

/** Общее резюме, которое кандидат загрузил или импортировал сам; снимки одобрений сюда не входят. */
export function generalResumeOf(deps: RouteDeps, candidateId: string): GeneralResume | null {
  const document = newest(
    deps.candidateStore
      .getSnapshot(candidateId)
      .documents.filter((item) => item.kind === 'resume' && item.source !== 'generated' && !item.fileName.startsWith(SNAPSHOT_PREFIX)),
  );
  return document ? { documentId: document.id, fileName: document.fileName } : null;
}

interface SnapshotPlan {
  readonly kind: 'targeted' | 'master';
  readonly versionId: string | null;
  readonly fileName: string;
  readonly snapshotAt: string;
  readonly content: Record<string, unknown>;
}

function targetedPlan(deps: RouteDeps, candidateId: string, applicationId: string, master: CandidateResumeMaster, cluster: VacancyCluster): SnapshotPlan {
  const version = approvedVersion(deps, candidateId, master, cluster);
  return {
    kind: 'targeted',
    versionId: version.id,
    fileName: snapshotFilePrefix(applicationId) + version.id + '.json',
    snapshotAt: version.createdAt,
    content: { resumeVersionId: version.id, sourceMasterRevision: version.sourceMasterRevision, title: version.title, snapshot: version.snapshot },
  };
}

/** Free: общее резюме как есть, без подгонки под вакансию и без версии «под вакансию». */
function masterPlan(applicationId: string, master: CandidateResumeMaster, approvedAt: string): SnapshotPlan {
  const revisionKey = createHash('sha256').update(master.revision).digest('hex').slice(0, 32);
  return {
    kind: 'master',
    versionId: null,
    fileName: snapshotFilePrefix(applicationId) + 'master-' + revisionKey + '.json',
    snapshotAt: approvedAt,
    content: { resumeVersionId: null, sourceMasterRevision: master.revision, title: 'Общее резюме', snapshot: { document: master.document } },
  };
}

function planSnapshot(deps: RouteDeps, candidateId: string, applicationId: string, cluster: VacancyCluster, approvedAt: string, master: CandidateResumeMaster): SnapshotPlan {
  return letterResumeKind(deps, candidateId) === 'master'
    ? masterPlan(applicationId, master, approvedAt)
    : targetedPlan(deps, candidateId, applicationId, master, cluster);
}

/** Кнопка «Подготовить резюме»: повторяет создание снимка, не трогая письмо и заявку. */
/** B631: the version id lets the letter open the resume it will attach in a panel over itself. */
export function prepareLetterResume(
  deps: RouteDeps,
  candidateId: string,
  cluster: VacancyCluster,
): LetterResumeState & { readonly versionId: string | null } {
  const master = currentMaster(deps, candidateId);
  const state = letterResumeState(deps, candidateId, master.document);
  if (!state.available || state.kind === 'master') return { ...state, versionId: null };
  try {
    return { ...state, versionId: approvedVersion(deps, candidateId, master, cluster).id };
  } catch (error) {
    throw new ResumeSnapshotError(error);
  }
}

/** Снимок не создался, и кандидат выбрал своё общее резюме: привязываем его как есть. */
function attachGeneralResume(deps: RouteDeps, candidateId: string, applicationId: string, documentId: string): AttachedResume | undefined {
  const general = generalResumeOf(deps, candidateId);
  if (general?.documentId !== documentId) return undefined;
  const document = deps.candidateStore.getDocument(candidateId, documentId);
  if (!document) return undefined;
  deps.candidateStore.linkApplicationMaterial(candidateId, applicationId, 'resume', documentId);
  return { kind: 'general', versionId: null, documentId, snapshotAt: document.createdAt };
}

export interface AttachResumeInput {
  readonly applicationId: string;
  readonly cluster: VacancyCluster;
  readonly approvedAt: string;
  readonly generalResumeId?: string;
}

/**
 * При одобрении письма к заявке привязывается снимок резюме (решение владельца 06.11: резюме уходит
 * во всех каналах). Ничего не отправляется. Вызывается внутри транзакции одобрения: сбой снимка
 * бросает `ResumeSnapshotError`, и письмо не одобряется. Опыта нет — `null`, письмо его не обещает.
 */
export function attachApprovedResume(deps: RouteDeps, candidateId: string, input: AttachResumeInput): AttachedResume | null {
  const { applicationId, cluster, approvedAt, generalResumeId } = input;
  const master = currentMaster(deps, candidateId);
  if (!hasAttachableResume(master.document)) return null;
  if (generalResumeId) {
    const general = attachGeneralResume(deps, candidateId, applicationId, generalResumeId);
    if (general) return general;
  }
  try {
    const plan = planSnapshot(deps, candidateId, applicationId, cluster, approvedAt, master);
    const linked = linkedSnapshot(deps, candidateId, applicationId);
    if (linked?.fileName === plan.fileName) {
      return { kind: plan.kind, versionId: plan.versionId, documentId: linked.id, snapshotAt: plan.kind === 'master' ? linked.createdAt : plan.snapshotAt };
    }
    const content = { version: 1, kind: plan.kind, ...plan.content, vacancyId: cluster.id, applicationId, approvedAt, sent: false };
    // Без разобранного текста: снимок не попадает в знания консультанта, там уже есть мастер-резюме.
    const { document } = deps.candidateStore.saveDocumentAndLinkApplicationMaterial(candidateId, applicationId, 'resume', {
      kind: 'resume',
      source: 'generated',
      fileName: plan.fileName,
      mimeType: 'application/json',
      contentBase64: Buffer.from(JSON.stringify(content), 'utf8').toString('base64'),
      parseStatus: 'not_applicable',
    });
    return { kind: plan.kind, versionId: plan.versionId, documentId: document.id, snapshotAt: plan.snapshotAt };
  } catch (error) {
    throw new ResumeSnapshotError(error);
  }
}
