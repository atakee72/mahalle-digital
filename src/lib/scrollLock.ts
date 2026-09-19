// Page scroll-lock for overlays that don't get it from the platform.
// Dependency-pure (browser globals only) — safe to import from any island.
//
// Why this exists: a native <dialog> opened with showModal() makes the page
// INERT but does NOT stop it from scrolling (wheel/touch on the backdrop
// still moves the document — verified 2026-09-09, Chromium, 390×844). The
// React modals get this from react-remove-scroll; the Svelte native-dialog
// modals call lockPageScroll() while open.
//
// Lock <html>, and ONLY <html>. global.css sets `html { overflow-x: clip }`
// (the sticky fix), so <html>'s overflow is never `visible` and <body>'s
// overflow never propagates to the viewport: a body `overflow: hidden` locks
// NOTHING here (measured 2026-09-19: body-only → the wheel still scrolls).
// What it does do is turn <body> into its own scroll container, and the
// sticky masthead then sticks to <body> instead of the screen — with any
// locking overlay open at scrollY > 0 the top bar scrolled away under the
// scrim (prod, header top -380 at scrollY 380). Until that day this function
// set both; never add the body half back.
// The inline style is saved and restored so the stylesheet's `clip` survives.
// The scrollbar gutter is compensated on <body> so desktop content doesn't
// jump sideways when the scrollbar disappears.

export function lockPageScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  const html = document.documentElement;
  const body = document.body;
  const prev = {
    htmlOverflow: html.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
  };
  const gutter = window.innerWidth - html.clientWidth;
  html.style.overflow = 'hidden';
  if (gutter > 0) body.style.paddingRight = `${gutter}px`;
  return () => {
    html.style.overflow = prev.htmlOverflow;
    body.style.paddingRight = prev.bodyPaddingRight;
  };
}
