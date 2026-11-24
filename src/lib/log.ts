// Everything a person reads goes to stderr; results go to files. That keeps
// stdout free for piping and makes CI logs show exactly what a user sees.

/** An error whose message is already written for the user (what happened + how to fix). */
export class UserError extends Error {
  override name = "UserError";
}

export function info(message: string): void {
  process.stderr.write(message + "\n");
}

/**
 * A "Label… 3/10" counter. On a terminal it redraws one line; in CI logs it
 * prints only the final count so logs stay short.
 */
export function progress(label: string, total: number): { tick(): void; done(): void } {
  let count = 0;
  const live = Boolean(process.stderr.isTTY);
  const draw = () => process.stderr.write(`\r${label}… ${count}/${total}`);
  if (live) draw();
  return {
    tick() {
      count++;
      if (live) draw();
    },
    done() {
      process.stderr.write(live ? "\n" : `${label}… ${count}/${total}\n`);
    },
  };
}

/** Print "Error: <message>" and exit 1. Stack traces only with DEBUG=datarecipe. */
export function fail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  if (process.env.DEBUG?.includes("datarecipe") && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  // exitCode, not exit(): exit() can cut off stderr that is still being written to a pipe.
  process.exitCode = 1;
}

/** Paths in messages use forward slashes so docs and output match on every OS. */
export function displayPath(p: string): string {
  return p.replace(/\\/g, "/");
}
