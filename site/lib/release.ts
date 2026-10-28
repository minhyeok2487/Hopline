import { cacheLife } from "next/cache";

export const REPO = "minhyeok2487/Hopline";
export const REPO_URL = `https://github.com/${REPO}`;
export const LATEST_URL = `${REPO_URL}/releases/latest`;
export const SCOOP_CMD = `scoop install https://raw.githubusercontent.com/${REPO}/main/bucket/hopline.json`;

export type Release = { version: string; downloadUrl: string; sizeMB: string; publishedAt: string };

const fallback: Release = {
  version: "",
  downloadUrl: LATEST_URL,
  sizeMB: "16 MB",
  publishedAt: "",
};

/** Latest GitHub release (refreshed every 10 minutes); falls back to the "latest" links. */
export async function getLatestRelease(): Promise<Release> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 86400 }); // new releases show up within ~10 minutes
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "hopline-site" },
    });
    if (!res.ok) return fallback;
    const rel = await res.json();
    // Prefer Hopline-<version>.zip (many networks block .exe downloads);
    // older releases only have Hopline-<version>.exe or Hopline.exe.
    type Asset = { name: string; size: number; browser_download_url: string };
    const assets: Asset[] = rel.assets ?? [];
    const pick =
      assets.find((a) => /^Hopline(-[\w.]+)?\.zip$/i.test(a.name)) ??
      assets.find((a) => /^Hopline(-[\w.]+)?\.exe$/i.test(a.name));
    return {
      version: rel.tag_name ?? "",
      downloadUrl: pick?.browser_download_url ?? fallback.downloadUrl,
      sizeMB: pick ? `${(pick.size / 1024 / 1024).toFixed(1)} MB` : fallback.sizeMB,
      publishedAt: rel.published_at ?? "",
    };
  } catch {
    return fallback;
  }
}
