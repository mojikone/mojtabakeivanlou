import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import {
  toB64, fromB64, randomBytes, randomId, generateDownloadCode, codeStrength,
  deriveKek, generateKey, exportKey, importKey, seal, open, encryptFile, decryptFile, formatSize,
} from '../assets/js/vault.mjs';

const ITER = 1000; // production uses 600000; tests stay fast
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const FAKE_SALT = toB64(new Uint8Array(16).map((_, i) => i + 1)); // obviously fake, fixed

// -- base64 ---------------------------------------------------------------

test('toB64/fromB64 roundtrip every byte value, including 0x00 and 0xFF', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(fromB64(toB64(all)), all);
  assert.deepEqual(fromB64(toB64(new Uint8Array([0, 255, 0, 255]))), new Uint8Array([0, 255, 0, 255]));
});

test('toB64/fromB64 handle empty input and every padding length', () => {
  assert.equal(toB64(new Uint8Array(0)), '');
  assert.deepEqual(fromB64(''), new Uint8Array(0));
  for (const n of [1, 2, 3, 4, 5, 16, 17, 31]) {
    const b = randomBytes(n);
    assert.deepEqual(fromB64(toB64(b)), b, `length ${n}`);
  }
});

test('toB64 matches standard base64 (known vectors)', () => {
  assert.equal(toB64(enc('Man')), 'TWFu');
  assert.equal(toB64(enc('Ma')), 'TWE=');
  assert.equal(toB64(enc('M')), 'TQ==');
  assert.equal(dec(fromB64('TWFu')), 'Man');
});

test('toB64/fromB64 handle multi-megabyte input (no argument-count overflow)', () => {
  const big = new Uint8Array(3 * 1024 * 1024 + 1).fill(0xab);
  const back = fromB64(toB64(big));
  assert.equal(back.length, big.length);
  assert.equal(back[0], 0xab);
  assert.equal(back[back.length - 1], 0xab);
});

test('fromB64 rejects characters outside the base64 alphabet', () => {
  assert.throws(() => fromB64('!!!!'));
});

// -- randomness -----------------------------------------------------------

test('randomBytes returns a Uint8Array of the requested length, also above the 64 KiB WebCrypto limit', () => {
  assert.ok(randomBytes(16) instanceof Uint8Array);
  assert.equal(randomBytes(0).length, 0);
  assert.equal(randomBytes(16).length, 16);
  assert.equal(randomBytes(70000).length, 70000);
  assert.notDeepEqual(randomBytes(16), randomBytes(16));
});

test('randomBytes rejects a negative, fractional or non-numeric length', () => {
  assert.throws(() => randomBytes(-1));
  assert.throws(() => randomBytes(1.5));
  assert.throws(() => randomBytes('8'));
});

test('randomId is 32 lowercase hex chars and does not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const id = randomId();
    assert.match(id, /^[0-9a-f]{32}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 100);
});

test('generateDownloadCode matches MK-XXXX-XXXX from the unambiguous alphabet (50 draws)', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateDownloadCode(), /^MK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }
});

test('generateDownloadCode can emit every one of the 32 symbols and nothing else', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    for (const ch of generateDownloadCode().slice(3).replace('-', '')) seen.add(ch);
  }
  assert.equal([...seen].sort().join(''), [...'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'].sort().join(''));
  assert.equal(seen.size, 32);
});

// -- code strength (admin rule) -------------------------------------------

test('codeStrength accepts the brief example: 12 chars, 4 classes', () => {
  assert.deepEqual(codeStrength('127377k1K1@@'), { ok: true, length: 12, classes: 4 });
});

test('codeStrength rejects a short, two-class code', () => {
  assert.deepEqual(codeStrength('password1'), { ok: false, length: 9, classes: 2 });
});

test('codeStrength needs both length >= 12 and classes >= 3', () => {
  assert.equal(codeStrength('Abcdefgh1234').ok, true);        // 12, upper+lower+digit
  assert.equal(codeStrength('abcdefghijkl').ok, false);       // 12 but one class
  assert.equal(codeStrength('abcdefgh1234').ok, false);       // 12 but two classes
  assert.equal(codeStrength('abcdefghij1!').ok, true);        // lower+digit+other
  assert.equal(codeStrength('Abcdefg1!!!').ok, false);        // 4 classes but 11 chars
  assert.equal(codeStrength('Abcdefg1!!!!').ok, true);        // exactly 12
});

