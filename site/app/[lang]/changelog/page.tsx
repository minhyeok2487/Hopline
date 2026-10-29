import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getLatestRelease, getReleaseNotes, LATEST_URL } from "@/lib/release";
import { getDictionary, hasLocale } from "../dictionaries";

export async function generateMetadata({ params }: PageProps<"/[lang]/changelog">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const d = getDictionary(lang);
  return {
    title: `${d.changelog.title} · Hopline`,
    description: d.changelog.lead,
    alternates: { canonical: `/${lang}/changelog`, languages: { ko: "/ko/changelog", en: "/en/changelog" } },
  };
}

export default async function Changelog({ params }: PageProps<"/[lang]/changelog">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDictionary(lang);
  const [rel, notes] = await Promise.all([getLatestRelease(), getReleaseNotes()]);
  const date = (iso: string) =>
    iso ? new Date(iso).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }) : "";

  return (
    <>
      <SiteHeader d={d} lang={lang} page="/changelog" downloadUrl={rel.downloadUrl} />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{d.changelog.title}</h1>
        <p className="mt-4 text-dim">{d.changelog.lead}</p>
        {d.changelog.note && <p className="mt-2 text-sm text-faint">{d.changelog.note}</p>}

        {notes.length === 0 ? (
          <p className="card mt-10 p-6 text-dim">
            {d.changelog.empty}{" "}
            <a href={LATEST_URL.replace("/latest", "")} className="text-acc hover:underline">GitHub</a>
          </p>
        ) : (
          <ol className="mt-12 space-y-14">
            {notes.map((n, i) => (
              <li key={n.version} id={n.version} className="scroll-mt-24">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
                  <h2 className="text-2xl font-bold tracking-tight">
                    <a href={`#${n.version}`} className="hover:text-acc">{n.version}</a>
                  </h2>
                  {i === 0 && <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-xs font-semibold text-ok">{d.changelog.latest}</span>}
                  <time dateTime={n.publishedAt} className="text-sm text-faint">{date(n.publishedAt)}</time>
                  <a href={n.url} className="ml-auto inline-flex items-center gap-1 text-sm text-dim hover:text-fg">
                    {d.changelog.onGitHub}<Icon name="arrow" className="h-3.5 w-3.5" />
                  </a>
                </div>
                {/* GitHub renders and sanitizes this HTML from the release notes. */}
                <div className="notes mt-5" dangerouslySetInnerHTML={{ __html: n.html }} />
              </li>
            ))}
          </ol>
        )}
      </main>
      <SiteFooter d={d} lang={lang} />
    </>
  );
}
