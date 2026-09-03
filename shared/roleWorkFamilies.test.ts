import { describe, expect, it } from 'vitest';
import { roleWorkFamily } from './roleWorkFamilies';

describe('roleWorkFamily', () => {
  it('узнаёт вид работы по английскому названию роли', () => {
    expect(roleWorkFamily('Senior Backend Developer')).toBe('СП');
    expect(roleWorkFamily('Data Analyst')).toBe('РР');
    expect(roleWorkFamily('Operations Manager')).toBe('ПП');
    expect(roleWorkFamily('Head of Sales')).toBe('ЛД');
    expect(roleWorkFamily('Product Manager')).toBe('НН');
  });

  it('узнаёт вид работы по русскому названию через таблицу синонимов', () => {
    expect(roleWorkFamily('Фронтенд-разработчик')).toBe('СП');
    expect(roleWorkFamily('Системный аналитик')).toBe('РР');
    expect(roleWorkFamily('Сварщик')).toBe('РМ');
    expect(roleWorkFamily('Преподаватель математики')).toBe('ЗО');
  });

  it('незнакомую роль не приписывает наугад', () => {
    // Догадка дороже незнания: неверный вид работы двигал бы роль в порядке.
    expect(roleWorkFamily('Хранитель фондов музея')).toBeNull();
    expect(roleWorkFamily('')).toBeNull();
  });
});
