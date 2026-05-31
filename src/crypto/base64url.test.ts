import { describe, expect, test } from 'bun:test';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';

describe('base64url', () => {
  test('round-trips bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
  });
});
