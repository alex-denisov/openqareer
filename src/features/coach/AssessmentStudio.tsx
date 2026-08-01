import { useMemo, useState } from 'react';
import {
  submitAssessment,
  type ProductCaseSubmission,
  type StoredAssessment,
  type WorkDimension,
  type WorkPreferenceSubmission,
} from './coachApi';

interface AssessmentStudioProps {
  assessments: StoredAssessment[];
  onSaved: () => Promise<void>;
  onBackToCoach: () => void;
}

const DIMENSIONS: Array<{
  id: WorkDimension;
  title: string;
  prompt: string;
}> = [
  {
    id: 'ambiguity',
    title: 'Неопределённость',
    prompt: 'Мне комфортно начинать задачу, когда путь к результату ещё неясен.',
  },
  {
    id: 'evidence',
    title: 'Доказательства',
    prompt: 'Перед решением я ищу наблюдаемые данные, а не только мнения.',
  },
  {
    id: 'collaboration',
    title: 'Совместная работа',
    prompt: 'Мне нравится собирать решение вместе с людьми разных функций.',
  },
  {
    id: 'persuasion',
    title: 'Влияние',
    prompt: 'Мне по душе убеждать и договариваться без формальной власти.',
  },
  {
    id: 'planning',
    title: 'Организация',
    prompt: 'Я получаю энергию от порядка, сроков и координации зависимостей.',
  },
  {
    id: 'detail',
    title: 'Точность',
    prompt: 'Мне приятно замечать детали и доводить качество до стандарта.',
  },
  {
    id: 'leadership',
    title: 'Ответственность',
    prompt: 'Я хочу держать направление и отвечать за общий результат группы.',
  },
  {
    id: 'craft',
    title: 'Мастерство',
    prompt: 'Мне важно глубоко владеть профессиональным инструментом или методом.',
  },
];

const EMPTY_PREFERENCES = Object.fromEntries(
  DIMENSIONS.map(({ id }) => [id, 0]),
) as WorkPreferenceSubmission;

const FAMILY_LABELS = {
  'product-discovery': 'Продукт и исследование',
  'operations-program': 'Операции и программы',
  'commercial-customer': 'Клиенты и развитие',
  'specialist-analysis': 'Экспертиза и аналитика',
};

const DIMENSION_LABELS: Record<WorkDimension, string> = Object.fromEntries(
  DIMENSIONS.map(({ id, title }) => [id, title]),
) as Record<WorkDimension, string>;

const CASE_OPTIONS = {
  firstMove: {
    legend: 'Первый ход',
    options: [
      ['segment-funnel-and-interviews', 'Разбить воронку по сегментам и поговорить с пользователями'],
      ['review-funnel-only', 'Сначала внимательно изучить общую воронку'],
      ['ship-largest-client-request', 'Сразу реализовать запрос крупнейшего клиента'],
    ],
  },
  priorityRule: {
    legend: 'Правило приоритета',
    options: [
      ['reversible-test-biggest-uncertainty', 'Снять главную неопределённость небольшим обратимым тестом'],
      ['revenue-weighted-request', 'Выбрать запрос с наибольшим текущим вкладом в выручку'],
      ['loudest-stakeholder', 'Взять запрос самого настойчивого стейкхолдера'],
    ],
  },
  successMeasure: {
    legend: 'Признак успеха',
    options: [
      ['activation-by-segment-with-guardrail', 'Рост активации в целевом сегменте без ухудшения удержания'],
      ['delivery-date', 'Выпуск решения к обещанной дате'],
      ['features-shipped', 'Количество выпущенных функций'],
    ],
  },
} as const;

const EMPTY_CASE: ProductCaseSubmission = {
  firstMove: 'segment-funnel-and-interviews',
  priorityRule: 'reversible-test-biggest-uncertainty',
  successMeasure: 'activation-by-segment-with-guardrail',
  rationale: '',
};

