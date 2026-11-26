import { describe, expect, it } from 'vitest';
import { isTrackerHost } from './siteRenderBlocklist';

describe('isTrackerHost (B643)', () => {
  it('домен и поддомены из списка', () => {
    expect(isTrackerHost('googletagmanager.com')).toBe(true);
    expect(isTrackerHost('www.googletagmanager.com')).toBe(true);
    expect(isTrackerHost('MC.Yandex.RU')).toBe(true);
    expect(isTrackerHost('cdn.cookielaw.org')).toBe(true);
  });

  it('похожие, но чужие имена не блокируются', () => {
    expect(isTrackerHost('notgoogletagmanager.com')).toBe(false);
    expect(isTrackerHost('yandex.ru')).toBe(false);
    expect(isTrackerHost('careers.acme.com')).toBe(false);
    expect(isTrackerHost('boards.greenhouse.io')).toBe(false);
  });
});
