import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, locales } from "./dictionaries";
import "../globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Korean glyphs load on demand (split by unicode range), so no preload.
const kr = Noto_Sans_KR({ variable: "--font-kr", weight: ["400", "500", "700", "800"], preload: false });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hopline.vercel.app";

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const d = getDictionary(lang);
  return {
    metadataBase: new URL(siteUrl),
    title: d.meta.title,
    description: d.meta.description,
    alternates: { canonical: `/${lang}`, languages: { ko: "/ko", en: "/en" } },
    openGraph: {
      title: d.meta.title,
      description: d.meta.description,
      url: `/${lang}`,
      siteName: "Hopline",
      locale: lang === "ko" ? "ko_KR" : "en_US",
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Hopline" }],
    },
    twitter: { card: "summary_large_image", title: d.meta.title, description: d.meta.description, images: ["/og.png"] },
  };
}

export const viewport: Viewport = { themeColor: "#0b0f17", colorScheme: "dark" };

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable} ${kr.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
