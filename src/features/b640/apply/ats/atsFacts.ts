import type { ApprovedVacancyLetterResult } from '../../../vacancies/vacancyLetterApi';
import { loadLetterResumePreview } from '../../../vacancies/vacancyLetterResumePreview';
import { getResumeStudio } from '../../../resume/resumeApi';
import type { ResumeDocument } from '../../../resume/resumeTypes';
import { apiFetch, throwApiError } from '../../../coach/apiClient';
import { exportResumeFile } from '../../../site/resumeBuilder/resumeBuilderApi';
import { sheetFromDocument } from '../model/resumeSheet';
import { splitName, type IdentityFacts } from './atsIdentity';
import type { AtsFile } from './atsFormTypes';

type ApprovedResume = ApprovedVacancyLetterResult['resume'] | null;

const PDF = 'application/pdf';
const BASE64_CHUNK = 0x8000;

export function base64Of(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let from = 0; from < bytes.length; from += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(from, from + BASE64_CHUNK)));
  }
  return btoa(parts.join(''));
}

/** Имя файла без знаков, которые приложение не примет. */
export function resumeFileName(name: string, extension: string): string {
  const stem = name
    .replace(/[\p{Cc}/\\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return `${stem.slice(0, 120) || 'resume'}.${extension}`;
}

/** Город и страна — только когда место записано через запятую. */
function place(location: string | undefined): Pick<IdentityFacts, 'city' | 'country'> {
  const parts = (location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? { city: parts[0], country: parts.at(-1) } : { city: parts[0] };
}

export function factsOf({ contact }: Pick<ResumeDocument, 'contact'>): IdentityFacts {
  const text = (value: string | null | undefined) => value?.trim() || undefined;
  const fullName = text(contact.fullName);
  const location = text(contact.location);
  const links = contact.links.map((link) => link.trim()).filter(Boolean);
  const linkedin = links.find((link) => /linkedin\.com\/in\//iu.test(link));
  return {
    fullName,
    ...splitName(fullName ?? ''),
    email: text(contact.email),
    phone: text(contact.phone),
    linkedin: linkedin?.replace(/^(?!https?:\/\/)/iu, 'https://'),
    website: links.find(
      (link) => /^https?:\/\//iu.test(link) && !/linkedin\.com|github\.com/iu.test(link),
    ),
    location,
    ...place(location),
  };
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  [PDF]: 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Общее резюме кандидата уходит тем файлом, который он загрузил. */
async function uploadedFile(documentId: string, name: string): Promise<AtsFile | null> {
  const path = `/api/v1/candidate/documents/${encodeURIComponent(documentId)}/download`;
  const response = await apiFetch(path);
  if (!response.ok) await throwApiError(response);
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const extension = Object.hasOwn(EXTENSIONS, type) ? EXTENSIONS[type]! : null;
  if (!extension) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { name: resumeFileName(name, extension), type, base64: base64Of(bytes) };
}

async function builtFile(document: ResumeDocument): Promise<AtsFile> {
  const sheet = sheetFromDocument(document);
  const blob = await exportResumeFile(sheet, 'strict', 'pdf');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { name: resumeFileName(sheet.fullName, 'pdf'), type: PDF, base64: base64Of(bytes) };
}

/** Контакты кандидата из его профиля. */
export async function loadAtsFacts(): Promise<IdentityFacts> {
  return factsOf((await getResumeStudio()).projection.master);
}

/** Файл того резюме, которое одобрено с письмом; `null` — файла нет. */
export async function loadAtsResume(
  vacancyId: string,
  approved: ApprovedResume | undefined,
  fullName: string,
): Promise<AtsFile | null> {
  if (!approved) return null;
  if (approved.kind === 'general') return uploadedFile(approved.documentId, fullName);
  const { document } = await loadLetterResumePreview(vacancyId, approved);
  return document ? builtFile(document) : null;
}
