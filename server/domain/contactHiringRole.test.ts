import { describe, expect, it } from 'vitest';
import { hiringRank } from './contactHiringRole';

describe('hiringRank: кто нанимает по должности', () => {
  it('рекрутеры и HR — первыми', () => {
    for (const title of ['Технический рекрутер', 'Senior Recruiter', 'HR-партнёр', 'Talent Acquisition Lead', 'партнёр по подбору', 'HRBP', 'Руководитель найма'])
      expect(hiringRank(title), title).toBe(0);
  });

  it('руководители — вторыми', () => {
    for (const title of ['CTO', 'Head of Engineering', 'Директор по разработке', 'VP Engineering', 'Engineering Manager', 'Team Lead', 'тимлид', 'Founder & CEO'])
      expect(hiringRank(title), title).toBe(1);
  });

  it('исполнители и пустая должность не нанимают', () => {
    for (const title of ['Senior Linux Administrator', 'Backend-разработчик', 'Аналитик данных', ''])
      expect(hiringRank(title), title).toBeNull();
  });
});
