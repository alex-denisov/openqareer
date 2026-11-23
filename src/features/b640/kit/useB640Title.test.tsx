// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from './testDom';
import { b640Title, useB640Title } from './useB640Title';

function Probe({ section }: { readonly section: string }) {
  useB640Title(section);
  return null;
}

describe('useB640Title', () => {
  it('вкладка называет раздел и меняется вместе с ним', () => {
    expect(b640Title('Аккаунт')).toBe('Аккаунт · openqareer');
    const view = mount(<Probe section="Аккаунт" />);
    expect(document.title).toBe('Аккаунт · openqareer');
    view.unmount();
    mount(<Probe section="Тарифы" />).unmount();
    expect(document.title).toBe('Тарифы · openqareer');
  });
});
