import type { CandidateAnalysis } from '../evidence/evidenceEngine';

export const CAREER_DIAGNOSTIC_REVISION =
  'career-diagnostic-v1-2026-08-07' as const;

export type DiagnosticDimension =
  | 'readability'
  | 'ats'
  | 'evidence'
  | 'freshness'
  | 'contradictions'
  | 'market';
export type DiagnosticCertainty = 'fact' | 'hypothesis' | 'unknown';
export type DiagnosticStatus = 'strength' | 'issue' | 'unknown';

export interface DiagnosticFinding {
  id: string;
  dimension: DiagnosticDimension;
  certainty: DiagnosticCertainty;
  status: DiagnosticStatus;
  severity: 'info' | 'medium' | 'high';
  title: string;
  explanation: string;
  sourceRefs: string[];
  correction: string;
}

export interface CareerDiagnosticInput {
  resumeText: string;
  resumeSource: 'pdf' | 'linkedin-pdf' | 'hh-pdf' | 'text' | 'conversation';
  sourceUpdatedAt?: string | null;
  targetDirection: string;
  analysis?: CandidateAnalysis;
  marketEvidenceUpdatedAt?: string | null;
}

export interface CareerDiagnostic {
  revision: typeof CAREER_DIAGNOSTIC_REVISION;
  generatedAt: string;
  summary: string;
  coverage: {
    sourceKinds: CareerDiagnosticInput['resumeSource'][];
    isPartial: boolean;
  };
  findings: DiagnosticFinding[];
  nextAction: {
    type: 'question' | 'review' | 'research';
    label: string;
    reason: string;
    findingIds: string[];
  };
}

export function buildCareerDiagnostic(
  input: CareerDiagnosticInput,
  now: string = new Date().toISOString(),
): CareerDiagnostic {
  const findings = [
    readabilityFinding(input),
    atsFinding(input),
    evidenceFinding(input),
    freshnessFinding(input, now),
    contradictionFinding(input),
    marketFinding(input, now),
  ];
  const knownIssues = findings.filter(
    (finding) => finding.status === 'issue' && finding.certainty === 'fact',
  );
  const unknowns = findings.filter(
    (finding) => finding.certainty === 'unknown',
  );
  const isPartial = unknowns.length > 0 || input.resumeSource === 'conversation';

  return {
    revision: CAREER_DIAGNOSTIC_REVISION,
    generatedAt: now,
    summary:
      knownIssues.length > 0
        ? diagnosticIssueSummary(knownIssues.length)
        : isPartial
          ? 'Первичная диагностика готова частично: материал читается, но для карьерного вывода пока не хватает подтверждений.'
          : 'Критичных дефектов в доступных данных не найдено; следующий шаг — проверить соответствие рынку.',
    coverage: {
      sourceKinds: [input.resumeSource],
      isPartial,
    },
    findings,
    nextAction: chooseNextAction(input, findings),
  };
}

function diagnosticIssueSummary(count: number): string {
  if (count === 1) {
    return 'Нашли 1 подтверждённую зону, которая мешает следующему решению. Диагностика частичная: неизвестное показано отдельно.';
  }
  if (count >= 2 && count <= 4) {
    return `Нашли ${count} подтверждённые зоны, которые мешают следующему решению. Диагностика частичная: неизвестное показано отдельно.`;
  }
  return `Нашли ${count} подтверждённых зон, которые мешают следующему решению. Диагностика частичная: неизвестное показано отдельно.`;
}

function readabilityFinding(input: CareerDiagnosticInput): DiagnosticFinding {
  const length = input.resumeText.trim().length;
  if (length >= 400) {
    return finding({
      id: 'readability-text',
      dimension: 'readability',
      certainty: 'fact',
      status: 'strength',
      severity: 'info',
      title: 'Текст источника читается',
      explanation: `Извлечено ${length} знаков; этого достаточно для первичного смыслового разбора.`,
      sourceRefs: ['source:resume-text'],
      correction: 'Проверьте извлечённый текст и исправьте пропуски перед подтверждением фактов.',
    });
  }
  return finding({
    id: 'readability-short',
    dimension: 'readability',
    certainty: 'fact',
    status: 'issue',
    severity: 'high',
    title: 'Материала недостаточно для полного разбора',
    explanation: `Доступно ${length} знаков. Короткий фрагмент может скрывать опыт, даты и результаты.`,
    sourceRefs: ['source:resume-text'],
    correction: 'Добавьте полный PDF, экспорт профиля или продолжите интервью об опыте.',
  });
}

