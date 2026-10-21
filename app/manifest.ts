import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Health-Bridge",
    short_name: "Health-Bridge",
    description: "A patient care space designed for clear, connected access to care.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8f5",
    theme_color: "#176f60",
    icons: [
      {
        src: "/1.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
