# Hopline website

The product page for [Hopline](https://github.com/minhyeok2487/Hopline), built with Next.js 16 (App Router) and Tailwind CSS 4.

- `/ko` and `/en` are prerendered; `/` redirects by the browser's first language (`proxy.ts`).
- The download button and version come from the latest GitHub release (`lib/release.ts`, cached for hours, falls back to the `releases/latest` links).
- Page text lives in `app/[lang]/dictionaries.ts`; screenshots and videos in `public/`.

## Develop

```bash
npm install
npm run dev
```

## Deploy on Vercel

1. In Vercel, **Add New → Project** and import the `Hopline` repository.
2. Set **Root Directory** to `site`. The framework preset is detected as Next.js.
3. Optional: add the environment variable `NEXT_PUBLIC_SITE_URL` with the final address (for example `https://hopline-app.vercel.app` or your own domain). It is used for canonical links, the sitemap and social preview images.
4. Deploy. Later pushes to `main` redeploy automatically.

## Release notes

The changelog page (`/ko/changelog`, `/en/changelog`) is built from the GitHub releases (`lib/release.ts`). Write each release body in this order so both languages show up:

```markdown
## What's new
…English notes…

## 한국어
…Korean notes (### for subsections)…

## Install
…download, Scoop, SHA-256 (not shown on the site)…
```

Releases without a `## 한국어` section show the English notes on the Korean page with a short note. In Korean, keep a space or no bold around code next to a particle (write `` `Hopline.zip`으로 ``, not `` **`Hopline.zip`**으로 ``): Markdown doesn't close bold that is directly followed by a Hangul letter after punctuation.
