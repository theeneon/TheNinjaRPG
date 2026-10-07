import {
  MUSIC_AKASUMI_THEME,
  MUSIC_AKIKAZE_THEME,
  MUSIC_HALLOWEEN_THEME,
  MUSIC_HORIZON_THEME,
  MUSIC_HYORIN_THEME,
  MUSIC_SHIROHANA_THEME,
  MUSIC_SYNDICATE_THEME,
  MUSIC_TSUKIMORI_THEME,
  MUSIC_WELCOME_TO_SEICHI,
  MUSIC_WINTER_THEME,
} from "@/drizzle/constants";
import { getCurrentSeason } from "@/utils/time";

type Season = ReturnType<typeof getCurrentSeason>;

/** Background theme per village name; any other village (or none) hears Welcome to Seichi */
const VILLAGE_MUSIC = new Map<string, string>([
  ["Tsukimori", MUSIC_TSUKIMORI_THEME],
  ["Shirohana", MUSIC_SHIROHANA_THEME],
  ["Akikaze", MUSIC_AKIKAZE_THEME],
  ["Akasumi", MUSIC_AKASUMI_THEME],
  ["Hyorin", MUSIC_HYORIN_THEME],
  ["Horizon", MUSIC_HORIZON_THEME],
  ["Syndicate", MUSIC_SYNDICATE_THEME],
]);

/** Event themes that replace every village theme while their season lasts */
const SEASON_MUSIC: Partial<Record<Season, string>> = {
  halloween: MUSIC_HALLOWEEN_THEME,
  winter: MUSIC_WINTER_THEME,
};

/**
 * Pick the background music track. Seasons follow `getCurrentSeason`, the same
 * calendar that switches the seasonal wallpapers, so event music and artwork agree.
 */
export const getBackgroundMusicSrc = (
  villageName?: string | null,
  season: Season = getCurrentSeason(),
): string => {
  const seasonal = SEASON_MUSIC[season];
  if (seasonal) return seasonal;
  return VILLAGE_MUSIC.get(villageName ?? "") ?? MUSIC_WELCOME_TO_SEICHI;
};
