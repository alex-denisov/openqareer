import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingCampaignStep, OnboardingQuickStartStep } from './OnboardingCampaignStep';

const callbacks = {
  onToggleRole: vi.fn(),
  onAddRole: vi.fn(),
  onToggleRegion: vi.fn(),
  onChangeFormat: vi.fn(),
};

describe('OnboardingCampaignStep', () => {
  it('shows model role, level and the supporting profile facts', () => {
    const html = renderToStaticMarkup(
      <OnboardingCampaignStep
        state="model"
        roles={[
          {
            id: 'ops.vp',
            title: 'VP of Operations',
            titleRu: 'Вице-президент по операциям',
            level: 'vp',
            reason: 'Роль опирается на управление операциями.',
            evidence: ['Вёл операционную команду из 20 человек.'],
            source: 'model',
          },
        ]}
        selectedRoleIds={['ops.vp']}
        regions={['mena']}
        format="Полная занятость"
        elapsedSeconds={4}
        {...callbacks}
      />,
    );

    expect(html).toContain('Вице-президент по операциям');
    expect(html).toContain('Гипотеза модели');
    expect(html).toContain('Уровень: VP');
    expect(html).toContain('Роль опирается на управление операциями.');
    expect(html).toContain('Вёл операционную команду из 20 человек.');
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows bounded, truthful progress while the campaign model is pending', () => {
    const html = renderToStaticMarkup(
      <OnboardingCampaignStep
        state="loading"
        roles={[]}
        selectedRoleIds={[]}
        regions={[]}
        format="Полная занятость"
        elapsedSeconds={17}
        {...callbacks}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Запрос отправлен модели');
    expect(html).toContain('Прошло 17 с');
    expect(html).toContain('осталось ждать до 73 с');
  });

  it('marks profile-derived roles when the model times out', () => {
    const html = renderToStaticMarkup(
      <OnboardingCampaignStep
        state="fallback"
        roles={[
          {
            id: 'profile-1',
            title: 'Head of Data',
            source: 'profile',
            evidence: ['Руководил аналитикой.'],
          },
        ]}
        selectedRoleIds={['profile-1']}
        regions={[]}
        format="Полная занятость"
        elapsedSeconds={90}
        {...callbacks}
      />,
    );

    expect(html).toContain('Модель не успела ответить за 90 секунд.');
    expect(html).toContain('Head of Data');
    expect(html).toContain('Руководил аналитикой.');
    expect(html).toContain('Добавить роль');
  });
});

describe('OnboardingQuickStartStep', () => {
  it('offers the profileless role and region form', () => {
    const html = renderToStaticMarkup(
      <OnboardingQuickStartStep
        roleTitle=""
        regions={[]}
        format="Полная занятость"
        onRoleChange={vi.fn()}
        onToggleRegion={vi.fn()}
        onChangeFormat={vi.fn()}
      />,
    );

    expect(html).toContain('На какую роль ищете работу?');
    expect(html).toContain('Где рассматриваете работу');
    expect(html).not.toContain('Три вопроса о последней роли');
  });
});
