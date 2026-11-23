/**
 * Adds integrity to the tags of every .html file under `dir`. `base` is the path the folder is served at (Vite's
 * `base`, `/portal/`), so `/portal/assets/x.js` is `dir/assets/x.js`. A tag that names another origin, a file
 * outside `dir` or one that does not exist, or already carries integrity, is left as it is.
 * @param {string} dir
 * @param {{ base?: string }} [options]
 * @returns {Promise<number>} how many tags were given integrity
 */
export function writeIntegrity(dir: string, { base }?: {
    base?: string;
}): Promise<number>;
/**
 * The Vite plugin: writeIntegrity over the output folder once the build is written, with Vite's `base`.
 * @returns {{ name: string, apply: "build", enforce: "post", configResolved(config: { base: string }): void, writeBundle(options: { dir?: string }): Promise<void> }}
 */
export function subresourceIntegrity(): {
    name: string;
    apply: "build";
    enforce: "post";
    configResolved(config: {
        base: string;
    }): void;
    writeBundle(options: {
        dir?: string;
    }): Promise<void>;
};
