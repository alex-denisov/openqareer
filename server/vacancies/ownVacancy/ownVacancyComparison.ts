import type { OwnVacancy, OwnVacancyDetail } from '../../../shared/b640OwnVacancy';
import type { VacancyFitResult, VacancyFitView } from '../../../shared/vacancyFit';
import type { OwnVacancyRecord } from '../../data/sqliteOwnVacancyStore';
import { fitFailure } from '../../domain/vacancyMechanicsRuntime';
import { labelVacancyRequirement } from '../../domain/vacancyRequirementLabel';
import { extractVacancyRequirements } from '../../domain/vacancyRequirements';
import { isSkillRequirement, type VacancyFitInput } from '../../domain/vacancyFit';
import type { VacancyRequirement } from '../../domain/vacancyRequirements';
import type { RouteDeps } from '../../routes/deps';
import { vacancyFitContext } from '../../routes/vacancyFitContext';

/**
 * B676: сравнение своей вакансии с профилем тем же расчётом совпадения, что у подборки.
 * Требования — правилами, без модели, и едут внутри запечатанной задачи совпадения:
 * очередь и кэш требований хранят текст открытым, а текст своей вакансии лежит только
 * запечатанным. Процент кандидату не отдаётся: только «N из M есть в профиле» и статусы.
 */
function target(record: OwnVacancyRecord) {
  return {
    vacancyId: record.id, title: record.title, description: record.text, fullText: true, textHidden: false,
    location: record.location ?? undefined, country: undefined as string | undefined, isRemote: record.workFormat === 'remote',
  };
}

function fitInput(deps: RouteDeps, candidateId: string, record: OwnVacancyRecord): VacancyFitInput {
  const { requirements } = extractVacancyRequirements({ vacancyId: record.id, description: record.text });
  return vacancyFitContext(deps, candidateId, target(record), requirements);
}

/**
 * Требования для раскрытия: подпись для строки, а признак навыка — тот, по которому их считает
 * расчёт (прод 18.11: «4 из 4», а строк две — длинное предложение считалось, но не показывалось).
 */
export function shownOwnRequirements(requirements: readonly VacancyRequirement[]): VacancyRequirement[] {
  return requirements.map((item) => ({ ...labelVacancyRequirement(item), skill: isSkillRequirement(item) }));
}

export function startOwnVacancyComparison(deps: RouteDeps, candidateId: string, record: OwnVacancyRecord): void {
  const input = fitInput(deps, candidateId, record);
  if (input.requirements.length > 0) deps.vacancyMechanics?.fit.enqueue(input);
}

function withoutPercent(result: VacancyFitResult): VacancyFitResult {
  return { ...result, coveragePercent: null, requiredCoverage: { ...result.requiredCoverage, percent: null } };
}

function jobState(state: string | undefined): VacancyFitView['state'] {
  if (state === 'failed') return 'failed';
  if (state === 'retrying') return 'retrying';
  return state === 'pending' || state === 'leased' ? 'processing' : 'not_requested';
}

function fitView(deps: RouteDeps, candidateId: string, record: OwnVacancyRecord): VacancyFitView {
  const input = fitInput(deps, candidateId, record);
  const requirements = shownOwnRequirements(input.requirements);
  const runtime = deps.vacancyMechanics;
  if (input.requirements.length === 0) return { state: 'no_requirements', requirements };
  if (!runtime) return { state: 'not_requested', requirements };
  const result = runtime.fit.getCache(input);
  if (result) return { state: 'ready', requirements, result: withoutPercent(result) };
  // Профиль изменился — у входа новый ключ: сравнение ставится заново, а не висит «идёт».
  const job = runtime.fit.getJobStatus(input) ?? (runtime.fit.enqueue(input), runtime.fit.getJobStatus(input));
  const state = jobState(job?.state);
  return { state, requirements, ...(state === 'failed' ? { failure: fitFailure(job?.lastError) } : {}) };
}

function summary(record: OwnVacancyRecord, fit: VacancyFitView): OwnVacancy {
  const comparing = ['not_requested', 'processing', 'retrying'].includes(fit.state);
  const coverage = fit.result && fit.result.coverage.total > 0
    ? { matched: fit.result.coverage.matched, total: fit.result.coverage.total } : null;
  const { text: _text, ...fields } = record;
  return { ...fields, coverage, comparing };
}

export function ownVacancySummary(deps: RouteDeps, candidateId: string, record: OwnVacancyRecord): OwnVacancy {
  return summary(record, fitView(deps, candidateId, record));
}

export function ownVacancyDetail(deps: RouteDeps, candidateId: string, record: OwnVacancyRecord): OwnVacancyDetail {
  const fit = fitView(deps, candidateId, record);
  return { ...summary(record, fit), text: record.text, fit };
}

/** Удаление убирает все задачи и результаты совпадения этой вакансии, под любой версией профиля. */
export function forgetOwnVacancyComparison(deps: RouteDeps, candidateId: string, record: OwnVacancyRecord): void {
  deps.vacancyMechanics?.fit.forgetVacancy(candidateId, record.id);
}
