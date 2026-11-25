// A D1-shaped wrapper over node:sqlite, with `sql` run first to make the tables.
import { DatabaseSync } from "node:sqlite";

/** @param {string} sql */
export function d1(sql) {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return {
    db,
    prepare: (/** @type {string} */ sql) => ({
      bind: (/** @type {any[]} */ ...v) => ({
        run: async () => db.prepare(sql).run(...v),
        all: async () => ({ results: db.prepare(sql).all(...v) }),
      }),
    }),
  };
}
