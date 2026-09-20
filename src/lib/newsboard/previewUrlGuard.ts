// Guard for GET /api/news/preview (SSRF): the server fetches an address a member
// typed, so the address must be a public https web page — never the instance's
// own network. Dependency-pure (no node:dns here) so it is testable and safe to
// import anywhere; the DNS half of the check lives in the endpoint.

export type PreviewUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: 'invalid' | 'scheme' | 'credentials' | 'port' | 'host' };

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.test', '.invalid', '.onion'];

/** True for loopback, private, link-local (incl. cloud metadata), CGNAT,
 *  multicast/reserved v4 ranges, their v6 counterparts and v4-mapped v6. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51) return true; // TEST-NET-2
    if (a === 203 && b === 0) return true; // TEST-NET-3
    return a >= 224; // multicast + reserved
  }
  if (!addr.includes(':')) return true; // not an IP at all — refuse
  if (addr === '::' || addr === '::1') return true;
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^ff/.test(addr)) return true; // multicast
  if (/^64:ff9b:/.test(addr)) return true; // NAT64 → could wrap a private v4
  return /^2001:db8:/.test(addr); // documentation
}

/** Shape check of the address itself — no network involved. */
export function checkPreviewUrl(raw: string): PreviewUrlCheck {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'port' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // IP literals (v4, v6, and the decimal/hex forms URL already normalised to v4),
  // single-label names and internal suffixes are never a news site.
  if (!host || host.startsWith('[') || /^[\d.]+$/.test(host)) return { ok: false, reason: 'host' };
  if (!host.includes('.') || host === 'localhost') return { ok: false, reason: 'host' };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'host' };
  return { ok: true, url };
}

/** og:image as an absolute https address, or '' — never http, data: or a private host. */
export function safePreviewImage(raw: string | undefined, base: URL): string {
  if (!raw) return '';
  try {
    const check = checkPreviewUrl(new URL(raw.trim(), base).href);
    return check.ok ? check.url.href : '';
  } catch {
    return '';
  }
}

/** Trim, collapse whitespace, cut to the form's field limit. */
export function clipPreviewText(raw: string | undefined, max: number): string {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
