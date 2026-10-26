import type { TaxDataSource } from '../taxData/types';

const source = (
  title: string,
  url: string,
  dataYear: number,
  retrievedAt: string,
): TaxDataSource => ({
  title,
  url,
  dataYear,
  retrievedAt,
});

/** First pass of official pages. */
const first = '2026-10-10';
/** Second pass: every pair checked against its official page for 2026. */
const second = '2026-10-26';

/** The official Russian legal portal serves only plain http; it is still the primary source. */
const OFFICIAL_HTTP_ONLY_HOSTS: ReadonlySet<string> = new Set(['pravo.gov.ru']);

export function isVerifiableSource(evidence: TaxDataSource | undefined): evidence is TaxDataSource {
  if (
    !evidence ||
    !evidence.title ||
    !Number.isInteger(evidence.dataYear) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(evidence.retrievedAt)
  ) {
    return false;
  }
  try {
    const url = new URL(evidence.url);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && OFFICIAL_HTTP_ONLY_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
}

export const sources = {
  eaeu: source(
    'Договор о Евразийском экономическом союзе, статья 97',
    'https://old.adilet.zan.kz/eng/docs/Z1400000240',
    2015,
    first,
  ),
  euFreeMovement: source(
    'Европейский союз: право граждан ЕС работать в другой стране ЕС',
    'https://europa.eu/youreurope/citizens/work/work-abroad/index_en.htm',
    2026,
    first,
  ),
  germanBlueCard: source(
    'Правительство Германии: требования EU Blue Card и пороги зарплаты на 2026 год',
    'https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card',
    2026,
    first,
  ),
  germanOpportunityCard: source(
    'Правительство Германии: Chancenkarte, баллы и средства на 2026 год',
    'https://www.make-it-in-germany.com/en/visa-residence/opportunity-card/job-search',
    2026,
    first,
  ),
  germanFreelance: source(
    'Закон Германии о пребывании (AufenthG), § 21: разрешение для свободных профессий',
    'https://www.gesetze-im-internet.de/aufenthg_2004/__21.html',
    2026,
    second,
  ),
  ukSkilledWorker: source(
    'GOV.UK: требования Skilled Worker, минимальная зарплата и ставка профессии',
    'https://www.gov.uk/skilled-worker-visa/your-job',
    2026,
    first,
  ),
  ukHighPotential: source(
    'GOV.UK: High Potential Individual — диплом университета из списка за последние 5 лет',
    'https://www.gov.uk/high-potential-individual-visa/eligibility',
    2026,
    second,
  ),
  ukHighPotentialFunds: source(
    'GOV.UK: High Potential Individual — £1 270 на счёте 28 дней подряд',
    'https://www.gov.uk/high-potential-individual-visa/how-much-it-costs',
    2026,
    second,
  ),
  ukHighPotentialEnglish: source(
    'GOV.UK: High Potential Individual — английский не ниже B2',
    'https://www.gov.uk/high-potential-individual-visa/knowledge-of-english',
    2026,
    second,
  ),
  ukGraduate: source(
    'GOV.UK: Graduate visa — после британской программы по студенческой визе',
    'https://www.gov.uk/graduate-visa',
    2026,
    second,
  ),
  ukGlobalTalent: source(
    'GOV.UK: Global Talent — лидеры науки, искусства и цифровых технологий',
    'https://www.gov.uk/global-talent',
    2026,
    second,
  ),
  ukVisitor: source(
    'GOV.UK: гостевая виза — разрешённые деловые действия, для другой работы нужна рабочая виза',
    'https://www.gov.uk/standard-visitor/visit-on-business',
    2026,
    second,
  ),
  ukCommonTravelArea: source(
    'GOV.UK: Common Travel Area — граждане Ирландии живут и работают без разрешения (ред. 01.01.2026)',
    'https://www.gov.uk/government/publications/common-travel-area-guidance/common-travel-area-guidance',
    2026,
    second,
  ),
  uaeEmployment: source(
    'Официальный портал ОАЭ: оффер, договор, разрешение на работу и рабочая виза',
    'https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/expatriates-employment-in-private-sector',
    2026,
    second,
  ),
  uaeWorkOnVisit: source(
    'Официальный портал ОАЭ: работа по гостевой или туристической визе запрещена',
    'https://u.ae/en/information-and-services/jobs/Sector-of-employment/employment-in-the-private-sector/preparing-to-work',
    2026,
    second,
  ),
  uaeVisaFree: source(
    'МИД ОАЭ: перечень стран с безвизовым въездом',
    'https://www.mofa.gov.ae/en/visa-exemptions-for-non-citizen',
    2026,
    second,
  ),
  uaeJobSeeker: source(
    'Официальный портал ОАЭ: виза для поиска работы и критерии образования/квалификации',
    'https://u.ae/en/information-and-services/visa-and-emirates-id/Types-of-visas/Visit-visa/jobseeker-visit-visa',
    2026,
    second,
  ),
  uaeRemoteWork: source(
    'GDRFA Dubai: виртуальная рабочая резиденция — работа на компанию вне ОАЭ, доход от $3 500 в месяц',
    'https://www.gdrfad.gov.ae/en/services/64154a31-ec6d-11ec-140b-0050569629e8',
    2026,
    second,
  ),
  serbiaWork: source(
    'Правительство Сербии: единый ВНЖ и разрешение на работу для иностранцев',
    'https://welcometoserbia.gov.rs/residence-and-work-permit',
    2026,
    second,
  ),
  serbiaFindJob: source(
    'Правительство Сербии: виза D выдаётся под найденную работу',
    'https://welcometoserbia.gov.rs/find-a-job',
    2026,
    second,
  ),
  serbiaDigitalNomads: source(
    'Правительство Сербии: цифровые кочевники — налоговые льготы без отдельного ВНЖ',
    'https://welcometoserbia.gov.rs/digital-nomads-in-serbia',
    2026,
    second,
  ),
  cyprusDigitalNomad: source(
    'Migration Department of Cyprus: Digital Nomad Visa — кто может подать',
    'https://www.gov.cy/mip-md/en/documents/digital-nomads-and-family-members/',
    2025,
    second,
  ),
  cyprusDigitalNomadDocuments: source(
    'Migration Department of Cyprus: документы Digital Nomad — доход, надбавки за семью, страховка (v.19.03.2025)',
    'https://www.gov.cy/app/uploads/sites/174/2025/12/Accompanying-Documents_VIS-Digital-Nomad_19032025.pdf',
    2025,
    second,
  ),
  cyprusForeignInterest: source(
    'Migration Department of Cyprus: компании иностранного капитала — от €2 500 в месяц, контракт от 2 лет',
    'https://www.gov.cy/mip-md/en/documents/legislation-and-policy/',
    2025,
    second,
  ),
  cyprusWork: source(
    'Migration Department of Cyprus: основания для работы иностранцев',
    'https://www.gov.cy/mip-md/en/documents/temporary-residence/work/',
    2025,
    second,
  ),
  georgiaLabourMigration: source(
    'Закон Грузии «О трудовой миграции» (ред. от 25.06.2026): право на работу с 1 марта 2026 года',
    'https://matsne.gov.ge/en/document/view/2806732',
    2026,
    second,
  ),
  georgiaAliens: source(
    'Закон Грузии «О правовом статусе иностранцев и лиц без гражданства» (ред. от 25.06.2026): виды виз и ВНЖ',
    'https://matsne.gov.ge/en/document/view/2278806',
    2026,
    second,
  ),
  georgiaVisaFree: source(
    'МИД Грузии: граждане России въезжают без визы и пребывают 1 год (постановление № 255)',
    'https://geoconsul.gov.ge/en/entering-georgia-visa',
    2026,
    second,
  ),
  russiaForeignWork: source(
    'Федеральный закон № 115-ФЗ (ред. от 26.07.2026), статьи 13 и 13.2: разрешение на работу, патент, ВКС',
    'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102078147',
    2026,
    second,
  ),
  russiaVisaTypes: source(
    'Федеральный закон № 114-ФЗ (ред. от 26.06.2026), статья 25.6: виды обыкновенных виз',
    'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102043016',
    2026,
    second,
  ),
  // Wave 1 of the expansion, read on 2026-10-26.
  armeniaWorkPermit: source(
    'Служба миграции и гражданства Армении, workpermit.am: ВНЖ по работе оформляет работодатель, граждане ЕАЭС освобождены',
    'https://workpermit.am/en/about',
    2026,
    second,
  ),
  armeniaResidenceGrounds: source(
    'Служба миграции и гражданства Армении: основания временного вида на жительство',
    'https://migration.mia.gov.am/en/acquiring-temporary-residence-status',
    2026,
    second,
  ),
  armeniaVisaFreeList: source(
    'МИД Армении: граждане России въезжают без визы по всем видам паспортов',
    'https://www.mfa.am/en/whoneedvisa/',
    2024,
    second,
  ),
  armeniaVisaFreeStay: source(
    'МИД Армении: при безвизовом режиме — не более 180 дней в году',
    'https://www.mfa.am/en/visa/',
    2026,
    second,
  ),
  kazakhstanMigration: source(
    'Закон РК «О миграции населения», ст. 1, 35–37: разрешение работодателю и справка для самостоятельного трудоустройства',
    'https://adilet.zan.kz/rus/docs/Z1100000477',
    2026,
    second,
  ),
  kazakhstanNeoNomad: source(
    'МИД Казахстана: виза Neo Nomad (B12-1) для удалённой работы, доход от $3 000 в месяц',
    'https://www.gov.kz/memleket/entities/mfa-london/press/article/details/188964?directionId=5279&lang=en',
    2025,
    second,
  ),
  turkeyLabour: source(
    'Закон Турции № 6735 о международной рабочей силе, ст. 6–7: работа только по разрешению',
    'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6735&MevzuatTur=1&MevzuatTertip=5',
    2026,
    second,
  ),
  turkeyResidence: source(
    'Закон Турции № 6458 об иностранцах, ст. 30–31: виды вида на жительство',
    'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6458&MevzuatTur=1&MevzuatTertip=5',
    2026,
    second,
  ),
  turkeyNomadNationalities: source(
    'Генконсульство Турции в Хьюстоне: виза цифрового кочевника, список гражданств и документы (2026)',
    'https://houston-cg.mfa.gov.tr/Content/assets/consulate/images/localCache/1/ebc34ad1-dd9f-4248-9dc5-e52f24355a7c.pdf',
    2026,
    second,
  ),
  turkeyNomadDiploma: source(
    'Генконсульство Турции в Нью-Йорке: виза цифрового кочевника, диплом вуза (2026)',
    'https://newyork-cg.mfa.gov.tr/Content/assets/consulate/images/localCache/1/935ef080-0224-43f0-874a-646c248c7c8e.pdf',
    2026,
    second,
  ),
  turkeyVisaFree: source(
    'МИД Турции: граждане России без визы до 60 дней для туризма и деловых поездок',
    'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa',
    2026,
    second,
  ),
  uzbekistanEmployment: source(
    'Закон Узбекистана «О занятости населения», ст. 107 и 111: подтверждение права на трудовую деятельность',
    'https://lex.uz/ru/docs/5055696',
    2026,
    second,
  ),
  belarusLabourMigration: source(
    'Pravo.by: МВД Беларуси о Законе «О внешней трудовой миграции» — специальное разрешение нанимателю',
    'https://pravo.by/novosti/obshchestvenno-politicheskie-i-v-oblasti-prava/2023/june/74659/',
    2023,
    second,
  ),
  montenegroVisas: source(
    'Правительство Черногории: визы, безвизовый въезд граждан России до 30 дней и виза D для цифровых кочевников',
    'https://www.gov.me/en/article/visas',
    2026,
    second,
  ),
  montenegroWorkPermit: source(
    'Единая контактная точка Черногории: разрешение на временное проживание и работу',
    'https://psc.gov.me/me/sektorske-informacije/ministarstvo-unutrasnjih-poslova/privremeni-boravak-i-rad-radna-dozvola',
    2026,
    second,
  ),
} as const;