function atsFinding(input: CareerDiagnosticInput): DiagnosticFinding {
  if (input.resumeSource === 'text' || input.resumeSource === 'conversation') {
    return finding({
      id: 'ats-layout-absent',
      dimension: 'ats',
      certainty: 'unknown',
      status: 'unknown',
      severity: 'medium',
      title: 'ATS-совместимость оформления не проверена',
      explanation: 'В источнике нет исходной вёрстки документа, поэтому нельзя проверить порядок блоков, колонки и подписи.',
      sourceRefs: ['source:resume-text'],
      correction: 'Добавьте оригинал PDF или DOCX для проверки структуры и порядка чтения.',
    });
  }
  return finding({
    id: 'ats-layout-pending',
    dimension: 'ats',
    certainty: 'unknown',
    status: 'unknown',
    severity: 'medium',
    title: 'Текст извлечён, но вёрстка ATS ещё не проверена',
    explanation: 'Один извлечённый текст не доказывает, что ATS прочитает колонки, заголовки и даты в правильном порядке.',
    sourceRefs: ['source:resume-text'],
    correction: 'Сопоставьте оригинал PDF с порядком извлечения и исправьте проблемные блоки.',
  });
}

function evidenceFinding(input: CareerDiagnosticInput): DiagnosticFinding {
  if (!input.analysis) {
    return finding({
      id: 'evidence-not-reviewed',
      dimension: 'evidence',
      certainty: 'unknown',
      status: 'unknown',
      severity: 'high',
      title: 'Карьерные утверждения ещё не подтверждены',
      explanation: 'Текст получен, но кандидат ещё не подтвердил задачи, масштаб и результаты.',
      sourceRefs: ['source:resume-text'],
      correction: 'Проверьте предложения по одному: подтвердите, исправьте или отклоните каждое.',
    });
  }
  const confirmed = input.analysis.evidenceItems.filter(
    (item) => item.status === 'confirmed',
  );
  const pending = input.analysis.evidenceItems.filter(
    (item) => item.status === 'pending',
  );
  const confirmedResults = confirmed.filter((item) => item.kind === 'result');
  if (pending.length > 0 || confirmedResults.length === 0) {
    return finding({
      id: 'evidence-result-gap',
      dimension: 'evidence',
      certainty: 'fact',
      status: 'issue',
      severity: 'high',
      title: 'Результаты пока не доказаны',
      explanation: `${confirmed.length} утверждений подтверждено, ${pending.length} ждут проверки; подтверждённых результатов — ${confirmedResults.length}.`,
      sourceRefs: pending.map((item) => `evidence:${item.id}`),
      correction: 'Для одного сильного эпизода уточните контекст, действие, масштаб и наблюдаемый результат.',
    });
  }
  return finding({
    id: 'evidence-confirmed',
    dimension: 'evidence',
    certainty: 'fact',
    status: 'strength',
    severity: 'info',
    title: 'Есть подтверждённый результат',
    explanation: `${confirmedResults.length} результатов подтверждено кандидатом и связано с исходным текстом.`,
    sourceRefs: confirmedResults.map((item) => `evidence:${item.id}`),
    correction: 'При необходимости дополните результат масштабом и способом измерения.',
  });
}

function freshnessFinding(
  input: CareerDiagnosticInput,
  now: string,
): DiagnosticFinding {
  if (!input.sourceUpdatedAt) {
    return finding({
      id: 'freshness-unknown',
      dimension: 'freshness',
      certainty: 'unknown',
      status: 'unknown',
      severity: 'medium',
      title: 'Неизвестно, насколько источник актуален',
      explanation: 'Дата последнего содержательного обновления не указана.',
      sourceRefs: ['source:resume'],
      correction: 'Укажите месяц последнего обновления и добавьте более свежий опыт, если он появился.',
    });
  }
  const months = monthsBetween(input.sourceUpdatedAt, now);
  if (months > 18) {
    return finding({
      id: 'freshness-stale',
      dimension: 'freshness',
      certainty: 'fact',
      status: 'issue',
      severity: 'high',
      title: 'Источник устарел',
      explanation: `С последнего указанного обновления прошло около ${months} месяцев.`,
      sourceRefs: [`source-updated:${input.sourceUpdatedAt}`],
      correction: 'Добавьте текущую роль, последние проекты и один свежий наблюдаемый результат.',
    });
  }
  return finding({
    id: 'freshness-current',
    dimension: 'freshness',
    certainty: 'fact',
    status: 'strength',
    severity: 'info',
    title: 'Источник обновлялся недавно',
    explanation: `С указанного обновления прошло около ${months} месяцев.`,
    sourceRefs: [`source-updated:${input.sourceUpdatedAt}`],
    correction: 'Подтвердите, что после этой даты не было существенных изменений.',
  });
}

