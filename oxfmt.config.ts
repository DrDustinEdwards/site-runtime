import { defineConfig } from "oxfmt";
import { format } from "@dustinedwards/devkit/oxfmt";

export default defineConfig({
  ...format,
  // Written by their scripts (update-sites-values.mjs, update-owasp.mjs), which the registry test compares byte for byte.
  ignorePatterns: [
    ...(format.ignorePatterns ?? []),
    "sites-values.mjs",
    "sites-deviations.mjs",
    "owasp-headers.mjs",
  ],
});
