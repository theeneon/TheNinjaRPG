"use client";

import { Suspense } from "react";
import { GameAssetLibrary } from "@/layout/GameAssetLibrary";
import Loader from "@/layout/Loader";

export default function ManualAssets() {
  return (
    <Suspense fallback={<Loader explanation="Loading asset library" />}>
      <GameAssetLibrary />
    </Suspense>
  );
}
