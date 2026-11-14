/** Probe without credentials, following only same-origin HTTP redirects. */
export async function assertApplicationReachable(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const signal = AbortSignal.timeout(5000);
  let url = new URL(baseUrl);
  for (let redirects = 0; ; redirects++) {
    const response = await fetch(url, {signal, redirect: 'manual'});
    await response.body?.cancel();
    if (response.ok) return;
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location || redirects >= 10)
      throw Error('Application did not return a usable response.');
    const next = new URL(location, url);
    if (next.origin !== origin || next.username || next.password)
      throw Error('Application redirect must remain on the configured origin.');
    url = next;
  }
}
