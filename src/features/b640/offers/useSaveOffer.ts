import { useRef, useState } from 'react';
import { createApplication, saveApplicationOffer } from '../../applications/applicationsApi';
import type { OfferCard } from './model/offerModel';
import type { ParsedOfferForm } from './model/offerForm';
import { putOfferTax } from './data/offersApi';

type Valid = Extract<ParsedOfferForm, { readonly ok: true }>;

export type SaveState = 'idle' | 'saving' | 'error';

/** Поля, которых нет в форме O6a: при сохранении их не теряем. */
function keptTerms(card: OfferCard | null) {
  if (!card) return {};
  const { equity, location, startDate } = card.terms;
  return Object.fromEntries(
    Object.entries({ equity, location, startDate }).filter(([, value]) => value !== undefined),
  );
}

async function save(
  card: OfferCard | null,
  parsed: Valid,
  created: { current: string | null },
): Promise<string> {
  const applicationId =
    card?.applicationId ??
    created.current ??
    (
      await createApplication({
        stage: 'offer',
        manualVacancy: { title: parsed.title, company: parsed.company, source: 'other' },
      })
    ).id;
  // Повтор после сбоя не заводит второй отклик.
  created.current = applicationId;
  await saveApplicationOffer(
    applicationId,
    { ...keptTerms(card), ...parsed.terms },
    parsed.respondBy,
  );
  if (parsed.tax !== (card?.view.taxPercent ?? null)) await putOfferTax(applicationId, parsed.tax);
  return applicationId;
}

/**
 * Сохранение условий: новый оффер сначала заводит отклик на этапе «Оффер».
 * Ошибка оставляет форму как есть — кандидат повторяет без потери введённого.
 */
export function useSaveOffer(card: OfferCard | null, onSaved: (applicationId: string) => void) {
  const [state, setState] = useState<SaveState>('idle');
  const created = useRef<string | null>(null);
  async function run(parsed: Valid) {
    setState('saving');
    try {
      const id = await save(card, parsed, created);
      setState('idle');
      onSaved(id);
    } catch {
      setState('error');
    }
  }
  return { state, run };
}
