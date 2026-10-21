import { cacheLife } from "next/cache";

export const REPO = "minhyeok2487/Hopline";
export const REPO_URL = `https://github.com/${REPO}`;
export const LATEST_URL = `${REPO_URL}/releases/latest`;
export const SCOOP_CMD = `scoop install https://raw.githubusercontent.com/${REPO}/main/bucket/hopline.json`;

export type Release = { version: string; downloadUrl: string; sizeMB: string; publishedAt: string };

const fallback: Release = {
  version: "",
  downloadUrl: `${LATEST_URL}/download/Hopline.exe`,
  sizeMB: "16 MB",
  publishedAt: "",
};

/** Latest GitHub release, refreshed every few hours; falls back to the "latest" links. */
export async function getLatestRelease(): Promise<Release> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "hopline-site" },
    });
    if (!res.ok) return fallback;
    const rel = await res.json();
    const exe = (rel.assets ?? []).find((a: { name: string }) => a.name === "Hopline.exe");
    return {
      version: rel.tag_name ?? "",
      downloadUrl: exe?.browser_download_url ?? fallback.downloadUrl,
      sizeMB: exe ? `${(exe.size / 1024 / 1024).toFixed(1)} MB` : fallback.sizeMB,
      publishedAt: rel.published_at ?? "",
    };
  } catch {
    return fallback;
  }
}