test('codeStrength counts each class once and treats anything else as "other"', () => {
  assert.equal(codeStrength('aaaaaaaaaaaa').classes, 1);
  assert.equal(codeStrength('AAAAAAAAAAAA').classes, 1);
  assert.equal(codeStrength('111111111111').classes, 1);
  assert.equal(codeStrength('            ').classes, 1);
  assert.equal(codeStrength('aA').classes, 2);
  assert.equal(codeStrength('a1 ').classes, 3);
  assert.equal(codeStrength('aA1!').classes, 4);
  assert.equal(codeStrength('é').classes, 1);
});

test('codeStrength on an empty or non-string value is not ok', () => {
  assert.deepEqual(codeStrength(''), { ok: false, length: 0, classes: 0 });
  assert.equal(codeStrength(undefined).ok, false);
  assert.equal(codeStrength(null).ok, false);
});

// -- keys -----------------------------------------------------------------

test('generateKey makes an extractable AES-GCM 256 key; exportKey/importKey roundtrip', async () => {
  const k = await generateKey();
  assert.equal(k.algorithm.name, 'AES-GCM');
  assert.equal(k.algorithm.length, 256);
  assert.equal(k.extractable, true);
  assert.deepEqual([...k.usages].sort(), ['decrypt', 'encrypt']);

  const b64 = await exportKey(k);
  assert.equal(fromB64(b64).length, 32);
  const k2 = await importKey(b64);
  assert.equal(k2.extractable, true);
  assert.deepEqual([...k2.usages].sort(), ['decrypt', 'encrypt']);
  assert.equal(await exportKey(k2), b64);

  const sealed = await seal(k, enc('hello'));
  assert.equal(dec(await open(k2, sealed)), 'hello');
});

test('two generated keys differ', async () => {
  assert.notEqual(await exportKey(await generateKey()), await exportKey(await generateKey()));
});

test('importKey rejects anything that is not 32 bytes', async () => {
  await assert.rejects(importKey(toB64(new Uint8Array(16))));
  await assert.rejects(importKey(toB64(new Uint8Array(33))));
  await assert.rejects(importKey(''));
});

test('importKey rejects (never throws synchronously) on malformed base64 or a non-string', async () => {
  let p1, p2;
  assert.doesNotThrow(() => { p1 = importKey('!!!!'); });
  assert.doesNotThrow(() => { p2 = importKey(undefined); });
  await assert.rejects(p1);
  await assert.rejects(p2);
});

// -- seal / open ----------------------------------------------------------

test('seal/open roundtrip, with a 12-byte IV and a fresh IV every time', async () => {
  const k = await generateKey();
  const plain = enc('{"vk":"fake"}');
  const a = await seal(k, plain);
  const b = await seal(k, plain);
  assert.deepEqual(Object.keys(a).sort(), ['data', 'iv']);
  assert.equal(fromB64(a.iv).length, 12);
  assert.equal(fromB64(a.data).length, plain.length + 16);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  const out = await open(k, a);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual(out, plain);
});

test('seal/open roundtrip an empty payload', async () => {
  const k = await generateKey();
  const out = await open(k, await seal(k, new Uint8Array(0)));
  assert.equal(out.length, 0);
});

test('open with a different key rejects', async () => {
  const k1 = await generateKey();
  const k2 = await generateKey();
  const sealed = await seal(k1, enc('secret'));
  await assert.rejects(open(k2, sealed));
});

test('open rejects a tampered ciphertext (one flipped byte), a flipped tag byte, and a tampered IV', async () => {
  const k = await generateKey();
  const sealed = await seal(k, enc('secret payload'));

  const data = fromB64(sealed.data);
  data[3] ^= 0x01;
  await assert.rejects(open(k, { iv: sealed.iv, data: toB64(data) }));

  const tag = fromB64(sealed.data);
  tag[tag.length - 1] ^= 0x80;
  await assert.rejects(open(k, { iv: sealed.iv, data: toB64(tag) }));

  const iv = fromB64(sealed.iv);
  iv[0] ^= 0x01;
  await assert.rejects(open(k, { iv: toB64(iv), data: sealed.data }));

  // the untouched blob still opens
  assert.equal(dec(await open(k, sealed)), 'secret payload');
});

test('open rejects a truncated ciphertext and a wrong-length IV', async () => {
  const k = await generateKey();
  const sealed = await seal(k, enc('secret payload'));
  await assert.rejects(open(k, { iv: sealed.iv, data: toB64(fromB64(sealed.data).subarray(0, 8)) }));
  await assert.rejects(open(k, { iv: toB64(new Uint8Array(8)), data: sealed.data }));
  await assert.rejects(open(k, { iv: '', data: '' }));
});

