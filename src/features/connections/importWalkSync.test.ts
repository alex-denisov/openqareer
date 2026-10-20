import { describe, expect, it, vi } from 'vitest';
import { createImportWalkSync, nextImportWalk } from './importWalkSync';

describe('import walk sync (B541)', () => {
  it('keeps every section status across the walk and closes it on end', () => {
    let walk = nextImportWalk(null, { type: 'start', keys: ['experience', 'education', 'skills'] });
    walk = nextImportWalk(walk, { type: 'read', key: 'experience' });
    walk = nextImportWalk(walk, { type: 'failed', key: 'education' });
    expect(walk).toEqual({
      state: 'running',
      sections: [
        { key: 'experience', status: 'read' },
        { key: 'education', status: 'failed' },
        { key: 'skills', status: 'pending' },
      ],
    });
    expect(nextImportWalk(walk, { type: 'end' })).toMatchObject({ state: 'done' });
    expect(nextImportWalk(null, { type: 'read', key: 'skills' })).toBeNull();
  });

  it('sends each change to the server and survives a failed save', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const sync = createImportWalkSync(save);
    sync({ type: 'start', keys: ['experience'] });
    sync({ type: 'read', key: 'experience' });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('linkedin', {
      state: 'running',
      sections: [{ key: 'experience', status: 'read' }],
    });
  });
});
