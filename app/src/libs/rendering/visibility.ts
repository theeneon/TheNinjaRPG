/** Picking follows the full display hierarchy, including hidden actor and sector wrappers. */
export const isObjectChainVisible = (object: VisibleObject | null): boolean => {
  for (let current = object; current; current = current.parent)
    if (!current.visible) return false;
  return object !== null;
};
type VisibleObject = { visible: boolean; parent: VisibleObject | null };
