import type { ThingKind } from "../types";

/**
 * A stable hue per person, derived from their address.
 *
 * Same person, same colour, forever, with no palette to maintain and no colour stored
 * anywhere. Avatars are the one place the app can be colourful without the colour having
 * to mean something, which is why they carry it and the rest of the UI does not.
 */
export function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0; // keep it a 32-bit int
  }
  // 137.5 is the golden angle: consecutive seeds land far apart on the wheel instead of
  // clustering, so two colleagues never get near-identical avatars.
  return Math.abs(hash * 137.5) % 360;
}

export function avatarStyle(seed: string): React.CSSProperties {
  const hue = hueFor(seed);
  return {
    background: `linear-gradient(140deg, hsl(${hue} 58% 62%), hsl(${(hue + 34) % 360} 62% 48%))`,
    color: "#fff",
  };
}

/** File kinds get fixed colours, not hashed ones: these are categories, not identities. */
const KIND_HUE: Record<ThingKind, number> = {
  pdf: 6,
  sheet: 148,
  image: 276,
  doc: 214,
  archive: 36,
  other: 220,
};

/**
 * Publishes the hue only, and lets CSS build the actual colours from it.
 *
 * Computing them here meant one fixed lightness, which was legible on light paper and
 * nearly invisible on dark. The stylesheet can vary lightness per theme; this cannot.
 */
export function thingFace(kind: ThingKind): React.CSSProperties {
  return { "--kind-h": KIND_HUE[kind] } as React.CSSProperties;
}
