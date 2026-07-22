import { describe, expect, it } from 'vitest';

import { AppError } from './index.js';

describe('AppError', () => {
  it('exposes safe fields without serializing the internal cause', () => {
    const cause = new Error('private infrastructure detail');
    const error = new AppError({
      cause,
      code: 'service_unavailable',
      details: { service: 'database' },
      message: 'A required service is unavailable.',
      statusCode: 503,
    });

    expect(error.cause).toBe(cause);
    expect(error.toPublicResponse()).toEqual({
      code: 'service_unavailable',
      details: { service: 'database' },
      message: 'A required service is unavailable.',
    });
    expect(JSON.stringify(error.toPublicResponse())).not.toContain('private infrastructure detail');
  });
});
