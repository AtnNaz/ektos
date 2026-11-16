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
