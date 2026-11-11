import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeArchive} from '../packages/capture/discovery.mjs';

test('失败批次：归档填充节点最终状态并按未采集统计', () => {
  const nodes = new Map([
    ['a', {id: 'a', status: 'captured'}],
    ['b', {id: 'b', status: 'pending', error: '实际入口、路由、身份或内容与候选不符'}]
  ]);
  const edges = new Map([['e1', {id: 'e1', status: 'observed'}]]);
  const result = {schemaVersion: 1, captureId: 'c1', screens: [], edges: []};
  const archive = finalizeArchive({result, nodes, edges, failed: true});
  assert.equal(archive.result.screens.length, 2);
  assert.equal(archive.result.screens[1].error, '实际入口、路由、身份或内容与候选不符');
  assert.equal(archive.failedScreens, 1);
  assert.equal(archive.failedEdges, 0);
  assert.equal(archive.result.schemaVersion, 1);
});

test('失败批次：更早失败（result 尚未建立）也能归档已登记候选', () => {
  const nodes = new Map([['a', {id: 'a', status: 'pending'}]]);
  const archive = finalizeArchive({result: undefined, nodes, edges: new Map(), failed: true});
  assert.equal(archive.result.screens.length, 1);
  assert.equal(archive.failedScreens, 1);
});

test('成功批次：沿用已填充结果只统计显式 failed，与 capture() 对称', () => {
  const result = {
    schemaVersion: 1,
    screens: [
      {id: 'a', status: 'captured'},
      {id: 'b', status: 'pending'},
      {id: 'c', status: 'failed'}
    ],
    edges: [
      {id: 'e1', status: 'observed'},
      {id: 'e2', status: 'failed'}
    ]
  };
  const archive = finalizeArchive({result, nodes: new Map(), edges: new Map(), failed: false});
  assert.equal(archive.result.screens, result.screens);
  assert.equal(archive.failedScreens, 1);
  assert.equal(archive.failedEdges, 1);
});
