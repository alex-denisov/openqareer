import React from 'react';
import {
  EMPTY_EDUCATION,
  EMPTY_JOB,
  MONTH_YEAR,
  type BuilderEducation,
  type BuilderJob,
  type BuilderResume,
} from '../../../../shared/resumeBuilder/model';
import { Field, ListEditor } from './BuilderFields';

export const BUILDER_STEPS = [
  ['contacts', 'Должность'],
  ['results', 'Результаты'],
  ['jobs', 'Опыт'],
  ['education', 'Образование'],
  ['skills', 'Навыки'],
] as const;

export type BuilderStepId = (typeof BUILDER_STEPS)[number][0];

interface StepProps {
  readonly resume: BuilderResume;
  readonly onChange: (resume: BuilderResume) => void;
}

function ContactsStep({ resume, onChange }: StepProps) {
  const set = (key: 'fullName' | 'title' | 'city' | 'phone' | 'email') => (value: string) =>
    onChange({ ...resume, [key]: value });
  return (
    <div className="rb-grid">
      <Field
        id="rb-name"
        label="Имя и фамилия"
        value={resume.fullName}
        onChange={set('fullName')}
      />
      <Field
        id="rb-title"
        label="Должность"
        value={resume.title}
        onChange={set('title')}
        hint="Одна должность, словами из вакансий: «Главный бухгалтер», а не «Специалист по финансам и учёту»."
      />
      <Field id="rb-city" label="Город" value={resume.city} onChange={set('city')} />
      <Field
        id="rb-phone"
        label="Телефон"
        value={resume.phone}
        onChange={set('phone')}
        inputMode="tel"
      />
      <Field
        id="rb-email"
        label="Почта"
        value={resume.email}
        onChange={set('email')}
        inputMode="email"
      />
    </div>
  );
}

function ResultsStep({ resume, onChange }: StepProps) {
  return (
    <ListEditor
      idPrefix="rb-result"
      label="Главные результаты"
      items={resume.results}
      onChange={(results) => onChange({ ...resume, results })}
      addLabel="Добавить результат"
      max={8}
      hint="3–5 пунктов: глагол, что сделали, цифра."
      placeholder="Сократила закрытие месяца с 10 до 6 рабочих дней"
    />
  );
}

// One block of markup; splitting it would scatter a single layout.
// eslint-disable-next-line max-lines-per-function
function JobCard({
  job,
  index,
  onChange,
  onRemove,
}: {
  readonly job: BuilderJob;
  readonly index: number;
  readonly onChange: (job: BuilderJob) => void;
  readonly onRemove?: () => void;
}) {
  const id = `rb-job-${index}`;
  const set = (key: 'company' | 'city' | 'role' | 'start' | 'end') => (value: string) =>
    onChange({ ...job, [key]: value });
  return (
    <fieldset className="rb-card">
      <legend>Место работы {index + 1}</legend>
      <div className="rb-grid">
        <Field
          id={`${id}-company`}
          label="Компания"
          value={job.company}
          onChange={set('company')}
        />
        <Field id={`${id}-city`} label="Город" value={job.city} onChange={set('city')} />
        <Field id={`${id}-role`} label="Должность" value={job.role} onChange={set('role')} />
        <Field
          id={`${id}-start`}
          label="Начало, ММ.ГГГГ"
          value={job.start}
          onChange={set('start')}
          placeholder="03.2021"
          inputMode="numeric"
          invalid={job.start !== '' && !MONTH_YEAR.test(job.start)}
        />
        {job.current ? null : (
          <Field
            id={`${id}-end`}
            label="Окончание, ММ.ГГГГ"
            value={job.end}
            onChange={set('end')}
            placeholder="02.2024"
            inputMode="numeric"
            invalid={job.end !== '' && !MONTH_YEAR.test(job.end)}
          />
        )}
        <label className="rb-check">
          <input
            type="checkbox"
            checked={job.current}
            onChange={(event) => onChange({ ...job, current: event.target.checked, end: '' })}
          />
          Работаю сейчас
        </label>
      </div>
      <ListEditor
        idPrefix={`${id}-bullet`}
        label="Что сделали"
        items={job.bullets}
        onChange={(bullets) => onChange({ ...job, bullets })}
        addLabel="Добавить пункт"
        max={12}
        hint="Результат цифрой: «Перевела учёт 4 юрлиц на 1С:ERP за 7 месяцев»."
      />
      {onRemove ? (
        <button type="button" className="ps-btn is-ghost rb-add" onClick={onRemove}>
          Удалить место работы
        </button>
      ) : null}
    </fieldset>
  );
}

function JobsStep({ resume, onChange }: StepProps) {
  const setJobs = (jobs: BuilderJob[]) => onChange({ ...resume, jobs });
  return (
    <div className="rb-stack">
      <p className="rb-hint">
        Опыт в обратном порядке: последнее место — первым. Месяц и год у каждой даты.
      </p>
      {resume.jobs.map((job, index) => (
        <JobCard
          key={index}
          job={job}
          index={index}
          onChange={(next) => setJobs(resume.jobs.map((old, at) => (at === index ? next : old)))}
          onRemove={
            resume.jobs.length > 1
              ? () => setJobs(resume.jobs.filter((_, at) => at !== index))
              : undefined
          }
        />
      ))}
      {resume.jobs.length < 15 ? (
        <button
          type="button"
          className="ps-btn rb-add"
          onClick={() => setJobs([...resume.jobs, EMPTY_JOB])}
        >
          Добавить место работы
        </button>
      ) : null}
    </div>
  );
}

function EducationStep({ resume, onChange }: StepProps) {
  const setItems = (education: BuilderEducation[]) => onChange({ ...resume, education });
  return (
    <div className="rb-stack">
      {resume.education.map((item, index) => {
        const set = (key: keyof BuilderEducation) => (value: string) =>
          setItems(
            resume.education.map((old, at) => (at === index ? { ...old, [key]: value } : old)),
          );
        return (
          <fieldset className="rb-card" key={index}>
            <legend>Учёба {index + 1}</legend>
            <div className="rb-grid">
              <Field
                id={`rb-edu-${index}-school`}
                label="Учебное заведение"
                value={item.school}
                onChange={set('school')}
              />
              <Field
                id={`rb-edu-${index}-degree`}
                label="Степень и специальность"
                value={item.degree}
                onChange={set('degree')}
              />
              <Field
                id={`rb-edu-${index}-year`}
                label="Год окончания"
                value={item.year}
                onChange={set('year')}
                inputMode="numeric"
              />
            </div>
          </fieldset>
        );
      })}
      {resume.education.length < 6 ? (
        <button
          type="button"
          className="ps-btn rb-add"
          onClick={() => setItems([...resume.education, EMPTY_EDUCATION])}
        >
          Добавить учёбу
        </button>
      ) : null}
    </div>
  );
}

function SkillsStep({ resume, onChange }: StepProps) {
  return (
    <Field
      id="rb-skills"
      label="Навыки через запятую"
      value={resume.skills}
      onChange={(skills) => onChange({ ...resume, skills })}
      multiline
      hint="Словами из вакансии: если в требованиях «1С:ERP», не пишите «программы учёта»."
    />
  );
}

export function BuilderStep({ step, ...props }: StepProps & { readonly step: BuilderStepId }) {
  switch (step) {
    case 'contacts':
      return <ContactsStep {...props} />;
    case 'results':
      return <ResultsStep {...props} />;
    case 'jobs':
      return <JobsStep {...props} />;
    case 'education':
      return <EducationStep {...props} />;
    case 'skills':
      return <SkillsStep {...props} />;
  }
}
