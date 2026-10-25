import { z } from "zod";
import { WALLPAPER_VARIANTS } from "@/libs/wallpaperExperiment";

export const trackVisitorSchema = z.object({
  ref: z.string().max(191).optional(),
  utmSource: z.string().max(191).optional(),
  wallpaperVariant: z.enum(WALLPAPER_VARIANTS).optional(),
});
