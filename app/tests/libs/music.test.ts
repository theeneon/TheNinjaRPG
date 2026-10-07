import { describe, expect, it } from "vitest";
import {
  MUSIC_AKASUMI_THEME,
  MUSIC_HALLOWEEN_THEME,
  MUSIC_HORIZON_THEME,
  MUSIC_HYORIN_THEME,
  MUSIC_SYNDICATE_THEME,
  MUSIC_WELCOME_TO_SEICHI,
  MUSIC_WINTER_THEME,
} from "@/drizzle/constants";
import { getBackgroundMusicSrc } from "@/libs/music";

describe("getBackgroundMusicSrc", () => {
  it("plays the village theme outside seasonal events", () => {
    expect(getBackgroundMusicSrc("Hyorin", "fall")).toBe(MUSIC_HYORIN_THEME);
    expect(getBackgroundMusicSrc("Horizon", "spring")).toBe(MUSIC_HORIZON_THEME);
    expect(getBackgroundMusicSrc("Akasumi", "summer")).toBe(MUSIC_AKASUMI_THEME);
    expect(getBackgroundMusicSrc("Syndicate", "fall")).toBe(MUSIC_SYNDICATE_THEME);
  });

  it("falls back to Welcome to Seichi without a themed village", () => {
    expect(getBackgroundMusicSrc(undefined, "fall")).toBe(MUSIC_WELCOME_TO_SEICHI);
    expect(getBackgroundMusicSrc(null, "summer")).toBe(MUSIC_WELCOME_TO_SEICHI);
    expect(getBackgroundMusicSrc("Freedom State", "fall")).toBe(MUSIC_WELCOME_TO_SEICHI);
    expect(getBackgroundMusicSrc("constructor", "fall")).toBe(MUSIC_WELCOME_TO_SEICHI);
  });

  it("overrides every village with the event theme during Halloween and winter", () => {
    expect(getBackgroundMusicSrc("Hyorin", "halloween")).toBe(MUSIC_HALLOWEEN_THEME);
    expect(getBackgroundMusicSrc(undefined, "halloween")).toBe(MUSIC_HALLOWEEN_THEME);
    expect(getBackgroundMusicSrc("Akikaze", "winter")).toBe(MUSIC_WINTER_THEME);
    expect(getBackgroundMusicSrc(undefined, "winter")).toBe(MUSIC_WINTER_THEME);
  });
});
