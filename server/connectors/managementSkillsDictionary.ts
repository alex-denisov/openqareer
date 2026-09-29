import { normalizeTextForComparison } from '../vacancies/vacancyFingerprint';

/**
 * Словарь управленческих и бизнес-компетенций (RU + EN).
 *
 * Составлен на основе O*NET (Executive Managers 11-1021.00, Chief Executives 11-1011.00,
 * Computer & Info Systems Managers 11-3021.00), классификатора ESCO и профессиональных
 * стандартов («Руководитель предприятия», «Директор по информационным технологиям»).
 *
 * Каждая запись объединяет синонимы на русском и английском к одному каноническому имени (B307).
 */
export interface ManagementSkillDefinition {
  readonly canonical: string;
  readonly synonyms: readonly string[];
  readonly textPatterns?: readonly string[];
}

export const MANAGEMENT_SKILLS_DICTIONARY: readonly ManagementSkillDefinition[] = [
  {
    canonical: 'Управление P&L',
    synonyms: ['P&L', 'p&l', 'P&L Management', 'p&l management', 'управление P&L', 'управление p&l', 'ответственность за P&L', 'ответственностью за P&L', 'ведение P&L', 'P and L', 'profit and loss', 'P&L responsibility'],
    textPatterns: ['p&l', 'p\\s*and\\s*l', 'profit\\s+(?:and|&)\\s+loss', '(?:управлен\\S*|ответственност\\S*|веден\\S*)\\s+(?:за\\s+)?p&l'],
  },
  {
    canonical: 'Управление командой',
    synonyms: ['управление командой', 'руководство командой', 'руководство коллективом', 'управление коллективом', 'team management', 'people management', 'командное лидерство', 'руководство людьми', 'руководство отделом', 'управление людьми', 'управление персоналом', 'Team Leadership', 'Cross-functional Team Leadership', 'Cross-functional Leadership', 'Executive Leadership', 'Leadership', 'лидерство', 'построение команды', 'масштабирование команды'],
    textPatterns: ['(?:управлен\\S*|руководств\\S*)\\s+(?:команд\\S*|коллектив\\S*|людьми|персонал\\S*|отдел\\S*)', 'team\\s+management', 'people\\s+management', '(?:cross-functional\\s+)?team\\s+leadership', 'executive\\s+leadership', 'построен\\S*\\s+команд\\S*', 'масштабирован\\S*\\s+команд\\S*', 'лидерств\\S*'],
  },
  {
    canonical: 'Бюджетирование',
    synonyms: ['бюджет', 'бюджетирование', 'управление бюджетом', 'формирование бюджета', 'контроль бюджета', 'планирование бюджета', 'budget management', 'budgeting', 'бюджетный контроль', 'управление расходной частью', 'бюджеты'],
    textPatterns: ['бюджетирован\\S*', '(?:управлен\\S*|формирован\\S*|контрол\\S*|планирован\\S*)\\s+бюджет\\S*', 'управлен\\S*\\s+расходной\\s+част\\S*', 'budgeting', 'budget\\s+management'],
  },
  {
    canonical: 'Стратегическое планирование',
    synonyms: ['стратегия', 'стратегическое планирование', 'разработка стратегии', 'бизнес-стратегия', 'strategic planning', 'business strategy', 'стратегическое развитие', 'стратегический менеджмент', 'strategy development', 'стратегия развития', 'технологическая стратегия', 'technology strategy'],
    textPatterns: ['стратегическ\\S*\\s+планирован\\S*', 'разработк\\S*\\s+стратег\\S*', 'стратег\\S*\\s+развит\\S*', 'стратегическ\\S*\\s+менеджмент\\S*', 'бизнес[\\s-]стратег\\S*', 'strategic\\s+planning', 'business\\s+strategy', 'technology\\s+strategy'],
  },
  {
    canonical: 'OKR / KPI',
    synonyms: ['OKR', 'KPI', 'okr', 'kpi', 'okrs', 'kpis', 'цели и kpi', 'система kpi', 'постановка kpi', 'метрики и kpi', 'OKR / KPI', 'OKRs and KPIs'],
    textPatterns: ['okr', 'kpi', 'okrs', 'kpis', 'цел\\S*\\s+и\\s+kpi', 'систем\\S*\\s+kpi'],
  },
  {
    canonical: 'Операционная эффективность',
    synonyms: ['операционная эффективность', 'оптимизация бизнес-процессов', 'управление процессами', 'управление бизнес-процессами', 'управление бизнес процессами', 'оптимизация процессов', 'operational excellence', 'operational efficiency', 'process optimization', 'business process management', 'BPM', 'эффективность процессов', 'регламенты и процессы', 'описание бизнес-процессов'],
    textPatterns: ['операционн\\S*\\s+эффективност\\S*', 'оптимизац\\S*\\s+(?:бизнес[\\s-])?процесс\\S*', 'управлен\\S*\\s+(?:бизнес[\\s-])?процесс\\S*', 'operational\\s+(?:excellence|efficiency)', 'process\\s+optimization', 'business\\s+process\\s+management', '\\bbpm\\b'],
  },
  {
    canonical: 'Lean',
    synonyms: ['Lean', 'lean', 'бережливое производство', 'lean management', 'kaizen', 'лин', 'бережливые процессы', '6 sigma', 'six sigma'],
    textPatterns: ['lean(?:\\s+management)?', 'бережлив\\S*\\s+производств\\S*', 'kaizen', 'six\\s+sigma', '6\\s+sigma'],
  },
  {
    canonical: 'M&A',
    synonyms: ['M&A', 'm&a', 'слияния и поглощения', 'mergers and acquisitions', 'сделки m&a'],
    textPatterns: ['m&a', 'слиян\\S*\\s+и\\s+поглощен\\S*', 'mergers\\s+(?:and|&)\\s+acquisitions'],
  },
  {
    canonical: 'Цифровая трансформация',
    synonyms: ['трансформация', 'цифровая трансформация', 'digital transformation', 'трансформация бизнеса', 'бизнес-трансформация', 'change management', 'управление изменениями', 'организационная трансформация'],
    textPatterns: ['цифров\\S*\\s+трансформац\\S*', 'трансформац\\S*\\s+бизнес\\S*', 'digital\\s+transformation', 'change\\s+management', 'управлен\\S*\\s+изменени\\S*'],
  },
  {
    canonical: 'Продажи B2B',
    synonyms: ['продажи B2B', 'продажи b2b', 'b2b продажи', 'b2b sales', 'B2B Sales', 'корпоративные продажи', 'развитие продаж', 'sales-функция'],
    textPatterns: ['b2b\\s+sales', '(?:b2b|b\\s*2\\s*b)\\s+продаж\\S*', 'продаж\\S*\\s+(?:b2b|b\\s*2\\s*b)', 'корпоративн\\S*\\s+продаж\\S*', 'sales[\\s-]функци\\S*'],
  },
  {
    canonical: 'Запуск продукта',
    synonyms: ['запуск продукта', 'product launch', 'запуск новых продуктов', 'вывод продукта на рынок', 'go-to-market', 'GTM', 'gtm'],
    textPatterns: ['запуск\\S*\\s+(?:нов\\S*\\s+)?продукт\\S*', 'вывод\\S*\\s+продукт\\S*\\s+на\\s+рынок', 'product\\s+launch', 'go[\\s-]to[\\s-]market', 'gtm'],
  },
  {
    canonical: 'Управление рисками',
    synonyms: ['управление рисками', 'риск-менеджмент', 'risk management', 'снижение рисков', 'оценка рисков', 'комплаенс', 'compliance', 'incident management', 'управление инцидентами'],
    textPatterns: ['(?:управлен\\S*|снижен\\S*|оценк\\S*)\\s+риск\\S*', 'риск[\\s-]менеджмент\\S*', 'risk\\s+management', 'incident\\s+management', 'управлен\\S*\\s+инцидент\\S*', 'compliance', 'комплаенс'],
  },
  {
    canonical: 'Управление проектами',
    synonyms: ['управление проектами', 'проектное управление', 'project management', 'ведение проектов', 'руководство проектами'],
    textPatterns: ['(?:управлен\\S*|руководств\\S*|веден\\S*)\\s+проект\\S*', 'проектн\\S*\\s+управлен\\S*', 'project\\s+management'],
  },
  {
    canonical: 'Операционное управление',
    synonyms: ['операционное управление', 'operations management', 'руководство операциями', 'операционный менеджмент', 'операционная деятельность', 'управление операциями'],
    textPatterns: ['операционн\\S*\\s+(?:управлен\\S*|деятельност\\S*|менеджмент\\S*)', 'operations\\s+management', '(?:руководств\\S*|управлен\\S*)\\s+операци\\S*'],
  },
  {
    canonical: 'Управление стейкхолдерами',
    synonyms: ['управление стейкхолдерами', 'stakeholder management', 'взаимодействие со стейкхолдерами', 'работа со стейкхолдерами'],
    textPatterns: ['(?:управлен\\S*|взаимодейств\\S*|работ\\S*)\\s+(?:с[о]?\\s+)?стейкхолдер\\S*', 'stakeholder\\s+management'],
  },
  {
    canonical: 'Управление подрядчиками',
    synonyms: ['управление вендорами', 'vendor management', 'работа с подрядчиками', 'управление подрядчиками', 'vendor relationship management', 'работа с партнерами', 'партнёрства'],
    textPatterns: ['(?:управлен\\S*|работ\\S*)\\s+(?:с[о]?\\s+)?(?:подрядчик\\S*|вендор\\S*|партнер\\S*|партнёр\\S*)', 'vendor\\s+(?:relationship\\s+)?management', 'партнёрств\\S*'],
  },
  {
    canonical: 'Развитие бизнеса',
    synonyms: ['развитие бизнеса', 'business development', 'bizdev', 'бизнес-девелопмент'],
    textPatterns: ['развит\\S*\\s+бизнес\\S*', 'business\\s+development', 'bizdev'],
  },
  {
    canonical: 'Unit-экономика',
    synonyms: ['unit-экономика', 'юнит-экономика', 'unit economics', 'unit-экономикой'],
    textPatterns: ['(?:unit|юнит)[\\s-]экономик\\S*', 'unit\\s+economics'],
  },
  {
    canonical: 'Найм и развитие талантов',
    synonyms: ['найм', 'подбор персонала', 'talent acquisition', 'talent acquisition & team development', 'мотивация персонала', 'обучение и развитие', 'развитие талантов'],
    textPatterns: ['talent\\s+acquisition', 'найм\\S*|подбор\\S*\\s+персонал\\S*', 'мотивац\\S*\\s+персонал\\S*', 'обучен\\S*\\s+и\\s+развит\\S*', 'развит\\S*\\s+талант\\S*'],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Быстрая карта нормализованных строк синонимов к каноническому имени. */
const SYNONYM_TO_CANONICAL = new Map<string, string>();
for (const entry of MANAGEMENT_SKILLS_DICTIONARY) {
  SYNONYM_TO_CANONICAL.set(normalizeTextForComparison(entry.canonical), entry.canonical);
  for (const synonym of entry.synonyms) {
    SYNONYM_TO_CANONICAL.set(normalizeTextForComparison(synonym), entry.canonical);
  }
}

/**
 * Приводит навык или его синоним к каноническому названию.
 * Неизвестные технические и прикладные термины возвращаются как есть.
 */
export function canonicalizeSkill(skill: string): string {
  const norm = normalizeTextForComparison(skill);
  return SYNONYM_TO_CANONICAL.get(norm) ?? skill.trim();
}

interface CompiledPattern {
  readonly canonical: string;
  readonly regex: RegExp;
}

/** Предкомпилированные регулярные выражения с поддержкой Unicode-границ слов. */
const COMPILED_PATTERNS: CompiledPattern[] = MANAGEMENT_SKILLS_DICTIONARY.map((entry) => {
  const patterns: string[] = [];
  if (entry.textPatterns && entry.textPatterns.length > 0) {
    patterns.push(...entry.textPatterns);
  }
  const escapedSynonyms = entry.synonyms.map((s) => escapeRegExp(s));
  patterns.push(...escapedSynonyms);

  const sorted = [...patterns].sort((a, b) => b.length - a.length);
  const unionPattern = sorted.join('|');
  const regex = new RegExp(`(?<=^|[^\\p{L}\\p{N}])(?:${unionPattern})(?=$|[^\\p{L}\\p{N}])`, 'ui');
  return { canonical: entry.canonical, regex };
});

/**
 * Извлекает управленческие требования из текста описания вакансии,
 * возвращая список уникальных канонических названий.
 */
export function extractManagementSkillsFromText(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  const found = new Set<string>();
  for (const { canonical, regex } of COMPILED_PATTERNS) {
    if (regex.test(text)) {
      found.add(canonical);
    }
  }
  return Array.from(found);
}
