import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { Icon } from "@/components/Icon";
import { getLatestRelease, LATEST_URL, REPO_URL, SCOOP_CMD } from "@/lib/release";
import { getDictionary, hasLocale } from "./dictionaries";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const d = getDictionary(lang);
  const rel = await getLatestRelease();
  const other = lang === "ko" ? "en" : "ko";
  const guide = `${REPO_URL}/blob/main/docs/${lang === "ko" ? "GUIDE.ko.md" : "GUIDE.md"}`;
  const meta = d.hero.meta.replace("{version}", rel.version || "Latest").replace("{size}", rel.sizeMB);

  return (
    <>
      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-50 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href={`/${lang}`} className="flex items-center gap-2.5 font-semibold tracking-tight">
            <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" />
            Hopline
          </Link>
          <div className="hidden items-center gap-6 text-sm text-dim md:flex">
            <a href="#features" className="hover:text-fg">{d.nav.features}</a>
            <a href="#ai" className="hover:text-fg">{d.nav.ai}</a>
            <a href="#install" className="hover:text-fg">{d.nav.install}</a>
            <a href="#faq" className="hover:text-fg">{d.nav.faq}</a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href={`/${other}`} hrefLang={other} title={d.lang.label}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-dim hover:text-fg">
              <Icon name="globe" className="h-4 w-4" />{d.lang.switch}
            </Link>
            <a href={REPO_URL} className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-dim hover:text-fg sm:inline-flex">
              <Icon name="github" className="h-4 w-4" />{d.nav.github}
            </a>
            <a href={rel.downloadUrl} className="btn btn-primary !px-3.5 !py-2 text-sm">
              <Icon name="download" className="h-4 w-4" /><span className="hidden sm:inline">{d.hero.download}</span>
            </a>
          </div>
        </nav>
      </header>

      <main>
        {/* ---------- hero ---------- */}
        <section className="relative overflow-hidden">
          <div className="glow pointer-events-none absolute inset-0" />
          <div className="grid-bg pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3.5 py-1.5 text-xs text-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {rel.version && <b className="font-semibold text-fg">{rel.version}</b>}
              {d.hero.badge}
            </span>
            <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl">
              {d.hero.title1}<br /><span className="text-grad">{d.hero.title2}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-dim sm:text-lg">{d.hero.lead}</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={rel.downloadUrl} className="btn btn-primary text-base">
                <Icon name="download" />{d.hero.download}
              </a>
              <a href={REPO_URL} className="btn btn-ghost text-base">
                <Icon name="github" />{d.hero.github}
              </a>
            </div>
            <p className="mt-4 text-xs text-faint">{meta}</p>

            <div className="window mx-auto mt-14 max-w-5xl">
              <div className="flex items-center gap-2 border-b border-[#1d2638] bg-[#0f1624] px-4 py-2.5">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 text-xs text-faint">Hopline + Claude Code</span>
              </div>
              <video className="block aspect-video w-full" src="/media/hero.mp4" poster="/media/hero-poster.jpg"
                autoPlay muted loop playsInline preload="metadata" aria-label="Claude Code running commands in Hopline tabs" />
            </div>
          </div>
        </section>

        {/* ---------- strip ---------- */}
        <section className="border-y border-line/70 bg-panel/40">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-y-3 px-4 py-6 text-center text-sm text-dim sm:px-6 md:grid-cols-4">
            {d.strip.map((s) => (
              <li key={s} className="flex items-center justify-center gap-2"><Icon name="check" className="h-4 w-4 text-ok" />{s}</li>
            ))}
          </ul>
        </section>

        {/* ---------- features ---------- */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{d.features.title}</h2>
            <p className="mt-4 text-dim">{d.features.lead}</p>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {d.features.items.map((f) => (
              <div key={f.title} className="card p-6 transition hover:border-[#2c3b55]">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-acc/12 text-acc">
                  <Icon name={f.icon} />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-dim">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- AI ---------- */}
        <section id="ai" className="relative overflow-hidden border-y border-line/70 bg-panel/30">
          <div className="glow pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <span className="text-sm font-semibold uppercase tracking-wider text-acc">{d.ai.eyebrow}</span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{d.ai.title}</h2>
              <p className="mt-4 leading-relaxed text-dim">{d.ai.lead}</p>
              <div className="kbd mt-7 flex items-start gap-3 p-4 text-sm">
                <span className="select-none text-[#d97757]">&gt;</span>
                <span className="text-fg">{d.ai.prompt}</span>
              </div>
              <ul className="mt-8 grid gap-5 sm:grid-cols-2">
                {d.ai.points.map((p, i) => (
                  <li key={p.title} className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-acc2/15 text-acc2">
                      <Icon name={["plug", "multi", "shield", "lock"][i]} className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{p.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-dim">{p.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-8 font-mono text-xs text-faint">{d.ai.tools}</p>
            </div>
            <div className="window mx-auto w-full max-w-sm">
              <Image src="/media/claude-demo.gif" alt="Claude Code calling Hopline's MCP tools" width={400} height={711}
                unoptimized className="block h-auto w-full" />
            </div>
          </div>
        </section>

        {/* ---------- gallery ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{d.gallery.title}</h2>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {d.gallery.items.map((g) => (
              <figure key={g.src} className="window">
                <Image src={g.src} alt={g.alt} width={1600} height={1050} sizes="(min-width: 768px) 560px, 100vw" className="block h-auto w-full" />
                <figcaption className="border-t border-[#1d2638] px-4 py-2.5 text-xs text-faint">{g.alt}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ---------- promo video ---------- */}
        <section className="border-y border-line/70 bg-panel/30">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1fr_auto]">
            <div className="text-center md:text-left">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{d.promo.title}</h2>
              <p className="mt-4 text-dim">{d.promo.lead}</p>
            </div>
            <video className="window mx-auto block aspect-[9/16] w-64 sm:w-72" src="/media/hopline-promo.mp4" poster="/media/promo-poster.jpg"
              controls muted playsInline preload="none" />
          </div>
        </section>

        {/* ---------- install ---------- */}
        <section id="install" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{d.install.title}</h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {d.install.steps.map((s, i) => (
              <li key={s.title} className="card p-6">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-acc text-sm font-bold text-[#04101f]">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-dim">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="card mt-6 p-5">
            <p className="text-sm font-medium">{d.install.scoop}</p>
            <div className="kbd mt-3 flex items-center gap-3 p-3">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-dim">{SCOOP_CMD}</code>
              <CopyButton text={SCOOP_CMD} label={d.install.copy} done={d.install.copied} />
            </div>
          </div>
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={rel.downloadUrl} className="btn btn-primary"><Icon name="download" />{d.hero.download}</a>
              <a href={guide} className="btn btn-ghost">{d.install.guide}<Icon name="arrow" className="h-4 w-4" /></a>
            </div>
            <p className="text-xs text-faint">{d.install.needs}</p>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="border-t border-line/70 bg-panel/30">
          <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{d.faq.title}</h2>
            <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-panel/60">
              {d.faq.items.map((f) => (
                <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span className="text-faint transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-dim">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-faint sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="" width={20} height={20} className="rounded" />
            <span>Hopline · {d.footer.made}</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5">
            <a href={guide} className="hover:text-fg">{d.footer.guide}</a>
            <a href={LATEST_URL.replace("/latest", "")} className="hover:text-fg">{d.footer.releases}</a>
            <a href={`${REPO_URL}/blob/main/LICENSE`} className="hover:text-fg">{d.footer.license}</a>
            <a href={REPO_URL} className="hover:text-fg" aria-label="GitHub"><Icon name="github" className="h-4 w-4" /></a>
          </div>
        </div>
      </footer>
    </>
  );
}
