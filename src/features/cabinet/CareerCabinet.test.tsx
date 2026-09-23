import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CareerCabinet } from './CareerCabinet';
import { CareerRoutePremises } from '../search/RoutePremises';
import type { CareerCabinetView } from './cabinetViews';
import type { CandidateSnapshot } from '../coach/coachApi';
import type { CareerCabinetData } from './useCareerCabinetData';

// Разделы читают три источника одним хуком; здесь он отвечает сразу, чтобы
// проверять состав экрана, а не сеть. Первый тест ниже переключает его в
// «ещё читаем» — до первого ответа профиль не рисуется вовсе.
const cabinetData = vi.hoisted(() => ({ current: undefined as unknown as CareerCabinetData }));
vi.mock('./useCareerCabinetData', () => ({
  useCareerCabinetData: () => cabinetData.current,
}));

const loadedSnapshot = {
  candidate: {
    id: 'cand-1',
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 0,
    proposedCount: 0,
    readiness: { complete: false, unresolvedQuestions: 0, checks: [] },
  },
  assessments: [],
  germanyMarket: null,
  resume: null,
  documents: [],
  vacancySubscriptions: [],
} as unknown as CandidateSnapshot;

function loadedData(): CareerCabinetData {
  return {
    account: undefined,
    snapshot: loadedSnapshot,
    resume: undefined,
    loading: false,
    refresh: async () => undefined,
    setAccount: () => undefined,
    setSnapshot: () => undefined,
  };
}

beforeEach(() => {
  cabinetData.current = loadedData();
});

const session = {
  username: 'test.candidate',
  email: 'test@example.com',
  displayName: 'Тестовый Кандидат',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'cand-1',
};

const workspace = {
  version: 7 as const,
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:00:00.000Z',
  resumeText:
    'Senior Software Engineer with 8+ years experience in TypeScript, React, Node.js and distributed systems architecture.',
  resumeSource: 'text' as const,
  targetDirection: 'Senior Software Engineer',
  regions: ['ru'] as const,
  currentSituation: 'Ищу работу ведущим инженером в технологической компании.',
  constraints: 'Remote / Hybrid',
  urgency: 'active' as const,
  outcomes: [],
};

function renderCabinet(view: CareerCabinetView) {
  return renderToStaticMarkup(
    <CareerCabinet
      view={view}
      session={session}
      workspace={workspace}
      onNavigate={() => undefined}
      onUpdateWorkspace={() => undefined}
      onOpenAccount={() => undefined}
      onOpenExpert={() => undefined}
    />,
  );
}

