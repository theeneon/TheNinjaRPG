import * as clerk from "@clerk/nextjs";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import * as trpc from "@trpc/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { type ContextType, useContext } from "react";
import * as client from "@/app/_trpc/client";
import * as pusher from "@/layout/PusherHandler";
import { UserContext, UserContextProvider } from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const BASE = Date.UTC(2026, 9, 26, 12);
const key: ReturnType<typeof trpc.getQueryKey> = [
  ["profile", "getUser"],
  { type: "query" },
];
let now = BASE;
const snapshot = (serverTime = BASE - 100) => ({
  serverTime,
  userData: {
    userId: "sharing-test",
    username: "Sharing",
    status: "AWAKE",
    updatedAt: new Date(BASE - 60_000),
    regenAt: new Date(BASE - 30_000),
    money: 100,
    village: { id: "village", createdAt: new Date(BASE - 86_400_000) },
    userQuests: [{ id: "quest", endAt: new Date(BASE + 60_000) }],
  },
  achievementProgress: [{ id: "achievement", updatedAt: new Date(BASE - 1000) }],
  notifications: [{ href: "/shrine", name: "Active boost", color: "green" }],
});
type Snapshot = ReturnType<typeof snapshot>;
const clients: QueryClient[] = [];

beforeEach(() => {
  now = BASE;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(trpc, "getQueryKey").mockReturnValue(key);
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isSignedIn: true,
    isLoaded: true,
    user: { id: "sharing-test" },
  } as never);
  vi.spyOn(pusher, "usePusherHandler").mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

const mount = (initial = snapshot()) => {
  let response = initial;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  queryClient.setQueryData(key, initial);
  const utils = {};
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => utils,
    profile: {
      getUser: {
        // Exercise the provider's query options with a real TanStack cache and observer.
        useQuery: (_input: undefined, options: UseQueryOptions<Snapshot>) =>
          useQuery({ ...options, queryKey: key, queryFn: async () => response }),
      },
    },
  });
  const seen: ContextType<typeof UserContext>[] = [];
  const Consumer = () => {
    seen.push(useContext(UserContext));
    return null;
  };
  render(
    <QueryClientProvider client={queryClient}>
      <UserContextProvider initialIsSignedIn>
        <Consumer />
      </UserContextProvider>
    </QueryClientProvider>,
  );
  const settle = async (action: () => Promise<unknown>) => {
    await act(async () => {
      await action();
      // TanStack batches observer notifications through a scheduled task.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return {
    queryClient,
    seen,
    current: () => seen.at(-1)!,
    read: () => queryClient.getQueryData<Snapshot>(key)!,
    refresh: async (next: Snapshot) => {
      response = next;
      await settle(() => queryClient.refetchQueries({ queryKey: key }));
    },
    settle,
  };
};

describe("profile context structural sharing", () => {
  it("does not fan out unchanged refetches with equal Dates and subsecond clock jitter", async () => {
    const test = mount();
    const before = test.current();
    const renders = test.seen.length;
    for (const latency of [125, 250, 50]) {
      now += 300_000;
      await test.refresh(snapshot(now - latency));
      expect(test.current()).toBe(before);
      expect<unknown>(test.read().userData).toBe(before.data);
      expect<unknown>(test.read().achievementProgress).toBe(before.achievementProgress);
    }
    expect(test.seen.length - renders).toBe(0);
    expect(test.current().timeDiff).toBe(0);
  });

  it("keeps server timestamps immutable across repeated responses and clock corrections", async () => {
    const initial = snapshot(BASE - 5000);
    Object.freeze(initial.userData);
    const test = mount(initial);
    expect(test.current().timeDiff).toBe(5000);
    expect(test.read().userData.updatedAt.getTime()).toBe(BASE - 60_000);
    now += 300_000;
    await test.refresh(snapshot(now - 5200));
    expect(test.current().timeDiff).toBe(5000);
    now += 300_000;
    await test.refresh(snapshot(now - 6000));
    expect(test.current().timeDiff).toBe(6000);
    now += 300_000;
    await test.refresh(snapshot(now + 2000));
    expect(test.current().timeDiff).toBe(-2000);
    expect(test.read().userData.updatedAt.getTime()).toBe(BASE - 60_000);
  });

  it("propagates changed nested Dates, achievements and expired notifications independently", async () => {
    const test = mount();
    const before = test.read();
    const changed = snapshot(BASE - 50);
    changed.userData.userQuests[0]!.endAt = new Date(BASE + 120_000);
    await test.refresh(changed);
    expect(test.current().data).not.toBe(before.userData);
    expect(test.read().userData.userQuests).not.toBe(before.userData.userQuests);
    expect(test.read().userData.village).toBe(before.userData.village);
    expect<unknown>(test.current().achievementProgress).toBe(before.achievementProgress);

    const achievement = structuredClone(changed);
    achievement.achievementProgress[0]!.updatedAt = new Date(BASE);
    await test.refresh(achievement);
    const afterAchievement = test.current();
    expect(afterAchievement.achievementProgress).not.toBe(before.achievementProgress);
    expect<unknown>(afterAchievement.data).toBe(test.read().userData);

    await test.refresh({ ...achievement, notifications: [] });
    expect(test.current()).not.toBe(afterAchievement);
    expect(test.current().data).toBe(afterAchievement.data);
    expect(test.current().achievementProgress).toBe(afterAchievement.achievementProgress);
    expect(test.current().notifications).toEqual([]);
  });

  it("advances cache revisions for equal reads and preserves confirmed mutation patches", async () => {
    const test = mount();
    const revision = prepareUserUpdate(test.queryClient, key);
    await test.refresh(snapshot(BASE - 50));
    expect(prepareUserUpdate(test.queryClient, key)).toBe(revision! + 1);
    const currentRevision = prepareUserUpdate(test.queryClient, key);
    const before = test.read();
    await test.settle(() =>
      updateUserCache(test.queryClient, key, { money: 90 }, { revision: currentRevision }),
    );
    expect(test.current().data?.money).toBe(90);
    expect(test.read().userData.village).toBe(before.userData.village);
    expect(test.read().userData.updatedAt).toBe(before.userData.updatedAt);

    // A delayed delta must refresh after a completed read, even when its data was equal.
    const stale = prepareUserUpdate(test.queryClient, key);
    await test.refresh(snapshot(BASE - 25));
    await test.settle(() =>
      updateUserCache(test.queryClient, key, undefined, { revision: stale, delta: { money: -10 } }),
    );
    expect(test.current().data?.money).toBe(100);
  });
});
