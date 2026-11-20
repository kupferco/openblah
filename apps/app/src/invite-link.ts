/** Hosts whose `/j/<token>` links the app opens (the Associated Domains entitlement in app.json). */
export const INVITE_HOSTS = ["openblah.web.app", "openblah.firebaseapp.com"];

/**
 * The invite token in a universal link (`https://openblah.web.app/j/<token>`) or in the
 * custom scheme (`openblah://j/<token>`), or null for any other URL.
 */
export function parseInviteLink(url: string): string | null {
  const m = /^(https?|openblah):\/\/([^/?#]*)\/?(.*)$/i.exec(url.trim());
  if (!m) return null;
  const [, scheme, host = "", rest = ""] = m;
  let path: string;
  if (scheme!.toLowerCase() === "openblah") {
    path = `${host}/${rest}`;
  } else {
    if (!INVITE_HOSTS.includes(host.toLowerCase())) return null;
    path = rest;
  }
  const t = /^j\/([A-Za-z0-9_-]{8,128})\/?(?:[?#].*)?$/.exec(path);
  return t ? t[1]! : null;
}
