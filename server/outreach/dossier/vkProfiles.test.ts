import { describe, expect, it } from 'vitest';
import { fetchVkProfile, parseVkProfile } from './vkProfiles';

// Форма страницы vk.com/<ник> без входа (замер с прода 27.10): кэш предзагрузки users.get.
const page = (nick: string) =>
  `<script>window.cur = Object.assign(window.cur || {}, {"apiPrefetchCache":[` +
  `{"method":"utils.resolveScreenName","request":{"screen_name":"${nick}"},"response":{"object_id":7,"type":"user"}},` +
  `{"method":"users.get","request":{"user_ids":7},"response":[{"id":7,"first_name":"Анна","last_name":"Смирнова",` +
  `"about":"Подбор IT-специалистов","city":{"id":1,"title":"Москва"},"career":[{"company":"Ромашка","position":"HR"}],` +
  `"status":"&#36947;","screen_name":"${nick}","photo_200":"https:\\/\\/sun9-1.userapi.com\\/a.jpg?size=200x200"}]}]});</script>`;

describe('vk profile without login', () => {
  it('reads name, city, employers and photo of the page owner', () => {
    const profile = parseVkProfile(page('annasmirnova'), 'annasmirnova');
    expect(profile).toEqual({
      nick: 'annasmirnova',
      fullName: 'Анна Смирнова',
      text: 'Анна Смирнова\nПодбор IT-специалистов\n道\nМосква\nв Ромашка',
      photoUrl: 'https://sun9-1.userapi.com/a.jpg?size=200x200',
    });
  });

  it('ignores a page that is not this nick or has no profile data', () => {
    expect(parseVkProfile(page('other_nick'), 'annasmirnova')).toBeNull();
    expect(parseVkProfile('<title>VK</title>', 'annasmirnova')).toBeNull();
  });

  it('reads the page in its charset and reports a refusal by rate', async () => {
    const body = new Uint8Array(
      Buffer.from(
        page('annasmirnova')
          .replace('Анна Смирнова', 'x')
          .replace('"Анна"', '"Anna"')
          .replace('"Смирнова"', '"Smirnova"'),
        'latin1',
      ),
    );
    const ok = await fetchVkProfile('annasmirnova', {
      fetch: (async () =>
        new Response(body, {
          headers: { 'content-type': 'text/html; charset=windows-1251' },
        })) as unknown as typeof fetch,
    });
    expect(ok.profile?.fullName).toBe('Anna Smirnova');
    const refused = await fetchVkProfile('annasmirnova', {
      fetch: (async () => new Response('', { status: 429 })) as unknown as typeof fetch,
    });
    expect(refused).toEqual({ profile: null, refused: true });
    expect((await fetchVkProfile('bad nick', {})).profile).toBeNull();
  });
});
