import type { Metadata } from "next";
import { buildMetadata } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: "Bloodright",
  description:
    "Bloodright paths, tier prerequisites and Seichi Silver costs for developing your bloodline.",
  path: "/manual/bloodright",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
