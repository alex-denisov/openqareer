export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}

export type QuizPlatform = 'hh.ru' | 'linkedin';

export interface SkillQuiz {
  id: string;
  title: string;
  badgeTitle: string;
  category: string;
  platform: QuizPlatform;
  durationMinutes: number;
  passingScorePercent: number;
  questions: QuizQuestion[];
}

export interface QuizEvaluationResult {
  quizId: string;
  scorePercent: number;
  correctAnswersCount: number;
  totalQuestions: number;
  passed: boolean;
  status: 'подтверждён' | 'не подтверждён';
  statusLabel: 'подтверждён' | 'не подтверждено';
  source: string;
  verifiedAt: string;
  verifiedBadgeAwarded: boolean;
  badge?: {
    id: string;
    title: string;
    awardedAt: string;
    platform: QuizPlatform;
  };
  review: Array<{
    questionId: string;
    question: string;
    selectedOptionIndex: number;
    correctOptionIndex: number;
    isCorrect: boolean;
    explanation: string;
  }>;
}

const QUIZ_CATALOG: SkillQuiz[] = [
  {
    id: 'typescript',
    title: 'TypeScript: Верификация уровня Senior',
    badgeTitle: 'Подтвержденный навык TypeScript (hh.ru)',
    category: 'Engineering / Frontend & Backend',
    platform: 'hh.ru',
    durationMinutes: 15,
    passingScorePercent: 75,
    questions: [
      {
        id: 'ts-1',
        question: 'Что делает ключевое слово `infer` в условных типах TypeScript?',
        options: [
          'Приводит тип к any при возникновении ошибки',
          'Позволяет объявить переменную типа внутри условия для извлечения типа аргумента или возврата',
          'Запрещает использование неизвестных свойств объекта',
          'Создает неизменяемый кортеж',
        ],
        correctOptionIndex: 1,
        explanation:
          '`infer` используется в правой части `extends` в условных типах для вывода переменной типа из целевого типа.',
      },
      {
        id: 'ts-2',
        question: 'Чем тип `unknown` отличается от типа `any`?',
        options: [
          'Ничем, это синонимы',
          '`unknown` является типобезопасным аналогом `any` и требует сужения типа (type narrowing) перед выполнением операций',
          '`unknown` может хранить только примитивные значения',
          '`unknown` отключает проверку типов компилятором',
        ],
        correctOptionIndex: 1,
        explanation:
          '`unknown` не позволяет вызывать методы или обращаться к свойствам без предварительной проверки и сужения типа (typeof, instanceof, type guards).',
      },
      {
        id: 'ts-3',
        question: 'Что означает флаг `exactOptionalPropertyTypes` в tsconfig.json?',
        options: [
          'Запрещает опциональные поля в интерфейсах',
          'Опциональные свойства не могут явно принимать значение `undefined`, если это не указано в типе',
          'Автоматически удаляет все поля со значением undefined при сериализации',
          'Принудительно делает все поля обязательными',
        ],
        correctOptionIndex: 1,
        explanation:
          'Флаг разграничивает отсутствие свойства и явную передачу { prop: undefined }.',
      },
      {
        id: 'ts-4',
        question: 'Какой результат даст операция `keyof (A & B)`?',
        options: [
          'keyof A & keyof B',
          'keyof A | keyof B',
          'never',
          'unknown',
        ],
        correctOptionIndex: 1,
        explanation: 'Ключи пересечения типов — это объединение ключей (keyof A | keyof B).',
      },
    ],
  },
  {
    id: 'react',
    title: 'React 18 & Архитектура компонентов',
    badgeTitle: 'Подтвержденный навык React (hh.ru)',
    category: 'Engineering / Frontend',
    platform: 'hh.ru',
    durationMinutes: 15,
    passingScorePercent: 75,
    questions: [
      {
        id: 'react-1',
        question: 'Для чего предназначен хук `useDeferredValue` в React 18?',
        options: [
          'Для кэширования ресурсоемких вычислений (аналог useMemo)',
          'Для откладывания обновления менее приоритетной части UI (Concurrent Rendering)',
          'Для отправки асинхронных HTTP-запросов с задержкой',
          'Для подписки на внешние хранилища',
        ],
        correctOptionIndex: 1,
        explanation:
          '`useDeferredValue` откладывает обновление значения, позволяя более срочным обновлениям (например, пользовательскому вводу) рендериться первыми.',
      },
      {
        id: 'react-2',
        question: 'В чем разница между `useEffect` и `useLayoutEffect`?',
        options: [
          'useLayoutEffect работает только на сервере',
          'useLayoutEffect выполняется синхронно сразу после мутаций DOM, до отрисовки браузером (paint), а useEffect — асинхронно после paint',
          'useEffect выполняется раньше, чем компонент смонтирован',
          'Разницы нет, useLayoutEffect устарел',
        ],
        correctOptionIndex: 1,
        explanation:
          'useLayoutEffect блокирует визуальную отрисовку браузером и используется для синхронных измерений DOM, предотвращая мерцание.',
      },
      {
        id: 'react-3',
        question: 'Что гарантирует `startTransition` в React 18?',
        options: [
          'Запуск CSS анимаций',
          'Помечает обновление состояния как неблокирующий переход, который может быть прерван более срочными событиями',
          'Удаляет компонент из виртуального DOM',
          'Синхронизирует рендер с бэкендом',
        ],
        correctOptionIndex: 1,
        explanation:
          '`startTransition` позволяет браузеру оставаться отзывчивым даже во время тяжелых ререндеров больших списков.',
      },
      {
        id: 'react-4',
        question: 'Какой хук рекомендован для чтения внешних мутируемых сторов в React 18+?',
        options: [
          'useExternalStore',
          'useSyncExternalStore',
          'useStoreSubscriber',
          'useMutableSource',
        ],
        correctOptionIndex: 1,
        explanation:
          '`useSyncExternalStore` предотвращает разрывы данных (tearing) при concurrent-рендеринге из внешних источников данных.',
      },
    ],
  },
  {
    id: 'nodejs',
    title: 'Node.js: Backend Architecture & Performance',
    badgeTitle: 'Подтвержденный навык Node.js (hh.ru)',
    category: 'Engineering / Backend',
    platform: 'hh.ru',
    durationMinutes: 15,
    passingScorePercent: 75,
    questions: [
      {
        id: 'node-1',
        question: 'В какой фазе Event Loop в Node.js выполняются колбэки `setImmediate`?',
        options: ['Timers', 'Pending callbacks', 'Check', 'Close callbacks'],
        correctOptionIndex: 2,
        explanation: 'Фаза `Check` выполняет колбэки `setImmediate()`.',
      },
      {
        id: 'node-2',
        question: 'Что произойдет при блокировке Event Loop синхронным тяжелым циклом?',
        options: [
          'Node.js автоматически выделит новый тред из пула libuv',
          'Сервер перестанет обрабатывать все входящие сетевые запросы и таймеры на время выполнения цикла',
          'Цикл будет выгружен в Web Worker',
          'Сработает garbage collection',
        ],
        correctOptionIndex: 1,
        explanation:
          'Так как основной поток выполнения JavaScript в Node.js однопоточный, блокировка Event Loop парализует обработку всех I/O событий.',
      },
      {
        id: 'node-3',
        question: 'Для чего используется механизм `Backpressure` в Node.js Streams?',
        options: [
          'Для шифрования потока данных',
          'Для предотвращения переполнения буфера памяти, когда источник (Readable) производит данные быстрее, чем приемник (Writable) успевает их обработать',
          'Для сжатия трафика gzip',
          'Для балансировки нагрузки между процессами кластера',
        ],
        correctOptionIndex: 1,
        explanation:
          'Backpressure приостанавливает чтение при возврате `false` из метода `writable.write()` до события `drain`.',
      },
      {
        id: 'node-4',
        question: 'Чем `worker_threads` отличаются от модуля `cluster` в Node.js?',
        options: [
          'Ничем, это дубликаты',
          'worker_threads разделяют память через SharedArrayBuffer и работают в одном процессе, а cluster запускает независимые дочерние процессы OS',
          'cluster работает только на Windows',
          'worker_threads не поддерживают передачу сообщений',
        ],
        correctOptionIndex: 1,
        explanation:
          '`worker_threads` — это треды внутри одного процесса с возможностью разделения памяти, тогда как `cluster` порождает отдельные форки Node.js с собственным адресным пространством.',
      },
    ],
  },
  {
    id: 'qa-automation',
    title: 'QA Automation: Playwright & e2e Reliability',
    badgeTitle: 'Подтвержденный навык QA Automation (hh.ru)',
    category: 'Engineering / Quality Assurance',
    platform: 'hh.ru',
    durationMinutes: 15,
    passingScorePercent: 75,
    questions: [
      {
        id: 'qa-1',
        question: 'Какое главное преимущество авто-ожидания (auto-waiting) в Playwright?',
        options: [
          'Автоматическое отключение таймаутов',
          'Playwright автоматически проверяет видимость, доступность и стабильность элемента перед кликом или вводом, предотвращая flakiness',
          'Возможность тестировать без запуска браузера',
          'Автоматическое написание тест-кейсов с помощью AI',
        ],
        correctOptionIndex: 1,
        explanation:
          'Auto-waiting выполняет серию проверок actionability (visible, stable, enabled, editable) до совершения действия.',
      },
      {
        id: 'qa-2',
        question: 'Что такое `Page Object Model` (POM) в автотестировании?',
        options: [
          'Формат экспорта отчетов в PDF',
          'Паттерн проектирования, инкапсулирующий структуру страницы и действия пользователя в отдельные классы для повторного использования',
          'Инструмент для перехвата сетевых пакетов',
          'Библиотека генерации фейковых данных',
        ],
        correctOptionIndex: 1,
        explanation:
          'POM разделяет логику тестирования и селекторы страницы, упрощая поддержку тестов при изменениях верстки.',
      },
      {
        id: 'qa-3',
        question:
          'Что проверяет критерий доступности WCAG 2.2 по контрастности текста (AA standard)?',
        options: [
          'Размер шрифта не менее 24px',
          'Минимальный коэффициент контрастности обычного текста к фону не менее 4.5:1 (для крупного текста 3:1)',
          'Использование только темной темы',
          'Отсутствие анимаций на странице',
        ],
        correctOptionIndex: 1,
        explanation:
          'WCAG AA требует соотношение контраста не менее 4.5:1 для основного текста и 3:1 для текста от 18pt (или 14pt bold).',
      },
      {
        id: 'qa-4',
        question: 'Как Playwright изолирует состояние между тестами?',
        options: [
          'Перезагружает операционную систему',
          'Каждый тест запускается в новом изолированном BrowserContext с собственными куками, localStorage и кэшем',
          'Удаляет файлы тестов после выполнения',
          'Использует один общий профиль Chrome',
        ],
        correctOptionIndex: 1,
        explanation:
          '`BrowserContext` обеспечивает полную изоляцию как режим инкогнито без оверхеда на перезапуск браузера.',
      },
    ],
  },
  {
    id: 'sql',
    title: 'SQL & Database Design (PostgreSQL / Relational Data)',
    badgeTitle: 'Подтвержденный навык SQL (hh.ru)',
    category: 'Engineering / Databases',
    platform: 'hh.ru',
    durationMinutes: 15,
    passingScorePercent: 75,
    questions: [
      {
        id: 'sql-1',
        question: 'Что делает уровень изоляции транзакций `Repeatable Read` в PostgreSQL?',
        options: [
          'Блокирует всю таблицу для чтения',
          'Гарантирует, что транзакция видит только данные, зафиксированные до ее начала, предотвращая non-repeatable read',
          'Разрешает чтение незафиксированных данных (dirty read)',
          'Автоматически преобразует все запросы в SERIALIZABLE',
        ],
        correctOptionIndex: 1,
        explanation:
          'Repeatable Read создает снимок данных на момент первого запроса в транзакции, исключая неповторяющееся чтение.',
      },
      {
        id: 'sql-2',
        question: 'Для чего в индексах B-Tree используется `INCLUDE` (Covering Index)?',
        options: [
          'Для полнотекстового поиска',
          'Для включения неключевых колонок в листовые страницы индекса для Index-Only Scan без поиска по таблице',
          'Для автоматического партиционирования',
          'Для шифрования данных',
        ],
        correctOptionIndex: 1,
        explanation:
          'Covering index позволяет СУБД извлекать запрошенные поля напрямую из индекса (Index Only Scan).',
      },
      {
        id: 'sql-3',
        question: 'Что такое `WAL` (Write-Ahead Logging) в СУБД?',
        options: [
          'Формат логов веб-сервера',
          'Механизм обеспечения надежности (Durability в ACID), при котором изменения сначала пишутся в журнал на диск перед изменением страниц данных',
          'Инструмент визуализации схемы БД',
          'Драйвер подключения к реплике',
        ],
        correctOptionIndex: 1,
        explanation: 'WAL гарантирует сохранность данных при сбоях (D в ACID).',
      },
      {
        id: 'sql-4',
        question: 'В чем разница между `JOIN` и `EXISTS` при фильтрации данных?',
        options: [
          'Разницы нет',
          '`EXISTS` прекращает сканирование подзапроса при нахождении первого совпадения, что эффективно для полуджойнов (Semi-Join)',
          '`EXISTS` всегда медленнее JOIN',
          '`EXISTS` работает только с первичными ключами',
        ],
        correctOptionIndex: 1,
        explanation:
          '`EXISTS` оптимизируется планировщиком как semi-join и останавливается на первом совпадении.',
      },
    ],
  },
  {
    id: 'python',
    title: 'Python: Core Architecture & Data Structures',
    badgeTitle: 'Подтвержденный навык Python (LinkedIn)',
    category: 'Engineering / Backend',
    platform: 'linkedin',
    durationMinutes: 15,
    passingScorePercent: 70,
    questions: [
      {
        id: 'py-1',
        question: 'Что такое GIL (Global Interpreter Lock) в CPython?',
        options: [
          'Инструмент для статического анализа кода',
          'Мьютекс, защищающий доступ к объектам Python и предотвращающий одновременное выполнение байткода несколькими потоками',
          'Встроенная база данных',
          'Компилятор JIT',
        ],
        correctOptionIndex: 1,
        explanation:
          'GIL обеспечивает потокобезопасность управления памятью CPython, ограничивая параллельное выполнение байткода одним потоком на процесс.',
      },
      {
        id: 'py-2',
        question: 'В чем ключевое отличие генератора (generator) от спискового включения (list comprehension)?',
        options: [
          'Генераторы не могут использовать условия',
          'Генераторы вычисляют элементы лениво (по требованию) и не хранят всю коллекцию в оперативной памяти',
          'Списковые включения работают только со строками',
          'Генераторы нельзя передавать в функции',
        ],
        correctOptionIndex: 1,
        explanation:
          'Генераторы возвращают итератор и отдают значения по одному через протокол итерации, экономя память на больших объемах данных.',
      },
      {
        id: 'py-3',
        question: 'Как в Python работают декораторы функций?',
        options: [
          'Изменяют байткод функции при запуске системы',
          'Являются синтаксическим сахаром для передачи функции в качестве аргумента другой функции и возврата модифицированного вызова',
          'Служат для создания графического интерфейса',
          'Автоматически запускают функцию в отдельном процессе',
        ],
        correctOptionIndex: 1,
        explanation:
          '@decorator над функцией fn эквивалентен вызову fn = decorator(fn).',
      },
      {
        id: 'py-4',
        question: 'Что произойдет при использовании изменяемого объекта (например, list=[]) в качестве аргумента по умолчанию?',
        options: [
          'Python выдаст синтаксическую ошибку',
          'Список будет создан один раз при определении функции и будет общим для всех ее последующих вызовов',
          'Список будет заново создаваться при каждом вызове',
          'Значение аргумента автоматически очистится после выполнения',
        ],
        correctOptionIndex: 1,
        explanation:
          'Значения аргументов по умолчанию вычисляются однажды при загрузке модуля, поэтому изменяемые объекты сохраняют состояние между вызовами.',
      },
    ],
  },
  {
    id: 'docker',
    title: 'Docker & Контейнеризация сервисов',
    badgeTitle: 'Подтвержденный навык Docker (LinkedIn)',
    category: 'Engineering / DevOps',
    platform: 'linkedin',
    durationMinutes: 15,
    passingScorePercent: 75,
    questions: [
      {
        id: 'dk-1',
        question: 'Как Docker кэширует слои при сборке образа через `docker build`?',
        options: [
          'Кэширует только финальный результат',
          'Проверяет каждую инструкцию: если инструкция и предшествующие слои не изменились, слой переиспользуется из кэша',
          'Случайно сбрасывает кэш раз в час',
          'Кэширует только инструкции RUN',
        ],
        correctOptionIndex: 1,
        explanation:
          'При изменении любой инструкции Docker инвалидирует кэш для неё и всех последующих слоев.',
      },
      {
        id: 'dk-2',
        question: 'В чем разница между `CMD` и `ENTRYPOINT` в Dockerfile?',
        options: [
          'Разницы нет',
          '`ENTRYPOINT` задает базовую команду запуска контейнера, а `CMD` предоставляет аргументы по умолчанию, которые легко переопределить при запуске',
          '`CMD` выполняется при сборке образа, а `ENTRYPOINT` — при запуске',
          '`ENTRYPOINT` работает только на Linux',
        ],
        correctOptionIndex: 1,
        explanation:
          '`ENTRYPOINT` фиксирует исполняемый файл, а параметры из `CMD` передаются ему как дефолтные аргументы.',
      },
      {
        id: 'dk-3',
        question: 'Какое назначение у multi-stage сборок в Docker?',
        options: [
          'Запуск нескольких контейнеров в одной сети',
          'Минимизация итогового размера образа путем разделения этапов сборки зависимостей и копирования только готовых артефактов в чистый runtime-образ',
          'Автоматическое масштабирование в Kubernetes',
          'Синхронизация файлов хоста',
        ],
        correctOptionIndex: 1,
        explanation:
          'Multi-stage сборка изолирует тяжелые компиляторы и сборочные зависимости от итогового легковесного контейнера.',
      },
      {
        id: 'dk-4',
        question: 'Чем том (`named volume`) отличается от `bind mount`?',
        options: [
          'Bind mount быстрее во всех случаях',
          'Named volume управляется Docker и изолирован в защищенной директории хоста, а bind mount монтирует произвольный путь файловой системы хоста',
          'Named volume удаляется при остановке контейнера',
          'Named volume не поддерживает персистентность данных',
        ],
        correctOptionIndex: 1,
        explanation:
          'Тома Docker полностью управляются движком, безопасны и переносимы между разными хостами.',
      },
    ],
  },
];

