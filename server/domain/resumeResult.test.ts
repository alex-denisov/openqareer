import { expect, it } from 'vitest';
import { resultStrength } from './resumeResult';

it.each([
  ['Grew annual revenue from 230 to 920 million rubles (+300%).', 3],
  ['Improved SLA compliance from 50% to 92%.', 3],
  ['Sold the company to a strategic investor for $100M.', 3],
  ['Вырос доход с 230 до 920 млн ₽', 3],
  ['Built 35 aquafarms', 1],
  ['Managed 9 direct reports, including 2 department heads', 1],
  ['Rebuilt ITIL 4 processes for L1/L2 in 2023, 24/7', 0],
  ['Expanded the team from 4 to 11 people', 2],
  ['Led support for thousands of B2B customers', 0],
  ['A 37,000 m² campus', 1],
  ['Вела команду с 2019 до 2023', 0],
  ['Certified to ISO 27001 and ISO/IEC 20000-1', 0],
  ['Внедрила ГОСТ 34 и 152-ФЗ', 0],
  ['Migrated the company to Office 365 and Windows 11', 0],
  ['Вела проект 01.2023 - 05.2024', 0],
  ['Led the platform from 01.2023 to 05.2024', 0],
  ['Обеспечила рост в 3 раза', 3],
  ['Cut resolution time, 8 hours to 30 minutes', 2],
  ['Сократила срок с 8 часов до 30 минут', 2],
  ['Rebuilt leadership', 0],
] as const)('%s — %i', (text, strength) => expect(resultStrength(text)).toBe(strength));
