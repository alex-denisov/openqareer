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
}
