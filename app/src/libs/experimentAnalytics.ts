import { WALLPAPER_EXPERIMENT, WALLPAPER_VARIANTS } from "@/libs/wallpaperExperiment";
import { type DeviceType, getDeviceType } from "@/utils/hardware";

type ExperimentCohort = {
  experiment: string;
  variant: string;
  userAgent: string | null;
  loaded: number;
  register: number;
};
export const aggregateExperiments = (
  rows: ExperimentCohort[],
  devices?: DeviceType[],
) => {
  const experiments = new Map<
    string,
    Map<string, { loaded: number; register: number }>
  >();
  for (const row of rows) {
    if (devices?.length && !devices.includes(getDeviceType(row.userAgent ?? undefined)))
      continue;
    let variants = experiments.get(row.experiment);
    if (!variants) {
      variants = new Map();
      if (row.experiment === WALLPAPER_EXPERIMENT) {
        for (const variant of WALLPAPER_VARIANTS)
          variants.set(variant, { loaded: 0, register: 0 });
      }
      experiments.set(row.experiment, variants);
    }
    const counts = variants.get(row.variant) ?? { loaded: 0, register: 0 };
    counts.loaded += row.loaded;
    counts.register += row.register;
    variants.set(row.variant, counts);
  }
  return Array.from(experiments, ([experiment, variants]) => ({
    experiment,
    variants: Array.from(variants, ([variant, counts]) => ({ variant, ...counts })),
  }));
};
