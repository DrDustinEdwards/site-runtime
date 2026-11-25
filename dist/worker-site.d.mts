/**
 * @template E
 * @param {SiteOptions<E>} options
 * @returns {Site<E>}
 */
export function defineSite<E>(options: SiteOptions<E>): Site<E>;
/**
 * The cacheable entrypoint: `export class Renderer extends siteRenderer(WorkerEntrypoint, site) {}`.
 * @template {abstract new (...args: any[]) => object} T
 * @param {T} Base WorkerEntrypoint
 * @param {Site<any>} site
 * @returns {T & (abstract new (...args: any[]) => { fetch(request: Request): Promise<Response>, purgePages(why: string, tags?: string[]): Promise<boolean | null> })}
 */
export function siteRenderer<T extends abstract new (...args: any[]) => object>(Base: T, site: Site<any>): T & (abstract new (...args: any[]) => {
    fetch(request: Request): Promise<Response>;
    purgePages(why: string, tags?: string[]): Promise<boolean | null>;
});
/** @import { Site, SiteOptions } from "./worker.mjs" */
/** @import { RenderExtra } from "./worker.mjs" */
export const SECURITY_TXT_PATH: "/.well-known/security.txt";
export const answeredFiles: WeakMap<object, any>;
import type { SiteOptions } from "./worker.mjs";
import type { Site } from "./worker.mjs";
