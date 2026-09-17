import { useRef, useState } from 'react';
import {
  ArrowClockwise,
  DownloadSimple,
  FileArrowUp,
  FilePdf,
  FileText,
  MapPin,
  Trash,
  UserCircle,
} from '@phosphor-icons/react';
import {
  CoachApiError,
  deleteCandidateDocument,
  downloadCandidateDocument,
  uploadCandidateDocument,
  type AccountSnapshot,
  type AuthUser,
  type CandidateDocument,
  type CandidateSnapshot,
} from '../coach/coachApi';
import { prepareCareerWorkspace } from '../journey/careerJourneyEngine';
import { extractTextDocument } from '../workspace/documentText';
import { extractPdfResume } from '../workspace/pdfResume';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { DOCUMENT_MAX_BYTES, megabytes } from '../../../shared/fileLimits';

import { buildProfileView } from './profileView';
import {
  ProfileAbout,
  ProfileEducation,
  ProfileExperience,
  ProfileSkills,
} from './ProfileSections';
import { CandidateReputationAuditView } from '../reputation/CandidateReputationAuditView';

type ProfileTab = 'about' | 'experience' | 'skills' | 'education' | 'portfolio' | 'reputation';

interface CareerProfileSurfaceProps {
  account?: AccountSnapshot;
  session: AuthUser;
  snapshot?: CandidateSnapshot;
  workspace?: CandidateWorkspace;
  loading: boolean;
  expanded?: boolean;
  onRefresh: () => Promise<void>;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onOpenAccount: () => void;
  onOpenExpert: () => void;
  onOpenResume: () => void;
}
const profileTabs: Array<{ id: ProfileTab; label: string }> = [
  { id: 'about', label: 'О себе' },
  { id: 'experience', label: 'Опыт' },
  { id: 'skills', label: 'Навыки' },
  { id: 'education', label: 'Образование' },
  { id: 'portfolio', label: 'Портфолио' },
  { id: 'reputation', label: 'Цифровой след' },
];


/**
 * «Главная» из макета «Пульт»: карточка кандидата, вкладки и разделы, собранные
 * из разобранного резюме.
 *
 * Отсюда убрана очередь «Подтвердите опорные факты»: макет от неё отказался, а
 * разобранное резюме — это то, что кандидат сам о себе сообщил, и собственного
 * подтверждения, чтобы попасть в его же профиль, оно не требует (B179).
 */
