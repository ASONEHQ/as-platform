import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, sensitivePaths } from './index.js';

describe('logger', () => {
  it('defines required redaction paths and redacts sensitive values', async () => {
    let output = '';
    const destination = new Writable({
      write(
        chunk: string | Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        output += typeof chunk === 'string' ? chunk : chunk.toString();
        callback();
      },
    });
    const logger = createLogger({
      destination,
      environment: 'test',
      level: 'info',
      service: 'logger-test',
    });

    logger.info({ password: 'must-not-appear', safe: 'visible' }, 'redaction test');
    await new Promise<void>((resolve) => destination.end(resolve));

    expect(sensitivePaths).toContain('request.headers.authorization');
    expect(output).toContain('[Redacted]');
    expect(output).toContain('visible');
    expect(output).not.toContain('must-not-appear');
  });
});
