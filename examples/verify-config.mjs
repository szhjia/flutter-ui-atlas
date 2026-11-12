// 独立、虚构账号的真实 Flutter 登录与安装包验收；不读取接入方业务 fixture。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, writeFile, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli = process.argv[3] ?? fileURLToPath(new URL('../packages/cli/atlas.mjs', import.meta.url));
const baseUrl = process.argv[2];
assert(baseUrl, '用法：node examples/verify-config.mjs <独立 Flutter 登录示例地址> [安装后的 atlas.mjs 路径]');
const root = await mkdtemp(join(tmpdir(), 'atlas-config-install-project-'));
await mkdir(join(root, 'lib'));
await writeFile(join(root, 'pubspec.yaml'), 'name: isolated_config\ndependencies: {flutter: {sdk: flutter}}\n');
let child;
async function start() {
  child = spawn(process.execPath, [cli, 'config', '--no-open'], {cwd: join(root, 'lib'), stdio:['ignore','pipe','pipe']});
  let stderr = ''; child.stderr.on('data', data => {stderr += data});
  const url = await new Promise((done, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('配置服务未就绪')), 15000);
    child.once('exit', code => {clearTimeout(timer); reject(Error(`配置服务提前退出 ${code}: ${stderr}`));});
    child.stdout.on('data', chunk => {output += chunk; const found = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]+/); if(found){clearTimeout(timer);done(new URL(found[0]));}});
  });
  return {origin:url.origin, token: new URLSearchParams(url.hash.slice(1)).get('token')};
}
async function stop() {if (child && child.exitCode === null) {const exit = once(child,'exit'); child.kill('SIGTERM'); await exit;}}
let service;
async function api(path,input) {
  const response = await fetch(service.origin+'/api/'+path,{method:input===undefined?'GET':'POST',headers:{Origin:service.origin,'X-Atlas-Token':service.token,'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});
  const value = await response.json(); assert.equal(response.status,200,JSON.stringify(value)); return value;
}
try {
  service=await start();
  const html=await (await fetch(service.origin)).text();
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(item=>item[1]);
  assert(assets.length>=2); for(const path of assets) assert.equal((await fetch(service.origin+path)).status,200);
  let state=await api('config');
  await api('project',{...state.project, baseUrl, authentication:{type:'form',loginUrl:baseUrl,
    username:{kind:'label',name:'登录账号'},password:{kind:'label',name:'登录密码'},submit:{kind:'role',role:'button',name:'登录'},
    success:{kind:'text',name:'登录成功'},failure:{kind:'text',name:'账号或密码错误'}}});
  const draft={tag:'reader',name:'独立 Flutter 用户',username:'reader@example.test',password:'atlas-example',clearPassword:false};
  let result;
  for (let attempt=0;attempt<3;attempt++) {
    result=await api('test-login',draft); assert.equal(result.status,'passed',result.message);
  }
  const saved=await api('role',{...draft,checkId:result.checkId}); assert.equal(saved.testStatus,'passed');
  const wrong={...draft,tag:'wrong',name:'失败示例',password:'wrong'};
  const failure=await api('test-login',wrong); assert.equal(failure.status,'failed');
  assert.equal((await api('role',{...wrong,checkId:failure.checkId})).testStatus,'failed');
  await stop(); service=await start(); state=await api('config');
  assert.deepEqual(state.roles.map(role=>role.testStatus),['passed','failed']);
  assert(!JSON.stringify(state).includes('atlas-example'));
  const yaml=await readFile(join(root,'.atlas/atlas.yaml'),'utf8');
  assert(!yaml.includes('reader@example.test')); assert(!yaml.includes('atlas-example'));
  assert.equal((await stat(join(root,'.atlas/local'))).mode&0o777,0o700);
  assert.equal((await stat(join(root,'.atlas/local/credentials.json'))).mode&0o777,0o600);
  await api('delete-role',{id:state.roles[1].id,revision:state.roles[1].revision});
  assert.equal((await api('config')).roles.length,1);
  console.log(JSON.stringify({status:'passed',project:root,successfulLogins:3,checks:['CLI 编译资源','独立 Flutter 真实登录成功与失败','匹配结果保存','CLI 重启恢复','凭据脱敏与权限','角色删除']},null,2));
} finally {await stop();}
