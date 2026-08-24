import { useRef, useState } from 'react';
import {
  Check,
  DownloadSimple,
  FileArrowUp,
  FilePdf,
  FileText,
  MapPin,
  Trash,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import {
  changeMemory,
  reviewMemories,
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

type ProfileTab = 'summary' | 'experience' | 'skills' | 'education' | 'documents';

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
}

const profileTabs: Array<{ id: ProfileTab; label: string }> = [
  { id: 'summary', label: 'Сводка' },
  { id: 'experience', label: 'Опыт' },
  { id: 'skills', label: 'Навыки' },
  { id: 'education', label: 'Образование и курсы' },
  { id: 'documents', label: 'Документы' },
];

// Profile state remains co-located so file, memory, and tab feedback cannot diverge.
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
}: CareerProfileSurfaceProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>('summary');
  const [busyId, setBusyId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const name = account?.displayName ?? session.displayName ?? account?.username ?? session.username;
  const facts = snapshot?.memory ?? [];

  async function reviewMemory(memoryId: string, action: 'confirm' | 'delete') {
    setBusyId(memoryId);
    setError(undefined);
    try {
      await changeMemory(memoryId, { action });
      await onRefresh();
    } catch (reason) {
      setError(profileError(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  /**
   * An import states dozens of facts at once. Reviewing them one by one is a
   * review nobody finishes, so the queue offers the batch decision the
   * candidate actually wants to make (B166).
   */
  async function reviewAllMemories(memoryIds: readonly string[]) {
    setBusyId(REVIEW_ALL);
    setError(undefined);
    try {
      const reviewed = await reviewMemories(memoryIds, 'confirm');
      setNotice(`Подтверждено ${reviewed} ${factNoun(reviewed)}.`);
      await onRefresh();
    } catch (reason) {
      setError(profileError(reason));
    } finally {
      setBusyId(undefined);
    }
  }

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
      if (file.size > 5 * 1_024 * 1_024) {
        throw new Error('Файл больше 5 МБ. Сохраните более компактную копию.');
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
                  market: 'ru',
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
      setActiveTab('documents');
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
          <span className="career-cabinet-kicker">Профиль и документы</span>
          <h1 id="career-profile-surface-title">{name}</h1>
          <p>
            {account?.profile.headline ??
              workspace?.targetDirection ??
              'Карьерное направление уточняется'}
          </p>
          <div>
            <span>
              <MapPin size={14} /> {account?.profile.location ?? 'Локация не указана'}
            </span>
            <span>
              <UserCircle size={14} /> {workModeLabel(account?.profile.workMode)}
            </span>
          </div>
        </div>
        <div className="career-profile-update-state">
          <span>{evidenceSummary(snapshot)}</span>
          <small>{lastChangeLabel(account, snapshot)}</small>
          <button type="button" onClick={onOpenAccount}>
            Изменить данные
          </button>
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
            {tab.id === 'documents' && snapshot?.documents.length
              ? ` ${snapshot.documents.length}`
              : ''}
          </button>
        ))}
      </nav>

      <div className="career-profile-surface-body">
        {loading && !snapshot ? (
          <p className="career-cabinet-loading">Собираем подтверждённые данные…</p>
        ) : null}
        {activeTab === 'summary' ? (
          <ProfileSummary
            snapshot={snapshot}
            busyId={busyId}
            onReview={reviewMemory}
            onReviewAll={reviewAllMemories}
          />
        ) : null}
        {activeTab === 'experience' ? (
          <ProfileFacts
            title="Опыт и результаты"
            empty="Подтверждённые эпизоды опыта появятся после разговора или импорта резюме."
            facts={facts.filter((item) =>
              ['responsibility', 'outcome', 'role-evidence'].includes(item.domain),
            )}
            busyId={busyId}
            onReview={reviewMemory}
          />
        ) : null}
        {activeTab === 'skills' ? (
          <ProfileFacts
            title="Навыки и рабочие сигналы"
            empty="Навыки ещё не подтверждены источником или в разговоре."
            facts={facts.filter((item) => item.domain === 'skill')}
            busyId={busyId}
            onReview={reviewMemory}
          />
        ) : null}
        {activeTab === 'education' ? (
          <ProfileFacts
            title="Образование, курсы и сертификаты"
            empty="Сведения об образовании и курсах появятся после импорта резюме или разговора."
            facts={facts.filter(
              (item) =>
                ['role-evidence', 'other'].includes(item.domain) ||
                /образован|университет|институт|диплом|курс|сертификат|степень|бакалавр|магистр|ielts|toefl|gmat|mba/iu.test(
                  item.statement,
                ),
            )}
            busyId={busyId}
            onReview={reviewMemory}
          />
        ) : null}
        {activeTab === 'documents' ? (
          <DocumentVault
            documents={snapshot?.documents ?? []}
            busyId={busyId}
            uploading={uploading}
            onUpload={uploadFile}
            onDownload={downloadDocument}
            onDelete={removeDocument}
          />
        ) : null}
      </div>

      {notice ? (
        <p className="career-cabinet-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="career-expert-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Everything an import left for the candidate to decide. It is exported so the
 * queue can be proven on its own: a queue that shows four of thirty-two facts
 * is not a review the candidate can finish (B166).
 */
// eslint-disable-next-line max-lines-per-function
export function ProfileReviewQueue({
  proposedFacts,
  openQuestions,
  busyId,
  onReview,
  onReviewAll,
}: {
  proposedFacts: CandidateSnapshot['memory'];
  openQuestions: CandidateSnapshot['memory'];
  busyId?: string;
  onReview: (memoryId: string, action: 'confirm' | 'delete') => Promise<void>;
  onReviewAll: (memoryIds: readonly string[]) => Promise<void>;
}) {
  return (
    <aside className="career-profile-review-queue">
      <header>
        <span>Нужно проверить</span>
        <strong>{proposedFacts.length}</strong>
      </header>
      {proposedFacts.length > 1 ? (
        <button
          type="button"
          className="career-profile-review-all"
          disabled={busyId === REVIEW_ALL}
          onClick={() => void onReviewAll(proposedFacts.map((item) => item.id))}
        >
          <Check size={15} />
          {busyId === REVIEW_ALL
            ? 'Подтверждаем…'
            : `Подтвердить все — ${proposedFacts.length} ${factNoun(proposedFacts.length)}`}
        </button>
      ) : null}
      {proposedFacts.length ? (
        <div className="career-profile-review-list">
          {proposedFacts.map((item) => (
            <article key={item.id}>
              <p>{item.statement}</p>
              <small>{memorySourceLabel(item.sourceMessageIds)}</small>
              <div>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void onReview(item.id, 'confirm')}
                >
                  <Check size={15} /> Подтвердить
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void onReview(item.id, 'delete')}
                  aria-label="Не учитывать факт"
                >
                  <X size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p>
          {openQuestions.length
            ? 'Фактических выводов на проверке нет.'
            : 'Все текущие выводы уже проверены кандидатом.'}
        </p>
      )}
      {openQuestions.length ? (
        <section className="career-profile-open-questions">
          <strong>Открытые вопросы</strong>
          {openQuestions.slice(0, 3).map((item) => (
            <article key={item.id}>
              <p>{item.statement}</p>
              <small>Уточнение из диалога · {memorySourceLabel(item.sourceMessageIds)}</small>
            </article>
          ))}
        </section>
      ) : null}
    </aside>
  );
}

function ProfileSummary({
  snapshot,
  busyId,
  onReview,
  onReviewAll,
}: {
  snapshot?: CandidateSnapshot;
  busyId?: string;
  onReview: (memoryId: string, action: 'confirm' | 'delete') => Promise<void>;
  onReviewAll: (memoryIds: readonly string[]) => Promise<void>;
}) {
  const facts = snapshot?.memory ?? [];
  const { confirmedFacts, proposedFacts, openQuestions } = partitionProfileMemory(facts);
  return (
    <div className="career-profile-summary-grid">
      <ProfileFacts
        title="Опорные факты"
        empty="Пока нет подтверждённых фактов. Стратег начнёт с одного карьерного эпизода."
        facts={confirmedFacts.slice(0, 8)}
        busyId={busyId}
        onReview={onReview}
      />
      <ProfileReviewQueue
        proposedFacts={proposedFacts}
        openQuestions={openQuestions}
        busyId={busyId}
        onReview={onReview}
        onReviewAll={onReviewAll}
      />
    </div>
  );
}

const REVIEW_ALL = 'review-all';

export function partitionProfileMemory(memory: CandidateSnapshot['memory']) {
  const factual = memory.filter((item) => item.kind !== 'open-question');
  return {
    confirmedFacts: factual.filter((item) => item.status !== 'proposed'),
    proposedFacts: factual.filter((item) => item.status === 'proposed'),
    openQuestions: memory.filter((item) => item.kind === 'open-question'),
  };
}

// eslint-disable-next-line max-lines-per-function
function ProfileFacts({
  title,
  empty,
  facts,
  busyId,
  onReview,
}: {
  title: string;
  empty: string;
  facts: CandidateSnapshot['memory'];
  busyId?: string;
  onReview: (memoryId: string, action: 'confirm' | 'delete') => Promise<void>;
}) {
  return (
    <section className="career-profile-facts">
      <header>
        <h2>{title}</h2>
        <span>
          {facts.length} {factNoun(facts.length)}
        </span>
      </header>
      {facts.length ? (
        <div>
          {facts.map((item) => (
            <article key={item.id}>
              <span className={`career-memory-status is-${item.status}`}>
                {memoryStatusLabel(item.status)}
              </span>
              <p>{item.statement}</p>
              <footer>
                <small>
                  {memoryDomainLabel(item.domain)} · {memorySourceLabel(item.sourceMessageIds)}
                </small>
                {item.status === 'proposed' ? (
                  <div>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void onReview(item.id, 'confirm')}
                    >
                      Подтвердить
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void onReview(item.id, 'delete')}
                    >
                      Не учитывать
                    </button>
                  </div>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <p className="career-profile-empty">{empty}</p>
      )}
    </section>
  );
}

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
            <small>PDF, DOCX, TXT или JSON · до 5 МБ</small>
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

/**
 * The header used to claim «Профиль синхронизирован» next to a date that was
 * really the account's last edit — a sync that does not exist, dated two days
 * before an import that had just happened (B148 §6). It now states what the
 * profile actually holds and when it last changed.
 */
function evidenceSummary(snapshot?: CandidateSnapshot): string {
  const confirmed = snapshot?.dossier.confirmedCount ?? 0;
  const proposed = snapshot?.dossier.proposedCount ?? 0;
  if (confirmed === 0 && proposed === 0) return 'Фактов пока нет';
  const parts = [`${confirmed} подтверждено`];
  if (proposed > 0) parts.push(`${proposed} на проверке`);
  return parts.join(' · ');
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

function memoryDomainLabel(domain: CandidateSnapshot['memory'][number]['domain']) {
  return {
    responsibility: 'Ответственность',
    outcome: 'Результат',
    skill: 'Навык',
    preference: 'Предпочтение',
    constraint: 'Ограничение',
    gap: 'Пробел',
    'role-evidence': 'Сигнал роли',
    other: 'Контекст',
  }[domain];
}

function memoryStatusLabel(status: CandidateSnapshot['memory'][number]['status']) {
  return status === 'proposed'
    ? 'На проверке'
    : status === 'corrected'
      ? 'Исправлено'
      : 'Подтверждено';
}

function memorySourceLabel(sourceIds: string[]) {
  if (!sourceIds.length) return 'Источник не указан';
  return `${sourceIds.length} ${sourceIds.length === 1 ? 'источник' : 'источника'}`;
}

function factNoun(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod10 === 1 && mod100 !== 11) return 'факт';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'факта';
  return 'фактов';
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
