import { describe, expect, it } from 'bun:test';
import { buildReceipt } from './index.js';

describe('delivery', () => {
  it('buildReceipt returns envelope_id payload', () => {
    expect(buildReceipt('01HX')).toEqual({ envelope_id: '01HX' });
  });
});
