import { describe, expect, it } from 'vitest';
import {
  connectionResultMessage,
  readConnectionResult,
} from './connectionResult';

describe('connection callback landing', () => {
  it('reads only the fixed result route with a known platform and status', () => {
    expect(
      readConnectionResult({
        pathname: '/connections/result',
        search: '?platform=hh&status=connected',
      }),
    ).toEqual({ platform: 'hh', status: 'connected' });

    expect(
      readConnectionResult({
        pathname: '/connections/result',
        search: '?platform=linkedin&status=failed&reason=oauth_state_invalid',
      }),
    ).toEqual({
      platform: 'linkedin',
      status: 'failed',
      reason: 'oauth_state_invalid',
    });

    expect(
      readConnectionResult({ pathname: '/', search: '?platform=hh&status=connected' }),
    ).toBeNull();
    expect(
      readConnectionResult({
        pathname: '/connections/result',
        search: '?platform=vk&status=connected',
      }),
    ).toBeNull();
    expect(
      readConnectionResult({
        pathname: '/connections/result',
        search: '?platform=hh&status=hijacked',
      }),
    ).toBeNull();
  });

  it('drops an unrecognised reason instead of showing raw callback text', () => {
    expect(
      readConnectionResult({
        pathname: '/connections/result',
        search: '?platform=hh&status=failed&reason=<script>alert(1)</script>',
      }),
    ).toEqual({ platform: 'hh', status: 'failed' });
  });

  it('explains every outcome without promising an import that did not happen', () => {
    expect(
      connectionResultMessage({ platform: 'hh', status: 'connected' }),
    ).toMatch(/hh\.ru подключён/i);
    expect(
      connectionResultMessage({ platform: 'linkedin', status: 'connected' }),
    ).toMatch(/не переносит карьерную историю/i);
    expect(
      connectionResultMessage({ platform: 'hh', status: 'declined' }),
    ).toMatch(/доступ не выдан/i);
    expect(
      connectionResultMessage({
        platform: 'hh',
        status: 'failed',
        reason: 'oauth_state_invalid',
      }),
    ).toMatch(/истекла|заново/i);
    expect(
      connectionResultMessage({ platform: 'hh', status: 'failed' }),
    ).toMatch(/не подтвердила/i);
  });
});
