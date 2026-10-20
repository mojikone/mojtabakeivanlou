import { createHash } from 'node:crypto';

// First 8 hex digits of the SHA-1 of `buf` (a Buffer, or a string hashed as UTF-8). Used for cache-busting `?v=` values.
export function shortHash(buf) {
  return createHash('sha1').update(buf).digest('hex').slice(0, 8);
}
