import { useState } from 'react';
import { Check, LinkSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import type { LanguagesStep } from '../../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireStepFormProps } from '../RelocationQuestionnaireSteps';
import { LANGUAGE_NAME_OPTIONS, LanguageLevelSelect, OTHER_LANGUAGE, RelocationFormField, relocationRowId } from '../RelocationFormControls';
import { relocationShortDay } from '../relocationDates';

/** Mockup 15 `i4`: language cards with their source, then one inline row to add a language. */
export function LanguagesForm(props: RelocationQuestionnaireStepFormProps) {
  return (
    <section className="career-relocation-step-content" aria-label="Языки">
      <LanguageRows {...props} />
      <NewLanguageForm {...props} />
      <LinkedInImport {...props} />
    </section>
  );
}

const LEVEL_LABELS: Readonly<Record<LanguagesStep['languages'][number]['level'], string>> = {
  A1: 'начальный, A1', A2: 'базовый, A2', B1: 'средний, B1', B2: 'выше среднего, B2',
  C1: 'свободный, C1', C2: 'в совершенстве, C2', unknown: 'уровень не указан',
};

function languageSource(language: LanguagesStep['languages'][number]): string {
  const day = language.sourceCapturedAt ? `, ${relocationShortDay(language.sourceCapturedAt)}` : '';
  if (language.source === 'linkedin') return `из LinkedIn${day}`;
  if (language.source === 'certificate') return `по сертификату${day}`;
  return 'со слов кандидата';
}

function LanguageRows({ profile, onProfileChange }: RelocationQuestionnaireStepFormProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const languages = profile.languages.languages;
  if (!languages.length) return null;
  const remove = (id: string) =>
    onProfileChange({ ...profile, languages: { languages: languages.filter((item) => item.id !== id) } });
  return (
    <ul className="career-relocation-doc-list">
      {languages.map((language) => {
        const title = `${language.name || 'Язык'}: ${LEVEL_LABELS[language.level]}`;
        return (
          <li key={language.id}>
            {editingId === language.id ? (
              <LanguageRow language={language} profile={profile} onProfileChange={onProfileChange} onDone={() => setEditingId(null)} />
            ) : (
              <>
                <div>
                  <strong>{title}</strong>
                  <p>
                    <LinkSimple aria-hidden="true" size={12} /> {languageSource(language)}
                    {language.confirmation === 'proposed' ? ' · нужно подтвердить' : ''}
                  </p>
                </div>
                <span className="career-relocation-doc-actions">
                  <button className="career-relocation-btn is-sm is-icon is-ghost" type="button" aria-label={`Изменить: ${language.name}`} onClick={() => setEditingId(language.id)}>
                    <PencilSimple aria-hidden="true" size={18} />
                  </button>
                  <button className="career-relocation-btn is-sm is-icon is-ghost" type="button" aria-label={`Удалить: ${language.name}`} onClick={() => remove(language.id)}>
                    <Trash aria-hidden="true" size={18} />
                  </button>
                </span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LanguageRow({
  language,
  profile,
  onProfileChange,
  onDone,
}: {
  readonly language: LanguagesStep['languages'][number];
  readonly profile: RelocationQuestionnaireStepFormProps['profile'];
  readonly onProfileChange: RelocationQuestionnaireStepFormProps['onProfileChange'];
  readonly onDone: () => void;
}) {
  const prefix = `relocation-language-${language.id}`;
  const update = (change: Partial<LanguagesStep['languages'][number]>) => onProfileChange({
    ...profile,
    languages: {
      languages: profile.languages.languages.map((item) => item.id === language.id ? { ...item, ...change } : item),
    },
  });
  return (
    <fieldset className="career-relocation-record">
      <legend>{language.name || 'Язык без названия'}</legend>
      <div className="career-relocation-form-grid">
        <RelocationFormField id={`${prefix}-name`} label="Язык"><input id={`${prefix}-name`} value={language.name} onChange={(event) => update({ name: event.target.value })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-level`} label="Уровень"><LanguageLevelSelect id={`${prefix}-level`} value={language.level} onChange={(level) => update({ level })} /></RelocationFormField>
        <RelocationFormField id={`${prefix}-confirmation`} label="Проверка">
          <select id={`${prefix}-confirmation`} value={language.confirmation} onChange={(event) => update({ confirmation: event.target.value as 'proposed' | 'confirmed' })}>
            <option value="proposed">Нужно подтвердить</option>
            <option value="confirmed">Подтверждён</option>
          </select>
        </RelocationFormField>
      </div>
      <button className="career-relocation-btn" type="button" onClick={onDone}>
        <Check aria-hidden="true" size={16} />Готово
      </button>
    </fieldset>
  );
}

function NewLanguageForm({ profile, onProfileChange }: RelocationQuestionnaireStepFormProps) {
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [level, setLevel] = useState<LanguagesStep['languages'][number]['level']>('unknown');
  const name = choice === OTHER_LANGUAGE ? other : choice;
  const add = () => {
    if (!name.trim()) return;
    onProfileChange({
      ...profile,
      languages: {
        languages: [...profile.languages.languages, {
          id: relocationRowId('language'), name: name.trim(), level, source: 'candidate', confirmation: 'confirmed',
        }],
      },
    });
    setChoice('');
    setOther('');
    setLevel('unknown');
  };
  return (
    <div className="career-relocation-language-add">
      <RelocationFormField id="relocation-new-language-name" label="Добавить язык">
        <select id="relocation-new-language-name" value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Выберите язык</option>
          {LANGUAGE_NAME_OPTIONS.map((language) => <option key={language} value={language}>{language}</option>)}
          <option value={OTHER_LANGUAGE}>Другой язык</option>
        </select>
      </RelocationFormField>
      {choice === OTHER_LANGUAGE ? (
        <RelocationFormField id="relocation-new-language-other" label="Какой язык">
          <input id="relocation-new-language-other" maxLength={60} value={other} onChange={(event) => setOther(event.target.value)} />
        </RelocationFormField>
      ) : null}
      <RelocationFormField id="relocation-new-language-level" label="Уровень">
        <LanguageLevelSelect id="relocation-new-language-level" value={level} onChange={setLevel} />
      </RelocationFormField>
      <button className="career-relocation-btn" type="button" disabled={!name.trim()} onClick={add}>
        <Plus aria-hidden="true" size={16} />Добавить
      </button>
    </div>
  );
}

function LinkedInImport({ onImportLinkedIn, importBusy, importError }: RelocationQuestionnaireStepFormProps) {
  return (
    <div className="career-relocation-linkedin-import">
      <button className="career-relocation-btn is-sm is-ghost" type="button" disabled={importBusy} onClick={onImportLinkedIn}>
        {importBusy ? 'Импортируем…' : 'Импортировать языки из подключённого профиля'}
      </button>
      {importError ? <p role="alert">{importError}</p> : null}
    </div>
  );
}
