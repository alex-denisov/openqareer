export type MockInterviewScreen =
  | 'setup'
  | 'preparing'
  | 'question'
  | 'voice'
  | 'review'
  | 'interrupted'
  | 'result'
  | 'paywall';

export type MockInterviewQuestionScope = 'both' | 'behavioral' | 'system_design';
