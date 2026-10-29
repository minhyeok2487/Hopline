import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { Dict, Locale } from "@/app/[lang]/dictionaries";
import { REPO_URL } from "@/lib/release";

/** Top navigation. `page` is the path after the language ("" for home, "/changelog"). */
export function SiteHeader({ d, lang, page, downloadUrl }: { d: Dict; lang: Locale; page: string; downloadUrl: string }) {
  const other = lang === "ko" ? "en" : "ko";
  const home = page === "" ? "" : `/${lang}`; // section links point back to the home page
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href={`/${lang}`} className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" />
          Hopline
        </Link>
        <div className="hidden items-center gap-6 text-sm text-dim md:flex">
          <Link href={`${home}#features`} className="hover:text-fg">{d.nav.features}</Link>
          <Link href={`${home}#ai`} className="hover:text-fg">{d.nav.ai}</Link>
          <Link href={`${home}#install`} className="hover:text-fg">{d.nav.install}</Link>
          <Link href={`/${lang}/changelog`} className={page === "/changelog" ? "text-fg" : "hover:text-fg"}>{d.nav.changelog}</Link>
          <Link href={`${home}#faq`} className="hover:text-fg">{d.nav.faq}</Link>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/${other}${page}`} hrefLang={other} title={d.lang.label}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-dim hover:text-fg">
            <Icon name="globe" className="h-4 w-4" />{d.lang.switch}
          </Link>
          <a href={REPO_URL} className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-dim hover:text-fg sm:inline-flex">
            <Icon name="github" className="h-4 w-4" />{d.nav.github}
          </a>
          <a href={downloadUrl} className="btn btn-primary !px-3.5 !py-2 text-sm">
            <Icon name="download" className="h-4 w-4" /><span className="hidden sm:inline">{d.hero.download}</span>
          </a>
        </div>
      </nav>
    </header>
  );
}
