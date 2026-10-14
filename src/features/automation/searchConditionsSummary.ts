import {
  DECISION_WORK_FORMATS,
  type CandidateDecisionProfile,
} from '../../../shared/workPreferences';

/** Строка «География и формат» из сохранённых условий поиска; без данных — null, а не выдуманное значение. */
export function summarizeSearchGeography(
  profile: Pick<CandidateDecisionProfile, 'citizenship' | 'workFormats'>,
): string | null {
  const places = profile.citizenship.join(', ');
  const formats = DECISION_WORK_FORMATS.filter((format) => profile.workFormats.includes(format.id))
    .map((format) => format.label)
    .join(', ');
  const parts = [places, formats].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
