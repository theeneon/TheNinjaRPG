import { isPlainObject } from "@/utils/typeutils";

/** Preserve equal profile branches, including Dates decoded by SuperJSON. */
export const shareUserCache = (
  previous: unknown,
  next: unknown,
  depth = 0,
): unknown => {
  if (previous === next) return previous;
  if (depth > 500) return next;
  if (previous instanceof Date && next instanceof Date)
    return previous.getTime() === next.getTime() ? previous : next;

  if (Array.isArray(previous) && Array.isArray(next)) {
    // Query responses contain dense arrays. Leave other array shapes untouched.
    if (
      Object.keys(previous).length !== previous.length ||
      Object.keys(next).length !== next.length
    )
      return next;
    const shared = next.map((value, index) =>
      shareUserCache(previous[index], value, depth + 1),
    );
    return previous.length === next.length &&
      shared.every((value, index) => value === previous[index])
      ? previous
      : shared;
  }

  if (isShareableRecord(previous) && isShareableRecord(next)) {
    const entries = Object.entries(next).map(([key, value]): [string, unknown] => [
      key,
      shareUserCache(
        Object.hasOwn(previous, key) ? previous[key] : undefined,
        value,
        depth + 1,
      ),
    ]);
    return Object.keys(previous).length === entries.length &&
      entries.every(
        ([key, value]) => Object.hasOwn(previous, key) && value === previous[key],
      )
      ? previous
      : Object.fromEntries(entries);
  }
  return next;
};

const isShareableRecord = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && Object.getPrototypeOf(value) === Object.prototype;
