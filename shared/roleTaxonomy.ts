/**
 * Замкнутый словарь функций для смыслового подбора вакансий (B267 §2).
 *
 * Раньше подбор искал роль подстрокой по свободному тексту — «VP of Channel
 * Sales» попадал в выдачу CTO через слово «VP» (B267 §1). Замкнутый словарь
 * убирает нечёткое сравнение строк: подбор становится равенством по коду.
 * Ответ модели, который называет код не из словаря, отклоняется и уходит на
 * правила (`rulesParse`).
 *
 * Список версионируется `TAXONOMY_VERSION`: смена набора кодов требует
 * перепрогона только затронутых `title_key`, а не всей таблицы.
 */
export const TAXONOMY_VERSION = 1;

export type FunctionCode =
  | 'eng'
  | 'eng-mgmt'
  | 'it-ops'
  | 'data'
  | 'ai-ml'
  | 'security'
  | 'qa'
  | 'product'
  | 'design'
  | 'ops'
  | 'sales'
  | 'bizdev'
  | 'marketing'
  | 'pr'
  | 'support'
  | 'finance'
  | 'audit-risk'
  | 'hr'
  | 'legal'
  | 'procurement'
  | 'logistics'
  | 'manufacturing'
  | 'retail'
  | 'hospitality'
  | 'agriculture'
  | 'healthcare'
  | 'education'
  | 'consulting'
  | 'project-mgmt'
  | 'research'
  | 'exec-general'
  | 'admin'
  | 'real-estate'
  | 'construction'
  | 'media';

export interface RoleFunctionDefinition {
  readonly code: FunctionCode;
  readonly labelEn: string;
  readonly labelRu: string;
  /**
   * Опорные слова и фразы для `rulesParse`: нижний регистр, без пунктуации.
   * Фразы из нескольких слов идут раньше одиночных слов того же смысла —
   * `rulesParse` отдаёт им приоритет как более точным.
   */
  readonly anchors: readonly string[];
}

