/**
 * phone-loader.js -- 统一手机 App 模块加载器
 * 替代 index.js / optimized-loader.js / independent-ai.js 中对 app/ 模块的重复加载
 * 运行环境：Android WebView + Node.js（不使用 ES Module、顶层 await、optional chaining 等）
 */

(function () {
  'use strict';

  var BASE_PATH = './scripts/extensions/third-party/mobile/';

  // ---------- 防重复 ----------
  if (window.Phone && window.Phone.ready) {
    console.log('[Phone Loader] 已加载，跳过');
    return;
  }

  // ---------- 模块注册表 ----------
  // name -> { src, globalVar, deps:[], loaded:false }
  var MODULES = [
    { name: 'phone-data-store',   src: 'phone-data-store.js',         globalVar: 'PhoneDataStore',    deps: [] },
    { name: 'friend-renderer',    src: 'app/friend-renderer.js',       globalVar: 'friendRenderer',    deps: ['phone-data-store'] },
    { name: 'message-renderer',   src: 'app/message-renderer.js',      globalVar: 'messageRenderer',   deps: ['friend-renderer'] },
    { name: 'message-sender',    src: 'app/message-sender.js',        globalVar: 'messageSender',     deps: ['message-renderer'] },
    { name: 'message-app',        src: 'app/message-app.js',           globalVar: 'messageApp',        deps: ['message-sender', 'phone-data-store'] },
    { name: 'attachment-sender', src: 'app/attachment-sender.js',     globalVar: 'attachmentSender', deps: ['message-app'] },
    { name: 'friends-circle',     src: 'app/friends-circle.js',        globalVar: 'FriendsCircle',     deps: ['message-app'] },
    { name: 'voice-message-handler', src: 'app/voice-message-handler.js', globalVar: 'voiceMessageHandler', deps: ['message-renderer'] },
    { name: 'phone-tts',         src: 'phone-tts.js',                 globalVar: 'phoneTTS',          deps: ['message-renderer'] },
    { name: 'bridge-api',        src: 'bridge-api.js',                globalVar: 'BridgeAPI',         deps: ['phone-tts', 'phone-data-store'] },
    { name: 'xiaobaix-bridge',   src: 'xiaobaix-bridge.js',           globalVar: 'XBBridge',          deps: ['bridge-api'] },
    { name: 'role-api',          src: 'role-api.js',                  globalVar: 'RoleAPI',           deps: ['bridge-api'] },
    { name: 'social-api',        src: 'social-api.js',                globalVar: 'SocialAPI',         deps: ['bridge-api'] },
    { name: 'worldbook-contact', src: 'worldbook-contact.js',         globalVar: 'WorldbookContact',  deps: ['xiaobaix-bridge'] },
    { name: 'memory-bridge',     src: 'memory-bridge.js',             globalVar: 'MemoryBridge',      deps: ['xiaobaix-bridge', 'role-api'] },
    { name: 'bridge-client',     src: 'bridge-client.js',             globalVar: 'BridgeClient',      deps: [] },
    { name: 'quest-engine',       src: 'quest-engine.js',              globalVar: 'QuestEngine',       deps: ['bridge-api', 'phone-data-store'] },
    { name: 'pending-msg-event-patch', src: 'pending-msg-event-patch.js', globalVar: 'PendingMsgPatch', deps: ['bridge-api'] },
    { name: 'quest-planner-bridge',   src: 'quest-planner-bridge.js',   globalVar: 'QuestPlannerBridge',    deps: ['quest-engine', 'xiaobaix-bridge', 'role-api'] },
    { name: 'quest-app',              src: 'quest-app.js',              globalVar: 'QuestApp',              deps: ['quest-engine', 'quest-planner-bridge'] },
    { name: 'quick-reply-bridge',    src: 'quick-reply-bridge.js',     globalVar: 'QuickReplyBridge',      deps: ['bridge-api'] }
  ];

  // CSS 文件（无依赖，可并行加载）
  var CSS_FILES = [
    'app/message-renderer.css',
    'app/message-app.css',
    'quest-app.css'
  ];

  // ---------- Phone 命名空间 ----------
  var Phone = {
    ready: false,
    loading: false,
    _moduleMap: {},   // name -> module config
    _loadOrder: [],
    _onReady: null    // callback when all done
  };

  // 构建快速查找表
  for (var i = 0; i < MODULES.length; i++) {
    var m = MODULES[i];
    m.loaded = false;
    Phone._moduleMap[m.name] = m;
  }

  // ---------- 工具函数 ----------

  function loadScript(src, callback) {
    var url = BASE_PATH + src;
    var script = document.createElement('script');
    script.src = url;
    script.onload = function () {
      callback(null, src);
    };
    script.onerror = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
      callback(new Error('Failed to load: ' + src), src);
    };
    document.head.appendChild(script);
  }

  function loadCSS(href, callback) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = BASE_PATH + href;
    link.onload = function () {
      callback(null, href);
    };
    link.onerror = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
      callback(new Error('Failed to load CSS: ' + href), href);
    };
    document.head.appendChild(link);
  }

  function checkGlobalVar(name) {
    var mod = Phone._moduleMap[name];
    if (!mod) return true;
    if (mod.globalVar && window[mod.globalVar]) return true;
    return false;
  }

  // ---------- 拓扑排序（按依赖顺序） ----------
  function getLoadOrder() {
    var visited = {};
    var order = [];
    var visiting = {};

    function visit(name) {
      if (visited[name]) return;
      if (visiting[name]) {
        console.warn('[Phone Loader] 检测到循环依赖:', name);
        return;
      }
      visiting[name] = true;
      var mod = Phone._moduleMap[name];
      if (mod) {
        for (var i = 0; i < mod.deps.length; i++) {
          visit(mod.deps[i]);
        }
      }
      visiting[name] = false;
      visited[name] = true;
      order.push(name);
    }

    for (var i = 0; i < MODULES.length; i++) {
      visit(MODULES[i].name);
    }
    return order;
  }

  // ---------- 核心加载逻辑 ----------
  function loadAllModules(onComplete) {
    if (Phone.ready) {
      if (onComplete) onComplete();
      return;
    }
    if (Phone.loading) {
      // 如果正在加载中，排队回调
      var prev = Phone._onReady;
      Phone._onReady = function () {
        if (prev) prev();
        if (onComplete) onComplete();
      };
      return;
    }

    Phone.loading = true;
    console.log('[Phone Loader] 开始加载 app/ 层模块...');

    // 1. 并行加载所有 CSS
    var cssPending = CSS_FILES.length;
    for (var c = 0; c < CSS_FILES.length; c++) {
      loadCSS(CSS_FILES[c], function (err, href) {
        if (err) {
          console.warn('[Phone Loader]', err.message);
        } else {
          console.log('[Phone Loader] CSS loaded:', href);
        }
        cssPending--;
      });
    }

    // 2. 按依赖顺序串行加载 JS 模块
    var order = getLoadOrder();
    var idx = 0;

    function loadNext() {
      if (idx >= order.length) {
        // 全部加载完成
        Phone.ready = true;
        Phone.loading = false;
        window.__phoneLoaded = true;
        window.__phoneLoading = false;
        console.log('[Phone Loader] 所有模块加载完成，顺序:', Phone._loadOrder);
        
        // [PhoneDataStore集成] 通知 PhoneDataStore 模块就绪
        if (window.PhoneDataStore) {
          PhoneDataStore.moduleReady('phone-loader');
          console.log('[Phone Loader] 已通知 PhoneDataStore 模块就绪');
        }
        
        // [修复] 通知 messageApp 就绪
        if (window.messageApp && window.PhoneDataStore) {
          PhoneDataStore.moduleReady('messageApp');
        }
        
        if (Phone._onReady) {
          Phone._onReady();
          Phone._onReady = null;
        }
        if (onComplete) onComplete();
        return;
      }

      var name = order[idx];
      var mod = Phone._moduleMap[name];

      // 如果已加载（全局变量已存在），跳过
      if (mod.loaded || checkGlobalVar(name)) {
        mod.loaded = true;
        Phone._loadOrder.push(name + '(cached)');
        console.log('[Phone Loader] 模块已存在，跳过:', name);
        idx++;
        loadNext();
        return;
      }

      console.log('[Phone Loader] 正在加载模块:', name, '(' + mod.src + ')');
      loadScript(mod.src, function (err, src) {
        if (err) {
          console.error('[Phone Loader]', err.message);
        } else {
          console.log('[Phone Loader] 模块加载完成:', name);
        }

        // 检查全局变量是否已创建
        mod.loaded = true;
        if (checkGlobalVar(name)) {
          Phone._loadOrder.push(name);
          console.log('[Phone Loader] 全局变量已创建:', mod.globalVar);
        } else {
          Phone._loadOrder.push(name + '(warn: no global)');
          console.warn('[Phone Loader] 模块加载但全局变量未创建:', name, '->', mod.globalVar);
        }

        idx++;
        loadNext();
      });
    }

    loadNext();
  }

  // ---------- 公共 API ----------

  /**
   * 获取已加载的模块
   * @param {string} name 模块名（如 'message-renderer'）
   * @returns {*} 全局变量值，未加载返回 undefined
   */
  Phone.getModule = function (name) {
    var mod = Phone._moduleMap[name];
    if (!mod) {
      console.warn('[Phone Loader] 未知模块:', name);
      return undefined;
    }
    if (mod.globalVar) {
      return window[mod.globalVar];
    }
    return undefined;
  };

  /**
   * 检查所有模块是否加载完成
   * @returns {boolean}
   */
  Phone.isReady = function () {
    return Phone.ready;
  };

  /**
   * 获取加载顺序记录
   * @returns {string[]}
   */
  Phone.getLoadOrder = function () {
    return Phone._loadOrder.slice();
  };

  /**
   * 获取模块状态
   * @returns {Object} { name: { loaded, globalExists } }
   */
  Phone.getStatus = function () {
    var status = {};
    for (var i = 0; i < MODULES.length; i++) {
      var name = MODULES[i].name;
      var mod = Phone._moduleMap[name];
      status[name] = {
        loaded: mod.loaded,
        globalExists: checkGlobalVar(name)
      };
    }
    return status;
  };

  /**
   * 手动触发加载（供 index.js 调用）
   * @param {Function} [callback] 加载完成回调
   */
  Phone.load = function (callback) {
    loadAllModules(callback);
  };

  // ---------- 挂载全局 ----------
  window.Phone = Phone;

  console.log('[Phone Loader] 统一加载器已就绪，等待 Phone.load() 调用');
})();
