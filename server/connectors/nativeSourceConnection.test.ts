import { describe, expect, it } from 'vitest';
import {
  deriveImportedFactSources,
  listCandidateConnectionViews,
} from './nativeSourceConnection';

describe('listCandidateConnectionViews', () => {
  // B247 S7: a candidate who imported a LinkedIn document (no live session)
  // previously read as a bare "disconnected" platform, contradicting the
  // profile the dossier already carries.
  it('распознаёт импортированный без подключения профиль LinkedIn', () => {
    const views = listCandidateConnectionViews([], [
      { platform: 'linkedin', importedAt: '2026-09-10T09:00:00.000Z' },
    ]);

    const linkedin = views.find((view) => view.platform === 'linkedin');
    expect(linkedin).toEqual({
      platform: 'linkedin',
      available: true,
      status: 'imported',
      capabilities: ['resume_read'],
      importsCareerHistory: true,
      importedAt: '2026-09-10T09:00:00.000Z',
    });
  });

  it('оставляет hh «не подключено», когда фактов импорта нет', () => {
    const views = listCandidateConnectionViews([], [
      { platform: 'linkedin', importedAt: '2026-09-10T09:00:00.000Z' },
    ]);

    const hh = views.find((view) => view.platform === 'hh');
    expect(hh).toEqual({
      platform: 'hh',
      available: true,
      status: 'disconnected',
      capabilities: ['resume_read'],
      importsCareerHistory: true,
    });
  });

  it('живое подключение перекрывает более старую отметку импорта', () => {
    const views = listCandidateConnectionViews(
      [
        {
          platform: 'linkedin',
          accessMode: 'native_session_snapshot',
          connectedAt: '2026-09-15T09:00:00.000Z',
          lastImportedAt: '2026-09-15T09:00:00.000Z',
          receipt: { factCount: 3 },
        } as never,
      ],
      [{ platform: 'linkedin', importedAt: '2026-09-01T09:00:00.000Z' }],
    );

    const linkedin = views.find((view) => view.platform === 'linkedin');
    expect(linkedin?.status).toBe('connected');
  });
});

describe('deriveImportedFactSources', () => {
  it('находит дату импорта LinkedIn по истории и связанным фактам', () => {
    const sources = deriveImportedFactSources(
      [
        { id: 'resume-import:abc', content: 'Импорт: профиль LinkedIn «cv.pdf»' },
        { id: 'assistant-1', content: 'Разбираю ваш профиль…' },
      ],
      [
        {
          sourceMessageIds: ['resume-import:abc'],
          createdAt: '2026-09-10T09:00:00.000Z',
        },
      ],
    );

    expect(sources).toEqual([
      { platform: 'linkedin', importedAt: '2026-09-10T09:00:00.000Z' },
    ]);
  });

  it('не считает источником PDF-резюме без привязки к площадке', () => {
    const sources = deriveImportedFactSources(
      [{ id: 'resume-import:xyz', content: 'Импорт: PDF-резюме «cv.pdf»' }],
      [
        {
          sourceMessageIds: ['resume-import:xyz'],
          createdAt: '2026-09-10T09:00:00.000Z',
        },
      ],
    );

    expect(sources).toEqual([]);
  });

  it('пропускает импорт без фактов дальше в дневнике: даты не найти', () => {
    const sources = deriveImportedFactSources(
      [{ id: 'resume-import:none', content: 'Импорт: профиль LinkedIn' }],
      [],
    );

    expect(sources).toEqual([]);
  });
});
