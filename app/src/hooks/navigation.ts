"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";

export const NavigationRouterContext = createContext<ReturnType<
  typeof useRouter
> | null>(null);

/** Use the shell's transition lifetime, including when a menu or action unmounts. */
export const useNavigationRouter = () => {
  const sharedRouter = useContext(NavigationRouterContext);
  const router = useRouter();
  return sharedRouter ?? router;
};
