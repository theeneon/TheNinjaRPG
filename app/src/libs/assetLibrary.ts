import type { GameAssetType } from "@/drizzle/constants";

export const assetTypeLabels: Record<GameAssetType, string> = {
  STATIC: "Static artwork",
  ANIMATION: "Animations",
  SCENE_BACKGROUND: "Backgrounds",
  SCENE_CHARACTER: "Characters",
  SFX: "Sound effects",
  MUSIC: "Music",
};

export const assetSortOptions = [
  { value: "newest", label: "Newest first" },
  { value: "name-asc", label: "Name: A–Z" },
  { value: "name-desc", label: "Name: Z–A" },
  { value: "oldest", label: "Oldest first" },
] as const;

/** Only return to the asset library, including its saved search and folder. */
export const getAssetLibraryReturnTo = (value: string | null) =>
  value && /^\/manual\/asset(?:\?[^#]*)?$/.test(value) ? value : "/manual/asset";
