/**
 * The card's Russian summary block (`server/seo/catalogRuSummary.ts`): our own
 * text above the employer's original, in the existing catalog styles. Salary
 * comes from the card's own label and names its source; the model never states it.
 */
import type { CatalogRuSummary } from '../seo/catalogRuSummary';
import { escapeHtml } from './catalogHtml';

export interface RuSummaryCard {
  readonly salaryLabel?: string;
  readonly sourceName?: string;
}

function fact(label: string, value: string | undefined): string {
  return value ? `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>` : '';
}

function salaryFact(card: RuSummaryCard): string | undefined {
  if (!card.salaryLabel) return undefined;
  const source = card.sourceName?.replace(/\s*\(страница поиска\)$/u, '').trim();
  return source ? `${card.salaryLabel} — по данным ${source}` : card.salaryLabel;
}

export function ruSummaryBlock(summary: CatalogRuSummary, card: RuSummaryCard): string {
  const { facts } = summary;
  const requirements = facts.requirements?.length
    ? `<dt>Ключевые требования</dt><dd><ul class="cat-ru-list">${facts.requirements
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul></dd>`
    : '';
  return (
    '<section class="cat-ru" lang="ru" aria-labelledby="cat-ru-title">' +
    '<h2 id="cat-ru-title">Коротко о вакансии</h2>' +
    `<p>${escapeHtml(summary.text)}</p>` +
    '<dl class="cat-facts">' +
    fact('Роль и уровень', facts.role) +
    fact('Формат работы', facts.format) +
    fact('География', facts.geography) +
    fact('Зарплата', salaryFact(card)) +
    requirements +
    fact('Кому подойдёт', facts.audience) +
    '</dl>' +
    '<p class="cat-ru-note">Пересказ openqareer по тексту работодателя. Ниже — оригинал объявления.</p>' +
    '</section>'
  );
}

export const RU_SUMMARY_STYLE =
  '.cat-ru{margin-top:28px;background:var(--ps-surface);border:1px solid var(--ps-line);border-radius:16px;padding:20px}' +
  '.cat-ru h2{font-size:18px;margin-bottom:10px;color:var(--ps-ink)}' +
  '.cat-ru>p{font-size:16px;line-height:1.6;color:var(--ps-soft);margin:0 0 14px}' +
  '.cat-ru-list{margin:0;padding-left:20px}.cat-ru-list li{margin-bottom:4px}' +
  '.cat-ru .cat-ru-note{margin:14px 0 0;font-size:13px;color:var(--ps-mute)}';
