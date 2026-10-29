import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import ForumManagement from "@/app/[shell]/forum/manage/page";
import * as ContentBox from "@/layout/ContentBox";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
let queryClient: QueryClient;
let hasLocations: boolean;
let requests: RouterInputs["forum"]["saveGrant"][];
let response: { success: boolean; message: string };
let holdSave: boolean;
let finishSave: (() => void) | undefined;
let reviewPosts: NonNullable<RouterOutputs["forum"]["administration"]>["posts"];
let reviewRequests: { path: string; input: unknown }[];
let canModerate: boolean;
let hasMoreReviews: boolean;

beforeEach(() => {
  ensureDom();
  hasLocations = true;
  requests = [];
  response = { success: true, message: "Capabilities saved" };
  holdSave = false;
  finishSave = undefined;
  reviewPosts = [];
  reviewRequests = [];
  canModerate = true;
  hasMoreReviews = false;
  Object.assign(vi.spyOn(client, "api" as never), { forum: testApi.forum, useUtils: testApi.useUtils });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { userId: "staff", role: "CODING-ADMIN" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(UserSearchSelect, "default").mockImplementation(({ useFormMethods }) => <>
    <button type="button" onClick={() => useFormMethods.setValue("users", [{ userId: "player", username: "Player", avatar: null, federalStatus: "NONE", rank: "STUDENT", level: 1 }])}>Select player</button>
    <button type="button" onClick={() => useFormMethods.setValue("users", [])}>Clear player</button>
  </>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

/** Exercise the actual staff form with controlled application responses and the existing picker contract. */
async function renderManagement(tab = "Staff") {
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable(observer => {
    let data: unknown = [];
    if (op.path === "forum.administration") data = {
      canManage: true,
      boards: hasLocations ? [{ id: "board", name: "Strategy", permissions: { moderate: canModerate, approve: true, removeOthers: canModerate } }] : [],
      sections: hasLocations ? [{ id: "section", name: "Community" }] : [],
      grants: [], restrictions: [], threads: [], posts: reviewPosts, linkedReports: [], logs: [], hasMoreReviews,
    };
    if (op.path === "forum.effectivePermissions") data = { username: "Player", boards: [] };
    if (op.path === "forum.saveGrant" || op.path === "forum.reviewCase" || op.path === "forum.moderatePost") {
      if (op.path === "forum.saveGrant") requests.push(op.input as RouterInputs["forum"]["saveGrant"]);
      else reviewRequests.push({ path: op.path, input: op.input });
      const complete = () => { observer.next({ result: { data: response } }); observer.complete(); };
      if (holdSave) finishSave = complete;
      else complete();
      return;
    }
    observer.next({ result: { data } });
    observer.complete();
  })] });
  const view = render(<testApi.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><ForumManagement /></QueryClientProvider></testApi.Provider>);
  const target = await view.findByRole("button", { name: tab });
  if (tab !== "Review queue") fireEvent.click(target);
  return view;
}

it("explains a missing player and applies selection and clearing without a second confirmation", async () => {
  const view = await renderManagement();
  const save = view.getByRole("button", { name: "Save capabilities" }) as HTMLButtonElement;
  const hint = view.getByText("Select a player before saving capabilities.");
  expect(save.disabled).toBe(true);
  expect(save.getAttribute("aria-describedby")).toBe(hint.id);
  fireEvent.change(view.getByLabelText("Reason for the audit log"), { target: { value: "Support moderation" } });
  fireEvent.submit(save.closest("form")!);
  expect(requests).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Select player" }));
  await waitFor(() => expect(save.disabled).toBe(false));
  expect(await view.findByText("Selected: Player")).toBeTruthy();
  expect(view.queryByText("Select a player before saving capabilities.")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Clear player" }));
  await waitFor(() => expect(save.disabled).toBe(true));
  expect(view.getByText("Select a player before saving capabilities.")).toBeTruthy();
  fireEvent.submit(save.closest("form")!);
  expect(requests).toHaveLength(0);
});

it("explains missing locations and trimmed audit reasons, and permits a valid global assignment", async () => {
  hasLocations = false;
  const view = await renderManagement();
  const save = view.getByRole("button", { name: "Save capabilities" }) as HTMLButtonElement;
  fireEvent.click(view.getByRole("button", { name: "Select player" }));
  expect(await view.findByText("Select a board before saving capabilities.")).toBeTruthy();
  fireEvent.submit(save.closest("form")!);
  expect(requests).toHaveLength(0);
  fireEvent.change(view.getByLabelText("Scope"), { target: { value: "SECTION" } });
  expect(view.getByText("Select a section before saving capabilities.")).toBeTruthy();
  fireEvent.change(view.getByLabelText("Scope"), { target: { value: "GLOBAL" } });
  const reason = view.getByLabelText("Reason for the audit log");
  fireEvent.change(reason, { target: { value: "   " } });
  expect(view.getByText("Enter an audit reason with at least 3 characters.")).toBeTruthy();
  expect(save.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: "Global support" } });
  expect(save.disabled).toBe(false);
  fireEvent.submit(save.closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ userId: "player", scope: "GLOBAL", scopeId: "*", reason: "Global support", remove: false });
});

