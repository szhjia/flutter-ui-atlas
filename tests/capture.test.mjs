import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capture,validateCatalog} from '../packages/capture/index.mjs';
const screens=['a','b'].map(id=>({id,role:'用户',entry:'test',route:id,title:id,group:'测试',state:'默认'}));
const edges=[{id:'a-b',source:'a',target:'b',action:'下一页'}];
test('目录拒绝重复状态和悬空连线',()=>{
  assert.throws(()=>validateCatalog({screens:[screens[0],screens[0]],edges:[]}));
  assert.throws(()=>validateCatalog({screens,edges:[{...edges[0],target:'missing'}]}));
});
async function run(options,verify){
  const output=await mkdtemp(join(tmpdir(),'atlas-test-'));let closes=0;
  const adapter={catalog:async()=>({screens,edges}),sourceFingerprint:async()=>'stable',
    open:async({screen})=>({page:{screenshot:async()=>{}},errors:[],ready:async()=>{},currentRoute:async()=>screen.route,matchesState:async target=>target.id===screen.id,close:async()=>{closes++;}}),...options};
  try{await verify(()=>capture({adapter,browser:{},output}),output,()=>closes);}finally{await rm(output,{recursive:true,force:true});}
}
test('直接打开截图不能冒充验证过的连线',()=>run({},async(capture,output,closes)=>{
  const r=await capture();assert.equal(r.edges[0].status,'declared');assert.equal(closes(),2);assert.equal(JSON.parse(await readFile(join(output,'manifest.json'))).screens.length,2);
}));
test('错误目标标记失败并清理会话',()=>run({perform:async()=>{}},async(capture,output,closes)=>{
  const r=await capture();assert.equal(r.edges[0].status,'failed');assert.match(r.edges[0].reason,/目标不匹配/);assert.equal(closes(),3);
}));
test('运行异常使截图失败并保留错误',()=>run({open:async({screen})=>({page:{screenshot:async()=>{}},errors:['render error'],ready:async()=>{},currentRoute:async()=>screen.route,matchesState:async()=>true,close:async()=>{}})},async capture=>{
  const r=await capture();assert.equal(r.screens[0].status,'failed');assert.equal(r.screens[0].image,undefined);assert.equal(r.runtimeErrors.length,2);
}));
test('源码变化拒绝更新 manifest',async()=>{let call=0;await run({sourceFingerprint:async()=>String(call++)},async(capture,output)=>{
  await assert.rejects(capture,/源码变化/);await assert.rejects(readFile(join(output,'manifest.json')),/ENOENT/);
  const attempt=JSON.parse(await readFile(join(output,'latest-attempt.json')));
  assert.equal(attempt.status,'failed');
  assert.equal(attempt.stage,'source');
  assert.match(attempt.error,/源码变化/);
});});

test('就绪信号放行时仍拒绝错误路由与错误状态，且不截图', () => run({
  open: async ({screen}) => ({
    page: {screenshot: async () => assert.fail('不应截图')}, errors: [],
    ready: async () => {}, close: async () => {},
    currentRoute: async () => 'b', matchesState: async () => false,
  }),
}, async capture => {
  const result = await capture();
  assert.match(result.screens[0].error, /实际 b/);
  assert.match(result.screens[1].error, /页面状态不匹配/);
}));

for (const [mode, status, reason] of [
  ['switched', 'observed', undefined],
  ['noop', 'failed', /页面状态不匹配/],
  ['ambiguous', 'declared', /操作前目标状态已成立/],
  ['source-remains', 'failed', /源页面状态仍成立/],
]) test(`同路由连线必须观察到状态切换: ${mode}`, () => {
  let visible, performs = 0;
  return run({
    catalog: async () => ({screens: screens.map(screen => ({...screen, route: '/same'})), edges}),
    open: async ({screen}) => {
      visible = new Set(mode === 'ambiguous' ? ['a', 'b'] : [screen.id]);
      return {
        page: {screenshot: async () => {}}, errors: [], ready: async () => {},
        close: async () => {}, currentRoute: async () => '/same',
        matchesState: async target => visible.has(target.id),
      };
    },
    perform: async () => {
      performs++;
      if (mode === 'switched') visible.delete('a');
      if (mode !== 'noop') visible.add('b');
    },
  }, async capture => {
    const [edge] = (await capture()).edges;
    assert.equal(edge.status, status);
    assert.equal(performs, mode === 'ambiguous' ? 0 : 1);
    if (reason) assert.match(edge.reason, reason);
  });
});
