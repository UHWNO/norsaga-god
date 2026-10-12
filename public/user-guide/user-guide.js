const labels = {
  overview: 'Start Here',
  quickstart: 'First 10 Minutes',
  interface: 'Navigation & Search',
  layers: 'Data Layers',
  aurora: 'Aurora Forecast',
  imagery: 'Recent Imagery',
  cameras: 'CCTV & Street Level',
  scenes: 'Scenes & Sharing',
  display: 'Map, Display & Drawing',
  context: 'Context & Tools',
  ai: 'AI Voice Control',
  data: 'Sources & Glossary',
  practice: 'Help & Practice',
};
const navButtons = [...document.querySelectorAll('#guideNav button')];
const pages = [...document.querySelectorAll('.page')];
const toggle = document.getElementById('menuToggle');
function closeMenu() {
  document.body.classList.remove('nav-open');
  toggle.setAttribute('aria-expanded', 'false');
}
function showPage(name) {
  if (!labels[name]) name = 'overview';
  pages.forEach((page) =>
    page.classList.toggle('active', page.id === 'page-' + name),
  );
  navButtons.forEach((button) => {
    const active = button.dataset.page === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.getElementById('crumbCurrent').textContent = labels[name];
  document.title = "NorSaga God's Eye - " + labels[name];
  window.scrollTo({ top: 0, behavior: 'instant' });
  closeMenu();
}
function navigate(name) {
  if (location.hash === '#' + name) showPage(name);
  else location.hash = name;
}
navButtons.forEach((button) =>
  button.addEventListener('click', () => navigate(button.dataset.page)),
);
document
  .querySelectorAll('[data-next]')
  .forEach((button) =>
    button.addEventListener('click', () => navigate(button.dataset.next)),
  );
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (event) => {
  if (
    innerWidth <= 900 &&
    !document.getElementById('guideSidebar').contains(event.target) &&
    !toggle.contains(event.target)
  )
    closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    closeMenu();
    toggle.focus();
  }
});
window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));
document.getElementById('closeGuide').addEventListener('click', () => {
  window.close();
  setTimeout(() => {
    if (!window.closed) location.href = '/';
  }, 150);
});
let printDetails = [];
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('figure img').forEach((img) => {
    img.loading = 'eager';
  });
  printDetails = [...document.querySelectorAll('details')].map((el) => [
    el,
    el.open,
  ]);
  printDetails.forEach(([el]) => {
    el.open = true;
  });
});
window.addEventListener('afterprint', () =>
  printDetails.forEach(([el, open]) => {
    el.open = open;
  }),
);
document.getElementById('printGuide').addEventListener('click', async () => {
  const images = [...document.querySelectorAll('figure img')];
  images.forEach((img) => {
    img.loading = 'eager';
  });
  await Promise.all(images.map((img) => img.decode().catch(() => {})));
  window.print();
});
showPage(location.hash.slice(1) || 'overview');
