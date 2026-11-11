/**
 * Who may see a draft: the one server check a page's loader makes before it renders a row that may not be public yet.
 *
 * dustinedwards.info had the same two lines in seven loaders (a missing row is a 404; a draft is a 404 unless the
 * viewer is an admin). This is that check, shared, so every site answers a draft the same way:
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
export async function draftGate(row, canSeeDrafts, options = {}) {
  if (row === null || row === undefined) throw notFound();
  const draft = options.isDraft ? options.isDraft(row) : row.status === "draft";
  if (draft && !(await canSeeDrafts())) throw notFound();
  return { row, draft };
}

/** The robots meta a draft page carries, for a route's `meta`: `[{ name: "robots", content: "noindex" }]`, else `[]`. */
export function draftRobots(/** @type {boolean} */ draft) {
  return draft ? [{ name: "robots", content: "noindex" }] : [];
}

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
