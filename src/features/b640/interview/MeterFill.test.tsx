// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { MeterFill } from './MeterFill';

let view: Mounted | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('MeterFill: ширина шкалы без атрибута style в разметке', () => {
  it('ставит ширину свойством узла и ограничивает её 0–100', async () => {
    await act(async () => {
      view = mount(
        <>
          <MeterFill percent={42} />
          <MeterFill percent={140} />
        </>,
      );
    });
    const fills = [...document.querySelectorAll('i')];
    expect(fills.map((node) => node.style.inlineSize)).toEqual(['42%', '100%']);
  });
});
