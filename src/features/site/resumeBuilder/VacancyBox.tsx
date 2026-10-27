import React from 'react';
import type { ResumeBuilderModel } from './useResumeBuilder';

/** B567: link or text of a vacancy; links are looked up in the pool, never fetched blindly. */
export function VacancyBox({ model }: { readonly model: ResumeBuilderModel }) {
  return (
    <form
      className="vac"
      id="vac"
      aria-label="Проверка по вакансии"
      onSubmit={(event) => {
        event.preventDefault();
        void model.checkVacancy();
      }}
    >
      <label htmlFor="rb-vacancy">Ссылка на вакансию или её текст</label>
      <div className="vac-row">
        <textarea
          id="rb-vacancy"
          rows={1}
          value={model.vacancyInput}
          placeholder="https://hh.ru/vacancy/… или текст вакансии"
          onChange={(event) => model.setVacancyInput(event.target.value)}
        />
        <button
          type="submit"
          className="ps-btn is-primary"
          disabled={model.keywordsBusy || !model.vacancyInput.trim()}
        >
          {model.keywordsBusy ? 'Проверяем…' : 'Проверить ключевые слова'}
        </button>
      </div>
      {model.keywords?.vacancy ? (
        <p role="status">
          Вакансия из каталога: {model.keywords.vacancy.title}
          {model.keywords.vacancy.company ? `, ${model.keywords.vacancy.company}` : ''}
        </p>
      ) : null}
      <p className="small">
        Ссылки с hh.ru и LinkedIn ищем в каталоге openqareer. Если вакансии там нет — вставьте её
        текст.
      </p>
      {model.keywordsMessage ? <p role="status">{model.keywordsMessage}</p> : null}
    </form>
  );
}