it("retains rejected edits, explains a pending save and prevents duplicate submissions", async () => {
  const view = await renderManagement();
  fireEvent.click(view.getByRole("button", { name: "Select player" }));
  const reason = view.getByLabelText("Reason for the audit log") as HTMLInputElement;
  fireEvent.change(reason, { target: { value: "Support moderation" } });
  const form = view.getByRole("button", { name: "Save capabilities" }).closest("form")!;
  response = { success: false, message: "Access changed. Try again." };
  fireEvent.submit(form);
  expect((await view.findByRole("alert")).textContent).toBe("Access changed. Try again.");
  expect(reason.value).toBe("Support moderation");
  response = { success: true, message: "Capabilities saved" };
  holdSave = true;
  fireEvent.submit(form);
  const pending = await view.findByRole("button", { name: "Saving…" }) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  expect(pending.getAttribute("aria-busy")).toBe("true");
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.submit(form);
  expect(requests).toHaveLength(2);
  await act(async () => { finishSave!(); });
  await waitFor(() => expect(reason.value).toBe(""));
  expect(view.getByText("Enter an audit reason with at least 3 characters.")).toBeTruthy();
});

/** Supply only the post state that determines the application's moderation choices. */
function queuedPost(id = "post", overrides: Partial<(typeof reviewPosts)[number]["post"]> = {}): (typeof reviewPosts)[number] {
  return {
    post: { id, content: `<p>Evidence for ${id}</p>`, isApproved: true, isReported: true, deletedAt: null, ...overrides },
    thread: { id: "topic", title: `Review ${id}`, boardId: "board", isApproved: true },
    review: null, assigneeName: null,
  } as (typeof reviewPosts)[number];
}

it("shows a compact queue without empty sections, global decision fields or unnecessary pagination", async () => {
  reviewPosts = [queuedPost()];
  const view = await renderManagement("Review queue");
  expect(view.queryByRole("navigation", { name: "Review pages" })).toBeNull();
  expect(view.queryByRole("region", { name: "Topics to review" })).toBeNull();
  expect(view.getByRole("region", { name: "Posts to review" })).toBeTruthy();
  expect(view.getByLabelText("Reason for the audit log").closest("details")?.open).toBe(false);
  expect(view.queryByText("Choose a reviewer")).toBeNull();
  expect(view.getByRole("link", { name: "Player reports" }).getAttribute("href")).toBe("/reports");
  expect(view.getByRole("button", { name: "Review queue" }).getAttribute("aria-pressed")).toBe("true");
});

