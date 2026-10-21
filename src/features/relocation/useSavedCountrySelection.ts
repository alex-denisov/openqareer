import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RelocationAlert,
  RelocationQuestionnaire,
} from '../../../shared/relocationQuestionnaire';
import { putRelocationQuestionnaireProgress } from './relocationApi';

export type CountrySelectionSave = 'saved' | 'saving' | 'error';

type OnSaved = (profile: RelocationQuestionnaire, alerts: readonly RelocationAlert[]) => void;

/**
 * Countries chosen for comparison live in the questionnaire on the server
 * (mockup 15 «Выбор сохраняется»): the screen shows the choice at once and
 * writes it with the profile revision; a failed write says so instead of
 * pretending the choice was kept.
 */
export function useSavedCountrySelection(profile: RelocationQuestionnaire, onSaved?: OnSaved) {
  const [selected, setSelected] = useState<readonly string[]>(profile.selectedCountryCodes ?? []);
  const [save, setSave] = useState<CountrySelectionSave>('saved');
  const revision = useRef(profile.revision);
  useEffect(() => {
    revision.current = profile.revision;
  }, [profile.revision]);
  const change = useCallback(
    (next: readonly string[]) => {
      setSelected(next);
      setSave('saving');
      void putRelocationQuestionnaireProgress(
        {
          currentStep: profile.currentStep,
          skippedSteps: profile.skippedSteps,
          selectedCountryCodes: next,
        },
        revision.current,
      )
        .then((result) => {
          revision.current = result.profile.revision;
          setSave('saved');
          onSaved?.(result.profile, result.alerts);
        })
        .catch(() => setSave('error'));
    },
    [onSaved, profile.currentStep, profile.skippedSteps],
  );
  return { selected, save, change };
}
