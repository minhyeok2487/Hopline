import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hopline.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["ko", "en"].map((lang) => ({
    url: `${siteUrl}/${lang}`,
    alternates: { languages: { ko: `${siteUrl}/ko`, en: `${siteUrl}/en` } },
  }));
}
