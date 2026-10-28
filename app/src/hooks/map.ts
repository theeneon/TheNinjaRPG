import { useEffect, useState } from "react";
import { fetchMap } from "@/libs/sector-map/topology";
import type { GlobalMapData } from "@/libs/sector-map/world-types";

export const useMap = () => {
  const [globe, setGlobe] = useState<GlobalMapData | null>(null);
  const [mapError, setMapError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMap()
      .then((data) => {
        if (!cancelled) setGlobe(data);
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });
    return () => {
      cancelled = true; // guard against state‑update after unmount
    };
  }, []);

  return { globe, mapError };
};
