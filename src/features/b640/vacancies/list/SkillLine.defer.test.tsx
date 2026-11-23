// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { readSkillGap } from '../../career/careerApi';
import { mount } from '../../kit/testDom';
import { SkillLine } from './SkillLine';

vi.mock('../../career/careerApi', () => ({
  readSkillGap: vi.fn(async () => ({ gap: 0, role: null })),
}));
const read = vi.mocked(readSkillGap);

describe('SkillLine defers its role reads (B760)', () => {
  it('asks nothing while the list is still loading', async () => {
    const view = mount(<SkillLine roles={['CTO', 'CIO']} ready={false} />);
    await act(async () => undefined);
    expect(read).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reads the roles once the list is ready', async () => {
    const view = mount(<SkillLine roles={['CTO', 'CIO']} ready />);
    await act(async () => undefined);
    expect(read).toHaveBeenCalledWith(['CTO', 'CIO']);
    view.unmount();
  });
});
