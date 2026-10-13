import {
  CITY_DIRECTORY,
  DEFAULT_FIRST_RUN_DATA,
  POPULAR_CITIES,
  type FirstRunCity,
  type FirstRunData,
  type SourceType,
  type WorkFormat,
} from './firstRunTypes';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import type { IngestedResume } from '../journey/useResumeIngestion';

export { CITY_DIRECTORY, DEFAULT_FIRST_RUN_DATA, POPULAR_CITIES, type FirstRunCity };

export function filterCities(
  query: string,
  cities: readonly FirstRunCity[] = CITY_DIRECTORY,
): FirstRunCity[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [...POPULAR_CITIES];
  return cities.filter(
    (c) =>
      c.name.toLowerCase().includes(clean) ||
      c.country.toLowerCase().includes(clean) ||
      (c.region && c.region.toLowerCase() === clean),
  );
}

export function selectCity(data: FirstRunData, city: FirstRunCity): FirstRunData {
  return {
    ...data,
    context: {
      ...data.context,
      city: city.name,
      country: city.country,
      region: city.region,
    },
  };
}

export function firstRunDataToWorkspaceInput(
  data: FirstRunData,
  result?: IngestedResume,
): WorkspaceInput {
  const resumeSource =
    data.selectedSource === 'file'
      ? (result?.source ?? 'pdf')
      : data.selectedSource === 'hh'
      ? 'hh-pdf'
      : data.selectedSource === 'linkedin'
      ? 'linkedin-pdf'
      : 'text';

  return {
    careerGoal: 'choose-role',
    resumeText: result?.text ?? '',
    resumeSource,
    resumeFileName: result?.file?.name,
    resumePageCount: result?.file?.pages,
    targetDirection: '',
    regions: data.context.region ? [data.context.region] : ['ru'],
    currentSituation: data.goal,
    constraints: [data.context.format, data.context.city].filter(Boolean).join(', '),
    urgency: 'active',
  };
}

export function skipSourceStep(data: FirstRunData): FirstRunData {
  return {
    ...data,
    isSourceSkipped: true,
    selectedSource: null,
  };
}

export function restoreSourceStep(
  data: FirstRunData,
  source: SourceType = 'linkedin',
): FirstRunData {
  return {
    ...data,
    isSourceSkipped: false,
    selectedSource: source,
  };
}

export function setGoal(data: FirstRunData, goal: string): FirstRunData {
  return { ...data, goal };
}

export function setWorkFormat(data: FirstRunData, format: WorkFormat): FirstRunData {
  return {
    ...data,
    context: { ...data.context, format },
  };
}

export function setRelocationReady(data: FirstRunData, isRelocationReady: boolean): FirstRunData {
  return {
    ...data,
    context: { ...data.context, isRelocationReady },
  };
}

export function getConsultantReply(question: string): string {
  const q = question.toLowerCase();
  if (q.includes('с чего начать')) {
    return 'Начнём с источника. Подключите LinkedIn или hh.ru, загрузите резюме или просто расскажите, чем занимаетесь.';
  }
  if (q.includes('можно без linkedin')) {
    return 'Да, можно подключить hh.ru, загрузить файл резюме (PDF или DOCX) или просто рассказать о своём опыте здесь в диалоге.';
  }
  if (q.includes('что вы читаете в linkedin') || q.includes('linkedin')) {
    return 'Читаем только выбранные разделы: места работы, образование, навыки, языки, проекты, курсы, контакты. Никаких личных сообщений или публикаций без вашего одобрения.';
  }
  return 'Расскажите подробнее о вашем опыте: сколько лет в управлении, какие команды вели и в какую компанию хотите попасть?';
}