function contradictionFinding(
  input: CareerDiagnosticInput,
): DiagnosticFinding {
  return finding({
    id: 'contradictions-single-source',
    dimension: 'contradictions',
    certainty: 'unknown',
    status: 'unknown',
    severity: 'medium',
    title: 'Расхождения между источниками не проверены',
    explanation: `Сейчас доступен один источник типа «${input.resumeSource}»; сравнить даты, должности и формулировки не с чем.`,
    sourceRefs: ['source:resume'],
    correction: 'Добавьте второй источник или подтвердите ключевые даты и должности в диалоге.',
  });
}

function marketFinding(
  input: CareerDiagnosticInput,
  now: string,
): DiagnosticFinding {
  if (!input.marketEvidenceUpdatedAt) {
    return finding({
      id: 'market-not-observed',
      dimension: 'market',
      certainty: 'unknown',
      status: 'unknown',
      severity: 'high',
      title: 'Спрос на целевое направление ещё не проверен',
      explanation: input.targetDirection.trim()
        ? `Для «${input.targetDirection.trim()}» нет датированной выборки вакансий и требований.`
        : 'Целевое направление не выбрано, поэтому рыночное сравнение преждевременно.',
      sourceRefs: [],
      correction: 'Соберите датированную выборку вакансий по 1–3 гипотезам роли и выбранной географии.',
    });
  }
  const months = monthsBetween(input.marketEvidenceUpdatedAt, now);
  return finding({
    id: 'market-observed',
    dimension: 'market',
    certainty: months <= 3 ? 'fact' : 'hypothesis',
    status: months <= 3 ? 'strength' : 'issue',
    severity: months <= 3 ? 'info' : 'medium',
    title: months <= 3 ? 'Есть свежая рыночная выборка' : 'Рыночную выборку нужно обновить',
    explanation: `Последнее наблюдение рынка сделано около ${months} месяцев назад.`,
    sourceRefs: [`market-observed:${input.marketEvidenceUpdatedAt}`],
    correction: 'Повторите сбор вакансий и сравните изменение требований и частоты ролей.',
  });
}

function chooseNextAction(
  input: CareerDiagnosticInput,
  findings: DiagnosticFinding[],
): CareerDiagnostic['nextAction'] {
  if (input.resumeSource === 'conversation' && !input.targetDirection.trim()) {
    return {
      type: 'question',
      label: 'Какую работу вы хотите получить и что в ней для вас важно?',
      reason:
        'Без исходного документа и карьерной цели сначала нужна одна развилка, которая определит дальнейший разбор.',
      findingIds: ['readability-short', 'market-not-observed'],
    };
  }
  const issue = findings.find(
    (finding) => finding.status === 'issue' && finding.severity === 'high',
  );
  if (issue) {
    return {
      type: issue.dimension === 'market' ? 'research' : 'review',
      label: issue.correction,
      reason: `Сначала закрываем «${issue.title.toLowerCase()}»: это самый сильный подтверждённый риск в текущих данных.`,
      findingIds: [issue.id],
    };
  }
  const unknownPriority: DiagnosticDimension[] = [
    'evidence',
    'market',
    'freshness',
    'contradictions',
    'ats',
    'readability',
  ];
  const unknown = unknownPriority
    .map((dimension) =>
      findings.find(
        (finding) =>
          finding.dimension === dimension && finding.certainty === 'unknown',
      ),
    )
    .find((finding): finding is DiagnosticFinding => Boolean(finding));
  return {
    type: 'question',
    label:
      unknown?.correction ??
      (input.targetDirection.trim()
        ? 'Подтвердите, что выбранное направление остаётся актуальным.'
        : 'Какую работу вы хотите получить и почему именно её?'),
    reason: unknown
      ? `Этот ответ быстрее всего уменьшит неизвестность в блоке «${unknown.title.toLowerCase()}».`
      : 'Нужна следующая проверяемая развилка, а не ещё одна общая рекомендация.',
    findingIds: unknown ? [unknown.id] : [],
  };
}

function finding(input: DiagnosticFinding): DiagnosticFinding {
  return input;
}

function monthsBetween(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return 0;
  return Math.max(
    0,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      end.getUTCMonth() -
      start.getUTCMonth(),
  );
}