export function AssessmentStudio({
  assessments,
  onSaved,
  onBackToCoach,
}: AssessmentStudioProps) {
  const [track, setTrack] = useState<'preferences' | 'case'>('preferences');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const savedPreferences = assessments.find(
    (item) => item.assessmentId === 'work-preferences-v1',
  );
  const savedCase = assessments.find(
    (item) => item.assessmentId === 'product-case-v1',
  );
  const [preferences, setPreferences] = useState<WorkPreferenceSubmission>(
    savedPreferences?.submission ?? EMPTY_PREFERENCES,
  );
  const [productCase, setProductCase] = useState<ProductCaseSubmission>(
    savedCase?.submission ?? EMPTY_CASE,
  );
  const completed = Number(Boolean(savedPreferences)) + Number(Boolean(savedCase));

  async function savePreferences() {
    if (Object.values(preferences).some((answer) => answer < 1)) return;
    setSaving(true);
    setError(undefined);
    try {
      await submitAssessment('work-preferences-v1', preferences);
      await onSaved();
      setEditing(false);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveCase() {
    setSaving(true);
    setError(undefined);
    try {
      await submitAssessment('product-case-v1', productCase);
      await onSaved();
      setEditing(false);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSaving(false);
    }
  }

  function switchTrack(next: 'preferences' | 'case') {
    setTrack(next);
    setEditing(false);
    setError(undefined);
  }

  return (
    <section className="assessment-studio" aria-label="Проверка карьерных ролей">
      <header className="assessment-hero">
        <div>
          <button className="assessment-back" onClick={onBackToCoach}>
            <span aria-hidden="true">←</span> Вернуться к разговору
          </button>
          <p className="eyebrow">Лаборатория роли</p>
          <h1>Не угадываем роль. Проверяем гипотезу.</h1>
          <p>
            Сначала отделим предпочтения от способностей. Затем посмотрим на
            решения в коротком рабочем кейсе — с открытой логикой разбора.
          </p>
        </div>
        <div className="assessment-progress" aria-label={`${completed} из 2 завершено`}>
          <strong>{completed}<span>/2</span></strong>
          <small>проверки завершено</small>
          <i><span style={{ width: `${completed * 50}%` }} /></i>
        </div>
      </header>

      <nav className="assessment-tabs" aria-label="Виды проверки">
        <button
          className={track === 'preferences' ? 'is-active' : ''}
          onClick={() => switchTrack('preferences')}
          aria-current={track === 'preferences' ? 'page' : undefined}
        >
          <span>01</span>
          <div><strong>Как нравится работать</strong><small>8 наблюдений · 4 семейства</small></div>
          {savedPreferences ? <i aria-label="Завершено">✓</i> : null}
        </button>
        <button
          className={track === 'case' ? 'is-active' : ''}
          onClick={() => switchTrack('case')}
          aria-current={track === 'case' ? 'page' : undefined}
        >
          <span>02</span>
          <div><strong>Product / PM кейс</strong><small>3 решения · видимая рубрика</small></div>
          {savedCase ? <i aria-label="Завершено">✓</i> : null}
        </button>
      </nav>

      {error ? <div className="assessment-error" role="alert">{error}</div> : null}

      {track === 'preferences' ? (
        savedPreferences && !editing ? (
          <PreferenceResult
            assessment={savedPreferences}
            onRetake={() => setEditing(true)}
            onNext={() => switchTrack('case')}
          />
        ) : (
          <PreferenceForm
            value={preferences}
            onChange={setPreferences}
            onSubmit={() => void savePreferences()}
            saving={saving}
          />
        )
      ) : savedCase && !editing ? (
        <CaseResult assessment={savedCase} onRetake={() => setEditing(true)} />
      ) : (
        <CaseForm
          value={productCase}
          onChange={setProductCase}
          onSubmit={() => void saveCase()}
          saving={saving}
        />
      )}
    </section>
  );
}

function PreferenceForm({
  value,
  onChange,
  onSubmit,
  saving,
}: {
  value: WorkPreferenceSubmission;
  onChange: (value: WorkPreferenceSubmission) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  const answered = Object.values(value).filter((answer) => answer > 0).length;
  return (
    <div className="assessment-body">
      <div className="assessment-intro">
        <div><span>Самоотчёт</span><span>≈ 3 минуты</span></div>
        <h2>В каком режиме вы раскрываетесь?</h2>
        <p>Оцените не «как правильно», а сколько энергии вам обычно даёт такой способ работы.</p>
      </div>
      <form
        className="preference-form"
        onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
      >
        {DIMENSIONS.map((dimension, index) => (
          <fieldset key={dimension.id}>
            <legend>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{dimension.title}</strong><small>{dimension.prompt}</small></div>
            </legend>
            <div className="rating-row">
              {[1, 2, 3, 4, 5].map((rating) => (
                <label key={rating} className={value[dimension.id] === rating ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name={dimension.id}
                    value={rating}
                    checked={value[dimension.id] === rating}
                    onChange={() => onChange({ ...value, [dimension.id]: rating })}
                  />
                  <span>{rating}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="assessment-submit">
          <div><strong>{answered} из 8</strong><small>Все ответы можно изменить после разбора</small></div>
          <button className="button button--primary" disabled={answered < 8 || saving}>
            {saving ? 'Сохраняем…' : 'Показать наблюдения'} <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function PreferenceResult({
  assessment,
  onRetake,
  onNext,
}: {
  assessment: Extract<StoredAssessment, { assessmentId: 'work-preferences-v1' }>;
  onRetake: () => void;
  onNext: () => void;
}) {
  return (
    <div className="assessment-body result-view">
      <div className="assessment-intro">
        <div><span>Наблюдение сохранено</span><span>{formatDate(assessment.updatedAt)}</span></div>
        <h2>Ближе всего — {FAMILY_LABELS[assessment.result.roleFamilies[0].id]}</h2>
        <p>Это карта предпочитаемого режима работы. Она не измеряет способности и не закрывает другие роли.</p>
      </div>
      <div className="family-grid">
        {assessment.result.roleFamilies.map((family, index) => (
          <article key={family.id} className={index === 0 ? 'is-leading' : ''}>
            <div className="family-rank"><span>0{index + 1}</span><strong>{family.signalStrength}</strong><small>сигнал</small></div>
            <h3>{FAMILY_LABELS[family.id]}</h3>
            <div className="signal-track"><span style={{ width: `${family.signalStrength}%` }} /></div>
            <details open={index === 0}>
              <summary>Из чего сложилось</summary>
              <ul>
                {family.contributions.map((item) => (
                  <li key={item.dimension}><span>{DIMENSION_LABELS[item.dimension]}</span><strong>{item.answer}/5 × {item.weight}</strong></li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
      <p className="assessment-caveat">{assessment.result.caveat}</p>
      <div className="result-actions">
        <button className="button button--quiet" onClick={onRetake}>Изменить ответы</button>
        <button className="button button--primary" onClick={onNext}>Перейти к рабочему кейсу <span aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}

function CaseForm({
  value,
  onChange,
  onSubmit,
  saving,
}: {
  value: ProductCaseSubmission;
  onChange: (value: ProductCaseSubmission) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  const keys = Object.keys(CASE_OPTIONS) as Array<keyof typeof CASE_OPTIONS>;
  return (
    <div className="assessment-body case-layout">
      <aside className="case-brief">
        <div><span>Рабочая ситуация</span><span>Product / PM</span></div>
        <h2>Активация нового сегмента падает</h2>
        <p>Команда B2B-продукта вышла в сегмент небольших компаний. Регистраций много, но до первой ценности доходит 18% пользователей вместо ожидаемых 35%.</p>
        <ul>
          <li>Крупный клиент просит новую интеграцию.</li>
          <li>Продажи считают onboarding слишком сложным.</li>
          <li>До планирования следующего цикла — пять дней.</li>
        </ul>
        <small>Здесь нет единственно правильной карьеры. Мы смотрим только на три решения в этой ситуации.</small>
      </aside>
      <form className="case-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        {keys.map((key, index) => {
          const group = CASE_OPTIONS[key];
          return (
            <fieldset key={key}>
              <legend><span>0{index + 1}</span>{group.legend}</legend>
              {group.options.map(([id, label]) => (
                <label key={id} className={value[key] === id ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name={key}
                    value={id}
                    checked={value[key] === id}
                    onChange={() => onChange({ ...value, [key]: id })}
                  />
                  <span aria-hidden="true" />
                  <strong>{label}</strong>
                </label>
              ))}
            </fieldset>
          );
        })}
        <label className="case-rationale">
          <span>Почему вы выбрали этот путь? <small>необязательно</small></span>
          <textarea
            value={value.rationale}
            onChange={(event) => onChange({ ...value, rationale: event.target.value })}
            maxLength={2_000}
            rows={4}
            placeholder="Опишите ход мысли, риски или данные, которых вам не хватает…"
          />
          <small>{value.rationale.length} / 2 000</small>
        </label>
        <button className="button button--primary case-submit" disabled={saving}>
          {saving ? 'Разбираем…' : 'Разобрать решения'} <span aria-hidden="true">→</span>
        </button>
      </form>
    </div>
  );
}

function CaseResult({
  assessment,
  onRetake,
}: {
  assessment: Extract<StoredAssessment, { assessmentId: 'product-case-v1' }>;
  onRetake: () => void;
}) {
  return (
    <div className="assessment-body result-view">
      <div className="assessment-intro">
        <div><span>Кейс сохранён</span><span>{formatDate(assessment.updatedAt)}</span></div>
        <h2>Три решения — три наблюдаемых сигнала</h2>
        <p>{assessment.result.summary}</p>
      </div>
      <div className="rubric-grid">
        {assessment.result.rubric.map((item, index) => (
          <article key={item.criterion}>
            <span>0{index + 1}</span>
            <small>{criterionLabel(item.criterion)}</small>
            <strong>{item.points}<i>/2</i></strong>
            <p>{optionLabel(item.selectedOption)}</p>
          </article>
        ))}
      </div>
      <div className="case-findings">
        <section>
          <h3><span aria-hidden="true">✓</span> Что проявилось</h3>
          {assessment.result.demonstratedSignals.length ? (
            <ul>{assessment.result.demonstratedSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul>
          ) : <p>Короткий кейс пока не дал сильного сигнала — это нормальная отправная точка.</p>}
        </section>
        <section>
          <h3><span aria-hidden="true">?</span> Что проверить дальше</h3>
          {assessment.result.openQuestions.length ? (
            <ul>{assessment.result.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
          ) : <p>В этой рубрике открытых вопросов не осталось. Следующий шаг — более реалистичный кейс и интервью.</p>}
        </section>
      </div>
      <p className="assessment-caveat">{assessment.result.caveat}</p>
      <div className="result-actions"><button className="button button--quiet" onClick={onRetake}>Пройти кейс заново</button></div>
    </div>
  );
}

function criterionLabel(criterion: string): string {
  return ({
    'problem-framing': 'Постановка проблемы',
    'evidence-prioritisation': 'Приоритет по данным',
    'outcome-measurement': 'Измерение результата',
  } as Record<string, string>)[criterion] ?? criterion;
}

function optionLabel(option: string): string {
  for (const group of Object.values(CASE_OPTIONS)) {
    const found = group.options.find(([id]) => id === option);
    if (found) return found[1];
  }
  return option;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(value));
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Не удалось сохранить результат.';
}
