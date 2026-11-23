import { describe, expect, it } from 'vitest';
import { resolvePitchVacancy } from './vacancyPitchRoutes';

// B778: строка подборки `cluster-<запись>`, склеенная в чужой кластер, — письмо и одобрение
// берут саму выбранную запись, а не основателя склейки.
describe('B778: merged cluster', () => {
  it('B778: a row merged into another stored cluster — the letter cites the chosen vacancy, not the founder', () => {
    const founder = {
      id: 'cluster-src-himalayas:1', canonicalTitle: 'Fractional Chief Administrative Officer', canonicalCompany: 'Himalayas Co',
      descriptionSummary: 'Founder summary', skills: ['Administration'], canonicalLocation: 'Remote', isRemote: true,
    };
    const chosen = {
      title: 'Chief of Staff', company: 'Arootah', description: 'Chosen text', fullDescription: 'Chosen full text',
      requiredSkills: ['Coaching'], responsibilities: [], location: 'New York', isRemote: false,
    };
    const resolved = resolvePitchVacancy(undefined as never, 'cluster-src-arootah:8faace0f', founder as never, chosen as never);
    expect(resolved).toMatchObject({
      title: 'Chief of Staff', company: 'Arootah', description: 'Chosen text', fullDescription: 'Chosen full text',
      requiredSkills: ['Coaching'], location: 'New York', isRemote: false,
    });
    const own = resolvePitchVacancy(undefined as never, 'cluster-src-himalayas:1', founder as never, chosen as never);
    expect(own.title).toBe('Fractional Chief Administrative Officer');
  });
});
