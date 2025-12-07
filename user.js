// ==UserScript==
// @name         规范化链接 - 替换Bilibili部分链接为带href的常规a元素
// @namespace    myitian.js.bili.NormalizeLinks
// @version      0.2
// @description  替换Bilibili部分链接为带href的常规a元素，以提升可访问性，获得原生链接的体验（如右键菜单的“在新标签页打开链接”“在新窗口打开链接”等选项）。
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
};
/**
 * @type {[target: Element, url: EventListenerOrEventListenerObject | null][]}
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
};
/**
 * @param {string} type
 * @param {EventListenerOrEventListenerObject | null} callback
 * @param {[options?: AddEventListenerOptions | boolean]} args
 */
EventTarget.prototype.addEventListener = function (type, callback, ...args) {
  if (this instanceof Element) {
    if (type === 'click') {
      const status = predicate(callback, this);
      switch (status) {
        case 1:
          if (tryInstantReplace && this.isConnected) {
            detectAndReplace(this, callback);
            return;
          }
          pending.push([this, callback]);
          break;
        case 2:
          pending.push([this, callback]);
          break;
      }
    }
  }
  originalAddEventListener.call(this, type, callback, ...args);
};

document.addEventListener('DOMContentLoaded', replace);
window.addEventListener('mousedown', replace);
window.addEventListener('keydown', replace);
window.addEventListener('load', () => {
  // 在load后处理。防止在框架注册的load执行完毕前就处理，导致内容错误。
  // 考虑到部分事件监听器可能是异步网络操作，需要尝试等待其完成。
  // 通常来说，等待时间不会太长，在1~3次循环内就能完成。
  // 如果100*100ms（十秒）后仍有剩余，将其剩余内容传递到全局window方便调试。
  console.log(`[BiliNrmLnk] processing ${pending.length} pending callback(s) after window.load`);
  let count = 100;
  const id = setInterval(() => {
    if (pending.length == 0 || count-- <= 0) {
      clearInterval(id);
      if (pending.length > 0) {
        unsafeWindow["__debug_BiliNrmLnk_pending"] = pending;
        unsafeWindow["__debug_BiliNrmLnk_detectAndReplace"] = detectAndReplace;
      }
      return;
    }
    replace();
    const oldPending = Array.from(pending);
    pending.length = 0;
    for (const it of oldPending) {
      if (!detectAndReplace(...it)) {
        pending.push(it);
      }
    }
  }, 100);
});

/**
 * @param {Element} target
 * @param {EventListenerOrEventListenerObject | null} callback
 */
function detectAndReplace(target, callback) {
  try {
    let mayHaveData = false;
    callState.special = true;
    // 使用假执行来获取真实链接
    if (typeof callback === 'function') {
      callback.call(this ?? window, dummyEvent);
      mayHaveData = true;
    } else if (typeof callback === 'object' && callback.handleEvent) {
      callback.handleEvent(dummyEvent);
      mayHaveData = true;
    }
    if (mayHaveData && callState.url !== "") {
      if (/\/\/space\.bilibili\.com\/0/.test(callState.url)) {
        console.warn("[BiliNrmLnk] Maybe wrong URL:", callState.url);
        // 可能是错误的结果，需要继续等待
        return false;
      }
      console.log(`[BiliNrmLnk] Found URL: ${callState.url}`);
      replaceUrl(changeElementToAnchor(target), callState.url);
    }
    return true;
  } finally {
    callState.url = "";
    callState.special = false;
  }
}

/**
 * 由于Bilibili采用了向非Anchor元素绑定闭包中的事件监听函数，这里尝试检查是否是可以处理的函数。
 * 这里可能随着Bilibili更新代码而不稳定，需要经常观察前端JS。
 * @param {*} func
 * @param {EventTarget} target
 * @returns {0|1|2} 0：匹配失败；1：尝试立即执行；2：准备延迟执行；
 */
function predicate(func, target) {
  if (/&&\s*[^.]+.preventDefault\s*\(\s*\)\s*,\s*[^.]+.stopPropagation\s*\(\s*\)\s*,\s*window\.open\([^(]*\(\s*[^.]+\.click\.url\s*,\s*[^.]+\.click\.name\s*\)\s*\)\s*\)\s*/.test(`${func}`)) {
    return 1;
  }
  if (target instanceof Element) {
    // 对于无法使用上面正则匹配的元素，如果在白名单就假定可以安全执行click
    if (target.classList.contains('up-name-text') || target.classList.contains('up-info__holder')) {
      return 2; // 疑似在window.load时，框架才获取数据。
    }
  }
  return 0;
}

function replace() {
  let c = 0;
  // 补充的特定目标修复——提供更准确的目标地址
  {
    /** @type {NodeListOf<HTMLAnchorElement>} */
    const urlCollectionTitle = document.querySelectorAll('.video-pod a.title.jumpable:not([data-bilinrmlnk-replaced])');
    for (const e of urlCollectionTitle) {
      const m = /\/\/space\.bilibili\.com\/([^\/]+)\/channel\/collectiondetail\?(?:.+&)?sid=([^&]+)/.exec(e.href);
      if (!m) continue;
      replaceUrl(e, `https://space.bilibili.com/${m[1]}/lists/${m[2]}`, true);
      c++;
    }
  }
  // 旧版替换逻辑
  c += basicReplace();
  if (c) {
    console.log(`[BiliNrmLnk] Replacement completed. ${c} element(s) effected.`);
  }
}

