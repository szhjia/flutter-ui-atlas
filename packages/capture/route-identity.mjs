/** Stable account scope and actual application route; presentation state is never identity. */
export function routeIdentity(screen) {
  const account = screen.accountId ?? screen.role;
  // A catalog belongs to one application. Entry URLs and UI state are not page identity.
  return JSON.stringify([account, screen.route?.split('?')[0]]);
}

export function assertUniqueRoutes(screens) {
  const seen = new Map();
  for (const screen of screens) {
    if (typeof screen.route !== 'string' || typeof screen.role !== 'string') continue;
    const key = routeIdentity(screen);
    const previous = seen.get(key);
    if (previous) {
      throw Error(
        `Duplicate route "${screen.route}" for account "${screen.accountId ?? screen.role}": "${previous.id}" and "${screen.id}". Keep one page per account and route; use preparation or operation steps for in-page state changes. Rebuild the capture after updating the catalog.`
      );
    }
    seen.set(key, screen);
  }
}
