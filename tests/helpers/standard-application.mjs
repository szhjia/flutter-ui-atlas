import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse, stringify} from 'yaml';
import {configFixture, configure, draft} from './config-fixtures.mjs';

/** 普通 HTML 测试应用，只验证通用工具协议，不作为 Flutter Demo 验收。 */
export async function standardApplication() {
  const controls = {missing: false, failWidthBelow: 0, onAuthenticated: null, redirectSignedOut: false};
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (request.method === 'POST' && request.url === '/login') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const tag = {'reader@example.test': 'reader', 'admin@example.test': 'admin'}[form.get('username')];
        if (tag && form.get('password') === 'standard-private-password') {
          response
            .writeHead(303, {'Set-Cookie': `standard-account=${tag}; HttpOnly; SameSite=Strict`, Location: '/'})
            .end();
        } else response.writeHead(303, {Location: '/?failed'}).end();
        return;
      }
      const tag = /standard-account=(reader|admin)/.exec(request.headers.cookie ?? '')?.[1];
      if (!tag) {
        if (controls.redirectSignedOut && request.url !== '/login') {
          response.writeHead(302, {Location: '/login'}).end();
          return;
        }
        response.end(
          `<form method="post" action="/login"><label>登录账号<input name="username"></label><label>登录密码<input name="password" type="password"></label><button>登录</button></form>${request.url.includes('failed') ? '<p>账号或密码错误</p>' : ''}`
        );
        return;
      }
      requests.push({tag, url: request.url});
      await controls.onAuthenticated?.();
      response.end(`<h1>登录成功</h1><p id="identity">${tag} 身份</p><section id="content"></section><script>
        let count=0;
        function render(){
          const currentRoute=decodeURIComponent(location.hash.slice(1));
          const listRoute=currentRoute.includes('商品')?'/商品 列表':'/list';
          const detailRoute=currentRoute.includes('商品')?'/商品 详情':'/detail';
          const detail=currentRoute.includes('detail')||currentRoute.includes('详情');
          const ready=!${JSON.stringify(controls.missing)}&&innerWidth>=${controls.failWidthBelow};
          document.querySelector('#content').innerHTML=ready?'<h2>${tag} 正文'+(detail?'详情':'列表')+'</h2><button id="change">'+(detail?'返回列表':'进入详情')+'</button><button id="counter">计数 '+count+'</button>':'<p>正文未就绪</p>';
          document.querySelector('#change')?.addEventListener('click',()=>{location.hash=detail?listRoute:detailRoute;});
          document.querySelector('#counter')?.addEventListener('click',()=>{count++;render()});
        }window.addEventListener('hashchange',render);render();</script>`);
    } catch {
      response.writeHead(500).end('测试应用处理失败');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let closed = false;
  return {
    controls,
    requests,
    url: `http://127.0.0.1:${server.address().port}/`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    }
  };
}
export async function standardFixture({roles = ['reader'], profiles} = {}) {
  const app = await standardApplication();
  const fixture = await configFixture();
  try {
    await configure(fixture.store, app.url);
    for (const tag of roles)
      await fixture.store.saveRole(
        draft({
          tag,
          name: tag === 'reader' ? '只读用户' : '管理用户',
          username: `${tag}@example.test`,
          password: 'standard-private-password'
        })
      );
    const file = join(fixture.directory, 'atlas.yaml');
    const config = parse(await readFile(file, 'utf8'));
    Object.assign(config, {
      routeMode: 'hash',
      timeoutMs: 700,
      sourceFiles: [],
      requireObservedEdges: true,
      ...(profiles ? {profiles} : {}),
      screens: [
        {
          id: 'list',
          title: '列表',
          route: '/list',
          state: '列表',
          ready: {kind: 'role', role: 'heading', name: '{{role.tag}} 正文列表'}
        },
        {
          id: 'detail',
          title: '详情',
          route: '/detail',
          state: '详情',
          prepare: [],
          ready: {kind: 'role', role: 'heading', name: '{{role.tag}} 正文详情'}
        }
      ],
      edges: [
        {
          id: 'open',
          source: 'list',
          target: 'detail',
          action: '进入详情',
          steps: [{click: {kind: 'role', role: 'button', name: '进入详情'}}]
        }
      ]
    });
    await writeFile(file, stringify(config));
    return {
      ...fixture,
      app,
      file,
      async cleanup() {
        await app.close();
        await fixture.cleanup();
      }
    };
  } catch (error) {
    await app.close();
    await fixture.cleanup();
    throw error;
  }
}
