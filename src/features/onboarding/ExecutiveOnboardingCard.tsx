import { useState, useId, type FormEvent } from 'react';
import {
  Sparkle,
  ShieldCheck,
  Plus,
  Target,
  CheckSquare,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';
import {
  calculateOnboardingProgress,
  generateStageAdvice,
  sanitizeWorkplaceInput,
  toggleTask,
  addGoal,
  addQuantum,
  type ExecutiveOnboardingState,
  type OnboardingStage,
  type TaskCategory,
} from './executiveOnboarding';
import {
  loadExecutiveOnboardingState,
  saveExecutiveOnboardingState,
} from './executiveOnboardingStorage';
import './executiveOnboardingCard.css';

const STAGE_LABELS: Record<OnboardingStage, string> = {
  prep: 'Подготовка',
  'days-30': '30 дней',
  'days-60': '60 дней',
  'days-90': '90 дней',
};

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  people: 'Люди',
  strategy: 'Стратегия',
  delivery: 'Поставка',
  alignment: 'Ожидания',
};

const STAGES: readonly OnboardingStage[] = ['prep', 'days-30', 'days-60', 'days-90'];

interface StageTabsProps {
  readonly activeStage: OnboardingStage;
  readonly stagePercent: Record<OnboardingStage, number>;
  readonly onSelectStage: (stage: OnboardingStage) => void;
}

function StageTabs({ activeStage, stagePercent, onSelectStage }: StageTabsProps) {
  return (
    <div className="career-onboarding-tabs" role="tablist" aria-label="Этапы адаптации">
      {STAGES.map((stage) => {
        const isSelected = activeStage === stage;
        const percent = stagePercent[stage] ?? 0;
        return (
          <button
            key={stage}
            type="button"
            role="tab"
            aria-selected={isSelected}
            className="career-onboarding-tab-btn"
            data-testid={`stage-tab-${stage}`}
            onClick={() => onSelectStage(stage)}
          >
            <span>{STAGE_LABELS[stage]}</span>
            <span className="career-onboarding-category-badge">{percent}%</span>
          </button>
        );
      })}
    </div>
  );
}

interface CoachAdviceProps {
  readonly activeStage: OnboardingStage;
  readonly roleTitle: string;
}

