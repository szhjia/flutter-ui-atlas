import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capture} from '../packages/capture/index.mjs';

test('发布前配置变化拒绝替换已成功图谱，并保存失败报告', async t => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-snapshot-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const screen = {
    id: 'one',
    role: '用户',
    title: '页面',
    entry: 'http://localhost/',
    route: '/',
    group: '页面',
    state: '默认'
  };
  let changed = false,
    records = 0;
  const adapter = {
    catalog: async () => ({screens: [screen], edges: []}),
    open: async () => ({
      page: {screenshot: async () => {}},
      errors: [],
      close: async () => {},
      ready: async () => {},
      currentRoute: async () => '/',
      matchesState: async () => true
    }),
    assertFresh: async () => {
      if (changed) throw Error('配置或凭据已变化');
    },
    beforePublish: async () => {
      records++;
    }
  };
  await capture({adapter, browser: {}, output});
  const previous = await readFile(join(output, 'manifest.json'), 'utf8');
  changed = true;
  await assert.rejects(capture({adapter, browser: {}, output}), /配置或凭据已变化/);
  assert.equal(await readFile(join(output, 'manifest.json'), 'utf8'), previous);
  assert.equal(records, 1);
  assert.equal(JSON.parse(await readFile(join(output, 'latest-attempt.json'), 'utf8')).status, 'failed');
});

test('适配器脱敏同时作用于失败报告与向CLI抛出的异常', async t => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-redaction-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const screen = {
    id: 'one',
    role: '用户',
    title: '页面',
    entry: 'http://localhost/',
    route: '/',
    group: '页面',
    state: '默认'
  };
  const adapter = {
    catalog: async () => ({screens: [screen], edges: []}),
    sourceFingerprint: async () => {
      throw Error('private-source-password');
    },
    sanitizeError: () => '敏感诊断已隐藏'
  };
  await assert.rejects(capture({adapter, browser: {}, output}), error => error.message === '敏感诊断已隐藏');
  const report = await readFile(join(output, 'latest-attempt.json'), 'utf8');
  assert(!report.includes('private-source-password'));
});
