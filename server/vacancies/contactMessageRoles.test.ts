import { describe, expect, it } from 'vitest';
import { localizeRoles, roleTranslations } from './contactMessageRoles';

describe('B753: роли в сообщении знакомому и рекрутёру — по-русски, как их называет платформа', () => {
  const titlesRu = { 'Head of IT': 'Руководитель ИТ', CTO: 'Технический директор (CTO)', 'Chief Technology Officer': 'Технический директор (CTO)' };

  it('заменяет английские названия ролей русскими целиком, без повторной замены', () => {
    expect(localizeRoles('HEADLINE: Head of IT, ex-CTO', titlesRu)).toBe('HEADLINE: Руководитель ИТ, ex-Технический директор (CTO)');
    expect(localizeRoles('Chief Technology Officer в Альфа', titlesRu)).toBe('Технический директор (CTO) в Альфа');
  });

  it('не трогает части слов и регистр не важен', () => {
    expect(localizeRoles('CTOs и head of it', titlesRu)).toBe('CTOs и Руководитель ИТ');
  });

  it('целевая роль из профиля: части через «/», запятую и «или» переводятся по онтологии', () => {
    const map = roleTranslations(['CTO'], {}, 'Chief Technology Officer / COO');
    expect(map.COO).toMatch(/Операционный директор/u);
    expect(localizeRoles('Chief Technology Officer / COO', map)).not.toMatch(/Chief Technology Officer|(?<!\()COO/u);
  });
});
