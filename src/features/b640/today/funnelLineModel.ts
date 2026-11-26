import type { ApplicationView } from '../../applications/applicationsApi';
import { applicationReachedStage } from '../../applications/pipelineAnalytics';
import { wasSent } from '../responses/model/sentState';
import { longDate, pluralRu } from '../responses/model/responseRow';

function sentAt(application: ApplicationView): number {
  return new Date(application.appliedAt ?? application.createdAt).getTime();
}

function count(value: number, forms: readonly [string, string, string]): string {
  return `${value} ${pluralRu(value, forms)}`;
}

/**
 * B650 s05b: строка пути откликов в полосе статуса — «С 2 октября: 13 откликов → 1 интервью →
 * 1 оффер». Считает отклики, отправленные с выбора статуса (без даты — с первого отклика);
 * интервью — дошедшие до интервью или оффера, в том числе потом отклонённые. Откликов нет — `null`.
 */
export function funnelLine(
  applications: readonly ApplicationView[],
  statusSince: string | null,
): string | null {
  const from = statusSince ? new Date(statusSince).getTime() : Number.NEGATIVE_INFINITY;
  const sent = applications.filter(
    (item) => wasSent(item) && Number.isFinite(sentAt(item)) && sentAt(item) >= from,
  );
  if (sent.length === 0) return null;
  const start = statusSince ?? new Date(Math.min(...sent.map(sentAt))).toISOString();
  const offers = sent.filter((item) => applicationReachedStage(item, 'offer')).length;
  const interviews = sent.filter(
    (item) => applicationReachedStage(item, 'interview') || applicationReachedStage(item, 'offer'),
  ).length;
  return [
    `С ${longDate(start)}: ${count(sent.length, ['отклик', 'отклика', 'откликов'])}`,
    count(interviews, ['интервью', 'интервью', 'интервью']),
    count(offers, ['оффер', 'оффера', 'офферов']),
  ].join(' → ');
}
