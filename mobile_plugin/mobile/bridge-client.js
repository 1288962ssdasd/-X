/**
 * BridgeClient - 插件桥接服务器客户端SDK
 * 供外置手机插件和小白X插件在WebView中调用
 *
 * 环境要求：Android WebView（SillyTavern插件环境）
 * 兼容性：不使用 ES Module、顶层 await、optional chaining (?.)、nullish coalescing (??)
 */
(function () {
    'use strict';

    // ==================== 工具函数 ====================

    /**
     * 日志输出（带级别控制）
     * logLevel: 'log'=0, 'warn'=1, 'error'=2, 'silent'=99
     */
    function _log(level, msg) {
        var levels = { log: 0, warn: 1, error: 2, silent: 99 };
        var configLevel = levels[BridgeClient.config.logLevel] || 0;
        if (levels[level] < configLevel) return;

        var prefix = '[BridgeClient]';
        var time = new Date().toLocaleTimeString();
        if (level === 'error') {
            console.error(prefix + ' [' + time + '] ' + msg);
        } else if (level === 'warn') {
            console.warn(prefix + ' [' + time + '] ' + msg);
        } else {
            console.log(prefix + ' [' + time + '] ' + msg);
        }
    }

    /**
     * 生成唯一请求ID
     */
    function _generateId() {
        return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 事件去重：相同事件在100ms内只处理一次
     */
    var _eventDedupeMap = {};
    var EVENT_DEDUPE_INTERVAL = 100;

    function _isDuplicateEvent(eventName) {
        var now = Date.now();
        var lastTime = _eventDedupeMap[eventName];
        if (lastTime && (now - lastTime) < EVENT_DEDUPE_INTERVAL) {
            return true;
        }
        _eventDedupeMap[eventName] = now;
        return false;
    }

    /**
     * 定期清理去重缓存（防止内存泄漏）
     */
    setInterval(function () {
        var now = Date.now();
        var keys = Object.keys(_eventDedupeMap);
        for (var i = 0; i < keys.length; i++) {
            if (now - _eventDedupeMap[keys[i]] > EVENT_DEDUPE_INTERVAL * 10) {
                delete _eventDedupeMap[keys[i]];
            }
        }
    }, EVENT_DEDUPE_INTERVAL * 20);

    // ==================== BridgeClient 定义 ====================

    var BridgeClient = {
        // --- 配置 ---
        config: {
            // 自动检测服务器地址：
            // 手机 WebView → 127.0.0.1（本机）
            // 电脑浏览器访问手机 → 自动使用当前页面的 hostname
            serverUrl: (function () {
                var host = window.location.hostname;
                // 如果是 localhost/127.0.0.1/file:// 等，使用 127.0.0.1
                if (!host || host === 'localhost' || host === '127.0.0.1' ||
                    host === '[::1]' || window.location.protocol === 'file:') {
                    return 'http://127.0.0.1:3001';
                }
                // 否则使用当前页面的 hostname（电脑远程访问手机场景）
                return 'http://' + host + ':3001';
            })(),
            reconnectInterval: 3000,
            maxReconnectAttempts: 10,
            requestTimeout: 5000,
            wsEnabled: true,
            heartbeatEnabled: true,
            logLevel: 'warn'  // 默认只输出 warn 和 error，减少控制台刷屏
        },

        // --- 内部状态 ---
        _ws: null,
        _connected: false,
        _reconnectAttempts: 0,
        _reconnectTimer: null,
        _subscriptions: {},
        _requestId: 0,
        _pendingRequests: {},
        _eventHandlers: {},
        _heartbeatTimer: null,
        _httpMode: false,       // 是否降级为纯HTTP模式
        _destroyed: false,

        // ==================== 初始化 ====================

        /**
         * 初始化并连接
         * @param {Object} config - 可选配置覆盖
         */
        init: function (config) {
            _log('log', '初始化 BridgeClient...');
            this._destroyed = false;

            if (config) {
                var keys = Object.keys(config);
                for (var i = 0; i < keys.length; i++) {
                    this.config[keys[i]] = config[keys[i]];
                }
            }

            _log('log', '配置: serverUrl=' + this.config.serverUrl +
                ', wsEnabled=' + this.config.wsEnabled +
                ', heartbeatEnabled=' + this.config.heartbeatEnabled);

            if (this.config.wsEnabled) {
                this.connect();
            } else {
                this._httpMode = true;
                _log('log', 'WebSocket已禁用，使用纯HTTP模式');
            }

            return this;
        },

        /**
         * 断开连接并清理所有资源
         */
        destroy: function () {
            _log('log', '销毁 BridgeClient...');
            this._destroyed = true;
            this.disconnect();
            this._cleanupPendingRequests();
            this._subscriptions = {};
            this._eventHandlers = {};
            this._httpMode = false;
            this._reconnectAttempts = 0;
            _log('log', 'BridgeClient 已销毁');
        },

        // ==================== 连接管理 ====================

        /**
         * 建立WebSocket连接
         */
        connect: function () {
            var self = this;

            if (this._destroyed) {
                _log('warn', 'BridgeClient 已销毁，无法连接');
                return;
            }

            if (this._ws) {
                _log('warn', 'WebSocket 已存在，先断开');
                this.disconnect();
            }

            var wsUrl = this.config.serverUrl
                .replace(/^http/, 'ws')
                .replace(/\/$/, '');

            _log('log', '正在连接 WebSocket: ' + wsUrl);

            try {
                this._ws = new WebSocket(wsUrl);
            } catch (e) {
                _log('error', '创建 WebSocket 失败: ' + (e.message || e));
                this._fallbackToHttp();
                return;
            }

            this._ws.onopen = function () {
                _log('log', 'WebSocket 已连接');
                self._connected = true;
                self._httpMode = false;
                self._reconnectAttempts = 0;

                // 重新发送订阅
                self._resendSubscriptions();

                // 启动心跳
                if (self.config.heartbeatEnabled) {
                    self._startHeartbeat();
                }

                // 触发连接事件
                self._emitLocalEvent('connected');
            };

            this._ws.onclose = function (event) {
                _log('log', 'WebSocket 已关闭 (code=' + event.code + ', reason=' + (event.reason || '') + ')');
                self._connected = false;
                self._stopHeartbeat();

                if (!self._destroyed) {
                    self._emitLocalEvent('disconnected');
                    self.reconnect();
                }
            };

            this._ws.onerror = function (event) {
                _log('error', 'WebSocket 错误');
                // onclose 会在 onerror 之后触发，重连逻辑在 onclose 中处理
            };

            this._ws.onmessage = function (event) {
                self._handleWSMessage(event.data);
            };
        },

        /**
         * 断开WebSocket连接
         */
        disconnect: function () {
            this._stopHeartbeat();
            this._clearReconnectTimer();

            if (this._ws) {
                this._ws.onopen = null;
                this._ws.onclose = null;
                this._ws.onerror = null;
                this._ws.onmessage = null;

                try {
                    this._ws.close();
                } catch (e) {
                    // 忽略关闭错误
                }

                this._ws = null;
            }

            this._connected = false;
        },

        /**
         * 重连（指数退避）
         */
        reconnect: function () {
            var self = this;

            if (this._destroyed) {
                return;
            }

            if (this._reconnectAttempts >= this.config.maxReconnectAttempts) {
                _log('warn', '已达最大重连次数 (' + this.config.maxReconnectAttempts + ')，降级为HTTP模式');
                this._fallbackToHttp();
                return;
            }

            this._clearReconnectTimer();

            // 指数退避：3s -> 6s -> 12s -> 24s -> 30s (最大)
            var baseInterval = this.config.reconnectInterval;
            var delay = Math.min(baseInterval * Math.pow(2, this._reconnectAttempts), 30000);

            this._reconnectAttempts++;
            _log('log', '将在 ' + delay + 'ms 后进行第 ' + this._reconnectAttempts + ' 次重连...');

            this._reconnectTimer = setTimeout(function () {
                if (!self._destroyed) {
                    self.connect();
                }
            }, delay);
        },

        /**
         * 是否已连接
         */
        isConnected: function () {
            return this._connected;
        },

        /**
         * 降级为纯HTTP模式
         */
        _fallbackToHttp: function () {
            _log('warn', '降级为纯HTTP模式');
            this._httpMode = true;
            this._connected = false;
            this._emitLocalEvent('fallback');
        },

        /**
         * 清除重连定时器
         */
        _clearReconnectTimer: function () {
            if (this._reconnectTimer) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
            }
        },

        // ==================== 心跳 ====================

        /**
         * 启动心跳
         */
        _startHeartbeat: function () {
            var self = this;
            this._stopHeartbeat();
            this._heartbeatTimer = setInterval(function () {
                if (self._connected && self._ws && self._ws.readyState === WebSocket.OPEN) {
                    try {
                        self._ws.send(JSON.stringify({ type: 'ping' }));
                    } catch (e) {
                        _log('warn', '发送心跳失败: ' + (e.message || e));
                    }
                }
            }, 30000);
        },

        /**
         * 停止心跳
         */
        _stopHeartbeat: function () {
            if (this._heartbeatTimer) {
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
            }
        },

        // ==================== 变量操作（核心API） ====================

        /**
         * 获取变量值
         * @param {string} key - 变量名
         * @returns {Promise<string|null>}
         */
        getVar: function (key) {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'getVar: ' + key);
                self._httpGet('/api/var/' + encodeURIComponent(key))
                    .then(function (result) {
                        if (result && typeof result.value !== 'undefined') {
                            resolve(result.value);
                        } else {
                            resolve(null);
                        }
                    })
                    .catch(function (err) {
                        // [修复v2] 超时和 4xx 错误静默（高频轮询场景，变量不存在是正常情况）
                        var msg = err.message || err;
                        if (msg.indexOf('timeout') !== -1 || msg.indexOf('HTTP 4') !== -1 || msg.indexOf('HTTP 5') !== -1) {
                            // 静默
                        } else {
                            _log('warn', 'getVar 失败: ' + key + ' - ' + msg);
                        }
                        resolve(null);
                    });
            });
        },

        /**
         * 设置变量值
         * @param {string} key - 变量名
         * @param {string} value - 变量值
         * @param {number} [ttl] - 可选过期时间（秒）
         * @returns {Promise<boolean>}
         */
        setVar: function (key, value, ttl) {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'setVar: ' + key);
                var data = { value: value };
                if (typeof ttl === 'number' && ttl > 0) {
                    data.ttl = ttl;
                }
                self._httpPost('/api/var/' + encodeURIComponent(key), data)
                    .then(function (result) {
                        resolve(true);
                    })
                    .catch(function (err) {
                        _log('error', 'setVar 失败: ' + key + ' - ' + (err.message || err));
                        resolve(false);
                    });
            });
        },

        /**
         * 删除变量
         * @param {string} key - 变量名
         * @returns {Promise<boolean>}
         */
        deleteVar: function (key) {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'deleteVar: ' + key);
                self._httpDelete('/api/var/' + encodeURIComponent(key))
                    .then(function (result) {
                        resolve(true);
                    })
                    .catch(function (err) {
                        _log('error', 'deleteVar 失败: ' + key + ' - ' + (err.message || err));
                        resolve(false);
                    });
            });
        },

        /**
         * 批量获取变量
         * @param {string[]} keys - 变量名数组
         * @returns {Promise<Object>}
         */
        batchGet: function (keys) {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'batchGet: ' + keys.length + ' 个变量');
                self._httpPost('/api/var/batch', { keys: keys })
                    .then(function (result) {
                        resolve(result || {});
                    })
                    .catch(function (err) {
                        // 超时静默
                        if (!(err.message && err.message.indexOf('timeout') !== -1)) {
                            _log('warn', 'batchGet 失败: ' + (err.message || err));
                        }
                        resolve({});
                    });
            });
        },

        /**
         * 批量设置变量
         * @param {Object} vars - 键值对 { key: value, ... }
         * @param {number} [ttl] - 可选过期时间（秒）
         * @returns {Promise<boolean>}
         */
        batchSet: function (vars, ttl) {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'batchSet: ' + Object.keys(vars).length + ' 个变量');
                var data = { vars: vars };
                if (typeof ttl === 'number' && ttl > 0) {
                    data.ttl = ttl;
                }
                self._httpPost('/api/var/batch', data)
                    .then(function (result) {
                        resolve(true);
                    })
                    .catch(function (err) {
                        _log('error', 'batchSet 失败: ' + (err.message || err));
                        resolve(false);
                    });
            });
        },

        // ==================== 服务器状态 ====================

        /**
         * 获取服务器状态
         * @returns {Promise<Object>}
         */
        getServerStatus: function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'getServerStatus');
                self._httpGet('/api/status')
                    .then(function (result) {
                        resolve(result || {});
                    })
                    .catch(function (err) {
                        _log('error', 'getServerStatus 失败: ' + (err.message || err));
                        resolve({});
                    });
            });
        },

        /**
         * 检查服务器是否在线
         * @returns {Promise<boolean>}
         */
        healthCheck: function () {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'healthCheck');
                self._httpGet('/api/health')
                    .then(function (result) {
                        resolve(true);
                    })
                    .catch(function (err) {
                        if (!(err.message && err.message.indexOf('timeout') !== -1)) {
                            _log('warn', 'healthCheck 失败: ' + (err.message || err));
                        }
                        resolve(false);
                    });
            });
        },

        // ==================== 事件操作 ====================

        /**
         * 发布事件
         * @param {string} eventName - 事件名
         * @param {*} data - 事件数据
         * @returns {Promise}
         */
        publish: function (eventName, data) {
            var self = this;
            return new Promise(function (resolve, reject) {
                _log('log', 'publish: ' + eventName);

                // 如果WebSocket已连接，通过WebSocket发送
                if (self._connected && self._ws && self._ws.readyState === WebSocket.OPEN) {
                    try {
                        self._ws.send(JSON.stringify({
                            type: 'publish',
                            event: eventName,
                            data: data
                        }));
                        resolve(true);
                        return;
                    } catch (e) {
                        _log('warn', 'WebSocket发送失败，降级为HTTP: ' + (e.message || e));
                    }
                }

                // 降级为HTTP
                self._httpPost('/api/event/' + encodeURIComponent(eventName), { data: data })
                    .then(function () {
                        resolve(true);
                    })
                    .catch(function (err) {
                        _log('error', 'publish 失败: ' + eventName + ' - ' + (err.message || err));
                        resolve(false);
                    });
            });
        },

        /**
         * 订阅事件（通过WebSocket）
         * @param {string} pattern - 事件模式（支持通配符 *）
         * @param {Function} handler - 事件处理函数
         */
        subscribe: function (pattern, handler) {
            _log('log', 'subscribe: ' + pattern);

            this._subscriptions[pattern] = handler;

            // 如果WebSocket已连接，发送订阅消息
            if (this._connected && this._ws && this._ws.readyState === WebSocket.OPEN) {
                try {
                    this._ws.send(JSON.stringify({
                        type: 'subscribe',
                        pattern: pattern
                    }));
                } catch (e) {
                    _log('warn', '发送订阅消息失败: ' + (e.message || e));
                }
            }
        },

        /**
         * 取消订阅
         * @param {string} pattern - 事件模式
         */
        unsubscribe: function (pattern) {
            _log('log', 'unsubscribe: ' + pattern);

            delete this._subscriptions[pattern];

            // 如果WebSocket已连接，发送取消订阅消息
            if (this._connected && this._ws && this._ws.readyState === WebSocket.OPEN) {
                try {
                    this._ws.send(JSON.stringify({
                        type: 'unsubscribe',
                        pattern: pattern
                    }));
                } catch (e) {
                    _log('warn', '发送取消订阅消息失败: ' + (e.message || e));
                }
            }
        },

        /**
         * 重新发送所有订阅（重连后使用）
         */
        _resendSubscriptions: function () {
            var patterns = Object.keys(this._subscriptions);
            if (patterns.length === 0) {
                return;
            }

            _log('log', '重新发送 ' + patterns.length + ' 个订阅...');

            for (var i = 0; i < patterns.length; i++) {
                try {
                    this._ws.send(JSON.stringify({
                        type: 'subscribe',
                        pattern: patterns[i]
                    }));
                } catch (e) {
                    _log('warn', '重新发送订阅失败: ' + patterns[i] + ' - ' + (e.message || e));
                }
            }
        },

        /**
         * 注册本地事件处理器
         * @param {string} eventName - 事件名
         * @param {Function} handler - 处理函数
         */
        on: function (eventName, handler) {
            if (typeof handler !== 'function') {
                _log('warn', 'on: handler 不是函数');
                return;
            }

            if (!this._eventHandlers[eventName]) {
                this._eventHandlers[eventName] = [];
            }

            // 限制每个事件最多20个处理器（内存安全）
            if (this._eventHandlers[eventName].length >= 20) {
                _log('warn', 'on: 事件 "' + eventName + '" 处理器已达上限 (20)');
                return;
            }

            this._eventHandlers[eventName].push(handler);
            _log('log', 'on: 已注册 "' + eventName + '" 处理器 (当前 ' +
                this._eventHandlers[eventName].length + ' 个)');
        },

        /**
         * 移除本地事件处理器
         * @param {string} eventName - 事件名
         * @param {Function} handler - 要移除的处理函数
         */
        off: function (eventName, handler) {
            if (!this._eventHandlers[eventName]) {
                return;
            }

            var handlers = this._eventHandlers[eventName];
            var newHandlers = [];

            for (var i = 0; i < handlers.length; i++) {
                if (handlers[i] !== handler) {
                    newHandlers.push(handlers[i]);
                }
            }

            if (newHandlers.length === 0) {
                delete this._eventHandlers[eventName];
            } else {
                this._eventHandlers[eventName] = newHandlers;
            }

            _log('log', 'off: 已移除 "' + eventName + '" 处理器 (剩余 ' + newHandlers.length + ' 个)');
        },

        /**
         * 触发本地事件处理器
         * @param {string} eventName - 事件名
         * @param {*} data - 事件数据
         */
        _emitLocalEvent: function (eventName, data) {
            var handlers = this._eventHandlers[eventName];
            if (!handlers || handlers.length === 0) {
                return;
            }

            for (var i = 0; i < handlers.length; i++) {
                try {
                    handlers[i](data);
                } catch (e) {
                    _log('error', '事件处理器执行出错 (' + eventName + '): ' + (e.message || e));
                }
            }
        },

        // ==================== HTTP请求（内部使用） ====================

        /**
         * HTTP GET 请求
         * @param {string} path - 请求路径
         * @returns {Promise<Object>}
         */
        _httpGet: function (path) {
            var self = this;
            return new Promise(function (resolve, reject) {
                var url = self.config.serverUrl.replace(/\/$/, '') + path;
                var timeoutId = null;

                _log('log', 'HTTP GET: ' + url);

                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.timeout = self.config.requestTimeout;

                timeoutId = setTimeout(function () {
                    _log('warn', 'HTTP GET 超时: ' + url);
                    xhr.abort();
                    reject(new Error('Request timeout'));
                }, self.config.requestTimeout);

                xhr.onload = function () {
                    clearTimeout(timeoutId);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var data = JSON.parse(xhr.responseText);
                            resolve(data);
                        } catch (e) {
                            _log('error', 'HTTP GET 解析响应失败: ' + url);
                            reject(new Error('Invalid JSON response'));
                        }
                    } else {
                        // [修复v2] 404 等客户端错误静默（高频轮询场景）
                        if (xhr.status === 404) {
                            // 静默：变量不存在是正常情况
                        } else {
                            _log('warn', 'HTTP GET 失败: ' + url + ' (status=' + xhr.status + ')');
                        }
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };

                xhr.onerror = function () {
                    clearTimeout(timeoutId);
                    _log('error', 'HTTP GET 网络错误: ' + url);
                    reject(new Error('Network error'));
                };

                xhr.ontimeout = function () {
                    clearTimeout(timeoutId);
                    _log('warn', 'HTTP GET 超时: ' + url);
                    reject(new Error('Request timeout'));
                };

                try {
                    xhr.send();
                } catch (e) {
                    clearTimeout(timeoutId);
                    _log('error', 'HTTP GET 发送失败: ' + (e.message || e));
                    reject(e);
                }
            });
        },

        /**
         * HTTP POST 请求
         * @param {string} path - 请求路径
         * @param {Object} data - 请求数据
         * @returns {Promise<Object>}
         */
        _httpPost: function (path, data) {
            var self = this;
            return new Promise(function (resolve, reject) {
                var url = self.config.serverUrl.replace(/\/$/, '') + path;
                var timeoutId = null;
                var body = JSON.stringify(data || {});

                _log('log', 'HTTP POST: ' + url);

                var xhr = new XMLHttpRequest();
                xhr.open('POST', url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.timeout = self.config.requestTimeout;

                timeoutId = setTimeout(function () {
                    _log('warn', 'HTTP POST 超时: ' + url);
                    xhr.abort();
                    reject(new Error('Request timeout'));
                }, self.config.requestTimeout);

                xhr.onload = function () {
                    clearTimeout(timeoutId);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var resp = JSON.parse(xhr.responseText);
                            resolve(resp);
                        } catch (e) {
                            resolve({});
                        }
                    } else {
                        // [修复v2] 404 静默
                        if (xhr.status !== 404) {
                            _log('warn', 'HTTP POST 失败: ' + url + ' (status=' + xhr.status + ')');
                        }
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };

                xhr.onerror = function () {
                    clearTimeout(timeoutId);
                    _log('error', 'HTTP POST 网络错误: ' + url);
                    reject(new Error('Network error'));
                };

                xhr.ontimeout = function () {
                    clearTimeout(timeoutId);
                    _log('warn', 'HTTP POST 超时: ' + url);
                    reject(new Error('Request timeout'));
                };

                try {
                    xhr.send(body);
                } catch (e) {
                    clearTimeout(timeoutId);
                    _log('error', 'HTTP POST 发送失败: ' + (e.message || e));
                    reject(e);
                }
            });
        },

        /**
         * HTTP DELETE 请求
         * @param {string} path - 请求路径
         * @returns {Promise<Object>}
         */
        _httpDelete: function (path) {
            var self = this;
            return new Promise(function (resolve, reject) {
                var url = self.config.serverUrl.replace(/\/$/, '') + path;
                var timeoutId = null;

                _log('log', 'HTTP DELETE: ' + url);

                var xhr = new XMLHttpRequest();
                xhr.open('DELETE', url, true);
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.timeout = self.config.requestTimeout;

                timeoutId = setTimeout(function () {
                    _log('warn', 'HTTP DELETE 超时: ' + url);
                    xhr.abort();
                    reject(new Error('Request timeout'));
                }, self.config.requestTimeout);

                xhr.onload = function () {
                    clearTimeout(timeoutId);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var data = JSON.parse(xhr.responseText);
                            resolve(data);
                        } catch (e) {
                            resolve({});
                        }
                    } else {
                        // [修复v2] 404 静默
                        if (xhr.status !== 404) {
                            _log('warn', 'HTTP DELETE 失败: ' + url + ' (status=' + xhr.status + ')');
                        }
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };

                xhr.onerror = function () {
                    clearTimeout(timeoutId);
                    _log('error', 'HTTP DELETE 网络错误: ' + url);
                    reject(new Error('Network error'));
                };

                xhr.ontimeout = function () {
                    clearTimeout(timeoutId);
                    _log('warn', 'HTTP DELETE 超时: ' + url);
                    reject(new Error('Request timeout'));
                };

                try {
                    xhr.send();
                } catch (e) {
                    clearTimeout(timeoutId);
                    _log('error', 'HTTP DELETE 发送失败: ' + (e.message || e));
                    reject(e);
                }
            });
        },

        // ==================== WebSocket消息处理 ====================

        /**
         * 处理WebSocket消息
         * @param {string} message - 原始消息字符串
         */
        _handleWSMessage: function (message) {
            var data;
            try {
                data = JSON.parse(message);
            } catch (e) {
                _log('warn', '收到非JSON消息: ' + message);
                return;
            }

            if (!data || !data.type) {
                _log('warn', '收到无效消息: ' + message);
                return;
            }

            switch (data.type) {
                case 'event':
                    this._handleWSEvent(data);
                    break;
                case 'events':
                    if (data.events && Array.isArray(data.events)) {
                        for (var ei = 0; ei < data.events.length; ei++) {
                            this._handleWSEvent(data.events[ei]);
                        }
                    }
                    break;
                case 'pong':
                    _log('log', '收到 pong');
                    break;
                case 'subscribed':
                    _log('log', '订阅确认: ' + (data.pattern || ''));
                    break;
                case 'unsubscribed':
                    _log('log', '取消订阅确认: ' + (data.pattern || ''));
                    break;
                case 'response':
                    this._handleWSResponse(data);
                    break;
                case 'error':
                    _log('error', '服务器错误: ' + (data.message || '未知错误'));
                    this._emitLocalEvent('error', data);
                    break;
                default:
                    _log('log', '收到未知类型消息: ' + data.type);
            }
        },

        /**
         * 处理WebSocket事件消息
         * @param {Object} event - 事件对象 { type, event, data, timestamp }
         */
        _handleWSEvent: function (event) {
            var eventName = event.event;
            var eventData = event.data;

            if (!eventName) {
                return;
            }

            // 事件去重
            if (_isDuplicateEvent(eventName)) {
                _log('log', '事件去重: ' + eventName);
                return;
            }

            _log('log', '收到事件: ' + eventName);

            // 查找匹配的订阅处理器
            var patterns = Object.keys(this._subscriptions);
            for (var i = 0; i < patterns.length; i++) {
                if (this._matchPattern(patterns[i], eventName)) {
                    try {
                        this._subscriptions[patterns[i]](eventName, eventData, event.timestamp);
                    } catch (e) {
                        _log('error', '订阅处理器执行出错 (' + patterns[i] + '): ' + (e.message || e));
                    }
                }
            }

            // 触发本地事件处理器
            this._emitLocalEvent(eventName, eventData);
            this._emitLocalEvent('event', { event: eventName, data: eventData, timestamp: event.timestamp });
        },

        /**
         * 处理WebSocket响应消息
         * @param {Object} response - 响应对象 { type, id, result, error }
         */
        _handleWSResponse: function (response) {
            var id = response.id;
            if (!id || !this._pendingRequests[id]) {
                return;
            }

            var pending = this._pendingRequests[id];
            delete this._pendingRequests[id];

            if (pending.timer) {
                clearTimeout(pending.timer);
            }

            if (response.error) {
                pending.reject(new Error(response.error));
            } else {
                pending.resolve(response.result);
            }
        },

        /**
         * 通配符模式匹配
         * @param {string} pattern - 模式（支持 * 通配符）
         * @param {string} eventName - 事件名
         * @returns {boolean}
         */
        _matchPattern: function (pattern, eventName) {
            if (pattern === '*') {
                return true;
            }

            // 将通配符模式转换为正则
            var regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
            try {
                var regex = new RegExp(regexStr);
                return regex.test(eventName);
            } catch (e) {
                return false;
            }
        },

        // ==================== 工具 ====================

        /**
         * 清理所有等待中的请求
         */
        _cleanupPendingRequests: function () {
            var ids = Object.keys(this._pendingRequests);
            for (var i = 0; i < ids.length; i++) {
                var pending = this._pendingRequests[ids[i]];
                if (pending.timer) {
                    clearTimeout(pending.timer);
                }
                try {
                    pending.reject(new Error('Connection closed'));
                } catch (e) {
                    // 忽略
                }
            }
            this._pendingRequests = {};
        },

        /**
         * 生成唯一请求ID
         */
        _generateId: function () {
            this._requestId++;
            return 'req_' + this._requestId + '_' + Date.now().toString(36);
        }
    };

    // ==================== 兼容层 ====================

    /**
     * 兼容 BridgeAPI._readVar 接口
     * @param {string} key - 变量名
     * @returns {Promise<string|null>}
     */
    BridgeClient._readVar = function (key) {
        return this.getVar(key);
    };

    /**
     * 兼容 BridgeAPI._writeVar 接口
     * @param {string} key - 变量名
     * @param {string} value - 变量值
     * @returns {Promise<boolean>}
     */
    BridgeClient._writeVar = function (key, value) {
        return this.setVar(key, value);
    };

    // ==================== 挂载到全局 ====================

    window.BridgeClient = BridgeClient;

    _log('log', 'BridgeClient 已加载');

})();
