export function parseCoords(text: string): { ra: number; dec: number } | null {
  const t = text.trim().replace(/[,;]/g, ' ');
  const sex = t.match(/^(\d{1,2})[h:\s]\s*(\d{1,2})[m:\s]\s*([\d.]+)s?\s+([+\-−]?\d{1,2})[d°:\s]\s*(\d{1,2})[m':\s]\s*([\d.]+)[s"]?$/i);
  let out: { ra: number; dec: number } | null = null;
  if (sex) {
    const ra = (+sex[1] + +sex[2] / 60 + +sex[3] / 3600) * 15;
    const sign = /^[-−]/.test(sex[4]) ? -1 : 1;
    const dec = sign * (Math.abs(parseFloat(sex[4].replace('−', '-'))) + +sex[5] / 60 + +sex[6] / 3600);
    out = { ra, dec };
  } else {
    const two = t.match(/^([\d.]+)\s+([+\-−]?[\d.]+)$/);
    if (two) out = { ra: +two[1], dec: parseFloat(two[2].replace('−', '-')) };
  }
  if (!out || !validPosition(out.ra, out.dec)) return null;
  return out;
}

export const validPosition = (ra: number, dec: number) =>
  Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90;

const AS = 206264.80624709636, D2R = Math.PI / 180;

export type PackagedField = { center: number[]; fov?: number };

export function packagedField(index: Record<string, PackagedField>, ra: number, dec: number): string | null {
  let best: { slug: string; d: number } | null = null;
  const a = ra * D2R, d = dec * D2R;
  for (const [slug, f] of Object.entries(index)) {
    const a0 = f.center[0] * D2R, d0 = f.center[1] * D2R;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
    if (!(cosc > 0)) continue;
    const xi = (Math.cos(d) * Math.sin(a - a0) / cosc) * AS;
    const eta = ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc) * AS;
    const far = Math.max(Math.abs(xi), Math.abs(eta));
    if (far < (f.fov ? f.fov * 30 - 8 : 120) && (!best || far < best.d)) best = { slug, d: far };
  }
  return best ? best.slug : null;
}