function CoachAdviceBlock({ activeStage, roleTitle }: CoachAdviceProps) {
  const adviceList = generateStageAdvice(activeStage, roleTitle);

  return (
    <div className="career-onboarding-advice-box" data-testid="coach-advice-box">
      <div className="career-onboarding-advice-title">
        <Sparkle size={18} aria-hidden="true" />
        <span>Совет стратега на этот этап</span>
      </div>
      <ul className="career-onboarding-advice-list">
        {adviceList.map((advice, index) => (
          <li key={index} className="career-onboarding-advice-item">
            {advice}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TaskChecklistProps {
  readonly state: ExecutiveOnboardingState;
  readonly onToggleTask: (taskId: string) => void;
}

function TaskChecklist({ state, onToggleTask }: TaskChecklistProps) {
  const currentTasks = state.tasks.filter((t) => t.stage === state.activeStage);

  return (
    <div>
      <div className="career-onboarding-section-title">
        Задачи этапа ({STAGE_LABELS[state.activeStage]})
      </div>
      <ul className="career-onboarding-task-list" data-testid="onboarding-task-list">
        {currentTasks.map((task) => {
          const checkboxId = `task-chk-${task.id}`;
          return (
            <li key={task.id} className="career-onboarding-task-item">
              <input
                id={checkboxId}
                type="checkbox"
                checked={task.completed}
                onChange={() => onToggleTask(task.id)}
                className="career-onboarding-task-checkbox"
                data-testid={`task-checkbox-${task.id}`}
              />
              <div className="career-onboarding-task-content">
                <div className="career-onboarding-task-eyebrow">
                  <span className="career-onboarding-category-badge">
                    {CATEGORY_LABELS[task.category] || task.category}
                  </span>
                </div>
                <label
                  htmlFor={checkboxId}
                  className={`career-onboarding-task-title ${
                    task.completed ? 'is-completed' : ''
                  }`}
                >
                  {task.title}
                </label>
                <p className="career-onboarding-task-desc">{task.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function validateAndSanitizeInputs(s: string, a: string, r: string) {
  const sCheck = sanitizeWorkplaceInput(s);
  const aCheck = sanitizeWorkplaceInput(a);
  const rCheck = sanitizeWorkplaceInput(r);
  const safe = sCheck.safe && aCheck.safe && rCheck.safe;
  const warning = !safe
    ? sCheck.warning || aCheck.warning || rCheck.warning || 'Обнаружены конфиденциальные данные'
    : null;

  return {
    warning,
    quantum: {
      situation: sCheck.sanitizedText.trim(),
      action: aCheck.sanitizedText.trim(),
      result: rCheck.sanitizedText.trim(),
    },
  };
}

function QuantumField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder: string;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
      />
    </>
  );
}

function useQuantumForm(
  onAddQuantum: (quantum: { situation: string; action: string; result: string }) => void
) {
  const [situation, setSituation] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [ndaWarning, setNdaWarning] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!situation.trim() || !action.trim() || !result.trim()) return;

    const res = validateAndSanitizeInputs(situation, action, result);
    setNdaWarning(res.warning);
    onAddQuantum(res.quantum);
    setSituation('');
    setAction('');
    setResult('');
  };

  return {
    situation,
    setSituation,
    action,
    setAction,
    result,
    setResult,
    ndaWarning,
    handleSubmit,
  };
}

interface QuantumFormProps {
  readonly onAddQuantum: (quantum: { situation: string; action: string; result: string }) => void;
}

function QuantumForm({ onAddQuantum }: QuantumFormProps) {
  const {
    situation,
    setSituation,
    action,
    setAction,
    result,
    setResult,
    ndaWarning,
    handleSubmit,
  } = useQuantumForm(onAddQuantum);

  return (
    <form onSubmit={handleSubmit} className="career-onboarding-form" data-testid="quantum-form">
      <QuantumField
        id="quantum-situation"
        label="Ситуация (контекст и вызов):"
        value={situation}
        onChange={setSituation}
        placeholder="Опишите контекст задачи"
      />
      <QuantumField
        id="quantum-action"
        label="Действие (что конкретно сделали):"
        value={action}
        onChange={setAction}
        placeholder="Ваши управленческие и технические действия"
      />
      <QuantumField
        id="quantum-result"
        label="Результат (метрики и эффект):"
        value={result}
        onChange={setResult}
        placeholder="Измеримый результат и влияние на бизнес"
      />
      {ndaWarning ? (
        <div className="career-onboarding-nda-warning" role="alert" data-testid="nda-warning">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{ndaWarning}</span>
        </div>
      ) : null}
      <div className="career-onboarding-form-actions">
        <button type="submit" className="career-btn career-btn-secondary" data-testid="save-quantum-btn">
          <CheckSquare size={16} aria-hidden="true" />
          <span>Сохранить квант</span>
        </button>
      </div>
    </form>
  );
}

function QuantumList({ quantums }: { readonly quantums: ExecutiveOnboardingState['quantums'] }) {
  if (quantums.length === 0) return null;
  return (
    <ul className="career-onboarding-items-list" data-testid="quantums-list">
      {quantums.map((q) => (
        <li key={q.id} className="career-onboarding-quantum-card">
          <div className="career-onboarding-quantum-header">
            <strong>{q.date}</strong>
            <span className="career-onboarding-category-badge">STAR</span>
          </div>
          <p><strong>Ситуация:</strong> {q.situation}</p>
          <p><strong>Действие:</strong> {q.action}</p>
          <p><strong>Результат:</strong> {q.result}</p>
        </li>
      ))}
    </ul>
  );
}

interface QuantumLoggerProps {
  readonly state: ExecutiveOnboardingState;
  readonly onAddQuantum: (quantum: { situation: string; action: string; result: string }) => void;
}

function QuantumLogger({ state, onAddQuantum }: QuantumLoggerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="career-btn career-btn-secondary"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="toggle-quantum-form-btn"
      >
        <Plus size={16} aria-hidden="true" />
        <span>{isOpen ? 'Скрыть форму кванта' : 'Зафиксировать квант опыта (STAR)'}</span>
      </button>

      {isOpen ? <QuantumForm onAddQuantum={onAddQuantum} /> : null}
      <QuantumList quantums={state.quantums} />
    </div>
  );
}

function GoalForm({ onAddGoal }: { readonly onAddGoal: (g: { title: string; type: string }) => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('стратегическая');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAddGoal({ title: title.trim(), type });
    setTitle('');
  };

  return (
    <form onSubmit={handleSubmit} className="career-onboarding-form" data-testid="goal-form">
      <label htmlFor="goal-title">Цель или ключевой результат (OKR):</label>
      <input
        id="goal-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Например: Сократить релизный цикл до 2 дней"
        required
      />

      <label htmlFor="goal-type">Тип цели:</label>
      <input
        id="goal-type"
        value={type}
        onChange={(e) => setType(e.target.value)}
        placeholder="Стратегическая, операционная или командная"
      />

      <div className="career-onboarding-form-actions">
        <button type="submit" className="career-btn career-btn-secondary" data-testid="save-goal-btn">
          <Plus size={16} aria-hidden="true" />
          <span>Добавить цель</span>
        </button>
      </div>
    </form>
  );
}

function GoalList({ goals }: { readonly goals: ExecutiveOnboardingState['goals'] }) {
  if (goals.length === 0) return null;
  return (
    <ul className="career-onboarding-items-list" data-testid="goals-list">
      {goals.map((g) => (
        <li key={g.id} className="career-onboarding-goal-card">
          <div className="career-onboarding-goal-header">
            <strong>{g.title}</strong>
            <span className="career-onboarding-status-pill">{g.status}</span>
          </div>
          <span className="career-onboarding-category-badge">{g.type}</span>
        </li>
      ))}
    </ul>
  );
}

interface GoalTrackerProps {
  readonly state: ExecutiveOnboardingState;
  readonly onAddGoal: (goal: { title: string; type: string }) => void;
}

function GoalTracker({ state, onAddGoal }: GoalTrackerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="career-btn career-btn-secondary"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="toggle-goal-form-btn"
      >
        <Target size={16} aria-hidden="true" />
        <span>{isOpen ? 'Скрыть форму цели' : 'Добавить ключевой OKR / цель'}</span>
      </button>

      {isOpen ? <GoalForm onAddGoal={onAddGoal} /> : null}
      <GoalList goals={state.goals} />
    </div>
  );
}

function useExecutiveOnboarding() {
  const [state, setState] = useState<ExecutiveOnboardingState>(loadExecutiveOnboardingState);
  const [isExpanded, setIsExpanded] = useState(true);

  const updateState = (updater: (prev: ExecutiveOnboardingState) => ExecutiveOnboardingState) => {
    setState((prev) => {
      const next = updater(prev);
      saveExecutiveOnboardingState(next);
      return next;
    });
  };

  const handleSelectStage = (stage: OnboardingStage) => {
    updateState((prev) => ({ ...prev, activeStage: stage }));
  };

  const handleToggleTask = (taskId: string) => {
    updateState((prev) => toggleTask(prev, taskId));
  };

  const handleAddQuantum = (quantum: { situation: string; action: string; result: string }) => {
    updateState((prev) => addQuantum(prev, quantum));
  };

  const handleAddGoal = (goal: { title: string; type: string }) => {
    updateState((prev) => addGoal(prev, goal));
  };

  const progress = calculateOnboardingProgress(state);

  return {
    state,
    isExpanded,
    setIsExpanded,
    handleSelectStage,
    handleToggleTask,
    handleAddQuantum,
    handleAddGoal,
    progress,
  };
}

interface CardHeaderProps {
  readonly titleId: string;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly overallPercent: number;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
}

function CardHeader({
  titleId,
  completedCount,
  totalCount,
  overallPercent,
  isExpanded,
  onToggleExpand,
}: CardHeaderProps) {
  return (
    <div className="career-onboarding-header">
      <div className="career-onboarding-title-wrap">
        <h2 id={`${titleId}-title`} className="career-onboarding-title">
          Executive-онбординг: 30-60-90 дней
        </h2>
        <p className="career-onboarding-subtitle">
          Пошаговый план и советник стратега для первых месяцев в компании
        </p>
      </div>
      <div className="career-onboarding-meta">
        <span className="career-onboarding-progress-badge" data-testid="onboarding-progress-badge">
          {completedCount} из {totalCount} ({overallPercent}%)
        </span>
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          data-testid="toggle-expand-card-btn"
        >
          {isExpanded ? <CaretUp size={14} aria-hidden="true" /> : <CaretDown size={14} aria-hidden="true" />}
          <span>{isExpanded ? 'Свернуть' : 'Развернуть'}</span>
        </button>
      </div>
    </div>
  );
}

interface CardBodyProps {
  readonly state: ExecutiveOnboardingState;
  readonly progress: ReturnType<typeof calculateOnboardingProgress>;
  readonly onSelectStage: (stage: OnboardingStage) => void;
  readonly onToggleTask: (taskId: string) => void;
  readonly onAddQuantum: (quantum: { situation: string; action: string; result: string }) => void;
  readonly onAddGoal: (goal: { title: string; type: string }) => void;
}

function CardBody({
  state,
  progress,
  onSelectStage,
  onToggleTask,
  onAddQuantum,
  onAddGoal,
}: CardBodyProps) {
  return (
    <div>
      <StageTabs
        activeStage={state.activeStage}
        stagePercent={progress.stagePercent}
        onSelectStage={onSelectStage}
      />
      <CoachAdviceBlock activeStage={state.activeStage} roleTitle={state.roleTitle} />
      <TaskChecklist state={state} onToggleTask={onToggleTask} />
      <div className="career-onboarding-form-actions">
        <QuantumLogger state={state} onAddQuantum={onAddQuantum} />
        <GoalTracker state={state} onAddGoal={onAddGoal} />
      </div>
    </div>
  );
}

export function ExecutiveOnboardingCard() {
  const id = useId();
  const {
    state,
    isExpanded,
    setIsExpanded,
    handleSelectStage,
    handleToggleTask,
    handleAddQuantum,
    handleAddGoal,
    progress,
  } = useExecutiveOnboarding();

  return (
    <section
      className="career-onboarding-card"
      aria-labelledby={`${id}-title`}
      data-testid="executive-onboarding-card"
    >
      <CardHeader
        titleId={id}
        completedCount={progress.completedCount}
        totalCount={progress.totalCount}
        overallPercent={progress.overallPercent}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
      />

      <div className="career-onboarding-progress-bar-wrap">
        <div
          className="career-onboarding-progress-bar-fill"
          data-testid="onboarding-progress-bar-fill"
          data-percent={progress.overallPercent}
        />
      </div>

      {isExpanded ? (
        <CardBody
          state={state}
          progress={progress}
          onSelectStage={handleSelectStage}
          onToggleTask={handleToggleTask}
          onAddQuantum={handleAddQuantum}
          onAddGoal={handleAddGoal}
        />
      ) : null}
    </section>
  );
}
