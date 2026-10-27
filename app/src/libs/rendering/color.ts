import { parseHexColor } from "@/utils/color";

/** Normalized linear RGB for the game shaders' explicit display-color conversion. */
export const linearRenderColor = (hex: string): LinearColor => {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Invalid rendering color ${hex}`);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return { r: channel(rgb.r), g: channel(rgb.g), b: channel(rgb.b) };
};

export type LinearColor = { r: number; g: number; b: number };
