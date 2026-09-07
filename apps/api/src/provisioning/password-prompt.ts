/**
 * TASK 14.1 Part E — masked interactive password entry, zero external
 * dependencies. Node's built-in `readline` has no native masking option;
 * this is the standard, well-established raw-mode-stdin technique (put
 * the TTY into raw mode, intercept each keystroke ourselves, echo `*`
 * instead of the real character, handle Enter/Backspace/Ctrl+C
 * explicitly, always restore the terminal's own mode afterward — even on
 * an unexpected error, via `finally`).
 *
 * Only usable when stdin is actually an interactive terminal
 * (`process.stdin.isTTY`) — piped/non-interactive input has no
 * "keystroke" to intercept, so `promptPasswordMasked` throws in that
 * case; the CLI (`production-owner.cli.ts`) checks `isInteractive()`
 * first and falls back to the documented `PROVISION_OWNER_PASSWORD`
 * environment variable when not a TTY, per Part E's own instruction
 * ("if interactive hidden password entry is feasible, prefer it;
 * otherwise use an explicit secret env input").
 */

// Control characters, written as explicit escapes (never literal bytes in
// source) so this file stays byte-for-byte portable across editors/OSes.
const CTRL_C = '\x03';
const CTRL_D = '\x04';
const BACKSPACE_DEL = '\x7f';
const CTRL_H = '\x08';
const ESCAPE = '\x1b';

export function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export async function promptPasswordMasked(promptText: string): Promise<string> {
  if (!isInteractive()) throw new Error('promptPasswordMasked requires an interactive TTY.');
  const stdin = process.stdin;
  process.stdout.write(promptText);
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = (): void => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    function onData(chunk: string): void {
      for (const char of chunk) {
        // Ctrl+C / Ctrl+D — abort cleanly rather than leaving the
        // terminal stuck in raw mode.
        if (char === CTRL_C || char === CTRL_D) {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Password entry cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        // Backspace/Delete.
        if (char === BACKSPACE_DEL || char === CTRL_H) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        // Ignore other control characters (arrow keys etc. arrive as
        // multi-byte escape sequences starting with ESCAPE) — a masked
        // password prompt intentionally does not support cursor
        // movement, only append/backspace, matching every common CLI
        // password prompt's own minimal behavior.
        if (char === ESCAPE || char.charCodeAt(0) < 0x20) continue;
        value += char;
        process.stdout.write('*');
      }
    }

    stdin.on('data', onData);
  });
}