it("keeps decision fields and feedback local to the opened post", async () => {
  reviewPosts = [queuedPost("first"), queuedPost("second")];
  const view = await renderManagement("Review queue");
  const first = view.getByText("Review first").closest("details")!;
  const second = view.getByText("Review second").closest("details")!;
  fireEvent.click(first.querySelector("summary")!);
  fireEvent.click(second.querySelector("summary")!);
  fireEvent.change(within(first).getByLabelText("Reason for the audit log"), { target: { value: "Investigating flag" } });
  expect((within(first).getByRole("button", { name: "Claim review" }) as HTMLButtonElement).disabled).toBe(false);
  expect((within(second).getByRole("button", { name: "Claim review" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(second).getByLabelText("Reason for the audit log") as HTMLInputElement).value).toBe("");
  const disabled = within(second).getByRole("button", { name: "Claim review" });
  expect(disabled.getAttribute("aria-describedby")).toBe(within(second).getByRole("status").id);
});

it.each([
  ["CLAIM", "IN_REVIEW", "staff"],
  ["ASSIGN", "IN_REVIEW", "player"],
  ["RESOLVE", "RESOLVED", "staff"],
  ["REOPEN", "OPEN", "owner"],
])("submits the scoped %s review decision with its own reason and assignee", async (action, status, assigneeId) => {
  const entry = queuedPost();
  if (action === "REOPEN") entry.review = { status: "RESOLVED", assigneeId: "owner" } as NonNullable<typeof entry.review>;
  reviewPosts = [entry];
  const view = await renderManagement("Review queue");
  fireEvent.click(view.getByText("Review post").closest("summary")!);
  fireEvent.change(view.getByLabelText("Action"), { target: { value: action } });
  fireEvent.change(view.getByLabelText("Reason for the audit log"), { target: { value: "Investigating flag" } });
  if (action === "ASSIGN") {
    expect(view.getByText("Select a reviewer to continue.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Select player" }));
    await waitFor(() => expect(view.queryByText("Select a reviewer to continue.")).toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Clear player" }));
    await waitFor(() => expect(view.getByText("Select a reviewer to continue.")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Select player" }));
    await waitFor(() => expect(view.queryByText("Select a reviewer to continue.")).toBeNull());
  } else expect(view.queryByRole("button", { name: "Select player" })).toBeNull();
  fireEvent.submit(view.getByLabelText("Action").closest("form")!);
  await waitFor(() => expect(reviewRequests).toEqual([{ path: "forum.reviewCase", input: { postId: "post", assigneeId, status, reason: "Investigating flag" } }]));
});

it.each(["APPROVE", "RESTORE", "DISMISS_REPORT", "REMOVE"])("retains the %s content action and its existing tRPC contract", async (action) => {
  reviewPosts = [queuedPost("post", action === "APPROVE" ? { isApproved: false } : action === "RESTORE" ? { deletedAt: new Date() } : {})];
  const view = await renderManagement("Review queue");
  fireEvent.click(view.getByText("Review post").closest("summary")!);
  fireEvent.change(view.getByLabelText("Action"), { target: { value: action } });
  fireEvent.change(view.getByLabelText("Reason for the audit log"), { target: { value: "Forum policy decision" } });
  fireEvent.submit(view.getByLabelText("Action").closest("form")!);
  await waitFor(() => expect(reviewRequests).toEqual([{ path: "forum.moderatePost", input: { postId: "post", action, reason: "Forum policy decision" } }]));
});

it("limits approval staff to permitted actions and explains an empty queue", async () => {
  canModerate = false;
  reviewPosts = [queuedPost("post", { isApproved: false })];
  const view = await renderManagement("Review queue");
  fireEvent.click(view.getByText("Review post").closest("summary")!);
  expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual(["Approve post"]);
  reviewPosts = [];
  await act(async () => { await queryClient.invalidateQueries(); });
  expect(await view.findByText("No topics or posts to review on this page.")).toBeTruthy();
  expect(view.queryByRole("region", { name: "Posts to review" })).toBeNull();
});

it("retains rejected decisions for retry, shows pending state and guards duplicate submissions", async () => {
  reviewPosts = [queuedPost()];
  const view = await renderManagement("Review queue");
  fireEvent.click(view.getByText("Review post").closest("summary")!);
  const reason = view.getByLabelText("Reason for the audit log") as HTMLInputElement;
  const form = reason.closest("form")!;
  fireEvent.change(reason, { target: { value: "   " } });
  fireEvent.submit(form);
  expect(reviewRequests).toHaveLength(0);
  fireEvent.change(reason, { target: { value: "Investigating flag" } });
  response = { success: false, message: "Access changed. Try again." };
  fireEvent.submit(form);
  expect((await view.findByRole("alert")).textContent).toBe("Access changed. Try again.");
  expect(reason.value).toBe("Investigating flag");
  holdSave = true;
  response = { success: true, message: "Review saved" };
  fireEvent.submit(form);
  const saving = await view.findByRole("button", { name: "Saving…" }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.submit(form);
  expect(reviewRequests).toHaveLength(2);
  await act(async () => { finishSave!(); });
  await waitFor(() => expect(reason.value).toBe(""));
});

it("keeps paging available when there is another page or a previous page", async () => {
  hasMoreReviews = true;
  const view = await renderManagement("Review queue");
  const next = view.getByRole("button", { name: "Next" });
  hasMoreReviews = false;
  fireEvent.click(next);
  expect(await view.findByText("Page 2")).toBeTruthy();
  await waitFor(() => expect((view.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(false));
  expect((view.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(view.queryByRole("navigation", { name: "Review pages" }) === null).toBe(true));
});
