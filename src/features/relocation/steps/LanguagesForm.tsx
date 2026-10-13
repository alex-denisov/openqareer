import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import type { LanguagesStep } from '../../../../shared/relocationQuestionnaire';
import type { RelocationQuestionnaireStepFormProps } from '../RelocationQuestionnaireSteps';
import { LanguageLevelSelect, RelocationFormField, relocationRowId } from '../RelocationFormControls';

export function LanguagesForm(props: RelocationQuestionnaireStepFormProps) {
  return (
    <section className="career-relocation-step-content" aria-labelledby="relocation-languages-title">
      <div className="career-relocation-step-card">
        <h3 id="relocation-languages-title">Языки</h3>
        <LanguageRows {...props} />
        <NewLanguageForm {...props} />
        <LinkedInImport {...props} />
      </div>
    </section>
  );
}

function LanguageRows({ profile, onProfileChange }: RelocationQuestionnaireStepFormProps) {
  const languages = profile.languages.languages;
  if (!languages.length) return <p>Языки не указаны.</p>;
  return (
    <div className="career-relocation-edit-list">
      {languages.map((language) => (
        <LanguageRow key={language.id} language={language} profile={profile} onProfileChange={onProfileChange} />
      ))}
    </div>
  );
}

function LanguageRow({
  language,
  profile,
  onProfileChange,
}: {
  readonly language: LanguagesStep['languages'][number];
  readonly profile: RelocationQuestionnaireStepFormProps['profile'];
  readonly onProfileChange: RelocationQuestionnaireStepFormProps['onProfileChange'];
}) {
  const prefix = `relocation-language-${language.id}`;
  const update = (change: Partial<LanguagesStep['languages'][number]>) => onProfileChange({
    ...profile,
    languages: {
      languages: profile.languages.languages.map((item) => item.id === language.id ? { ...item, ...change } : item),
    },
  });
  const remove = () => onProfileChange({
    ...profile,
    languages: { languages: profile.languages.languages.filter(({ id }) => id !== language.id) },
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
      <p>{language.sourceLabel ?? language.source}{language.confirmation === 'proposed' ? '. Проверьте значение перед использованием.' : ''}</p>
      <button className="career-btn career-btn-destructive" type="button" onClick={remove}>
        <Trash aria-hidden="true" size={16} />Удалить язык
      </button>
    </fieldset>
  );
}

function NewLanguageForm({ profile, onProfileChange }: RelocationQuestionnaireStepFormProps) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState<LanguagesStep['languages'][number]['level']>('unknown');
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
    setName('');
    setLevel('unknown');
  };
  return (
    <section className="career-relocation-add-form" aria-labelledby="relocation-add-language-title">
      <h4 id="relocation-add-language-title">Добавить язык</h4>
      <div className="career-relocation-form-grid">
        <RelocationFormField id="relocation-new-language-name" label="Язык">
          <input id="relocation-new-language-name" value={name} onChange={(event) => setName(event.target.value)} />
        </RelocationFormField>
        <RelocationFormField id="relocation-new-language-level" label="Уровень">
          <LanguageLevelSelect id="relocation-new-language-level" value={level} onChange={setLevel} />
        </RelocationFormField>
      </div>
      <button className="career-btn career-btn-secondary" type="button" disabled={!name.trim()} onClick={add}>
        <Plus aria-hidden="true" size={16} />Добавить язык
      </button>
    </section>
  );
}

function LinkedInImport({ onImportLinkedIn, importBusy, importError }: RelocationQuestionnaireStepFormProps) {
  return (
    <div className="career-relocation-linkedin-import">
      <button className="career-btn career-btn-secondary" type="button" disabled={importBusy} onClick={onImportLinkedIn}>
        {importBusy ? 'Импортируем…' : 'Импортировать языки из подключённого профиля'}
      </button>
      <p>Импортированные значения появятся как предложения на проверку.</p>
      {importError ? <p role="alert">{importError}</p> : null}
    </div>
  );
}
