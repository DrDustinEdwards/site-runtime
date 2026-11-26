/**
 * The `Server-Timing` header: how long the Worker spent on a response, shown in DevTools' Timing tab and readable by
 * field monitoring through the Resource Timing API (https://www.w3.org/TR/server-timing/). In a Worker the clock moves
 * only across I/O, so a mark measures the waits (D1, R2, fetch), which is what makes a render slow. A stored page keeps
 * the marks of the render that stored it.
 */
/**
 * @typedef {{ name: string, ms: number }} Mark
 */
/** The header value: names cut to tokens, since one malformed name makes a browser drop the whole header. */
export function serverTiming(marks: Mark[]): string;
/**
 * Runs `fn` and adds its time to `marks` as `name`, thrown or not. With no `marks` it only runs `fn`.
 * @template T
 * @param {Mark[] | undefined} marks
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function timed<T>(marks: Mark[] | undefined, name: string, fn: () => Promise<T>): Promise<T>;
/**
 * Renders through `render` and returns its response with a `render` mark (and any marks the render added to the list
 * it is given) appended to `Server-Timing`. Rebuilt when the response's headers are immutable.
 * @param {(marks: Mark[]) => Promise<Response>} render
 * @returns {Promise<Response>}
 */
export function timedRender(render: (marks: Mark[]) => Promise<Response>): Promise<Response>;
export type Mark = {
    name: string;
    ms: number;
};