export function getAvailableSkillQuizzes(): SkillQuiz[] {
  return QUIZ_CATALOG;
}

export function getSkillQuizById(id: string): SkillQuiz | undefined {
  return QUIZ_CATALOG.find((q) => q.id === id);
}

export function evaluateSkillQuiz(
  quizId: string,
  answers: Record<string, number>,
): QuizEvaluationResult {
  const quiz = getSkillQuizById(quizId);
  if (!quiz) {
    throw new Error(`Quiz not found: ${quizId}`);
  }

  let correctCount = 0;
  const review = quiz.questions.map((q) => {
    const selected = answers[q.id] ?? -1;
    const isCorrect = selected === q.correctOptionIndex;
    if (isCorrect) correctCount += 1;
    return {
      questionId: q.id,
      question: q.question,
      selectedOptionIndex: selected,
      correctOptionIndex: q.correctOptionIndex,
      isCorrect,
      explanation: q.explanation,
    };
  });

  const scorePercent = Math.round((correctCount / quiz.questions.length) * 100);
  const passed = scorePercent >= quiz.passingScorePercent;
  const source = quiz.platform === 'linkedin' ? 'Банк квизов LinkedIn' : 'Банк квизов hh.ru';
  const verifiedAt = new Date().toISOString().slice(0, 10);

  return {
    quizId,
    scorePercent,
    correctAnswersCount: correctCount,
    totalQuestions: quiz.questions.length,
    passed,
    status: passed ? 'подтверждён' : 'не подтверждён',
    statusLabel: passed ? 'подтверждён' : 'не подтверждено',
    source,
    verifiedAt,
    verifiedBadgeAwarded: passed,
    badge: passed
      ? {
          id: `badge-${quiz.id}`,
          title: quiz.badgeTitle,
          awardedAt: new Date().toISOString(),
          platform: quiz.platform,
        }
      : undefined,
    review,
  };
}

