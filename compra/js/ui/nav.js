/* Navegación y avisos entre dispositivos sin dependencias circulares. */
const hooks = { broadcast: () => {}, askWho: async () => null };

export function go(page, ...params) {
  const h = `#${[page, ...params].filter((x) => x != null && x !== '').map(encodeURIComponent).join('/')}`;
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}
export const setNavHooks = (h) => Object.assign(hooks, h);
export const broadcast = (what) => hooks.broadcast(what);
export const askWho = (force) => hooks.askWho(force);
