import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as next from "next/server";
import { deferModeration } from "@/libs/moderation/defer";
import * as moderator from "@/libs/moderator";
import type { DrizzleClient } from "@/server/db";

const callbacks: Array<() => unknown> = [];
const client = {} as DrizzleClient;
const info = {
  content: "A normal game conversation", userId: "poster", relationId: "post",
  relationType: "comment" as const, contextId: "conversation",
};

beforeEach(() => {
  callbacks.length = 0;
  vi.spyOn(next, "after").mockImplementation((callback) => {
    callbacks.push(callback as () => unknown);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("deferred moderation", () => {
  it("retains pending provider work until the after callback finishes", async () => {
    let finish!: () => void;
    const provider = new Promise<void>((resolve) => { finish = resolve; });
    const moderate = vi.spyOn(moderator, "moderateContent").mockReturnValue(provider);
    const before = Date.now();
    expect(deferModeration(client, info)).toBeUndefined();
    expect(moderate).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    let completed = false;
    const running = Promise.resolve(callbacks[0]!()).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    const captured = moderate.mock.calls[0]![1];
    expect(captured).toMatchObject(info);
    expect(captured.createdAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(captured.createdAt!.getTime()).toBeLessThanOrEqual(Date.now());
    finish();
    await running;
    expect(completed).toBe(true);
  });

  it("preserves an edited post's original context timestamp", async () => {
    const moderate = vi.spyOn(moderator, "moderateContent").mockResolvedValue(undefined);
    const createdAt = new Date("2026-01-01T00:00:00Z");
    deferModeration(client, { ...info, createdAt });
    await callbacks[0]!();
    expect(moderate).toHaveBeenCalledWith(client, { ...info, createdAt });
  });

  it("captures provider and database failures without rejecting the background task", async () => {
    const failure = new Error("Moderation unavailable");
    vi.spyOn(moderator, "moderateContent").mockRejectedValue(failure);
    const capture = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    deferModeration(client, info);
    await expect(Promise.resolve(callbacks[0]!())).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledWith(failure, {
      tags: { source: "deferredModeration", relationType: "comment" },
      extra: { relationId: "post" },
    });
  });
});
