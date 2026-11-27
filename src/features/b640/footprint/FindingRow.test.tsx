// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { FindingRow } from './FindingRow';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

type Item = Parameters<typeof FindingRow>[0]['item'];

const useful = (action: { kind: string; label: string }): Item =>
  ({
    id: 'r1',
    findingId: 'f1',
    title: 'Профиль на GitHub',
    detail: '14 проектов, последний — 2024',
    level: 'positive',
    levelLabel: 'полезно',
    resolved: false,
    url: 'https://github.com/x',
    action,
  }) as unknown as Item;

function labels(item: Item): string[] {
  view = mount(
    <ul>
      <FindingRow item={item} showLevel profileOnly onChanged={() => undefined} />
    </ul>,
  );
  return [...view.container.querySelectorAll('.fp-acts a, .fp-acts button')].map(
    (node) => node.textContent ?? '',
  );
}

describe('F4 «Полезное»: у находки только «В профиль», как в макете', () => {
  it('находка для профиля — одна кнопка «В профиль»', () => {
    expect(labels(useful({ kind: 'add_to_profile', label: 'В профиль' }))).toEqual(['В профиль']);
  });

  it('страница по нику — без «Это не моё» и «Проверить», только «В профиль»', () => {
    expect(labels(useful({ kind: 'confirm_owner', label: 'Проверить' }))).toEqual(['В профиль']);
    view?.unmount();
    expect(labels(useful({ kind: 'not_mine', label: 'Это не моё' }))).toEqual(['В профиль']);
  });
});
