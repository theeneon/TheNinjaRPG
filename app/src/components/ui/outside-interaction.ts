/** Sonner renders toasts in this container, outside every dialog and sheet. */
const TOASTER_SELECTOR = "[data-sonner-toaster]";

type OutsideInteractionEvent = {
  target: EventTarget | null;
  preventDefault: () => void;
};

/**
 * Wraps a Radix `onInteractOutside` handler so pressing or focusing a toast, such as
 * its dismiss action, does not count as leaving the dialog or sheet underneath it.
 */
export const ignoreToastInteractions =
  <E extends OutsideInteractionEvent>(handler?: (event: E) => void) =>
  (event: E) => {
    if (event.target instanceof Element && event.target.closest(TOASTER_SELECTOR)) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
