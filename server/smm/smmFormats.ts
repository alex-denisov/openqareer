/**
 * Ротация форматов постов (стратегия владельца 09.11). Продающих форматов три
 * из десяти: шаг на платформу примерно в каждом третьем посте, остальные —
 * охват и доверие без ссылок.
 */
export interface SmmFormat {
  readonly id: string;
  /** Что именно написать: задание модели, а не шаблон текста. */
  readonly brief: string;
  /** Продающий шаг уместен: подписка, бета, бесплатная проба. */
  readonly sales: boolean;
}

export const SMM_FORMATS: readonly SmmFormat[] = [
  {
    id: 'caps_hook',
    brief:
      'Короткий пост с кричащим хуком капсом и эмоцией в первой строке, дальше 3–6 строк по-человечески.',
    sales: false,
  },
  {
    id: 'thread_series',
    brief:
      'Ветка «1/5» с продолжением; в последней части позови подписаться, потому что завтра будет продолжение или разбор.',
    sales: true,
  },
  {
    id: 'myth_list',
    brief: 'Разоблачение 4–6 мифов о поиске работы списком, взгляд нанимающего изнутри.',
    sales: false,
  },
  {
    id: 'everyone_says',
    brief: '«Все говорят… а я считаю…» — спорное мнение нанимающего и открытый вопрос к читателям.',
    sales: false,
  },
  {
    id: 'checklist_try',
    brief:
      'Чек-лист или пошаговая инструкция, которую хочется сохранить; последний пункт — попробовать бесплатно конкретную вещь в openqareer, которая этот шаг делает.',
    sales: true,
  },
  {
    id: 'personal',
    brief:
      'Личное от Алексея: обида, злость или история «кто я и зачем строю openqareer». Без выдуманных фактов.',
    sales: false,
  },
  {
    id: 'address_audience',
    brief:
      'Обращение к своим: «Если ты… — моя страница для тебя»; перечисли, кого узнаёт читатель, и что он тут получит.',
    sales: false,
  },
  {
    id: 'building_beta',
    brief:
      '«Как я это строю»: одна механика сервиса, что не получилось и что поменяли; в конце — «напиши "+" в комментариях, пришлю ссылку на бету» и сразу прямая ссылка на бесплатную регистрацию https://openqareer.com/signup.',
    sales: true,
  },
  {
    id: 'dispute',
    brief:
      'Спор на профессиональную тему найма с двумя позициями и вопросом, чью сторону займёт читатель.',
    sales: false,
  },
  {
    id: 'news_take',
    brief:
      'Мнение о типичной ситуации рынка труда в IT и Digital, которую узнает каждый (без новостей, компаний и цифр — их не проверить).',
    sales: false,
  },
];

export const FORMAT_CURSOR_KEY = 'format_cursor';

export function formatAt(cursor: number): SmmFormat {
  const index = ((cursor % SMM_FORMATS.length) + SMM_FORMATS.length) % SMM_FORMATS.length;
  return SMM_FORMATS[index];
}
