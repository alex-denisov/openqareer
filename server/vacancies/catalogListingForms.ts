/**
 * B569: grammatical forms for the listing page head («Вакансии бухгалтера в
 * Москве»). Declension by rule is invention, so the forms come from fixed
 * tables; a role or city that is not in them keeps the plain heading.
 */
import { interviewProfession } from '../../shared/interviewQuestions';

/** slug -> [genitive «вакансии Москвы», prepositional «в Москве»]. */
const CITY_FORMS: Readonly<Record<string, readonly [string, string]>> = {
  moscow: ['Москвы', 'Москве'],
  'saint-petersburg': ['Санкт-Петербурга', 'Санкт-Петербурге'],
  minsk: ['Минска', 'Минске'],
  tashkent: ['Ташкента', 'Ташкенте'],
  yekaterinburg: ['Екатеринбурга', 'Екатеринбурге'],
  kazan: ['Казани', 'Казани'],
  novosibirsk: ['Новосибирска', 'Новосибирске'],
  berlin: ['Берлина', 'Берлине'],
  dubai: ['Дубая', 'Дубае'],
  yerevan: ['Еревана', 'Ереване'],
  tbilisi: ['Тбилиси', 'Тбилиси'],
  belgrade: ['Белграда', 'Белграде'],
  almaty: ['Алматы', 'Алматы'],
  krasnodar: ['Краснодара', 'Краснодаре'],
  samara: ['Самары', 'Самаре'],
  ufa: ['Уфы', 'Уфе'],
  voronezh: ['Воронежа', 'Воронеже'],
};

const ROLE_GENITIVE: Readonly<Record<string, string>> = {
  'chief-accountant': 'главного бухгалтера',
  lawyer: 'юриста',
  designer: 'дизайнера',
  translator: 'переводчика',
  'sales-manager': 'менеджера по продажам',
  'product-manager': 'менеджера продукта',
  'marketing-manager': 'менеджера по маркетингу',
  'hr-manager': 'HR-менеджера',
  'business-analyst': 'бизнес-аналитика',
  'system-administrator': 'системного администратора',
};

const ROLE_DATIVE: Readonly<Record<string, string>> = {
  accountant: 'бухгалтеру',
  'chief-accountant': 'главному бухгалтеру',
  'project-manager': 'менеджеру проектов',
  'data-analyst': 'аналитику данных',
  'recruiter-talent-acquisition-specialist': 'рекрутеру',
  'customer-support-agent': 'специалисту поддержки клиентов',
  'head-sales': 'руководителю отдела продаж',
  lawyer: 'юристу',
  designer: 'дизайнеру',
  translator: 'переводчику',
  'sales-manager': 'менеджеру по продажам',
  'product-manager': 'менеджеру продукта',
  'marketing-manager': 'менеджеру по маркетингу',
  'hr-manager': 'HR-менеджеру',
  'business-analyst': 'бизнес-аналитику',
  'system-administrator': 'системному администратору',
};

export function roleDative(role: string): string | undefined {
  return ROLE_DATIVE[role];
}

export function cityGenitive(place: string): string | undefined {
  return CITY_FORMS[place]?.[0];
}

export function cityPrepositional(place: string): string | undefined {
  return CITY_FORMS[place]?.[1];
}

export function roleGenitive(role: string): string | undefined {
  return interviewProfession(role)?.genitive ?? ROLE_GENITIVE[role];
}
