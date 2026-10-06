// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { actionLog, bloodline, skillTree, userData, userSkill } from "@/drizzle/schema";
import * as socials from "@/libs/socials";
import { bloodrightSwapRefund } from "@/libs/bloodright";
import { bloodrightRouter } from "@/server/api/routers/bloodright";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const userId = "bloodright-player";
const invoke = async (name: "purchase" | "refund" | "reset", input?: unknown) => {
  const db = await getTestDatabase();
  const procedure = bloodrightRouter._def.procedures[name];
  const { resolver } = procedure._def as unknown as { resolver: (args: { ctx: { drizzle: typeof db; userId: string }; input: unknown }) => Promise<{ success: boolean }> };
  return resolver({ ctx: { drizzle: db, userId }, input });
};
const read = async () => (await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
const tier = (id: string, tier = 1, requiredSkillIds: string[] = []) => ({ id, name: id, image: "", description: "Bloodright fixture", effects: [], tier, requiredSkillIds, pathType: "BLOODRIGHT" as const, bloodlineId: "line", seichiSilverCost: 100 });

describeWithDatabase("Bloodright economy on MySQL", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(actionLog, userSkill, skillTree, userData, bloodline);
    await db.insert(bloodline).values({id: "line", name: "Bloodright Line", rank: "D", image: "", description: "Fixture", effects: []});
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await db.insert(userData).values({ userId, username: "BloodrightPlayer", gender: "Other", bloodlineId: "line", seichiSilver: 1000, reputationPoints: 100, rank: "JONIN" });
    await db.insert(skillTree).values([tier("root"), tier("child", 2, ["root"]), tier("grandchild", 3, ["child"]), tier("other"), tier("fifth"), tier("sixth")]);
    stubProfile("fetchUpdatedUser", async () => ({ user: await read() }));
  });
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); });

  it("charges once for concurrent duplicate purchases and refunds once", async () => {
    const purchases = await Promise.all([invoke("purchase", { skillId: "root" }), invoke("purchase", { skillId: "root" })]);
    expect(purchases.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).seichiSilver).toBe(900);
    const refunds = await Promise.all([invoke("refund", { skillId: "root" }), invoke("refund", { skillId: "root" })]);
    expect(refunds.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).seichiSilver).toBe(1000);
  });
  it("enforces prerequisites, balance and five active nodes", async () => {
    expect((await invoke("purchase", { skillId: "child" })).success).toBe(false);
    for (const skillId of ["root", "child", "grandchild", "other", "fifth"]) expect((await invoke("purchase", { skillId })).success).toBe(true);
    expect((await invoke("purchase", { skillId: "sixth" })).success).toBe(false);
    const db = await getTestDatabase();
    await db.update(userData).set({ seichiSilver: 0, bloodright: [], bloodrightSpent: 0 }).where(eq(userData.userId, userId));
    expect((await invoke("purchase", { skillId: "root" })).success).toBe(false);
    expect((await read()).seichiSilver).toBe(0);
  });
  it("refunds all dependents at their saved costs after a content price change", async () => {
    for (const skillId of ["root", "child", "grandchild", "other"]) await invoke("purchase", { skillId });
    const db = await getTestDatabase();
    await db.update(skillTree).set({ seichiSilverCost: 999 }).where(eq(skillTree.id, "root"));
    expect((await invoke("refund", { skillId: "root" })).success).toBe(true);
    const user = await read();
    expect(user.seichiSilver).toBe(900);
    expect(user.bloodrightSpent).toBe(100);
    expect(user.bloodright.map((entry) => entry.skillId)).toEqual(["other"]);
  });
  it("refunds a changed bloodline in one update and does not refund a same-line update", async () => {
    await invoke("purchase", { skillId: "root" });
    const db = await getTestDatabase();
    await db.update(userData).set({ ...bloodrightSwapRefund("line"), bloodlineId: "line" }).where(eq(userData.userId, userId));
    expect((await read()).seichiSilver).toBe(900);
    await db.update(userData).set({ ...bloodrightSwapRefund("other-line"), bloodlineId: "other-line" }).where(eq(userData.userId, userId));
    const user = await read();
    expect(user.seichiSilver).toBe(1000);
    expect(user.bloodright).toEqual([]);
    expect(user.bloodrightSpent).toBe(0);
    await db.update(userData).set({ ...bloodrightSwapRefund("line"), bloodlineId: "line" }).where(eq(userData.userId, userId));
    expect((await read()).bloodright).toEqual([]);
  });
  it("shares the one free reset with Skills and charges 30 reps afterward", async () => {
    await invoke("purchase", { skillId: "root" });
    expect((await invoke("reset")).success).toBe(true);
    expect((await read()).reputationPoints).toBe(100);
    const db = await getTestDatabase();
    const { resolver } = skillTreeRouter._def.procedures.resetSkillPoints._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: undefined}) => Promise<{success: boolean}> };
    expect((await resolver({ctx: {drizzle: db, userId}, input: undefined})).success).toBe(true);
    expect((await read()).reputationPoints).toBe(70);
    expect((await read()).monthlySkillResets.count).toBe(2);
  });
  it("gives Gold two free resets and cannot overspend reputation", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ federalStatus: "GOLD", reputationPoints: 29 }).where(eq(userData.userId, userId));
    for (let i = 0; i < 2; i++) { await invoke("purchase", {skillId: "root"}); expect((await invoke("reset")).success).toBe(true); }
    await invoke("purchase", {skillId: "root"});
    expect((await invoke("reset")).success).toBe(false);
    expect((await read()).reputationPoints).toBe(29);
    expect((await read()).bloodright).toHaveLength(1);
  });
  it("serializes different purchases competing for the final active slot", async () => {
    for (const skillId of ["root", "child", "grandchild", "other"]) await invoke("purchase", { skillId });
    const results = await Promise.all([invoke("purchase", { skillId: "fifth" }), invoke("purchase", { skillId: "sixth" })]);
    expect(results.filter((entry) => entry.success)).toHaveLength(1);
    expect((await read()).bloodright).toHaveLength(5);
    expect((await read()).seichiSilver).toBe(500);
  });
  it("refunds once when a tier refund races a bloodline swap", async () => {
    await invoke("purchase", { skillId: "root" });
    const db = await getTestDatabase();
    await Promise.all([invoke("refund", { skillId: "root" }), db.update(userData).set({ ...bloodrightSwapRefund("other-line"), bloodlineId: "other-line" }).where(eq(userData.userId, userId))]);
    expect((await read()).seichiSilver).toBe(1000);
    expect((await read()).bloodrightSpent).toBe(0);
    expect((await read()).bloodright).toEqual([]);
  });
  it("supports repeated staff resets after allowance initialization", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER", staffAccount: true }).where(eq(userData.userId, userId));
    const { resolver } = skillTreeRouter._def.procedures.resetSkillPoints._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: undefined}) => Promise<{success: boolean}> };
    for (let i = 0; i < 2; i++) expect((await resolver({ctx: {drizzle: db, userId}, input: undefined})).success).toBe(true);
    expect((await read()).reputationPoints).toBe(100);
    expect((await read()).monthlySkillResets.count).toBe(0);
  });
  it("prevents content edits and deletion from stranding dependent tiers", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({role: "OWNER"}).where(eq(userData.userId, userId));
    const root = await db.query.skillTree.findFirst({where: eq(skillTree.id, "root")});
    const update = skillTreeRouter._def.procedures.update._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: unknown}) => Promise<{success: boolean}> };
    const deletion = skillTreeRouter._def.procedures.delete._def as unknown as { resolver: (args: {ctx: {drizzle: typeof db; userId: string}; input: unknown}) => Promise<{success: boolean}> };
    expect((await update.resolver({ctx: {drizzle: db, userId}, input: {id: "root", data: {...root, tier: 5}}})).success).toBe(false);
    expect((await deletion.resolver({ctx: {drizzle: db, userId}, input: {id: "root"}})).success).toBe(false);
    expect(await db.query.skillTree.findFirst({where: eq(skillTree.id, "root")})).toBeDefined();
  });
  it("rejects tiers of another bloodline and changes during battle", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({bloodlineId: "other-line"}).where(eq(userData.userId, userId));
    expect((await invoke("purchase", {skillId: "root"})).success).toBe(false);
    await db.update(userData).set({bloodlineId: "line", status: "BATTLE"}).where(eq(userData.userId, userId));
    expect((await invoke("purchase", {skillId: "root"})).success).toBe(false);
  });
});
