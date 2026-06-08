import { describe, expect, it } from 'bun:test';
import { syncWarningsFromError } from './syncErrors.js';

describe('syncWarningsFromError', () => {
  it('maps HTTP 403 to disabled registration warning', () => {
    expect(syncWarningsFromError(new Error('register failed with status 403'))).toEqual([
      'Core-hosted local registration is disabled on Core',
    ]);
  });

  it('maps network failures to Core unavailable', () => {
    expect(syncWarningsFromError(new Error('fetch failed'))).toEqual(['Core unavailable']);
  });
});
