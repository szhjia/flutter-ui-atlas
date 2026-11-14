import {expect, it} from 'vitest';
import {accountWorkspaces} from '../../packages/viewer/src/workspaces';
import type {AppMapManifest} from '../../packages/viewer/src/model';
it('uses UUID not name and restricts public edges to the active account', () => {
  const map = {
    screens: [
      {id: 'a', accountId: 'one', role: 'Same'},
      {id: 'b', accountId: 'two', role: 'Same'},
      {id: 'login', accountId: '@anonymous', role: 'Signed out'}
    ],
    edges: [
      {id: 'la', source: 'login', target: 'a'},
      {id: 'lb', source: 'login', target: 'b'}
    ]
  } as AppMapManifest;
  const workspaces = accountWorkspaces(map);
  expect(workspaces.map(w => w.id)).toEqual(['one', 'two', '@anonymous']);
  expect(workspaces[0].map.screens.map(s => s.id)).toEqual(['a', 'login']);
  expect(workspaces[0].map.edges.map(e => e.id)).toEqual(['la']);
});
