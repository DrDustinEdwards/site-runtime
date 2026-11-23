export function renderHtml<E>(site: import("./worker.mjs").Site<E>, request: Request, env: E): Promise<string | null>;
