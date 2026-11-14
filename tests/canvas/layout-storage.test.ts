import {it, expect, beforeEach} from 'vitest';
import {readLayout, writeLayout, discardLayout, storageKey} from '../../packages/viewer/src/canvas/layout-storage';
const doc = {schemaVersion: 1 as const, nodes: {a: {x: 0, y: 0, locked: true}}, viewport: {x: 10, y: 20, zoom: 0.65}};
beforeEach(() => localStorage.clear());
it('应用key隔离，读回锁定和视口', () => {
  writeLayout(localStorage, 'a', doc);
  expect(readLayout(localStorage, 'a').document).toEqual(doc);
  expect(readLayout(localStorage, 'b').document).toBe(null);
});
it.each([
  '{bad',
  JSON.stringify({...doc, schemaVersion: 2}),
  JSON.stringify({...doc, nodes: {a: {x: null, y: 0, locked: true}}})
])('坏或未知数据禁止覆盖 %s', value => {
  localStorage.setItem(storageKey('a'), value);
  expect(readLayout(localStorage, 'a').writable).toBe(false);
  expect(writeLayout(localStorage, 'a', doc).ok).toBe(false);
  expect(localStorage.getItem(storageKey('a'))).toBe(value);
});
it('存储被阻止时返回可显示错误，缺key不写入', () => {
  const storage = {
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('denied');
    }
  } as unknown as Storage;
  expect(readLayout(storage, 'a').issue).toBeTruthy();
  expect(writeLayout(storage, 'a', doc).ok).toBe(false);
  expect(writeLayout(localStorage, '', doc).ok).toBe(false);
  expect(localStorage.length).toBe(0);
});
it('损坏数据标记 corrupted，丢弃前原数据不动，丢弃后恢复保存', () => {
  localStorage.setItem(storageKey('a'), '{bad');
  const broken = readLayout(localStorage, 'a');
  expect(broken.writable).toBe(false);
  expect(broken.corrupted).toBe(true);
  expect(broken.document).toBe(null);
  expect(localStorage.getItem(storageKey('a'))).toBe('{bad');
  expect(discardLayout(localStorage, 'a').ok).toBe(true);
  const after = readLayout(localStorage, 'a');
  expect(after.writable).toBe(true);
  expect(after.document).toBe(null);
  expect(after.corrupted).toBe(false);
  expect(writeLayout(localStorage, 'a', doc).ok).toBe(true);
  expect(readLayout(localStorage, 'a').document).toEqual(doc);
});
it('存储不可用与未配置 key 不算损坏，不提供丢弃', () => {
  const storage = {
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('denied');
    },
    removeItem() {
      throw Error('denied');
    }
  } as unknown as Storage;
  expect(readLayout(storage, 'a').corrupted).toBe(false);
  expect(readLayout(localStorage, '').corrupted).toBe(false);
  expect(discardLayout(localStorage, '').ok).toBe(false);
  writeLayout(localStorage, 'ok', doc);
  expect(readLayout(localStorage, 'ok').corrupted).toBe(false);
});
