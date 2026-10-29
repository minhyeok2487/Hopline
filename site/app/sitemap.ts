import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hopline-app.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/changelog"].flatMap((page) =>
    ["ko", "en"].map((lang) => ({
      url: `${siteUrl}/${lang}${page}`,
      alternates: { languages: { ko: `${siteUrl}/ko${page}`, en: `${siteUrl}/en${page}` } },
    })),
  );
}
