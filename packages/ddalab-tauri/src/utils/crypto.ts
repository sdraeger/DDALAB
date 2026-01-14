/**
 * AES-256-GCM encryption utilities using Web Crypto API
 * Compatible with Rust aes-gcm implementation
 */

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Import encryption key from raw bytes
 */
export async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt data using AES-256-GCM
 * Returns: nonce (12 bytes) || ciphertext (includes 16-byte auth tag)
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  // Generate random 12-byte nonce
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
    key,
    plaintext as BufferSource,
  );

  // Concatenate: nonce || ciphertext
  const result = new Uint8Array(NONCE_LENGTH + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), NONCE_LENGTH);

  return result;
}

/**
 * Decrypt data using AES-256-GCM
 * Expects: nonce (12 bytes) || ciphertext
 */
export async function decrypt(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (data.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Data too short to contain nonce and auth tag");
  }

  const nonce = data.slice(0, NONCE_LENGTH);
  const ciphertext = data.slice(NONCE_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
    key,
    ciphertext,
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypt a JSON object for API request
 */
export async function encryptJson(
  key: CryptoKey,
  data: unknown,
): Promise<Uint8Array> {
  const jsonString = JSON.stringify(data);
  const plaintext = new TextEncoder().encode(jsonString);
  return encrypt(key, plaintext);
}

/**
 * Decrypt API response to JSON
 */
export async function decryptJson<T>(
  key: CryptoKey,
  data: Uint8Array,
): Promise<T> {
  const plaintext = await decrypt(key, data);
  const jsonString = new TextDecoder().decode(plaintext);
  return JSON.parse(jsonString) as T;
}
