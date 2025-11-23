// ==UserScript==
// @name         更好的链接 - 替换 Bilibili 部分链接为带 href 的常规 a 元素
// @namespace    myitian.js.bili.NormalizeLinks
// @version      0.1
// @description  替换 Bilibili 部分链接为带 href 的常规 a 元素，使其右键菜单出现“在新标签页打开链接”“在新窗口打开链接”等选项
// @source       https://github.com/Myitian/Bili.NormalizeLinks
// @author       Myitian
// @license      MIT
// @match        https://*.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

const tryInstantReplace = true;
// 覆盖addEventListener和window.open以执行自定义检查
const originalAddEventListener = EventTarget.prototype.addEventListener;
const originalWindowOpen = unsafeWindow.open;
const dummyEvent = new Event('click');
const callState = {
  special: false,
  url: ""
}
/**
 * @type {[target: Element, url: string][]}
 */
const pending = [];
/**
 * @param {string | URL} url
 * @param {[target?: string, features?: string]} args
 */
unsafeWindow.open = function (url, ...args) {
  if (callState.special) {
    callState.url = `${url}`;
  } else {
    return originalWindowOpen.call(this, url, ...args);
  }
}
/**
 * @param {string} type
 * @param {EventListenerOrEventListenerObject | null} callback
 * @param {[options?: AddEventListenerOptions | boolean]} args
 */
EventTarget.prototype.addEventListener = function (type, callback, ...args) {
  try {
    if (type === 'click') {
      callState.special = predicate(callback);
      if (callState.special) {
        // 使用假执行来获取真实链接
        if (typeof callback === 'function') {
          callback.call(this ?? window, dummyEvent);
        } else if (typeof callback === 'object' && callback.handleEvent) {
          callback.handleEvent(dummyEvent);
        }
      }
    }
    if (callState.url !== "" && this instanceof Element) {
      console.log(`[RBLTHA] Found URL: ${callState.url}`);
      if (tryInstantReplace && this.isConnected) {
        replaceUrl(changeElementToAnchor(this), callState.url);
      } else {
        pending.push([this, callState.url]);
      }
    } else {
      originalAddEventListener.call(this, type, callback, ...args);
    }
  } finally {
    callState.url = "";
    callState.special = false;
  }
}
/**
 * 由于Bilibili采用了向非Anchor元素绑定闭包中的事件监听函数，这里尝试检查是否是可以处理的函数。这里可能随着Bilibili更新代码而不稳定，需要经常观察前端JS。
 * @param {*} func 
 */
function predicate(func) {
  return /&&\s*[^.]+.preventDefault\s*\(\s*\)\s*,\s*[^.]+.stopPropagation\s*\(\s*\)\s*,\s*window\.open\([^(]*\(\s*[^.]+\.click\.url\s*,\s*[^.]+\.click\.name\s*\)\s*\)\s*\)\s*/.test(`${func}`);
}

let running = false;
let waitingCount = 0;
const eventTarget = new EventTarget();
const customEvent = new CustomEvent('proc_done');
/** @type {Object<string,string>} */
const defaultDisplayCache = {};
/** @type {Set<string>} */
const displayCache = new Set();

replace();
window.addEventListener('mousedown', replace);
window.addEventListener('keydown', replace);

/**
 * @param {EventTarget} target
 * @param {string} event
 */
function getPromiseFromEvent(target, event) {
  return new Promise((resolve) => {
    const listener = () => {
      target.removeEventListener(event, listener);
      resolve();
    }
    target.addEventListener(event, listener);
  })
}