export interface SkillVerificationFact {
  skillName: string;
  status: 'подтверждён' | 'не подтверждён' | 'заявлен';
  source: string;
  date: string;
  scorePercent: number;
  statement: string;
}

export function buildSkillVerificationFact(
  skillName: string,
  result: QuizEvaluationResult,
): SkillVerificationFact {
  const statement = result.passed
    ? `${skillName}: подтверждён (${result.source}, ${result.verifiedAt}, ${result.scorePercent}%)`
    : `${skillName}: не подтверждено (${result.source}, ${result.verifiedAt}, ${result.scorePercent}%)`;

  return {
    skillName,
    status: result.status,
    source: result.source,
    date: result.verifiedAt,
    scorePercent: result.scorePercent,
    statement,
  };
}

export function createSkillVerificationProposal(
  skillName: string,
  result: QuizEvaluationResult,
  memoryId?: string,
) {
  const fact = buildSkillVerificationFact(skillName, result);
  const safeMemoryRef = memoryId
    ? memoryId.startsWith('memory:')
      ? memoryId
      : `memory:${memoryId.replace(/^memory-/, '')}`
    : 'memory:skill-fact-1';

  return {
    kind: 'resume.revise' as const,
    objective: `Обновить статус навыка ${skillName}: ${fact.status} (${fact.source})`,
    evidenceRefs: [safeMemoryRef],
    acceptanceCriteria: [
      `У навыка ${skillName} зафиксирован статус ${fact.status}`,
      `Источник: ${fact.source}, дата проверки: ${fact.date}`,
    ],
    expectedSignal: result.passed
      ? `Подтверждённый навык ${skillName} укрепляет профиль`
      : `Навык ${skillName} отмечен как требующий практики`,
    measureAfter: new Date().toISOString().slice(0, 10),
    risk: 'candidate_data_write' as const,
    resumeRevision: {
      section: 'skills' as const,
      experienceId: null,
      memoryId: memoryId ?? null,
      proposedText: `${skillName} [${fact.status}] (${fact.source}, ${fact.date})`,
    },
  };
}
