import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterInputs } from "@/app/_trpc/client";
import Forum from "@/app/[shell]/forum/page";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
let params: URLSearchParams;
let originalUrl: string;
let queryClient: QueryClient;
let requests: RouterInputs["forum"]["getThreads"][];

beforeEach(() => {
  ensureDom();
  originalUrl = window.location.href;
  params = new URLSearchParams("view=latest&tag=guide&board=board&author=reader&since=2026-01-01&until=2026-12-31");
  requests = [];
  window.history.replaceState(null, "", `/forum?${params}`);
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    replace(data, unused, url);
    params = new URLSearchParams(window.location.search);
  });
  vi.spyOn(navigation, "useSearchParams").mockImplementation(() => params as never);
  Object.assign(vi.spyOn(client, "api" as never), { forum: testApi.forum, useUtils: testApi.useUtils });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { userId: "reader", role: "USER" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(Link, "default").mockImplementation(({ children, href }) => <a href={String(href)}>{children}</a>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", originalUrl);
});

function renderForum() {
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    let data: unknown = [];
    if (op.path === "forum.getAll") data = [{ id: "board", name: "Strategy", permissions: { read: true } }];
    if (op.path === "forum.getContext") data = {};
    if (op.path === "forum.getThreads") {
      const input = op.input as RouterInputs["forum"]["getThreads"];
      requests.push(input);
      data = { threads: [{ id: "topic", boardId: "board", nPosts: 1, updatedAt: new Date("2026-10-28"), title: input.boardId ? "Strategy board guide" : input.tag ? "Guides across boards" : "Latest community discussion" }], nextCursor: undefined };
    }
    observer.next({ result: { data } });
    observer.complete();
  })] });
  const page = () => <testApi.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><Forum /></QueryClientProvider></testApi.Provider>;
  return { ...render(page()), page };
}

it("restores all URL filter defaults on same-view and same-tag navigation and return", async () => {
  const view = renderForum();
  await waitFor(() => expect(requests.at(-1)?.boardId).toBe("board"));
  const filtered = params.toString();
  const navigate = (search: string) => {
    params = new URLSearchParams(search);
    window.history.replaceState(null, "", `/forum?${params}`);
    view.rerender(view.page());
  };
  for (const search of ["view=latest&tag=guide", "view=latest", filtered]) {
    navigate(search);
    const expected = new URLSearchParams(search);
    expect((view.getByLabelText("Post author") as HTMLInputElement).value).toBe(expected.get("author") ?? "");
    expect((view.getByLabelText("Active since") as HTMLInputElement).value).toBe(expected.get("since") ?? "");
    expect((view.getByLabelText("Active until") as HTMLInputElement).value).toBe(expected.get("until") ?? "");
    expect((view.getByLabelText("Board") as HTMLSelectElement).value).toBe(expected.get("board") ?? "");
    const topicTitle = expected.has("board") ? "Strategy board guide" : expected.has("tag") ? "Guides across boards" : "Latest community discussion";
    expect(await view.findByRole("link", { name: topicTitle })).toBeTruthy();
  }
});

it("retains focused controls and unfinished search during debounce, and cancels pending edits on navigation", async () => {
  const view = renderForum();
  await waitFor(() => expect(requests.length).toBe(1));
  const author = view.getByLabelText("Post author") as HTMLInputElement;
  const search = view.getByRole("textbox", { name: "Search forum" }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: "unfinished search" } });
  author.focus();
  fireEvent.change(author, { target: { value: "next reader" } });
  expect(requests.length).toBe(1);
  await waitFor(() => expect(requests.at(-1)?.author).toBe("next reader"));
  expect(view.getByLabelText("Post author")).toBe(author);
  expect(document.activeElement).toBe(author);
  expect(search.value).toBe("unfinished search");
  expect(params.get("author")).toBe("next reader");
  expect(params.has("q")).toBe(false);
  fireEvent.change(author, { target: { value: "pending author" } });
  fireEvent.change(view.getByLabelText("Active since"), { target: { value: "2027-01-01" } });
  params = new URLSearchParams("view=latest&tag=guide");
  window.history.replaceState(null, "", `/forum?${params}`);
  view.rerender(view.page());
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
  expect((view.getByLabelText("Post author") as HTMLInputElement).value).toBe("");
  expect((view.getByLabelText("Active since") as HTMLInputElement).value).toBe("");
  expect(params.toString()).toBe("view=latest&tag=guide");
  expect(requests.at(-1)).toMatchObject({ author: "", boardId: undefined, since: undefined, tag: "guide" });
});
