import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { item, itemVariant, userData, userItem, userItemVariant } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { UnlockItemVariantTag } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

/** Staff authoring must preserve requirements that players can satisfy. */
describeWithDatabase("item variant unlock requirements", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(userItemVariant, itemVariant, userItem, item, userData);
    await insertUsers([{ userId: "staff", username: "Staff", role: "OWNER" }]);
    await insertItems([
      { id: "weapon", name: "Sword", itemType: "WEAPON" },
      { id: "token", name: "Token", itemType: "CONSUMABLE", effects: [UnlockItemVariantTag.parse({})] },
      { id: "ore", name: "Ore" },
    ]);
    await (await getTestDatabase()).insert(itemVariant).values({ id: "variant", itemId: "weapon", name: "Red", image: "/red.png", costType: "VARIANT_TOKEN", requiredItemId: "token" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("lists only token-gated variants for unlock-effect authoring", async () => {
    const db = await getTestDatabase();
    await db.insert(itemVariant).values({ id: "currency-variant", itemId: "weapon", name: "Blue", image: "/blue.png", costType: "MONEY", cost: 100, order: 2 });
    const api = await callerFor(itemRouter, "staff");
    expect(await api.getVariantNames()).toEqual([{ id: "variant", name: "Sword: Red" }]);
  });

  it("rejects unusable required items and accepts generic or specifically matching tokens", async () => {
    const db = await getTestDatabase();
    const api = await callerFor(itemRouter, "staff");
    const variant = { id: "variant", name: "Red", image: "/red.png", costType: "VARIANT_TOKEN" as const, cost: 0, order: 1, requiredItemId: "ore" };
    expect(await api.upsertItemVariant({ itemId: "weapon", variant })).toMatchObject({ success: false, message: "Required unlock item cannot unlock this variant" });
    expect((await api.getItemVariants({ itemId: "weapon" }))[0]?.requiredItemId).toBe("token");
    for (const variantId of ["other-variant", "variant", null]) {
      await db.update(item).set({ effects: [UnlockItemVariantTag.parse({ variantId })] }).where(eq(item.id, "token"));
      const result = await api.upsertItemVariant({ itemId: "weapon", variant: { ...variant, requiredItemId: "token" } });
      expect(result.success).toBe(variantId !== "other-variant");
      const names = await api.getAllNames();
      expect(names.find((entry) => entry.id === "token")?.unlockVariantIds).toEqual([variantId]);
      expect(names.find((entry) => entry.id === "ore")?.unlockVariantIds).toEqual([]);
    }
  });

  it("blocks deleting a required token before deleting its inventory, then permits deletion after reassignment", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "staff-token", userId: "staff", itemId: "token" }]);
    const api = await callerFor(itemRouter, "staff");
    expect(await api.delete({ id: "token" })).toMatchObject({ success: false, message: expect.stringContaining("Change their required unlock item first") });
    expect(await db.select().from(userItem).where(eq(userItem.id, "staff-token"))).toHaveLength(1);
    await db.update(itemVariant).set({ requiredItemId: null }).where(eq(itemVariant.id, "variant"));
    expect(await api.delete({ id: "token" })).toMatchObject({ success: true });
    expect(await db.select().from(item).where(eq(item.id, "token"))).toHaveLength(0);
  });

  it("retains the required item when a variant starts requiring it before the delete statement", async () => {
    const db = await getTestDatabase();
    await db.update(itemVariant).set({ requiredItemId: null }).where(eq(itemVariant.id, "variant"));
    const api = callerForDatabase(itemRouter, "staff", beforeStatements(db, item, [async () => {
      await db.update(itemVariant).set({ requiredItemId: "token" }).where(eq(itemVariant.id, "variant"));
    }]));
    expect(await api.delete({ id: "token" })).toMatchObject({ success: false, message: expect.stringContaining("Delete incomplete") });
    expect(await db.select().from(item).where(eq(item.id, "token"))).toHaveLength(1);
  });

  it("allows deletion when only the item's own variants require it", async () => {
    const db = await getTestDatabase();
    await db.update(itemVariant).set({ itemId: "token" }).where(eq(itemVariant.id, "variant"));
    expect(await (await callerFor(itemRouter, "staff")).delete({ id: "token" })).toMatchObject({ success: true });
    expect(await db.select().from(itemVariant)).toHaveLength(0);
  });
});
