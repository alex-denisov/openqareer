import { ChartLineUp, Lightning, Notebook } from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import type { ShellSection } from './shellNavigation';
import { ProfileIcon, ResponsesIcon, TodayIcon, VacanciesIcon } from './sectionIcons';
import type { SectionIconProps } from './sectionIcons';

export type SectionIcon = (props: SectionIconProps) => ReactElement;

export interface NavigationItem {
  readonly key: ShellSection;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly icon: SectionIcon;
  readonly target: ShellSection;
}

function CareerIcon({ size = 22, active = false }: SectionIconProps) {
  return <ChartLineUp size={size} weight={active ? 'fill' : 'regular'} aria-hidden="true" />;
}

function AutomationIcon({ size = 22, active = false }: SectionIconProps) {
  return <Lightning size={size} weight={active ? 'fill' : 'regular'} aria-hidden="true" />;
}

function DiaryIcon({ size = 22, active = false }: SectionIconProps) {
  return <Notebook size={size} weight={active ? 'fill' : 'regular'} aria-hidden="true" />;
}

export const primaryNavigation: readonly NavigationItem[] = [
  { key: 'today', label: 'Сегодня', icon: TodayIcon, target: 'today' },
  { key: 'profile', label: 'Профиль', icon: ProfileIcon, target: 'profile' },
  { key: 'opportunities', label: 'Вакансии', icon: VacanciesIcon, target: 'opportunities' },
  { key: 'responses', label: 'Отклики', icon: ResponsesIcon, target: 'responses' },
  { key: 'diary', label: 'Карьерный дневник', icon: DiaryIcon, target: 'diary' },
];

export const railNavigation: readonly NavigationItem[] = [
  { key: 'today', label: 'Сегодня', icon: TodayIcon, target: 'today' },
  { key: 'profile', label: 'Профиль', icon: ProfileIcon, target: 'profile' },
  { key: 'career', label: 'Карьера', icon: CareerIcon, target: 'career' },
  { key: 'opportunities', label: 'Вакансии', icon: VacanciesIcon, target: 'opportunities' },
  { key: 'responses', label: 'Отклики', icon: ResponsesIcon, target: 'responses' },
  {
    key: 'diary',
    label: 'Дневник',
    ariaLabel: 'Карьерный дневник',
    icon: DiaryIcon,
    target: 'diary',
  },
  { key: 'automation', label: 'Автоматизация', icon: AutomationIcon, target: 'automation' },
];
