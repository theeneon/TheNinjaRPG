"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useTransition } from "react";
import { NavigationRouterContext } from "@/hooks/navigation";
import { NavigationProgress } from "@/layout/NavigationProgress";

/** Own transitions above menus and pages so closing their source cannot lose feedback. */
export const NavigationProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const navigationRouter = useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        startTransition(() => router.push(...args)),
      replace: (...args: Parameters<typeof router.replace>) =>
        startTransition(() => router.replace(...args)),
    }),
    [router, startTransition],
  );
  return (
    <NavigationRouterContext value={navigationRouter}>
      {children}
      <NavigationProgress pending={isPending} />
    </NavigationRouterContext>
  );
};
