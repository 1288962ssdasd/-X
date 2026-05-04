// ============================================================
// bridge-api.js -- 桥接API模块 + PhoneEngine 工作流引擎
// 职责：ConfigManager + 变量管理 + 聊天摘要 + PluginBridge双通道
//       + EventBus事件总线 + UnifiedAI统一AI + WorkflowEngine工作流引擎
// 运行环境：Android WebView + Node.js（ES5语法，无ES6+特性）
// ============================================================

(function () {
  'use strict';

  // ============================================================
  // 第一部分：EventBus 统一事件总线
  // ============================================================
  var EventBus = {
    _listeners: {},       // { eventName: [{ callback, id, priority }] }
    _onceMap: {},         // { listenerId: true }
    _history: [],         // 事件历史记录
    _maxHistory: 100,
    _idCounter: 0,

    /**
     * 注册事件监听
     * @param {string} event - 事件名（支持通配符 * 在末尾）
     * @param {Function} callback - 回调函数
     * @param {Object} [options] - 选项 { priority: 0 }
     * @returns {Function} 取消监听函数
     */
    on: function (event, callback, options) {
      if (typeof callback !== 'function') return function () {};
      var priority = (options && options.priority) || 0;
      var id = ++this._idCounter;
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push({ callback: callback, id: id, priority: priority });
      // 按优先级排序（高优先级先执行）
      this._listeners[event].sort(function (a, b) { return b.priority - a.priority; });
      var self = this;
      return function () { self.offById(event, id); };
    },

    /**
     * 注册一次性监听
     */
    once: function (event, callback) {
      var self = this;
      var off = this.on(event, function () {
        off();
        callback.apply(null, arguments);
      });
      return off;
    },

    /**
     * 通过ID移除监听
     */
    offById: function (event, id) {
      var list = this._listeners[event];
      if (!list) return;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].id === id) {
          list.splice(i, 1);
          break;
        }
      }
    },

    /**
     * 通过回调函数移除监听
     */
    off: function (event, callback) {
      var list = this._listeners[event];
      if (!list) return;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].callback === callback) {
          list.splice(i, 1);
          break;
        }
      }
    },

    /**
     * 触发事件
     * @param {string} event - 事件名
     * @param {*} data - 事件数据
     */
    emit: function (event, data) {
      // 记录历史
      this._history.push({ event: event, data: data, timestamp: Date.now() });
      if (this._history.length > this._maxHistory) {
        this._history.shift();
      }

      // 精确匹配监听器
      this._emitToListeners(event, data);

      // 通配符匹配（phone.* 匹配 phone.anything）
      var dotIdx = event.indexOf('.');
      if (dotIdx > 0) {
        var prefix = event.substring(0, dotIdx + 1) + '*';
        this._emitToListeners(prefix, data);
      }
      // 全局通配符
      this._emitToListeners('*', { event: event, data: data });
    },

    _emitToListeners: function (eventKey, data) {
      var list = this._listeners[eventKey];
      if (!list) return;
      // 复制一份防止回调中修改列表
      var copy = list.slice();
      for (var i = 0; i < copy.length; i++) {
        try {
          copy[i].callback(data);
        } catch (e) {
          console.warn('[EventBus] 事件处理器错误 (' + eventKey + '):', e);
        }
      }
    },

    /**
     * 获取事件历史
     */
    getHistory: function (eventFilter, limit) {
      var filtered = this._history;
      if (eventFilter) {
        filtered = [];
        for (var i = 0; i < this._history.length; i++) {
          if (this._history[i].event === eventFilter) {
            filtered.push(this._history[i]);
          }
        }
      }
      var n = limit || 20;
      return filtered.slice(-n);
    },

    /**
     * 清除所有监听器
     */
    clear: function () {
      this._listeners = {};
      this._history = [];
    }
  };

  // ============================================================
  // 第二部分：ConfigManager（共享配置管理器）
  // ============================================================
  var ConfigManager = {
    _cache: null,
    _cacheTime: 0,
    CACHE_TTL: 30000,
    _varCache: {},       // [修复v2] 单变量短期缓存，减少 STscript 调用
    _varCacheTTL: 2000,  // 2秒缓存

    defaults: {
      'xb.phone.api.enabled': 'true',
      'xb.phone.api.url': '',
      'xb.phone.api.key': '',
      'xb.phone.api.model': '',
      'xb.phone.api.temperature': '0.8',
      'xb.phone.api.maxTokens': '500',
      'xb.phone.autoMsg.enabled': 'true',
      'xb.phone.autoMsg.interval': '60',
      'xb.phone.autoMsg.probability': '30',
      'xb.phone.bizyair.enabled': 'false',
      'xb.phone.bizyair.probability': '30',
      'xb.phone.bizyair.cooldown': '30',
      'xb.phone.bizyair.autoGenerate': 'true',
      'xb.phone.bizyair.triggerProbability': '30',
      'xb.phone.image.autoInsert': 'true',
      'xb.phone.image.interval': '5',
      'xb.phone.image.sceneDetection': 'true',
      'xb.game.activeChar': '苏晚晴',
      'xb.game.phase': '完全职业',
      'xb.game.scene': '翡翠湾小区',
      'xb.game.money': '10000',
      'xb.game.rose': '0',
      'xb.game.friends': '',
      'xb.phone.pendingFriend': '',
      'xb.phone.moments.enabled': 'false',
      'xb.phone.moments.last': '',
      'xb.phone.lastMsg.from': '',
      'xb.phone.lastMsg.time': '',
      'xb.bizyair.autoGen': 'false',
      'xb.bizyair.activeChar': '',
      'xb.ui.hideStateBlocks': 'true',
      'xb.ui.hideThinking': 'true',
      'xb.ui.beautifyFriends': 'true',
      'xb.ui.renderQuickReply': 'true',
      'xb.ui.hideMainChat': 'false',
      'xb.phone.api.useXBBridge': 'true',
      'xb.phone.context.autoSync': 'true',
      'xb.phone.memory.autoSync': 'true',
      'xb.phone.contact.autoSync': 'true',
      'xb.phone.contact.syncInterval': '60',
      'xb.quest.enabled': 'true',
      'xb.quest.pendingNotify': '',
      'xb.quest.lastCompleted': '',
      'xb.quest.lastCompletedType': '',
      'xb.quest.lastCompletedResult': ''
    },

    _readVar: function (key) {
      var self = this;
      // 短期缓存：同一变量2秒内不重复 HTTP 请求
      var now = Date.now();
      var cached = self._varCache[key];
      if (cached && (now - cached.time) < self._varCacheTTL) {
        return Promise.resolve(cached.value);
      }
      return fetch('/api/plugins/xb-bridge-test/var/' + encodeURIComponent(key))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var result = (d && d.data && d.data.value !== undefined && d.data.value !== null && d.data.value !== '') ? d.data.value : null;
          self._varCache[key] = { value: result, time: Date.now() };
          return result;
        })
        .catch(function () {
          // HTTP 失败时返回默认值
          return self.defaults[key] || null;
        });
    },

    _writeVar: function (key, value) {
      var self = this;
      var strValue = String(value);
      return fetch('/api/plugins/xb-bridge-test/var/' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: strValue })
      })
      .then(function (r) { return r.ok; })
      .then(function (success) {
        if (success) {
          self._cache = null;
          delete self._varCache[key];
        }
        return success;
      })
      .catch(function (e) {
        console.warn('[ConfigManager] HTTP 写入失败:', key, e);
        return false;
      });
    },

    getSync: function (key) {
      var self = this;
      // 纯缓存模式：从短期缓存或全量缓存读取，不发起网络请求
      var cached = self._varCache[key];
      if (cached && (Date.now() - cached.time) < self._varCacheTTL) {
        return cached.value;
      }
      if (self._cache && self._cache[key] !== undefined) {
        return self._cache[key];
      }
      return self.defaults[key] || null;
    },

    getAll: function () {
      var self = this;
      var now = Date.now();
      if (self._cache && (now - self._cacheTime) < self.CACHE_TTL) {
        return Promise.resolve(self._cache);
      }
      var config = {};
      var keys = Object.keys(self.defaults);
      var chain = Promise.resolve();
      for (var i = 0; i < keys.length; i++) {
        (function (key) {
          chain = chain.then(function () {
            return self._readVar(key);
          }).then(function (val) {
            if (val !== null) {
              config[key] = val;
            } else {
              config[key] = self.defaults[key];
            }
          });
        })(keys[i]);
      }
      return chain.then(function () {
        self._cache = config;
        self._cacheTime = Date.now();
        return config;
      });
    },

    get: function (key) {
      var self = this;
      return self._readVar(key).then(function (val) {
        if (val !== null && val !== '') {
          return val;
        }
        return self.defaults[key] || null;
      });
    },

    set: function (key, value) {
      var self = this;
      return self._writeVar(key, value).then(function (success) {
        if (success) {
          EventBus.emit('variable:changed', {
            key: key,
            value: String(value),
            timestamp: Date.now(),
            source: 'configManager'
          });
        }
        return success;
      });
    },

    deleteVar: function (key) {
      var self = this;
      return fetch('/api/plugins/xb-bridge-test/var/' + encodeURIComponent(key), {
        method: 'DELETE'
      })
      .then(function (r) { return r.ok; })
      .then(function (success) {
        if (success) {
          self._cache = null;
          delete self._varCache[key];
        }
        return success;
      })
      .catch(function () { return false; });
    },

    listVar: function (prefix) {
      return fetch('/api/plugins/xb-bridge-test/var/list/' + encodeURIComponent(prefix))
        .then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.keys) ? d.keys : []; })
        .catch(function () { return []; });
    },

    init: function () {
      console.log('[ConfigManager] 初始化完成');
    }
  };

  // ============================================================
  // 第三部分：UnifiedAI 统一AI调用接口
  // 消除 shop-app、friends-circle、task-app 中重复的 generateViaPhoneAI()
  // ============================================================
  var UnifiedAI = {
    _backends: [],
    _callStats: { total: 0, success: 0, failed: 0, byBackend: {} },

    /**
     * 初始化后端优先级链
     * 优先级: customAPI(100) > RoleAPI(80) > XBBridge(60)
     */
    init: function () {
      var self = this;
      self._backends = [
        {
          name: 'customAPI',
          available: function () {
            return !!(window.mobileCustomAPIConfig &&
              window.mobileCustomAPIConfig.currentSettings &&
              window.mobileCustomAPIConfig.currentSettings.apiKey &&
              window.mobileCustomAPIConfig.currentSettings.apiKey !== '你的API Key');
          },
          call: function (prompt, options) {
            return self._callCustomAPI(prompt, options);
          },
          priority: 100
        },
        {
          name: 'RoleAPI',
          available: function () {
            return !!(window.RoleAPI && typeof window.RoleAPI.sendMessage === 'function');
          },
          call: function (prompt, options) {
            return Promise.resolve(window.RoleAPI.sendMessage(prompt, options));
          },
          priority: 80
        },
        {
          name: 'XBBridge',
          available: function () {
            return !!(window.XBBridge && typeof window.XBBridge.generate && typeof window.XBBridge.generate.generate === 'function');
          },
          call: function (prompt, options) {
            return Promise.resolve(window.XBBridge.generate.generate({ messages: [{ role: 'user', content: prompt }] }));
          },
          priority: 60
        }
      ];
      console.log('[UnifiedAI] 初始化完成，已注册 ' + self._backends.length + ' 个后端');
    },

    /**
     * 调用自定义API（customAPI后端）
     * 复用现有 BridgeAPI.getAPIConfig() 获取配置
     */
    _callCustomAPI: function (prompt, options) {
      var apiConfig = (window.BridgeAPI && window.BridgeAPI.getAPIConfig) ?
        window.BridgeAPI.getAPIConfig() : null;
      if (!apiConfig || !apiConfig.apiUrl || !apiConfig.apiKey) {
        return Promise.reject(new Error('[UnifiedAI] customAPI 配置不可用'));
      }

      var maxTokens = (options && options.maxTokens) || 500;
      var temperature = (options && options.temperature) != null ? options.temperature : 0.7;
      var model = (options && options.model) || apiConfig.model || 'Qwen/Qwen2.5-7B-Instruct';

      // 优先使用调用方传入的 systemPrompt，其次使用配置面板中的系统提示词，最后使用默认值
      var systemPrompt = (options && options.systemPrompt) ||
        apiConfig.systemPrompt ||
        '你是小手机系统的AI助手，负责生成游戏内容。请简洁回复。';

      var messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      var body = JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature
      });

      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', apiConfig.apiUrl + '/chat/completions', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiConfig.apiKey);
        xhr.timeout = (options && options.timeout) || 30000;

        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var resp = JSON.parse(xhr.responseText);
              var content = resp.choices && resp.choices[0] && resp.choices[0].message &&
                resp.choices[0].message.content;
              if (content) {
                resolve(content);
              } else {
                reject(new Error('[UnifiedAI] customAPI 返回内容为空'));
              }
            } catch (e) {
              reject(new Error('[UnifiedAI] customAPI 响应解析失败: ' + e.message));
            }
          } else {
            reject(new Error('[UnifiedAI] customAPI HTTP ' + xhr.status));
          }
        };

        xhr.onerror = function () {
          reject(new Error('[UnifiedAI] customAPI 网络错误'));
        };

        xhr.ontimeout = function () {
          reject(new Error('[UnifiedAI] customAPI 超时'));
        };

        xhr.send(body);
      });
    },

    /**
     * 统一AI调用入口
     * @param {string} prompt - 提示词
     * @param {Object} [options] - 选项
     * @param {string} [options.backend='auto'] - 指定后端
     * @param {number} [options.maxTokens=500]
     * @param {number} [options.temperature=0.7]
     * @param {number} [options.timeout=30000]
     * @param {boolean} [options.fallback=true] - 是否允许降级
     * @returns {Promise<string>} AI响应文本
     */
    call: function (prompt, options) {
      var self = this;
      options = options || {};
      var backend = options.backend || 'auto';
      var maxTokens = options.maxTokens || 500;
      var temperature = options.temperature != null ? options.temperature : 0.7;
      var timeout = options.timeout || 30000;
      var fallback = options.fallback !== false;

      self._callStats.total++;

      if (backend === 'auto') {
        return self._callWithFallback(prompt, { maxTokens: maxTokens, temperature: temperature, timeout: timeout });
      }

      // 指定后端
      var target = null;
      for (var i = 0; i < self._backends.length; i++) {
        if (self._backends[i].name === backend) {
          target = self._backends[i];
          break;
        }
      }

      if (!target || !target.available()) {
        if (fallback) {
          return self._callWithFallback(prompt, { maxTokens: maxTokens, temperature: temperature, timeout: timeout }, backend);
        }
        return Promise.reject(new Error('[UnifiedAI] 指定后端 ' + backend + ' 不可用'));
      }

      return self._callWithTimeout(target, prompt, { maxTokens: maxTokens, temperature: temperature }, timeout);
    },

    /**
     * 按优先级降级调用
     */
    _callWithFallback: function (prompt, options, excludeBackend) {
      var self = this;
      var errors = [];
      var chain = Promise.reject(new Error('no backends'));

      for (var i = 0; i < self._backends.length; i++) {
        (function (backend) {
          chain = chain.catch(function (err) {
            if (excludeBackend && backend.name === excludeBackend) {
              return Promise.reject(err);
            }
            if (!backend.available()) {
              return Promise.reject(new Error('[UnifiedAI] 后端 ' + backend.name + ' 不可用'));
            }
            return self._callWithTimeout(backend, prompt, options, options.timeout)
              .then(function (result) {
                self._trackBackend(backend.name, true);
                return result;
              })
              .catch(function (e) {
                errors.push({ backend: backend.name, error: e.message });
                self._trackBackend(backend.name, false);
                console.warn('[UnifiedAI] 后端 ' + backend.name + ' 失败，尝试下一个:', e.message);
                return Promise.reject(e);
              });
          });
        })(self._backends[i]);
      }

      return chain.catch(function () {
        self._callStats.failed++;
        var names = [];
        for (var j = 0; j < errors.length; j++) names.push(errors[j].backend);
        return Promise.reject(new Error('[UnifiedAI] 所有AI后端均失败: ' + names.join(', ')));
      });
    },

    /**
     * 带超时的后端调用
     */
    _callWithTimeout: function (backend, prompt, options, timeout) {
      var callPromise = backend.call(prompt, options);
      // 如果后端返回的不是Promise，包装一下
      if (!callPromise || typeof callPromise.then !== 'function') {
        callPromise = Promise.resolve(callPromise);
      }

      return new Promise(function (resolve, reject) {
        var resolved = false;
        var timer = setTimeout(function () {
          if (!resolved) {
            resolved = true;
            reject(new Error('[UnifiedAI] 后端 ' + backend.name + ' 超时 (' + timeout + 'ms)'));
          }
        }, timeout);

        callPromise.then(function (result) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(result);
          }
        }).catch(function (err) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(err);
          }
        });
      });
    },

    _trackBackend: function (name, success) {
      if (!this._callStats.byBackend[name]) {
        this._callStats.byBackend[name] = { success: 0, failed: 0 };
      }
      if (success) {
        this._callStats.byBackend[name].success++;
        this._callStats.success++;
      } else {
        this._callStats.byBackend[name].failed++;
      }
    },

    getStats: function () {
      return {
        total: this._callStats.total,
        success: this._callStats.success,
        failed: this._callStats.failed,
        byBackend: JSON.parse(JSON.stringify(this._callStats.byBackend))
      };
    }
  };

  // ============================================================
  // 第四部分：WorkflowEngine 工作流引擎
  // ============================================================
  var WorkflowEngine = {
    _workflows: {},          // { id: workflowDef }
    _runningWorkflows: {},   // { id: true } 防止并发
    _debounceTimers: {},     // { id: timerId }
    _lastTriggerKeys: {},    // { 'wfId:eventKey': timestamp } 去重

    /**
     * 注册工作流
     * @param {Object} workflow - 工作流定义
     */
    register: function (workflow) {
      if (!workflow || !workflow.id) {
        console.warn('[WorkflowEngine] 无效的工作流定义');
        return;
      }
      if (this._workflows[workflow.id]) {
        console.warn('[WorkflowEngine] 工作流 ' + workflow.id + ' 已存在，将被覆盖');
      }
      this._workflows[workflow.id] = workflow;
      this._bindTrigger(workflow);
      console.log('[WorkflowEngine] 工作流已注册: ' + workflow.id + ' (' + workflow.name + ')');
    },

    /**
     * 移除工作流
     */
    remove: function (id) {
      if (this._workflows[id]) {
        delete this._workflows[id];
        console.log('[WorkflowEngine] 工作流已移除: ' + id);
      }
    },

    /**
     * 绑定触发器到事件源
     */
    _bindTrigger: function (workflow) {
      var self = this;
      var trigger = workflow.trigger;
      if (!trigger) return;

      switch (trigger.type) {
        case 'variable_changed':
          // 监听 EventBus 的 variable:changed 事件
          EventBus.on('variable:changed', function (eventData) {
            if (self._matchTrigger(eventData, trigger)) {
              self._executeWorkflow(workflow, eventData);
            }
          });
          break;

        case 'engine_event':
          // 监听任意 EventBus 事件
          EventBus.on(trigger.pattern, function (eventData) {
            self._executeWorkflow(workflow, {
              type: trigger.pattern,
              data: eventData,
              source: 'engine_event',
              timestamp: Date.now()
            });
          });
          break;

        case 'timer':
          if (trigger.interval && trigger.interval > 0) {
            setInterval(function () {
              self._executeWorkflow(workflow, {
                type: 'timer',
                source: 'internal',
                timestamp: Date.now()
              });
            }, trigger.interval);
            console.log('[WorkflowEngine] 定时工作流已启动: ' + workflow.id + ' (间隔 ' + trigger.interval + 'ms)');
          }
          break;
      }
    },

    /**
     * 匹配触发条件
     */
    _matchTrigger: function (eventData, trigger) {
      if (!trigger.pattern) return true;
      var key = eventData.key || eventData.type || '';
      var pattern = trigger.pattern;

      // 精确匹配
      if (pattern === key) return true;

      // 通配符匹配 xb.phone.* → xb.phone.anything
      if (pattern.indexOf('*') >= 0) {
        var regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
        try {
          var regex = new RegExp(regexStr);
          return regex.test(key);
        } catch (e) {
          return false;
        }
      }

      return false;
    },

    /**
     * 执行工作流（带防抖和去重）
     */
    _executeWorkflow: function (workflow, event) {
      var self = this;
      var id = workflow.id;
      var options = workflow.options || {};

      // 去重检查（同一工作流+同一key在dedupWindow内不重复触发）
      if (options.dedup !== false) {
        var dedupKey = id + ':' + (event.key || event.type || 'unknown');
        var dedupWindow = options.dedupWindow || 3000; // 默认3秒去重窗口
        var lastTime = self._lastTriggerKeys[dedupKey] || 0;
        if (Date.now() - lastTime < dedupWindow) {
          console.log('[WorkflowEngine] 工作流去重跳过: ' + id);
          return;
        }
        self._lastTriggerKeys[dedupKey] = Date.now();
      }

      // 防抖处理
      if (options.debounce && options.debounce > 0) {
        if (self._debounceTimers[id]) {
          clearTimeout(self._debounceTimers[id]);
        }
        self._debounceTimers[id] = setTimeout(function () {
          delete self._debounceTimers[id];
          self._runActions(workflow, event);
        }, options.debounce);
        return;
      }

      self._runActions(workflow, event);
    },

    /**
     * 顺序执行动作序列
     */
    _runActions: function (workflow, event) {
      var self = this;
      var id = workflow.id;
      var actions = workflow.actions || [];
      var options = workflow.options || {};

      // 防止同一工作流并发执行
      if (self._runningWorkflows[id]) {
        console.log('[WorkflowEngine] 工作流 ' + id + ' 正在执行中，跳过');
        return;
      }
      self._runningWorkflows[id] = true;

      var context = {
        event: event,
        results: {},
        variables: {},
        timestamp: Date.now()
      };

      console.log('[WorkflowEngine] ▶ 开始执行工作流: ' + id + ' (' + (workflow.name || '') + ')');

      // 链式执行动作
      var chain = Promise.resolve();
      for (var i = 0; i < actions.length; i++) {
        (function (action, index) {
          chain = chain.then(function () {
            // 条件判断
            if (action.condition) {
              if (!self._evaluateCondition(action.condition, context)) {
                console.log('[WorkflowEngine]   ↳ 动作 ' + (index + 1) + ' 条件不满足，跳过: ' + action.type);
                return;
              }
            }

            console.log('[WorkflowEngine]   ↳ 执行动作 ' + (index + 1) + '/' + actions.length + ': ' + action.type + ' → ' + (action.target || ''));

            var timeout = action.timeout || options.timeout || 15000;
            return self._executeAction(action, context, timeout);
          });
        })(actions[i], i);
      }

      return chain.then(function () {
        delete self._runningWorkflows[id];
        console.log('[WorkflowEngine] ✔ 工作流完成: ' + id);
        EventBus.emit('workflow:completed', { workflowId: id, context: context });
      }).catch(function (error) {
        delete self._runningWorkflows[id];
        console.error('[WorkflowEngine] ✘ 工作流失败: ' + id, error);
        EventBus.emit('workflow:error', { workflowId: id, error: error.message || String(error) });
      });
    },

    /**
     * 执行单个动作
     */
    _executeAction: function (action, context, timeout) {
      var self = this;
      var resolvedParams = self._resolveTemplate(action.params, context);

      switch (action.type) {
        case 'ai_call':
          // AI调用，结果存入 context.results[resultKey]
          return UnifiedAI.call(resolvedParams.prompt || '', resolvedParams.options || {})
            .then(function (result) {
              if (action.resultKey) {
                context.results[action.resultKey] = result;
              }
              return result;
            });

        case 'module_call':
          // 调用模块方法
          return self._callModule(resolvedParams.target || action.target, resolvedParams.method, resolvedParams.args);

        case 'variable_set':
          // 写入变量
          var varKey = resolvedParams.key || action.target;
          var varValue = resolvedParams.value;
          if (typeof varValue === 'object') {
            varValue = JSON.stringify(varValue);
          }
          return ConfigManager._writeVar(varKey, varValue).then(function () {
            // [修复] 统一走 _routeVarChange，确保缓存更新 + EventBus 广播 + PluginBridge 同步
            try {
              BridgeAPI._routeVarChange(varKey, varValue, 'workflow_action');
            } catch (e) {
              // 降级：直接发 EventBus
              EventBus.emit('variable:changed', {
                key: varKey,
                value: varValue,
                source: 'engine',
                timestamp: Date.now()
              });
            }
          });

        case 'event_emit':
          // 发送事件
          EventBus.emit(resolvedParams.event || action.target, resolvedParams.data || {});
          return Promise.resolve();

        case 'function_call':
          // 直接调用函数
          if (typeof action.handler === 'function') {
            return Promise.resolve().then(function () {
              return action.handler(context, resolvedParams);
            });
          }
          return Promise.resolve();

        default:
          console.warn('[WorkflowEngine] 未知动作类型: ' + action.type);
          return Promise.resolve();
      }
    },

    /**
     * 调用模块方法
     */
    _callModule: function (target, method, args) {
      var modules = {
        messageApp: window.messageApp,
        messageRenderer: window.messageRenderer,
        shopApp: window.shopApp,
        weiboManager: window.weiboManager,
        taskApp: window.taskApp,
        independentAI: window.independentAI,
        mobilePhone: window.mobilePhone,
        friendRenderer: window.friendRenderer,
        BridgeAPI: window.BridgeAPI
      };

      var mod = modules[target];
      if (!mod) {
        console.warn('[WorkflowEngine] 模块不存在: ' + target);
        return Promise.reject(new Error('模块不存在: ' + target));
      }
      if (typeof mod[method] !== 'function') {
        console.warn('[WorkflowEngine] 模块方法不存在: ' + target + '.' + method);
        return Promise.reject(new Error('模块方法不存在: ' + target + '.' + method));
      }

      try {
        var result = mod[method].apply(mod, args || []);
        if (result && typeof result.then === 'function') {
          return result;
        }
        return Promise.resolve(result);
      } catch (e) {
        console.warn('[WorkflowEngine] 模块调用异常: ' + target + '.' + method, e);
        return Promise.reject(e);
      }
    },

    /**
     * 模板变量解析 {{data.value}} → 实际值
     * 支持嵌套路径: {{results.intentAnalysis}}
     */
    _resolveTemplate: function (obj, context) {
      var self = this;
      if (typeof obj === 'string') {
        return obj.replace(/\{\{([^}]+)\}\}/g, function (match, path) {
          path = path.trim();
          return self._getByPath(context, path) != null ? String(self._getByPath(context, path)) : match;
        });
      }
      if (obj && typeof obj === 'object') {
        var result = {};
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
          result[keys[i]] = self._resolveTemplate(obj[keys[i]], context);
        }
        return result;
      }
      return obj;
    },

    _getByPath: function (obj, path) {
      var parts = path.split('.');
      var current = obj;
      for (var i = 0; i < parts.length; i++) {
        if (current == null) return undefined;
        current = current[parts[i]];
      }
      return current;
    },

    /**
     * 简单条件求值
     */
    _evaluateCondition: function (condition, context) {
      if (condition.type === 'function' && typeof condition.fn === 'function') {
        try {
          return condition.fn(context);
        } catch (e) {
          return false;
        }
      }
      if (condition.type === 'expr') {
        try {
          // 安全求值：仅允许 context.results 和 context.event 引用
          var expr = condition.expr || '';
          // 替换 {{xxx}} 为实际值
          expr = expr.replace(/\{\{([^}]+)\}\}/g, function (m, p) {
            var val = this._getByPath(context, p.trim());
            return val != null ? JSON.stringify(val) : 'undefined';
          }.bind(this));
          // 简单布尔表达式求值
          if (expr === 'true') return true;
          if (expr === 'false') return false;
          // 检查是否存在且非空
          if (expr.indexOf('&&') < 0 && expr.indexOf('||') < 0) {
            var val = this._getByPath(context, expr.trim());
            return !!(val && val !== '' && val !== '0' && val !== 0 && val !== false);
          }
          // 复杂表达式：尝试安全解析
          try {
            // 支持 && 和 || 的简单解析
            var parts = expr.split('&&').map(function(s) { return s.trim(); });
            if (parts.length > 1) {
              return parts.every(function(part) {
                if (part === 'true') return true;
                if (part === 'false') return false;
                var v = self._getByPath(context, part);
                return !!(v && v !== '' && v !== '0' && v !== 0 && v !== false);
              });
            }
            parts = expr.split('||').map(function(s) { return s.trim(); });
            if (parts.length > 1) {
              return parts.some(function(part) {
                if (part === 'true') return true;
                if (part === 'false') return false;
                var v = self._getByPath(context, part);
                return !!(v && v !== '' && v !== '0' && v !== 0 && v !== false);
              });
            }
          } catch (e2) {
            // 解析失败，保守返回 false
            return false;
          }
          return false;
        } catch (e) {
          return false;
        }
      }
      return true;
    },

    /**
     * 列出所有工作流
     */
    listWorkflows: function () {
      var list = [];
      var keys = Object.keys(this._workflows);
      for (var i = 0; i < keys.length; i++) {
        var wf = this._workflows[keys[i]];
        list.push({ id: wf.id, name: wf.name, priority: wf.priority, trigger: wf.trigger });
      }
      return list;
    }
  };

  // ============================================================
  // 第五部分：PhoneEngine 核心入口
  // ============================================================
  var PhoneEngine = {
    _initialized: false,
    _startTime: Date.now(),
    _lastDirectorHash: '', // 导演决策去重哈希

    // 事件总线代理
    on: function (event, callback, options) {
      return EventBus.on(event, callback, options);
    },
    once: function (event, callback) {
      return EventBus.once(event, callback);
    },
    off: function (event, callback) {
      EventBus.off(event, callback);
    },
    emit: function (event, data) {
      EventBus.emit(event, data);
    },

    /**
     * 初始化引擎
     */
    init: function () {
      if (this._initialized) {
        console.log('[PhoneEngine] 已初始化，跳过');
        return;
      }

      console.log('[PhoneEngine] 🚀 初始化工作流引擎...');

      // 1. 初始化 UnifiedAI
      UnifiedAI.init();

      // 2. 注册内置工作流
      this._registerBuiltInWorkflows();

      // 3. 启动定时工作流
      this._startTimerWorkflows();

      // [修复v2] 4. 启动内置 Director 引擎（不依赖小白X taskjs）
      this._initBuiltinDirector();

      this._initialized = true;

      var elapsed = Date.now() - this._startTime;
      console.log('[PhoneEngine] ✔ 工作流引擎初始化完成 (' + elapsed + 'ms)');
      console.log('[PhoneEngine] 已注册工作流: ' + WorkflowEngine.listWorkflows().map(function (w) { return w.id; }).join(', '));

      EventBus.emit('engine:ready', { timestamp: Date.now(), elapsed: elapsed });

      // 4. 启动状态上报（每30秒向 PluginBridge 服务器报告状态，可通过 curl 查询）
      this._startStatusReport();
    },

    /**
     * 定时向 PluginBridge 服务器上报引擎状态
     * 通过 curl http://localhost:3001/api/engine/status 即可查看
     */
    _startStatusReport: function () {
      var self = this;
      // 自动检测服务器地址（兼容电脑远程访问）
      var host = window.location.hostname;
      var bridgeHost = (!host || host === 'localhost' || host === '127.0.0.1' ||
                        host === '[::1]' || window.location.protocol === 'file:')
                       ? '127.0.0.1' : host;
      var reportUrl = 'http://' + bridgeHost + ':3001/api/engine/status';

      function report() {
        try {
          var status = self.getStatus();
          status.reportTime = Date.now();

          // 优先通过 BridgeClient WebSocket 上报（避免 WebView CORS 限制）
          if (window.BridgeClient && window.BridgeClient._ws &&
              window.BridgeClient._ws.readyState === 1) {
            // 通过 WebSocket 发送状态到服务器
            try {
              window.BridgeClient._ws.send(JSON.stringify({
                type: 'set',
                key: '_engine.status',
                value: status,
                ttl: 120000
              }));
              console.log('[PhoneEngine] 状态上报成功 (WebSocket)');
            } catch (wsErr) {
              console.warn('[PhoneEngine] WebSocket上报失败:', wsErr);
            }
          } else {
            // 降级：通过 HTTP XHR 上报
            try {
              var xhr = new XMLHttpRequest();
              xhr.open('POST', reportUrl, true);
              xhr.setRequestHeader('Content-Type', 'application/json');
              xhr.timeout = 3000;
              xhr.onload = function () {
                console.log('[PhoneEngine] 状态上报成功 (HTTP)');
              };
              xhr.onerror = function () {
                console.warn('[PhoneEngine] HTTP状态上报失败');
              };
              xhr.send(JSON.stringify(status));
            } catch (xhrErr) {
              console.warn('[PhoneEngine] HTTP状态上报异常:', xhrErr);
            }
          }
        } catch (e) {
          // 静默
        }
      }

      // 首次延迟5秒上报（等待 WebSocket 连接建立）
      setTimeout(function () {
        report();
        // 每30秒上报一次
        setInterval(report, 30000);
      }, 5000);
    },

    /**
     * 注册内置工作流
     */
    _registerBuiltInWorkflows: function () {
      // ---- 工作流1: 好友请求处理 ----
      WorkflowEngine.register({
        id: 'wf.pending_friend',
        name: '好友请求处理',
        priority: 90,
        trigger: { type: 'variable_changed', pattern: 'xb.phone.pendingFriend' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var value = context.event && context.event.value;
              if (!value || value === '') return;
              console.log('[PhoneEngine/wf] 处理好友请求: ' + String(value).substring(0, 50));
              if (window.BridgeAPI && window.BridgeAPI.processPendingFriend) {
                return window.BridgeAPI.processPendingFriend(value);
              }
            }
          }
        ],
        options: { debounce: 500, dedup: true, dedupWindow: 5000 }
      });

      // ---- 工作流2: 消息到达处理 ----
      WorkflowEngine.register({
        id: 'wf.pending_msg',
        name: '消息到达处理',
        priority: 90,
        trigger: { type: 'variable_changed', pattern: 'xb.phone.pendingMsg' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var value = context.event && context.event.value;
              if (!value || value === '') return;
              console.log('[PhoneEngine/wf] 处理待发送消息: ' + String(value).substring(0, 50));
              if (window.BridgeAPI && window.BridgeAPI.processPendingMessages) {
                return window.BridgeAPI.processPendingMessages(value);
              }
            }
          }
        ],
        options: { debounce: 300, dedup: true, dedupWindow: 3000 }
      });

      // ---- 工作流3: 任务通知处理 ----
      WorkflowEngine.register({
        id: 'wf.quest_notify',
        name: '任务通知处理',
        priority: 85,
        trigger: { type: 'variable_changed', pattern: 'xb.quest.pendingNotify' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var value = context.event && context.event.value;
              if (!value || value === '') return;
              console.log('[PhoneEngine/wf] 处理任务通知: ' + String(value).substring(0, 50));
              if (window.BridgeAPI && window.BridgeAPI.processPendingQuestNotify) {
                return window.BridgeAPI.processPendingQuestNotify(value);
              }
            }
          }
        ],
        options: { debounce: 500, dedup: true, dedupWindow: 5000 }
      });

      // ---- 工作流4: ENA推演完成响应 ----
      WorkflowEngine.register({
        id: 'wf.ena_plot',
        name: 'ENA推演完成响应',
        priority: 95,
        trigger: { type: 'variable_changed', pattern: 'xb.ena.lastPlot' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var plot = context.event && context.event.value;
              if (!plot || plot === '') return;
              console.log('[PhoneEngine/wf] ENA推演结果到达，长度: ' + plot.length);

              // 通知 QuestEngine（如果可用）
              if (window.QuestEngine && typeof window.QuestEngine.emit === 'function') {
                try {
                  window.QuestEngine.emit('quest:ena_plot', { plot: plot });
                } catch (e) {
                  console.warn('[PhoneEngine/wf] QuestEngine通知失败:', e);
                }
              }

              // 通过事件总线广播，让其他模块可以响应
              EventBus.emit('ena:plot_received', { plot: plot, timestamp: Date.now() });
            }
          },
          {
            type: 'ai_call',
            resultKey: 'responsePlan',
            params: {
              prompt: '你是一个游戏系统调度器。根据以下ENA推演结果，判断需要触发哪些手机模块响应。\n\n推演结果:\n{{event.value}}\n\n可用模块: message(消息), shop(商城), friends-circle(朋友圈), weibo(微博), task(任务)\n\n请用JSON格式返回响应计划，格式如下:\n{"actions":[{"module":"模块名","reason":"原因","data":"相关数据"}]}\n\n如果不需要触发任何模块，返回:{"actions":[]}',
              options: { maxTokens: 300, temperature: 0.3, backend: 'auto' }
            }
          },
          {
            type: 'function_call',
            handler: function (context) {
              var plan = context.results.responsePlan;
              if (!plan) return;
              console.log('[PhoneEngine/wf] AI响应计划: ' + String(plan).substring(0, 100));

              try {
                var parsed = JSON.parse(plan);
                if (parsed.actions && parsed.actions.length > 0) {
                  for (var i = 0; i < parsed.actions.length; i++) {
                    var action = parsed.actions[i];
                    console.log('[PhoneEngine/wf] → 触发模块: ' + action.module + ' - ' + action.reason);
                    EventBus.emit('engine:dispatch', {
                      module: action.module,
                      reason: action.reason,
                      data: action.data,
                      source: 'ena_plot'
                    });
                  }
                }
              } catch (e) {
                console.warn('[PhoneEngine/wf] 解析AI响应计划失败:', e);
              }
            }
          },
          {
            type: 'variable_set',
            target: 'xb.quest.result.engine',
            params: {
              key: 'xb.quest.result.engine',
              value: '{"status":"processed","source":"ena_plot","timestamp":{{event.timestamp}}}'
            }
          }
        ],
        options: { debounce: 1000, dedup: true, dedupWindow: 10000, timeout: 30000 }
      });

      // ---- 工作流5: 游戏数据变更 ----
      WorkflowEngine.register({
        id: 'wf.game_data_sync',
        name: '游戏数据同步',
        priority: 80,
        trigger: { type: 'variable_changed', pattern: '游戏数据.系统.*' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              console.log('[PhoneEngine/wf] 游戏数据变更: ' + (context.event && context.event.key));
              if (window.BridgeAPI && window.BridgeAPI.syncGameVariables) {
                return window.BridgeAPI.syncGameVariables();
              }
            }
          }
        ],
        options: { debounce: 2000, dedup: true, dedupWindow: 5000 }
      });

      // ---- 工作流6: 朋友圈更新 ----
      WorkflowEngine.register({
        id: 'wf.moments_update',
        name: '朋友圈更新',
        priority: 75,
        trigger: { type: 'variable_changed', pattern: 'xb.phone.moments.*' },
        actions: [
          {
            type: 'event_emit',
            target: 'phone:moments_updated',
            params: { event: 'phone:moments_updated', data: '{{event.value}}' }
          }
        ],
        options: { debounce: 1000, dedup: true }
      });

      // ---- 工作流7: 任务注册表变更 ----
      WorkflowEngine.register({
        id: 'wf.quest_registry',
        name: '任务注册表变更',
        priority: 85,
        trigger: { type: 'variable_changed', pattern: 'xb.quest.registry' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var registry = context.event && context.event.value;
              console.log('[PhoneEngine/wf] 任务注册表变更');
              if (window.QuestEngine && typeof window.QuestEngine.emit === 'function') {
                try {
                  window.QuestEngine.emit('quest:registry_changed', { registry: registry });
                } catch (e) {}
              }
            }
          }
        ],
        options: { debounce: 1000, dedup: true }
      });

      // ---- 工作流8: 引擎调度分发（通用） ----
      WorkflowEngine.register({
        id: 'wf.engine_dispatch',
        name: '引擎调度分发',
        priority: 70,
        trigger: { type: 'engine_event', pattern: 'engine:dispatch' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var dispatch = context.data;
              if (!dispatch || !dispatch.module) return;

              var module = dispatch.module;
              var data = dispatch.data;
              var reason = dispatch.reason || '';

              console.log('[PhoneEngine/wf] 调度分发 → ' + module + ': ' + reason);

              switch (module) {
                case 'message':
                  if (window.messageApp && typeof window.messageApp.showNotification === 'function') {
                    window.messageApp.showNotification(data);
                  }
                  break;
                case 'shop':
                  // [修复v2] 修正方法名：shopApp 没有 refreshUI，实际是 refreshProductList
                  if (window.shopApp && typeof window.shopApp.refreshProductList === 'function') {
                    window.shopApp.refreshProductList();
                  } else if (window.shopAppRefresh) {
                    window.shopAppRefresh();
                  }
                  break;
                case 'friends-circle':
                  if (window.messageApp && window.messageApp.friendsCircle) {
                    // 朋友圈更新逻辑
                    EventBus.emit('friends:circle:update', { data: data });
                  }
                  break;
                case 'weibo':
                  if (window.weiboManager && typeof window.weiboManager.autoGenerate === 'function') {
                    window.weiboManager.autoGenerate();
                  }
                  break;
                case 'task':
                  if (window.taskApp && typeof window.taskApp.refreshUI === 'function') {
                    window.taskApp.refreshUI();
                  }
                  break;
                default:
                  console.log('[PhoneEngine/wf] 未知模块: ' + module);
              }
            }
          }
        ],
        options: { debounce: 500 }
      });

      // ---- 工作流9: AI导演决策处理 ----
      // 由小白X循环任务通过 bridgeSet 写入 xb.director.plan 触发
      // 独立API分析剧情后生成结构化事件JSON，小手机接收并分发
      WorkflowEngine.register({
        id: 'wf.director',
        name: 'AI导演决策处理',
        priority: 100, // 最高优先级
        trigger: { type: 'variable_changed', pattern: 'xb.director.plan' },
        actions: [
          {
            type: 'function_call',
            handler: function (context) {
              var raw = context.event && context.event.value;
              if (!raw || raw === '') {
                console.log('[Director] 收到空决策，跳过');
                return;
              }

              console.log('[Director] 收到AI导演决策，长度: ' + raw.length);

              // 第一层容错：剥离可能的 markdown 代码块
              var cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

              // 第二层容错：尝试解析 JSON
              var decision;
              try {
                decision = JSON.parse(cleaned);
              } catch (parseErr) {
                console.warn('[Director] JSON 解析失败，跳过:', parseErr.message);
                return;
              }

              // 第三层容错：验证结构
              if (!decision.events || !Array.isArray(decision.events)) {
                console.warn('[Director] 结构无效（缺少 events 数组），降级为空');
                decision = { events: [] };
              }

              // 第四层：防抖去重（有事件时与上次相同则跳过，空结果不去重）
              if (decision.events.length > 0) {
                var hash = JSON.stringify(decision.events);
                if (PhoneEngine._lastDirectorHash === hash) {
                  console.log('[Director] 与上次决策相同，跳过');
                  return;
                }
                PhoneEngine._lastDirectorHash = hash;
              } else {
                PhoneEngine._lastDirectorHash = ''; // 清除 hash，下次有事件时不会误判
              }

              // 第五层：分发事件到各模块
              if (decision.events.length > 0) {
                PhoneEngine._dispatchDirectorEvents(decision);
              } else {
                console.log('[Director] 无事件需要触发');
              }
            }
          }
        ],
        options: { debounce: 800, dedup: true, dedupWindow: 5000 }
      });

      // ---- [修复v2] 闭环工作流 M1: 用户在小手机中的操作 ----
      WorkflowEngine.register({
        id: 'wf.phone_interaction',
        name: '手机操作反馈',
        priority: 85,
        trigger: { type: 'variable_changed', pattern: 'xb.phone.interaction' },
        actions: [{
          type: 'function_call',
          handler: function (context) {
            var value = context.event && context.event.value;
            if (!value) return;
            console.log('[PhoneEngine] 用户手机操作:', value.substring(0, 100));
            // 操作记录已写入变量，Director 下一轮会读取
          }
        }],
        options: { debounce: 500, dedup: false }
      });

      // ---- [修复v2] 闭环工作流 M2: 任务完成 ----
      WorkflowEngine.register({
        id: 'wf.task_result',
        name: '任务完成处理',
        priority: 85,
        trigger: { type: 'variable_changed', pattern: 'xb.phone.taskResult' },
        actions: [{
          type: 'function_call',
          handler: function (context) {
            var value = context.event && context.event.value;
            if (!value) return;
            console.log('[PhoneEngine] 任务完成:', value.substring(0, 100));
            // 任务结果已写入变量，Director 下一轮会读取
          }
        }],
        options: { debounce: 500, dedup: false }
      });

      // ---- [修复v2] 闭环工作流 M3: 用户选择了四选项 ----
      WorkflowEngine.register({
        id: 'wf.user_choice',
        name: '用户选择处理',
        priority: 85,
        trigger: { type: 'variable_changed', pattern: 'xb.phone.userChoice' },
        actions: [{
          type: 'function_call',
          handler: function (context) {
            var value = context.event && context.event.value;
            if (!value) return;
            console.log('[PhoneEngine] 用户选择:', value.substring(0, 100));
            // 选择已写入变量，Director 下一轮会读取
          }
        }],
        options: { debounce: 300, dedup: false }
      });
    },

    /**
     * 指令分发器：将 AI 导演决策的事件 JSON 分发到各手机模块
     * @param {Object} decision - AI 返回的决策对象 { events: [...] }
     */
    _dispatchDirectorEvents: function (decision) {
      if (!decision || !Array.isArray(decision.events)) return;

      var self = this;

      var ALLOWED_TYPES = ['message', 'quest', 'moment', 'live', 'friend', 'status', 'shop', 'notification'];
      var dispatched = 0;

      for (var i = 0; i < decision.events.length; i++) {
        var ev = decision.events[i];
        if (!ev || !ev.type) continue;

        // 白名单过滤
        if (ALLOWED_TYPES.indexOf(ev.type) === -1) {
          console.warn('[Director] 未知事件类型，跳过:', ev.type);
          continue;
        }

        dispatched++;
        console.log('[Director] 分发事件 #' + (i + 1) + ': ' + ev.type);

        try {
          switch (ev.type) {
            case 'message':
              // 消息事件 → 写入 pendingMsg 变量 → wf.pending_msg 工作流处理
              if (ev.content && ev.from) {
                var msgData = JSON.stringify({
                  from: ev.from,
                  fromId: ev.fromId || ev.from,
                  type: ev.msgType || 'text',
                  content: ev.content,
                  avatar: ev.avatar || '',
                  source: 'director'
                });
                if (window.BridgeAPI && window.BridgeAPI.setVar) {
                  window.BridgeAPI.setVar('xb.phone.pendingMsg', msgData);
                }
              }
              break;

            case 'quest':
              // 任务事件 → 写入 pendingNotify → wf.quest_notify 工作流处理
              if (ev.name) {
                var questData = JSON.stringify({
                  questId: ev.questId || ('director_' + Date.now() + '_' + i),
                  action: 'created',
                  questType: ev.questType || 'side',
                  name: ev.name,
                  description: ev.description || '',
                  reward: ev.reward || {},
                  steps: ev.steps || [],
                  source: 'director'
                });
                if (window.BridgeAPI && window.BridgeAPI.setVar) {
                  window.BridgeAPI.setVar('xb.quest.pendingNotify', questData);
                }
              }
              break;

            case 'moment':
              // [修复v2] 朋友圈模块不监听 EventBus，改为写入变量由模块拉取
              if (ev.content || ev.author) {
                var momentData = JSON.stringify({
                  author: ev.author || '未知',
                  content: ev.content || '',
                  images: ev.images || [],
                  source: 'director',
                  timestamp: Date.now()
                });
                if (window.BridgeAPI && window.BridgeAPI.setVar) {
                  window.BridgeAPI.setVar('xb.phone.moments.last', momentData);
                }
              }
              break;

            case 'live':
              // [修复v2] 直播模块不监听 EventBus，改为写入变量由模块拉取
              if (ev.streamer || ev.title) {
                var liveData = JSON.stringify({
                  streamer: ev.streamer || ev.author || '未知',
                  title: ev.title || '',
                  action: ev.action || 'notify',
                  source: 'director',
                  timestamp: Date.now()
                });
                if (window.BridgeAPI && window.BridgeAPI.setVar) {
                  window.BridgeAPI.setVar('xb.live.directorEvent', liveData);
                }
              }
              break;

            case 'friend':
              // 好友请求事件
              if (ev.name) {
                var friendData = JSON.stringify({
                  name: ev.name,
                  friendId: ev.friendId || ev.name,
                  msg: ev.msg || '请求添加好友',
                  source: 'director'
                });
                if (window.BridgeAPI && window.BridgeAPI.setVar) {
                  window.BridgeAPI.setVar('xb.phone.pendingFriend', friendData);
                }
              }
              break;

            case 'status':
              // [修复v2] 写入变量 + 刷新状态应用 UI
              if (ev.target && ev.change !== undefined) {
                var statusKey = 'xb.game.' + ev.target;
                if (window.BridgeAPI && window.BridgeAPI.setVar) {
                  window.BridgeAPI.setVar(statusKey, String(ev.change));
                }
                // 刷新状态应用
                if (window.StatusApp && typeof window.StatusApp.refreshData === 'function') {
                  window.StatusApp.refreshData();
                }
              }
              break;

            case 'shop':
              // 商城事件 → 刷新商城UI
              EventBus.emit('engine:dispatch', {
                module: 'shop',
                reason: ev.reason || '导演触发',
                data: ev.data || '',
                source: 'director'
              });
              break;

            case 'notification':
              // [修复v2] 通知事件：写入变量 + 显示手机 toast
              var notifText = (ev.title || '新通知') + (ev.content ? ': ' + ev.content : '');
              if (window.BridgeAPI && window.BridgeAPI.setVar) {
                window.BridgeAPI.setVar('xb.phone.lastNotification', notifText);
              }
              // 尝试在手机 UI 显示 toast
              if (window.mobilePhone && typeof window.mobilePhone.showToast === 'function') {
                window.mobilePhone.showToast(notifText, 'info', 3000);
              }
              break;
          }
        } catch (dispatchErr) {
          console.warn('[Director] 分发事件失败 #' + (i + 1) + ':', dispatchErr);
        }
      }

      console.log('[Director] 分发完成，共 ' + dispatched + '/' + decision.events.length + ' 个事件');

      // [修复v2] 在 ST 主界面插入方块提示（类似四选项的包裹块）
      if (dispatched > 0) {
        self._showDirectorHintsInChat(decision.events);
      }
    },

    /**
     * 在 ST 主聊天区域插入 Director 事件提示块
     * @param {Array} events - Director 事件数组
     */
    _showDirectorHintsInChat: function (events) {
      try {
        var chatContainer = document.getElementById('chat');
        if (!chatContainer) return;

        // 事件类型到提示信息的映射
        var typeMap = {
          message: { icon: '💬', label: '新消息', color: '#2196f3' },
          quest:   { icon: '📋', label: '新任务', color: '#ff9800' },
          moment:  { icon: '📷', label: '朋友圈更新', color: '#4caf50' },
          live:    { icon: '📺', label: '直播通知', color: '#e91e63' },
          friend:  { icon: '👤', label: '好友请求', color: '#9c27b0' },
          status:  { icon: '📊', label: '状态变更', color: '#607d8b' },
          shop:    { icon: '🛒', label: '商城更新', color: '#ff5722' },
          notification: { icon: '🔔', label: '通知', color: '#795548' }
        };

        var hints = [];
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          if (!ev || !ev.type) continue;
          var info = typeMap[ev.type] || { icon: '📱', label: ev.type, color: '#666' };
          var detail = '';
          if (ev.from) detail = ev.from;
          else if (ev.name) detail = ev.name;
          else if (ev.streamer) detail = ev.streamer;
          else if (ev.author) detail = ev.author;
          else if (ev.target) detail = ev.target;
          else if (ev.title) detail = ev.title;
          else if (ev.content) detail = ev.content.substring(0, 30);
          hints.push(
            '<div style="display:inline-flex;align-items:center;gap:6px;' +
            'background:' + info.color + '18;color:' + info.color + ';' +
            'font-size:0.85em;padding:4px 12px;border-radius:16px;' +
            'border:1px solid ' + info.color + '30;margin:2px 4px;">' +
            '<span>' + info.icon + '</span>' +
            '<span style="font-weight:600;">' + info.label + '</span>' +
            (detail ? '<span style="opacity:0.8;">' + detail + '</span>' : '') +
            '</div>'
          );
        }

        if (hints.length === 0) return;

        // 创建提示块容器，样式类似四选项
        var hintDiv = document.createElement('div');
        hintDiv.className = 'mes';
        hintDiv.setAttribute('data-director-hint', 'true');
        hintDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;' +
          'margin:8px 0;border-radius:12px;background:rgba(102,126,234,0.06);' +
          'border:1px dashed rgba(102,126,234,0.2);';
        hintDiv.innerHTML = hints.join('');

        // 插入到聊天区域末尾
        chatContainer.appendChild(hintDiv);
        // 滚动到底部
        chatContainer.scrollTop = chatContainer.scrollHeight;

        console.log('[Director] 已在ST主界面插入 ' + hints.length + ' 条提示');
      } catch (e) {
        console.warn('[Director] 插入ST提示失败:', e);
      }
    },

    /**
     * [修复v2] 内置 Director 引擎
     * 不依赖小白X taskjs，在 AI 回复完成后自动调用 LLM 生成事件决策
     * 监听 ST 的 GENERATE_AFTER 事件触发
     */
    _initBuiltinDirector: function () {
      var self = this;
      self._directorEnabled = false;
      self._directorRunning = false;
      self._directorCooldown = 10000; // 10秒冷却，避免频繁调用 API
      self._lastDirectorRun = 0;

      // 延迟 8 秒启动（等待 ST 和所有模块就绪）
      setTimeout(function () {
        try {
          var stContext = window.SillyTavern && window.SillyTavern.getContext
            ? window.SillyTavern.getContext() : null;

          if (stContext && stContext.eventSource) {
            stContext.eventSource.on('GENERATE_AFTER', function () {
              self._triggerDirector();
            });
            console.log('[Director Engine] 已监听 GENERATE_AFTER 事件');
          } else {
            // 降级：轮询检测
            console.log('[Director Engine] eventSource 不可用，使用轮询模式');
            setInterval(function () {
              self._triggerDirector();
            }, 15000);
          }
        } catch (e) {
          console.warn('[Director Engine] 初始化失败:', e.message);
        }
      }, 8000);
    },

    /**
     * [修复v2] 触发 Director（带冷却检查）
     */
    _triggerDirector: function () {
      var self = this;
      var now = Date.now();

      // 冷却检查
      if (now - self._lastDirectorRun < self._directorCooldown) return;

      // [修复v2] 检查 taskjs 是否已经写过 xb.director.plan（避免重复调用 API）
      // 如果变量在最近 8 秒内被更新过，说明 taskjs 已经触发了，跳过
      var lastPlanTime = self._lastPlanWriteTime || 0;
      if (now - lastPlanTime < 8000) {
        return; // taskjs 已触发，静默跳过
      }

      self._lastDirectorRun = now;

      // 检查 API 配置
      var apiConfig = window.mobileCustomAPIConfig && window.mobileCustomAPIConfig.currentSettings
        ? window.mobileCustomAPIConfig.currentSettings : null;
      if (!apiConfig || !apiConfig.apiUrl || !apiConfig.apiKey) {
        return; // API 未配置，静默跳过
      }

      if (self._directorRunning) return;
      self._directorRunning = true;

      // 获取最近消息
      var recentMessages = '';
      try {
        var chatApi = window.SillyTavern && window.SillyTavern.getContext
          ? window.SillyTavern.getContext() : null;
        if (chatApi && chatApi.chat) {
          var chat = chatApi.chat;
          var start = Math.max(0, chat.length - 6);
          for (var i = start; i < chat.length; i++) {
            var msg = chat[i];
            if (!msg) continue;
            var role = msg.is_user ? '玩家' : (msg.name || 'AI');
            var text = (msg.mes || '').substring(0, 300);
            if (text) recentMessages += role + ': ' + text + '\n';
          }
        }
      } catch (e) { recentMessages = '获取消息失败'; }

      // 读取游戏状态变量
      Promise.all([
        ConfigManager._readVar('xb.game.money'),
        ConfigManager._readVar('xb.game.scene'),
        ConfigManager._readVar('xb.game.time'),
        ConfigManager._readVar('xb.quest.registry'),
        ConfigManager._readVar('xb.phone.interaction'),
        ConfigManager._readVar('xb.phone.userChoice'),
        ConfigManager._readVar('xb.phone.taskResult')
      ]).then(function (results) {
        var gameState = '金钱:' + (results[0] || '未知') +
          ' 场景:' + (results[1] || '未知') +
          ' 时间:' + (results[2] || '未知');

        var activeQuests = '无活跃任务';
        try {
          var registry = results[3];
          if (registry) {
            var parsed = typeof registry === 'string' ? JSON.parse(registry) : registry;
            if (parsed && parsed.quests && parsed.quests.length > 0) {
              activeQuests = '';
              for (var q = 0; q < Math.min(parsed.quests.length, 5); q++) {
                activeQuests += '- ' + (parsed.quests[q].name || '未命名') +
                  ' [' + (parsed.quests[q].status || '未知') + ']\n';
              }
            }
          }
        } catch (e) {}

        // [修复v2] 读取闭环变量
        var interactionLog = '';
        if (results[4]) interactionLog += '手机操作: ' + results[4] + '\n';
        if (results[5]) interactionLog += '用户选择: ' + results[5] + '\n';
        if (results[6]) interactionLog += '任务结果: ' + results[6] + '\n';

        var DIRECTOR_PROMPT =
          '你是一个游戏事件导演。分析以下剧情上下文，决定是否需要触发手机事件。\n\n' +
          '## 最近剧情\n' + recentMessages + '\n' +
          '## 游戏状态\n' + gameState + '\n' +
          '## 当前活跃任务\n' + activeQuests + '\n' +
          (interactionLog ? '## 最近用户行为\n' + interactionLog + '\n' : '') +
          '## 规则\n' +
          '1. 积极分析剧情，只要有可能触发手机事件的线索就生成对应事件：\n' +
          '   - 角色提到手机/微信/打电话/发消息 → message（生成该角色给玩家发消息的事件）\n' +
          '   - 对话中暗示有任务/委托/指示/需要去做的事 → quest\n' +
          '   - 角色提到朋友圈/微博/社交媒体 → moment\n' +
          '   - 角色提到直播/开播/看直播 → live\n' +
          '   - 出现新角色/有人想认识玩家 → friend\n' +
          '   - 对话中涉及金钱/好感度/关系变化 → status\n' +
          '2. 宁可多触发也不要漏掉，每次至少尝试生成1个事件（除非剧情完全不相关）\n' +
          '3. 如果确实没有任何手机相关线索，返回 {"events":[]}\n\n' +
          '## 事件格式\n' +
          '{"events": [\n' +
          '  {"type": "message", "from": "发送者名", "fromId": "id", "content": "消息内容"},\n' +
          '  {"type": "quest", "questType": "main/side/daily", "name": "任务名", "description": "描述", "reward": {"money": 0}},\n' +
          '  {"type": "moment", "author": "角色名", "content": "朋友圈内容"},\n' +
          '  {"type": "live", "streamer": "主播名", "title": "直播标题"},\n' +
          '  {"type": "friend", "name": "角色名", "friendId": "id"},\n' +
          '  {"type": "status", "target": "属性名", "change": "新值"}\n' +
          ']}\n\n' +
          '你必须严格只输出一个JSON对象，不得附加任何额外文字。不要使用markdown代码块。';

        var headers = { 'Content-Type': 'application/json' };
        if (apiConfig.apiKey) {
          headers['Authorization'] = 'Bearer ' + apiConfig.apiKey;
        }

        console.log('[Director Engine] 调用API:', apiConfig.apiUrl, '| 模型:', apiConfig.model || '默认');

        return fetch(apiConfig.apiUrl + '/chat/completions', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: apiConfig.model || 'Qwen/Qwen2.5-7B-Instruct',
            messages: [
              { role: 'system', content: '你是游戏事件导演。你必须严格只输出一个JSON对象，不得附加任何额外文字。如果不需要触发任何事件，输出{"events":[]}。不要使用markdown代码块。' },
              { role: 'user', content: DIRECTOR_PROMPT }
            ],
            max_tokens: 500,
            temperature: 0.3
          })
        });
      })
      .then(function (response) {
        if (!response) { self._directorRunning = false; return; }
        if (!response.ok) {
          console.warn('[Director Engine] API 返回 HTTP ' + response.status);
          self._directorRunning = false;
          return null;
        }
        return response.json();
      })
      .then(function (result) {
        if (!result) { self._directorRunning = false; return; }
        var content = '';
        if (result.choices && result.choices[0] && result.choices[0].message) {
          content = result.choices[0].message.content || '';
        }
        content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        if (content !== '' && content.charAt(0) === '{') {
          console.log('[Director Engine] API返回内容长度: ' + content.length);
          // 写入 xb.director.plan → 触发 wf.director → _dispatchDirectorEvents
          if (window.BridgeAPI && window.BridgeAPI.setVar) {
            window.BridgeAPI.setVar('xb.director.plan', content).then(function () {
              console.log('[Director Engine] 已写入 xb.director.plan');
              // [修复v2] 清除已消费的闭环变量
              ConfigManager.set('xb.phone.interaction', '').catch(function () {});
              ConfigManager.set('xb.phone.userChoice', '').catch(function () {});
              ConfigManager.set('xb.phone.taskResult', '').catch(function () {});
              self._directorRunning = false;
            });
          } else {
            self._directorRunning = false;
          }
        } else {
          console.log('[Director Engine] API返回空内容或非JSON');
          self._directorRunning = false;
        }
      })
      .catch(function (e) {
        console.error('[Director Engine] 执行失败:', e.message);
        self._directorRunning = false;
      });
    },

    /**
     * 启动定时工作流
     */
    _startTimerWorkflows: function () {
      // [修复] 暂时禁用定时工作流，防止纯文本污染 ST 聊天区域
      // TODO: 修复 weiboManager.autoGenerate() 的输出目标后再启用
      console.log('[PhoneEngine] 定时工作流已禁用（防止聊天污染）');
      return;
    },

    /**
     * 获取引擎状态
     */
    getStatus: function () {
      return {
        initialized: this._initialized,
        uptime: Date.now() - this._startTime,
        workflows: WorkflowEngine.listWorkflows(),
        aiStats: UnifiedAI.getStats(),
        eventHistoryCount: EventBus._history.length
      };
    },

    /**
     * 手动触发工作流
     */
    trigger: function (workflowId, eventData) {
      var wf = WorkflowEngine._workflows[workflowId];
      if (!wf) {
        console.warn('[PhoneEngine] 工作流不存在: ' + workflowId);
        return;
      }
      WorkflowEngine._executeWorkflow(wf, eventData || { type: 'manual', source: 'manual', timestamp: Date.now() });
    }
  };

  // ============================================================
  // 第六部分：BridgeAPI（桥接API）- 保留原有功能 + 接入引擎
  // ============================================================
  var BridgeAPI = {
    ConfigManager: ConfigManager,
    EventBus: EventBus,
    UnifiedAI: UnifiedAI,
    WorkflowEngine: WorkflowEngine,

    // 供 quest-engine.js 调用的变量读写接口
    _readVar: function (key) {
      return ConfigManager._readVar(key);
    },
    _writeVar: function (key, value) {
      return ConfigManager._writeVar(key, value);
    },

    /**
     * 变量变更统一入口（改造版）
     * 所有变量变更（WebSocket、轮询、猴子补丁）都通过这里
     * 现在改为：通过 EventBus 广播 variable:changed 事件
     * 由 WorkflowEngine 的工作流来消费和处理
     */
    _routeVarChange: function (key, value, source) {
      var self = this;
      if (!key || typeof key !== 'string') return;

      // EventBus 死循环防护：标记正在处理的 key，防止 set → emit → workflow → set 循环
      if (!self._processingKeys) self._processingKeys = {};
      if (self._processingKeys[key]) {
        console.warn('[BridgeAPI] 检测到变量变更死循环，跳过:', key);
        return;
      }
      self._processingKeys[key] = true;
      // [MC-Fix-1] 改为在工作流处理完成后主动清除，而非固定 100ms 超时
      // 原来的 setTimeout 100ms 在工作流执行超过 100ms 时会被提前清除，导致循环重启
      var processingKey = key;
      // 保留安全兜底超时（5秒），防止异常情况下锁永远不释放
      var safetyTimeout = setTimeout(function () {
        if (self._processingKeys[processingKey]) {
          delete self._processingKeys[processingKey];
          console.warn('[BridgeAPI] _processingKeys 安全兜底超时清除:', processingKey);
        }
      }, 5000);

      // [修复v2] 记录 xb.director.plan 的写入时间（用于内置 Director 防重复）
      if (key === 'xb.director.plan' && value && value !== '') {
        PhoneEngine._lastPlanWriteTime = Date.now();
      }

      // [修复] 递归深度保护，防止 setVar → _routeVarChange → 工作流 → setVar 无限循环
      if (!self._routingDepth) self._routingDepth = 0;
      if (self._routingDepth > 3) {
        console.warn('[BridgeAPI] 递归深度超过3层，停止路由:', key);
        return;
      }
      self._routingDepth++;
      try {
        // 更新 ConfigManager 缓存
        if (ConfigManager._cache) {
          ConfigManager._cache[key] = value;
        }

        // 通过 EventBus 广播 variable:changed 事件
        // WorkflowEngine 中注册的工作流会自动匹配并执行
        var eventData = {
          key: key,
          value: value,
          timestamp: Date.now(),
          source: source || 'unknown'
        };

        // 仅对 xb.* 和 游戏数据.* 变量广播（减少噪音）
        var shouldEmit = (key.indexOf('xb.') === 0) ||
                         (key.indexOf('游戏数据.') === 0) ||
                         (key.indexOf('phone.') === 0);

        if (shouldEmit) {
          EventBus.emit('variable:changed', eventData);
          console.log('[BridgeAPI] 变量变更 [' + source + ']: ' + key + ' → EventBus');
        }
        // [MC-Fix-1] EventBus 广播完成后主动清除锁
        clearTimeout(safetyTimeout);
        delete self._processingKeys[processingKey];
      } finally {
        self._routingDepth--;
      }
    },

    initBridge: function () {
      // HTTP API 模式下不需要 PluginBridge 初始化
      console.log('[BridgeAPI] HTTP API 模式，跳过 PluginBridge 初始化');
    },

    // ---------- 初始化 ----------

    init: function () {
      ConfigManager.init();
      console.log('[BridgeAPI] 初始化完成 (HTTP API 模式)');

      // 3秒后初始化 PhoneEngine（等待所有依赖加载）
      setTimeout(function () {
        PhoneEngine.init();
      }, 3000);
    },

    // ---------- 获取API配置 ----------

    getAPIConfig: function () {
      if (window.mobileCustomAPIConfig) {
        var settings = window.mobileCustomAPIConfig.currentSettings;
        if (settings && settings.apiKey && settings.apiKey !== '你的API Key' && !/[^\x00-\x7F]/.test(settings.apiKey)) {
          if (settings.apiUrl) {
            settings.apiUrl = settings.apiUrl.replace(/^[\s`'"]+|[\s`'"]+$/g, '');
          }
          if (!settings.model && settings.profiles && settings.profiles.chat && settings.profiles.chat.model) {
            settings.model = settings.profiles.chat.model;
            console.log('[BridgeAPI] 基础model为空，使用chat场景预设:', settings.model);
          }
          return settings;
        }
      }
      return {
        apiUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'Qwen/Qwen2.5-7B-Instruct',
        temperature: 0.8,
        maxTokens: 300
      };
    },

    // ---------- 变量管理 ----------

    getVar: function (key) {
      return ConfigManager._readVar(key);
    },

    setVar: function (key, value) {
      return ConfigManager.set(key, value);
    },

    readFriendVars: function (friendName) {
      var self = this;
      var vars = {};
      var keys = [
        'phone.' + friendName + '.affection',
        'phone.' + friendName + '.summary',
        'phone.' + friendName + '.msgCount',
        'phone.' + friendName + '.lastActive'
      ];
      var legacyKeys = [
        'mobile.affection.' + friendName,
        '游戏数据.' + friendName + '.沉沦度',
        '游戏数据.' + friendName + '.阶段'
      ];
      var chain = Promise.resolve();
      for (var i = 0; i < keys.length; i++) {
        (function (k) {
          chain = chain.then(function () {
            return self.getVar(k);
          }).then(function (val) {
            if (val !== null) vars[k.replace('phone.' + friendName + '.', '')] = val;
          });
        })(keys[i]);
      }
      for (var j = 0; j < legacyKeys.length; j++) {
        (function (lk) {
          chain = chain.then(function () {
            return self.getVar(lk);
          }).then(function (lval) {
            if (lval !== null) vars['legacy_' + lk.split('.').pop()] = lval;
          });
        })(legacyKeys[j]);
      }
      return chain.then(function () { return vars; });
    },

    questVarPath: function (charId, sub) {
      return 'xb.quest.' + charId + '.' + sub;
    },

    readGlobalContext: function () {
      return this.getVar('phone.global.context');
    },

    writeChatSummary: function (friendName, friendId) {
      var self = this;
      var history = null;
      if (window.RoleAPI && window.RoleAPI.getChatHistory) {
        history = window.RoleAPI.getChatHistory(friendId);
      }
      if (!history || history.length < 2) return Promise.resolve();
      var recent = history.slice(-6);
      var summary = '';
      for (var i = 0; i < recent.length; i++) {
        var role = recent[i].role === 'user' ? '吴宇伦' : friendName;
        var content = (recent[i].msgContent || recent[i].content || '').substring(0, 80);
        summary += role + ': ' + content + '\n';
      }
      if (summary.length > 300) summary = summary.substring(0, 300) + '...';
      return self.setVar('phone.' + friendName + '.summary', summary).then(function () {
        return self.setVar('phone.' + friendName + '.msgCount', String(history.length));
      }).then(function () {
        return self.setVar('phone.' + friendName + '.lastActive', new Date().toLocaleString('zh-CN'));
      });
    },

    updateFriendVars: function (friendName, friendId) {
      var self = this;
      return self.getVar('phone.' + friendName + '.affection').then(function (current) {
        var val = parseInt(current) || 50;
        return self.setVar('phone.' + friendName + '.affection', String(Math.min(100, val + 1)));
      }).then(function () {
        return self.writeChatSummary(friendName, friendId);
      });
    },

    _clearPhoneVars: function () {
      var self = this;
      var names = ['苏晚晴', '柳如烟', '王捷', '苏媚', '吴梦娜'];
      var chain = Promise.resolve();
      for (var i = 0; i < names.length; i++) {
        (function (name) {
          chain = chain.then(function () { return self.setVar('phone.' + name + '.summary', ''); })
            .then(function () { return self.setVar('phone.' + name + '.affection', '50'); })
            .then(function () { return self.setVar('phone.' + name + '.msgCount', '0'); })
            .then(function () { return self.setVar('phone.' + name + '.lastActive', ''); });
        })(names[i]);
      }
      return chain.then(function () {
        return self.setVar('phone.global.context', '');
      });
    },

    // ---------- 业务处理方法（被工作流调用） ----------

    processPendingFriend: function (directValue) {
      var self = this;
      var valuePromise;

      // 如果直接传入了值（来自 WebSocket 事件），直接使用
      if (directValue && directValue !== '') {
        valuePromise = Promise.resolve(directValue);
      } else {
        // 否则从 STscript 读取
        valuePromise = ConfigManager.get('xb.phone.pendingFriend');
      }

      return valuePromise.then(function (pending) {
        if (!pending || pending === '') return;

        // [修复v2] 兼容 JSON 和旧格式（与 processPendingMessages 一致）
        var name, id;
        if (pending.charAt(0) === '{') {
          try {
            var friendData = JSON.parse(pending);
            name = friendData.name || '未知';
            id = friendData.friendId || friendData.id || name;
          } catch (e) {
            console.warn('[BridgeAPI] pendingFriend JSON解析失败，尝试旧格式:', e);
            var parts = pending.split('|');
            name = parts[0] || '';
            id = parts[1] || '';
          }
        } else {
          var parts = pending.split('|');
          name = parts[0] || '';
          id = parts[1] || '';
        }

        console.log('[BridgeAPI] 处理待添加好友:', name, id);

        // [修复v3] 先写入 xb.phone.friends.list 变量，确保 friendRenderer.refresh() 时不会丢失
        var syncToFriendsList = ConfigManager.get('xb.phone.friends.list').then(function(existingList) {
          var friends = [];
          if (existingList) {
            try { friends = JSON.parse(existingList); } catch(e) { friends = []; }
          }
          if (!Array.isArray(friends)) friends = [];
          var dup = friends.some(function(f) {
            return String(f.number) === String(id) || f.name === name;
          });
          if (!dup) {
            friends.push({ name: name, number: String(id), addTime: Date.now() });
            return ConfigManager.set('xb.phone.friends.list', JSON.stringify(friends));
          }
        }).catch(function(e) {
          console.warn('[BridgeAPI] 同步好友到 xb.phone.friends.list 失败:', e);
        });

        // 添加到 friendRenderer（addFriend 内部已不再调用 refresh）
        if (window.friendRenderer && window.friendRenderer.addFriend) {
          window.friendRenderer.addFriend(name, id);
        }

        return syncToFriendsList.then(function () {
          return ConfigManager.get('xb.game.friends').then(function (friends) {
            var friendList = friends ? friends.split(',') : [];
            if (friendList.indexOf(name) < 0) {
              friendList.push(name);
              return ConfigManager.set('xb.game.friends', friendList.join(','));
            }
          });
        }).then(function () {
          return ConfigManager.set('xb.phone.pendingFriend', '');
        }).then(function () {
          console.log('[BridgeAPI] 待添加好友已处理:', name);
          EventBus.emit('phone:friend_added', { name: name, id: id });
          // [修复v3] 触发消息列表 UI 刷新
          if (window.messageApp && window.messageApp.updateAppContent) {
            try { window.messageApp.updateAppContent(); } catch(e) {}
          }
        });
      }).catch(function (e) {
        console.warn('[BridgeAPI] 处理待添加好友失败:', e);
      });
    },

    processPendingMessages: function (directValue) {
      var self = this;
      var valuePromise;
      if (directValue && directValue !== '') {
        valuePromise = Promise.resolve(directValue);
      } else {
        valuePromise = ConfigManager.get('xb.phone.pendingMsg');
      }
      return valuePromise.then(function (pending) {
        if (!pending || pending === '') return;

        var charName, charId, msgType, content;

        // 兼容两种格式：
        // 旧格式: 名字|id|类型|内容
        // 新格式(JSON): {"from":"xxx","fromId":"xxx","type":"text","content":"xxx"}
        if (pending.charAt(0) === '{') {
          try {
            var msgData = JSON.parse(pending);
            charName = msgData.from || msgData.senderName || '未知';
            charId = msgData.fromId || msgData.senderId || charName;
            msgType = msgData.msgType || msgData.type || '文字';
            content = msgData.content || '';
          } catch (e) {
            console.warn('[BridgeAPI] pendingMsg JSON解析失败，尝试旧格式:', e);
            var parts = pending.split('|');
            if (parts.length < 4) return;
            charName = parts[0];
            charId = parts[1];
            msgType = parts[2];
            content = parts.slice(3).join('|');
          }
        } else {
          var parts = pending.split('|');
          if (parts.length < 4) return;
          charName = parts[0];
          charId = parts[1];
          msgType = parts[2];
          content = parts.slice(3).join('|');
        }

        console.log('[BridgeAPI] 处理待发送消息:', charName, msgType, content.substring(0, 30));

        // [修复v3] HTML 污染过滤：防止前端代码被误写入 pendingMsg
        // 检测 content 中是否包含 HTML 标签、onclick、select= 等前端代码特征
        if (content && /<[a-zA-Z\/][^>]*>/.test(content)) {
          console.warn('[BridgeAPI] ⚠️ 检测到 pendingMsg 内容包含 HTML 标签，执行过滤');
          // 移除所有 HTML 标签，只保留纯文本
          content = content.replace(/<[^>]+>/g, '').trim();
          // 移除可能的 CSS 样式残留
          content = content.replace(/\{[^}]*\}/g, '').trim();
          // 移除 onclick/select= 等属性残留
          content = content.replace(/(onclick|select|class|style|data-)[=\s][^\s]*/gi, '').trim();
          if (!content) {
            console.warn('[BridgeAPI] ⚠️ 过滤后内容为空，丢弃此消息（疑似 HTML 污染）');
            return ConfigManager.set('xb.phone.pendingMsg', '');
          }
        }

        // 通过 message-app 的数据层添加消息（而非直接操作DOM）
        if (window.messageApp) {
          self._deliverMessageToApp(charName, charId, msgType, content);
          // [修复v2] messageApp 就绪后，检查并消费缓存队列
          self._flushPendingMessages();
        } else {
          // messageApp 未就绪，缓存消息等待初始化
          if (!self._pendingMessageQueue) {
            self._pendingMessageQueue = [];
          }
          self._pendingMessageQueue.push({
            charName: charName,
            charId: charId,
            msgType: msgType,
            content: content,
            timestamp: Date.now()
          });
          console.log('[BridgeAPI] messageApp 未就绪，消息已缓存 (' + self._pendingMessageQueue.length + '条)');
        }

        return ConfigManager.set('xb.phone.pendingMsg', '');
      }).catch(function (e) {
        console.warn('[BridgeAPI] 处理待发送消息失败:', e);
      });
    },

    /**
     * 将消息投递到 message-app 的数据层
     */
    _deliverMessageToApp: function (charName, charId, msgType, content) {
      var friendId = charId || charName;

      // [修复v3] 直接操作 extractedFriends，不通过 addFriend（避免触发 updateAppContent 循环）
      if (window.friendRenderer && window.friendRenderer.extractedFriends) {
        var senderExists = window.friendRenderer.extractedFriends.some(function(f) {
          return f.number === friendId || f.name === charName;
        });
        if (!senderExists) {
          window.friendRenderer.extractedFriends.push({
            type: 'friend',
            name: charName,
            number: String(friendId),
            messageIndex: 0,
            addTime: Date.now(),
            isGroup: false,
            source: 'direct'
          });
          // 异步同步到变量（不阻塞消息投递）
          if (window.BridgeAPI && window.BridgeAPI.ConfigManager && window.BridgeAPI.ConfigManager.get) {
            window.BridgeAPI.ConfigManager.get('xb.phone.friends.list').then(function(existingList) {
              var friends = [];
              if (existingList) {
                try { friends = JSON.parse(existingList); } catch(e) { friends = []; }
              }
              if (!Array.isArray(friends)) friends = [];
              var dup = friends.some(function(f) {
                return String(f.number) === String(friendId) || f.name === charName;
              });
              if (!dup) {
                friends.push({ name: charName, number: String(friendId), addTime: Date.now() });
                window.BridgeAPI.ConfigManager.set('xb.phone.friends.list', JSON.stringify(friends));
              }
            }).catch(function() {});
          }
        }
      }

      // 确保 friendsData 存在
      if (!window.messageApp.friendsData) {
        window.messageApp.friendsData = {};
      }

      // 如果该联系人不存在，自动创建
      if (!window.messageApp.friendsData[friendId]) {
        window.messageApp.friendsData[friendId] = {
          friendId: friendId,
          friendName: charName,
          messages: [],
          lastMessage: '',
          lastTime: ''
        };
        console.log('[BridgeAPI] 自动创建联系人数据:', charName, friendId);
      }

      // 构造消息对象
      var now = new Date();
      var timeStr = (now.getHours() < 10 ? '0' : '') + now.getHours() + ':' +
                    (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();

      var newMsg = {
        fullMatch: '[对方消息|' + charName + '|' + friendId + '|' + msgType + '|' + content + ']',
        messageType: '对方消息',
        msgType: msgType,
        content: content,
        character: charName,
        sender: charName,
        number: friendId,
        time: timeStr,
        timestamp: Date.now(),
        source: 'director'
      };

      // 写入数据层
      window.messageApp.friendsData[friendId].messages.push(newMsg);
      window.messageApp.friendsData[friendId].lastMessage = content.substring(0, 20);
      window.messageApp.friendsData[friendId].lastTime = timeStr;

      // [Fix-4] 如果当前正在查看这个联系人的聊天，刷新界面
      // 修复：不再只渲染单条消息，而是重新渲染全部消息，确保降级时数据完整
      if (window.messageApp.currentFriendId === friendId &&
          window.messageApp.currentView === 'messageDetail') {
        // 优先使用增量追加（性能更好）
        var html = window.messageRenderer.renderSingleMessage(newMsg);
        if (html) {
          var container = document.querySelector('.message-detail-content');
          if (container) {
            // 检查是否已有消息内容，如果没有则说明是降级场景，需要全量渲染
            var existingMsgs = container.querySelectorAll('.message-detail');
            if (existingMsgs.length === 0) {
              // [Fix-4] 降级场景：容器为空，遍历 friendsData 渲染所有消息
              var allMsgs = window.messageApp.friendsData[friendId].messages || [];
              var allHtml = '';
              for (var mi = 0; mi < allMsgs.length; mi++) {
                var msgHtml = window.messageRenderer.renderSingleMessage(allMsgs[mi]);
                if (msgHtml) allHtml += msgHtml;
              }
              if (allHtml) {
                container.innerHTML = allHtml;
              }
            } else {
              // 正常场景：追加新消息
              container.insertAdjacentHTML('beforeend', html);
            }
            setTimeout(function () {
              container.scrollTop = container.scrollHeight;
            }, 100);
          }
        }
      } else {
        // 不在当前聊天窗口，触发通知
        EventBus.emit('phone:notification', {
          title: charName,
          content: content.substring(0, 30),
          icon: 'fa-comment',
          action: 'openChat',
          friendId: friendId,
          friendName: charName,
          source: 'director'
        });
      }

      console.log('[BridgeAPI] 消息已写入数据层 (' +
        window.messageApp.friendsData[friendId].messages.length + '条)');

      // [修复v3] 不再调用 friendRenderer.refresh()，避免清空 extractedFriends
      // 改为：如果发送者不在 extractedFriends 中，通过 addFriend 添加（会同步写入变量）
      if (window.friendRenderer && window.friendRenderer.extractedFriends) {
        var senderExists = window.friendRenderer.extractedFriends.some(function(f) {
          return f.number === friendId || f.name === charName;
        });
        if (!senderExists && window.friendRenderer.addFriend) {
          window.friendRenderer.addFriend(charName, friendId);
        }
      }

      // [修复v3] 无论当前视图是什么，都触发 UI 刷新
      // 如果在消息详情页且是当前联系人，已在上面的 insertAdjacentHTML 处理
      // 如果在列表页或其他页面，需要刷新以显示新消息
      if (window.messageApp && window.messageApp.updateAppContent) {
        try { window.messageApp.updateAppContent(); } catch (e) {}
      }

      // [Fix-2] 延迟再次强制刷新，确保 friendsData 写入后 UI 已更新
      // 解决 EventBus → WorkflowEngine → processPendingMessages 异步链路中 UI 未及时刷新的问题
      setTimeout(function () {
        if (window.messageApp && window.messageApp.updateAppContent) {
          try { window.messageApp.updateAppContent(); } catch (e) {}
        }
      }, 300);
    },

    /**
     * 刷新缓存的待处理消息（messageApp 初始化后调用）
     */
    _flushPendingMessages: function () {
      var self = this;
      if (!self._pendingMessageQueue || self._pendingMessageQueue.length === 0) return;

      var queue = self._pendingMessageQueue;
      self._pendingMessageQueue = [];
      console.log('[BridgeAPI] 刷新缓存消息: ' + queue.length + '条');

      for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        if (window.messageApp) {
          self._deliverMessageToApp(item.charName, item.charId, item.msgType, item.content);
        }
      }
    },

    processPendingQuestNotify: function (directValue) {
      var self = this;
      var valuePromise;
      if (directValue && directValue !== '') {
        valuePromise = Promise.resolve(directValue);
      } else {
        valuePromise = ConfigManager.get('xb.quest.pendingNotify');
      }
      return valuePromise.then(function (pending) {
        if (!pending || pending === '') return;

        console.log('[BridgeAPI] 处理待处理任务通知:', pending.substring(0, 50));

        // 解析通知数据
        var notifyData;
        try {
          notifyData = JSON.parse(pending);
        } catch (e) {
          notifyData = { message: pending };
        }

        // 尝试通过 QuestEngine 注册任务
        if (window.QuestEngine) {
          try {
            // 如果是任务创建通知，尝试注册到 QuestEngine
            if (notifyData.action === 'created' && notifyData.name) {
              var questDef = {
                id: notifyData.questId || ('director_' + Date.now()),
                name: notifyData.name,
                description: notifyData.description || '',
                type: notifyData.questType || 'side',
                reward: notifyData.reward || {},
                steps: notifyData.steps || [],
                status: 'available'
              };
              // 使用 QuestEngine 的内部方法注册
              if (typeof window.QuestEngine.registerQuest === 'function') {
                window.QuestEngine.registerQuest(questDef).then(function () {
                  console.log('[BridgeAPI] 任务已注册到 QuestEngine:', questDef.name);
                  // [修复v3] 使用 saveActiveQuest 写入 available 状态，确保 QuestApp 能读取到
                  var activeState = {
                    questId: questDef.id,
                    status: 'available',
                    registeredAt: Date.now(),
                    currentStep: -1,
                    stepStates: [],
                    acceptedAt: null,
                    completedAt: null,
                    rewardClaimed: false,
                    progress: {}
                  };
                  if (typeof window.QuestEngine.saveActiveQuest === 'function') {
                    return window.QuestEngine.saveActiveQuest(questDef.id, activeState);
                  } else {
                    // 降级：直接写入变量
                    var activeVarPath = 'xb.quest.active.' + questDef.id;
                    return ConfigManager.set(activeVarPath, JSON.stringify(activeState));
                  }
                }).then(function () {
                  console.log('[BridgeAPI] 任务状态已创建:', questDef.id);
                }).catch(function (e) {
                  console.warn('[BridgeAPI] QuestEngine 注册任务失败:', e);
                });
              }
            }
          } catch (e) {
            console.warn('[BridgeAPI] QuestEngine 处理失败:', e);
          }
        }

        // 通知 quest-app 刷新数据并重渲染 UI（拉模式兼容）
        // [修复v3] refreshData 后必须触发 renderApp 才能更新面板
        var questAppRef = window.questApp || window.QuestApp;
        if (questAppRef && typeof questAppRef.refreshData === 'function') {
          setTimeout(function () {
            questAppRef.refreshData().then(function () {
              // [修复v3] 数据刷新后触发 UI 重渲染
              if (typeof questAppRef.renderApp === 'function') {
                questAppRef.renderApp();
                console.log('[BridgeAPI] 已通知 questApp 刷新数据并重渲染 UI');
              } else if (typeof questAppRef.getAppContent === 'function' && typeof questAppRef.updateAppContent === 'function') {
                questAppRef.updateAppContent();
                console.log('[BridgeAPI] 已通知 questApp 刷新数据并更新内容');
              } else {
                console.log('[BridgeAPI] 已通知 questApp 刷新数据（无可用渲染方法）');
              }
            });
          }, 300);
        }

        // 触发手机通知
        if (notifyData.name) {
          EventBus.emit('phone:notification', {
            title: '新任务',
            content: notifyData.name,
            icon: 'fa-quest',
            action: 'openQuest',
            source: 'director'
          });
        }

        return ConfigManager.set('xb.quest.pendingNotify', '');
      }).catch(function (e) {
        console.warn('[BridgeAPI] 处理待处理任务通知失败:', e);
      });
    },

    // ---------- 游戏变量同步 ----------

    syncGameVariables: function () {
      var self = this;
      return Promise.resolve().then(function () {
        return ConfigManager._readVar('游戏数据.系统.当前角色');
      }).then(function (currentChar) {
        if (currentChar && currentChar !== '') {
          return ConfigManager.set('xb.game.activeChar', currentChar);
        }
      }).then(function () {
        return ConfigManager._readVar('游戏数据.系统.当前场景');
      }).then(function (currentScene) {
        if (currentScene && currentScene !== '') {
          return ConfigManager.set('xb.game.scene', currentScene);
        }
      }).then(function () {
        return ConfigManager._readVar('游戏数据.系统.当前阶段');
      }).then(function (currentPhase) {
        if (currentPhase && currentPhase !== '') {
          return ConfigManager.set('xb.game.phase', currentPhase);
        }
      }).then(function () {
        console.log('[BridgeAPI] 游戏变量同步完成');
      }).catch(function (e) {
        console.warn('[BridgeAPI] 游戏变量同步失败:', e);
      });
    }
  };

  // ============================================================
  // 第七部分：全局挂载
  // ============================================================
  if (!window.BridgeAPI) {
    window.BridgeAPI = BridgeAPI;
  } else {
    console.log('[BridgeAPI] 已存在，跳过重复加载');
  }
  if (!window.PhoneConfig) {
    window.PhoneConfig = ConfigManager;
  } else {
    console.log('[PhoneConfig] 已存在，跳过重复加载');
  }
  if (!window.PhoneEngine) {
    window.PhoneEngine = PhoneEngine;
  } else {
    console.log('[PhoneEngine] 已存在，跳过重复加载');
  }
  if (!window.UnifiedAI) {
    window.UnifiedAI = UnifiedAI;
  } else {
    console.log('[UnifiedAI] 已存在，跳过重复加载');
  }
  // [修复] 挂载 WorkflowEngine 到全局，便于外部调试和访问
  if (!window.WorkflowEngine) {
    window.WorkflowEngine = WorkflowEngine;
    console.log('[BridgeAPI] WorkflowEngine 已挂载到全局');
  } else {
    console.log('[WorkflowEngine] 已存在，跳过');
  }

  // 动态加载任务系统模块（在 BridgeAPI 初始化完成后）
  var _base = (document.currentScript && document.currentScript.src) 
    ? document.currentScript.src.replace(/[^/]*$/, '') 
    : '/scripts/extensions/third-party/mobile/';
  var _questScripts = [
    _base + 'quest-engine.js',
    _base + 'quest-planner-bridge.js'
  ];
  _questScripts.forEach(function (src) {
    var id = 'qb-' + src.split('/').pop().replace('.js', '');
    if (!document.getElementById(id)) {
      var s = document.createElement('script');
      s.id = id;
      s.src = src;
      s.onerror = function () {
        console.warn('[BridgeAPI] 加载失败（非致命）:', src);
      };
      document.head.appendChild(s);
    }
  });

  // 全局变量同步函数 — 供循环任务(taskjs)调用
  // 用法: await window.syncToPhone('xb.phone.pendingMsg', '苏晚晴|1001|文字|你好')
  window.syncToPhone = async function (key, value) {
    if (!key || typeof key !== 'string') return;
    if (!key.startsWith('xb.') && !key.startsWith('游戏数据.') && !key.startsWith('phone.')) return;
    try {
      var h = window.location.hostname || '127.0.0.1';
      var r = await fetch('http://' + h + ':3001/api/var/' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(value ?? '') })
      });
      if (r.ok) console.log('[syncToPhone] ' + key);
      else console.warn('[syncToPhone] HTTP ' + r.status, key);
    } catch (e) {
      console.warn('[syncToPhone] 失败:', key, e.message);
    }
  };
  window.EventBus = EventBus;

  console.log('[BridgeAPI] 模块已加载 (含 PhoneEngine 工作流引擎)');

  // 自动初始化
  setTimeout(function () {
    if (window.BridgeAPI && typeof window.BridgeAPI.init === 'function') {
      window.BridgeAPI.init();
    }
  }, 500);
})();
