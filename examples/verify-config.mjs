// 对独立商城与已安装的公开 CLI 执行真实配置页验收。
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {
  assertShopPrivateFiles,
  assertShopSourcesUnchanged,
  configureShopAccounts,
  createShopProject,
  installShopCli,
  startShopCli
} from '../tests/helpers/shop-harness.mjs';

const baseUrl = process.argv[2];
assert(baseUrl, '用法：node examples/verify-config.mjs <商城 Demo 地址> [安装后的 atlas.mjs 路径]');
const cli = process.argv[3] ?? (await installShopCli());
const directory = await createShopProject(cli, baseUrl);
const browser = await chromium.launch({channel: 'chrome'});
let service;
try {
  service = await startShopCli(cli, directory, ['config', '--no-open']);
  const page = await browser.newPage();
  await page.goto(service.url);
  await configureShopAccounts(page, baseUrl, {includeFailure: true});
  const config = await assertShopPrivateFiles(directory);
  assert.equal(config.roles.length, 3);
  await service.close();
  service = await startShopCli(cli, directory, ['config', '--no-open']);
  await page.goto(service.url);
  await page.getByRole('button', {name: '编辑商城用户一', exact: true}).waitFor();
  assert.equal(await page.getByText('已通过', {exact: true}).count(), 2);
  assert.equal(await page.getByText('未通过', {exact: true}).count(), 1);
  assert(!(await page.locator('body').innerText()).includes('1234.com'));
  await page.getByRole('button', {name: '编辑失败示例', exact: true}).click();
  await page.getByRole('button', {name: '删除角色', exact: true}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: '确认删除', exact: true}).click();
  await page.getByRole('button', {name: '编辑失败示例', exact: true}).waitFor({state: 'hidden'});
  assert.equal((await assertShopPrivateFiles(directory)).roles.length, 2);
  const sourceEvidence = await assertShopSourcesUnchanged(directory);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        project: directory,
        successfulLogins: 2,
        sourceEvidence,
        checks: [
          '已安装 CLI init/config',
          '配置页真实录入',
          '两账户登录成功与错误密码失败',
          '重启恢复',
          '凭据脱敏与权限',
          '角色删除'
        ]
      },
      null,
      2
    )
  );
} finally {
  await service?.close();
  await browser.close();
}
