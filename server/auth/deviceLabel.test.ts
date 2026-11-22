import { describe, expect, it } from 'vitest';
import { deviceLabelOf } from './deviceLabel';

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const MAC_APP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WIN_EDGE = `${WIN_CHROME} Edg/131.0.0.0`;
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0';
const IPAD_CHROME =
  'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const LINUX_YANDEX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/24.12.0.0 Safari/537.36';

describe('B754: название устройства из user agent', () => {
  it('приложение, iPhone и обычные браузеры — как в макете n04', () => {
    expect(deviceLabelOf(MAC_APP, 'tauri://localhost')).toBe('MacBook · приложение openqareer');
    expect(deviceLabelOf(MAC_APP, 'http://tauri.localhost')).toBe(
      'MacBook · приложение openqareer',
    );
    expect(deviceLabelOf(IPHONE, undefined)).toBe('iPhone · Safari');
    expect(deviceLabelOf(MAC_SAFARI, 'https://openqareer.com')).toBe('MacBook · Safari');
    expect(deviceLabelOf(WIN_CHROME, undefined)).toBe('Windows · Chrome');
    expect(deviceLabelOf(WIN_EDGE, undefined)).toBe('Windows · Edge');
    expect(deviceLabelOf(ANDROID_FIREFOX, undefined)).toBe('Android · Firefox');
    expect(deviceLabelOf(IPAD_CHROME, undefined)).toBe('iPad · Chrome');
    expect(deviceLabelOf(LINUX_YANDEX, undefined)).toBe('Linux · Яндекс Браузер');
  });

  it('не распознано — названия нет, а не выдуманное', () => {
    expect(deviceLabelOf(undefined, undefined)).toBeNull();
    expect(deviceLabelOf('', undefined)).toBeNull();
    expect(deviceLabelOf('curl/8.7.1', undefined)).toBeNull();
    expect(deviceLabelOf('x'.repeat(5000), undefined)).toBeNull();
  });

  it('только платформа без браузера — одна платформа', () => {
    expect(deviceLabelOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', undefined)).toBe('Windows');
  });
});