test('open rejects with "decrypt failed" when the sealed object is missing or empty', async () => {
  const k = await generateKey();
  await assert.rejects(open(k, undefined), { message: 'decrypt failed' });
  await assert.rejects(open(k, null), { message: 'decrypt failed' });
  await assert.rejects(open(k, {}), { message: 'decrypt failed' });
});

test('a failed open rejects with an Error that does not leak the plaintext', async () => {
  const k1 = await generateKey();
  const k2 = await generateKey();
  const sealed = await seal(k1, enc('secret'));
  await assert.rejects(open(k2, sealed), (e) => e instanceof Error && !/secret/.test(e.message));
});

// -- file encryption ------------------------------------------------------

test('encryptFile output = IV(12) || ciphertext+tag(16): length is plain + 28', async () => {
  const fk = await generateKey();
  for (const n of [0, 1, 100, 4096]) {
    const blob = await encryptFile(fk, randomBytes(n));
    assert.ok(blob instanceof Uint8Array);
    assert.equal(blob.length, n + 12 + 16);
  }
});

test('encryptFile uses a fresh IV per call', async () => {
  const fk = await generateKey();
  const plain = enc('same bytes');
  const a = await encryptFile(fk, plain);
  const b = await encryptFile(fk, plain);
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12));
  assert.notDeepEqual(a, b);
});

test('encryptFile/decryptFile roundtrip 1 MB of random bytes', async () => {
  const fk = await generateKey();
  const plain = new Uint8Array(1024 * 1024);
  for (let off = 0; off < plain.length; off += 65536) plain.set(randomBytes(65536), off);
  const blob = await encryptFile(fk, plain);
  assert.equal(blob.length, plain.length + 12 + 16);
  const back = await decryptFile(fk, blob);
  assert.equal(back.length, plain.length);
  assert.ok(Buffer.from(back).equals(Buffer.from(plain)));
});

test('decryptFile rejects a wrong key, a flipped byte, and a blob too short to be valid', async () => {
  const fk = await generateKey();
  const blob = await encryptFile(fk, enc('file contents'));

  await assert.rejects(decryptFile(await generateKey(), blob));

  const bad = blob.slice();
  bad[20] ^= 0x01;
  await assert.rejects(decryptFile(fk, bad));

  const badIv = blob.slice();
  badIv[0] ^= 0x01;
  await assert.rejects(decryptFile(fk, badIv));

  await assert.rejects(decryptFile(fk, blob.subarray(0, 27)));
  await assert.rejects(decryptFile(fk, new Uint8Array(0)));

  assert.equal(dec(await decryptFile(fk, blob)), 'file contents');
});

test('decryptFile works on a subarray view of a larger buffer', async () => {
  const fk = await generateKey();
  const blob = await encryptFile(fk, enc('view me'));
  const host = new Uint8Array(blob.length + 10);
  host.set(blob, 5);
  assert.equal(dec(await decryptFile(fk, host.subarray(5, 5 + blob.length))), 'view me');
});

// -- key derivation -------------------------------------------------------

test('deriveKek is deterministic for the same code + salt, and returns an extractable AES-GCM 256 key', async () => {
  const a = await deriveKek('MK-TEST-CODE', FAKE_SALT, ITER);
  const b = await deriveKek('MK-TEST-CODE', FAKE_SALT, ITER);
  assert.equal(a.algorithm.name, 'AES-GCM');
  assert.equal(a.algorithm.length, 256);
  assert.equal(a.extractable, true);
  assert.deepEqual([...a.usages].sort(), ['decrypt', 'encrypt']);
  assert.equal(await exportKey(a), await exportKey(b));
});

test('deriveKek changes with the code, the salt and the iteration count', async () => {
  const base = await exportKey(await deriveKek('MK-TEST-CODE', FAKE_SALT, ITER));
  assert.notEqual(await exportKey(await deriveKek('MK-TEST-CODF', FAKE_SALT, ITER)), base);
  assert.notEqual(await exportKey(await deriveKek('mk-test-code', FAKE_SALT, ITER)), base);
  assert.notEqual(await exportKey(await deriveKek('MK-TEST-CODE', toB64(new Uint8Array(16)), ITER)), base);
  assert.notEqual(await exportKey(await deriveKek('MK-TEST-CODE', FAKE_SALT, ITER + 1)), base);
});

test('deriveKek is PBKDF2-HMAC-SHA-256 with a 32-byte output (cross-checked against node:crypto)', async () => {
  const code = '127377k1K1@@';
  const expected = pbkdf2Sync(Buffer.from(code, 'utf8'), Buffer.from(fromB64(FAKE_SALT)), ITER, 32, 'sha256');
  const got = fromB64(await exportKey(await deriveKek(code, FAKE_SALT, ITER)));
  assert.ok(Buffer.from(got).equals(expected));
});