/**
 * 基于元素选择器的基础替换逻辑。其中部分内容可能过时，但在确定Bilibili完全不再使用对应逻辑后才能移除。
 */
function basicReplace() {
  let c = 0;
  if (location.pathname.startsWith("/read/readlist/")) {
    /** @type {NodeListOf<HTMLElement>} */
    const elements = document.querySelectorAll('.list-content .list-content-item[data-id]:not([data-bilinrmlnk-replaced])');
    for (const e of elements) {
      const url = `https://www.bilibili.com/read/cv${e.dataset.id}`;
      const title = e.querySelector(".title");
      if (title) {
        replaceUrl(wrapElementWithAnchor(title), url);
      }
      const desc = e.querySelector(".desc");
      if (desc) {
        replaceUrl(wrapElementWithAnchor(desc), url);
      }
      const cover = e.querySelector(".cover");
      if (cover) {
        replaceUrl(wrapElementWithAnchor(cover), url);
      }
      e.setAttribute("data-bilinrmlnk-replaced", "");
      c++;
    }
  }
  {
    /** @type {NodeListOf<HTMLAnchorElement>} */
    const elements = document.querySelectorAll('a.jump-link[data-url]:not([data-bilinrmlnk-replaced])');
    for (const e of elements) {
      replaceUrl(e);
      c++;
    }
  }
  {
    /** @type {NodeListOf<HTMLAnchorElement>} */
    const elements = document.querySelectorAll('a.jump-link[data-user-id]:not([data-bilinrmlnk-replaced])');
    for (const e of elements) {
      replaceFromAttribute(e, 'https://space.bilibili.com/', 'data-user-id');
      c++;
    }
  }
  {
    const elements = document.querySelectorAll('.bili-rich-text-module.at[data-oid]:not([data-bilinrmlnk-replaced])');
    for (const e of elements) {
      replaceFromAttribute(changeElementToAnchor(e), 'https://space.bilibili.com/', 'data-oid');
      c++;
    }
  }
  {
    const elements = document.querySelectorAll('.opus-text-rich-hl.at[data-rid]:not([data-bilinrmlnk-replaced])');
    for (const e of elements) {
      replaceFromAttribute(changeElementToAnchor(e), 'https://space.bilibili.com/', 'data-rid');
      c++;
    }
  }
  {
    const elements = document.querySelectorAll('.root-reply-avatar[data-user-id]:not([data-bilinrmlnk-replaced]),.user-name[data-user-id]:not([data-bilinrmlnk-replaced]),.sub-user-name[data-user-id]:not([data-bilinrmlnk-replaced]),.sub-reply-avatar[data-user-id]:not([data-bilinrmlnk-replaced])');
    for (const e of elements) {
      replaceFromAttribute(changeElementToAnchor(e), 'https://space.bilibili.com/', 'data-user-id');
      c++;
    }
  }
  return c;
}

/**
 * @param {HTMLAnchorElement} e
 * @param {string} newUrl
 * @param {boolean} lockSetAttributeHerf
 */
function replaceUrl(e, newUrl = undefined, lockSetAttributeHerf = false) {
  e.href = newUrl ?? e.dataset.url;
  e.setAttribute("data-bilinrmlnk-replaced", "");
  e.target = '_blank';
  e.onclick = null;
  originalAddEventListener.call(e, 'click', stopImmediatePropagation, true);
  if (lockSetAttributeHerf) {
    const originalSetAttribute = e.setAttribute;
    e.setAttribute = function (qualifiedName, value) {
      if (qualifiedName === "href") return;
      originalSetAttribute(qualifiedName, value);
    };
  }
}

/**
 * @param {HTMLAnchorElement} e
 * @param {string} base
 * @param {string} attr
 */
function replaceFromAttribute(e, base, attr) {
  e.href = base + e.getAttribute(attr);
  e.setAttribute("data-bilinrmlnk-replaced", "");
  e.target = '_blank';
  e.onclick = null;
  originalAddEventListener.call(e, 'click', stopImmediatePropagation, true);
}

/**
 * @param {Element} element
 */
function wrapElementWithAnchor(element) {
  const ne = document.createElement('a');
  const p = element.parentElement;
  p.insertBefore(ne, element);
  p.removeChild(element);
  ne.appendChild(element);
  return ne;
}

/**
 * @param {Element} element
 */
function changeElementToAnchor(element) {
  const ne = document.createElement('a');
  for (const t of element.attributes) {
    ne.setAttribute(t.name, t.value);
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

/** @type {Object<string,string>} */
const defaultDisplayCache = {};
/** @type {Set<string>} */
const displayCache = new Set();

/**
 * @param {string} tagName
 */
function getDefaultDisplay(tagName) {
  const tag = tagName.toLowerCase();
  let display = defaultDisplayCache[tag];
  if (display) {
    return `data-bilinrmlnk-display-${display}`;
  }
  const temp = document.createElement(tag);
  document.body.appendChild(temp);
  display = window.getComputedStyle(temp).display;
  const attrKey = `data-bilinrmlnk-display-${display}`;
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