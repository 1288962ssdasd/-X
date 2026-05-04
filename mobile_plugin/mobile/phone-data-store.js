/**
 * PhoneDataStore - 统一数据层
 * 
 * 功能：
 * - 内存缓存（同步读取，永远是最新值）
 * - 事件广播（变更时通知所有订阅者）
 * - 变量持久化（异步写入小白X变量）
 * - 模块就绪检测（解决时序问题）
 * 
 * 使用方式：
 * - 读取：PhoneDataStore.get('friends')
 * - 写入：PhoneDataStore.set('friends', [...])
 * - 订阅：PhoneDataStore.subscribe('friends', callback)
 */

console.log('[PhoneDataStore] 开始加载 phone-data-store.js...');

(function () {
    'use strict';

    console.log('[PhoneDataStore] IIFE 开始执行...');

    // ============================================================
    // 第一部分：核心存储
    // ============================================================
    var _cache = {};
    var _subscribers = {};
    var _pendingEvents = {};
    var _moduleReady = {};
    var _history = [];
    var _maxHistory = 100;
    var _persistQueue = [];
    var _persistInProgress = false;

    // ============================================================
    // 第二部分：工具函数
    // ============================================================
    function log() {
        var args = ['[PhoneDataStore]'];
        for (var i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        console.log.apply(console, args);
    }

    function warn() {
        var args = ['[PhoneDataStore]'];
        for (var i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        console.warn.apply(console, args);
    }

    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (obj instanceof Array) {
            return obj.map(function (item) { return deepClone(item); });
        }
        var clone = {};
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                clone[key] = deepClone(obj[key]);
            }
        }
        return clone;
    }

    function generateId() {
        return 'pds_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    }

    // ============================================================
    // 第三部分：持久化队列
    // ============================================================
    function processPersistQueue() {
        if (_persistInProgress || _persistQueue.length === 0) {
            return;
        }

        _persistInProgress = true;
        var item = _persistQueue.shift();

        var varPath = item.key;
        var varValue = JSON.stringify(item.value);

        // 调用 BridgeAPI 写入变量
        if (window.BridgeAPI && typeof BridgeAPI._writeVar === 'function') {
            BridgeAPI._writeVar(varPath, varValue)
                .then(function () {
                    log('持久化成功:', varPath);
                })
                .catch(function (err) {
                    warn('持久化失败:', varPath, err);
                    // 失败重试
                    if (_persistQueue.length < 50) {
                        _persistQueue.unshift(item);
                    }
                });
        }

        _persistInProgress = false;

        // 继续处理队列
        if (_persistQueue.length > 0) {
            setTimeout(processPersistQueue, 100);
        }
    }

    // ============================================================
    // 第四部分：核心 API
    // ============================================================
    var PhoneDataStore = {
        /**
         * 同步读取（从内存，永远是最新值）
         * @param {string} key - 数据键
         * @returns {*} 数据值
         */
        get: function (key) {
            return _cache[key];
        },

        /**
         * 同步写入（更新内存 + 广播 + 异步持久化）
         * @param {string} key - 数据键
         * @param {*} value - 数据值
         * @param {Object} options - 选项 { persist: true, broadcast: true }
         */
        set: function (key, value, options) {
            options = options || {};
            var oldValue = _cache[key];
            
            // 更新内存
            _cache[key] = deepClone(value);

            // 记录历史
            _history.push({
                key: key,
                oldValue: oldValue,
                newValue: deepClone(value),
                timestamp: Date.now(),
                action: oldValue === undefined ? 'create' : 'update'
            });
            if (_history.length > _maxHistory) {
                _history.shift();
            }

            // 广播变更
            if (options.broadcast !== false) {
                this._emit(key, value, oldValue);
            }

            // 异步持久化
            if (options.persist !== false) {
                var varPath = 'xb.phone.' + key;
                _persistQueue.push({ key: varPath, value: value });
                setTimeout(processPersistQueue, 0);
            }

            log('set:', key, oldValue === undefined ? '(new)' : '(updated)');
        },

        /**
         * 批量更新
         * @param {Array} items - [{key, value}, ...]
         */
        batch: function (items) {
            var self = this;
            items.forEach(function (item) {
                self.set(item.key, item.value, { broadcast: false });
            });
            // 统一广播
            items.forEach(function (item) {
                self._emit(item.key, _cache[item.key], undefined);
            });
            // 统一持久化
            items.forEach(function (item) {
                var varPath = 'xb.phone.' + item.key;
                _persistQueue.push({ key: varPath, value: item.value });
            });
            setTimeout(processPersistQueue, 0);
        },

        /**
         * 删除数据
         * @param {string} key - 数据键
         */
        delete: function (key) {
            var oldValue = _cache[key];
            delete _cache[key];

            _history.push({
                key: key,
                oldValue: oldValue,
                newValue: undefined,
                timestamp: Date.now(),
                action: 'delete'
            });

            this._emit(key, undefined, oldValue);
        },

        /**
         * 订阅变更（立即触发一次 + 变更时再触发）
         * @param {string} key - 数据键（支持通配符 *）
         * @param {Function} callback - 回调函数 (newValue, oldValue, meta)
         * @returns {Function} 取消订阅函数
         */
        subscribe: function (key, callback) {
            if (typeof callback !== 'function') {
                return function () {};
            }

            var id = generateId();
            if (!_subscribers[key]) {
                _subscribers[key] = [];
            }
            _subscribers[key].push({ id: id, callback: callback });

            // 立即触发一次（如果内存中有数据）
            if (_cache[key] !== undefined) {
                setTimeout(function () {
                    try {
                        callback(_cache[key], undefined, { immediate: true });
                    } catch (e) {
                        warn('订阅回调执行失败:', key, e);
                    }
                }, 0);
            }

            // 返回取消订阅函数
            var self = this;
            return function () {
                self._unsubscribe(key, id);
            };
        },

        /**
         * 订阅所有变更（通配符）
         * @param {Function} callback - 回调函数
         * @returns {Function} 取消订阅函数
         */
        subscribeAll: function (callback) {
            return this.subscribe('*', callback);
        },

        /**
         * 取消订阅
         */
        _unsubscribe: function (key, id) {
            var list = _subscribers[key];
            if (!list) return;
            for (var i = list.length - 1; i >= 0; i--) {
                if (list[i].id === id) {
                    list.splice(i, 1);
                    break;
                }
            }
        },

        /**
         * 广播变更
         */
        _emit: function (key, newValue, oldValue) {
            var meta = {
                timestamp: Date.now(),
                source: 'PhoneDataStore'
            };

            // 精确匹配
            this._notifySubscribers(key, newValue, oldValue, meta);

            // 通配符匹配
            var dotIdx = key.indexOf('.');
            if (dotIdx > 0) {
                var prefix = key.substring(0, dotIdx + 1) + '*';
                this._notifySubscribers(prefix, newValue, oldValue, meta);
            }

            // 全局监听
            this._notifySubscribers('*', { key: key, value: newValue }, oldValue, meta);
        },

        /**
         * 通知订阅者
         */
        _notifySubscribers: function (pattern, newValue, oldValue, meta) {
            var list = _subscribers[pattern];
            if (!list || list.length === 0) return;

            list.forEach(function (item) {
                try {
                    item.callback(newValue, oldValue, meta);
                } catch (e) {
                    warn('通知订阅者失败:', pattern, e);
                }
            });
        },

        // ============================================================
        // 第五部分：模块就绪检测
        // ============================================================

        /**
         * 模块就绪注册
         * @param {string} moduleName - 模块名
         */
        moduleReady: function (moduleName) {
            _moduleReady[moduleName] = true;
            log('模块就绪:', moduleName);

            // 触发该模块的待处理事件
            var pending = _pendingEvents[moduleName];
            if (pending && pending.length > 0) {
                log('处理待处理事件:', moduleName, pending.length, '个');
                pending.forEach(function (event) {
                    this._emit(event.key, event.value, undefined);
                }.bind(this));
                _pendingEvents[moduleName] = [];
            }
        },

        /**
         * 检查模块是否就绪
         * @param {string} moduleName - 模块名
         * @returns {boolean}
         */
        isModuleReady: function (moduleName) {
            return !!_moduleReady[moduleName];
        },

        /**
         * 获取所有模块状态
         */
        getModuleStatus: function () {
            return Object.assign({}, _moduleReady);
        },

        /**
         * 等待模块就绪
         * @param {string} moduleName - 模块名
         * @param {number} timeout - 超时时间(ms)
         * @returns {Promise}
         */
        waitForModule: function (moduleName, timeout) {
            var self = this;
            return new Promise(function (resolve, reject) {
                if (_moduleReady[moduleName]) {
                    resolve();
                    return;
                }

                var timer;
                var unsubscribe = self.subscribe('module:ready:' + moduleName, function () {
                    clearTimeout(timer);
                    unsubscribe();
                    resolve();
                });

                timer = setTimeout(function () {
                    unsubscribe();
                    reject(new Error('模块就绪超时: ' + moduleName));
                }, timeout || 10000);
            });
        },

        // ============================================================
        // 第六部分：数据初始化
        // ============================================================

        /**
         * 从变量加载数据到内存
         * @param {string} key - 数据键
         * @param {string} varPath - 变量路径
         * @returns {Promise}
         */
        loadFromVar: function (key, varPath) {
            var self = this;
            return new Promise(function (resolve, reject) {
                if (!window.BridgeAPI || typeof BridgeAPI._readVar !== 'function') {
                    resolve(null);
                    return;
                }

                BridgeAPI._readVar(varPath)
                    .then(function (value) {
                        if (value !== null && value !== '') {
                            try {
                                var parsed = typeof value === 'string' ? JSON.parse(value) : value;
                                self.set(key, parsed, { persist: false });
                                log('从变量加载:', key);
                                resolve(parsed);
                            } catch (e) {
                                warn('解析变量失败:', varPath, e);
                                resolve(null);
                            }
                        } else {
                            resolve(null);
                        }
                    })
                    .catch(function (err) {
                        warn('加载变量失败:', varPath, err);
                        resolve(null);
                    });
            });
        },

        /**
         * 批量加载
         * @param {Array} items - [{key, varPath}, ...]
         * @returns {Promise}
         */
        loadAllFromVar: function (items) {
            var self = this;
            var promises = items.map(function (item) {
                return self.loadFromVar(item.key, item.varPath);
            });
            return Promise.all(promises);
        },

        // ============================================================
        // 第七部分：调试 API
        // ============================================================

        /**
         * 获取变更历史
         * @param {string} key - 数据键（可选）
         * @param {number} limit - 限制数量
         * @returns {Array}
         */
        getHistory: function (key, limit) {
            var history = _history;
            if (key) {
                history = history.filter(function (h) { return h.key === key; });
            }
            return history.slice(-(limit || 20));
        },

        /**
         * 导出所有数据
         */
        exportAll: function () {
            return deepClone(_cache);
        },

        /**
         * 导入数据
         * @param {Object} data - 数据对象
         */
        importAll: function (data) {
            var self = this;
            Object.keys(data).forEach(function (key) {
                self.set(key, data[key], { persist: false });
            });
        },

        /**
         * 清空所有数据
         */
        clear: function () {
            _cache = {};
            _history = [];
            _persistQueue = [];
            log('已清空所有数据');
        },

        /**
         * 调试信息
         */
        debug: function () {
            console.log('=== PhoneDataStore 调试信息 ===');
            console.log('内存缓存:', _cache);
            console.log('订阅者:', Object.keys(_subscribers));
            console.log('模块就绪:', _moduleReady);
            console.log('待处理事件:', _pendingEvents);
            console.log('持久化队列:', _persistQueue.length, '项');
            console.log('历史记录:', _history.length, '项');
        }
    };

    // ============================================================
    // 第八部分：全局挂载
    // ============================================================
    if (!window.PhoneDataStore) {
        window.PhoneDataStore = PhoneDataStore;
        console.log('=== [PhoneDataStore] 模块已加载 ===');
        console.log('[PhoneDataStore] 版本: 1.0.0');
        console.log('[PhoneDataStore] API: get(), set(), subscribe(), moduleReady()');
    } else {
        console.warn('[PhoneDataStore] 已存在，跳过重复加载');
    }

})();
