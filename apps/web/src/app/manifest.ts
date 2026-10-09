import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ArogyaAI",
    short_name: "ArogyaAI",
    description: "Health information companion — development starter",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f2",
    theme_color: "#174d42",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
