import {
  Briefcase,
  CalendarCheck,
  Lightning,
  Notebook,
  PaperPlaneTilt,
  TrendUp,
  UserCircle,
} from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import type { ShellSection } from './shellNavigation';
import type { SectionIconProps } from './sectionIcons';

export type SectionIcon = (props: SectionIconProps) => ReactElement;

export interface NavigationItem {
  readonly key: ShellSection;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly icon: SectionIcon;
  readonly target: ShellSection;
}

function TodayIcon({ size = 22 }: SectionIconProps) {
  return <CalendarCheck size={size} weight="regular" aria-hidden="true" />;
}

function ProfileIcon({ size = 22 }: SectionIconProps) {
  return <UserCircle size={size} weight="regular" aria-hidden="true" />;
}

function VacanciesIcon({ size = 22 }: SectionIconProps) {
  return <Briefcase size={size} weight="regular" aria-hidden="true" />;
}

function ResponsesIcon({ size = 22 }: SectionIconProps) {
  return <PaperPlaneTilt size={size} weight="regular" aria-hidden="true" />;
}

function CareerIcon({ size = 22 }: SectionIconProps) {
  return <TrendUp size={size} weight="regular" aria-hidden="true" />;
}

function AutomationIcon({ size = 22 }: SectionIconProps) {
  return <Lightning size={size} weight="regular" aria-hidden="true" />;
}

function DiaryIcon({ size = 22 }: SectionIconProps) {
  return <Notebook size={size} weight="regular" aria-hidden="true" />;
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