async function replace() {
  if (waitingCount > 2) {
    console.log('[RBLTHA] Too many waiting replacement. Canceled new replacement.');
    return;
  }
  if (running) {
    waitingCount++;
    await getPromiseFromEvent(eventTarget, 'proc_done');
    waitingCount--;
  }
  running = true;
  if (pending.length > 0) {
    for (const it of pending) {
      replaceUrl(changeElementToAnchor(it[0]), it[1]);
    }
    pending.length = 0;
  }
  // 旧版替换逻辑。其中部分内容可能已经无法用于现在的Bilibili，但这些代码应该不会造成负面问题。
  let c = 0;
  /** @type {NodeListOf<HTMLAnchorElement>} */
  const urlA = document.querySelectorAll('a.jump-link[data-url]:not([data-rbltha-replaced])');
  for (const e of urlA) {
    replaceUrl(e);
    c++;
  }
  /** @type {NodeListOf<HTMLAnchorElement>} */
  const userA = document.querySelectorAll('a.jump-link[data-user-id]:not([data-rbltha-replaced])');
  for (const e of userA) {
    replaceUserId(e);
    c++;
  }
  const oidNA = document.querySelectorAll('.bili-rich-text-module.at[data-oid]:not([data-rbltha-replaced])');
  for (const e of oidNA) {
    replaceUserId(changeElementToAnchor(e), 'data-oid');
    c++;
  }
  const ridNA = document.querySelectorAll('.opus-text-rich-hl.at[data-rid]:not([data-rbltha-replaced])');
  for (const e of ridNA) {
    replaceUserId(changeElementToAnchor(e), 'data-rid');
    c++;
  }
  const userNA = document.querySelectorAll('.root-reply-avatar[data-user-id]:not([data-rbltha-replaced]),.user-name[data-user-id]:not([data-rbltha-replaced]),.sub-user-name[data-user-id]:not([data-rbltha-replaced]),.sub-reply-avatar[data-user-id]:not([data-rbltha-replaced])');
  for (const e of userNA) {
    replaceUserId(changeElementToAnchor(e));
    c++;
  }
  running = false;
  console.log(`[RBLTHA] Replacement completed. ${c} element(s) effected.`);
  eventTarget.dispatchEvent(customEvent);
}

/**
 * @param {HTMLAnchorElement} e 
 * @param {string} newUrl 
 */
function replaceUrl(e, newUrl = undefined) {
  e.href = newUrl ?? e.dataset.url;
  e.setAttribute("data-rbltha-replaced", "");
  e.target = '_blank';
  e.onclick = null;
  originalAddEventListener.call(e, 'click', stopImmediatePropagation, true);
}

/**
 * @param {HTMLAnchorElement} e 
 * @param {string} attr 
 */
function replaceUserId(e, attr = 'data-user-id') {
  e.href = 'https://space.bilibili.com/' + e.getAttribute(attr);
  e.setAttribute("data-rbltha-replaced", "");
  e.target = '_blank';
  e.onclick = null;
  originalAddEventListener.call(e, 'click', stopImmediatePropagation, true);
}

/**
 * @param {Element} element
 */
function changeElementToAnchor(element) {
  const ne = document.createElement('a');
  for (const t of element.attributes) {
    ne.setAttribute(t.name, t.value)
  }
  for (const t of Array.from(element.childNodes)) {
    ne.appendChild(t);
  }
  ne.setAttribute(getDefaultDisplay(element.tagName), "");
  const p = element.parentElement;
  const nxt = element.nextSibling;
  p.removeChild(element);
  p.insertBefore(ne, nxt);
  return ne;
}

/**
 * @param {string} tagName
 */
function getDefaultDisplay(tagName) {
  const tag = tagName.toLowerCase();
  let display = defaultDisplayCache[tag];
  if (display) {
    return `data-rbltha-display-${display}`;
  }
  const temp = document.createElement(tag);
  document.body.appendChild(temp);
  display = window.getComputedStyle(temp).display;
  const attrKey = `data-rbltha-display-${display}`;
  if (!displayCache.has(display)) {
    temp.outerHTML = `<style>:where([${attrKey}]){display:${display}}</style>`;
    displayCache.add(display);
  } else {
    document.body.removeChild(temp);
  }
  defaultDisplayCache[tag] = display;
  return attrKey;
}

/**
 * @param {Event} event
 */
function stopImmediatePropagation(event) {
  event.stopImmediatePropagation();
}