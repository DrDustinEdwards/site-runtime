/** The `Server-Timing` header (server-timing.mjs). */

export interface Mark {
  name: string;
  ms: number;
}

/** The header value, names cut to tokens. */
export function serverTiming(marks: Mark[]): string;

/** Runs `fn`, adding its time to `marks` as `name` (thrown or not); with no `marks`, only runs it. */
export function timed<T>(marks: Mark[] | undefined, name: string, fn: () => Promise<T>): Promise<T>;

/** The response `render` returns, with `render` and the marks it added appended to `Server-Timing`. */
export function timedRender(render: (marks: Mark[]) => Promise<Response>): Promise<Response>;
