import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies Mercado Pago's `x-signature` webhook header exactly per
 * current official documentation (ADR-0010, "Signature verification"):
 *
 * - `x-signature` is `ts=<unix-ms-timestamp>,v1=<hex-hmac>` (comma-
 *   separated `key=value` parts).
 * - The signed payload is the literal template
 *   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — `data.id` is the
 *   *lowercased* order id from the notification body, `x-request-id` is
 *   that request's own header, `ts` is the timestamp extracted above.
 * - HMAC-SHA256 of that template, hex-encoded, keyed by the application's
 *   webhook secret (from Your integrations > Webhooks > Configure
 *   notifications) — never a hardcoded or default secret.
 *
 * `timingSafeEqual` (not `===`) compares the computed and received
 * digests — a signature check that leaks timing information is not a
 * real signature check.
 */
export interface VerifyMercadoPagoSignatureInput {
  readonly xSignature: string | undefined;
  readonly xRequestId: string | undefined;
  readonly dataId: string | undefined;
  readonly webhookSecret: string | undefined;
}

export type VerifyMercadoPagoSignatureResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

function parseXSignature(header: string): { ts: string; v1: string } | null {
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=').trim();
    if (key?.trim() === 'ts') ts = value;
    else if (key?.trim() === 'v1') v1 = value;
  }
  if (ts === undefined || v1 === undefined || ts.length === 0 || v1.length === 0) return null;
  return { ts, v1 };
}

export function verifyMercadoPagoSignature(
  input: VerifyMercadoPagoSignatureInput,
): VerifyMercadoPagoSignatureResult {
  if (input.webhookSecret === undefined || input.webhookSecret.length === 0)
    return { valid: false, reason: 'not_configured' };
  if (input.xSignature === undefined) return { valid: false, reason: 'missing_x_signature' };
  if (input.xRequestId === undefined) return { valid: false, reason: 'missing_x_request_id' };
  if (input.dataId === undefined) return { valid: false, reason: 'missing_data_id' };

  const parsed = parseXSignature(input.xSignature);
  if (parsed === null) return { valid: false, reason: 'malformed_x_signature' };

  const template = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${parsed.ts};`;
  const expected = createHmac('sha256', input.webhookSecret).update(template).digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(parsed.v1, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length || expectedBuffer.length === 0)
    return { valid: false, reason: 'signature_mismatch' };
  if (!timingSafeEqual(expectedBuffer, receivedBuffer))
    return { valid: false, reason: 'signature_mismatch' };
  return { valid: true };
}
