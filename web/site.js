const PAGES = [
  ['index.html', 'Compare'],
  ['how.html', 'How it works'],
  ['sim.html', 'Simulation'],
  ['math.html', 'The maths'],
  ['data.html', 'Data'],
  ['parity.html', 'Engine check'],
  ['vrtest.html', 'Headset check'],
];

export function currentLang() { return 'en'; }

export function mountSite(current) {
  document.documentElement.lang = 'en';
  let h = document.getElementById('site');
  if (!h) { h = document.createElement('header'); h.id = 'site'; document.body.prepend(h); }
  h.className = 'site';
  const links = PAGES.map(([href, name]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${name}</a>`).join('');
  h.innerHTML = `<a class="mark" href="index.html">Ektos</a><nav aria-label="Pages">${links}</nav>`;
}

export function initStaticPage(current) {
  mountSite(current);
  return 'en';
}
