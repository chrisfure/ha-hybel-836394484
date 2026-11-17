// Lys/mørk modus. Lastes i <head> før CSS tegnes, så siden ikke blinker.
(function () {
  const KEY = 'hybel-theme';
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const get = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; } };
  function apply() {
    const pref = get();
    const dark = pref === 'dark' || (pref === 'auto' && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#161310' : '#F4EFE7');
  }
  window.hybelTheme = {
    get,
    set(v) { try { if (v === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch {} apply(); }
  };
  if (mq) (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
  apply();
})();
