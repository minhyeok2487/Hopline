import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { Dict, Locale } from "@/app/[lang]/dictionaries";
import { LATEST_URL, REPO_URL } from "@/lib/release";

export function SiteFooter({ d, lang }: { d: Dict; lang: Locale }) {
  const guide = `${REPO_URL}/blob/main/docs/${lang === "ko" ? "GUIDE.ko.md" : "GUIDE.md"}`;
  return (
    <footer className="border-t border-line/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-faint sm:flex-row sm:px-6">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={20} height={20} className="rounded" />
          <span>Hopline · {d.footer.made}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5">
          <a href={guide} className="hover:text-fg">{d.footer.guide}</a>
          <Link href={`/${lang}/changelog`} className="hover:text-fg">{d.nav.changelog}</Link>
          <a href={LATEST_URL.replace("/latest", "")} className="hover:text-fg">{d.footer.releases}</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} className="hover:text-fg">{d.footer.license}</a>
          <a href={REPO_URL} className="hover:text-fg" aria-label="GitHub"><Icon name="github" className="h-4 w-4" /></a>
        </div>
      </div>
    </footer>
  );
}