describe('CareerCabinet route premises', () => {
  it('shows independently reviewable role, geography and work-mode premises', () => {
    const html = renderToStaticMarkup(
      <CareerRoutePremises
        targetRole="Руководитель продукта"
        regions={['eu', 'ru']}
        workMode="remote"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain('Роль и грейд');
    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('Где');
    expect(html).toContain('Россия');
    expect(html).toContain('EU');
    expect(html).toContain('Формат работы');
    expect(html).toContain('Удалённо');
    expect(html).toContain('Изменить условия');
  });
});

describe('CareerCabinet composition', () => {
  // Владелец 2026-09-20: на старте на мгновение виден пустой профиль с именем
  // из сессии, а данные импорта подъезжают следом. До первого ответа
  // сервера экран не рисует ни имени, ни вкладок — только тихую заглушку.
  it('renders nothing of the profile before the first reading arrives', () => {
    cabinetData.current = { ...loadedData(), snapshot: undefined, loading: true };
    const html = renderCabinet('today');

    expect(html).toContain('career-cabinet-skeleton');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Разделы профиля');
    expect(html).not.toContain('Оценка профиля');
    expect(html).not.toContain('Тестовый Кандидат');
  });

  it('keeps the profile on screen while a later refresh is running', () => {
    cabinetData.current = { ...loadedData(), loading: true };
    const html = renderCabinet('today');

    expect(html).not.toContain('career-cabinet-skeleton');
    expect(html).toContain('Разделы профиля');
  });

  it('shows the reading error with a retry when the first reading failed', () => {
    cabinetData.current = {
      ...loadedData(),
      snapshot: undefined,
      loading: false,
      error: 'Не удалось загрузить профиль кандидата. Повторите запрос.',
    };
    const html = renderCabinet('today');

    expect(html).not.toContain('career-cabinet-skeleton');
    expect(html).toContain('Не удалось загрузить профиль кандидата');
    expect(html).toContain('Повторить');
  });

  it('projects the regions the candidate chose instead of an empty geography (B158, B160)', () => {
    const html = renderCabinet('career');

    expect(html).toContain('Где');
    expect(html).toContain('Россия');
    expect(html).not.toContain('Не указана');
  });

  it('says plainly that no region was chosen rather than guessing one', () => {
    const html = renderToStaticMarkup(
      <CareerRoutePremises
        targetRole="Руководитель продукта"
        regions={[]}
        workMode="remote"
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain('Регионы не выбраны');
  });

  // «Пульт»: «Главная» — это сам кандидат. Слева профиль из разобранного
  // резюме, справа оценка и позиционирование. Ни очереди подтверждения, ни
  // карточки следующего шага макет не держит (B179).
  it('gives «Главная» the candidate profile beside the assessment, next action and ATS readability (B103, B105)', () => {
    const html = renderCabinet('today');

    expect(html).toContain('Разделы профиля');
    expect(html).toContain('Готовность профиля');
    expect(html).toContain('Один шаг на сегодня');
    expect(html).toContain('ATS-читаемость');
    expect(html).not.toContain('Следующий шаг');
    expect(html).not.toContain('Подтвердить все');
    expect(html).not.toContain('Рынок и следующие шаги');
  });

  // B233: «ATS-читаемость» и «Следующее действие» живут на Главной; на Поиске
  // тот же блок стоял целиком второй раз (аудит 2026-09-20, находка 6).
  it('does not repeat the ATS readability and next action block on «Поиск» (B233)', () => {
    const html = renderCabinet('career');

    expect(html).toContain('Кампания:');
    expect(html).not.toContain('ATS-читаемость');
    expect(html).not.toContain('Один шаг на сегодня');
  });

  it('keeps the strategist dialogue out of every section, it lives in «Эксперт»', () => {
    for (const view of ['today', 'profile', 'career', 'opportunities'] as const) {
      expect(renderCabinet(view)).not.toContain('Диалог со стратегом');
    }
  });

  // B265: «Профиль» is its own screen (topcard, Open to work, every imported
  // section), not a second «Сегодня» and not the Resume Studio surface
  // anymore. «Резюме» is no longer a reachable rail item but still opens
  // Resume Studio for anyone with a stored link to it.
  it('gives «Профиль» its own screen, not a second «Сегодня» or Resume Studio', () => {
    const profile = renderCabinet('profile');
    const resume = renderCabinet('resume');

    expect(profile).not.toContain('Один шаг на сегодня');
    expect(profile).toContain('career-profile-view');
    expect(resume).toContain('career-resume-studio');
  });

  // «Пульт» развёл рынок на два раздела: кампания живёт в «Поиске», пул — в
  // «Вакансиях». Панель рынка и доска маршрута макетом не предусмотрены и
  // удалены вместе с ними (B179).
  it('gives «Поиск» the campaign screen', () => {
    const html = renderCabinet('career');

    expect(html).toContain('Кампания:');
    expect(html).toContain('Воронка');
    expect(html).toContain('Очередь на сегодня');
    expect(html).toContain('Роль, регион, формат');
    // Регулярные выборки ушли отсюда в панель фильтров «Вакансий» — туда, где
    // кандидат смотрит сам пул (решение владельца 2026-09-02, B181).
    expect(html).not.toContain('Регулярный поиск');
  });

  it('gives «Вакансии» the pool board', () => {
    const html = renderCabinet('opportunities');

    expect(html).toContain('career-cabinet-view-opportunities');
    expect(html).not.toContain('Рынок и следующие шаги');
  });

  it('does not fabricate candidate or provider outcomes when server data is absent', () => {
    const html = renderCabinet('career');

    // Неизмеряемое стоит прочерком и словами, а не нулём: ноль означал бы,
    // что мы посмотрели и не нашли (B179).
    expect(html).toContain('не отслеживаем: площадки не сообщают');
    expect(html).not.toContain('Индекс соответствия');
    expect(html).not.toContain('Авто-поднятие резюме');
    expect(html).not.toContain('откликов отправлено');
    expect(html).not.toContain('Verified Badge');
    expect(html).not.toContain('Tech Enterprise');
    expect(html).not.toContain('Технологическая компания');
  });

  it('never claims data is current, because that claim can never be false', () => {
    for (const view of ['today', 'profile', 'career', 'opportunities'] as const) {
      expect(renderCabinet(view)).not.toContain('Данные актуальны');
    }
  });
});

describe('CareerCabinet regular selections (B181)', () => {
  it('не оставляет регулярные выборки на экране кампании', () => {
    const html = renderCabinet('career');
    expect(html).not.toContain('Регулярные выборки');
    expect(html).not.toContain('Регулярный поиск');
  });

  it('показывает их в разделе «Вакансии»', () => {
    expect(renderCabinet('opportunities')).toContain('Новый запрос к площадке');
  });
});