// eslint-disable-next-line max-lines-per-function
export function CareerProfileSurface({
  account,
  session,
  snapshot,
  workspace,
  loading,
  expanded = false,
  onRefresh,
  onUpdateWorkspace,
  onOpenAccount,
  onOpenExpert,
  onOpenResume,
}: CareerProfileSurfaceProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>('experience');
  const [busyId, setBusyId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const view = buildProfileView(snapshot);
  const name =
    view.fullName ??
    account?.displayName ??
    session.displayName ??
    account?.username ??
    session.username;

  async function removeDocument(document: CandidateDocument) {
    setBusyId(document.id);
    setError(undefined);
    try {
      await deleteCandidateDocument(document.id);
      setNotice(`«${document.fileName}» удалён из защищённого хранилища.`);
      await onRefresh();
    } catch (reason) {
      setError(profileError(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  async function downloadDocument(document: CandidateDocument) {
    setBusyId(document.id);
    setError(undefined);
    try {
      const blob = await downloadCandidateDocument(document.id);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.fileName;
      window.document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`«${document.fileName}» передан браузеру для скачивания.`);
    } catch (reason) {
      setError(profileError(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  // Upload is one atomic user action: validate, parse, persist, then project context.
  // eslint-disable-next-line max-lines-per-function
  async function uploadFile(file: File) {
    setUploading(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (file.size > DOCUMENT_MAX_BYTES) {
        throw new Error(
          `Файл больше ${megabytes(DOCUMENT_MAX_BYTES)} МБ. Сохраните более компактную копию.`,
        );
      }
      const mimeType = normalizedMimeType(file);
      let extractedText: string | undefined;
      let pageCount: number | undefined;
      let parseStatus: CandidateDocument['parseStatus'] = 'pending';
      let parseWarning: string | undefined;

      if (mimeType === 'application/pdf') {
        try {
          const extracted = await extractPdfResume(file);
          extractedText = extracted.text;
          pageCount = extracted.pageCount;
          parseStatus = 'ready';
        } catch (reason) {
          parseStatus = 'failed';
          parseWarning = reason instanceof Error ? reason.message : 'Текст PDF не удалось извлечь.';
        }
      } else {
        extractedText = (await extractTextDocument(file)).trim() || undefined;
        parseStatus = extractedText ? 'ready' : 'failed';
      }

      const documentKind = mimeType === 'application/json' ? 'profile_export' : 'resume';
      const result = await uploadCandidateDocument({
        kind: documentKind,
        fileName: file.name,
        mimeType,
        contentBase64: await readFileBase64(file),
        extractedText,
        parseStatus,
        replacesDocumentId: documentKind === 'resume' ? latestResume(snapshot)?.id : undefined,
      });

      if (extractedText) {
        const source = mimeType === 'application/pdf' ? 'pdf' : 'text';
        onUpdateWorkspace(
          prepareCareerWorkspace(
            workspace
              ? {
                  ...workspace,
                  resumeText: extractedText,
                  resumeSource: source,
                  resumeFileName: file.name,
                  resumePageCount: pageCount,
                }
              : {
                  careerGoal: 'find-job',
                  resumeText: extractedText,
                  resumeSource: source,
                  resumeFileName: file.name,
                  resumePageCount: pageCount,
                  targetDirection: account?.profile.headline ?? '',
                  // The candidate has not been asked yet; assuming a region
                  // would answer for them (B158).
                  regions: [],
                  currentSituation:
                    'Собираю подтверждённый профиль и проверяю следующий карьерный шаг.',
                  constraints: '',
                  urgency: 'active',
                },
            undefined,
            workspace,
          ),
        );
      }

      setNotice(
        result.created
          ? parseWarning
            ? `Файл сохранён. Разбор требует внимания: ${parseWarning}`
            : 'Файл сохранён и включён в карьерный контекст.'
          : 'Такой файл уже есть в хранилище; дубликат не создан.',
      );
      await onRefresh();
      setActiveTab('portfolio');
    } catch (reason) {
      setError(profileError(reason));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section
      className={`career-profile-surface ${expanded ? 'is-expanded' : ''}`}
      aria-labelledby="career-profile-surface-title"
    >
      <header className="career-profile-identity-card">
        <span className="career-profile-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div className="career-profile-identity-copy">
          <h1 id="career-profile-surface-title">{name}</h1>
          <div className="career-profile-identity-line">
            <span className="career-profile-role">
              {view.targetRole ?? account?.profile.headline ?? 'Целевая роль не названа'}
            </span>
            <span className="career-profile-dot" aria-hidden="true">
              ·
            </span>
            <span className="career-profile-location">
              <MapPin size={13} />{' '}
              {view.location ?? account?.profile.location ?? 'Локация не указана'}
            </span>
            <span className="career-pill is-good">
              <UserCircle size={12} /> {workModeLabel(account?.profile.workMode)}
            </span>
          </div>
        </div>
        <div className="career-profile-update-state">
          <span className="career-cabinet-tag">обновлён</span>
          <small>{lastChangeLabel(account, snapshot)}</small>
          <div className="career-profile-identity-actions">
            <button type="button" onClick={() => void onRefresh()}>
              <ArrowClockwise size={14} /> Обновить
            </button>
            <button type="button" onClick={onOpenAccount}>
              Изменить данные
            </button>
          </div>
        </div>
      </header>

      <nav className="career-profile-tabs" aria-label="Разделы профиля">
        {profileTabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? 'is-active' : ''}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'portfolio' && snapshot?.documents.length
              ? ` ${snapshot.documents.length}`
              : ''}
          </button>
        ))}
      </nav>

      <div className="career-profile-surface-body">
        {loading && !snapshot ? (
          <p className="career-cabinet-loading">Читаем ваш профиль…</p>
        ) : null}
        {activeTab === 'about' ? <ProfileAbout view={view} /> : null}
        {activeTab === 'experience' ? (
          <ProfileExperience view={view} onImprove={onOpenExpert} />
        ) : null}
        {activeTab === 'skills' ? <ProfileSkills view={view} /> : null}
        {activeTab === 'education' ? <ProfileEducation view={view} /> : null}
        {activeTab === 'portfolio' ? (
          <>
            <button type="button" className="career-quiet-button" onClick={onOpenResume}>
              Открыть мастер-резюме
            </button>
            <DocumentVault
              documents={snapshot?.documents ?? []}
              busyId={busyId}
              uploading={uploading}
              onUpload={uploadFile}
              onDownload={downloadDocument}
              onDelete={removeDocument}
            />
          </>
        ) : null}
        {activeTab === 'reputation' ? (
          <CandidateReputationAuditView candidateId={session.candidateId ?? undefined} />
        ) : null}
        {notice ? <p className="career-cabinet-notice">{notice}</p> : null}

        {error ? (
          <p className="career-cabinet-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// Хранилище — одна связная поверхность: список, загрузка и пустое состояние.
// eslint-disable-next-line max-lines-per-function
function DocumentVault({
  documents,
  busyId,
  uploading,
  onUpload,
  onDownload,
  onDelete,
}: {
  documents: CandidateDocument[];
  busyId?: string;
  uploading: boolean;
  onUpload: (file: File) => Promise<void>;
  onDownload: (document: CandidateDocument) => Promise<void>;
  onDelete: (document: CandidateDocument) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section className="career-document-vault">
      <header>
        <div>
          <h2>Защищённое хранилище</h2>
          <p>CV и экспорты зашифрованы; в LLM передаётся только нужный текстовый контекст.</p>
        </div>
        <label className="career-document-upload-button">
          <FileArrowUp size={17} /> {uploading ? 'Сохраняем…' : 'Добавить файл'}
          <input
            ref={fileInput}
            type="file"
            disabled={uploading}
            accept=".pdf,.docx,.txt,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = event.target.files?.[0];
              if (file) {
                void onUpload(file).finally(() => {
                  input.value = '';
                });
              }
            }}
          />
        </label>
      </header>
      {documents.length ? (
        <div className="career-document-list">
          {documents.map((document) => (
            <article key={document.id}>
              <span aria-hidden="true">
                {document.mimeType === 'application/pdf' ? (
                  <FilePdf size={22} />
                ) : (
                  <FileText size={22} />
                )}
              </span>
              <div>
                <strong>{document.fileName}</strong>
                <small>
                  Версия {document.version} · {formatBytes(document.byteSize)} ·{' '}
                  {parseStatusLabel(document.parseStatus)}
                </small>
              </div>
              <div className="career-document-actions">
                <button
                  type="button"
                  disabled={busyId === document.id}
                  onClick={() => void onDownload(document)}
                  aria-label={`Скачать ${document.fileName}`}
                >
                  <DownloadSimple size={18} />
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={busyId === document.id}
                  onClick={() => void onDelete(document)}
                  aria-label={`Удалить ${document.fileName}`}
                >
                  <Trash size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <button
          className="career-document-empty"
          type="button"
          onClick={() => fileInput.current?.click()}
        >
          <FileArrowUp size={24} />
          <span>
            <strong>Добавьте CV или экспорт профиля</strong>
            <small>
              PDF, DOCX, TXT или JSON · до {megabytes(DOCUMENT_MAX_BYTES)} МБ
            </small>
          </span>
        </button>
      )}
    </section>
  );
}

function latestResume(snapshot?: CandidateSnapshot) {
  return snapshot?.documents?.find((document) => document.kind === 'resume');
}

function normalizedMimeType(file: File) {
  const extension = file.name.toLowerCase().split('.').pop();
  const expected = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    json: 'application/json',
  }[extension ?? ''];
  if (!expected) throw new Error('Поддерживаются PDF, DOCX, TXT и JSON.');
  if (file.type && file.type !== expected && !(extension === 'txt' && file.type === 'text/plain')) {
    throw new Error('Расширение файла не совпадает с его типом.');
  }
  return expected;
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const base64 = value.split(',', 2)[1];
      if (!base64) reject(new Error('Не удалось прочитать файл.'));
      else resolve(base64);
    });
    reader.addEventListener('error', () => reject(new Error('Не удалось прочитать файл.')));
    reader.readAsDataURL(file);
  });
}


function lastChangeLabel(account?: AccountSnapshot, snapshot?: CandidateSnapshot): string {
  const value = latestChange(account, snapshot);
  if (!value) return '';
  return `Изменён ${new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))}`;
}

function latestChange(account?: AccountSnapshot, snapshot?: CandidateSnapshot): string | undefined {
  const stamps = [
    account?.profile.updatedAt,
    ...(snapshot?.memory ?? []).map((item) => item.updatedAt),
    ...(snapshot?.documents ?? []).map((item) => item.updatedAt),
  ].filter((value): value is string => Boolean(value));
  if (stamps.length === 0) return undefined;
  return stamps.reduce((latest, value) => (value > latest ? value : latest));
}

function initials(name: string) {
  return (
    name
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function workModeLabel(mode?: AccountSnapshot['profile']['workMode']) {
  if (!mode) return 'Формат не указан';
  const labels = {
    office: 'Офис',
    hybrid: 'Гибрид',
    remote: 'Удалённо',
    flexible: 'Гибко',
  };
  return labels[mode];
}





function formatBytes(bytes: number) {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} МБ`
    : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function parseStatusLabel(status: CandidateDocument['parseStatus']) {
  return {
    pending: 'ждёт разбора',
    ready: 'текст готов',
    failed: 'нужна проверка',
    not_applicable: 'без разбора',
  }[status];
}

function profileError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) {
    return reason.message;
  }
  return 'Не удалось обновить профиль. Повторите действие.';
}
