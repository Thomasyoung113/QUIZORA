import { isPresetSlug, presetAvatarDataUri } from "@/lib/avatars";

export const RANK_TIERS = [
  { name: "Bronze", min: 0, max: 1100, color: "#CD7F32" },
  { name: "Silver", min: 1100, max: 1300, color: "#C0C0C0" },
  { name: "Gold", min: 1300, max: 1600, color: "#FBBF24" },
  { name: "Platinum", min: 1600, max: 2000, color: "#7DD3FC" },
  { name: "Diamond", min: 2000, max: Infinity, color: "#60A5FA" },
] as const;

export function rankFor(rating: number) {
  const idx = RANK_TIERS.findIndex((t) => rating < t.max);
  const tier = RANK_TIERS[idx < 0 ? RANK_TIERS.length - 1 : idx];
  const next = RANK_TIERS[idx + 1] ?? null;
  const progress = next ? Math.min(100, Math.max(0, ((rating - tier.min) / (next.min - tier.min)) * 100)) : 100;
  return { tier: tier.name, color: tier.color, rating, nextTier: next?.name ?? null, progress: Math.round(progress) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveAvatarUrl(row: any): string | null {
  if (!row?.avatar_url) return null;
  if (isPresetSlug(row.avatar_url)) return presetAvatarDataUri(row.avatar_url);
  return row.avatar_url;
}