test('deriveKek encodes the code as UTF-8, so non-ASCII codes derive consistently', async () => {
  const code = 'pässwörd-ключ-密码!';
  const expected = pbkdf2Sync(Buffer.from(code, 'utf8'), Buffer.from(fromB64(FAKE_SALT)), ITER, 32, 'sha256');
  assert.equal(await exportKey(await deriveKek(code, FAKE_SALT, ITER)), expected.toString('base64'));
});

test('a KEK derived twice from the same code opens what the first sealed; a wrong code does not', async () => {
  const k1 = await deriveKek('MK-TEST-CODE', FAKE_SALT, ITER);
  const k2 = await deriveKek('MK-TEST-CODE', FAKE_SALT, ITER);
  const wrong = await deriveKek('MK-WRONG-CODE', FAKE_SALT, ITER);
  const sealed = await seal(k1, enc('vk goes here'));
  assert.equal(dec(await open(k2, sealed)), 'vk goes here');
  await assert.rejects(open(wrong, sealed));
});

test('deriveKek rejects an empty or non-string code', async () => {
  await assert.rejects(deriveKek('', FAKE_SALT, ITER));
  await assert.rejects(deriveKek(undefined, FAKE_SALT, ITER));
});

test('deriveKek rejects a salt shorter than 16 bytes', async () => {
  await assert.rejects(deriveKek('MK-TEST-CODE', toB64(new Uint8Array(15)), ITER), { message: 'salt too short' });
  await assert.rejects(deriveKek('MK-TEST-CODE', '', ITER), { message: 'salt too short' });
  // 16 bytes and longer are fine
  await deriveKek('MK-TEST-CODE', toB64(new Uint8Array(32)), ITER);
});

test('deriveKek rejects a missing, non-integer or non-positive iteration count', async () => {
  await assert.rejects(deriveKek('MK-TEST-CODE', FAKE_SALT));
  await assert.rejects(deriveKek('MK-TEST-CODE', FAKE_SALT, 0));
  await assert.rejects(deriveKek('MK-TEST-CODE', FAKE_SALT, -5));
  await assert.rejects(deriveKek('MK-TEST-CODE', FAKE_SALT, 1.5));
});

// -- formatSize -----------------------------------------------------------

// Units are 1024-based (4403211 / 1024^2 = 4.199, so the brief's '4.2 MB' only holds in binary
// units), labelled kB / MB / GB as the brief writes them.
const KiB = 1024, MiB = 1024 ** 2, GiB = 1024 ** 3;

test('formatSize matches the brief examples', () => {
  assert.equal(formatSize(4403211), '4.2 MB');
  assert.equal(formatSize(812 * KiB), '812 kB');
  assert.equal(formatSize(Math.round(1.1 * GiB)), '1.1 GB');
});

test('formatSize: bytes, kB (no decimals), MB and GB (one decimal)', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1023), '1023 B');
  assert.equal(formatSize(KiB), '1 kB');
  assert.equal(formatSize(812 * KiB + 300), '812 kB');
  assert.equal(formatSize(MiB), '1.0 MB');
  assert.equal(formatSize(Math.round(2.5 * MiB)), '2.5 MB');
  assert.equal(formatSize(GiB), '1.0 GB');
  assert.equal(formatSize(Math.round(12.3 * GiB)), '12.3 GB');
});

test('formatSize never prints a value that rounds up to 1024 of the smaller unit', () => {
  assert.equal(formatSize(1023 * KiB), '1023 kB');
  assert.equal(formatSize(1023 * KiB + 511), '1023 kB');
  assert.equal(formatSize(1023 * KiB + 512), '1.0 MB');
  assert.equal(formatSize(MiB - 1), '1.0 MB');
  assert.equal(formatSize(Math.floor(1023.9 * MiB)), '1023.9 MB');
  assert.equal(formatSize(GiB - 1), '1.0 GB');
});

test('formatSize rejects negative and non-finite sizes', () => {
  assert.throws(() => formatSize(-1));
  assert.throws(() => formatSize(NaN));
  assert.throws(() => formatSize(Infinity));
  assert.throws(() => formatSize('12'));
});

// -- portability guard ----------------------------------------------------

test('vault.mjs is browser-portable: no Node-only imports or globals', () => {
  const src = readFileSync(new URL('../assets/js/vault.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bBuffer\b/);
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  assert.doesNotMatch(src, /\bnode:/);
  assert.doesNotMatch(src, /\bprocess\./);
  assert.doesNotMatch(src, /\bconsole\./);
});
