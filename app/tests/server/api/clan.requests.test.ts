import { beforeEach, expect, it } from "bun:test";
import { clan, userData, userRequest } from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";

describeWithDatabase("clan request visibility", () => {
  beforeEach(async () => {
    await resetTables(userRequest, clan, userData);
    await insertUsers(["leader", "coleader", "member", "applicant", "outsider"].map((userId) => ({ userId, username: userId, clanId: ["leader", "coleader", "member"].includes(userId) ? "clan" : null })));
    const db = await getTestDatabase();
    await db.insert(clan).values({ id: "clan", name: "Clan", image: "", villageId: "v", founderId: "leader", leaderId: "leader", leaderOrderId: "order", coLeader1: "coleader" });
    await db.insert(userRequest).values([
      { id: "join", senderId: "applicant", receiverId: "leader", status: "PENDING", type: "CLAN" },
      { id: "private", senderId: "outsider", receiverId: "member", status: "PENDING", type: "CLAN" },
    ]);
  });

  it.each(["leader", "coleader"])("returns requests to authorized %s without serial clan reads", async (userId) => {
    const caller = await callerFor(clanRouter, userId);
    const measured = await recordQueries(() => caller.getRequests({ clanLeaderId: "leader" }));
    expect(measured.result.map(({ id }) => id)).toEqual(["join"]);
    expect(measured.statements).toHaveLength(2);
  });

  it("discards speculative requests for ordinary clan members", async () => {
    const member = await callerFor(clanRouter, "member");
    expect(await member.getRequests({ clanLeaderId: "leader" })).toEqual([]);
  });

  it("uses the caller's own requests for applicants regardless of the supplied leader", async () => {
    const applicant = await callerFor(clanRouter, "outsider");
    expect((await applicant.getRequests({ clanLeaderId: "leader" })).map(({ id }) => id)).toEqual(["private"]);
  });
});
