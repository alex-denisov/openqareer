import { expect, type Page } from '@playwright/test';

/**
 * B720: при полной прокрутке последний ссылочный или кнопочный элемент
 * содержимого не лежит под закреплённой панелью действия — точка в его центре
 * попадает в него самого. Так проверяет и приёмка (elementFromPoint).
 */
export async function expectLastActionReachable(page: Page): Promise<void> {
  const probe = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const main = document.querySelector('#career-main');
    if (!main) return { ok: false, why: 'нет #career-main' };
    const isPinned = (el: Element): boolean => {
      for (let node: Element | null = el; node && node !== main; node = node.parentElement) {
        if (getComputedStyle(node).position === 'fixed') return true;
      }
      return false;
    };
    const actions = [...main.querySelectorAll('a[href], button')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && !isPinned(el);
    });
    const last = actions
      .sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom)
      .at(-1);
    if (!last) return { ok: true, why: 'нет действий' };
    const box = last.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      ok: Boolean(hit && (hit === last || last.contains(hit))),
      why: `${last.textContent?.trim().slice(0, 40)} ${Math.round(box.top)}–${Math.round(box.bottom)} → ${hit?.className || hit?.tagName}`,
    };
  });
  expect(probe.ok, probe.why).toBe(true);
}
