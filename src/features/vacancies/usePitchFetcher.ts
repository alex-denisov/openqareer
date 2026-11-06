import { useCallback, useEffect, useRef, useState } from 'react';
import { requestVacancyPitch, type VacancyPitchResult } from './vacancyPitchApi';
import type { PitchLanguage, PitchTone, VacancyPitchModalProps } from './VacancyPitchModal';

export function executePitchFetch(
  vacancy: VacancyPitchModalProps['vacancy'],
  tone: PitchTone,
  language: PitchLanguage | undefined,
  onFetchPitch?: VacancyPitchModalProps['onFetchPitch'],
): Promise<VacancyPitchResult> {
  if (onFetchPitch) return onFetchPitch(vacancy.id, tone, language);
  return requestVacancyPitch(vacancy.id, {
    tone,
    ...(language ? { language } : {}),
    vacancy: {
      title: vacancy.title,
      company: vacancy.company,
      description: vacancy.descriptionSummary,
      requiredSkills: vacancy.skills,
      location: vacancy.location,
      isRemote: vacancy.isRemote,
    },
  });
}

export function usePitchFetcher(
  isOpen: boolean,
  vacancy: VacancyPitchModalProps['vacancy'],
  tone: PitchTone,
  language: PitchLanguage | undefined,
  initialPitch?: VacancyPitchResult,
  onFetchPitch?: VacancyPitchModalProps['onFetchPitch'],
  onPitchReady?: VacancyPitchModalProps['onPitchReady'],
) {
  const [pitch, setPitch] = useState<VacancyPitchResult | null>(initialPitch ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Экраны передают вакансию новым объектом при каждой отрисовке, а каждый запрос платный: ключ — её id.
  const vacancyRef = useRef(vacancy);
  useEffect(() => {
    vacancyRef.current = vacancy;
  }, [vacancy]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialPitch && tone === 'executive' && (!language || language === initialPitch.language)) {
      setPitch(initialPitch);
      return;
    }
    let isMounted = true;
    setLoading(true);
    setError(null);
    executePitchFetch(vacancyRef.current, tone, language, onFetchPitch)
      .then((data) => {
        if (isMounted) {
          setPitch(data);
          onPitchReady?.(data, tone);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Не удалось подготовить текст. Повторите.');
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen, vacancy.id, tone, language, initialPitch, onFetchPitch, onPitchReady, retryKey]);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);
  return { pitch, loading, error, retry };
}
