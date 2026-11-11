/** Who may see a draft (draft-gate.mjs): the one server check before a loader renders a row that may not be public. */

/**
 * `{ row, draft }`, or throws a 404 Response (`no-store`) when `row` is missing, or when it is a draft and
 * `canSeeDrafts()` is false. `canSeeDrafts` runs only for a draft. A draft is `status === "draft"` unless
 * `options.isDraft` says otherwise.
 */
export function draftGate<R extends { status?: string | null }>(
  row: R | null | undefined,
  canSeeDrafts: () => boolean | Promise<boolean>,
  options?: { isDraft?: (row: R) => boolean },
): Promise<{ row: R; draft: boolean }>;
/** `[{ name: "robots", content: "noindex" }]` for a draft, else `[]`. */
export function draftRobots(draft: boolean): { name: "robots"; content: "noindex" }[];
