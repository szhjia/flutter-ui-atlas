import {it,expect,beforeEach} from 'vitest';
import {readLayout,writeLayout,storageKey} from '../../packages/viewer/src/canvas/layout-storage';
const doc={schemaVersion:1 as const,nodes:{a:{x:0,y:0,locked:true}},viewport:{x:10,y:20,zoom:.65}};
beforeEach(()=>localStorage.clear());
it('应用key隔离，读回锁定和视口',()=>{writeLayout(localStorage,'a',doc);expect(readLayout(localStorage,'a').document).toEqual(doc);expect(readLayout(localStorage,'b').document).toBe(null);});
it.each(['{bad',JSON.stringify({...doc,schemaVersion:2}),JSON.stringify({...doc,nodes:{a:{x:null,y:0,locked:true}}})])('坏或未知数据禁止覆盖 %s',value=>{
 localStorage.setItem(storageKey('a'),value);expect(readLayout(localStorage,'a').writable).toBe(false);expect(writeLayout(localStorage,'a',doc).ok).toBe(false);expect(localStorage.getItem(storageKey('a'))).toBe(value);
});
it('存储被阻止时返回可显示错误，缺key不写入',()=>{
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}} as unknown as Storage;
 expect(readLayout(storage,'a').issue).toBeTruthy();expect(writeLayout(storage,'a',doc).ok).toBe(false);expect(writeLayout(localStorage,'',doc).ok).toBe(false);expect(localStorage.length).toBe(0);
});
