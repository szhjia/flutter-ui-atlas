/** Flutter 可能自行启用语义；在同一 DOM 任务内查找并激活，避免等待已消失的入口。 */
export async function enableFlutterSemantics(page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('flt-semantics-placeholder')) {
      if (element.getAttribute('role') === 'button' && element.getAttribute('aria-label') === 'Enable accessibility') {
        element.click();
      }
    }
  });
}
