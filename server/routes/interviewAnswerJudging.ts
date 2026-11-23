import type { FastifyBaseLogger } from 'fastify';
import type { QuotedAnswerEvaluation } from '../domain/interviewAnswerReview';
import { mergeJudgement, type JudgeInput } from '../domain/interviewAnswerJudge';
import {
  buildInterviewAnswerJudge,
  type InterviewAnswerJudge,
} from '../providers/interviewAnswerJudge';
import type { RouteDeps } from './deps';

/**
 * B780: судья критериев на одно приложение. Без подставного в зависимостях — цепочка письма из
 * конфига (без ключей цепочка пустая, решают правила). В журнал — только имя ошибки.
 */
const judges = new WeakMap<RouteDeps, InterviewAnswerJudge>();

function judgeOf(deps: RouteDeps, log: Pick<FastifyBaseLogger, 'warn'>): InterviewAnswerJudge {
  if (deps.interviewAnswerJudge) return deps.interviewAnswerJudge;
  const known = judges.get(deps);
  if (known) return known;
  const built = buildInterviewAnswerJudge(
    { providerCredentials: deps.config.providerCredentials, vertex: deps.config.vertex },
    (error) =>
      log.warn(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'interview-answer-judge-stage-failed',
      ),
  );
  judges.set(deps, built);
  return built;
}

/** Оценка правил, поверх неё — принятые решения модели; модель упала — правила как есть. */
export async function judgedEvaluation(
  deps: RouteDeps,
  log: Pick<FastifyBaseLogger, 'warn'>,
  input: JudgeInput,
  rules: QuotedAnswerEvaluation,
): Promise<QuotedAnswerEvaluation> {
  try {
    return mergeJudgement(rules, await judgeOf(deps, log).judge(input));
  } catch (error) {
    log.warn(
      { errorName: error instanceof Error ? error.name : 'unknown' },
      'interview-answer-judge-failed',
    );
    return rules;
  }
}
