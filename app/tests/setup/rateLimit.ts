import { vi } from "bun:test";

/** Answer the rate limiter's Upstash commands, including pipelined requests. */
export const rateLimitResponse = (init?: RequestInit): Response | null => {
  if (typeof init?.body !== "string" || !init.body.includes("trpc-ratelimit"))
    return null;
  const commands = JSON.parse(init.body) as unknown[];
  const resultFor = (command: unknown[]) => ({
    result: command[0] === "evalsha" || command[0] === "eval" ? [59, 60] : 1,
  });
  return Response.json(
    Array.isArray(commands[0])
      ? commands.map((command) => resultFor(command as unknown[]))
      : resultFor(commands),
  );
};

/** Keep middleware active while replacing only its Redis transport. Restore with vi.restoreAllMocks(). */
export const stubRateLimitTransport = (
  options: { unexpectedRequestMessage?: string } = {},
) => {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = rateLimitResponse(init);
    if (response) return response;
    if (options.unexpectedRequestMessage)
      throw new Error(options.unexpectedRequestMessage);
    return realFetch(input, init);
  });
};
