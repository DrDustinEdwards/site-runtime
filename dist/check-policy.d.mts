/**
 * Grades the policy and the headers that report it, recording through `result`.
 * @param {Headers} headers
 * @param {(id: string, name: string, pass: boolean, detail: string, warn?: boolean, declinable?: string | boolean) => void} result
 * @param {CheckedSiteEntry | undefined} entry
 * @param {Record<string, any>} o the check's options, with the registry's opt-ins applied
 */
export function checkPolicy(headers: Headers, result: (id: string, name: string, pass: boolean, detail: string, warn?: boolean, declinable?: string | boolean) => void, entry: CheckedSiteEntry | undefined, o: Record<string, any>): void;
import type { CheckedSiteEntry } from "./check-core.mjs";
