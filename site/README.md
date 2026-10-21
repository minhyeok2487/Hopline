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
3. Optional: add the environment variable `NEXT_PUBLIC_SITE_URL` with the final address (for example `https://hopline.vercel.app` or your own domain). It is used for canonical links, the sitemap and social preview images.
4. Deploy. Later pushes to `main` redeploy automatically.
