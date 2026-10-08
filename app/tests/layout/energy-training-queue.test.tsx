import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnergyTrainingQueue } from "@/layout/EnergyTrainingQueue";
import type { UserWithRelations } from "@/routers/profile";
import { ensureDom } from "../setup-dom.mjs";

type Result = { success: boolean; message: string };
type QueueCallbacks = {
  onSuccess: (result: Result) => void;
  onError: (error: Error) => void;
  onSettled: (
    result: Result | undefined,
    error: Error | null,
    variables: { entries: unknown[]; guess?: string },
  ) => Promise<void>;
};
type QueueMocks = {
  invalidate: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  callbacks: QueueCallbacks | null;
};
function testMocks(): QueueMocks {
  const globals = globalThis as typeof globalThis & { __energyQueueMocks?: QueueMocks };
  globals.__energyQueueMocks ??= {
    invalidate: vi.fn(async () => undefined),
    mutate: vi.fn(),
    callbacks: null,
  };
  return globals.__energyQueueMocks;
}
const mocks = testMocks();
vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({ profile: { getUser: { invalidate: testMocks().invalidate } } }),
    train: {
      updateEnergyTrainingQueue: {
        useMutation: (callbacks: QueueCallbacks) => {
          testMocks().callbacks = callbacks;
          return { mutate: testMocks().mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock("@/layout/ContentBox", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/libs/toast", () => ({ showMutationToast: vi.fn() }));

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
});
afterEach(cleanup);

const user = {
  maxEnergy: 100,
  status: "AWAKE",
  isOutlaw: true,
  federalStatus: "GOLD",
  staffAccount: false,
  energyTrainingQueue: [],
} as unknown as NonNullable<UserWithRelations>;

describe("Energy queue captcha recovery", () => {
  it.each([
    { success: true, message: "Training queue saved" },
    { success: false, message: "Invalid captcha" },
  ])(
    "refreshes a consumed captcha after $message so another edit can proceed",
    async (result) => {
      let guess = "first challenge";
      const refreshCaptcha = vi.fn(async () => {
        guess = "next challenge";
      });
      const view = render(
        <EnergyTrainingQueue
          user={user}
          availableEnergy={100}
          getGuess={() => guess}
          refreshCaptcha={refreshCaptcha}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Add to queue" }));
      expect(mocks.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ guess: "first challenge" }),
      );
      await act(async () => {
        mocks.callbacks?.onSuccess(result);
        await mocks.callbacks?.onSettled(result, null, mocks.mutate.mock.lastCall?.[0]);
      });
      expect(refreshCaptcha).toHaveBeenCalledTimes(1);
      expect(mocks.invalidate).toHaveBeenCalledTimes(1);
      fireEvent.click(view.getByRole("button", { name: "Add to queue" }));
      expect(mocks.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ guess: "next challenge" }),
      );
      if (!result.success)
        expect(view.getByRole("alert").textContent).toBe("Invalid captcha");
    },
  );

  it("recovers when the write throws after consuming the captcha", async () => {
    const refreshCaptcha = vi.fn(async () => undefined);
    const view = render(
      <EnergyTrainingQueue
        user={user}
        availableEnergy={100}
        getGuess={() => "answer"}
        refreshCaptcha={refreshCaptcha}
      />,
    );
    await act(async () => {
      mocks.callbacks?.onError(new Error("Write failed"));
      await mocks.callbacks?.onSettled(undefined, new Error("Write failed"), {
        entries: [{ stat: "offence", energy: 100 }],
        guess: "answer",
      });
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("Write failed"),
    );
    expect(refreshCaptcha).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it("preserves the captcha answer when clearing the queue without validation", async () => {
    const refreshCaptcha = vi.fn(async () => undefined);
    const view = render(
      <EnergyTrainingQueue
        user={{ ...user, energyTrainingQueue: [{ stat: "offence", energy: 100 }] }}
        availableEnergy={0}
        getGuess={() => "answer"}
        refreshCaptcha={refreshCaptcha}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Clear queue" }));
    await act(async () => {
      await mocks.callbacks?.onSettled(
        { success: true, message: "Training queue cleared" },
        null,
        mocks.mutate.mock.lastCall?.[0],
      );
    });
    expect(refreshCaptcha).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
});
