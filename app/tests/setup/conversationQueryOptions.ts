import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InfiniteData, InfiniteQueryObserverOptions } from "@tanstack/react-query";

// Exercise the hooks' actual options so removing a cache or lifecycle option fails behavior tests.
export const conversationQueryOptions = <TPage>(file: string) => {
  const source = readFileSync(join(import.meta.dirname, "../../src/layout", file), "utf8");
  const expression = source.match(/api\.comments\.getConversationComments\.useInfiniteQuery\(queryKey,\s*(\{[\s\S]*?\})\)/)?.[1];
  if (!expression) throw new Error(`Chat query options were not found in ${file}`);
  return new Function("props", "conversationId", `return (${expression});`)(
    { convo_id: "chat" }, "chat",
  ) as Omit<InfiniteQueryObserverOptions<TPage, Error, InfiniteData<TPage>>, "queryKey" | "queryFn" | "initialPageParam">;
};
