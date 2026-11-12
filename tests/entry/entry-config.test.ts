import {it, expect, afterEach} from 'vitest';
import {waitFor} from '@testing-library/react';
import {parseEntryConfig} from '../../src/entry-config';

afterEach(() => {
  document.body.innerHTML = '';
});

it('非法 JSON 返回错误通道，不抛异常', () => {
  const result = parseEntryConfig('{bad json');
  expect(result.config).toBe(null);
  expect(result.error).toContain('画布配置解析失败');
  expect(result.error).toContain('#atlas-config');
});

it('空文本回落默认配置', () => {
  const result = parseEntryConfig(null);
  expect(result.error).toBe(null);
  expect(result.config?.artifactPaths).toEqual(['/generated']);
  expect(result.config?.layoutKey).toBe('atlas-default:phone-393x852:v1');
  expect(result.config?.preview).toEqual({routeMode: 'hash', localOnly: true});
});

it('空字符串同样回落默认配置', () => {
  const result = parseEntryConfig('');
  expect(result.error).toBe(null);
  expect(result.config?.artifactPaths).toEqual(['/generated']);
});

it('合法 JSON 原样透传', () => {
  const config = {artifactPaths: ['/atlas'], shell: {title: '测试'}};
  const result = parseEntryConfig(JSON.stringify(config));
  expect(result.error).toBe(null);
  expect(result.config).toEqual(config);
});

it('非对象 JSON（数组/数字/字符串）按非法处理', () => {
  expect(parseEntryConfig('[1,2]').config).toBe(null);
  expect(parseEntryConfig('42').config).toBe(null);
  expect(parseEntryConfig('"text"').config).toBe(null);
});

it('入口渲染：非法配置显示中文错误提示，不白屏', async () => {
  document.body.innerHTML = '<script type="application/json" id="atlas-config">{bad</script><div id="root"></div>';
  await import('../../src/main');
  await waitFor(() => {
    const alert = document.querySelector('#root [role="alert"]');
    expect(alert?.textContent).toContain('画布配置解析失败');
    expect(alert?.textContent).toContain('#atlas-config');
    expect(document.querySelector('#root')?.textContent).toContain('重新加载');
  });
});
