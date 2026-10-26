import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rulesParse } from './rulesParse';
import { LEVEL_RANK } from '../levelMatcher';
import type { FunctionCode } from '../../../shared/roleTaxonomy';

/**
 * B267 S1: замер CPO на реальной выборке (800 названий, EN/PT/FR/DE) держал
 * пустую функцию у 45% строк, null-уровень у 68% — золотой набор в
 * `rulesParse.test.ts` не ловил разрыв, потому что писался по тем же
 * правилам, которые проверяет. Этот файл читает фикстуру из выборки CPO и
 * проверяет только полноту ответа (функция/уровень не пустые), а отдельный
 * набор ниже — точность на вручную размеченных названиях из той же выборки.
 */
const FIXTURE_PATH = join(__dirname, '__fixtures__', 'realTitles.txt');
const REAL_TITLES = readFileSync(FIXTURE_PATH, 'utf8').split('\n').filter((line) => line.trim().length > 0);

describe('rulesParse coverage on the real title sample (B267 S1)', () => {
  it('names a function for at least 90% of real titles', () => {
    const empty = REAL_TITLES.filter((title) => rulesParse(title).functions.length === 0);
    const coverage = (REAL_TITLES.length - empty.length) / REAL_TITLES.length;
    expect(coverage, `${empty.length} titles got no function, e.g.:\n${empty.slice(0, 10).join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('names a level for at least 95% of real titles (null level ≤5%)', () => {
    const withoutLevel = REAL_TITLES.filter((title) => rulesParse(title).levelRank === null);
    const coverage = (REAL_TITLES.length - withoutLevel.length) / REAL_TITLES.length;
    expect(coverage, `${withoutLevel.length} titles got a null level`).toBeGreaterThanOrEqual(0.95);
  });

  it('names "other" for at most 10% of real titles', () => {
    const other = REAL_TITLES.filter((title) => rulesParse(title).functions.includes('other'));
    const share = other.length / REAL_TITLES.length;
    expect(share, `${other.length} titles fell back to "other"`).toBeLessThanOrEqual(0.1);
  });
});

// Вручную размеченный набор: 80 названий взяты дословно из __fixtures__/realTitles.txt
// (строки из выборки CPO), плюс 20 RU-названий уровня руководителей ИТ, которых
// в выборке нет. Ожидания — независимая ручная оценка по смыслу заголовка, а
// не то, что уже выдаёт rulesParse.
const REAL_SAMPLE: readonly [string, FunctionCode, number][] = [
  ['Account Executive', 'sales', LEVEL_RANK.ic],
  ['Senior Cybersecurity Specialist', 'security', LEVEL_RANK.ic],
  ['Compensation Program Manager', 'hr', LEVEL_RANK.ic],
  ['Analytics Engineer 5 - Cloud Games Infrastructure Data Products', 'data', LEVEL_RANK.ic],
  ['Senior Backend Software Engineer - Core Backend, Cloud Customer Experience', 'eng', LEVEL_RANK.ic],
  ['Senior Sales Manager, Regional Enterprise', 'sales', LEVEL_RANK.ic],
  ['Senior AI Engineer - AI Reinvent & Engineering', 'ai-ml', LEVEL_RANK.ic],
  ['Senior Associate Inbound Compliance Analyst (KYC)', 'audit-risk', LEVEL_RANK.ic],
  ['Product Development Engineer -- Post-Si Characterization', 'eng', LEVEL_RANK.ic],
  ['Senior Director, Product Management - Consumer & Developer Experience', 'product', LEVEL_RANK.vp],
  ['Enterprise Account Executive (Atlanta)', 'sales', LEVEL_RANK.ic],
  ['Software Development Engineer, AWS Lambda', 'eng', LEVEL_RANK.ic],
  ['IT Support Specialist', 'it-ops', LEVEL_RANK.ic],
  ['Senior Financial Analyst (Manufacturing)', 'finance', LEVEL_RANK.ic],
  ['Senior Sales Manager - Financial Services & Gaming Europe', 'sales', LEVEL_RANK.ic],
  ['Chief of Staff, CRO', 'exec-general', LEVEL_RANK['c-level']],
  ['Senior Full-Stack Engineer', 'eng', LEVEL_RANK.ic],
  ['Sr Software Engineer', 'eng', LEVEL_RANK.ic],
  ['Senior Solutions Architect, Generative AI', 'eng', LEVEL_RANK.ic],
  ['Senior Cloud Infrastructure and DevOps Solutions Architect', 'it-ops', LEVEL_RANK.ic],
  ['Senior Account Manager, Thailand, Energy', 'sales', LEVEL_RANK.ic],
  ['Manager, Ontology & Data Modeling', 'data', LEVEL_RANK.ic],
  ['Project Manager, People Mergers & Acquisitions (M&A)', 'project-mgmt', LEVEL_RANK.ic],
  ['IT Operations Support Lead (Relocation to Singapore)', 'it-ops', LEVEL_RANK.lead],
  ['Senior Software Engineer, Core Platform', 'eng', LEVEL_RANK.ic],
  ['Enterprise Architect', 'eng', LEVEL_RANK.ic],
  ['Director of Product Marketing', 'marketing', LEVEL_RANK.head],
  ['Senior Software Engineer, Storage', 'eng', LEVEL_RANK.ic],
  ['Controls Technician (Physical Infrastructure) - Memphis', 'manufacturing', LEVEL_RANK.ic],
  ['Sr. Systems Engineer, Managed Operations', 'eng', LEVEL_RANK.ic],
  ['Facilities Technician', 'manufacturing', LEVEL_RANK.ic],
  ['Battery Management Systems - Electrical Engineer', 'eng', LEVEL_RANK.ic],
  ['Sr. Director, Technical Program Management - (Remote-Eligible)', 'project-mgmt', LEVEL_RANK.vp],
  ['DevOps Engineer Tech 3', 'it-ops', LEVEL_RANK.ic],
  ['Sr. Global Supply Chain Manager, Amazon Custom Modules', 'logistics', LEVEL_RANK.ic],
  ['Embedded Software Engineer (Starlink)', 'eng', LEVEL_RANK.ic],
  ['Forward Deployed Engineer (Principal)', 'eng', LEVEL_RANK.ic],
  ['Quality Assurance Technician, Amazon Music Visual experience team', 'qa', LEVEL_RANK.ic],
  ['Regional Sales Manager', 'sales', LEVEL_RANK.ic],
  ['Senior Sales Engineer (remote, Europe)', 'sales', LEVEL_RANK.ic],
  ['Front-End Engineer II, ECR', 'eng', LEVEL_RANK.ic],
  ['Senior GoLang Developer', 'eng', LEVEL_RANK.ic],
  ['Data Science Intern (Winter 2027)', 'data', LEVEL_RANK.ic],
  ['Senior DevOps Engineer', 'it-ops', LEVEL_RANK.ic],
  ['Senior Engineer, Prime Systems & Services', 'eng', LEVEL_RANK.ic],
  ['Senior Account Executive - Montreal/Atlantic Canada', 'sales', LEVEL_RANK.ic],
  ['Frontend Developer', 'eng', LEVEL_RANK.ic],
  ['Lead Test Engineer - Scenario Coverage & Evaluation Datasets', 'qa', LEVEL_RANK.lead],
  ['Senior Security Research Engineer, SONAR (Security Operations and Novel Adversary Research)', 'security', LEVEL_RANK.ic],
  ['Senior Lead Data Engineer', 'data', LEVEL_RANK.lead],
  ['Software Engineer', 'eng', LEVEL_RANK.ic],
  ['Enterprise Account Executive-South Bay', 'sales', LEVEL_RANK.ic],
  ['Senior Front-end Developer', 'eng', LEVEL_RANK.ic],
  ['Senior HCM Consultant - Workday Success Plans', 'consulting', LEVEL_RANK.ic],
  ['Global Account Manager - Insurance', 'sales', LEVEL_RANK.ic],
  ['Senior Data Engineer (Azure)', 'data', LEVEL_RANK.ic],
  ['Developer Relations Engineer', 'eng', LEVEL_RANK.ic],
  ['Software Engineer, Robotics - Isaac Lab', 'eng', LEVEL_RANK.ic],
  ['Senior Infrastructure Engineer', 'it-ops', LEVEL_RANK.ic],
  ['Principal Site Reliability Engineer (m/f/x)', 'it-ops', LEVEL_RANK.ic],
  ['Senior SRAM Engineer', 'eng', LEVEL_RANK.ic],
  ['Director, US Regulated Products and Programs', 'other', LEVEL_RANK.head],
  ['Head of AI Engineering (f/m/x)', 'ai-ml', LEVEL_RANK.head],
  ['Executive Assistant II', 'admin', LEVEL_RANK.ic],
  ['Corporate Accountant', 'finance', LEVEL_RANK.ic],
  ['Site Reliability Engineer - Apple Services Engineering', 'it-ops', LEVEL_RANK.ic],
  ['Product Partnerships Manager, Consumer/SMB', 'bizdev', LEVEL_RANK.ic],
  ['Senior Customer Success Manager, Strategic Account Services (SAS)', 'support', LEVEL_RANK.ic],
  ['Senior Technical Program Manager (Cloud Capacity)', 'project-mgmt', LEVEL_RANK.ic],
  ['Lead Software Engineer, Full Stack', 'eng', LEVEL_RANK.lead],
  ['Engineering Manager, Web Indexing', 'eng-mgmt', LEVEL_RANK.ic],
  ['Staff Corporate Security Engineer', 'security', LEVEL_RANK.ic],
  ['Senior Software Engineer - Addressing Team', 'eng', LEVEL_RANK.ic],
  ['Business Development Representative', 'sales', LEVEL_RANK.ic],
  ['Software Development Engineer, Ads Nova', 'eng', LEVEL_RANK.ic],
  ['Data Center Site Manager, Data Center Operations', 'it-ops', LEVEL_RANK.ic],
  ['Senior Security Automation Engineer', 'security', LEVEL_RANK.ic],
  ['Staff Software Engineer', 'eng', LEVEL_RANK.ic],
  ['Account Executive, Large Enterprise', 'sales', LEVEL_RANK.ic],
  ['Accounting Manager', 'finance', LEVEL_RANK.ic],
  ['Senior DevSecOps Engineer', 'it-ops', LEVEL_RANK.ic],
  ['Director of Sales, Flow', 'sales', LEVEL_RANK.head],
  ['Director, DevOps Insights', 'it-ops', LEVEL_RANK.head],
  ['Director - Software Engineering', 'eng-mgmt', LEVEL_RANK.head],
  ['CISO', 'security', LEVEL_RANK['c-level']],
  ['Head of Marketplace', 'product', LEVEL_RANK.head],
];

// 20 RU-названий уровня руководителей ИТ (написаны для задачи, в выборке их нет).
const RU_EXEC_SAMPLE: readonly [string, FunctionCode, number][] = [
  ['Директор по ИТ (CIO)', 'it-ops', LEVEL_RANK['c-level']],
  ['Директор по цифровой трансформации', 'eng-mgmt', LEVEL_RANK.head],
  ['Руководитель отдела эксплуатации ЦОД', 'it-ops', LEVEL_RANK.head],
  ['Технический директор (CTO)', 'eng-mgmt', LEVEL_RANK['c-level']],
  ['Директор по информационной безопасности (CISO)', 'security', LEVEL_RANK['c-level']],
  ['Руководитель службы информационной безопасности', 'security', LEVEL_RANK.head],
  ['Вице-президент по технологиям', 'eng-mgmt', LEVEL_RANK.vp],
  ['Старший директор по разработке', 'eng-mgmt', LEVEL_RANK.vp],
  ['Директор департамента ИТ-инфраструктуры', 'it-ops', LEVEL_RANK.head],
  ['Руководитель направления DevOps', 'it-ops', LEVEL_RANK.head],
  ['Генеральный директор', 'exec-general', LEVEL_RANK['c-level']],
  ['Финансовый директор (CFO)', 'finance', LEVEL_RANK['c-level']],
  ['Директор по продукту (CPO)', 'product', LEVEL_RANK['c-level']],
  ['Директор по маркетингу (CMO)', 'marketing', LEVEL_RANK['c-level']],
  ['Операционный директор (COO)', 'ops', LEVEL_RANK['c-level']],
  ['Руководитель отдела разработки', 'eng-mgmt', LEVEL_RANK.head],
  ['ИТ-директор регионального филиала', 'it-ops', LEVEL_RANK.head],
  ['Технический директор по продукту', 'eng-mgmt', LEVEL_RANK['c-level']],
  ['Директор по аудиту и рискам', 'audit-risk', LEVEL_RANK.head],
  ['Руководитель ИТ-инфраструктуры', 'it-ops', LEVEL_RANK.head],
];

// C08: отдельная ручная разметка названий без пробелов между смысловыми
// частями. Ожидания заданы по смыслу роли, независимо от словаря парсера.
const CJK_SAMPLE: readonly [string, FunctionCode, number][] = [
  ['インフラエンジニア', 'it-ops', LEVEL_RANK.ic],
  ['ネットワークエンジニア', 'it-ops', LEVEL_RANK.ic],
  ['ITコンサルタント', 'consulting', LEVEL_RANK.ic],
  ['DevOpsエンジニア', 'it-ops', LEVEL_RANK.ic],
  ['クリエイティブディレクター', 'design', LEVEL_RANK.head],
  ['経理リーダー', 'finance', LEVEL_RANK.lead],
  ['営業部長', 'sales', LEVEL_RANK.head],
  ['マーケティングマネージャー', 'marketing', LEVEL_RANK.head],
  ['人事責任者', 'hr', LEVEL_RANK.head],
  ['プロダクトマネージャー', 'product', LEVEL_RANK.head],
  ['UXデザイナー', 'design', LEVEL_RANK.ic],
  ['ソフトウェア開発エンジニア', 'eng', LEVEL_RANK.ic],
  ['セキュリティエンジニア', 'security', LEVEL_RANK.ic],
  ['QAエンジニア', 'qa', LEVEL_RANK.ic],
  ['カスタマーサポート責任者', 'support', LEVEL_RANK.head],
  ['プロジェクトマネージャー', 'project-mgmt', LEVEL_RANK.head],
  ['建築施工管理技士', 'construction', LEVEL_RANK.ic],
  ['建築施工管理部長', 'construction', LEVEL_RANK.head],
  ['データエンジニア', 'data', LEVEL_RANK.ic],
  ['AIエンジニア', 'ai-ml', LEVEL_RANK.ic],
  ['法務責任者', 'legal', LEVEL_RANK.head],
  ['購買マネージャー', 'procurement', LEVEL_RANK.head],
  ['物流リーダー', 'logistics', LEVEL_RANK.lead],
  ['製造部長', 'manufacturing', LEVEL_RANK.head],
  ['システム開発PM', 'project-mgmt', LEVEL_RANK.ic],
  ['Web開発PL', 'project-mgmt', LEVEL_RANK.ic],
  ['IT运维项目现场主管', 'it-ops', LEVEL_RANK.head],
  ['网络工程师', 'it-ops', LEVEL_RANK.ic],
  ['DevOps工程师', 'it-ops', LEVEL_RANK.ic],
  ['软件开发工程师', 'eng', LEVEL_RANK.ic],
  ['后端开发工程师', 'eng', LEVEL_RANK.ic],
  ['数据工程师', 'data', LEVEL_RANK.ic],
  ['人工智能工程师', 'ai-ml', LEVEL_RANK.ic],
  ['信息安全工程师', 'security', LEVEL_RANK.ic],
  ['测试工程师', 'qa', LEVEL_RANK.ic],
  ['产品经理', 'product', LEVEL_RANK.head],
  ['视觉设计师', 'design', LEVEL_RANK.ic],
  ['销售经理', 'sales', LEVEL_RANK.head],
  ['市场营销总监', 'marketing', LEVEL_RANK.head],
  ['财务经理', 'finance', LEVEL_RANK.head],
  ['会计主管', 'finance', LEVEL_RANK.head],
  ['人事经理', 'hr', LEVEL_RANK.head],
  ['客户支持主管', 'support', LEVEL_RANK.head],
  ['项目经理', 'project-mgmt', LEVEL_RANK.head],
  ['管理咨询顾问', 'consulting', LEVEL_RANK.ic],
  ['采购经理', 'procurement', LEVEL_RANK.head],
  ['物流主管', 'logistics', LEVEL_RANK.head],
  ['生产总监', 'manufacturing', LEVEL_RANK.head],
  ['建筑施工经理', 'construction', LEVEL_RANK.head],
  ['业务发展总监', 'bizdev', LEVEL_RANK.head],
];

describe('rulesParse precision on the manually labeled sample (B267 S1)', () => {
  const LABELED = [...REAL_SAMPLE, ...RU_EXEC_SAMPLE];

  it(`names the correct function for at least 85% of ${LABELED.length} labeled titles`, () => {
    const misses: string[] = [];
    for (const [title, expected] of LABELED) {
      const { functions } = rulesParse(title);
      if (!functions.includes(expected)) misses.push(`${title} -> ${functions.join(',')} (expected ${expected})`);
    }
    const accuracy = (LABELED.length - misses.length) / LABELED.length;
    expect(accuracy, `function misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });

  it(`names the correct level for at least 85% of ${LABELED.length} labeled titles`, () => {
    const misses: string[] = [];
    for (const [title, , expectedLevel] of LABELED) {
      const { levelRank } = rulesParse(title);
      if (levelRank !== expectedLevel) misses.push(`${title} -> ${levelRank} (expected ${expectedLevel})`);
    }
    const accuracy = (LABELED.length - misses.length) / LABELED.length;
    expect(accuracy, `level misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });
});

describe('rulesParse precision on manually labeled JA/ZH titles (B267 C08)', () => {
  it(`names the correct function for at least 85% of ${CJK_SAMPLE.length} titles`, () => {
    const misses = CJK_SAMPLE.flatMap(([title, expected]) => {
      const { functions } = rulesParse(title);
      return functions.includes(expected) ? [] : [`${title} -> ${functions.join(',')} (expected ${expected})`];
    });
    const accuracy = (CJK_SAMPLE.length - misses.length) / CJK_SAMPLE.length;
    expect(accuracy, `function misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });

  it(`names the correct level for at least 85% of ${CJK_SAMPLE.length} titles`, () => {
    const misses = CJK_SAMPLE.flatMap(([title, , expected]) => {
      const { levelRank } = rulesParse(title);
      return levelRank === expected ? [] : [`${title} -> ${levelRank} (expected ${expected})`];
    });
    const accuracy = (CJK_SAMPLE.length - misses.length) / CJK_SAMPLE.length;
    expect(accuracy, `level misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });
});
