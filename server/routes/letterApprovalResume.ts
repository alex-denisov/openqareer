import { createHash } from 'node:crypto';
import type { StoredCandidateDocument } from '../data/candidateStore';
import type { ResumeDocument } from '../domain/resumeStudioTypes';
import type { StoredResumeVersion } from '../domain/resumeVersions';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from './deps';
import { buildVersionContent, currentMaster, type CandidateResumeMaster } from './resumeMaster';

/** Пределы схемы версии резюме (`resumeVersionContentSchema`). */
const MAX_TITLE_LENGTH = 160;
const MAX_REQUIREMENTS = 50;
const MAX_REQUIREMENT_LENGTH = 160;

export interface AttachedResume {
  readonly versionId: string;
  readonly documentId: string;
  /** Когда снят снимок резюме под вакансию. */
  readonly snapshotAt: string;
}

/**
 * Резюме есть, если в собранном мастер-документе есть хотя бы одно место работы. Проверяется документ,
 * а не черновик: место без подтверждённого факта в снимок не попадает. «О себе» не считается: снимок
 * под вакансию отбрасывает его, если он не совпадает с требованиями, и приложилась бы одна шапка.
 */
export function hasAttachableResume(document: ResumeDocument): boolean {
  return document.experience.length > 0;
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
  versionId: string,
  master: CandidateResumeMaster,
  cluster: VacancyCluster,
): StoredResumeVersion {
  const { candidateStore } = deps;
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
  return 'approved-resume-' + applicationId + '-';
}

/**
 * Привязанный снимок заявки — последний созданный: каждая привязка создаёт новый документ, а повтор
 * с тем же снимком ничего не создаёт. Так дубль виден без отдельного чтения материалов заявки.
 */
function linkedSnapshot(deps: RouteDeps, candidateId: string, applicationId: string) {
  const { candidateStore } = deps;
  if (!candidateStore.getApplication(candidateId, applicationId)?.materials.resume) return undefined;
  const prefix = snapshotFilePrefix(applicationId);
  return candidateStore
    .getSnapshot(candidateId)
    .documents.filter((document) => document.kind === 'resume' && document.fileName.startsWith(prefix))
    .reduce<StoredCandidateDocument | undefined>(
      (newest, document) => (!newest || document.createdAt > newest.createdAt ? document : newest),
      undefined,
    );
}

/**
 * При одобрении письма к заявке привязывается снимок резюме под вакансию (решение владельца 06.11:
 * резюме уходит во всех каналах). Ничего не отправляется. Вызывается внутри транзакции одобрения.
 * Резюме нет — `null`, письмо одобряется без него.
 */
export function attachApprovedResume(
  deps: RouteDeps,
  candidateId: string,
  applicationId: string,
  cluster: VacancyCluster,
  approvedAt: string,
): AttachedResume | null {
  const { candidateStore } = deps;
  const master = currentMaster(deps, candidateId);
  if (!hasAttachableResume(master.document)) return null;
  const versionId = stableVersionId(candidateId, cluster.id, master.revision);
  const version = approvedVersion(deps, candidateId, versionId, master, cluster);
  const fileName = snapshotFilePrefix(applicationId) + versionId + '.json';
  const linked = linkedSnapshot(deps, candidateId, applicationId);
  if (linked?.fileName === fileName) {
    return { versionId, documentId: linked.id, snapshotAt: version.createdAt };
  }
  const snapshot = {
    version: 1,
    resumeVersionId: versionId,
    sourceMasterRevision: version.sourceMasterRevision,
    vacancyId: cluster.id,
    applicationId,
    approvedAt,
    title: version.title,
    snapshot: version.snapshot,
    sent: false,
  };
  // Без разобранного текста: снимок не попадает в знания консультанта, там уже есть мастер-резюме.
  const { document } = candidateStore.saveDocumentAndLinkApplicationMaterial(candidateId, applicationId, 'resume', {
    kind: 'resume',
    source: 'generated',
    fileName,
    mimeType: 'application/json',
    contentBase64: Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64'),
    parseStatus: 'not_applicable',
  });
  return { versionId, documentId: document.id, snapshotAt: version.createdAt };
}
