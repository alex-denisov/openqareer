// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { InterviewDiaryAction } from './InterviewDiaryAction';
import { saveInterviewPractice } from './interviewDiaryApi';
vi.mock('./interviewDiaryApi', () => ({ saveInterviewPractice: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('B465 diary save action', () => {
  it('retries failure then opens the persisted diary record', async () => {
    vi.mocked(saveInterviewPractice).mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ id: 'one', source: 'mock_interview', createdAt: '2026-10-19T10:00:00Z', session: { id: 'one', version: 3, status: 'completed', roleTitle: 'Engineer', questions: [] } });
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<InterviewDiaryAction sessionId="one" />));
      await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
      expect(host.querySelector('[role=alert]')).not.toBeNull();
      await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
      expect(host.querySelector('[role=status]')?.textContent).toContain('сохранена');
      await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
      expect(host.querySelector('article')?.textContent).toContain('Engineer');
      expect(saveInterviewPractice).toHaveBeenNthCalledWith(2, 'one');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
