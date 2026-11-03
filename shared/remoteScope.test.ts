import { describe, expect, it } from 'vitest';
import { parseRemoteScope, remoteScopeAllows, remoteScopeLabel } from './remoteScope';

describe('remote scope label', () => {
  it('names a global scope «из любой страны»', () => {
    expect(remoteScopeLabel(parseRemoteScope('global'))).toBe('Удалённо из любой страны');
  });

  it('names one country «только …» in Russian', () => {
    expect(remoteScopeLabel(parseRemoteScope('US'))).toBe('Удалённо, только США');
    expect(remoteScopeLabel(parseRemoteScope('RU'))).toBe('Удалённо, только Россия');
  });

  it('names a block of countries by its usual name', () => {
    expect(remoteScopeLabel(parseRemoteScope('EMEA'))).toBe('Удалённо, EMEA');
    expect(remoteScopeLabel(parseRemoteScope('EUROPE'))).toBe('Удалённо, Европа');
  });

  it('lists several areas and folds a long tail', () => {
    expect(remoteScopeLabel(parseRemoteScope('US,CA'))).toBe('Удалённо: США, Канада');
    expect(remoteScopeLabel(parseRemoteScope('AR,BR,CL,CO,MX'))).toBe(
      'Удалённо: Аргентина, Бразилия, Чили и ещё 2',
    );
  });

  it('has no scope label for a scope that was never computed', () => {
    expect(parseRemoteScope(undefined)).toBeUndefined();
    expect(parseRemoteScope('')).toBeUndefined();
    expect(remoteScopeLabel(undefined)).toBe('Удалённо');
  });
});

describe('remote scope admits a home region', () => {
  it('global remote admits every region', () => {
    expect(remoteScopeAllows(parseRemoteScope('global'), ['ru'])).toBe(true);
  });

  it('US-only remote does not admit Russia', () => {
    expect(remoteScopeAllows(parseRemoteScope('US'), ['ru'])).toBe(false);
    expect(remoteScopeAllows(parseRemoteScope('US,CA'), ['ru'])).toBe(false);
  });

  it('scopes that include Russia admit it', () => {
    expect(remoteScopeAllows(parseRemoteScope('RU'), ['ru'])).toBe(true);
    expect(remoteScopeAllows(parseRemoteScope('EMEA'), ['ru'])).toBe(true);
    expect(remoteScopeAllows(parseRemoteScope('CIS'), ['ru'])).toBe(true);
    expect(remoteScopeAllows(parseRemoteScope('DE,RU'), ['ru'])).toBe(true);
  });

  it('the European Union and LATAM do not admit Russia', () => {
    expect(remoteScopeAllows(parseRemoteScope('EU'), ['ru'])).toBe(false);
    expect(remoteScopeAllows(parseRemoteScope('LATAM'), ['ru'])).toBe(false);
  });

  it('maps countries to the platform regions', () => {
    expect(remoteScopeAllows(parseRemoteScope('DE'), ['eu'])).toBe(true);
    expect(remoteScopeAllows(parseRemoteScope('AE'), ['mena'])).toBe(true);
    expect(remoteScopeAllows(parseRemoteScope('KZ'), ['cis'])).toBe(true);
  });
});
