import type {AppMapManifest} from './model';
export interface AccountWorkspace {
  id: string;
  name: string;
  map: AppMapManifest;
}
export function accountWorkspaces(map: AppMapManifest): AccountWorkspace[] {
  if (map.workspaces) return map.workspaces;
  const owner = (s: AppMapManifest['screens'][number]) => s.accountId ?? `legacy:${s.role}`;
  const accounts = new Map(map.screens.map(s => [owner(s), s.role]));
  return [...accounts]
    .map(([id, name]) => {
      const ids = new Set(map.screens.filter(s => owner(s) === id).map(s => s.id));
      const anonymous = new Set(map.screens.filter(s => owner(s) === '@anonymous').map(s => s.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const edge of map.edges) {
          if (ids.has(edge.source) && anonymous.has(edge.target) && !ids.has(edge.target)) {
            ids.add(edge.target);
            changed = true;
          }
          if (ids.has(edge.target) && anonymous.has(edge.source) && !ids.has(edge.source)) {
            ids.add(edge.source);
            changed = true;
          }
        }
      }
      return {
        id,
        name,
        map: {
          ...map,
          screens: map.screens.filter(s => ids.has(s.id)),
          edges: map.edges.filter(e => ids.has(e.source) && ids.has(e.target))
        }
      };
    })
    .sort((a, b) => Number(a.id === '@anonymous') - Number(b.id === '@anonymous'));
}
