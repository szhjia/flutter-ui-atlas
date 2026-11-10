import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capture} from '../packages/capture/index.mjs';
const screens=['a','b'].map(id=>({id,role:'用户',entry:'test',route:id,title:id,group:'测试',state:'默认'}));
const adapter={catalog:async()=>({screens,edges:[]}),sourceFingerprint:async()=>'stable',
  open:async({screen})=>({page:{screenshot:async()=>{}},errors:[],ready:async()=>{},currentRoute:async()=>screen.route,matchesState:async target=>screen.id===target.id,close:async()=>{}})};
for(const mode of ['connection','partial','edge'])test(`${mode} 失败保留上一批截图，同时保存本轮失败报告`,async()=>{
  const output=await mkdtemp(join(tmpdir(),'atlas-publication-'));
  const previous=JSON.stringify({captureId:'previous-success',screens:[{id:'previous'}]});
  await writeFile(join(output,'manifest.json'),previous);
  const broken={...adapter};
  if(mode==='connection')broken.open=async()=>{throw Error('net::ERR_CONNECTION_REFUSED');};
  if(mode==='partial')broken.open=async args=>{if(args.screen.id==='b')throw Error('页面未就绪');return adapter.open(args);};
  if(mode==='edge'){
    broken.catalog=async()=>({screens,edges:[{id:'a-b',source:'a',target:'b',action:'下一页'}]});
    broken.perform=async()=>{throw Error('导航失败');};
  }
  try{
    const result=await capture({adapter:broken,browser:{},output});
    assert.equal(await readFile(join(output,'manifest.json'),'utf8'),previous);
    const attempt=JSON.parse(await readFile(join(output,'latest-attempt.json')));
    assert.equal(attempt.status,'failed');assert.equal(attempt.captureId,result.captureId);
    assert.match(attempt.error,/REFUSED|未就绪|导航失败/);
    const report=JSON.parse(await readFile(join(output,result.captureId,'manifest.json')));
    assert.ok(report.screens.some(s=>s.status==='failed')||report.edges.some(e=>e.status==='failed'));
  }finally{await rm(output,{recursive:true,force:true});}
});
test('首次失败不生成假可用地图，后续成功可正常发布',async()=>{
  const output=await mkdtemp(join(tmpdir(),'atlas-first-failure-'));
  try{
    await capture({adapter:{...adapter,open:async()=>{throw Error('服务未启动');}},browser:{},output});
    await assert.rejects(readFile(join(output,'manifest.json')),/ENOENT/);
    const good=await capture({adapter,browser:{},output});
    assert.equal(JSON.parse(await readFile(join(output,'manifest.json'))).captureId,good.captureId);
    assert.equal(JSON.parse(await readFile(join(output,'latest-attempt.json'))).status,'passed');
  }finally{await rm(output,{recursive:true,force:true});}
});

for (const stage of ['catalog', 'browser', 'source']) {
  test(`批次级异常 ${stage} 保留旧地图并更新可读报告`, async () => {
    const output = await mkdtemp(join(tmpdir(), 'atlas-batch-failure-'));
    const previous = JSON.stringify({captureId: 'old'});
    await writeFile(join(output, 'manifest.json'), previous);
    let sourceChecks = 0;
    const failingAdapter = {
      ...adapter,
      ...(stage === 'catalog' && {catalog: async () => ({screens: [], edges: []})}),
      ...(stage === 'source' && {sourceFingerprint: async () => String(++sourceChecks)}),
    };
    try {
      await assert.rejects(() => capture({
        adapter: failingAdapter, output, browser: stage !== 'browser' ? {} : undefined,
        launchBrowser: async () => {throw Error('Chrome 启动失败');},
      }), /目录不能为空|Chrome 启动失败|源码变化/);
      assert.equal(await readFile(join(output, 'manifest.json'), 'utf8'), previous);
      const attempt = JSON.parse(await readFile(join(output, 'latest-attempt.json')));
      assert.equal(attempt.stage, stage);
      assert.equal(attempt.status, 'failed');
      const archived = JSON.parse(await readFile(join(output, attempt.captureId, 'attempt.json')));
      assert.deepEqual(archived, attempt);
    } finally {
      await rm(output, {recursive: true, force: true});
    }
  });
}

test('最近尝试无法发布时保留旧地图，并在批次内归档发布失败', async () => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-attempt-blocked-'));
  try {
    const baseline = await capture({adapter, browser: {}, output});
    const latestPath = join(output, 'latest-attempt.json');
    await rm(latestPath);
    await mkdir(latestPath);
    await assert.rejects(() => capture({adapter, browser: {}, output}), {code: 'EISDIR'});
    const current = JSON.parse(await readFile(join(output, 'manifest.json')));
    assert.equal(current.captureId, baseline.captureId);
    const batch = (await readdir(output, {withFileTypes: true})).find(entry =>
      entry.isDirectory() && entry.name !== baseline.captureId && entry.name !== 'latest-attempt.json');
    const report = JSON.parse(await readFile(join(output, batch.name, 'attempt.json')));
    assert.equal(report.status, 'failed');
    assert.equal(report.stage, 'publication');
  } finally {
    await rm(output, {recursive: true, force: true});
  }
});

test('地图指针发布失败时，最近尝试可读取且状态为失败', async () => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-manifest-blocked-'));
  try {
    await mkdir(join(output, 'manifest.json'));
    await assert.rejects(() => capture({adapter, browser: {}, output}), {code: 'EISDIR'});
    const attempt = JSON.parse(await readFile(join(output, 'latest-attempt.json')));
    assert.equal(attempt.status, 'failed');
    assert.equal(attempt.stage, 'publication');
  } finally {
    await rm(output, {recursive: true, force: true});
  }
});

test('严格模式拒绝发布未验证连线，保留旧图和降级原因', async () => {
  const output = await mkdtemp(join(tmpdir(), 'atlas-required-edges-'));
  const commonRoute = screens.map(screen => ({...screen, route: '/home'}));
  const ambiguous = {
    ...adapter,
    catalog: async () => ({
      screens: commonRoute,
      edges: [{id:'a-b', source:'a', target:'b', action:'切换身份'}],
    }),
    open: async input => ({...await adapter.open(input), matchesState: async () => true}),
    perform: async () => assert.fail('目标已成立时不能执行操作'),
  };
  try {
    const previous = await capture({adapter, browser: {}, output});
    await assert.rejects(() => capture({
      adapter: ambiguous, browser: {}, output, requireObservedEdges: true,
    }), /未验证连线/);
    assert.equal(JSON.parse(await readFile(join(output, 'manifest.json'))).captureId, previous.captureId);
    const attempt = JSON.parse(await readFile(join(output, 'latest-attempt.json')));
    assert.equal(attempt.status, 'failed');
    const batch = JSON.parse(await readFile(join(output, attempt.captureId, 'manifest.json')));
    assert.equal(batch.edges[0].status, 'declared');
    assert.match(batch.edges[0].reason, /目标状态已成立/);
  } finally {
    await rm(output, {recursive: true, force: true});
  }
});
