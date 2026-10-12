import { createHmac } from 'node:crypto';

export function createNotificationUnsubscribeToken(candidateId: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update('openqareer:notification-unsubscribe:v1\0', 'utf8')
    .update(candidateId, 'utf8')
    .digest('base64url');
}
