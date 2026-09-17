import { randomUUID } from 'node:crypto';
import type {
  CandidateReputationAudit,
  ConsistencyDiscrepancy,
  ReputationOverallStatus,
  ReputationRiskItem,
} from '../../shared/candidateReputation';

export interface CandidateExperienceItem {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  current?: boolean;
}

export interface ExternalSourceProfile {
  platform: string;
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  current?: boolean;
}

export interface PublicPostItem {
  id: string;
  sourcePlatform: string;
  sourceUrl?: string;
  publishedAt?: string;
  content: string;
}

export interface AuditExecutionInput {
  candidateId: string;
  experience?: CandidateExperienceItem[];
  externalProfiles?: ExternalSourceProfile[];
  publicPosts?: PublicPostItem[];
}

function parseMonth(val?: string): number | null {
  if (!val) return null;
  const match = /^(\d{4})(?:-(\d{1,2}))?/.exec(val.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  return year * 12 + month;
}

function checkCompanyDiscrepancies(
  exp: CandidateExperienceItem,
  ext: ExternalSourceProfile,
): ConsistencyDiscrepancy[] {
  const result: ConsistencyDiscrepancy[] = [];
  const candEnd = parseMonth(exp.endDate);
  const extEnd = parseMonth(ext.endDate);
  if (candEnd !== null && extEnd !== null && Math.abs(candEnd - extEnd) > 6) {
    result.push({
      id: randomUUID(),
      field: `Дата окончания: ${exp.company}`,
      candidateValue: exp.endDate ?? '',
      externalValue: ext.endDate ?? '',
      externalSource: ext.platform,
      severity: 'warning',
      suggestion: `Синхронизировать дату окончания работы в ${ext.platform} с основным резюме`,
    });
  }
  if (isRoleGradeDiscrepancy(exp.role, ext.role)) {
    result.push({
      id: randomUUID(),
      field: `Должность и грейд: ${exp.company}`,
      candidateValue: exp.role,
      externalValue: ext.role,
      externalSource: ext.platform,
      severity: 'critical',
      suggestion: `Уточнить формулировку должности и грейда в профиле ${ext.platform}`,
    });
  }
  return result;
}

function isRoleGradeDiscrepancy(role1: string, role2: string): boolean {
  const r1 = role1.toLowerCase();
  const r2 = role2.toLowerCase();
  const isLead1 = /lead|principal|руководитель|тимлид/i.test(r1);
  const isJunior2 = /junior|intern|стаж[её]р|младший/i.test(r2);
  const isLead2 = /lead|principal|руководитель|тимлид/i.test(r2);
  const isJunior1 = /junior|intern|стаж[её]р|младший/i.test(r1);
  return (isLead1 && isJunior2) || (isJunior1 && isLead2);
}

function checkCareerGapsAndOverlaps(
  sorted: CandidateExperienceItem[],
): ConsistencyDiscrepancy[] {
  const result: ConsistencyDiscrepancy[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const curEnd = parseMonth(current.endDate);
    const nextStart = parseMonth(next.startDate);
    if (curEnd === null || nextStart === null) continue;

    if (nextStart - curEnd > 6) {
      result.push({
        id: randomUUID(),
        field: `Разрыв в стаже: ${current.company} -> ${next.company}`,
        candidateValue: `${current.endDate} - ${next.startDate}`,
        externalValue: 'Перерыв более 6 месяцев',
        externalSource: 'История опыта',
        severity: 'warning',
        suggestion: 'Добавить пояснение о перерыве в работе (обучение, саббатикал, пет-проекты)',
      });
    } else if (curEnd - nextStart > 3) {
      result.push({
        id: randomUUID(),
        field: `Параллельная занятость: ${current.company} и ${next.company}`,
        candidateValue: `Наложение с ${next.startDate} по ${current.endDate}`,
        externalValue: 'Параллельные роли',
        externalSource: 'История опыта',
        severity: 'warning',
        suggestion: 'Указать формат занятости (совместительство, парт-тайм, консультации)',
      });
    }
  }
  return result;
}

export function checkCrossSourceConsistency(
  candidateExp: CandidateExperienceItem[],
  externalProfiles: ExternalSourceProfile[],
): ConsistencyDiscrepancy[] {
  const discrepancies: ConsistencyDiscrepancy[] = [];
  for (const exp of candidateExp) {
    const matching = externalProfiles.filter(
      (ext) => ext.company.toLowerCase().trim() === exp.company.toLowerCase().trim(),
    );
    for (const ext of matching) {
      discrepancies.push(...checkCompanyDiscrepancies(exp, ext));
    }
  }
  const validExp = candidateExp.filter((e) => parseMonth(e.startDate) !== null);
  const sorted = [...validExp].sort(
    (a, b) => (parseMonth(a.startDate) ?? 0) - (parseMonth(b.startDate) ?? 0),
  );
  discrepancies.push(...checkCareerGapsAndOverlaps(sorted));
  return discrepancies;
}

interface RiskPattern {
  category: ReputationRiskItem['category'];
  severity: ReputationRiskItem['severity'];
  regex: RegExp;
  remediation: string;
}

const RISK_PATTERNS: readonly RiskPattern[] = [
  {
    category: 'toxic_workplace',
    severity: 'high',
    regex: /кидал[ыа]|самодур|шарашкин|не\s*выплатил|ублюдк|гнилая\s*контор|токсичн.*руководств/i,
    remediation: 'Удалить или скрыть эмоциональную публикацию о бывшем работодателе',
  },
  {
    category: 'nda_leak',
    severity: 'high',
    regex: /слив\s*метрик|внутренн.*дашборд|под\s*nda|секретн.*ключ|конфиденциальн.*данн|закрыт.*код/i,
    remediation: 'Немедленно удалить конфиденциальные корпоративные данные и скриншоты',
  },
  {
    category: 'compliance_conflict',
    severity: 'high',
    regex: /взятк[аи]|откат[ыа]|конкурент.*втайне|обход.*безопасност/i,
    remediation: 'Удалить публикацию, создающую юридические и комплаенс риски',
  },
  {
    category: 'polarizing_argument',
    severity: 'medium',
    regex: /идиот[ыа]|урод[ыа]|сдохните|мраз[иь]/i,
    remediation: 'Удалить агрессивные и токсичные высказывания',
  },
];

export function classifyReputationRisks(posts: PublicPostItem[]): ReputationRiskItem[] {
  const risks: ReputationRiskItem[] = [];
  for (const post of posts) {
    for (const pattern of RISK_PATTERNS) {
      if (pattern.regex.test(post.content)) {
        risks.push({
          id: randomUUID(),
          sourceUrl: post.sourceUrl,
          sourcePlatform: post.sourcePlatform,
          publishedAt: post.publishedAt,
          excerpt: post.content.slice(0, 140),
          category: pattern.category,
          severity: pattern.severity,
          remediation: pattern.remediation,
        });
      }
    }
  }
  return risks;
}

export function calculateReputationScore(
  discrepancies: ConsistencyDiscrepancy[],
  risks: ReputationRiskItem[],
): { score: number; overallStatus: ReputationOverallStatus } {
  let score = 100;
  for (const d of discrepancies) {
    score -= d.severity === 'critical' ? 20 : 10;
  }
  for (const r of risks) {
    if (r.severity === 'high') score -= 25;
    else if (r.severity === 'medium') score -= 15;
    else score -= 5;
  }
  score = Math.max(0, Math.min(100, score));

  const hasHighNdaOrCompliance = risks.some(
    (r) => (r.category === 'nda_leak' || r.category === 'compliance_conflict') && r.severity === 'high',
  );

  let overallStatus: ReputationOverallStatus = 'safe';
  if (score < 60 || hasHighNdaOrCompliance) {
    overallStatus = 'critical_risk';
  } else if (score < 85 || discrepancies.length > 0 || risks.length > 0) {
    overallStatus = 'attention';
  }
  return { score, overallStatus };
}

export function performCandidateReputationAudit(
  input: AuditExecutionInput,
): CandidateReputationAudit {
  const startedAt = new Date().toISOString();
  const discrepancies = checkCrossSourceConsistency(
    input.experience ?? [],
    input.externalProfiles ?? [],
  );
  const risks = classifyReputationRisks(input.publicPosts ?? []);
  const { score, overallStatus } = calculateReputationScore(discrepancies, risks);
  const completedAt = new Date().toISOString();

  return {
    id: randomUUID(),
    candidateId: input.candidateId,
    status: 'completed',
    overallStatus,
    score,
    consistencyDiscrepancies: discrepancies,
    reputationRisks: risks,
    consentAction: 'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
    startedAt,
    completedAt,
  };
}
