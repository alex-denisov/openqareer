import type { EvidenceItem } from '../evidence/evidenceEngine';
import type {
  OpportunityChoice,
  OpportunityRecord,
} from '../opportunity/opportunityEngine';

export const ACTION_PACKAGE_METHOD_VERSION = 'action-package-local-v1';

export interface ActionPackageCitation {
  evidenceId: string;
  statement: string;
  sourceExcerpt: string;
  opportunityItemIds: string[];
}

export interface ActionPackage {
  id: string;
  methodVersion: typeof ACTION_PACKAGE_METHOD_VERSION;
  opportunityId: string;
  decisionChoice: Extract<OpportunityChoice, 'apply' | 'network'>;
  roleTitle: string;
  company: string;
  sourceUrl?: string;
  positioningLine: string;
  motivationNote: string;
  selectedEvidenceIds: string[];
  citations: ActionPackageCitation[];
  completedChecklistIds: string[];
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface ActionChecklistItem {
  id: string;
  label: string;
  detail: string;
}

const CHECKLISTS: Record<
  ActionPackage['decisionChoice'],
  ActionChecklistItem[]
> = {
  apply: [
    {
      id: 'review-facts',
      label: 'Проверить все факты',
      detail: 'Каждый тезис ниже должен оставаться точным и актуальным.',
    },
    {
      id: 'confirm-conditions',
      label: 'Уточнить неизвестные условия',
      detail: 'Компенсация, формат работы и актуальность вакансии.',
    },
    {
      id: 'attach-resume',
      label: 'Приложить резюме',
      detail: 'Используйте исходный PDF; этот пакет подсказывает акценты.',
    },
    {
      id: 'send-native',
      label: 'Отправить на площадке',
      detail: 'Финальное действие выполняется в официальном интерфейсе.',
    },
  ],
  network: [
    {
      id: 'review-facts',
      label: 'Проверить все факты',
      detail: 'Оставьте только то, что готовы подтвердить в разговоре.',
    },
    {
      id: 'find-context',
      label: 'Выбрать адресата',
      detail: 'Найдите человека, связанного с командой или задачей роли.',
    },
    {
      id: 'personalize-opening',
      label: 'Добавить причину контакта',
      detail: 'Одно конкретное предложение лучше общей просьбы о помощи.',
    },
    {
      id: 'send-native',
      label: 'Написать на площадке',
      detail: 'Отправка остаётся под вашим контролем.',
    },
  ],
};

export function createActionPackage(
  opportunity: OpportunityRecord,
  evidence: EvidenceItem[],
  targetDirection: string,
  now: string = new Date().toISOString(),
): ActionPackage {
  const decisionChoice = opportunity.decision?.choice;
  if (decisionChoice !== 'apply' && decisionChoice !== 'network') {
    throw new Error(
      'Пакет доступен после решения «Откликаться» или «Сначала контакт».',
    );
  }

  const confirmed = evidence.filter((item) => item.status === 'confirmed');
  const matchedIds = new Set(
    opportunity.analysis?.matches.flatMap((match) => match.evidenceIds) ?? [],
  );
  const relevant = confirmed.filter((item) => matchedIds.has(item.id));
  const selected = (relevant.length > 0 ? relevant : confirmed).slice(0, 5);

  return {
    id: `action-${opportunity.id}`,
    methodVersion: ACTION_PACKAGE_METHOD_VERSION,
    opportunityId: opportunity.id,
    decisionChoice,
    roleTitle: opportunity.title,
    company: opportunity.company,
    sourceUrl: opportunity.sourceUrl,
    positioningLine: buildPositioningLine(
      targetDirection,
      opportunity.title,
    ),
    motivationNote: '',
    selectedEvidenceIds: selected.map((item) => item.id),
    citations: confirmed.map((item) =>
      buildCitation(opportunity, item),
    ),
    completedChecklistIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateActionPackage(
  actionPackage: ActionPackage,
  update: Partial<
    Pick<
      ActionPackage,
      | 'positioningLine'
      | 'motivationNote'
      | 'selectedEvidenceIds'
      | 'completedChecklistIds'
      | 'reviewedAt'
    >
  >,
  now: string = new Date().toISOString(),
): ActionPackage {
  const allowedEvidenceIds = new Set(
    actionPackage.citations.map((citation) => citation.evidenceId),
  );
  const checklistIds = new Set(
    getActionChecklist(actionPackage.decisionChoice).map((item) => item.id),
  );

  return {
    ...actionPackage,
    ...update,
    positioningLine:
      update.positioningLine?.slice(0, 140) ??
      actionPackage.positioningLine,
    motivationNote:
      update.motivationNote?.slice(0, 360) ??
      actionPackage.motivationNote,
    selectedEvidenceIds:
      update.selectedEvidenceIds?.filter((id) => allowedEvidenceIds.has(id)) ??
      actionPackage.selectedEvidenceIds,
    completedChecklistIds:
      update.completedChecklistIds?.filter((id) => checklistIds.has(id)) ??
      actionPackage.completedChecklistIds,
    updatedAt: now,
  };
}

export function getActionChecklist(
  decisionChoice: ActionPackage['decisionChoice'],
): ActionChecklistItem[] {
  return CHECKLISTS[decisionChoice];
}

export function composeResumeMarkdown(actionPackage: ActionPackage): string {
  const selected = getSelectedCitations(actionPackage);
  const evidenceLines =
    selected.length > 0
      ? selected.map((item) => `- ${item.statement}`).join('\n')
      : '- [Выберите хотя бы один подтверждённый факт]';

  return [
    `# ${actionPackage.roleTitle}`,
    '',
    actionPackage.positioningLine.trim(),
    '',
    '## Релевантный опыт',
    '',
    evidenceLines,
    '',
    '## Проверить перед отправкой',
    '',
    '- Даты, должности и контакты остаются в исходном резюме.',
    '- Формулировки выше собраны только из подтверждённых фактов.',
  ].join('\n');
}

export function composeMessage(actionPackage: ActionPackage): string {
  const selected = getSelectedCitations(actionPackage).slice(0, 3);
  const companySuffix = actionPackage.company
    ? ` в ${actionPackage.company}`
    : '';
  const opening =
    actionPackage.decisionChoice === 'apply'
      ? `Откликаюсь на роль «${actionPackage.roleTitle}»${companySuffix}.`
      : `Изучаю роль «${actionPackage.roleTitle}»${companySuffix} и хочу уточнить контекст задач.`;
  const evidenceBlock =
    selected.length > 0
      ? [
          'Из релевантного подтверждённого опыта:',
          ...selected.map((item) => `— ${item.statement}`),
        ]
      : ['Пока не выбраны подтверждённые факты для сообщения.'];
  const closing =
    actionPackage.decisionChoice === 'apply'
      ? 'Предлагаю обсудить задачи и взаимное соответствие.'
      : 'Если уместно, будет полезен короткий обмен контекстом.';

  return [
    'Здравствуйте!',
    '',
    opening,
    ...(actionPackage.motivationNote.trim()
      ? ['', actionPackage.motivationNote.trim()]
      : []),
    '',
    ...evidenceBlock,
    '',
    closing,
  ].join('\n');
}

export function composeActionPackageMarkdown(
  actionPackage: ActionPackage,
): string {
  const checklist = getActionChecklist(actionPackage.decisionChoice);
  const completed = new Set(actionPackage.completedChecklistIds);
  const citations = getSelectedCitations(actionPackage);

  return [
    composeResumeMarkdown(actionPackage),
    '',
    '---',
    '',
    '# Сообщение',
    '',
    composeMessage(actionPackage),
    '',
    '---',
    '',
    '# Источники фактов',
    '',
    ...(citations.length > 0
      ? citations.flatMap((citation) => [
          `- ${citation.statement}`,
          `  - Источник: ${citation.sourceExcerpt}`,
        ])
      : ['- Подтверждённые факты не выбраны.']),
    '',
    '# Чек-лист',
    '',
    ...checklist.map(
      (item) => `- [${completed.has(item.id) ? 'x' : ' '}] ${item.label}`,
    ),
  ].join('\n');
}

export function getActionPackageIssues(
  actionPackage: ActionPackage,
): string[] {
  const issues: string[] = [];
  if (actionPackage.selectedEvidenceIds.length === 0) {
    issues.push('Выберите хотя бы один подтверждённый факт.');
  }
  if (actionPackage.positioningLine.trim().length < 12) {
    issues.push('Уточните строку позиционирования.');
  }
  if (!actionPackage.motivationNote.trim()) {
    issues.push('Добавьте личную причину интереса к роли.');
  }
  return issues;
}

function buildPositioningLine(
  targetDirection: string,
  roleTitle: string,
): string {
  const target = targetDirection.trim();
  return target.toLocaleLowerCase('ru-RU') ===
    roleTitle.trim().toLocaleLowerCase('ru-RU')
    ? `Фокус: ${roleTitle.trim()}`
    : `${target} — релевантный опыт для роли «${roleTitle.trim()}»`;
}

function buildCitation(
  opportunity: OpportunityRecord,
  evidence: EvidenceItem,
): ActionPackageCitation {
  return {
    evidenceId: evidence.id,
    statement: evidence.statement,
    sourceExcerpt: evidence.sourceExcerpt,
    opportunityItemIds:
      opportunity.analysis?.matches
        .filter((match) => match.evidenceIds.includes(evidence.id))
        .map((match) => match.opportunityItemId) ?? [],
  };
}

function getSelectedCitations(
  actionPackage: ActionPackage,
): ActionPackageCitation[] {
  const selected = new Set(actionPackage.selectedEvidenceIds);
  return actionPackage.citations.filter((item) =>
    selected.has(item.evidenceId),
  );
}
