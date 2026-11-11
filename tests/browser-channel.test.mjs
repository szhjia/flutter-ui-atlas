import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBrowserChannel} from '../packages/cli/index.mjs';

const config = value => (value === undefined ? {} : {browserChannel: value});

test('通道解析优先级：环境变量 > 配置 > 默认 chrome', () => {
  assert.equal(resolveBrowserChannel(config(), {}), 'chrome');
  assert.equal(resolveBrowserChannel(config('chromium'), {}), 'chromium');
  assert.equal(resolveBrowserChannel(config('chromium'), {ATLAS_BROWSER_CHANNEL: 'msedge'}), 'msedge');
  assert.equal(resolveBrowserChannel(config(), {ATLAS_BROWSER_CHANNEL: 'chrome-beta'}), 'chrome-beta');
});

test('非法通道值给出中文报错，通过校验的值去除首尾空白', () => {
  assert.throws(() => resolveBrowserChannel(config(''), {}), /browserChannel/);
  assert.throws(() => resolveBrowserChannel(config(42), {}), /browserChannel/);
  assert.throws(() => resolveBrowserChannel(config(null), {}), /browserChannel/);
  assert.throws(() => resolveBrowserChannel(config(), {ATLAS_BROWSER_CHANNEL: ''}), /ATLAS_BROWSER_CHANNEL/);
  assert.equal(resolveBrowserChannel(config(), {ATLAS_BROWSER_CHANNEL: ' chrome '}), 'chrome');
});
