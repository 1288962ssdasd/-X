// ============================================================
// xiaobaix-bridge.js -- 小白X桥接适配层
// 职责：统一封装小白X（LittleWhiteBox）桥接服务，提供Promise化API
// 运行环境：Android WebView + Node.js（不使用 ES Module、顶层 await、optional chaining 等）
// ============================================================

(function () {
  'use strict';

  // ===== 常量 =====
  var LOG_PREFIX = '[XBBridge]';
  var TIMEOUT_MS = 10000;
  var SOURCE_TAG = 'xiaobaix-client';

  // ===== 工具函数 =====

  /**
   * 生成唯一请求ID
   * 格式: xbb_req_<timestamp>_<random5>
   */
  function generateRequestId() {
    return 'xbb_req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  }

  /**
   * 日志输出
   */
  function log() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.log.apply(console, args);
  }

  function warn() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.warn.apply(console, args);
  }

  function logError() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.error.apply(console, args);
  }

  // ===== 特性检测 =====

  /**
   * 检查小白X桥接服务是否存在于 window 上
   */
  function isAvailable() {
    var hasWorldbook = !!(window.xiaobaixWorldbookService);
    var hasGenerate = !!(window.xiaobaixCallGenerateService);
    var hasContextBridge = !!(window.LittleWhiteBox && window.LittleWhiteBox.contextBridge);
    var hasEventCenter = !!(window.xbEventCenter);
    var available = hasWorldbook || hasGenerate || hasContextBridge || hasEventCenter;
    return available;
  }

  /**
   * 检查小白X是否启用
   */
  function isEnabled() {
    return !!window.isXiaobaixEnabled;
  }

  /**
   * 细粒度检测：世界书服务是否可用
   * @returns {boolean}
   */
  function isWorldbookAvailable() {
    return !!(window.xiaobaixWorldbookService);
  }

  /**
   * 细粒度检测：AI生成服务是否可用
   * @returns {boolean}
   */
  function isGenerateAvailable() {
    return !!(window.xiaobaixCallGenerateService);
  }

  // ===== postMessage 通信核心 =====

  /**
   * 通过 postMessage 发送请求并等待响应
   * @param {string} type - 消息类型 ('worldbookRequest', 'generate', 'generateStream')
   * @param {string} action - 操作名称
   * @param {object} params - 参数
   * @returns {Promise} 响应数据
   */
  function postMessageRequest(type, action, params) {
    return new Promise(function (resolve, reject) {
      // 检查小白X是否可用
      if (!isAvailable()) {
        warn('postMessageRequest: 小白X不可用, type=' + type + ', action=' + action);
        reject(new Error('XBBridge: 小白X不可用'));
        return;
      }

      var requestId = generateRequestId();
      var message = {
        source: SOURCE_TAG,
        type: type,
        id: requestId,
        action: action,
        params: params
      };

      log('postMessageRequest: 发送请求', type, action, requestId);

      // 设置超时
      var timeoutId = setTimeout(function () {
        logError('postMessageRequest: 超时', type, action, requestId);
        cleanup();
        reject(new Error('XBBridge: 请求超时 (' + TIMEOUT_MS + 'ms), action=' + action));
      }, TIMEOUT_MS);

      // 响应处理函数
      function handler(event) {
        var data = event.data;
        if (!data) return;
        // 匹配请求ID
        if (data.id !== requestId) return;
        // 匹配来源
        if (data.source !== 'xiaobaix-server' && data.source !== 'xiaobaix-client') return;

        log('postMessageRequest: 收到响应', requestId, data.type || '');

        cleanup();

        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.result !== undefined ? data.result : data);
        }
      }

      function cleanup() {
        clearTimeout(timeoutId);
        window.removeEventListener('message', handler);
      }

      window.addEventListener('message', handler);

      // 发送消息
      window.postMessage(message, '*');
    });
  }

  // ===== 直接方法调用（高性能路径） =====

  /**
   * 尝试直接调用 xiaobaixWorldbookService.handleRequest
   * 如果不可用则回退到 postMessage
   * @param {string} action - 操作名称
   * @param {object} params - 参数
   * @returns {Promise} 响应数据
   */
  function directCall(action, params) {
    var service = window.xiaobaixWorldbookService;
    if (service && typeof service.handleRequest === 'function') {
      log('_directCall: 使用直接调用路径', action);
      try {
        var result = service.handleRequest(action, params);
        // handleRequest 可能返回 Promise
        if (result && typeof result.then === 'function') {
          return result.then(function (data) {
            log('_directCall: 直接调用成功', action);
            return data;
          }).catch(function (err) {
            warn('_directCall: 直接调用失败, 回退到postMessage', action, err);
            return postMessageRequest('worldbookRequest', action, params);
          });
        }
        log('_directCall: 直接调用成功(同步)', action);
        return Promise.resolve(result);
      } catch (e) {
        warn('_directCall: 直接调用异常, 回退到postMessage', action, e);
        return postMessageRequest('worldbookRequest', action, params);
      }
    }
    // 回退到 postMessage
    return postMessageRequest('worldbookRequest', action, params);
  }

  // ===== 世界书 CRUD 封装 =====

  var worldbook = {
    /**
     * 获取聊天绑定世界书
     * @param {object} params - 参数
     * @returns {Promise}
     */
    getChatBook: function (params) {
      log('worldbook.getChatBook');
      return directCall('getChatBook', params || {});
    },

    /**
     * 获取全局世界书列表
     * @returns {Promise}
     */
    getGlobalBooks: function () {
      log('worldbook.getGlobalBooks');
      return directCall('getGlobalBooks', {});
    },

    /**
     * 获取角色卡世界书
     * @param {object} params - 参数
     * @returns {Promise}
     */
    getCharBook: function (params) {
      log('worldbook.getCharBook');
      return directCall('getCharBook', params || {});
    },

    /**
     * 模糊搜索条目
     * @param {object} params - {file, field, text}
     * @returns {Promise}
     */
    findEntry: function (params) {
      var p = params || {};
      // 预校验：file 参数为空时直接返回空数组，避免 VALIDATION_FAILED 刷屏
      if (!p.file || p.file.trim() === '') {
        log('worldbook.findEntry: file 参数为空，返回空数组');
        return Promise.resolve([]);
      }
      log('worldbook.findEntry', p);
      return directCall('findEntry', p);
    },

    /**
     * 创建条目
     * @param {object} params - {file, key?, content?}
     * @returns {Promise}
     */
    createEntry: function (params) {
      log('worldbook.createEntry', params);
      return directCall('createEntry', params || {});
    },

    /**
     * 设置条目字段
     * @param {object} params - {file, uid, field, value}
     * @returns {Promise}
     */
    setEntryField: function (params) {
      log('worldbook.setEntryField', params);
      return directCall('setEntryField', params || {});
    },

    /**
     * 获取条目字段
     * @param {object} params - {file, uid, field}
     * @returns {Promise}
     */
    getEntryField: function (params) {
      log('worldbook.getEntryField', params);
      return directCall('getEntryField', params || {});
    },

    /**
     * 删除条目
     * @param {object} params - {file, uid}
     * @returns {Promise}
     */
    deleteEntry: function (params) {
      log('worldbook.deleteEntry', params);
      return directCall('deleteEntry', params || {});
    },

    /**
     * 列出条目
     * @param {object} params - {file}
     * @returns {Promise}
     */
    listEntries: function (params) {
      var p = params || {};
      // 预校验：file 参数为空时直接返回空数组，避免 VALIDATION_FAILED 刷屏
      if (!p.file || p.file.trim() === '') {
        log('worldbook.listEntries: file 参数为空，返回空数组');
        return Promise.resolve([]);
      }
      log('worldbook.listEntries', p);
      return directCall('listEntries', p);
    },

    /**
     * 列出所有世界书
     * @returns {Promise}
     */
    listWorldbooks: function () {
      log('worldbook.listWorldbooks');
      return directCall('listWorldbooks', {});
    },

    /**
     * 切换世界书开关
     * @param {object} params - {state, name?}
     * @returns {Promise}
     */
    world: function (params) {
      log('worldbook.world', params);
      return directCall('world', params || {});
    },

    /**
     * 内部方法：直接调用（高性能路径）
     * 优先尝试直接调用 handleRequest，失败则回退 postMessage
     * @param {string} action - 操作名称
     * @param {object} params - 参数
     * @returns {Promise}
     */
    _directCall: function (action, params) {
      return directCall(action, params);
    }
  };

  // ===== AI 生成调用封装 =====

  var generate = {
    /**
     * 非流式生成
     * @param {object} options - 生成选项
     * @param {string} options.provider - 提供者 (如 'inherit')
     * @param {Array} options.messages - 消息数组 [{role, content}]
     * @param {number} [options.max_tokens] - 最大token数
     * @param {number} [options.temperature] - 温度
     * @returns {Promise} 生成结果
     */
    generate: function (options) {
      if (!isAvailable()) {
        warn('generate.generate: 小白X不可用');
        return Promise.reject(new Error('XBBridge: 小白X不可用'));
      }

      log('generate.generate', options);
      return postMessageRequest('generate', null, options || {});
    },

    /**
     * 流式生成
     * @param {object} options - 生成选项
     * @param {function} onChunk - 收到数据块回调 (chunk: string)
     * @param {function} onDone - 完成回调 (fullText: string)
     * @param {function} onError - 错误回调 (error: Error)
     */
    generateStream: function (options, onChunk, onDone, onError) {
      if (!isAvailable()) {
        warn('generate.generateStream: 小白X不可用');
        if (typeof onError === 'function') {
          onError(new Error('XBBridge: 小白X不可用'));
        }
        return;
      }

      log('generate.generateStream', options);

      var requestId = generateRequestId();
      var message = {
        source: SOURCE_TAG,
        type: 'generateStream',
        id: requestId,
        options: options || {}
      };

      var fullText = '';
      var timeoutId = null;
      var streamDone = false;

      function handler(event) {
        var data = event.data;
        if (!data) return;
        if (data.id !== requestId) return;
        if (data.source !== 'xiaobaix-server' && data.source !== 'xiaobaix-client') return;

        // 流式数据块
        if (data.chunk) {
          fullText += data.chunk;
          if (typeof onChunk === 'function') {
            try {
              onChunk(data.chunk, fullText);
            } catch (e) {
              warn('generateStream: onChunk回调异常', e);
            }
          }
        }

        // 流结束
        if (data.done) {
          streamDone = true;
          cleanup();
          log('generateStream: 完成', requestId);
          if (typeof onDone === 'function') {
            try {
              onDone(fullText);
            } catch (e) {
              warn('generateStream: onDone回调异常', e);
            }
          }
        }

        // 错误
        if (data.error) {
          cleanup();
          logError('generateStream: 错误', requestId, data.error);
          if (typeof onError === 'function') {
            try {
              onError(new Error(data.error));
            } catch (e) {
              warn('generateStream: onError回调异常', e);
            }
          }
        }
      }

      function cleanup() {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        window.removeEventListener('message', handler);
      }

      // 超时处理
      timeoutId = setTimeout(function () {
        if (streamDone) return;
        logError('generateStream: 超时', requestId);
        cleanup();
        if (typeof onError === 'function') {
          try {
            onError(new Error('XBBridge: 流式生成超时 (' + TIMEOUT_MS + 'ms)'));
          } catch (e) {
            warn('generateStream: onError回调异常(超时)', e);
          }
        }
      }, TIMEOUT_MS);

      window.addEventListener('message', handler);
      window.postMessage(message, '*');
    }
  };

  // ===== 上下文快照获取 =====

  var context = {
    /**
     * 从 SillyTavern.getContext() 获取上下文快照
     * @returns {object|null} 上下文快照对象，不可用时返回null
     */
    getSnapshot: function () {
      log('context.getSnapshot');

      try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
          var ctx = SillyTavern.getContext();
          if (ctx) {
            var snapshot = {
              chatId: ctx.chatId || '',
              characterId: ctx.characterId || 0,
              characterName: ctx.characterName || '',
              userName: ctx.userName || 'User',
              chat: ctx.chat || [],
              characters: ctx.characters || []
            };
            log('context.getSnapshot: 成功获取上下文快照');
            return snapshot;
          }
        }
      } catch (e) {
        warn('context.getSnapshot: 获取上下文失败', e);
      }

      // 尝试备用路径
      try {
        if (window.getContext) {
          var ctx2 = window.getContext();
          if (ctx2) {
            var snapshot2 = {
              chatId: ctx2.chatId || '',
              characterId: ctx2.characterId || 0,
              characterName: ctx2.characterName || '',
              userName: ctx2.userName || 'User',
              chat: ctx2.chat || [],
              characters: ctx2.characters || []
            };
            log('context.getSnapshot: 通过window.getContext获取成功');
            return snapshot2;
          }
        }
      } catch (e2) {
        warn('context.getSnapshot: 备用路径也失败', e2);
      }

      warn('context.getSnapshot: 无法获取上下文快照');
      return null;
    }
  };

  // ===== ST 事件监听 =====

  var events = {
    /**
     * 监听ST事件
     * @param {string} eventName - 事件名称
     * @param {function} handler - 事件处理函数
     */
    on: function (eventName, handler) {
      log('events.on', eventName);

      try {
        if (window.eventSource && typeof window.eventSource.on === 'function') {
          window.eventSource.on(eventName, handler);
          return;
        }
      } catch (e) {
        warn('events.on: eventSource.on 失败', e);
      }

      // 备用路径：尝试使用 SillyTavern 事件系统
      try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.on === 'function') {
          SillyTavern.on(eventName, handler);
          return;
        }
      } catch (e2) {
        warn('events.on: SillyTavern.on 失败', e2);
      }

      // 最终备用：jQuery 事件（ST 使用 jQuery）
      try {
        if (window.$ && typeof window.$.on === 'function') {
          window.$(document).on(eventName, handler);
          log('events.on: 使用jQuery备用路径', eventName);
          return;
        }
      } catch (e3) {
        warn('events.on: jQuery备用路径失败', e3);
      }

      warn('events.on: 无法注册事件监听', eventName);
    },

    /**
     * 移除ST事件监听
     * @param {string} eventName - 事件名称
     * @param {function} handler - 事件处理函数
     */
    off: function (eventName, handler) {
      log('events.off', eventName);

      try {
        if (window.eventSource && typeof window.eventSource.off === 'function') {
          window.eventSource.off(eventName, handler);
          return;
        }
      } catch (e) {
        warn('events.off: eventSource.off 失败', e);
      }

      // 备用路径
      try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.off === 'function') {
          SillyTavern.off(eventName, handler);
          return;
        }
      } catch (e2) {
        warn('events.off: SillyTavern.off 失败', e2);
      }

      // jQuery 备用
      try {
        if (window.$ && typeof window.$.off === 'function') {
          window.$(document).off(eventName, handler);
          log('events.off: 使用jQuery备用路径', eventName);
          return;
        }
      } catch (e3) {
        warn('events.off: jQuery备用路径失败', e3);
      }

      warn('events.off: 无法移除事件监听', eventName);
    }
  };

  // ===== 暴露的ST事件名常量 =====
  var EVENT_NAMES = {
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    CHAT_CHANGED: 'CHAT_CHANGED',
    CHAT_CREATED: 'CHAT_CREATED',
    CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
    GENERATE_AFTER: 'GENERATE_AFTER'
  };

  // ===== 组装 XBBridge 对象 =====

  var XBBridge = {
    // 特性检测
    isAvailable: isAvailable,
    isEnabled: isEnabled,
    isWorldbookAvailable: isWorldbookAvailable,
    isGenerateAvailable: isGenerateAvailable,

    // 世界书 CRUD
    worldbook: worldbook,

    // AI 生成调用
    generate: generate,

    // 上下文快照
    context: context,

    // ST 事件监听
    events: events,

    // 事件名常量
    EVENT_NAMES: EVENT_NAMES
  };

  // ===== 挂载全局 =====
  window.XBBridge = XBBridge;

  // ===== 初始化日志 =====
  log('模块已加载');
  log('小白X可用:', isAvailable());
  log('小白X启用:', isEnabled());

})();
