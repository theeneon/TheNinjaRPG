import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { userData } from "@/drizzle/schema";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../../setup/testDatabase";

const migration = await readFile(
  new URL("../../../drizzle/migrations/0121_reconcile_skill_points.sql", import.meta.url),
  "utf8",
);

it("loads skill-point reconciliation through the migration journal", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL("../../../drizzle/migrations", import.meta.url)),
  });
  expect(migrations.filter(({ sql }) => sql.join("\n").includes(migration))).toHaveLength(1);
});

describeWithDatabase("skill-point reconciliation migration", () => {
  beforeEach(async () => resetTables(userData));

  it("corrects level totals, excludes AI and leaves correct accounts unchanged", async () => {
    await insertUsers([
      { userId: "over", rank: "CHUNIN", level: 50, skillPoints: 30 },
      { userId: "under", rank: "JONIN", level: 100, skillPoints: 10 },
      { userId: "level-31", rank: "CHUNIN", level: 31, skillPoints: 10 },
      { userId: "level-30", rank: "CHUNIN", level: 30, skillPoints: 10 },
      { userId: "level-29", rank: "GENIN", level: 29, skillPoints: 10 },
      { userId: "level-49", rank: "CHUNIN", level: 49, skillPoints: 0 },
      { userId: "level-51", rank: "JONIN", level: 51, skillPoints: 20 },
      { userId: "level-59", rank: "JONIN", level: 59, skillPoints: 20 },
      { userId: "level-60", rank: "JONIN", level: 60, skillPoints: 20 },
      { userId: "level-61", rank: "JONIN", level: 61, skillPoints: 40 },
      { userId: "genin", rank: "GENIN", level: 30, skillPoints: 10 },
      { userId: "genin-31", rank: "GENIN", level: 31, skillPoints: 10 },
      { userId: "elite", rank: "ELITE JONIN", level: 110, skillPoints: 0 },
      { userId: "elder", rank: "ELDER", level: 100, skillPoints: 30 },
      { userId: "ai", rank: "CHUNIN", level: 50, skillPoints: 30, isAi: true },
      { userId: "correct", rank: "CHUNIN", level: 50, skillPoints: 20 },
      { userId: "correct-60", rank: "JONIN", level: 60, skillPoints: 30 },
    ]);
    const db = await getTestDatabase();
    const [unchanged, level30, unchanged60] = await Promise.all([
      db.query.userData.findFirst({ where: eq(userData.userId, "correct") }),
      db.query.userData.findFirst({ where: eq(userData.userId, "level-30") }),
      db.query.userData.findFirst({ where: eq(userData.userId, "correct-60") }),
    ]);
    await runRawSql(migration);
    const rows = await db.query.userData.findMany();
    expect(Object.fromEntries(rows.map((row) => [row.userId, row.skillPoints]))).toEqual({
      over: 20,
      under: 30,
      "level-31": 1,
      "level-30": 10,
      "level-29": 0,
      "level-49": 19,
      "level-51": 21,
      "level-59": 29,
      "level-60": 30,
      "level-61": 30,
      genin: 0,
      "genin-31": 0,
      elite: 30,
      elder: 30,
      ai: 30,
      correct: 20,
      "correct-60": 30,
    });
    expect(rows.find((row) => row.userId === "correct")).toEqual(unchanged);
    expect(rows.find((row) => row.userId === "correct-60")).toEqual(unchanged60);
    expect(rows.find((row) => row.userId === "level-30")).toEqual(level30);
    await runRawSql(migration);
    expect(await db.query.userData.findMany()).toEqual(rows);
  });
});
