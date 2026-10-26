/** Companion gender rules shared by the settings UI, the router and the image prompt. */
import { PET_GENDER_EDIT_UNTIL, type PetGender } from "@/drizzle/constants";

/**
 * Whether owners may still set or change a saved companion's gender.
 * TODO: remove with the settings control once PET_GENDER_EDIT_UNTIL has passed.
 */
export const isPetGenderEditable = (now: Date = new Date()) =>
  now.getTime() < PET_GENDER_EDIT_UNTIL.getTime();

/**
 * Server-side guard for a settings gender change; null when the change may be saved.
 * Changing gender is free and never generates art, but it must not race an in-flight
 * image whose prompt was built from the previous gender.
 */
export const getPetGenderUpdateError = (
  pet: { gender: PetGender | null; generationStatus: string },
  gender: PetGender | undefined,
  now: Date = new Date(),
) => {
  if (gender === undefined || gender === pet.gender) return null;
  if (!isPetGenderEditable(now)) return "Companion gender can no longer be changed.";
  if (pet.generationStatus === "GENERATING")
    return "Wait for your companion's appearance to finish before changing its gender.";
  return null;
};

/** Short cutoff label for player-facing hints, e.g. "26 Nov". */
export const PET_GENDER_EDIT_UNTIL_LABEL = PET_GENDER_EDIT_UNTIL.toLocaleDateString(
  "en-GB",
  { day: "numeric", month: "short", timeZone: "UTC" },
);

/**
 * How developed the male's sex-specific features are at each rank. Unlike the generic
 * "small beginnings" wording, they are unmistakable from rank 1 so a young male lion is
 * never read as a lioness.
 */
const getMaleFeatureStage = (rank: number) =>
  rank <= 2
    ? "already clearly visible though still short (a young lion's mane is a short but unmistakable ruff around the head and neck; a young stag's antlers are short spikes)"
    : rank <= 3
      ? "about half their final size"
      : rank <= 6
        ? "full and well defined"
        : "at their most majestic, full and flowing";

/**
 * Explicit sex clause for the appearance prompt; companions without a saved gender
 * (adopted before the trait existed) keep the previous, unsexed prompt.
 */
export const getPetSexClause = (gender: PetGender | null | undefined, rank: number) => {
  if (gender === "MALE")
    return `Sex: MALE. Where this species looks visibly different by sex, draw the male: for example a lion has a mane, a deer or elk stag has antlers, a peacock has its long tail fan, a ram has heavy curled horns. These male features are ${getMaleFeatureStage(rank)}; this overrides any wording above that keeps manes, antlers or horns tiny. Where the sexes look alike, convey male only through a sturdier frame and a broader face and jaw, never bulk, and never feminine features such as long eyelashes or a delicate face.`;
  if (gender === "FEMALE")
    return "Sex: FEMALE. Where this species looks visibly different by sex, draw the female: for example a lioness has no mane, a doe or cow elk has no antlers, a peahen has no long tail fan. Do not give her male-only features at any rank; express later-rank growth through her crest, ears, tail, markings and ornament instead. Where the sexes look alike, convey female only through a finer frame and face, never through human-like features.";
  return "";
};
