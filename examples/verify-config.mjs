// Verify the real configuration page against the standalone shop and an installed CLI.
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
assert(baseUrl, 'Usage: node examples/verify-config.mjs <shop demo URL> [installed atlas.mjs path]');
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
  await page.getByRole('button', {name: '编辑Shop user one', exact: true}).waitFor();
  assert.equal(await page.getByText('已通过', {exact: true}).count(), 2);
  assert.equal(await page.getByText('未通过', {exact: true}).count(), 1);
  assert(!(await page.locator('body').innerText()).includes('1234.com'));
  await page.getByRole('button', {name: '编辑Failed sign-in', exact: true}).click();
  await page.getByRole('button', {name: '删除角色', exact: true}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: '确认删除', exact: true}).click();
  await page.getByRole('button', {name: '编辑Failed sign-in', exact: true}).waitFor({state: 'hidden'});
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
          'Installed CLI init/config',
          'Real configuration page input',
          'Two successful sign-ins and a rejected wrong password',
          'State restored after restart',
          'Credential redaction and file permissions',
          'Account deletion'
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
