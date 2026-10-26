import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/daily-report-embeddings/route";
import * as gamesettings from "@/libs/gamesettings";
import * as reportSearch from "@/libs/moderation/reportSearch";
import { resetServerModuleStubs, stubCronAuth } from "../../setup/serverModules";

beforeEach(() => {
  stubCronAuth(() => null);
});
afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

const setup = (isNewDay: boolean) => {
  const release = vi.fn().mockResolvedValue(true);
  const timer = vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({
    isClaimed: isNewDay,
    isNewDay,
    prevTime: new Date(),
    prevValue: 0,
    update: vi.fn().mockResolvedValue(true),
    release,
    response: Response.json("Already ran"),
  });
  const sweep = vi
    .spyOn(reportSearch, "deleteOrphanedReportEmbeddings")
    .mockResolvedValue(undefined);
  return { timer, release, sweep };
};

it("authenticates before taking the daily timer or scanning embeddings", async () => {
  const { timer, sweep } = setup(true);
  stubCronAuth(() => new Response("Unauthorized", { status: 401 }));
  expect(
    (await GET(new Request("https://example.com/api/daily-report-embeddings"))).status,
  ).toBe(401);
  expect(timer).not.toHaveBeenCalled();
  expect(sweep).not.toHaveBeenCalled();
});

it("sweeps only after winning the daily timer", async () => {
  const { sweep, release } = setup(true);
  expect(
    await (
      await GET(new Request("https://example.com/api/daily-report-embeddings"))
    ).json(),
  ).toBe("OK");
  expect(sweep).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
});

it("skips the sweep when another run already claimed the day", async () => {
  const { sweep } = setup(false);
  expect(
    await (
      await GET(new Request("https://example.com/api/daily-report-embeddings"))
    ).json(),
  ).toBe("Already ran");
  expect(sweep).not.toHaveBeenCalled();
});

it("releases a failed sweep for the next scheduled retry", async () => {
  const { sweep, release } = setup(true);
  sweep.mockRejectedValue(new Error("database timeout"));
  const error = vi
    .spyOn(gamesettings, "handleEndpointError")
    .mockResolvedValue(new Response("Failed", { status: 500 }));
  expect(
    (await GET(new Request("https://example.com/api/daily-report-embeddings"))).status,
  ).toBe(500);
  expect(release).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
});
