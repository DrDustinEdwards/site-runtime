/**
 * Throws an AssertionError naming the difference when `table` does not match the table of its name that `sql` creates.
 * @param {import("drizzle-orm/sqlite-core").SQLiteTable} table
 * @param {string} sql
 */
export function assertMirror(table: import("drizzle-orm/sqlite-core").SQLiteTable, sql: string): void;
export type ColumnShape = {
    name: string;
    type: string;
    notNull: boolean;
    default: string | null;
    pk: number;
};
export type IndexShape = {
    name: string;
    unique: boolean;
    on: string[];
};
export type TableShape = {
    columns: ColumnShape[];
    indexes: IndexShape[];
    autoincrement: boolean;
};
