import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import { EpidemicSfxSearch } from "@/layout/EpidemicSfxSearch";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

type Result = { success: boolean; message: string; assetId?: string };
type Callbacks = { onMutate: () => void; onSuccess: (result: Result) => Promise<void>; onError: (error: Error) => void; onSettled: () => void };
const request = vi.fn(async (_input: unknown): Promise<Result> => ({ success: true, message: "Imported", assetId: "new-sound" }));
const invalidate = vi.fn(async () => undefined);

beforeEach(() => {
  ensureDom(); request.mockReset(); invalidate.mockClear();
  request.mockResolvedValue({ success: true, message: "Imported", assetId: "new-sound" });
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: { role: "CONTENT" } } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ gameAsset: { getAll: { invalidate } }, misc: { getAllGameAssetNames: { invalidate } } }),
    contentReview: {
      searchSfx: { useQuery: ({ term }: {term: string}) => ({ data: term ? { configured: true, results: [{ id: "catalog-sound", title: "Fiery whoosh", lengthMs: 1000 }] } : undefined, isFetching: false }) },
      importSfx: { useMutation: function useImport(callbacks: Callbacks) {
        const [isPending, setPending] = useState(false);
        const [variables, setVariables] = useState<{epidemicId: string} | undefined>();
        return { isPending, variables, mutate: (input: {epidemicId: string}) => {
          setPending(true); setVariables(input); callbacks.onMutate();
          void (async () => {
            try { await callbacks.onSuccess(await request(input)); }
            catch (error) { callbacks.onError(error as Error); }
            finally { callbacks.onSettled(); setPending(false); }
          })();
        } };
      } },
    },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const search = (onImported: (assetId: string) => void | Promise<void> = vi.fn(async () => undefined)) => {
  const view = render(<EpidemicSfxSearch onImported={onImported} />);
  fireEvent.change(view.getByRole("textbox"), { target: { value: "fire" } });
  fireEvent.click(view.getByRole("button", { name: "Search sounds" }));
  return { view, onImported };
};

describe("sound library import recovery", () => {
  it("blocks duplicate clicks and stays pending until the library callback completes", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const onImported = vi.fn(async () => gate);
    const { view } = search(onImported);
    act(() => { fireEvent.click(view.getByRole("button", { name: /^Use this/ })); fireEvent.click(view.getByRole("button", { name: /^Use this/ })); });
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("new-sound"));
    expect(request).toHaveBeenCalledTimes(1); expect(invalidate).toHaveBeenCalledTimes(2);
    expect((view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    await waitFor(() => expect((view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("explains exhausted provider quota and permits a retry without navigating", async () => {
    request.mockRejectedValueOnce(new Error('Epidemic Sound download responded 402: {"message":"Download quota exceeded"}'));
    const { view, onImported } = search();
    fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("download limit"));
    expect(view.getByRole("alert").textContent).not.toContain("/v0/");
    expect(onImported).not.toHaveBeenCalled();
    expect((view.getByRole("button", { name: /^Use this/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("new-sound"));
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("displays an expected server rejection beside the import controls", async () => {
    request.mockResolvedValueOnce({ success: false, message: "Your content permissions changed." });
    const { view, onImported } = search();
    fireEvent.click(view.getByRole("button", { name: /^Use this/ }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Your content permissions changed."));
    expect(onImported).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
});
