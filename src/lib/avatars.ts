// Deterministic preset avatar generator: initials on a colored geometric background.
// 8 presets identified by slug "p1".."p8". Rendered as inline SVG data URIs.

const PRESETS: Array<{ bg: string; fg: string; accent: string; shape: "diag" | "circle" | "tri" | "rings" }> = [
  { bg: "#1E1B4B", fg: "#FBBF24", accent: "#4F46E5", shape: "diag" },
  { bg: "#0F172A", fg: "#F8FAFC", accent: "#7C3AED", shape: "circle" },
  { bg: "#052E16", fg: "#A3E635", accent: "#0D9488", shape: "tri" },
  { bg: "#3B0764", fg: "#E9D5FF", accent: "#FBBF24", shape: "rings" },
  { bg: "#0C4A6E", fg: "#7DD3FC", accent: "#F59E0B", shape: "circle" },
  { bg: "#431407", fg: "#FDBA74", accent: "#B91C1C", shape: "diag" },
  { bg: "#111827", fg: "#FBBF24", accent: "#374151", shape: "tri" },
  { bg: "#134E4A", fg: "#5EEAD4", accent: "#FDE68A", shape: "rings" },
];

export const AVATAR_PRESET_SLUGS = PRESETS.map((_, i) => `p${i + 1}`);

export function isPresetSlug(slug: string): boolean {
  return AVATAR_PRESET_SLUGS.includes(slug);
}

function initialsFor(slug: string): string {
  // Deterministic pseudo-initials from slug — geometric marks, not letters of a name.
  const n = parseInt(slug.slice(1), 10) || 1;
  const marks = ["Q", "Z", "K", "V", "X", "R", "M", "T"];
  return marks[n % marks.length];
}

function shapeSvg(shape: string, accent: string): string {
  switch (shape) {
    case "diag":
      return `<path d="M0 128 L128 0 L256 0 L0 256 Z" fill="${accent}" opacity="0.35"/>`;
    case "circle":
      return `<circle cx="196" cy="60" r="72" fill="${accent}" opacity="0.3"/><circle cx="48" cy="208" r="40" fill="${accent}" opacity="0.2"/>`;
    case "tri":
      return `<path d="M128 8 L248 248 L8 248 Z" fill="${accent}" opacity="0.25"/>`;
    default:
      return `<circle cx="128" cy="128" r="104" fill="none" stroke="${accent}" stroke-width="6" opacity="0.4"/><circle cx="128" cy="128" r="76" fill="none" stroke="${accent}" stroke-width="4" opacity="0.3"/>`;
  }
}

/** Returns an SVG data URI for a preset slug. Deterministic per slug. */
export function presetAvatarDataUri(slug: string): string {
  const idx = AVATAR_PRESET_SLUGS.indexOf(slug);
  const p = PRESETS[idx >= 0 ? idx : 0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${p.bg}"/>${shapeSvg(p.shape, p.accent)}<text x="128" y="128" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="900" font-size="104" fill="${p.fg}">${initialsFor(slug)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Client-safe variant (no Buffer): builds a URI-encoded SVG data URI.
 * Same visual output as presetAvatarDataUri.
 */
export function presetAvatarDataUriClient(slug: string): string {
  const idx = AVATAR_PRESET_SLUGS.indexOf(slug);
  const p = PRESETS[idx >= 0 ? idx : 0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${p.bg}"/>${shapeSvg(p.shape, p.accent)}<text x="128" y="128" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="900" font-size="104" fill="${p.fg}">${initialsFor(slug)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
