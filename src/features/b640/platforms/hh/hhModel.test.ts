import { describe, expect, it } from 'vitest';
import type { CandidateConnection } from '../../../coach/coachApi';
import { buildHhView } from './hhModel';

const off: CandidateConnection = { platform: 'hh', available: true, capabilities: [], importsCareerHistory: true, status: 'disconnected' };
const on: CandidateConnection = {
  platform: 'hh', available: true, capabilities: ['resume_read'], importsCareerHistory: true, status: 'connected',
  accessMode: 'native_session_snapshot', connectedAt: '2026-11-01T10:00:00Z', lastImportedAt: '2026-11-03T10:00:00Z', factCount: 4,
};

describe('buildHhView', () => {
  it('без подключения hh.ru или без записи о нём — «не подключён»', () => {
    expect(buildHhView([off], null)).toEqual({ kind: 'off' });
    expect(buildHhView([], null)).toEqual({ kind: 'off' });
  });
  it('собирает цифры из подключения и учёта действий', () => {
    const view = buildHhView([on], { hhBoostsCount: 2, lastHhBoostAt: '2026-11-16T09:40:00Z' });
    expect(view.kind).toBe('on');
    const ids = view.kind === 'on' ? view.stats.map((stat) => stat.id) : [];
    expect(ids).toEqual(['last', 'today', 'loaded']);
  });
  it('без учёта действий показывает только дату данных, нулей не выдумывает', () => {
    const view = buildHhView([on], null);
    expect(view.kind === 'on' && view.stats.map((stat) => stat.id)).toEqual(['loaded']);
  });
  it('без последнего поднятия строки о нём нет', () => {
    const view = buildHhView([on], { hhBoostsCount: 0, lastHhBoostAt: null });
    expect(view.kind === 'on' && view.stats.map((stat) => stat.id)).toEqual(['today', 'loaded']);
  });
});
