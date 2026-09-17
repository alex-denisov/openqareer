import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canSendInvite,
  DEFAULT_DAILY_OUTREACH_LIMIT,
  getOutreachJitterMs,
  getOutreachQuota,
  recordSentInvite,
  resetOutreachQuota,
  searchDecisionMakers,
  sendDesktopConnectionRequest,
  type DecisionMakerProfile,
} from './desktopOutreachService';
import * as desktopBridge from './desktopBridge';

describe('desktopOutreachService', () => {
  beforeEach(() => {
    resetOutreachQuota('2026-09-17');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetOutreachQuota();
  });

  describe('OutreachDailyQuota', () => {
    it('initializes with a safe default limit of 15 invites per day', () => {
      const quota = getOutreachQuota('2026-09-17');
      expect(quota.dailyLimit).toBe(DEFAULT_DAILY_OUTREACH_LIMIT);
      expect(quota.dailyLimit).toBe(15);
      expect(quota.usedToday).toBe(0);
      expect(quota.remaining).toBe(15);
      expect(quota.allowed).toBe(true);
      expect(quota.resetsAt).toContain('2026-09-18');
    });

    it('decrements remaining invites when an invite is recorded', () => {
      const updated = recordSentInvite('2026-09-17');
      expect(updated.usedToday).toBe(1);
      expect(updated.remaining).toBe(14);
      expect(updated.allowed).toBe(true);

      const check = canSendInvite('2026-09-17');
      expect(check.allowed).toBe(true);
      expect(check.remaining).toBe(14);
    });

    it('blocks invites when the daily limit of 15 is reached', () => {
      for (let i = 0; i < 15; i += 1) {
        recordSentInvite('2026-09-17');
      }

      const quota = getOutreachQuota('2026-09-17');
      expect(quota.usedToday).toBe(15);
      expect(quota.remaining).toBe(0);
      expect(quota.allowed).toBe(false);

      const check = canSendInvite('2026-09-17');
      expect(check.allowed).toBe(false);
      expect(check.remaining).toBe(0);
    });

    it('automatically resets quota on the next calendar day', () => {
      for (let i = 0; i < 15; i += 1) {
        recordSentInvite('2026-09-17');
      }
      expect(canSendInvite('2026-09-17').allowed).toBe(false);

      // Next day
      const nextDayCheck = canSendInvite('2026-09-18');
      expect(nextDayCheck.allowed).toBe(true);
      expect(nextDayCheck.remaining).toBe(15);
      expect(nextDayCheck.usedToday).toBe(0);
    });
  });

  describe('Human-like jitter', () => {
    it('generates random delays within safe human bounds', () => {
      for (let i = 0; i < 20; i += 1) {
        const jitter = getOutreachJitterMs(1200, 2800);
        expect(jitter).toBeGreaterThanOrEqual(1200);
        expect(jitter).toBeLessThanOrEqual(2800);
      }
    });
  });

  describe('sendDesktopConnectionRequest & ADR-009 Zero-Cookie-Leak Contract', () => {
    const mockProfile: DecisionMakerProfile = {
      id: 'dm-101',
      fullName: 'Elena Rostova',
      headline: 'Head of Engineering at FinTech Corp',
      company: 'FinTech Corp',
      connectionDegree: '2nd',
      mutualConnectionsCount: 4,
      profileUrl: 'https://www.linkedin.com/in/elena-rostova-synth',
      roleCategory: 'engineering_lead',
    };

    it('reports desktop_required when executed outside Tauri desktop runtime', async () => {
      vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(false);

      const result = await sendDesktopConnectionRequest({
        profile: mockProfile,
        note: 'Здравствуйте, Елена! Заинтересовала позиция Lead Engineer.',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('desktop_required');
      expect(result.errorReason).toContain('десктоп');
    });

    it('executes local action in desktop runtime without sending cookies', async () => {
      vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(true);
      const executeSpy = vi.spyOn(desktopBridge, 'executeLocalAction').mockResolvedValue({
        action_id: 'outreach-act-1',
        capability: 'outreach.send_connection_request',
        platform: 'linkedin',
        status: 'completed',
        provider_reference: 'req-98765',
        executed_at: '2026-09-17T12:00:00Z',
        pacing_duration_ms: 1850,
        environment_descriptor: 'tauri_isolated_webview',
      });

      const result = await sendDesktopConnectionRequest({
        profile: mockProfile,
        note: 'Короткий питч до 300 символов',
        candidateId: 'cand-001',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('sent');
      expect(executeSpy).toHaveBeenCalledTimes(1);

      const actionArg = executeSpy.mock.calls[0][0];
      expect(actionArg.capability).toBe('outreach.send_connection_request');
      expect(actionArg.platform).toBe('linkedin');
      expect(actionArg.payload).toEqual({
        targetProfileUrl: mockProfile.profileUrl,
        targetFullName: mockProfile.fullName,
        connectionNote: 'Короткий питч до 300 символов',
      });

      // Strict ADR-009 check: no cookies, tokens or authorization headers in payload
      const payloadKeys = Object.keys(actionArg.payload);
      expect(payloadKeys).not.toContain('cookie');
      expect(payloadKeys).not.toContain('cookies');
      expect(payloadKeys).not.toContain('token');
      expect(payloadKeys).not.toContain('auth');
      expect(payloadKeys).not.toContain('authorization');
      expect(payloadKeys).not.toContain('session');
    });

    it('prevents sending and records no quota when daily limit is exhausted', async () => {
      vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(true);
      const executeSpy = vi.spyOn(desktopBridge, 'executeLocalAction');

      for (let i = 0; i < 15; i += 1) {
        recordSentInvite('2026-09-17');
      }

      const result = await sendDesktopConnectionRequest({
        profile: mockProfile,
        note: 'Тестовый запрос',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('limit_exceeded');
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('strictly satisfies ADR-009 zero-cookie-leak contract in source code', () => {
      const serviceSource = readFileSync(
        new URL('./desktopOutreachService.ts', import.meta.url),
        'utf8',
      );

      // Verify no credential transmission patterns
      expect(serviceSource).not.toContain('document.cookie');
      expect(serviceSource).not.toContain('credentials: "include"');
      expect(serviceSource).not.toContain("credentials: 'include'");
      expect(serviceSource).not.toContain('/api/v1/auth/session-transfer');
    });
  });

  describe('searchDecisionMakers', () => {
    it('returns structured profiles filtered by company and role category', async () => {
      const results = await searchDecisionMakers({
        company: 'FinTech Corp',
        roleCategory: 'engineering_lead',
      });

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      for (const profile of results) {
        expect(profile.company.toLowerCase()).toContain('fintech');
        expect(profile.roleCategory).toBe('engineering_lead');
        expect(['1st', '2nd', '3rd+']).toContain(profile.connectionDegree);
      }
    });

    it('returns all roles when no roleCategory filter is provided', async () => {
      const results = await searchDecisionMakers({ company: 'FinTech Corp' });
      expect(results.length).toBeGreaterThan(0);
      const categories = new Set(results.map((r) => r.roleCategory));
      expect(categories.size).toBeGreaterThan(1);
    });
  });
});
