/**
 * Tauri's WebView silently drops `target="_blank"` navigation, so every such
 * anchor was dead in the .app (B266 fixed one modal; the B331 .app sweep found
 * about twenty more — map cards, recruiter links, sources). One delegated
 * listener sends any external http(s) link to the system browser instead of
 * patching each anchor. In-app routes and mailto/tel are left alone, and a
 * component that already handled the click keeps it.
 */
export function installExternalLinkInterceptor(
  root: Document,
  open: (url: string) => Promise<boolean>,
): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest('a[href]');
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.target !== '_blank') return;
    const { protocol } = new URL(link.href, root.baseURI);
    if (protocol !== 'https:' && protocol !== 'http:') return;
    event.preventDefault();
    void open(link.href);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
