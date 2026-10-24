'use strict';
// Applies the light/dark choice before the first paint. settings.appearanceMode in IndexedDB is the source of truth;
// the localStorage copy only avoids a flash of the other mode while the database opens.
const KozabotaMode = (() => {
  const KEY = 'kozakura-biyori-mode', AUTO_MEDIA = 'screen and (prefers-color-scheme: dark)';
  const query = matchMedia('(prefers-color-scheme: dark)');
  const metas = [...document.querySelectorAll('meta[name=theme-color]')].map(meta => ({meta, media: meta.getAttribute('media'), content: meta.content}));
  let choice = 'auto';
  function apply(next = choice) {
    choice = ['light', 'dark'].includes(next) ? next : 'auto';
    const dark = choice === 'dark' || (choice === 'auto' && query.matches);
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
    const link = document.getElementById('dark-css');
    if (link) link.media = choice === 'auto' ? AUTO_MEDIA : dark ? 'screen' : 'not all';
    // A forced mode shows that mode's toolbar color whatever the device setting is.
    const forced = metas.find(m => m.media?.includes(dark ? 'dark' : 'light'));
    for (const m of metas) {
      if (choice === 'auto') { m.meta.setAttribute('media', m.media); m.meta.content = m.content; }
      else { m.meta.removeAttribute('media'); m.meta.content = forced?.content || m.content; }
    }
    try { localStorage.setItem(KEY, choice); } catch {}
  }
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  apply(saved);
  query.addEventListener('change', () => apply());
  return {apply, isDark: () => document.documentElement.dataset.mode === 'dark'};
})();