export const ROLE_TAXONOMY: readonly RoleFunctionDefinition[] = [
  {
    code: 'eng',
    labelEn: 'Software Engineering',
    labelRu: 'Разработка',
    anchors: [
      'software engineer', 'backend developer', 'frontend developer', 'full stack developer',
      'developer', 'programmer', 'engineer', 'разработчик', 'программист', 'бэкенд', 'фронтенд',
    ],
  },
  {
    code: 'eng-mgmt',
    labelEn: 'Engineering Management',
    labelRu: 'Руководство разработкой',
    anchors: [
      'vp of engineering', 'vp engineering', 'vp technology', 'vp of technology', 'cto',
      'engineering manager', 'head of engineering', 'head of technology', 'technical director',
      'технический директор', 'директор по технологиям', 'руководитель разработки', 'it директор',
    ],
  },
  {
    code: 'it-ops',
    labelEn: 'IT Operations',
    labelRu: 'ИТ-инфраструктура',
    anchors: [
      'cio', 'it infrastructure', 'it operations', 'system administrator', 'sysadmin',
      'network engineer', 'devops engineer', 'devops', 'ит-инфраструктура', 'системный администратор',
      'руководитель ит-инфраструктуры', 'ит-директор',
    ],
  },
  {
    code: 'data',
    labelEn: 'Data',
    labelRu: 'Данные',
    anchors: ['data engineer', 'data analyst', 'аналитик данных', 'инженер данных', 'дата-инженер'],
  },
  {
    code: 'ai-ml',
    labelEn: 'AI / ML',
    labelRu: 'Искусственный интеллект и ML',
    anchors: [
      'machine learning engineer', 'ml engineer', 'data scientist', 'ai researcher',
      'машинное обучение', 'инженер машинного обучения', 'специалист по искусственному интеллекту',
    ],
  },
  {
    code: 'security',
    labelEn: 'Security',
    labelRu: 'Информационная безопасность',
    anchors: [
      'security engineer', 'cybersecurity', 'infosec', 'информационная безопасность',
      'специалист по безопасности', 'инженер по безопасности',
    ],
  },
  {
    code: 'qa',
    labelEn: 'QA',
    labelRu: 'Тестирование',
    anchors: ['qa engineer', 'test automation', 'quality assurance', 'tester', 'тестировщик', 'инженер по тестированию'],
  },
  {
    code: 'product',
    labelEn: 'Product Management',
    labelRu: 'Управление продуктом',
    anchors: ['cpo', 'product manager', 'product owner', 'продакт-менеджер', 'менеджер продукта', 'владелец продукта'],
  },
  {
    code: 'design',
    labelEn: 'Design',
    labelRu: 'Дизайн',
    anchors: ['ux designer', 'ui designer', 'product designer', 'графический дизайнер', 'дизайнер'],
  },
  {
    code: 'ops',
    labelEn: 'Operations',
    labelRu: 'Операционное управление',
    anchors: [
      'coo', 'chief operating officer', 'operations manager', 'business operations', 'operations',
      'операционный директор', 'руководитель операционного отдела', 'директор по операциям', 'операции',
    ],
  },
  {
    code: 'sales',
    labelEn: 'Sales',
    labelRu: 'Продажи',
    anchors: [
      'vp of sales', 'vp sales', 'channel sales', 'sales director', 'sales manager',
      'account executive', 'менеджер по продажам', 'руководитель отдела продаж', 'директор по продажам',
    ],
  },
  {
    code: 'bizdev',
    labelEn: 'Business Development',
    labelRu: 'Развитие бизнеса',
    anchors: ['business development manager', 'business development', 'partnerships manager', 'развитие бизнеса', 'менеджер по развитию'],
  },
  {
    code: 'marketing',
    labelEn: 'Marketing',
    labelRu: 'Маркетинг',
    anchors: [
      'cmo', 'head of growth', 'growth marketing', 'growth', 'marketing manager', 'marketing director',
      'маркетолог', 'директор по маркетингу', 'руководитель отдела маркетинга',
    ],
  },
  {
    code: 'pr',
    labelEn: 'PR & Communications',
    labelRu: 'PR и коммуникации',
    anchors: ['pr manager', 'public relations', 'communications manager', 'пиар-менеджер', 'специалист по связям с общественностью'],
  },
  {
    code: 'support',
    labelEn: 'Customer Support',
    labelRu: 'Поддержка клиентов',
    anchors: ['customer support', 'technical support', 'support specialist', 'служба поддержки', 'специалист поддержки'],
  },
  {
    code: 'finance',
    labelEn: 'Finance',
    labelRu: 'Финансы',
    anchors: [
      'cfo', 'financial analyst', 'finance manager', 'финансовый директор', 'финансовый аналитик',
      'бухгалтер', 'экономист',
    ],
  },
  {
    code: 'audit-risk',
    labelEn: 'Audit & Risk',
    labelRu: 'Аудит и риски',
    anchors: ['internal audit', 'risk manager', 'compliance officer', 'аудитор', 'риск-менеджер'],
  },
  {
    code: 'hr',
    labelEn: 'Human Resources',
    labelRu: 'Персонал',
    anchors: ['hr manager', 'hr business partner', 'human resources', 'recruiter', 'менеджер по персоналу', 'рекрутер'],
  },
  {
    code: 'legal',
    labelEn: 'Legal',
    labelRu: 'Юридический отдел',
    anchors: ['legal counsel', 'lawyer', 'attorney', 'юрист', 'юрисконсульт'],
  },
  {
    code: 'procurement',
    labelEn: 'Procurement',
    labelRu: 'Закупки',
    anchors: ['procurement manager', 'purchasing manager', 'закупки', 'менеджер по закупкам'],
  },
  {
    code: 'logistics',
    labelEn: 'Logistics',
    labelRu: 'Логистика',
    anchors: ['logistics manager', 'supply chain manager', 'логист', 'логистика'],
  },
  {
    code: 'manufacturing',
    labelEn: 'Manufacturing',
    labelRu: 'Производство',
    anchors: ['production manager', 'manufacturing engineer', 'производство', 'технолог'],
  },
  {
    code: 'retail',
    labelEn: 'Retail',
    labelRu: 'Розничная торговля',
    anchors: ['store manager', 'retail manager', 'директор магазина', 'продавец-консультант'],
  },
  {
    code: 'hospitality',
    labelEn: 'Hospitality',
    labelRu: 'Гостеприимство',
    anchors: ['hotel manager', 'chef', 'waiter', 'повар', 'официант', 'администратор отеля'],
  },
  {
    code: 'agriculture',
    labelEn: 'Agriculture',
    labelRu: 'Сельское хозяйство',
    anchors: ['agronomist', 'farm manager', 'агроном'],
  },
  {
    code: 'healthcare',
    labelEn: 'Healthcare',
    labelRu: 'Здравоохранение',
    anchors: ['doctor', 'nurse', 'physician', 'врач', 'медсестра', 'фармацевт'],
  },
  {
    code: 'education',
    labelEn: 'Education',
    labelRu: 'Образование',
    anchors: ['teacher', 'tutor', 'professor', 'преподаватель', 'учитель'],
  },
  {
    code: 'consulting',
    labelEn: 'Consulting',
    labelRu: 'Консалтинг',
    anchors: ['management consultant', 'consultant', 'консультант'],
  },
  {
    code: 'project-mgmt',
    labelEn: 'Project Management',
    labelRu: 'Управление проектами',
    anchors: ['project manager', 'program manager', 'scrum master', 'менеджер проектов', 'руководитель проекта'],
  },
  {
    code: 'research',
    labelEn: 'Research & Development',
    labelRu: 'Исследования и разработка',
    anchors: ['researcher', 'research scientist', 'r&d', 'научный сотрудник'],
  },
  {
    code: 'exec-general',
    labelEn: 'General Management',
    labelRu: 'Общее руководство',
    anchors: ['ceo', 'chief executive officer', 'general manager', 'generaldirector', 'генеральный директор'],
  },
  {
    code: 'admin',
    labelEn: 'Office Administration',
    labelRu: 'Административная работа',
    anchors: ['office manager', 'administrative assistant', 'офис-менеджер', 'администратор'],
  },
  {
    code: 'real-estate',
    labelEn: 'Real Estate',
    labelRu: 'Недвижимость',
    anchors: ['real estate agent', 'realtor', 'риэлтор', 'агент по недвижимости'],
  },
  {
    code: 'construction',
    labelEn: 'Construction',
    labelRu: 'Строительство',
    anchors: ['civil engineer', 'construction manager', 'прораб', 'инженер-строитель'],
  },
  {
    code: 'media',
    labelEn: 'Media & Content',
    labelRu: 'Медиа и контент',
    anchors: ['content producer', 'video editor', 'journalist', 'журналист', 'продюсер'],
  },
];

const FUNCTION_CODES: ReadonlySet<string> = new Set(ROLE_TAXONOMY.map((entry) => entry.code));

/** Модель может назвать код, которого нет в словаре — такой ответ отклоняется. */
export function isKnownFunctionCode(code: string): code is FunctionCode {
  return FUNCTION_CODES.has(code);
}
