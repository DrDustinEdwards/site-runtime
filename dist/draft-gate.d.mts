/**
 * Who may see a draft: the one server check a page's loader makes before it renders a row that may not be public yet.
 *
 * Every site answers a draft the same way:
 *
 * - A missing row, and a draft the viewer may not see, are the same 404. A visitor cannot tell a draft from nothing.
 * - `canSeeDrafts` runs only for a draft, so a public page never verifies an Access token or reads a session.
 * - `draft` tells the page to show Capsomer's `DraftNotice` and a `noindex` robots meta.
 */
/**
 * @template {{ status?: string | null }} R
 * @param {R | null | undefined} row the row the loader read, or nothing
 * @param {() => boolean | Promise<boolean>} canSeeDrafts whether this viewer may see drafts (the site's admin check)
 * @param {{ isDraft?: (row: R) => boolean }} [options] `isDraft`, when a draft is not `status === "draft"`
 * @returns {Promise<{ row: R, draft: boolean }>}
 */
export function draftGate<R extends {
    status?: string | null;
}>(row: R | null | undefined, canSeeDrafts: () => boolean | Promise<boolean>, options?: {
    isDraft?: (row: R) => boolean;
}): Promise<{
    row: R;
    draft: boolean;
}>;
/**
 * The robots meta a draft page carries, for a route's `meta`: `[{ name: "robots", content: "noindex" }]`, else `[]`.
 * @param {boolean} draft
 * @returns {{ name: "robots", content: "noindex" }[]}
 */
export function draftRobots(draft: boolean): {
    name: "robots";
    content: "noindex";
}[];
