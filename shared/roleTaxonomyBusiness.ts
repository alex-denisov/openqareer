import type { RoleFunctionDefinition } from './roleTaxonomy';

/**
 * Вторая половина словаря функций (B267 §2, S1): бизнес-функции отдельно от
 * технических (`roleTaxonomy.ts`), чтобы каждый файл оставался читаемым
 * (< 400 строк). `ROLE_TAXONOMY` в `roleTaxonomy.ts` — это конкатенация
 * технической и бизнес-части, порядок в объединённом списке не меняется.
 */
export const ROLE_TAXONOMY_BUSINESS: readonly RoleFunctionDefinition[] = [
  {
    code: 'sales',
    labelEn: 'Sales',
    labelRu: 'Продажи',
    anchors: [
      'vp of sales', 'vp sales', 'channel sales', 'sales director', 'sales manager', 'sales engineer',
      'account executive', 'account manager', 'account director', 'account representative', 'key account manager',
      'territory executive', 'territory account', 'sales development representative', 'business development representative',
      'inside sales', 'relationship manager', 'client partner', 'ejecutivo de ventas', 'executivo de vendas',
      'vendedor', 'vendas', 'consultor comercial', 'channel',
      'менеджер по продажам', 'руководитель отдела продаж', 'директор по продажам', 'sales', 'comercial', 'venta', 'ventas', 'accounts', 'deal desk',
    ],
  },
  {
    code: 'bizdev',
    labelEn: 'Business Development',
    labelRu: 'Развитие бизнеса',
    anchors: [
      'business development manager', 'business development', 'partnerships manager', 'partner manager',
      'deployment strategist', 'partner development', 'partner agreements', 'partner', 'ecosystem', 'corporate development',
      'развитие бизнеса', 'менеджер по развитию',
    ],
  },
  {
    code: 'marketing',
    labelEn: 'Marketing',
    labelRu: 'Маркетинг',
    anchors: [
      'cmo', 'head of growth', 'growth marketing', 'growth', 'marketing manager', 'marketing director',
      'product marketing', 'demand generation', 'digital marketing', 'content marketing', 'brand design',
      'paid media', 'seo', 'campaigns', 'consumer insights', 'insights', 'social media',
      'маркетолог', 'директор по маркетингу', 'руководитель отдела маркетинга', 'marketing',
    ],
  },
  {
    code: 'pr',
    labelEn: 'PR & Communications',
    labelRu: 'PR и коммуникации',
    anchors: [
      'pr manager', 'public relations', 'communications manager', 'corporate communications',
      'internal communications', 'executive communications',
      'пиар-менеджер', 'специалист по связям с общественностью',
    ],
  },
  {
    code: 'support',
    labelEn: 'Customer Support',
    labelRu: 'Поддержка клиентов',
    anchors: [
      'customer support', 'technical support', 'support specialist', 'customer success', 'customer service',
      'call center', 'client services', 'kundenservice', 'customer retention', 'retention', 'fidelización',
      'служба поддержки', 'специалист поддержки',
    ],
  },
  {
    code: 'finance',
    labelEn: 'Finance',
    labelRu: 'Финансы',
    anchors: [
      'cfo', 'financial analyst', 'finance manager', 'accounting', 'accountant', 'payroll',
      'fp&a', 'treasury', 'capital markets', 'financial data', 'tax', 'accounts payable', 'financial controls',
      'credit analyst',
      'финансовый директор', 'финансовый аналитик', 'бухгалтер', 'экономист', 'finance',
    ],
  },
  {
    code: 'audit-risk',
    labelEn: 'Audit & Risk',
    labelRu: 'Аудит и риски',
    anchors: [
      'internal audit', 'risk manager', 'compliance officer', 'compliance manager', 'compliance coordinator',
      'governance, risk', 'risk advisor', 'sanctions compliance', 'risk analyst', 'compliance analyst', 'compliance',
      'аудитор', 'риск-менеджер',
    ],
  },
  {
    code: 'hr',
    labelEn: 'Human Resources',
    labelRu: 'Персонал',
    anchors: [
      'hr manager', 'hr business partner', 'hrbp', 'human resources', 'recruiter', 'recruiting',
      'talent acquisition', 'talent brand', 'people operations', 'employee engagement', 'compensation',
      'people leader', 'business partner de rh',
      'менеджер по персоналу', 'рекрутер',
    ],
  },
  {
    code: 'legal',
    labelEn: 'Legal',
    labelRu: 'Юридический отдел',
    anchors: ['legal counsel', 'lawyer', 'attorney', 'trademark counsel', 'corporate counsel', 'counsel', 'юрист', 'юрисконсульт'],
  },
  {
    code: 'procurement',
    labelEn: 'Procurement',
    labelRu: 'Закупки',
    anchors: [
      'procurement manager', 'purchasing manager', 'sourcing manager', 'site procurement',
      'закупки', 'менеджер по закупкам', 'vendor',
    ],
  },
  {
    code: 'logistics',
    labelEn: 'Logistics',
    labelRu: 'Логистика',
    anchors: [
      'logistics manager', 'supply chain manager', 'supply chain', 'warehouse', 'shipping', 'material planning',
      'логист', 'логистика',
    ],
  },
  {
    code: 'manufacturing',
    labelEn: 'Manufacturing',
    labelRu: 'Производство',
    anchors: [
      'production manager', 'manufacturing engineer', 'production supervisor', 'facilities technician',
      'maintenance technician', 'controls technician', 'propulsion technician', 'automotive technician',
      'module equipment technician', 'building maintenance', 'quality technician', 'technician',
      'производство', 'технолог',
    ],
  },
  {
    code: 'retail',
    labelEn: 'Retail',
    labelRu: 'Розничная торговля',
    anchors: ['store manager', 'retail manager', 'store leader', 'store', 'директор магазина', 'продавец-консультант'],
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
    anchors: ['teacher', 'tutor', 'professor', 'learning & development', 'training coordinator', 'training', 'learning', 'преподаватель', 'учитель'],
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
    anchors: [
      'project manager', 'program manager', 'scrum master', 'technical program manager',
      'engagement manager', 'pmo', 'delivery manager',
      'менеджер проектов', 'руководитель проекта', 'проджект-менеджер',
    ],
  },
  {
    code: 'research',
    labelEn: 'Research & Development',
    labelRu: 'Исследования и разработка',
    anchors: ['researcher', 'research scientist', 'research fellow', 'applied scientist', 'r&d', 'научный сотрудник'],
  },
  {
    code: 'exec-general',
    labelEn: 'General Management',
    labelRu: 'Общее руководство',
    anchors: [
      'ceo', 'chief executive officer', 'general manager', 'generaldirector', 'chief of staff',
      'chief product technology officer',
      'генеральный директор',
    ],
  },
  {
    code: 'admin',
    labelEn: 'Office Administration',
    labelRu: 'Административная работа',
    anchors: [
      'office manager', 'administrative assistant', 'executive assistant', 'corporate secretary',
      'офис-менеджер', 'администратор',
    ],
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
    anchors: ['content producer', 'video editor', 'journalist', 'videomaker', 'журналист', 'продюсер'],
  },
  {
    code: 'other',
    labelEn: 'Other',
    labelRu: 'Другое',
    /**
     * Без опорных слов: код для честного «не удалось определить» вместо
     * добивки в произвольную функцию (B267 S1 §3). `rulesParse` подставляет
     * его отдельным фолбэком, когда обычный подбор ничего не нашёл, а
     * заголовок всё же называет должность — см. `pickFallbackFunction`.
     */
    anchors: [],
  },
];
