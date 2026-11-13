import assert from "node:assert/strict";
import { test } from "node:test";

test("a boot that failed is never retried, and the page stops intercepting presses", async () => {
  // The browser keeps a module that failed to load failed, so the same URL fails again: the only way out is the page's
  // own behavior. One entry URL throughout.
  const entry = new URL("./fixtures/missing-entry.mjs", import.meta.url).href;
  class Element {
    /** @param {string} _selector */
    closest(_selector) {
      return this;
    }
  }
  class HTMLElement extends Element {}
  class HTMLAnchorElement extends HTMLElement {
    href = "https://example.com/next";
  }
  /** @type {Record<string, (event: object) => void>} */
  const listeners = {};
  /** @type {string[]} */
  const loads = [];
  Object.assign(globalThis, {
    window: globalThis,
    Element,
    HTMLElement,
    HTMLAnchorElement,
    sessionStorage: { getItem: () => null },
    location: { assign: (/** @type {string} */ href) => loads.push(href), reload: () => {} },
    document: {
      getElementById: () => ({
        nonce: "",
        textContent: JSON.stringify({ preloads: [], routes: [], entry }),
      }),
      documentElement: { hasAttribute: () => false },
      head: { appendChild() {} },
      activeElement: null,
      querySelectorAll: () => [],
      addEventListener: (/** @type {string} */ type, /** @type {any} */ listener) => {
        listeners[type] ??= listener;
      },
    },
  });
  const { hydrateNow, hydrateOnIntent } = await import("../hydrate-on-intent.mjs");
  assert.equal(hydrateOnIntent({ selector: "a" }), true);
  const link = new HTMLAnchorElement();
  const press = () => {
    let prevented = false;
    listeners.click({
      target: link,
      preventDefault: () => (prevented = true),
      stopImmediatePropagation() {},
    });
    return prevented;
  };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(press(), true);
    const first = hydrateNow();
    await assert.rejects(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The held press became a full load of the link, the boot is the same failed one, and the next press is the link's.
    assert.deepEqual(loads, ["https://example.com/next"]);
    assert.equal(hydrateNow(), first);
    assert.equal(press(), false);
  } finally {
    console.error = error;
  }
});
