import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {enableFlutterSemantics} from '../packages/cli/flutter-semantics.mjs';

const markup =
  '<flt-semantics-placeholder role="button" aria-label="Enable accessibility"></flt-semantics-placeholder>';

test('尚未启用语义时激活 Flutter 入口', async () => {
  const dom = new JSDOM(markup, {runScripts: 'outside-only'});
  try {
    let enabled = 0;
    dom.window.document.querySelector('flt-semantics-placeholder').addEventListener('click', event => {
      enabled++;
      event.currentTarget.remove();
    });
    await enableFlutterSemantics({evaluate: async callback => dom.window.eval(`(${callback.toString()})()`)});
    assert.equal(enabled, 1);
    assert.equal(dom.window.document.querySelector('flt-semantics-placeholder'), null);
  } finally {
    dom.window.close();
  }
});

test('自动启用使入口消失时立即继续，不等待已分离元素', async () => {
  const dom = new JSDOM(markup, {runScripts: 'outside-only'});
  try {
    dom.window.document.querySelector('flt-semantics-placeholder').remove();
    let evaluations = 0;
    await enableFlutterSemantics({
      evaluate: async callback => {
        evaluations++;
        return dom.window.eval(`(${callback.toString()})()`);
      }
    });
    assert.equal(evaluations, 1);
  } finally {
    dom.window.close();
  }
});
