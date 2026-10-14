import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pendingApprovalCount, ResponsesAutomationLink } from './ResponsesAutomationLink';

describe('ResponsesAutomationLink', () => {
  it('does not show an automation row when the approval count is missing or zero', () => {
    expect(pendingApprovalCount(null)).toBeNull();
    expect(pendingApprovalCount({ queueCounts: { pending_approval: 0 } })).toBeNull();
    expect(
      renderToStaticMarkup(
        <ResponsesAutomationLink count={null} onOpenAutomation={() => undefined} />,
      ),
    ).toBe('');
  });

  it('uses the pending approval count from the automation snapshot', () => {
    const count = pendingApprovalCount({ queueCounts: { pending_approval: 3 } });
    const markup = renderToStaticMarkup(
      <ResponsesAutomationLink count={count} onOpenAutomation={() => undefined} />,
    );

    expect(count).toBe(3);
    expect(markup).toContain('3 ждут');
    expect(markup).toContain('Автоматизация, 3 ждут одобрения');
  });
});
