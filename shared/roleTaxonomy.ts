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
import { ROLE_TAXONOMY_BUSINESS } from './roleTaxonomyBusiness';

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
  | 'media'
  | 'other';

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

const ROLE_TAXONOMY_TECH: readonly RoleFunctionDefinition[] = [
  {
    code: 'eng',
    labelEn: 'Software Engineering',
    labelRu: 'Разработка',
    anchors: [
      'software engineer', 'backend developer', 'frontend developer', 'front-end developer', 'front end developer',
      'full stack developer', 'full-stack developer', 'solutions architect', 'solution architect',
      'software architect', 'enterprise architect', 'software development engineer', 'site reliability engineer',
      'systems engineer', 'embedded software engineer', 'platform engineer', 'developer relations engineer',
      'software engineering', 'applications',
      'desenvolvedor', 'développeur', 'ingénieur logiciel', 'entwickler',
      'ソフトウェア開発', 'エンジニア', '开发', '工程师',
      'developer', 'programmer', 'engineer', 'architect',
      'разработчик', 'программист', 'бэкенд', 'фронтенд', 'c++',
    ],
  },
  {
    code: 'eng-mgmt',
    labelEn: 'Engineering Management',
    labelRu: 'Руководство разработкой',
    anchors: [
      'vp of engineering', 'vp engineering', 'vp technology', 'vp of technology', 'vp of software engineering', 'cto',
      'engineering manager', 'head of engineering', 'head of technology', 'technical director', 'director of engineering',
      'director - software engineering', 'director, software engineering', 'software engineering manager',
      'software development manager', 'engineering program manager', 'technical lead', 'tech lead',
      'технический директор', 'директор по технологиям', 'руководитель разработки', 'it директор',
      'цифровой трансформации', 'цифровая трансформация',
    ],
  },
  {
    code: 'it-ops',
    labelEn: 'IT Operations',
    labelRu: 'ИТ-инфраструктура',
    anchors: [
      'cio', 'it infrastructure', 'it operations', 'it support', 'system administrator', 'sysadmin',
      'network engineer', 'devops engineer', 'devops', 'cloud infrastructure', 'infrastructure engineer',
      'site reliability', 'data center', 'vdi administrator', 'database administrator', 'infrastructure',
      'infraestructura', 'インフラ', 'ネットワーク', 'devopsエンジニア', '运维', '网络',
      'ит-инфраструктура', 'системный администратор', 'руководитель ит-инфраструктуры', 'ит-директор',
      'администратор баз данных', 'дата-центр', 'цод', 'эксплуатации',
    ],
  },
  {
    code: 'data',
    labelEn: 'Data',
    labelRu: 'Данные',
    anchors: [
      'data engineer', 'data analyst', 'data architect', 'data scientist', 'data platform',
      'business intelligence', 'analytics engineer', 'データ', '数据',
      'аналитик данных', 'инженер данных', 'дата-инженер', 'data', 'analytics',
    ],
  },
  {
    code: 'ai-ml',
    labelEn: 'AI / ML',
    labelRu: 'Искусственный интеллект и ML',
    anchors: [
      'machine learning engineer', 'ml engineer', 'ai researcher', 'ai engineer', 'applied ai',
      'generative ai', 'ai/ml', 'aiエンジニア', '人工智能',
      'машинное обучение', 'инженер машинного обучения', 'специалист по искусственному интеллекту', 'ai', 'ml',
    ],
  },
  {
    code: 'security',
    labelEn: 'Security',
    labelRu: 'Информационная безопасность',
    anchors: [
      'security engineer', 'security architect', 'cybersecurity', 'infosec', 'ciso', 'endpoint', 'cyber',
      'information security', 'security specialist', 'security research', 'blockchain security', 'セキュリティ', '信息安全',
      'информационная безопасность', 'специалист по безопасности', 'инженер по безопасности',
      'специалист по информационной безопасности', 'security',
    ],
  },
  {
    code: 'qa',
    labelEn: 'QA',
    labelRu: 'Тестирование',
    anchors: [
      'qa engineer', 'test automation', 'quality assurance', 'software test engineer', 'test engineer',
      'qaエンジニア', '测试', 'tester', 'тестировщик', 'инженер по тестированию',
    ],
  },
  {
    code: 'product',
    labelEn: 'Product Management',
    labelRu: 'Управление продуктом',
    anchors: [
      'cpo', 'product manager', 'product owner', 'technical product manager', 'product management',
      'product design engineer', 'product strategy', 'product strategist', 'marketplace', 'catalog',
      'プロダクトマネージャー', '产品经理',
      'продакт-менеджер', 'менеджер продукта', 'владелец продукта', 'product',
    ],
  },
  {
    code: 'design',
    labelEn: 'Design',
    labelRu: 'Дизайн',
    anchors: [
      'ux designer', 'ui designer', 'product designer', 'graphic designer', 'art director',
      'motion graphics', 'ux/ui', 'ux researcher', 'service designer', 'creative strategy',
      'クリエイティブ', 'デザイナー', '设计师',
      'графический дизайнер', 'дизайнер', 'designer', 'design',
    ],
  },
  {
    code: 'ops',
    labelEn: 'Operations',
    labelRu: 'Операционное управление',
    anchors: [
      'coo', 'chief operating officer', 'operations manager', 'business operations', 'operations lead',
      'operations',
      'операционный директор', 'руководитель операционного отдела', 'директор по операциям', 'операции',
    ],
  },
];

export const ROLE_TAXONOMY: readonly RoleFunctionDefinition[] = [...ROLE_TAXONOMY_TECH, ...ROLE_TAXONOMY_BUSINESS];

const FUNCTION_CODES: ReadonlySet<string> = new Set(ROLE_TAXONOMY.map((entry) => entry.code));

/** Модель может назвать код, которого нет в словаре — такой ответ отклоняется. */
export function isKnownFunctionCode(code: string): code is FunctionCode {
  return FUNCTION_CODES.has(code);
}
