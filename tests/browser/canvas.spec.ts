import {test, expect, type Page} from '@playwright/test';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({page}) => {
  errors.set(page, []);
  page.on('pageerror', e => errors.get(page)!.push(e.message));
});
test.afterEach(async ({page}) => {
  expect(errors.get(page)).toEqual([]);
});
const entry = '/tests/browser/fixtures/canvas.html';
async function layoutCommand(page: Page, name: string) {
  await page
    .getByRole('toolbar', {name: 'Layout controls', exact: true})
    .getByRole('button', {name, exact: true})
    .click();
  await page.keyboard.press('Escape');
}

async function positions(page: Page) {
  return page.locator('.react-flow__node').evaluateAll(es =>
    Object.fromEntries(
      es.map(e => {
        const m = new DOMMatrixReadOnly((e as HTMLElement).style.transform);
        return [e.getAttribute('data-id'), {x: m.m41, y: m.m42}];
      })
    )
  );
}
async function drag(page: Page, id: string, dx: number, dy = 0, stop = true) {
  const box = (await page.locator(`[data-id="${id}"] h2`).boundingBox())!;
  await page.mouse.move(box.x + 25, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 25 + dx, box.y + 5 + dy, {steps: 12});
  if (stop) await page.mouse.up();
}
test('局部避让、整组撤销重做、锁定与刷新持久化', async ({page}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(8);
  const before = await positions(page);
  await drag(page, 'n0', 195);
  await expect.poll(async () => (await positions(page)).n1.x).toBeGreaterThan(500);
  const after = await positions(page);
  for (let i = 2; i < 8; i++) expect(after[`n${i}`]).toEqual(before[`n${i}`]);
  await layoutCommand(page, 'Undo');
  expect(await positions(page)).toEqual(before);
  await layoutCommand(page, 'Redo');
  expect(await positions(page)).toEqual(after);
  await page.getByRole('button', {name: 'Lock 页面 0', exact: true}).click();
  await drag(page, 'n0', 70);
  expect((await positions(page)).n0).toEqual(after.n0);
  await page.reload();
  await expect(page.getByRole('button', {name: 'Unlock 页面 0', exact: true})).toBeVisible();
  expect(await positions(page)).toEqual(after);
});
test('Esc 恢复，隐藏障碍保持原位，筛选不改镜头', async ({page}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(8);
  const before = await positions(page);
  await drag(page, 'n0', 195, 0, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await positions(page)).toEqual(before);
  const view = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('combobox', {name: /Feature group:/}).click();
  await page.getByRole('option', {name: '验收', exact: true}).click();
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(view);
  await drag(page, 'n0', 260);
  await page.getByRole('combobox', {name: /Feature group:/}).click();
  await page.getByRole('option', {name: 'All features', exact: true}).click();
  expect((await positions(page)).n1).toEqual(before.n1);
  expect((await positions(page)).n0.x + 224 + 96).toBeLessThanOrEqual(500);
});
test('跨窗口更新只通知，载入后生效', async ({page, context}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(8);
  const other = await context.newPage();
  await other.goto(entry);
  await expect(other.locator('.map-card')).toHaveCount(8);
  await drag(other, 'n0', 65);
  await expect(page.getByRole('button', {name: 'Load external layout'})).toBeVisible();
  expect((await positions(page)).n0.x).toBe(0);
  await page.getByRole('button', {name: 'Load external layout'}).click();
  expect((await positions(page)).n0.x).toBeGreaterThan(0);
});
test('输入与 iframe 快捷键隔离，采集目录更新保留其他位置', async ({page}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(8);
  await drag(page, 'n0', 65);
  const after = await positions(page);
  await page.getByRole('textbox', {name: 'Search screens'}).fill('页面');
  await page.getByRole('textbox', {name: 'Search screens'}).press('ControlOrMeta+z');
  expect(await positions(page)).toEqual(after);
  await page.locator('[data-id="n0"] h2').click();
  await page.getByRole('button', {name: 'Open live session', exact: true}).click();
  await page.frameLocator('iframe').getByRole('button', {name: '业务操作'}).click();
  await expect(page.frameLocator('iframe').getByRole('button', {name: '已操作'})).toBeVisible();
  await page.getByRole('button', {name: '准备删除页面采集'}).click();
  await page.getByRole('button', {name: 'Refresh captures'}).click();
  await expect(page.locator('.map-card')).toHaveCount(7);
  expect((await positions(page)).n1).toEqual(after.n1);
});
for (const zoom of [0.325, 0.65, 1.3])
  test(`标签与页面无覆盖，实底且置顶，zoom=${zoom}`, async ({page}) => {
    await page.goto(`${entry}?zoom=${zoom}`);
    await expect(page.locator('.map-card')).toHaveCount(8);
    if (zoom === 0.325) {
      await expect(page.locator('.atlas-edge-label')).toHaveCount(0);
      await page.locator('[data-id="n0"] h2').click();
    } else await expect(page.locator('.atlas-edge-label').first()).toBeVisible();
    const result = await page.locator('.atlas-edge-label').evaluateAll(labels => {
      const cards = [...document.querySelectorAll('.map-card')].map(e => e.getBoundingClientRect());
      const rects = labels.map(e => e.getBoundingClientRect());
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return labels.map((e, i) => ({
        overlap: cards.some(c => overlap(rects[i], c)) || rects.slice(0, i).some(r => overlap(rects[i], r)),
        bg: getComputedStyle(e).backgroundColor,
        font: getComputedStyle(e).fontSize,
        hit:
          rects[i].x > 0 && rects[i].right < innerWidth - 400 && rects[i].y > 150 && rects[i].bottom < innerHeight - 60
            ? !!document
                .elementFromPoint(rects[i].x + rects[i].width / 2, rects[i].y + rects[i].height / 2)
                ?.closest('.atlas-edge-label')
            : true
      }));
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => !r.overlap && r.bg === 'rgb(255, 255, 255)' && parseFloat(r.font) >= 11 && r.hit)).toBe(
      true
    );
    await page.setViewportSize({width: 1100, height: 800});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
test('100 页面 / 150 连线反馈性能', async ({page}, info) => {
  await page.goto(`${entry}?dense=1`);
  await expect(page.locator('.map-card')).toHaveCount(100);
  await expect(page.getByRole('checkbox', {name: 'Show connections'})).toBeChecked();
  const profiler = process.env.ATLAS_PROFILE ? await page.context().newCDPSession(page) : null;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.start');
  }
  for (let i = 0; i < 4; i++) {
    await drag(page, 'n0', 100, i % 2 ? 20 : -20);
    await layoutCommand(page, 'Undo');
  }
  if (profiler) {
    const {profile} = await profiler.send('Profiler.stop');
    const {writeFile} = await import('node:fs/promises');
    await writeFile('.runtime/account-workspace/cpu-profile.json', JSON.stringify(profile));
  }
  const samples = await page.evaluate(() => (window as any).canvasFeedback as number[]);
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  await info.attach('feedback.json', {
    body: JSON.stringify({
      samples,
      sampleCount: samples.length,
      p95,
      userAgent: await page.evaluate(() => navigator.userAgent)
    }),
    contentType: 'application/json'
  });
  console.log('100/150 pointer feedback p95:', p95, 'ms; samples:', samples.length);
  expect(samples.length).toBeGreaterThan(20);
  expect(p95).toBeLessThanOrEqual(50);
});

test('键盘 Enter 选页并通过方向键受约束移动', async ({page}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(8);
  const node = page.locator('[data-id="n0"]');
  await node.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'Open live session', exact: true})).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await positions(page)).n0.x).toBe(10);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await positions(page)).n0.x).toBe(0);
});

test('拖动中异步采集删除当前页，画布不崩溃且旧手势不能提交', async ({page}) => {
  await page.goto(entry);
  await expect(page.locator('.map-card')).toHaveCount(8);
  const before = await positions(page);
  await drag(page, 'n0', 195, 0, false);
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    buttons.find(b => b.textContent === '准备删除页面采集')!.click();
    buttons.find(b => b.getAttribute('aria-label') === 'Refresh captures')!.click();
  });
  await expect(page.locator('.map-card')).toHaveCount(7);
  await page.mouse.up();
  expect((await positions(page)).n1).toEqual(before.n1);
  await expect(page.getByRole('heading', {name: '画布验收', exact: true})).toBeVisible();
});
