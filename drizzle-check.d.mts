import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * Throws an AssertionError naming the difference when `table` (a Drizzle mirror) does not match the table of its name
 * that `sql` creates: columns, types, NOT NULL, defaults, the primary key, AUTOINCREMENT and indexes. Node only.
 */
export function assertMirror(table: SQLiteTable, sql: string): void;
