import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CareerDiaryWorkplace } from '../../../shared/careerDiary';
import { sendCoachTurn } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { adaptationPlanProgress, type CareerDiaryAdaptationPlan, type CareerDiaryAdaptationStage } from './careerDiaryPlanning';

export function useCareerDiaryAdaptationConsultant(
  workplace: CareerDiaryWorkplace | null,
  plan: CareerDiaryAdaptationPlan | null,
  stage: CareerDiaryAdaptationStage,
) {
  const prompt = useMemo(() => buildPlanPrompt(workplace, plan, stage), [plan, stage, workplace]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pending = useRef<{ content: string; idempotencyKey: string; messageId: string } | null>(null);

  useEffect(() => {
    setAnswer(null);
    setError(null);
    pending.current = null;
  }, [prompt]);

  const ask = useCallback(async (): Promise<void> => {
    if (!prompt || sending) return;
    if (!pending.current || pending.current.content !== prompt) {
      pending.current = {
        content: prompt,
        idempotencyKey: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
      };
    }
    setSending(true);
    setError(null);
    try {
      const result = await sendCoachTurn({
        content: prompt,
        stage: 'today',
        idempotencyKey: pending.current.idempotencyKey,
        messageId: pending.current.messageId,
      });
      setAnswer(result.message);
      pending.current = null;
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось получить ответ консультанта.'));
    } finally {
      setSending(false);
    }
  }, [prompt, sending]);

  return { answer, error, sending, ask };
}

function buildPlanPrompt(
  workplace: CareerDiaryWorkplace | null,
  plan: CareerDiaryAdaptationPlan | null,
  stage: CareerDiaryAdaptationStage,
): string | null {
  if (!workplace || !plan) return null;
  const progress = adaptationPlanProgress(plan, stage);
  const nextTask = plan.tasks.find((task) => task.stage === stage && !task.completed);
  return [
    `Помогите обсудить мой план адаптации 30–60–90 в компании «${workplace.company}» на позиции «${workplace.title}».`,
    `Дата выхода: ${workplace.startDate}. Текущий этап: ${stageLabel(stage)}.`,
    `На этом этапе выполнено ${progress.completed} из ${progress.total} задач.`,
    nextTask ? `Ближайшая незавершённая задача: «${nextTask.title}», срок ${nextTask.dueDate}.` : 'Незавершённых задач на этапе нет.',
    'Опирайтесь только на эти факты; неизвестное обозначьте явно.',
  ].join(' ');
}

function stageLabel(stage: CareerDiaryAdaptationStage): string {
  const labels: Record<CareerDiaryAdaptationStage, string> = {
    prep: 'Подготовка',
    days_1_30: 'Дни 1–30',
    days_31_60: 'Дни 31–60',
    days_61_90: 'Дни 61–90',
  };
  return labels[stage];
}
