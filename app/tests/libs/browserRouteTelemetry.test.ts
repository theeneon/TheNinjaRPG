import { describe, expect, it } from "bun:test";
import { readdir } from "node:fs/promises";
import { BrowserClient, resolveCurrentRoute, resolveRoute } from "@sentry/browser";
import {
  createPublicBrowserRouteProvider,
  PUBLIC_PAGE_ROUTES,
  toPublicRouteTemplate,
} from "@/libs/browserRouteTelemetry";

const origin = "https://www.theninja-rpg.com";

describe("public browser route labels", () => {
  it("covers every page and has no obsolete routes", async () => {
    const root = new URL("../../src/app/[shell]/", import.meta.url);
    const files = await readdir(root, { recursive: true });
    const routes = files.filter((file) => file === "page.tsx" || file.endsWith("/page.tsx"))
      .map((file) => "/" + file.replace(/(^|\/)page\.tsx$/, ""));
    expect<string[]>([...PUBLIC_PAGE_ROUTES].sort()).toEqual(routes.sort());
    for (const route of routes) {
      const sample = route.replace(/\[\[\.\.\.[^\]]+\]\]/g, "one/two")
        .replace(/\[\.\.\.[^\]]+\]/g, "one/two")
        .replace(/\[[^\]]+\]/g, "private-value");
      expect(toPublicRouteTemplate(sample)).toBe(route);
    }
  });

  it.each([
    ["/profile", "/profile"],
    ["/profile/experience", "/profile/experience"],
    ["/username/Player", "/username/[username]"],
    ["/userid/user_123", "/userid/[userid]"],
    ["/battlelog/abc", "/battlelog/[battleid]"],
    ["/forum/board/thread", "/forum/[boardid]/[threadid]"],
    ["/users/ipsearch/1.2.3.4", "/users/ipsearch/[ip]"],
    ["/support/create", "/support/create"],
    ["/support/private-ticket", "/support/[ticketId]"],
    ["/manual/item/balance", "/manual/item/balance"],
    ["/manual/ai/edit/placements", "/manual/ai/edit/[aiid]"],
    ["/manual/item/private-item", "/manual/item/[itemid]"],
    ["/manual/damage_calcs", "/manual/damage_calcs/[[...damageSimulationId]]"],
    ["/manual/damage_calcs/private/id", "/manual/damage_calcs/[[...damageSimulationId]]"],
    ["/login", "/login/[[...rest]]"],
    ["/login/factor-one/token", "/login/[[...rest]]"],
    ["/username/Player%2FName/?token=secret#secret", "/username/[username]"],
    ["/web-pixel-in/profile/", "/profile"],
    ["https://www.theninja-rpg.com/profile?user=private#private", "/profile"],
    ["/unrecognized/private", "/[unmatched]"],
    ["/private-username", "/[unmatched]"],
    ["http://[invalid", "/[unmatched]"],
  ])("maps %s to %s", (href, expected) => {
    expect(toPublicRouteTemplate(href)).toBe(expected);
  });
});

describe("Sentry public route provider", () => {
  const setup = () => {
    let location = origin + "/home";
    const client = new BrowserClient({
      dsn: "https://public@example.com/1",
      integrations: [],
      stackParser: () => [],
      transport: () => ({ send: () => Promise.resolve({}), flush: () => Promise.resolve(true) }),
      routeProvider: createPublicBrowserRouteProvider(() => location),
    });
    return { client, setLocation: (href: string) => { location = origin + href; } };
  };

  it("resolves a navigation destination while the browser still shows its source", () => {
    const { client } = setup();
    expect(resolveCurrentRoute(client)).toBe("/home");
    expect(resolveRoute(origin + "/profile?private=value", client)).toBe("/profile");
    expect(resolveCurrentRoute(client)).toBe("/home");
  });

  it("resolves previously captured URLs after a later navigation", () => {
    const { client, setLocation } = setup();
    const captured = new URL(origin + "/username/Private?token=secret");
    setLocation("/bank");
    expect(resolveRoute(captured, client)).toBe("/username/[username]");
    expect(resolveCurrentRoute(client)).toBe("/bank");
  });

  it("handles successive targets and committed back/forward locations without pending state", () => {
    const { client, setLocation } = setup();
    expect(resolveRoute(origin + "/combat", client)).toBe("/combat");
    expect(resolveRoute(origin + "/hospital", client)).toBe("/hospital");
    expect(resolveCurrentRoute(client)).toBe("/home");
    setLocation("/profile");
    expect(resolveCurrentRoute(client)).toBe("/profile");
    setLocation("/home");
    expect(resolveCurrentRoute(client)).toBe("/home");
  });

  it("keeps unmatched paths in a bounded label through the SDK", () => {
    const { client, setLocation } = setup();
    expect(resolveRoute(origin + "/unknown/private-id", client)).toBe("/[unmatched]");
    setLocation("/unknown-user");
    expect(resolveCurrentRoute(client)).toBe("/[unmatched]");
  });
});
