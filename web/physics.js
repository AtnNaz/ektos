export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const AU_KM = 149597870.7;
export const C_KMS = 299792.458;
export const GM_SUN = 1.32712440018e11;
export const GM_EARTH = 398600.4418;
export const R_EARTH_EQ = 6378.137;
export const R_EARTH = 6371.0;
export const R_JUP = 71492;
export const R_SUN = 695700;
export const T_SUN = 5772;
export const J2_EARTH = 1.08262668e-3;
export const PC_AU = 648000 / Math.PI;
export const OBLIQ = 23.43928 * D2R;
const H = 6.62607015e-34, KB = 1.380649e-23, C = 2.99792458e8, SIGMA = 5.670374419e-8;
export const YEAR_D = 365.25;

export const mjdOfDate = d => d.getTime() / 86400000 + 40587;
export const dateOfMjd = m => new Date((m - 40587) * 86400000);
export const yearOfMjd = m => 2000 + (m - 51544.5) / YEAR_D;
const cent = mjd => (mjd - 51544.5) / 36525;

export const PLANETS = [
  { id: 'mercury', en: 'Mercury', R: 2439.7, p: 0.142, el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], rt: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { id: 'venus', en: 'Venus', R: 6051.8, p: 0.689, el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], rt: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  { id: 'earth', en: 'Earth', R: 6371.0, p: 0.434, el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rt: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  { id: 'mars', en: 'Mars', R: 3389.5, p: 0.170, el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rt: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { id: 'jupiter', en: 'Jupiter', R: 69911, p: 0.538, el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rt: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { id: 'saturn', en: 'Saturn', R: 58232, p: 0.499, el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rt: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  { id: 'uranus', en: 'Uranus', R: 25362, p: 0.488, el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], rt: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  { id: 'neptune', en: 'Neptune', R: 24622, p: 0.442, el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rt: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
];
export const STANDISH_RANGE = [-21504 , 70171 ];

export function solveKepler(M, e) {
  M = Math.atan2(Math.sin(M), Math.cos(M));
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 30; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

function orbitToEq(a, e, I, Om, w, M) { return planeToEq(a, e, I, Om, w, solveKepler(M, e)); }
export function orbitPath(a, e, I, Om, w, n = 256) {
  const out = [];
  for (let k = 0; k <= n; k++) out.push(planeToEq(a, e, I * D2R, Om * D2R, w * D2R, 2 * Math.PI * k / n));
  return out;
}
export function planetPath(i, mjd, n = 256) {
  const [a, e, I, , wb, Om] = planetElements(i, mjd);
  return orbitPath(a, e, I, Om, wb - Om, n);
}
function planeToEq(a, e, I, Om, w, E) {
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = (sw * sI) * xp + (cw * sI) * yp;
  return eclToEq([x, y, z]);
}
export function eclToEq([x, y, z]) {
  const c = Math.cos(OBLIQ), s = Math.sin(OBLIQ);
  return [x, c * y - s * z, s * y + c * z];
}
export function eqToEcl([x, y, z]) {
  const c = Math.cos(OBLIQ), s = Math.sin(OBLIQ);
  return [x, c * y + s * z, -s * y + c * z];
}

export function planetElements(i, mjd) {
  const T = cent(mjd), P = PLANETS[i];
  return P.el.map((v, k) => v + P.rt[k] * T);
}
export function planetXYZ(i, mjd) {
  const [a, e, I, L, wb, Om] = planetElements(i, mjd);
  return orbitToEq(a, e, I * D2R, Om * D2R, (wb - Om) * D2R, (L - wb) * D2R);
}
export const earthXYZ = mjd => planetXYZ(2, mjd);

const GIANT_MASS = { 4: 1 / 1047.348644, 5: 1 / 3497.9018, 6: 1 / 22902.98, 7: 1 / 19412.26 };
export function sunBarycentric(mjd) {
  const s = [0, 0, 0];
  let M = 1;
  for (const [i, m] of Object.entries(GIANT_MASS)) {
    const r = planetXYZ(+i, mjd);
    s[0] += m * r[0]; s[1] += m * r[1]; s[2] += m * r[2]; M += m;
  }
  return [-s[0] / M, -s[1] / M, -s[2] / M];
}
export function earthBarycentric(mjd) {
  const e = planetXYZ(2, mjd), s = sunBarycentric(mjd);
  return [e[0] + s[0], e[1] + s[1], e[2] + s[2]];
}

export function bodyXYZ(b, mjd) {
  const n = Math.sqrt(GM_SUN / (b.a * AU_KM) ** 3) * 86400;
  const M = b.M0 * D2R + n * (mjd - b.mjd0);
  return orbitToEq(b.a, b.e, b.i * D2R, b.node * D2R, b.peri * D2R, M);
}
export const periodYears = a => Math.sqrt((a * AU_KM) ** 3 / GM_SUN) * 2 * Math.PI / 86400 / YEAR_D;
export const visViva = (r, a) => Math.sqrt(GM_SUN * (2 / (r * AU_KM) - 1 / (a * AU_KM)));

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function radec(v) {
  const r = norm(v);
  return [((Math.atan2(v[1], v[0]) * R2D) + 360) % 360, Math.asin(v[2] / r) * R2D];
}
export const unit = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
export function tangent(ra, dec, ra0, dec0) {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = Math.cos(d) * Math.sin(a - a0) / c;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / c;
  return [xi * R2D * 3600, eta * R2D * 3600];
}
export function apparent(posFn, mjd) {
  const E = earthXYZ(mjd);
  let tau = 0, v = sub(posFn(mjd), E);
  for (let k = 0; k < 3; k++) { tau = norm(v) * AU_KM / C_KMS / 86400; v = sub(posFn(mjd - tau), E); }
  return { v, tau };
}
export function starOffset(ast, mjd) {
  const dt = yearOfMjd(mjd) - ast.epoch, a = ast.ra * D2R, d = ast.dec * D2R, [X, Y, Z] = earthBarycentric(mjd);
  const pa = X * Math.sin(a) - Y * Math.cos(a);
  const pd = X * Math.cos(a) * Math.sin(d) + Y * Math.sin(a) * Math.sin(d) - Z * Math.cos(d);
  return [ast.pmra * dt + ast.plx * pa, ast.pmdec * dt + ast.plx * pd];
}
export function elongation(dir, mjd) {
  const s = sub([0, 0, 0], earthXYZ(mjd));
  return Math.acos(Math.max(-1, Math.min(1, dot(s, dir) / norm(s) / norm(dir)))) * R2D;
}
export const SPX_ELONG = [80, 120];
export const spherexCanSee = e => e >= SPX_ELONG[0] && e <= SPX_ELONG[1];

export const SPX_ORBIT = { a: 7029.4, inc: 97.99, nodeSun: 267.91 };
export const meanSunLon = mjd => (280.460 + 0.9856474 * (mjd - 51544.5)) % 360;
export const orbitPeriodMin = a => 2 * Math.PI * Math.sqrt(a ** 3 / GM_EARTH) / 60;
export function sunSyncInclination(a) {
  const n = Math.sqrt(GM_EARTH / a ** 3), need = 2 * Math.PI / (365.2422 * 86400);
  return Math.acos(-need / (1.5 * n * J2_EARTH * (R_EARTH_EQ / a) ** 2)) * R2D;
}
export const nodeRateDegPerDay = (a, inc) => -1.5 * Math.sqrt(GM_EARTH / a ** 3) * J2_EARTH * (R_EARTH_EQ / a) ** 2 * Math.cos(inc * D2R) * R2D * 86400;
export function orbitPoint(a, inc, node, u) {
  const i = inc * D2R, O = node * D2R, c = Math.cos(u * D2R), s = Math.sin(u * D2R);
  return [a * (Math.cos(O) * c - Math.sin(O) * s * Math.cos(i)), a * (Math.sin(O) * c + Math.cos(O) * s * Math.cos(i)), a * s * Math.sin(i)];
}
export function orbitNormal(inc, node) {
  const i = inc * D2R, O = node * D2R;
  return [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
}
export function argLat(p, inc, node) {
  const O = node * D2R, i = inc * D2R;
  const x = p[0] * Math.cos(O) + p[1] * Math.sin(O);
  const y = (-p[0] * Math.sin(O) + p[1] * Math.cos(O)) * Math.cos(i) + p[2] * Math.sin(i);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

export function planckNu(lamUm, T) {
  if (T <= 0) return 0;
  const nu = C / (lamUm * 1e-6), x = H * nu / (KB * T);
  if (x > 700) return 0;
  return 2 * H * nu ** 3 / (C * C) / Math.expm1(x);
}
const UJY = 1e32;
export const thermalUJy = (lam, T, R, d) => Math.PI * planckNu(lam, T) * (R / d) ** 2 * UJY;
export const sunAt1AU = lam => thermalUJy(lam, T_SUN, R_SUN, AU_KM);
export const solarConstant = () => SIGMA * T_SUN ** 4 * (R_SUN / AU_KM) ** 2;
export const lambertPhase = al => (Math.sin(al) + (Math.PI - al) * Math.cos(al)) / Math.PI;
export const reflectedUJy = (lam, p, R, r, delta, alpha) => sunAt1AU(lam) / (r * r) * p * (R / delta) ** 2 * lambertPhase(alpha);
export const tEq = (r, bond) => T_SUN * Math.sqrt(R_SUN / (2 * r * AU_KM)) * Math.pow(1 - bond, 0.25);
export const tBody = (r, bond, tInt) => Math.pow(tEq(r, bond) ** 4 + tInt ** 4, 0.25);
export const abMag = ujy => ujy > 0 ? 23.9 - 2.5 * Math.log10(ujy) : Infinity;
