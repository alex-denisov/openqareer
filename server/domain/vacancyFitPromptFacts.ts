/**
 * 02.11 (138916164 stayed at 25 %): the owner's facts fill 30 KB, and the budget cut them by order,
 * so «команда выросла с 4 до 11» and «затраты команд в моём P&L» never reached the model. The prompt
 * now always carries the profile core (summary, tenure, location, every place) and fills the rest
 * of the budget by relevance to each requirement of this vacancy.
 */
import type { VacancyRequirement } from './vacancyRequirements';
import type { VacancyFitFact } from './vacancyFit';
import { MAX_FIT_EVIDENCE_BYTES } from './vacancyFitProfileEvidence';

/**
 * 04.11 (138776387): a Russian «английский» shares no word with «English — C1», so languages went
 * last and were cut. What is short and can only be matched by meaning always travels.
 */
const CORE = /^profile:(?:headline|about|tenure|location|experience|language|education|certificate|skill)(?::|$)/u;
/** Russian and English stems of the same work, so a Russian requirement finds an English bullet. */
const SAME_MEANING: readonly (readonly string[])[] = [
  ['бюджет', 'budget', 'p&l', 'затрат', 'cost', 'финанс', 'financ'],
  ['команд', 'team', 'подчин', 'report', 'сотрудн', 'people', 'штат', 'headcount'],
  ['поддерж', 'support', 'service', 'сервис', 'helpdesk', 'desk'],
  ['управл', 'руковод', 'manag', 'lead', 'head', 'директор', 'director'],
  ['процесс', 'process', 'itil', 'itsm'],
  ['интеграц', 'integrat'],
  ['закупк', 'procure', 'purchas', 'контракт', 'contract'],
  ['трансформ', 'transform', 'цифров', 'digital'],
  ['инфраструкт', 'infrastruct', 'сервер', 'server', 'сет', 'network'],
  ['безопасн', 'security', 'infosec'],
  ['автоматиз', 'automat'],
  ['стратег', 'strateg'],
  ['опыт', 'experienc', 'лет', 'year'],
];

const bytesOf = (fact: VacancyFitFact): number =>
  Buffer.byteLength(JSON.stringify({ id: fact.id, statement: fact.statement })) + 1;

function termsOf(text: string): ReadonlySet<string> {
  const lower = text.toLocaleLowerCase();
  const words = lower.match(/[\p{L}\p{N}&]{3,}/gu) ?? [];
  const stems = words.map((word) => word.slice(0, 6));
  const groups = SAME_MEANING.flatMap((group, index) =>
    group.some((stem) => lower.includes(stem)) ? [`#${index}`] : [],
  );
  return new Set([...stems, ...groups]);
}

const overlap = (left: ReadonlySet<string>, right: ReadonlySet<string>): number =>
  [...left].filter((term) => right.has(term)).length;

/** Each requirement in turn takes its best remaining fact, so no requirement is left without one. */
function rankedByRequirement(
  facts: readonly VacancyFitFact[],
  requirements: readonly Pick<VacancyRequirement, 'text'>[],
): readonly VacancyFitFact[] {
  const factTerms = facts.map((fact) => termsOf(fact.statement));
  const queues = requirements.map((requirement) => {
    const terms = termsOf(requirement.text);
    return facts
      .map((fact, index) => ({ fact, score: overlap(terms, factTerms[index]!) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.fact);
  });
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  const interleaved = Array.from({ length: longest }, (_, rank) =>
    queues.flatMap((queue) => (queue[rank] ? [queue[rank]] : [])),
  ).flat();
  return [...new Set([...interleaved, ...facts])];
}

/** Words of a statement between spaces, so «Java» is not found inside «JavaScript». */
const wordsOf = (text: string): string =>
  ` ${text.toLocaleLowerCase().replace(/[^\p{L}\p{N}&+#]+/gu, ' ').trim()} `;

/**
 * 04.11: imports keep a profile line and its bullets as separate facts, a fifth of the budget. A
 * copy carries nothing the longer fact does not; the model cites the longer one.
 */
function withoutCopies(facts: readonly VacancyFitFact[]): readonly VacancyFitFact[] {
  const words = facts.map((fact) => wordsOf(fact.statement));
  return facts.filter((fact, index) =>
    CORE.test(fact.id) ||
    !words.some((other, at) => at !== index && (other === words[index] ? at < index : other.includes(words[index]!))),
  );
}

/** Facts for one model call: the whole list when it fits, else core plus the most relevant ones. */
export function vacancyFitPromptFacts(
  facts: readonly VacancyFitFact[],
  requirements: readonly Pick<VacancyRequirement, 'text'>[],
): readonly VacancyFitFact[] {
  if (facts.reduce((sum, fact) => sum + bytesOf(fact), 2) <= MAX_FIT_EVIDENCE_BYTES) return facts;
  const distinct = withoutCopies(facts);
  const core = distinct.filter((fact) => CORE.test(fact.id));
  const rest = rankedByRequirement(
    distinct.filter((fact) => !CORE.test(fact.id)),
    requirements,
  );
  let bytes = 2;
  const chosen = new Set<string>();
  for (const fact of [...core, ...rest]) {
    const size = bytesOf(fact);
    if (bytes + size > MAX_FIT_EVIDENCE_BYTES) continue;
    bytes += size;
    chosen.add(fact.id);
  }
  return facts.filter((fact) => chosen.has(fact.id));
}
