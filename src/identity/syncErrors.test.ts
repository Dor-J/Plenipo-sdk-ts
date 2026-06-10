import { describe, expect, it } from 'bun:test';
import { syncWarningsFromError } from './syncErrors.js';

describe('syncWarningsFromError', () => {
  it('maps HTTP 403 to disabled registration warning', () => {
    expect(syncWarningsFromError(new Error('register failed with status 403'))).toEqual([
      'Core-hosted local registration is disabled on Core',
    ]);
  });

  it('maps HTTP 409 to rotation proof warning', () => {
    expect(syncWarningsFromError(new Error('register failed with status 409'))).toEqual([
      'Core rejected auth key rotation; previous and new key proofs are required',
    ]);
  });

  it('maps HTTP 400 and 500 families', () => {
    expect(syncWarningsFromError(new Error('register failed with status 400'))).toEqual([
      'Core registration rejected (register failed with status 400)',
    ]);
    expect(syncWarningsFromError(new Error('register failed with status 500'))).toEqual([
      'Core registration failed (register failed with status 500)',
    ]);
  });

  it('maps network failures to Core unavailable', () => {
    expect(syncWarningsFromError(new Error('fetch failed'))).toEqual(['Core unavailable']);
  });

  it('maps unknown failures to generic warning', () => {
    expect(syncWarningsFromError('boom')).toEqual(['Core registration failed']);
  });
});
