import { describe, expect, it } from 'vitest';
import { classifyTelegramPost } from './telegramPostType';

/**
 * Замер B164 среза 3: из 96 записей канала 38 не содержали ни одного сигнала
 * найма — курсы, новости и объявления кандидатов о себе. Прямой фильтр «нет
 * сигнала найма → не вакансия» отрезал бы вместе с ними настоящие вакансии,
 * поэтому тип поста распознаётся отдельно.
 */
const REAL_VACANCIES = [
  `Senior Frontend Engineer в HTTPie
Обязанности: развивать веб-клиент, поддерживать дизайн-систему.
Требования: TypeScript, React, 5+ лет опыта.
Условия: удалённо, зарплата 6000-8000$.
Отклик: @httpie_hr`,
  `Level Artist
Задачи: собирать уровни, работать с окружением.
Требования: Unreal Engine, портфолио.
Мы предлагаем: удалённый формат, оплата в валюте.`,
  `Senior CV Engineer
Стек: Python, PyTorch, OpenCV.
Что предстоит делать: обучать модели детекции.
Зарплата: от 400 000 ₽. Контакты: @cv_team`,
];

const NOT_VACANCIES = [
  `Claude Code для продактов — курс на 6 недель.
Записывайтесь: разберём агентов, промпты и автоматизацию.
Старт 15 сентября, регистрация по ссылке.`,
  `Меня зовут София, я концепт художник.
Ищу работу в геймдеве, рассматриваю удалённые предложения.
Портфолио: behance.net/sofia`,
  `Дайджест недели: что происходило в найме.
Топ-5 новостей рынка, читайте подборку в канале.`,
];

describe('classifyTelegramPost', () => {
  it('узнаёт настоящую вакансию даже без глагола найма', () => {
    for (const post of REAL_VACANCIES) {
      expect(classifyTelegramPost(post)).toBe('vacancy');
    }
  });

  it('не выдаёт курс, резюме кандидата и дайджест за вакансию', () => {
    for (const post of NOT_VACANCIES) {
      expect(classifyTelegramPost(post)).not.toBe('vacancy');
    }
  });

  it('называет тип, а не просто отказывает', () => {
    expect(classifyTelegramPost(NOT_VACANCIES[0])).toBe('promo');
    expect(classifyTelegramPost(NOT_VACANCIES[1])).toBe('resume');
    expect(classifyTelegramPost(NOT_VACANCIES[2])).toBe('digest');
  });

  it('пост без единого признака остаётся неизвестным и вакансией не считается', () => {
    expect(classifyTelegramPost('Всем привет, как дела? Пятница!')).toBe('unknown');
  });
});
