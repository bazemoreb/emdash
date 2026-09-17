import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { up } from "../../../../src/database/migrations/080_redirect_write_guards.js";

describe("080_redirect_write_guards migration", () => {
	let db: Kysely<unknown> | undefined;

	afterEach(async () => {
		await db?.destroy();
	});

	it("preserves duplicate rows, guards one source, and can restart", async () => {
		const sqlite = new BetterSqlite3(":memory:");
		sqlite.exec(
			"CREATE TABLE _emdash_redirects (id TEXT PRIMARY KEY, source TEXT NOT NULL);" +
				"INSERT INTO _emdash_redirects (id, source) VALUES ('a', '/old'), ('b', '/old')",
		);
		db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: sqlite }) });

		await up(db);
		await up(db);

		const rows = await sql<{ config_revision: string; source_guard: number }>`
			SELECT config_revision, source_guard FROM _emdash_redirects ORDER BY id
		`.execute(db);
		expect(rows.rows).toEqual([
			{ config_revision: "0", source_guard: 1 },
			{ config_revision: "0", source_guard: 0 },
		]);
		await expect(
			sql`INSERT INTO _emdash_redirects (id, source, config_revision, source_guard)
				VALUES ('c', '/old', 'new', 1)`.execute(db),
		).rejects.toThrow();
		const lock = await sql<{ id: number; token: string; expires_at: number }>`
			SELECT id, token, expires_at FROM _emdash_redirect_write_lock
		`.execute(db);
		expect(lock.rows).toEqual([{ id: 1, token: "", expires_at: 0 }]);
	});
});
