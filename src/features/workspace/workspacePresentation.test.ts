import { describe, expect, it } from 'vitest';
import { visibleTargetDirection } from './workspacePresentation';

describe('visibleTargetDirection', () => {
  it('uses the campaign role instead of an old wizard direction', () => {
    expect(
      visibleTargetDirection({
        campaignRoles: ['VP of Technology & Operations'],
        profileHeadline: 'VP of Engineering',
        resumeTargetRole: 'Technology Director',
        wizardTargetDirection: 'Product Manager',
      }),
    ).toBe('VP of Technology & Operations');
  });

  it('uses the imported profile headline before a wizard direction', () => {
    expect(
      visibleTargetDirection({
        profileHeadline: 'VP of Technology & Operations',
        wizardTargetDirection: 'Product Manager',
      }),
    ).toBe('VP of Technology & Operations');
  });

  it('falls back to the imported resume role and then to the wizard answer', () => {
    expect(
      visibleTargetDirection({
        resumeTargetRole: 'Technology Director',
        wizardTargetDirection: 'Product Manager',
      }),
    ).toBe('Technology Director');
    expect(visibleTargetDirection({ wizardTargetDirection: 'Product Manager' })).toBe(
      'Product Manager',
    );
  });
});
