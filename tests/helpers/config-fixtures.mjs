import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createConfigStore} from '../../packages/cli/config-store.mjs';

export async function configFixture() {
  const root = await mkdtemp(join(tmpdir(), 'atlas-config-'));
  await mkdir(join(root, 'lib'));
  await writeFile(join(root, 'pubspec.yaml'), 'name: config_example\ndependencies: {flutter: {sdk: flutter}}\n');
  const store = await createConfigStore({cwd: join(root, 'lib')});
  return {root, store, directory: join(root, '.atlas'), cleanup: () => rm(root, {recursive: true, force: true})};
}
export const draft = (overrides = {}) => ({
  tag: 'reader',
  name: '只读用户',
  username: 'reader@example.test',
  password: 'example-password',
  clearPassword: false,
  ...overrides
});
export function formSettings(baseUrl) {
  return {
    type: 'form',
    loginUrl: baseUrl,
    username: {kind: 'label', name: '登录账号'},
    password: {kind: 'label', name: '登录密码'},
    submit: {kind: 'role', role: 'button', name: '登录'},
    success: {kind: 'text', name: '登录成功'},
    failure: {kind: 'text', name: '账号或密码错误'}
  };
}
export async function configure(store, baseUrl = 'http://127.0.0.1:8080/') {
  return store.saveProject({...(await store.load()).project, baseUrl, authentication: formSettings(baseUrl)});
}
export async function loginApplication() {
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/login' && request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = new URLSearchParams(Buffer.concat(chunks).toString());
      const username = input.get('username');
      if (
        ['reader@example.test', 'admin@example.test'].includes(username) &&
        input.get('password') === 'example-password'
      ) {
        response
          .writeHead(303, {
            'Set-Cookie': `atlas-session=${username.split('@')[0]}; HttpOnly; SameSite=Strict`,
            Location: '/'
          })
          .end();
      } else response.writeHead(303, {Location: '/?failed'}).end();
      return;
    }
    if (/atlas-session=(reader|admin)/.test(request.headers.cookie ?? '')) {
      response.end('<h1>登录成功</h1><p>这是独立的虚构账号示例。</p>');
      return;
    }
    const deferred = request.url?.includes('deferred');
    const marker = deferred ? 'data-semantics-role="text-field"' : '';
    response.end(`${deferred ? '<flt-semantics>' : ''}<form action="/login" method="post"><label>登录账号<input name="username" ${marker}></label>
      ${request.url?.includes('duplicate') ? '<label>登录账号<input></label>' : ''}
      <label>登录密码<input name="password" type="password" ${marker}></label><button>登录</button></form>${deferred ? '</flt-semantics>' : ''}
      ${request.url?.includes('failed') ? '<p>账号或密码错误</p>' : ''}
      ${
        deferred
          ? `<script>
        const committed = {};
        const fields = [...document.querySelectorAll('input[name]')];
        fields.forEach(field => field.addEventListener('focus', () => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            field.value = committed[field.name] || '';
            field.addEventListener('input', () => { committed[field.name] = field.value; });
          }));
        }, {once: true}));
        document.querySelector('form').addEventListener('submit', () => fields.forEach(field => { field.value = committed[field.name] || ''; }));
      </script>`
          : ''
      }`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let closed = false;
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    }
  };
}
