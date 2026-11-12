import { expect, it } from 'vitest';
import { validateApiUrl } from './api-url';
it('allows same-computer HTTP and requires HTTPS for remote API hosts', () => {
  expect(() => validateApiUrl('http://127.0.0.1:4000')).not.toThrow();
  expect(() => validateApiUrl('https://shop.example')).not.toThrow();
  expect(() => validateApiUrl('http://shop.example')).toThrow('HTTPS');
  expect(() => validateApiUrl('http://192.168.1.5:4000')).toThrow('HTTPS');
  expect(() => validateApiUrl('https://user:pass@shop.example')).toThrow('credentials');
});
