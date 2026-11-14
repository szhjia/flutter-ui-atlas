import {expect, test, type Page} from '@playwright/test';
import {graph} from './fixtures/graphs';

const accounts = Array.from({length: 20}, (_, index) => `Account ${index + 1} with a complete descriptive name`);

async function openCanvas(page: Page, discovery = false) {
  const map = graph(40);
  map.discovery = discovery;
  map.screens = map.screens.map((screen, index) => ({
    ...screen,
    role: accounts[index % 20],
    group: index < 20 ? 'Main' : 'Details',
    title: `Page ${index}`
  }));
  await page.route('**/compact-header/manifest.json', route => route.fulfill({json: map}));
  await page.route('**/compact-header/latest-attempt.json', route => route.fulfill({status: 404}));
  await page.route(
    url => url.pathname === '/',
    async route => {
      const response = await route.fetch();
      const config = {
        artifactPaths: ['/compact-header'],
        layoutKey: 'compact-header-browser',
        shell: {
          title: 'A long application name that should not hide the canvas controls '.repeat(4),
          headerLinks: [{label: 'Project guide', href: '/project-guide'}]
        }
      };
      const body = (await response.text()).replace(
        'id="atlas-config"></script>',
        `id="atlas-config">${JSON.stringify(config)}</script>`
      );
      await route.fulfill({response, body});
    }
  );
  await page.goto('/');
  await expect(page.locator('.map-card')).toHaveCount(2);
}

async function position(page: Page) {
  return page.locator('.react-flow__node[data-id="n0"]').evaluate(element => {
    const matrix = new DOMMatrixReadOnly((element as HTMLElement).style.transform);
    return {x: matrix.m41, y: matrix.m42};
  });
}

for (const width of [1543, 1305, 1024]) {
  test(`单行 Header ${width}px 保留全部入口并让画布从 56px 开始`, async ({page}) => {
    await page.setViewportSize({width, height: 953});
    for (const discovery of [false, true]) {
      await openCanvas(page, discovery);
      const header = page.locator('.map-topbar');
      expect((await header.boundingBox())!.height).toBe(56);
      expect((await page.locator('.map-stage').boundingBox())!.y).toBe(56);
      await expect(header.getByRole('combobox', {name: 'Account', exact: true})).toBeVisible();
      await expect(header.getByRole('textbox', {name: 'Search screens'})).toBeVisible();
      await expect(page.getByRole('toolbar', {name: 'Layout controls', exact: true})).toBeVisible();
      expect((await header.getByRole('textbox', {name: 'Search screens'}).boundingBox())!.width).toBe(240);
      const searchBounds = (await header.getByRole('textbox', {name: 'Search screens'}).boundingBox())!;
      const accountBounds = (await header.getByRole('combobox', {name: 'Account', exact: true}).boundingBox())!;
      expect(searchBounds.x + searchBounds.width).toBeLessThan(accountBounds.x);
      await expect(header.getByRole('button', {name: 'Refresh captures', exact: true})).toBeVisible();
      await expect(page.getByRole('button', {name: 'Fit view', exact: true})).toBeVisible();
      await expect(header.getByRole('button', {name: 'Hide details', exact: true})).toBeVisible();
      if (discovery) await expect(header.getByRole('combobox', {name: 'Screen coverage'})).toBeVisible();
      const geometry = await header.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll('button,input,select')]
          .map(control => control.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0);
        return {
          contained: controls.every(
            rect =>
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom &&
              rect.left >= bounds.left &&
              rect.right <= bounds.right
          ),
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      });
      expect(geometry).toEqual({contained: true, overflow: false});
      const card = await page
        .locator('.map-card')
        .first()
        .evaluate(element => {
          const image = element.querySelector('img')!;
          return {
            width: getComputedStyle(element).width,
            imageWidth: getComputedStyle(image).width,
            imageHeight: getComputedStyle(image).height,
            lockBorder: getComputedStyle(element.querySelector('.atlas-lock')!).borderTopWidth,
            lockPadding: getComputedStyle(element.querySelector('.atlas-lock')!).padding,
            lockFont: getComputedStyle(element.querySelector('.atlas-lock')!).fontSize
          };
        });
      expect(card).toEqual({
        width: '224px',
        imageWidth: '202px',
        imageHeight: '438px',
        lockBorder: '0px',
        lockPadding: '2px 5px',
        lockFont: '12px'
      });
      await expect(page.locator('.map-status')).toContainText('2 captured screens');
      await expect(page.locator('.map-status')).toContainText('0 verified transitions');
      await expect(page.locator('.map-status')).toContainText('Showing 2 / 2');
      await page.unrouteAll({behavior: 'wait'});
    }
  });
}

