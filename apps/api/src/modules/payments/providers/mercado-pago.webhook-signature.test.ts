import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyMercadoPagoSignature } from './mercado-pago.webhook-signature.js';

const secret = 'test-webhook-secret';

function sign(dataId: string, requestId: string, ts: string, usedSecret = secret): string {
  const template = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return createHmac('sha256', usedSecret).update(template).digest('hex');
}

describe('verifyMercadoPagoSignature', () => {
  it('accepts a correctly computed signature', () => {
    const ts = '1700000000000';
    const v1 = sign('ORD00001', 'req-1', ts);
    const result = verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: 'ORD00001',
      webhookSecret: secret,
    });
    expect(result).toEqual({ valid: true });
  });

  it('is case-insensitive on the order id exactly as documented (lowercased before hashing)', () => {
    const ts = '1700000000000';
    const v1 = sign('ord00001', 'req-1', ts);
    const result = verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: 'ORD00001',
      webhookSecret: secret,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const ts = '1700000000000';
    const v1 = sign('ORD00001', 'req-1', ts, 'wrong-secret');
    const result = verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: 'ORD00001',
      webhookSecret: secret,
    });
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature computed for a different order id, request id, or timestamp', () => {
    const ts = '1700000000000';
    const v1 = sign('ORD00001', 'req-1', ts);
    expect(
      verifyMercadoPagoSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: 'req-1',
        dataId: 'ORD99999',
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: 'req-DIFFERENT',
        dataId: 'ORD00001',
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({
        xSignature: `ts=9999999999999,v1=${v1}`,
        xRequestId: 'req-1',
        dataId: 'ORD00001',
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
  });

  it('rejects when the webhook secret is not configured', () => {
    const ts = '1700000000000';
    const v1 = sign('ORD00001', 'req-1', ts);
    const result = verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: 'ORD00001',
      webhookSecret: undefined,
    });
    expect(result).toEqual({ valid: false, reason: 'not_configured' });
  });

  it('rejects a missing x-signature, missing x-request-id, or missing data.id', () => {
    expect(
      verifyMercadoPagoSignature({
        xSignature: undefined,
        xRequestId: 'req-1',
        dataId: 'ORD00001',
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({
        xSignature: 'ts=1,v1=abc',
        xRequestId: undefined,
        dataId: 'ORD00001',
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({
        xSignature: 'ts=1,v1=abc',
        xRequestId: 'req-1',
        dataId: undefined,
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
  });

  it('rejects a malformed x-signature header (missing ts or v1 parts)', () => {
    expect(
      verifyMercadoPagoSignature({
        xSignature: 'not-a-valid-header',
        xRequestId: 'req-1',
        dataId: 'ORD00001',
        webhookSecret: secret,
      }),
    ).toEqual({ valid: false, reason: 'malformed_x_signature' });
    expect(
      verifyMercadoPagoSignature({
        xSignature: 'ts=1700000000000',
        xRequestId: 'req-1',
        dataId: 'ORD00001',
        webhookSecret: secret,
      }).valid,
    ).toBe(false);
  });

  it('rejects a v1 value that is not valid hex or the wrong length, without throwing', () => {
    expect(() =>
      verifyMercadoPagoSignature({
        xSignature: 'ts=1700000000000,v1=not-hex-at-all!!',
        xRequestId: 'req-1',
        dataId: 'ORD00001',
        webhookSecret: secret,
      }),
    ).not.toThrow();
  });
});
