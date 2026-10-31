/** Subresource Integrity for a built site's own scripts (sri.mjs). Build tooling only. */

/**
 * Adds a sha384 `integrity` and `crossorigin` to every `<script src>` and `<link rel="modulepreload">` in the .html files
 * under `dir` that names a file of the same folder; `base` is the path the folder is served at. Returns the tag count.
 */
export function writeIntegrity(dir: string, options?: { base?: string }): Promise<number>;

/** The Vite plugin: writeIntegrity over the output folder once the build is written, with Vite's `base`. */
export function subresourceIntegrity(): {
  name: string;
  apply: "build";
  enforce: "post";
  configResolved(config: { base: string }): void;
  writeBundle(options: { dir?: string }): Promise<void>;
};
