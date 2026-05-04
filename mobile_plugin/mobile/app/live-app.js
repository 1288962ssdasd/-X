// ============================================================
// live-app.js -- 直播应用（变量驱动版）
// 替代原版 live-app.js，支持 CDN 图片/视频背景
// 数据来源：xb.live.* 变量（由 PhoneEngine Director 写入）
// ============================================================

(function () {
  'use strict';

  // CDN 资源配置（可替换为实际资源）
  var DEFAULT_BG_IMAGE = 'https://cdn.jsdelivr.net/gh/1288962ssdasd/images@main/图层 2.png';
  var DEFAULT_LIVE_VIDEO = ''; // 留空则使用图片背景
  var CDN_BASE = 'https://cdn.jsdelivr.net/gh/1288962ssdasd/images@main';

  var liveApp = {
    isInitialized: false,
    isLiveActive: false,
    viewerCount: 0,
    chatMessages: [],
    gifts: [],
    recommendInteractions: [],

    init: function () {
      if (this.isInitialized) return;
      this.isInitialized = true;
      console.log('[LiveApp] 直播应用初始化完成');
    },

    // 从变量读取直播数据
    loadFromVariables: function () {
      var self = this;
      return Promise.all([
        this._readVar('xb.live.streamer'),
        this._readVar('xb.live.title'),
        this._readVar('xb.live.viewerCount'),
        this._readVar('xb.live.bgImage'),
        this._readVar('xb.live.bgVideo'),
        this._readVar('xb.live.messages'),
        this._readVar('xb.live.gifts'),
        this._readVar('xb.live.recommendInteractions')
      ]).then(function (results) {
        self.streamer = results[0] || '未知主播';
        self.title = results[1] || '直播间';
        self.viewerCount = parseInt(results[2]) || 0;
        self.bgImage = results[3] || DEFAULT_BG_IMAGE;
        self.bgVideo = results[4] || DEFAULT_LIVE_VIDEO;
        try { self.chatMessages = results[5] ? JSON.parse(results[5]) : []; } catch (e) { self.chatMessages = []; }
        try { self.gifts = results[6] ? JSON.parse(results[6]) : []; } catch (e) { self.gifts = []; }
        try { self.recommendInteractions = results[7] ? JSON.parse(results[7]) : []; } catch (e) { self.recommendInteractions = []; }
        self.isLiveActive = true;
        console.log('[LiveApp] 从变量加载数据完成:', self.streamer, self.title, '观众:', self.viewerCount);
      });
    },

    _readVar: function (key) {
      if (window.BridgeAPI && window.BridgeAPI.getVar) {
        return window.BridgeAPI.getVar(key);
      }
      if (window.STscript) {
        return window.STscript('/getvar key=' + key + ' quiet=true')
          .then(function (v) { return (v && v.trim && v.trim() !== '' && v !== 'null' && v !== 'undefined') ? v.trim() : null; })
          .catch(function () { return null; });
      }
      return Promise.resolve(null);
    },

    // 生成直播界面 HTML
    getContent: function () {
      var bgStyle = '';
      if (this.bgVideo) {
        bgStyle = '<video class="live-bg-video" src="' + this.bgVideo + '" autoplay loop muted playsinline style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;"></video>';
      } else if (this.bgImage) {
        bgStyle = '<div class="live-bg-image" style="position:absolute;top:0;left:0;width:100%;height:100%;background:url(\'' + this.bgImage + '\') center/cover no-repeat;z-index:0;filter:brightness(0.6);"></div>';
      }

      var chatHtml = '';
      for (var i = 0; i < Math.min(this.chatMessages.length, 20); i++) {
        var msg = this.chatMessages[i];
        var type = msg.type || '弹幕';
        var user = msg.user || '匿名';
        var content = msg.content || '';
        var isGift = type === '礼物';
        var isSystem = type === '系统';
        var cls = isGift ? 'live-chat-gift' : (isSystem ? 'live-chat-system' : 'live-chat-danmaku');
        var icon = isGift ? '🧧' : (isSystem ? '📢' : '');
        chatHtml += '<div class="' + cls + '">' +
          (icon ? '<span class="live-chat-icon">' + icon + '</span>' : '') +
          '<span class="live-chat-user">' + user + '</span>' +
          '<span class="live-chat-content">' + content + '</span>' +
          '</div>';
      }

      var recommendHtml = '';
      for (var r = 0; r < Math.min(this.recommendInteractions.length, 4); r++) {
        var rec = this.recommendInteractions[r];
        recommendHtml += '<button class="live-recommend-btn" data-idx="' + r + '">' +
          '<span class="live-recommend-icon">💬</span>' +
          '<span class="live-recommend-text">' + (rec.text || rec || '互动') + '</span>' +
          '</button>';
      }

      return '<div class="live-container" style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;">' +
        // 背景层
        bgStyle +
        // 顶部信息栏
        '<div class="live-header" style="position:relative;z-index:1;display:flex;align-items:center;padding:8px 12px;background:linear-gradient(180deg,rgba(0,0,0,0.6),transparent);">' +
        '<div class="live-streamer-info" style="display:flex;align-items:center;gap:8px;flex:1;">' +
        '<div class="live-avatar" style="width:36px;height:36px;border-radius:50%;border:2px solid #ff4757;overflow:hidden;background:#333;">' +
        (this.bgImage ? '<img src="' + this.bgImage + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\'">' : '') +
        '</div>' +
        '<div class="live-meta" style="flex:1;">' +
        '<div class="live-streamer-name" style="color:#fff;font-size:13px;font-weight:600;">' + this.streamer + '</div>' +
        '<div class="live-title" style="color:rgba(255,255,255,0.7);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this.title + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="live-viewer-badge" style="background:rgba(255,71,87,0.9);color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;display:flex;align-items:center;gap:4px;">' +
        '<span>👁</span><span>' + this._formatCount(this.viewerCount) + '</span>' +
        '</div>' +
        '</div>' +
        // 聊天区域
        '<div class="live-chat-area" style="position:relative;z-index:1;flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;mask-image:linear-gradient(transparent,#000 20%,#000 80%,transparent);">' +
        chatHtml +
        '</div>' +
        // 推荐互动区域
        (recommendHtml ? '<div class="live-recommend-area" style="position:relative;z-index:1;padding:6px 8px;display:flex;flex-wrap:wrap;gap:6px;background:rgba(0,0,0,0.3);">' + recommendHtml + '</div>' : '') +
        // 底部输入栏
        '<div class="live-input-bar" style="position:relative;z-index:1;padding:8px 12px;background:rgba(0,0,0,0.5);display:flex;align-items:center;gap:8px;">' +
        '<input type="text" class="live-input" placeholder="说点什么..." style="flex:1;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);border-radius:20px;padding:6px 14px;color:#fff;font-size:13px;outline:none;">' +
        '<button class="live-send-btn" style="background:#ff4757;color:#fff;border:none;border-radius:50%;width:32px;height:32px;font-size:16px;cursor:pointer;">➤</button>' +
        '</div>' +
        '</div>';
    },

    // 绑定事件
    bindEvents: function () {
      var self = this;
      // 推荐互动按钮点击
      var recBtns = document.querySelectorAll('.live-recommend-btn');
      for (var i = 0; i < recBtns.length; i++) {
        (function (btn, idx) {
          btn.addEventListener('click', function () {
            var text = btn.querySelector('.live-recommend-text').textContent;
            var input = document.querySelector('.live-input');
            if (input) {
              input.value = text;
              input.focus();
            }
            console.log('[LiveApp] 推荐互动:', text);
          });
        })(recBtns[i], i);
      }
      // 发送按钮
      var sendBtn = document.querySelector('.live-send-btn');
      if (sendBtn) {
        sendBtn.addEventListener('click', function () {
          var input = document.querySelector('.live-input');
          if (input && input.value.trim()) {
            console.log('[LiveApp] 发送弹幕:', input.value.trim());
            input.value = '';
          }
        });
      }
    },

    _formatCount: function (count) {
      if (count >= 10000) return (count / 10000).toFixed(1) + '万';
      if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
      return String(count);
    }
  };

  // 暴露全局接口（mobile-phone.js 期望的接口）
  window.LiveApp = liveApp;
  window.getLiveAppContent = function () {
    return liveApp.getContent();
  };
  window.bindLiveAppEvents = function () {
    liveApp.bindEvents();
  };
  window.liveAppShowModal = function (type) {
    console.log('[LiveApp] showModal:', type);
  };
  window.liveAppEndLive = function () {
    liveApp.isLiveActive = false;
    console.log('[LiveApp] 直播已结束');
    if (window.mobilePhone) {
      window.mobilePhone.navigateBack();
    }
  };

  // 初始化：从变量加载数据
  liveApp.loadFromVariables().then(function () {
    liveApp.init();
    console.log('[LiveApp] 就绪');
  }).catch(function (e) {
    console.warn('[LiveApp] 变量加载失败，使用默认值:', e);
    liveApp.init();
  });

  console.log('[LiveApp] 模块已加载');
})();
