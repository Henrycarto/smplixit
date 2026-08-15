/**
 * PKCE helpers.
 *
 * SMART App Launch 2.0 requires PKCE with S256 for public clients, and both
 * Epic and Cerner enforce it. Without it, an attacker who intercepts the
 * authorization code on the redirect can exchange it themselves.
 *
 * Uses Web Crypto, which is available in the browser, in Node 18+, and in the
 * Next.js edge runtime. No Node-only APIs, so the same module works in a route
 * handler and in a client component.
 */

const VERIFIER_LENGTH = 64;

/** RFC 7636 restricts the verifier to this unreserved set. */
const VERIFIER_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a code verifier.
 *
 * Rejection-free mapping: each random byte is reduced modulo the charset
 * length. The charset is 66 characters, so the modulo bias across 256 values is
 * under 2 percent per character. Over 64 characters that leaves well above the
 * 256 bits of entropy the spec asks for, so the bias is not worth a rejection
 * loop that would make the function variable-time.
 */
export function createCodeVerifier(length: number = VERIFIER_LENGTH): string {
  const bytes = randomBytes(length);
  let verifier = "";
  for (const byte of bytes) {
    verifier += VERIFIER_CHARSET[byte % VERIFIER_CHARSET.length];
  }
  return verifier;
}

/** Derive the S256 challenge. Plain challenges are not supported on purpose. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

/** Opaque CSRF value for the `state` parameter. */
export function createState(): string {
  return base64UrlEncode(randomBytes(32));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createCodeVerifier();
  return {
    verifier,
    challenge: await createCodeChallenge(verifier),
    state: createState(),
  };
}

/**
 * Constant-time string comparison for the state check.
 *
 * A plain `===` on the state parameter leaks its contents through timing. The
 * practical risk is low, but this is an auth boundary in a PHI system and the
 * correct version costs four lines.
 */
export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
