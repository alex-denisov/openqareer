export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}

export interface SkillQuiz {
  id: string;
  title: string;
  badgeTitle: string;
  category: string;
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
  verifiedBadgeAwarded: boolean;
  badge?: {
    id: string;
    title: string;
    awardedAt: string;
    platform: 'hh.ru';
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
        explanation: '`infer` используется в правой части `extends` в условных типах для вывода переменной типа из целевого типа.',
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
        explanation: '`unknown` не позволяет вызывать методы или обращаться к свойствам без предварительной проверки и сужения типа (typeof, instanceof, type guards).',
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
        explanation: 'Флаг разграничивает отсутствие свойства и явную передачу { prop: undefined }.',
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
        explanation: '`useDeferredValue` откладывает обновление значения, позволяя более срочным обновлениям (например, пользовательскому вводу) рендериться первыми.',
      },
      {
        id: 'react-2',
        question: 'Что происходит при вызове `startTransition`?',
        options: [
          'Запускается CSS-анимация перехода',
          'Обновления состояния внутри колбэка помечаются как non-urgent (неблокирующие)',
          'Компонент полностью перемонтируется',
          'Очищается кэш виртуального DOM',
        ],
        correctOptionIndex: 1,
        explanation: '`startTransition` помечает переданные обновления состояния как фоновые, которые могут быть прерваны пользовательскими действиями.',
      },
      {
        id: 'react-3',
        question: 'Какое ключевое правило действует для хука `useSyncExternalStore`?',
        options: [
          'Он может использоваться только в классовых компонентах',
          'Он решает проблему tearing (рассинхронизации) в конкурентном режиме при подписке на внешние сторы',
          'Он заменяет хук useEffect во всех сценариях',
          'Он предназначен для синхронизации локального хранилища браузера',
        ],
        correctOptionIndex: 1,
        explanation: '`useSyncExternalStore` обеспечивает консистентное чтение внешних мутабельных источников данных в Concurrent React.',
      },
      {
        id: 'react-4',
        question: 'Почему мутация объекта `ref.current` не вызывает повторный рендер компонента?',
        options: [
          'Потому что `ref` хранится в замыкании Redux',
          'Потому что `useRef` возвращает обычный JS-объект, мутация которого не инициирует цикл reconciliation',
          'Потому что React автоматически откладывает изменения ref',
          'Потому что refs предназначены только для доступа к DOM-узлам',
        ],
        correctOptionIndex: 1,
        explanation: 'Изменение `current` — это обычная мутация свойства объекта, не связанная с механизмом dispatch состояния.',
      },
    ],
  },
  {
    id: 'nodejs',
    title: 'Node.js: Backend Architecture & Performance',
    badgeTitle: 'Подтвержденный навык Node.js (hh.ru)',
    category: 'Engineering / Backend',
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
        explanation: 'Так как основной поток выполнения JavaScript в Node.js однопоточный, блокировка Event Loop парализует обработку всех I/O событий.',
      },
      {
        id: 'node-3',
        question: 'Для чего используется механизм `Backpressure` в Node.js Streams?',
        options: [
          'Для шифрования потока данных',
          'Для предотвращения переполнения памяти, когда скорость записи (Writable) ниже скорости чтения (Readable)',
          'Для автоматического сжатия gzip',
          'Для разделения потока на несколько процессов',
        ],
        correctOptionIndex: 1,
        explanation: 'Backpressure сигнализирует Readable-потоку приостановить чтение, пока буфер Writable-потока не освободится.',
      },
      {
        id: 'node-4',
        question: 'Какое утверждение о `process.nextTick()` является верным?',
        options: [
          'Он выполняется в следующей итерации Event Loop',
          'Микротаски `nextTick` выполняются сразу после текущей операции до перехода к следующей фазе Event Loop',
          'Он эквивалентен setTimeout(fn, 0)',
          'Он предназначен только для обработки ошибок',
        ],
        correctOptionIndex: 1,
        explanation: 'Очередь `process.nextTick` обрабатывается сразу после завершения текущего тика JavaScript до перехода к фазам libuv.',
      },
    ],
  },
  {
    id: 'qa-automation',
    title: 'QA Automation & E2E Testing (Playwright / Vitest)',
    badgeTitle: 'Подтвержденный навык QA Automation (hh.ru)',
    category: 'Quality Assurance',
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
        explanation: 'Auto-waiting выполняет серию проверок actionability (visible, stable, enabled, editable) до совершения действия.',
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
        explanation: 'POM разделяет логику тестирования и селекторы страницы, упрощая поддержку тестов при изменениях верстки.',
      },
      {
        id: 'qa-3',
        question: 'Что проверяет критерий доступности WCAG 2.2 по контрастности текста (AA standard)?',
        options: [
          'Размер шрифта не менее 24px',
          'Минимальный коэффициент контрастности обычного текста к фону не менее 4.5:1 (для крупного текста 3:1)',
          'Использование только темной темы',
          'Отсутствие анимаций на странице',
        ],
        correctOptionIndex: 1,
        explanation: 'Уровень AA стандарта WCAG требует коэффициент контрастности не менее 4.5:1 для стандартного текста.',
      },
      {
        id: 'qa-4',
        question: 'Чем `test:coverage` полезен в CI/CD пайплайне?',
        options: [
          'Он измеряет долю выполненных строк и веток кода тестами и фейлит сборку при падении ниже заданного порога',
          'Он автоматически исправляет упавшие тесты',
          'Он ускоряет компиляцию TypeScript',
          'Он тестирует сетевую безопасность сервера',
        ],
        correctOptionIndex: 0,
        explanation: 'Coverage gates гарантируют, что новый и существующий код покрыт тестами на заявленный процент.',
      },
    ],
  },
  {
    id: 'sql',
    title: 'SQL & Database Design (PostgreSQL / Relational Data)',
    badgeTitle: 'Подтвержденный навык SQL (hh.ru)',
    category: 'Engineering / Databases',
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
        explanation: 'Repeatable Read создает снимок данных на момент первого запроса в транзакции, исключая неповторяющееся чтение.',
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
        explanation: 'Covering index позволяет СУБД извлекать запрошенные поля напрямую из индекса (Index Only Scan).',
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
        explanation: '`EXISTS` оптимизируется планировщиком как semi-join и останавливается на первом совпадении.',
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

  return {
    quizId,
    scorePercent,
    correctAnswersCount: correctCount,
    totalQuestions: quiz.questions.length,
    passed,
    verifiedBadgeAwarded: passed,
    badge: passed
      ? {
          id: `badge-${quiz.id}`,
          title: quiz.badgeTitle,
          awardedAt: new Date().toISOString(),
          platform: 'hh.ru',
        }
      : undefined,
    review,
  };
}
