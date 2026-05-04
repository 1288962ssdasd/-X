// pending-msg-event-patch.js
// 事件驱动的 pendingMsg/pendingNotify 即时消费补丁
// 解决原定时器消费延迟2-3分钟的问题
(function () {
  'use strict';

  var Patch = {
    _pollTimer: null,
    _lastValues: {},
    POLL_INTERVAL: 2000,  // 2秒轮询（比原来的2分钟快60倍）
    _retryQueue: [],      // 重试队列（messageRenderer未就绪时暂存）
    _maxRetries: 15,      // 最大重试次数（30秒内）

    init: function () {
      var self = this;
      console.log('[PendingMsgPatch] 初始化事件驱动消费');

      // 监听小白X事件（如果可用）
      if (window.xbEventCenter) {
        try {
          window.xbEventCenter.on('variableChanged', function (data) {
            if (data && data.key && (data.key.indexOf('pendingMsg') !== -1 || data.key.indexOf('pendingNotify') !== -1 || data.key.indexOf('pendingFriend') !== -1)) {
              self._processVariable(data.key);
            }
          });
          console.log('[PendingMsgPatch] 已注册 xbEventCenter 监听');
        } catch (e) {
          console.warn('[PendingMsgPatch] xbEventCenter 监听失败:', e);
        }
      }

      // 同时启动轻量轮询作为兜底（2秒间隔）
      self._startPolling();

      // 监听 ST 事件
      self._listenSTEvents();
    },

    _startPolling: function () {
      var self = this;
      if (self._pollTimer) return;

      self._pollTimer = setInterval(function () {
        self._pollPendingVars();
      }, self.POLL_INTERVAL);

      console.log('[PendingMsgPatch] 轮询已启动，间隔 ' + self.POLL_INTERVAL + 'ms');
    },

    _pollPendingVars: function () {
      var self = this;
      if (!window.BridgeAPI) return;

      // 互斥锁：防止 PendingMsgPatch 和 RoleAPI._tryAutoMessage 同时消费导致双重消费
      if (self._isProcessing) return;
      self._isProcessing = true;

      // 并行检查三个变量
      var checks = [
        { key: 'xb.phone.pendingMsg', handler: 'processPendingMessages' },
        { key: 'xb.phone.pendingNotify', handler: 'processPendingNotify' },
        { key: 'xb.phone.pendingFriend', handler: 'processPendingFriend' }
      ];

      var allChecks = [];
      for (var i = 0; i < checks.length; i++) {
        (function (check) {
          var p = window.BridgeAPI.ConfigManager.get(check.key).then(function (val) {
            if (val && val !== '' && val !== self._lastValues[check.key]) {
              self._lastValues[check.key] = val;
              if (check.handler === 'processPendingMessages' &&
                  window.RoleAPI && window.RoleAPI.isGenerating) {
                // [MC-Fix-2] AI生成中跳过消费，但不更新 _lastValues，允许后续重试
                delete self._lastValues[check.key];
                return;
              }
              if (window.BridgeAPI[check.handler]) {
                window.BridgeAPI[check.handler]().then(function () {
                  // [MC-Fix-6] 消费成功后清除 _lastValues，允许相同内容的新消息被处理
                  delete self._lastValues[check.key];
                }).catch(function () {});
              }
            }
          }).catch(function () {});
          allChecks.push(p);
        })(checks[i]);
      }

      Promise.all(allChecks).finally(function () {
        self._isProcessing = false;
      });
    },

    _listenSTEvents: function () {
      var self = this;
      try {
        var stContext = window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext();
        if (stContext && stContext.eventSource) {
          stContext.eventSource.on('GENERATE_AFTER', function () {
            // AI回复完成后，延迟500ms检查pending变量
            setTimeout(function () {
              self._pollPendingVars();
            }, 500);
          });
        }
      } catch (e) {}
    },

    _processVariable: function (key) {
      var self = this;
      var handlerMap = {
        'xb.phone.pendingMsg': 'processPendingMessages',
        'xb.phone.pendingNotify': 'processPendingNotify',
        'xb.phone.pendingFriend': 'processPendingFriend'
      };
      var handler = handlerMap[key];
      if (handler && window.BridgeAPI && window.BridgeAPI[handler]) {
        // 延迟100ms确保变量已写入完成
        setTimeout(function () {
          window.BridgeAPI[handler]();
        }, 100);
      }
    },

    destroy: function () {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }
  };

  window.PendingMsgPatch = Patch;
})();
