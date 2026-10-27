import React from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { RESUME_TEMPLATES, RESUME_TEMPLATE_LABELS } from '../../../../shared/resumeBuilder/model';
import { BUILDER_STEPS, BuilderStep } from './BuilderSteps';
import { ResumeSheet } from './ResumeSheet';
import type { ResumeBuilderModel } from './useResumeBuilder';

const TEMPLATE_CLASS = { strict: 't1', modern: 't2', compact: 't3' } as const;

function TemplatePicker({ model }: { readonly model: ResumeBuilderModel }) {
  return (
    <div className="tpl" role="group" aria-label="Шаблон">
      {RESUME_TEMPLATES.map((template) => (
        <button
          key={template}
          type="button"
          className={TEMPLATE_CLASS[template]}
          aria-pressed={model.template === template}
          onClick={() => model.setTemplate(template)}
        >
          <i aria-hidden="true" />
          {RESUME_TEMPLATE_LABELS[template]}
        </button>
      ))}
    </div>
  );
}

function StepsPanel({ model }: { readonly model: ResumeBuilderModel }) {
  return (
    <div className="rb-steps">
      <div className="rb-step-tabs" role="tablist" aria-label="Шаги резюме">
        {BUILDER_STEPS.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`rb-tab-${id}`}
            aria-selected={model.step === id}
            aria-controls="rb-step-panel"
            onClick={() => model.setStep(id)}
          >
            <span className="n">{index + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <div
        id="rb-step-panel"
        role="tabpanel"
        aria-labelledby={`rb-tab-${model.step}`}
        className="rb-step-body"
      >
        <BuilderStep step={model.step} resume={model.resume} onChange={model.setResume} />
      </div>
    </div>
  );
}

function openVacancyField() {
  const field = document.getElementById('rb-vacancy');
  field?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  field?.focus({ preventScroll: true });
}

function AtsSummary({ model }: { readonly model: ResumeBuilderModel }) {
  const { passed, total, checks } = model.ats;
  const keywords = checks.find((check) => check.id === 'keywords');
  const others = checks.filter((check) => check.id !== 'keywords');
  const othersOk = others.every((check) => check.status === 'ok');
  return (
    <div className="ats">
      <span className={`ring is-${passed}`}>
        <b>
          {passed}/{total}
        </b>
      </span>
      <p>
        <b>{othersOk ? 'ATS: структура, даты и формат в порядке' : 'ATS: есть что поправить'}</b>
        <br />
        {keywords?.status === 'needs_vacancy' ? (
          <>
            Ключевые слова —{' '}
            <button type="button" className="link" onClick={openVacancyField}>
              по ссылке на вакансию
            </button>
          </>
        ) : (
          keywords?.detail
        )}
      </p>
    </div>
  );
}

function Downloads({ model }: { readonly model: ResumeBuilderModel }) {
  return (
    <div className="dl">
      <button
        type="button"
        className="ps-btn"
        disabled={Boolean(model.busy)}
        onClick={() => void model.download('pdf')}
      >
        <DownloadSimple className="ic" aria-hidden="true" />
        {model.busy === 'pdf' ? 'Собираем…' : 'Скачать PDF'}
      </button>
      <button
        type="button"
        className="ps-btn"
        disabled={Boolean(model.busy)}
        onClick={() => void model.download('docx')}
      >
        {model.busy === 'docx' ? 'Собираем…' : 'DOCX'}
      </button>
    </div>
  );
}

export function ResumeEditor({ model }: { readonly model: ResumeBuilderModel }) {
  return (
    <div className="ed" id="builder" aria-label="Конструктор резюме">
      <div className="ed-top">
        <TemplatePicker model={model} />
        {model.editing ? null : <span className="ps-chip">Пример</span>}
      </div>
      {model.editing ? <StepsPanel model={model} /> : null}
      <div className="paper">
        {/* The sample is a teaser; once the visitor types, the whole sheet is shown. */}
        <ResumeSheet resume={model.resume} template={model.template} clipped={!model.editing} />
      </div>
      <div className="ed-bot">
        <AtsSummary model={model} />
        <Downloads model={model} />
      </div>
      {model.notice ? (
        <p className="rb-notice" role="status">
          {model.notice}
        </p>
      ) : null}
      <p className="small nextj">
        <a className="link" href="/signup?from=resume&next=match">
          Вакансии, где подойдёт это резюме, — показать процент совпадения →
        </a>
        <span>Резюме под каждую вакансию — в Basic</span>
      </p>
    </div>
  );
}
