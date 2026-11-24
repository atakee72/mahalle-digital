import { Toaster, toast } from 'sonner';
import { useEffect } from 'react';
import ConfirmDialog from './ConfirmDialog';

// sonner injects its own CSS (the toaster's `position: fixed`, the stacking maths) as a <style>
// into <head> when its module loads. Astro's ClientRouter drops every head element the next page
// does not carry, so after ANY client-side navigation the toaster fell into the page flow: the
// toast appeared under the masthead in the page itself and pushed the page down ~35 px instead of
// floating at the bottom (owner report 2026-11-24: „teilen does nothing, the page jumps"; a reload
// cured it). Carry the style into the incoming document before the swap, so the router keeps it.
if (typeof document !== 'undefined') {
  const isSonnerStyle = (el: Element) =>
    el.tagName === 'STYLE' && (el.textContent ?? '').includes('[data-sonner-toaster]');
  const find = (doc: Document) => Array.from(doc.head.children).find(isSonnerStyle) ?? null;
  let kept: Element | null = find(document);
  document.addEventListener('astro:before-swap', (e) => {
    kept = find(document) ?? kept;
    const next = (e as Event & { newDocument?: Document }).newDocument;
    if (kept && next && !find(next)) next.head.appendChild(kept.cloneNode(true));
  });
}

export default function ToastProvider() {
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, message, description, duration, action } = (e as CustomEvent).detail;
      const opts = { description, duration, action };
      switch (type) {
        case 'success': toast.success(message, opts); break;
        case 'error':   toast.error(message, opts); break;
        case 'warning': toast.warning(message, opts); break;
        case 'info':    toast.info(message, opts); break;
        default:        toast(message, opts);
      }
    };
    window.addEventListener('app:toast', handler);
    return () => window.removeEventListener('app:toast', handler);
  }, []);

  return (
    <>
      <Toaster
        position="bottom-center"
        theme="light"
        // Bottom-center keeps the toast near where the action happens — top
        // toasts were missed when the trigger (e.g. "als Entwurf sichern") sits
        // at the bottom of a long form. mobileOffset clears the fixed bottom-nav
        // (~48px) so the toast isn't hidden behind it on small screens.
        offset={{ bottom: '24px' }}
        mobileOffset={{ bottom: '80px' }}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: 'kiosk-toast',
            title: 'kiosk-toast__title',
            description: 'kiosk-toast__desc',
            success: 'kiosk-toast--success',
            error: 'kiosk-toast--error',
            warning: 'kiosk-toast--warning',
            info: 'kiosk-toast--info',
            closeButton: 'kiosk-toast__close',
            actionButton: 'kiosk-toast__action'
          }
        }}
      />
      <ConfirmDialog />
    </>
  );
}
