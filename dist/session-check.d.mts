/**
 * The lines of `source` with an `api.getSession(` call that does not go through `sessionLookup(`.
 * @param {string} source
 * @returns {number[]}
 */
export function directSessionReads(source: string): number[];
/**
 * The source files under `dir`, leaving out node_modules, build output and test files.
 * @param {string} dir
 * @returns {string[]}
 */
export function sourceFiles(dir: string): string[];
