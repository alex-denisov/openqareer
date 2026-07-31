import {
  DOSSIER_DOMAINS,
  type MemoryCandidate,
} from './coach';

type MemoryStatus = 'proposed' | 'confirmed' | 'corrected';

interface DossierMemory extends MemoryCandidate {
  id: string;
  status: MemoryStatus;
}

export interface DossierItem {
  memoryId: string;
  statement: string;
  status: MemoryStatus;
  sourceMessageIds: string[];
  sensitive: boolean;
}

export interface ExperienceDossier {
  sections: Array<{
    domain: (typeof DOSSIER_DOMAINS)[number];
    items: DossierItem[];
  }>;
  confirmedCount: number;
  proposedCount: number;
  readiness: {
    complete: boolean;
    unresolvedQuestions: number;
    checks: Array<{
      id: 'experience' | 'impact' | 'capability' | 'direction' | 'unknowns';
      complete: boolean;
      evidenceCount: number;
    }>;
  };
}

export function buildExperienceDossier(
  memory: DossierMemory[],
): ExperienceDossier {
  const confirmed = memory.filter(
    (item) => item.status === 'confirmed' || item.status === 'corrected',
  );
  const countConfirmed = (
    domains: Array<DossierMemory['domain']>,
  ): number => confirmed.filter((item) => domains.includes(item.domain)).length;
  const unresolvedQuestions = memory.filter(
    (item) => item.kind === 'open-question' && item.status === 'proposed',
  ).length;
  const checks: ExperienceDossier['readiness']['checks'] = [
    readinessCheck('experience', countConfirmed(['responsibility'])),
    readinessCheck('impact', countConfirmed(['outcome'])),
    readinessCheck(
      'capability',
      countConfirmed(['skill', 'role-evidence']),
    ),
    readinessCheck('direction', countConfirmed(['preference'])),
    {
      id: 'unknowns',
      evidenceCount: unresolvedQuestions,
      complete: unresolvedQuestions === 0,
    },
  ];

  return {
    sections: DOSSIER_DOMAINS.map((domain) => ({
      domain,
      items: memory
        .filter((item) => item.domain === domain)
        .map((item) => ({
          memoryId: item.id,
          statement: item.statement,
          status: item.status,
          sourceMessageIds: item.sourceMessageIds,
          sensitive: item.sensitive,
        })),
    })).filter((section) => section.items.length > 0),
    confirmedCount: confirmed.length,
    proposedCount: memory.length - confirmed.length,
    readiness: {
      complete: checks.every((check) => check.complete),
      unresolvedQuestions,
      checks,
    },
  };
}

function readinessCheck(
  id: 'experience' | 'impact' | 'capability' | 'direction',
  evidenceCount: number,
): ExperienceDossier['readiness']['checks'][number] {
  return {
    id,
    evidenceCount,
    complete: evidenceCount > 0,
  };
}
