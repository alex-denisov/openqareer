import type { RefCallback } from 'react';
import type { InterviewSessionView } from './interviewSimulatorApi';

export interface MockInterviewVacancy {
  readonly id: string;
  readonly title: string;
  readonly company?: string;
  readonly descriptionSummary?: string;
  readonly skills?: readonly string[];
  readonly location?: string;
  readonly isRemote?: boolean;
  /** Отклик, по которому идёт тренировка: сервер берёт роль из него. */
  readonly applicationId?: string;
  /** Назначенное интервью по отклику, ISO. */
  readonly interviewAt?: string;
  /** Площадка вакансии, например «hh.ru». */
  readonly source?: string;
  /** Когда вакансия сохранена в отклике, ISO. */
  readonly sourceSavedAt?: string;
}

export interface InterviewDiaryEntry {
  readonly session: InterviewSessionView;
}

export type InterviewDiaryPort = (entry: InterviewDiaryEntry) => Promise<void>;

export interface MockInterviewSimulatorProps {
  readonly vacancy: MockInterviewVacancy;
  readonly dialogRef: RefCallback<HTMLDivElement>;
  readonly onBackToPreparation: () => void;
  readonly onOpenStarStories: (afterClose?: () => void) => void;
  readonly onAskConsultant?: () => void;
  readonly onWriteDiary?: InterviewDiaryPort;
  /** Initial value of the «Стресс-режим» option on the setup screen. */
  readonly initialStressMode?: boolean;
}
