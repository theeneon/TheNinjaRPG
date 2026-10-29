import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "bun:test";
import mysql from "mysql2/promise";
import { baselineTableSql, quoteIdentifier, type SnapshotTable } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("pet skill recipient migration", () => {
  it("preserves tag order and payloads, moves the recipient choice to every tag and removes the shared column", async () => {
    const connection = await mysql.createConnection({ uri: process.env.TEST_MYSQL_URL, multipleStatements: true });
    const table = `pet_targets_${randomUUID().replaceAll("-", "")}`;
    const query = <T extends mysql.QueryResult = mysql.QueryResult>(statement: string, values?: unknown[]) =>
      connection.query<T>(statement.replaceAll("`PetSpecies`", quoteIdentifier(table)), values);
    const effects = [
      { type: "decreasestat", power: 25, rounds: 100, generalTypes: ["Strength", "Speed"], target: "SELF" },
      { type: "increasestat", power: 30, rounds: 100, timeTracker: { owner: 2 }, description: 'Escaped "words" and braces {}' },
      { type: "summon", aiId: "summon", power: 100 },
    ];
    try {
      const snapshot = JSON.parse(await readFile("drizzle/migrations/meta/0122_snapshot.json", "utf8")) as { tables: Record<string, SnapshotTable> };
      await query(baselineTableSql(snapshot.tables.PetSpecies!));
      for (const target of ["SELF", "ENEMIES"]) {
        for (const tags of [[], effects]) {
          const id = `${target}-${tags.length}`;
          await query("INSERT INTO `PetSpecies` (id, name, description, skillTarget, effects) VALUES (?, ?, 'Species description', ?, ?)", [id, id, target, JSON.stringify(tags)]);
        }
      }
      const [before] = await query<mysql.RowDataPacket[]>("SELECT * FROM `PetSpecies` ORDER BY id");
      const migration = await readFile("drizzle/migrations/0123_pet_skill_targets.sql", "utf8");
      expect(migration).not.toContain("--> statement-breakpoint");
      await query(migration);
      const [after] = await query<mysql.RowDataPacket[]>("SELECT * FROM `PetSpecies` ORDER BY id");
      expect(after).toEqual(before.map(({ skillTarget, ...species }) => ({
        ...species,
        effects: species.effects.map((effect: object) => ({ ...effect, skillTarget })),
      })));
      expect(after.every((species) => !("skillTarget" in species))).toBe(true);
    } finally {
      await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
      await connection.end();
    }
  });
});
