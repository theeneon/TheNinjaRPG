import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterInputs } from "@/app/_trpc/client";
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

beforeEach(() => {
  ensureDom();
  hasLocations = true;
  requests = [];
  response = { success: true, message: "Capabilities saved" };
  holdSave = false;
  finishSave = undefined;
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
async function renderStaff() {
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable(observer => {
    let data: unknown = [];
    if (op.path === "forum.administration") data = {
      canManage: true,
      boards: hasLocations ? [{ id: "board", name: "Strategy", permissions: { moderate: true } }] : [],
      sections: hasLocations ? [{ id: "section", name: "Community" }] : [],
      grants: [], restrictions: [], threads: [], posts: [], cases: [], reports: [],
    };
    if (op.path === "forum.effectivePermissions") data = { username: "Player", boards: [] };
    if (op.path === "forum.saveGrant") {
      requests.push(op.input as RouterInputs["forum"]["saveGrant"]);
      const complete = () => { observer.next({ result: { data: response } }); observer.complete(); };
      if (holdSave) finishSave = complete;
      else complete();
      return;
    }
    observer.next({ result: { data } });
    observer.complete();
  })] });
  const view = render(<testApi.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><ForumManagement /></QueryClientProvider></testApi.Provider>);
  fireEvent.click(await view.findByRole("button", { name: "Staff & permissions" }));
  return view;
}

it("explains a missing player and applies selection and clearing without a second confirmation", async () => {
  const view = await renderStaff();
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
  const view = await renderStaff();
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
  const view = await renderStaff();
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
