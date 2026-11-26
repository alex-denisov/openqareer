import { describe, expect, it } from 'vitest';
import { createCandidate, createStore } from './sqliteTestHarness';

const NOW = new Date().toISOString();

function seedNotifications(store: ReturnType<typeof createStore>, candidateId: string, tag: string, chatId: string) {
  const repository = store.notificationRepository;
  repository.setPreference(candidateId, 'ev-reminder', { app: true, email: false, telegram: true });
  repository.setInvitationPreference(candidateId, { app: true, email: true, telegram: false });
  repository.linkTelegramChat(candidateId, chatId);
  const reply = repository.recordEvent(candidateId, {
    idempotencyKey: `reply-${tag}`,
    kind: 'employer_reply',
    sourceType: 'application',
    sourceId: `application-${tag}`,
    invitation: true,
  });
  repository.recordEvent(candidateId, {
    idempotencyKey: `import-${tag}`,
    kind: 'import_completed',
    sourceType: 'import',
    sourceId: `import-${tag}`,
  });
  return reply!.id;
}

describe('B738 · 2: выгрузка отдаёт уведомления', () => {
  it('уведомления, доставки, настройки каналов и привязку Telegram кандидата, без чужих', () => {
    const store = createStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const replyId = seedNotifications(store, own.id, 'свой', '1110001');
    seedNotifications(store, other.id, 'чужой', '9990009');
    store.notificationRepository.markRead(own.id, replyId, NOW);

    const exported = store.exportCandidate(own.id).notifications;

    expect(exported.items).toHaveLength(2);
    expect(exported.items).toContainEqual(
      expect.objectContaining({
        id: replyId,
        kind: 'employer_reply',
        sourceType: 'application',
        sourceId: 'application-свой',
        readAt: NOW,
        invitation: true,
        deliveries: expect.arrayContaining([expect.objectContaining({ channel: 'email' })]),
      }),
    );
    expect(exported.items.find((item) => item.kind === 'import_completed')?.invitation).toBe(false);
    expect(exported.preferences).toContainEqual({ key: 'ev-reminder', app: true, email: false, telegram: true });
    expect(exported.invitationPreference).toEqual({ app: true, email: true, telegram: false });
    expect(exported.telegram).toEqual({ linked: true, linkedAt: expect.any(String) });
    expect(JSON.stringify(exported)).not.toContain('1110001');
    const text = JSON.stringify(exported);
    expect(text).not.toContain('чужой');
    expect(text).not.toContain('9990009');
    expect(text).not.toContain('idempotency');
    expect(text).not.toContain('reply-свой');
  });

  it('без уведомлений и привязки выгрузка отдаёт пустое и настройки по умолчанию', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const exported = store.exportCandidate(candidate.id).notifications;
    expect(exported.items).toEqual([]);
    expect(exported.invitationPreference).toBeNull();
    expect(exported.telegram).toBeNull();
    expect(exported.preferences.length).toBeGreaterThan(0);
  });
});
