/**
 * B786 (k06): кандидат просит поправить формулировку опыта, а новых фактов для места нет. Консультант
 * переписывает первую строку места: «Было» — строка из резюме, «Станет» — новая формулировка. Числа,
 * проценты и названия — только из этой строки и подтверждённых фактов беседы о месте; ничего сверх них.
 */
import type { VariantWish } from '../../shared/textVariants';
import {
  buildFactRewriteRequest,
  type FactRewriteProposal,
  type RewriteFact,
  type RewriteMemory,
} from './experienceFactRewrite';
import type { FactRewriteVariantRequest } from './factRewriteVariant';
import type { ResumeDraft } from './resumeDraft';
import { nameMatches } from './resumeEditRequest';
import { wishInstruction } from './textVariants';

const CONVERSATION_ORIGINS = new Set(['candidate', 'consultant']);
const MAX_PLACE_FACTS = 12;

export interface RewordTarget {
  readonly experienceId: string;
  /** Строка из резюме, которую заменит правка. */
  readonly memoryId: string;
  readonly current: string;
  readonly place: FactRewriteVariantRequest['place'];
  /** Сама строка и подтверждённые факты беседы о месте: из них берутся числа и названия. */
  readonly facts: readonly RewriteFact[];
}

interface SensitiveMemory extends RewriteMemory {
  readonly sensitive?: boolean;
}

function placeFacts(
  memory: readonly SensitiveMemory[],
  employer: string,
  except: string,
): RewriteFact[] {
  return memory
    .filter(
      (item) =>
        item.id !== except &&
        item.kind === 'fact' &&
        item.sensitive !== true &&
        (item.status === 'confirmed' || item.status === 'corrected') &&
        CONVERSATION_ORIGINS.has(item.provenance?.kind ?? '') &&
        nameMatches(employer, item.statement),
    )
    .slice(0, MAX_PLACE_FACTS)
    .map(({ id, domain, statement }) => ({ id, domain, statement }));
}

/** Первая строка места и факты о нём; `null` — места или строк в нём нет. */
export function rewordTarget(
  draft: ResumeDraft,
  memory: readonly SensitiveMemory[],
  experienceId: string,
): RewordTarget | null {
  const entry = draft.experience.find((item) => item.id === experienceId);
  if (!entry) return null;
  const statements = new Map(memory.map((item) => [item.id, item]));
  const line = entry.bulletMemoryIds
    .map((id) => statements.get(id))
    .find((item) => item && item.sensitive !== true && item.statement.trim());
  if (!line) return null;
  const place = buildFactRewriteRequest(draft, memory).places.find(
    (item) => item.experienceId === experienceId,
  );
  if (!place) return null;
  const { employer, title, period, language } = place;
  return {
    experienceId,
    memoryId: line.id,
    current: line.statement,
    place: { employer, title, period, language },
    facts: [
      { id: line.id, domain: line.domain, statement: line.statement },
      ...placeFacts(memory, employer, line.id),
    ],
  };
}

/** Вход модели: та же ступень, что пишет «Другой вариант» пункта. */
export function rewordRequest(
  target: RewordTarget,
  avoid: readonly string[] = [],
  wish: VariantWish = { chips: [], text: '' },
): FactRewriteVariantRequest {
  return {
    place: target.place,
    facts: target.facts,
    current: target.current,
    avoid: [target.current, ...avoid],
    wish: wishInstruction(wish),
  };
}

/** Предложение из одной строки, которая встанет на место прежней. */
export function rewordProposal(
  target: RewordTarget,
  text: string,
  id: string,
): FactRewriteProposal {
  const sourceFactIds = target.facts.map((fact) => fact.id);
  return {
    id,
    places: [
      {
        experienceId: target.experienceId,
        bullets: [{ text, sourceFactIds, replacesMemoryId: target.memoryId }],
      },
    ],
    leftOutFactIds: [],
    sourceFactIds,
  };
}
