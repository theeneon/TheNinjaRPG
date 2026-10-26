"use client";

import NextLink from "next/link";
import { type ComponentProps, useContext, useEffect, useRef, useState } from "react";
import { NavigationRouterContext } from "@/hooks/navigation";

/**
 * Keep viewport prefetch off: the frame has twenty or more links, and each speculative
 * request invokes the proxy. Warm only a destination the visitor shows intent to open.
 * An explicit prefetch prop overrides this policy, including false to opt out entirely.
 */
const Link = ({
  prefetch,
  children,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onTouchStart,
  onClick,
  onNavigate,
  ...props
}: ComponentProps<typeof NextLink>) => {
  const hrefKey =
    typeof props.href === "string" ? props.href : JSON.stringify(props.href);
  const [intentHref, setIntentHref] = useState<string | null>(null);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationRouter = useContext(NavigationRouterContext);
  const clickedHref = useRef<string | null>(null);

  const cancelDwell = () => {
    if (dwellTimer.current !== null) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  };
  useEffect(() => cancelDwell, [hrefKey]);

  const canPrefetch = (link: HTMLAnchorElement) =>
    prefetch === undefined &&
    !link.hasAttribute("download") &&
    (!link.target || link.target === "_self") &&
    link.origin === window.location.origin &&
    `${link.pathname}${link.search}` !==
      `${window.location.pathname}${window.location.search}`;

  return (
    <NextLink
      {...props}
      prefetch={
        prefetch === undefined ? (intentHref === hrefKey ? null : false) : prefetch
      }
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        cancelDwell();
        if (
          !event.defaultPrevented &&
          event.pointerType !== "touch" &&
          canPrefetch(event.currentTarget)
        ) {
          dwellTimer.current = setTimeout(() => setIntentHref(hrefKey), 200);
        }
      }}
      onPointerLeave={(event) => {
        cancelDwell();
        onPointerLeave?.(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented && canPrefetch(event.currentTarget))
          setIntentHref(hrefKey);
      }}
      onBlur={(event) => {
        cancelDwell();
        onBlur?.(event);
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        if (!event.defaultPrevented && canPrefetch(event.currentTarget))
          setIntentHref(hrefKey);
      }}
      onClick={(event) => {
        clickedHref.current = event.currentTarget.href;
        onClick?.(event);
      }}
      onNavigate={(event) => {
        let isPrevented = false;
        onNavigate?.({
          preventDefault: () => {
            isPrevented = true;
            event.preventDefault();
          },
        });
        if (isPrevented || !navigationRouter || !clickedHref.current) return;
        // Next has already excluded downloads, external URLs and modified clicks here.
        // Own the transition in the shell: a menu can unmount this link in onClick.
        event.preventDefault();
        const navigate = props.replace
          ? navigationRouter.replace
          : navigationRouter.push;
        navigate(clickedHref.current, { scroll: props.scroll });
      }}
    >
      {children}
    </NextLink>
  );
};

export default Link;
