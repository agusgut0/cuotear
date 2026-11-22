// Minimal ambient declarations for the Node APIs the project uses, so that
// `tsc` can typecheck without @types/node (DRT section 2 allows only the
// listed dev dependencies). Extend as new APIs are needed.

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
};

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare class URLSearchParams {
  get(name: string): string | null;
  has(name: string): boolean;
}

declare class URL {
  constructor(input: string, base?: string | URL);
  href: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  searchParams: URLSearchParams;
}

interface ImportMeta {
  url: string;
}

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}

declare module 'node:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | (new (...args: any[]) => Error) | { name?: string; message?: RegExp }): void;
  }
  const assert: Assert;
  export default assert;
}
