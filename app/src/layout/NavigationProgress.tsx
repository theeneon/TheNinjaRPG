"use client";

export const NavigationProgress = ({ pending }: { pending: boolean }) => {
  if (!pending) return null;
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="bg-primary/20 pointer-events-none fixed inset-x-0 top-0 z-[10000] h-1 overflow-hidden"
    >
      <span className="sr-only">Loading page</span>
      <div
        aria-hidden="true"
        className="bg-primary h-full w-1/3 animate-[navigation-progress_1s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none"
      />
    </div>
  );
};
