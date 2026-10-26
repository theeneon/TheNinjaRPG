import { describe, expect, it, vi } from "bun:test";
import { fetchConversation } from "@/server/api/routers/comments";
import type { DrizzleClient } from "@/server/db";

describe("conversation read scheduling", () => {
  it("starts the reader policy before a public title lookup resolves", async () => {
    const conversation = Promise.withResolvers<unknown>();
    const policies = Promise.withResolvers<unknown[]>();
    const findConversation = vi.fn(() => conversation.promise);
    const findPolicies = vi.fn(() => policies.promise);
    const client = {
      query: {
        conversation: { findFirst: findConversation },
        parentalControl: { findMany: findPolicies },
      },
    } as unknown as DrizzleClient;

    const pending = fetchConversation({ client, title: "Global", userId: "reader" });
    const startedTogether = findConversation.mock.calls.length === 1 && findPolicies.mock.calls.length === 1;
    conversation.resolve({ id: "public", isPublic: true, isStaffAvailable: false, users: [] });
    policies.resolve([{ userId: "reader", enabled: true, tavernDisabled: true }]);

    const result = await pending;
    expect(startedTogether).toBe(true);
    expect(result?.readRestriction).toContain("disabled");
    expect(result?.sendRestriction).toBe(result?.readRestriction);
    expect(findPolicies).toHaveBeenCalledTimes(1);
  });
});