test('账户下拉与分组、搜索联合筛选并保留画布视口', async ({page}) => {
  await openCanvas(page);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const view = await page.locator('.react-flow__viewport').getAttribute('style');
  const account = page.getByRole('combobox', {name: 'Account', exact: true});
  await account.click();
  await page.getByRole('option', {name: accounts[0], exact: true}).click();
  await expect(page.locator('.map-card')).toHaveCount(2);
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', view!);
  await page.getByRole('combobox', {name: 'Feature group: All features'}).click();
  await page.getByRole('option', {name: 'Details', exact: true}).click();
  await expect(page.locator('.map-card')).toHaveCount(1);
  await expect(page.locator('.map-card h2')).toContainText('Page 20');
  await page.getByRole('textbox', {name: 'Search screens'}).fill('missing');
  await expect(page.locator('.map-card')).toHaveCount(0);
  await page.getByRole('textbox', {name: 'Search screens'}).fill('Page 20');
  await expect(page.locator('.map-card')).toHaveCount(1);
  await expect(account).toHaveText(accounts[0]);
});

test('账户弹层显示完整长名称，键盘选择与 Esc 不触发画布移动', async ({page}) => {
  await page.setViewportSize({width: 1024, height: 768});
  await openCanvas(page);
  const node = page.locator('.react-flow__node[data-id="n0"]');
  await node.press('Enter');
  const original = await position(page);
  const account = page.getByRole('combobox', {name: 'Account', exact: true});
  await account.click();
  const menu = page.getByRole('listbox', {name: 'Accounts', exact: true});
  await expect(menu.getByRole('option')).toHaveCount(20);
  await expect(menu.getByRole('option', {name: accounts[0], exact: true})).toHaveText(accounts[0]);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused();
  expect(await position(page)).toEqual(original);
  await expect(account).toHaveText(accounts[0]);
  await account.click();
  await page.keyboard.press('End');
  await expect(menu.getByRole('option', {name: accounts[19], exact: true})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(account).toHaveText(accounts[19]);
  await expect(page.locator('.map-card')).toHaveCount(2);
});

test('浮动布局工具保留撤销、重做、锁定、确认和键盘隔离', async ({page}) => {
  await openCanvas(page);
  const node = page.locator('.react-flow__node[data-id="n0"]');
  await node.press('Enter');
  const original = await position(page);
  await node.press('ArrowRight');
  const moved = {...original, x: original.x + 10};
  await expect.poll(() => position(page)).toEqual(moved);
  const tools = page.getByRole('toolbar', {name: 'Layout controls', exact: true});
  await tools.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect.poll(() => position(page)).toEqual(original);
  await expect(tools.getByRole('button', {name: 'Redo', exact: true})).toBeFocused();
  await tools.getByRole('button', {name: 'Redo', exact: true}).click();
  await expect.poll(() => position(page)).toEqual(moved);
  await tools.getByRole('button', {name: 'Lock screen', exact: true}).click();
  await expect(node.getByRole('button', {name: 'Unlock Page 0', exact: true})).toBeVisible();
  await tools.getByRole('button', {name: 'Unlock screen', exact: true}).click();
  const arrange = tools.getByRole('button', {name: 'Arrange visible screens', exact: true});
  await arrange.focus();
  await page.keyboard.press('ArrowRight');
  expect(await position(page)).toEqual(moved);
  await arrange.click();
  await expect(page.getByRole('dialog', {name: 'Confirm layout arrangement'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', {name: 'Confirm layout arrangement'})).toHaveCount(0);
  expect(await position(page)).toEqual(moved);
  await arrange.click();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(tools.getByRole('button', {name: 'Undo', exact: true})).toBeFocused();
  expect(await position(page)).toEqual(moved);
  await arrange.click();
  await page.getByRole('button', {name: 'Arrange screens', exact: true}).click();
  await expect(tools.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();
});

test('Header 自定义链接保持可达', async ({page}) => {
  await openCanvas(page);
  await page.getByRole('button', {name: 'Links', exact: true}).click();
  const link = page.getByRole('link', {name: 'Project guide', exact: true});
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/project-guide');
});

test('Header 图标提示可由鼠标与键盘打开，Esc 关闭提示且不移动画布', async ({page}) => {
  await openCanvas(page);
  const button = page.getByRole('button', {name: 'Fit view', exact: true});
  await button.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Fit view');
  await page.mouse.move(5, 300, {steps: 10});
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await button.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Fit view');
  const view = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', view!);
});

test('浮动工具 Tab 可到达布局预设，搜索仍独立可编辑', async ({page}) => {
  await openCanvas(page);
  const tools = page.getByRole('toolbar', {name: 'Layout controls', exact: true});
  await tools.getByRole('button', {name: 'Arrange visible screens', exact: true}).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', {name: 'Auto layout preset'})).toBeFocused();
  const search = page.getByRole('textbox', {name: 'Search screens'});
  await search.click();
  await expect(search).toBeFocused();
  await expect(tools).toBeVisible();
});

test('画布浮动工具统一外框，释义水平居中，缩放限制为 50 到 200%', async ({page}) => {
  await openCanvas(page);
  const zoom = page.getByRole('toolbar', {name: 'Canvas controls', exact: true});
  const legend = page.getByRole('toolbar', {name: 'Connection legend', exact: true});
  const stage = (await page.locator('.map-stage').boundingBox())!;
  const bounds = (await legend.boundingBox())!;
  expect(bounds.x + bounds.width / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
  const style = async (selector: string) =>
    page.locator(selector).evaluate(el => {
      const css = getComputedStyle(el);
      return {
        border: css.borderTopWidth,
        radius: css.borderRadius,
        background: css.backgroundColor,
        shadow: css.boxShadow
      };
    });
  expect(await style('.canvas-zoom')).toEqual(await style('.map-legend'));
  const out = zoom.getByRole('button', {name: 'Zoom out', exact: true});
  const into = zoom.getByRole('button', {name: 'Zoom in', exact: true});
  for (let i = 0; i < 16 && !(await out.isDisabled()); i++) await out.click();
  await expect(out).toBeDisabled();
  await expect(zoom).toContainText('50%');
  for (let i = 0; i < 20 && !(await into.isDisabled()); i++) await into.click();
  await expect(into).toBeDisabled();
  await expect(zoom).toContainText('200%');
  await zoom.getByRole('button', {name: 'Reset zoom to 100%', exact: true}).click();
  await expect(zoom).toContainText('100%');
  await page.mouse.move(stage.x + 8, stage.y + 220);
  await page.mouse.down();
  await page.mouse.move(stage.x + 5000, stage.y + 5000, {steps: 8});
  await page.mouse.up();
  const viewport = await page.locator('.react-flow__viewport').evaluate(el => {
    const matrix = new DOMMatrixReadOnly((el as HTMLElement).style.transform);
    return {x: matrix.m41, y: matrix.m42, zoom: matrix.a};
  });
  const content = await page.locator('.map-card').evaluateAll(cards => {
    const bounds = cards.map(card => card.getBoundingClientRect());
    return {left: Math.min(...bounds.map(b => b.left)), right: Math.max(...bounds.map(b => b.right))};
  });
  expect((content.left + content.right) / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
  expect(viewport.y).toBeLessThanOrEqual(313);
  expect(viewport.zoom).toBeCloseTo(0.65);
});

test('详情面板支持拖动和键盘调宽，有最小宽度并保留画布空间', async ({page}) => {
  await page.setViewportSize({width: 1024, height: 768});
  await openCanvas(page);
  const handle = page.getByRole('separator', {name: 'Resize details panel'});
  const detail = page.getByRole('complementary');
  const width = async () => (await detail.boundingBox())!.width;
  const before = await width();
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(width).toBe(before + 20);
  let box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 2000, box.y + 200, {steps: 5});
  await page.mouse.up();
  await expect.poll(width).toBe(320);
  box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 2000, box.y + 200, {steps: 5});
  await page.mouse.up();
  expect(await width()).toBeLessThanOrEqual(504);
  expect((await page.locator('.map-stage').boundingBox())!.width).toBeGreaterThanOrEqual(520);
  await page.locator('.react-flow__node[data-id="n0"]').press('Enter');
  await page.getByRole('button', {name: 'Arrange visible screens', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Confirm layout arrangement'})).toBeVisible();
  const stage = (await page.locator('.map-stage').boundingBox())!;
  const controls = await page.locator('.canvas-layout-bar button').evaluateAll(els =>
    els.map(el => {
      const bounds = el.getBoundingClientRect();
      return {left: bounds.left, right: bounds.right};
    })
  );
  expect(controls.every(rect => rect.left >= stage.x && rect.right <= stage.x + stage.width)).toBe(true);
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Hide details', exact: true}).click();
  await expect(handle).toHaveCount(0);
  await page.getByRole('button', {name: 'Show details', exact: true}).click();
  await expect(detail).toBeVisible();
});

test('自动布局预设改善长链比例，改变布局可撤销', async ({page}) => {
  await openCanvas(page);
  const first = await position(page);
  const preset = page.getByRole('combobox', {name: 'Auto layout preset'});
  await preset.click();
  await page.getByRole('option', {name: 'Horizontal flow', exact: true}).click();
  await expect(preset).toHaveText('Horizontal flow');
  const positions = () =>
    page
      .locator('.react-flow__node')
      .evaluateAll(els =>
        els.map(el => ({id: el.getAttribute('data-id'), transform: (el as HTMLElement).style.transform}))
      );
  const horizontal = await positions();
  await preset.click();
  await page.getByRole('option', {name: 'Balanced layout', exact: true}).click();
  const tools = page.getByRole('toolbar', {name: 'Layout controls', exact: true});
  await expect(tools.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();
  const columns = await page
    .locator('.react-flow__node')
    .evaluateAll(els => new Set(els.map(el => new DOMMatrixReadOnly((el as HTMLElement).style.transform).m41)).size);
  expect(columns).toBeGreaterThan(1);
  expect(columns).toBeLessThan(20);
  await tools.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect.poll(positions).toEqual(horizontal);
  await expect(preset).toHaveText('Balanced layout');
  expect(Number.isFinite(first.x)).toBe(true);
});

test('account workspace selection persists independently and cards expose names without ports', async ({page}) => {
  await openCanvas(page);
  const account = page.getByRole('combobox', {name: 'Account', exact: true});
  await account.click();
  await expect(page.getByRole('option', {name: 'All accounts', exact: true})).toHaveCount(0);
  await page.getByRole('option', {name: accounts[1], exact: true}).click();
  await expect(page.locator('.map-card')).toHaveCount(2);
  await expect(page.locator('[data-id="n0"]')).toHaveCount(0);
  await expect(page.locator('[data-id="n1"]')).toBeVisible();
  expect(
    await page
      .locator('.react-flow__handle')
      .evaluateAll(nodes => nodes.every(n => getComputedStyle(n).opacity === '0'))
  ).toBe(true);
  await expect(page.locator('.map-card')).not.toContainText(['Captured', 'Default']);
  await page.reload();
  await expect(account).toHaveText(accounts[1]);
  await expect(page.locator('[data-id="n1"]')).toBeVisible();
});
