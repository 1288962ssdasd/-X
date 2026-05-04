// ============================================================
// quick-reply-bridge.js v3.0 -- 四选项渲染模块（变量驱动 + AI标签双模式）
// 从 independent-ai.js v3.0 提取，适配 PhoneEngine V3 架构
// 依赖：bridge-api.js（BridgeAPI.ConfigManager）
// 运行环境：SillyTavern 外置手机3.0插件
// v3.0: 分层卡片UI + 自动初始化 + 变量驱动增强
// ============================================================

var QuickReplyBridge = {
    OPTION_TYPES: {
        '真情': { cls: 'qr-zhenqing', icon: '\u2665', desc: '真心话' },
        '套路': { cls: 'qr-taolu', icon: '\u2666', desc: '小心机' },
        '试探': { cls: 'qr-shitan', icon: '\u2660', desc: '探口风' },
        '行动': { cls: 'qr-xingdong', icon: '\u2663', desc: '直接做' }
    },

    _observer: null,
    _processedRequests: {},
    _lastVarHash: '',
    _varTimer: null,
    _inited: false,

    // ===== 自动初始化 =====
    // phone-loader.js 加载此脚本后，自动启动（无需外部调用 init）
    _autoInit: function () {
        if (this._inited) return;
        var self = this;
        // 等待 DOM 和 BridgeAPI 就绪
        function tryInit() {
            if (self._inited) return;
            var chatArea = document.getElementById('chat');
            var hasBridge = window.BridgeAPI || window.SillyTavern;
            // 至少有 chat 区域就启动（BridgeAPI 可以后续绑定）
            if (chatArea || hasBridge) {
                self.init();
            } else {
                setTimeout(tryInit, 800);
            }
        }
        // 延迟 600ms 启动，确保 phone-loader 已完成依赖加载
        setTimeout(tryInit, 600);
    },

    init: function () {
        if (this._inited) return;
        this._inited = true;

        this._injectCSS();
        this._initEventDriven();
        this._processExistingMessages();
        this._startFriendRequestScanner();
        this._startVarDrivenMode();

        // 永久 MutationObserver
        // [MR-Fix-2] 统一监控 document.body，确保手机消息（#app-content 内）的 DOM 变化也能被捕获
        var self = this;
        var chatArea = document.body;
        var qrObserver = new MutationObserver(function (mutations) {
            if (qrObserver._timer) return;
            qrObserver._timer = setTimeout(function () {
                qrObserver._timer = null;
                var allMsgs = document.querySelectorAll('.mes_text');
                for (var i = 0; i < allMsgs.length; i++) {
                    var el = allMsgs[i];
                    var text = el.textContent || '';
                    var hasOptions = text.includes('真情') || text.includes('套路') ||
                        text.includes('试探') || text.includes('行动');
                    var hasButtons = el.querySelector('.quick-reply-container');
                    if (hasOptions && !hasButtons) {
                        delete el.dataset.qrDone;
                        self.processMessage(el);
                    }
                }
            }, 150);
        });
        qrObserver.observe(chatArea, { childList: true, subtree: true, characterData: true });
        console.log('[QuickReplyBridge] v3.0 初始化完成（自动启动）');
    },

    // ===== 分层卡片 CSS =====
    _injectCSS: function () {
        if (document.getElementById('quick-reply-bridge-v3')) return;
        var css = document.createElement('style');
        css.id = 'quick-reply-bridge-v3';
        css.textContent =
            // === 主容器：毛玻璃卡片 ===
            '.quick-reply-container{' +
            '  display:flex;flex-direction:column;gap:0;' +
            '  margin:10px 4px;padding:0;' +
            '  background:rgba(20,20,35,0.85);' +
            '  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
            '  border-radius:16px;' +
            '  border:1px solid rgba(255,255,255,0.06);' +
            '  box-shadow:0 4px 24px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.03) inset;' +
            '  overflow:hidden;' +
            '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
            '}' +

            // === 标题栏 ===
            '.quick-reply-container .qr-header{' +
            '  display:flex;align-items:center;justify-content:space-between;' +
            '  padding:10px 14px 8px 14px;' +
            '  border-bottom:1px solid rgba(255,255,255,0.05);' +
            '}' +
            '.quick-reply-container .qr-header .qr-title{' +
            '  display:flex;align-items:center;gap:6px;' +
            '  font-size:11px;font-weight:600;color:rgba(255,255,255,0.35);' +
            '  letter-spacing:1px;text-transform:uppercase;' +
            '}' +
            '.quick-reply-container .qr-header .qr-title::before{' +
            '  content:"";display:inline-block;width:3px;height:12px;' +
            '  background:linear-gradient(180deg,#ff6b6b,#4ecdc4);border-radius:2px;' +
            '}' +
            '.quick-reply-container .qr-header .qr-mode{' +
            '  font-size:9px;color:rgba(255,255,255,0.2);' +
            '  padding:2px 6px;border-radius:4px;' +
            '  background:rgba(255,255,255,0.04);' +
            '}' +

            // === 按钮网格：2列，大间距 ===
            '.quick-reply-container .qr-grid{' +
            '  display:grid;grid-template-columns:1fr 1fr;gap:6px;' +
            '  padding:8px 8px 10px 8px;' +
            '}' +

            // === 单个按钮：大卡片，易点击 ===
            '.quick-reply-btn{' +
            '  display:flex;flex-direction:column;align-items:flex-start;' +
            '  padding:12px 14px;border-radius:12px;' +
            '  cursor:pointer;transition:all .18s ease;' +
            '  border:1px solid transparent;' +
            '  user-select:none;-webkit-user-select:none;' +
            '  -webkit-tap-highlight-color:transparent;' +
            '  box-sizing:border-box;' +
            '  min-height:56px; /* 大点击区域 */' +
            '  position:relative;overflow:hidden;' +
            '  gap:4px;' +
            '}' +

            // 按钮内部涟漪效果层
            '.quick-reply-btn::after{' +
            '  content:"";position:absolute;inset:0;' +
            '  background:radial-gradient(circle at var(--x,50%) var(--y,50%),rgba(255,255,255,0.12) 0%,transparent 60%);' +
            '  opacity:0;transition:opacity .3s;pointer-events:none;' +
            '}' +
            '.quick-reply-btn:active::after{opacity:1}' +

            // 悬停/按下
            '.quick-reply-btn:hover{' +
            '  transform:translateY(-1px);' +
            '  box-shadow:0 6px 20px rgba(0,0,0,0.3);' +
            '}' +
            '.quick-reply-btn:active{' +
            '  transform:scale(0.97);' +
            '  opacity:0.9;' +
            '}' +

            // 选中状态：明显的高亮边框
            '.quick-reply-btn.qr-selected{' +
            '  border-color:rgba(255,255,255,0.6) !important;' +
            '  box-shadow:0 0 0 2px rgba(255,255,255,0.25),0 4px 16px rgba(0,0,0,0.3) !important;' +
            '  transform:scale(1.02) !important;' +
            '}' +
            '.quick-reply-btn.qr-selected::before{' +
            '  content:"\\2713";position:absolute;top:6px;right:8px;' +
            '  font-size:12px;color:rgba(255,255,255,0.7);font-weight:700;' +
            '}' +

            // === 类型标签行（图标 + 类型名 + 描述） ===
            '.quick-reply-btn .qr-label{' +
            '  display:flex;align-items:center;gap:5px;' +
            '  font-size:10px;font-weight:700;letter-spacing:0.8px;' +
            '  opacity:0.5;text-transform:uppercase;' +
            '}' +
            '.quick-reply-btn .qr-label .qr-icon{' +
            '  font-size:13px;' +
            '}' +

            // === 内容文本 ===
            '.quick-reply-btn .qr-content{' +
            '  font-size:13px;font-weight:400;line-height:1.45;' +
            '  opacity:0.92;word-break:break-word;' +
            '  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;' +
            '}' +

            // === 四种类型配色（深色半透明，高对比度文字） ===

            // 真情 - 红色系
            '.quick-reply-btn.qr-zhenqing{' +
            '  background:linear-gradient(135deg,rgba(231,76,60,0.12),rgba(192,57,43,0.08));' +
            '  color:#ff9a8b;' +
            '  border-color:rgba(231,76,60,0.15);' +
            '}' +
            '.quick-reply-btn.qr-zhenqing:hover{border-color:rgba(231,76,60,0.35)}' +
            '.quick-reply-btn.qr-zhenqing .qr-label{color:#e74c3c}' +
            '.quick-reply-btn.qr-zhenqing .qr-icon{color:#ff6b6b}' +

            // 套路 - 蓝色系
            '.quick-reply-btn.qr-taolu{' +
            '  background:linear-gradient(135deg,rgba(52,152,219,0.12),rgba(41,128,185,0.08));' +
            '  color:#90caf9;' +
            '  border-color:rgba(52,152,219,0.15);' +
            '}' +
            '.quick-reply-btn.qr-taolu:hover{border-color:rgba(52,152,219,0.35)}' +
            '.quick-reply-btn.qr-taolu .qr-label{color:#3498db}' +
            '.quick-reply-btn.qr-taolu .qr-icon{color:#64b5f6}' +

            // 试探 - 黄色系
            '.quick-reply-btn.qr-shitan{' +
            '  background:linear-gradient(135deg,rgba(241,196,15,0.12),rgba(243,156,18,0.08));' +
            '  color:#ffe082;' +
            '  border-color:rgba(241,196,15,0.15);' +
            '}' +
            '.quick-reply-btn.qr-shitan:hover{border-color:rgba(241,196,15,0.35)}' +
            '.quick-reply-btn.qr-shitan .qr-label{color:#f1c40f}' +
            '.quick-reply-btn.qr-shitan .qr-icon{color:#ffd54f}' +

            // 行动 - 绿色系
            '.quick-reply-btn.qr-xingdong{' +
            '  background:linear-gradient(135deg,rgba(46,204,113,0.12),rgba(39,174,96,0.08));' +
            '  color:#a5d6a7;' +
            '  border-color:rgba(46,204,113,0.15);' +
            '}' +
            '.quick-reply-btn.qr-xingdong:hover{border-color:rgba(46,204,113,0.35)}' +
            '.quick-reply-btn.qr-xingdong .qr-label{color:#2ecc71}' +
            '.quick-reply-btn.qr-xingdong .qr-icon{color:#69f0ae}' +

            // === 变量驱动标记 ===
            '.quick-reply-container[data-var-driven="true"] .qr-mode::after{' +
            '  content:"VAR";margin-left:4px;' +
            '}' +

            // === 空状态提示 ===
            '.quick-reply-container .qr-empty{' +
            '  padding:16px;text-align:center;' +
            '  font-size:11px;color:rgba(255,255,255,0.2);' +
            '  grid-column:1/-1;' +
            '}';

        document.head.appendChild(css);
    },

    _initEventDriven: function () {
        var self = this;
        var stContext = window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext();

        if (stContext && stContext.eventSource) {
            stContext.eventSource.on('CHARACTER_MESSAGE_RENDERED', function (msgId) {
                var msgEl = document.querySelector('.mes[mesid="' + msgId + '"] .mes_text');
                if (msgEl) self.processMessage(msgEl);
            });
            stContext.eventSource.on('CHAT_CHANGED', function () {
                // [QR-Fix-2] 防重入：防止多个 CHAT_CHANGED 事件叠加执行
                if (self._chatChangeProcessing) return;
                self._chatChangeProcessing = true;

                var doneEls = document.querySelectorAll('.mes_text[data-qr-done]');
                for (var di = 0; di < doneEls.length; di++) {
                    delete doneEls[di].dataset.qrDone;
                }
                // [QR-Fix-2] 从4次减为2次，减少不必要的重复处理
                var delays = [500, 2000];
                var processedCount = 0;
                delays.forEach(function (delay) {
                    setTimeout(function () {
                        self._processExistingMessages();
                        processedCount++;
                        if (processedCount >= delays.length) {
                            self._chatChangeProcessing = false;
                        }
                    }, delay);
                });
            });
            stContext.eventSource.on('GENERATE_AFTER', function () {
                setTimeout(function () {
                    self._processExistingMessages();
                }, 1000);
            });
            console.log('[QuickReplyBridge] 使用ST事件驱动模式');
        } else {
            // [QR-Fix-3] 已删除备用 Observer（原第272-293行）
            // SillyTavern 不可用时，永久 Observer（init 中创建）已足够覆盖所有场景
            // 双 Observer 并存是导致多轮渲染的关键因素之一
            console.log('[QuickReplyBridge] ST事件不可用，仅依赖永久 MutationObserver');
        }
    },

    _processExistingMessages: function () {
        var self = this;
        var msgEls = document.querySelectorAll('.mes_text');
        var chain = Promise.resolve();
        for (var i = 0; i < msgEls.length; i++) {
            (function (el) {
                chain = chain.then(function () { return self.processMessage(el); });
            })(msgEls[i]);
        }
        return chain;
    },

    _extractPlainText: function (msgEl) {
        var html = msgEl.innerHTML || '';
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<li>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&\w+;/g, '')
            .replace(/\*\*/g, '')
            .trim();
    },

    extractOptions: function (msgEl) {
        var text = this._extractPlainText(msgEl);
        var matches = [];

        var bracketRegex = /\[?\s*(真情|套路|试探|行动)\s*\]?\s*([^\n\[\]【】]{2,})/g;
        var m;
        while ((m = bracketRegex.exec(text)) !== null) {
            var content = m[2].trim();
            if (content && content.length > 1 && !content.match(/^(真情|套路|试探|行动)$/)) {
                matches.push({ type: m[1], content: content });
            }
        }

        var emojiMap = {
            '\uD83D\uDC95': '真情', '\u2764\uFE0F': '真情', '\uD83D\uDC97': '真情', '\uD83D\uDC96': '真情',
            '\uD83C\uDFAD': '套路', '\uD83C\uDCCF': '套路',
            '\uD83D\uDD0D': '试探', '\uD83D\uDD0E': '试探', '\uD83D\uDC41\uFE0F': '试探',
            '\u26A1': '行动', '\uD83D\uDD25': '行动', '\uD83D\uDC4A': '行动', '\uD83C\uDFC3': '行动'
        };
        var lines = text.split('\n');
        for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            if (!line) continue;
            var emojiMatch = line.match(/^([\uD83D\uDC95\u2764\uFE0F\uD83D\uDC97\uD83D\uDC96\uD83C\uDFAD\uD83C\uDCCF\uD83D\uDD0D\uD83D\uDD0E\uD83D\uDC41\uFE0F\u26A1\uD83D\uDD25\uD83D\uDC4A\uD83C\uDFC3])\s+(.+)$/);
            if (emojiMatch) {
                var emoji = emojiMatch[1];
                var rest = emojiMatch[2].trim();
                var mappedType = emojiMap[emoji];
                if (mappedType && rest && rest.length > 1) {
                    var isDup = false;
                    for (var di = 0; di < matches.length; di++) {
                        if (matches[di].type === mappedType && matches[di].content === rest) { isDup = true; break; }
                    }
                    if (!isDup) matches.push({ type: mappedType, content: rest });
                }
            }
        }

        var seenTypes = {};
        var unique = [];
        for (var di = 0; di < matches.length; di++) {
            if (!seenTypes[matches[di].type]) {
                seenTypes[matches[di].type] = true;
                unique.push(matches[di]);
            }
        }
        return unique;
    },

    // ===== 构建分层卡片 HTML =====
    _buildCardHTML: function (matches, isVarDriven) {
        var html = '<div class="quick-reply-container"' + (isVarDriven ? ' data-var-driven="true"' : '') + '>';
        // 标题栏
        html += '<div class="qr-header">';
        html += '<span class="qr-title">QUICK REPLY</span>';
        html += '<span class="qr-mode">' + (isVarDriven ? '小白X驱动' : 'AI标签') + '</span>';
        html += '</div>';
        // 按钮网格
        html += '<div class="qr-grid">';
        for (var i = 0; i < matches.length; i++) {
            var opt = matches[i];
            var cfg = this.OPTION_TYPES[opt.type] || { cls: 'qr-xingdong', icon: '\u2663', desc: '行动' };
            html += '<div class="quick-reply-btn ' + cfg.cls + '" data-qr-idx="' + i + '">';
            html += '<span class="qr-label"><span class="qr-icon">' + cfg.icon + '</span> ' + opt.type + '</span>';
            html += '<span class="qr-content">' + opt.content + '</span>';
            html += '</div>';
        }
        html += '</div></div>';
        return html;
    },

    processMessage: function (msgEl) {
        var self = this;

        // [QR-Fix-1] 同步锁：防止异步竞态导致多轮渲染
        if (msgEl._qrProcessing) return Promise.resolve();
        if (msgEl.dataset.qrDone) return Promise.resolve();

        // [QR-Fix-1] 立即设置同步锁和 qrDone，关闭竞态窗口
        msgEl._qrProcessing = true;
        msgEl.dataset.qrDone = '1';

        var configPromise = (function () {
            try {
                var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
                if (ConfigManager) return ConfigManager.get('xb.ui.renderQuickReply');
            } catch (e) { }
            return Promise.resolve('true');
        })();

        return configPromise.then(function (renderEnabled) {
            try {
                if (renderEnabled === 'false') {
                    return; // qrDone 已在入口设置
                }

                var matches = self.extractOptions(msgEl);
                if (matches.length < 1) {
                    // [QR-Fix-1] 无选项时清除 qrDone，允许后续重试（流式渲染场景）
                    delete msgEl.dataset.qrDone;
                    return;
                }

                // qrDone 已在入口设置，此处无需重复设置

            // 隐藏原始选项文本
            // [Bug 2b 修复] 使用 querySelectorAll('*') 遍历所有后代元素，跳过 .quick-reply-container
            var optionTagPattern = /\[(真情|套路|试探|行动)\][：:]?|\【(真情|套路|试探|行动)\】|^(真情|套路|试探|行动)[：:]/;
            var emojiOptionPattern = /^[\uD83D\uDC95\u2764\uFE0F\uD83D\uDC97\uD83D\uDC96\uD83C\uDFAD\uD83C\uDCCF\uD83D\uDD0D\uD83D\uDD0E\uD83D\uDC41\uFE0F\u26A1\uD83D\uDD25\uD83D\uDC4A\uD83C\uDFC3]\s+/m;
            var children = msgEl.querySelectorAll('*');
            for (var ci = 0; ci < children.length; ci++) {
                var child = children[ci];
                // 跳过 quick-reply-container 自身及其子元素
                if (child.closest && child.closest('.quick-reply-container')) continue;
                var childHtml = child.innerHTML || '';
                var childText = child.textContent || '';
                if (optionTagPattern.test(childHtml) || optionTagPattern.test(childText)) {
                    // [修复v2] 隐藏原始选项文本，同时消除占位空间（移动端避免空行）
                    child.style.display = 'none';
                    child.style.height = '0';
                    child.style.margin = '0';
                    child.style.padding = '0';
                    child.style.overflow = 'hidden';
                    child.style.lineHeight = '0';
                    child.style.fontSize = '0';
                }
                if (emojiOptionPattern.test(childText) && childText.length < 100) {
                    child.style.display = 'none';
                    child.style.height = '0';
                    child.style.margin = '0';
                    child.style.padding = '0';
                    child.style.overflow = 'hidden';
                    child.style.lineHeight = '0';
                    child.style.fontSize = '0';
                }
                if (/【请选择】|请选择/.test(childText) && childText.length < 20) {
                    child.style.display = 'none';
                    child.style.height = '0';
                    child.style.margin = '0';
                    child.style.padding = '0';
                    child.style.overflow = 'hidden';
                    child.style.lineHeight = '0';
                    child.style.fontSize = '0';
                }
            }

            // 插入分层卡片
            var btnHtml = self._buildCardHTML(matches, false);
            msgEl.insertAdjacentHTML('beforeend', btnHtml);

            // 绑定事件
            self._bindButtonEvents(msgEl, '.quick-reply-btn', false);

            console.log('[QuickReplyBridge] 已渲染', matches.length, '个快捷回复按钮（AI标签模式）');

            // [QR-Fix-5] 已删除 CDN innerHTML 替换代码块
            // 原代码在按钮插入后执行 msgEl.innerHTML = html，会销毁所有事件绑定
            // CDN 图片转换应由 SillyTavern 核心处理，此处不再干预
            } catch (err) {
                console.error('[QuickReplyBridge] processMessage 异常:', err);
                delete msgEl.dataset.qrDone; // 异常时允许重试
            } finally {
                // [QR-Fix-1] 释放同步锁
                msgEl._qrProcessing = false;
            }
        });
    },

    // ===== 统一按钮事件绑定 =====
    _bindButtonEvents: function (container, selector, isVarDriven) {
        var btns = container.querySelectorAll(selector);
        var prefix = isVarDriven ? '[QuickReplyBridge/变量驱动]' : '[QuickReplyBridge]';

        for (var bi = 0; bi < btns.length; bi++) {
            (function (btn) {
                function handleSelect(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    // [修复v2] 防重复：pointerdown + click 可能双触发
                    if (btn._qrHandled) return;
                    btn._qrHandled = true;
                    setTimeout(function () { btn._qrHandled = false; }, 500);

                    // 取消其他选中
                    var allBtns = container.querySelectorAll('.quick-reply-btn.qr-selected');
                    for (var si = 0; si < allBtns.length; si++) {
                        allBtns[si].classList.remove('qr-selected');
                    }
                    btn.classList.add('qr-selected');

                    var contentEl = btn.querySelector('.qr-content');
                    var text = contentEl ? contentEl.textContent : '';
                    if (!text) return;

                    var chatInput = document.getElementById('send_textarea');
                    if (chatInput) {
                        chatInput.value = text;
                        chatInput.focus();
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                        chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        console.log(prefix, '选项已填入输入框:', text);
                    }
                }

                // pointerdown 统一事件（避免 click/touchend 双触发）
                btn.addEventListener('pointerdown', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    setTimeout(function () { handleSelect(e); }, 30);
                }, false);

                // [修复v2] 触摸设备兼容：同时监听 click 事件（pointerdown 在某些移动端 WebView 中可能不触发）
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelect(e);
                }, false);
            })(btns[bi]);
        }
    },

    scanForFriendRequests: function () {
        var self = this;
        var msgEls = document.querySelectorAll('.mes_text');
        var friendRequestRegex = /\[角色[|｜]([^|｜]+)[|｜]([^|｜]+)[|｜]请求添加你为好友\]/;
        var chain = Promise.resolve();
        for (var i = 0; i < msgEls.length; i++) {
            (function (msgEl) {
                chain = chain.then(function () {
                    var text = msgEl.textContent || '';
                    var match1 = text.match(friendRequestRegex);
                    if (match1 && !self._processedRequests[match1[0]]) {
                        self._processedRequests[match1[0]] = true;
                        var name = match1[1].trim();
                        var number = match1[2].trim();
                        console.log('[QuickReplyBridge] 检测到好友请求:', name, number);
                        if (window.BridgeAPI) {
                            return window.BridgeAPI.ConfigManager.set('xb.phone.pendingFriend', name + '|' + number);
                        }
                    }
                    var friendIdRegex = /\[好友id[|｜]([^|｜]+)[|｜]([^\]]+)\]/g;
                    var match2;
                    var innerChain = Promise.resolve();
                    while ((match2 = friendIdRegex.exec(text)) !== null) {
                        (function (fullMatch, name2, id2) {
                            innerChain = innerChain.then(function () {
                                if (!self._processedRequests[fullMatch]) {
                                    self._processedRequests[fullMatch] = true;
                                    if (window.BridgeAPI) {
                                        return window.BridgeAPI.ConfigManager.set('xb.phone.pendingFriend', name2 + '|' + id2);
                                    }
                                }
                            });
                        })(match2[0], match2[1].trim(), match2[2].trim());
                    }
                    return innerChain;
                });
            })(msgEls[i]);
        }
        return chain;
    },

    _startFriendRequestScanner: function () {
        var self = this;
        var scanCount = 0;
        var maxScans = 60;
        this._friendScannerTimer = setInterval(function () {
            scanCount++;
            if (scanCount > maxScans) {
                clearInterval(self._friendScannerTimer);
                return;
            }
            self.scanForFriendRequests();
        }, 5000);
    },

    // ===== 变量驱动模式 =====
    // 小白X写入 xb.choice.1~4 或 xb.choice.json → 自动渲染按钮
    // xb.choice.active = "false" 可关闭变量驱动
    // xb.choice.title 可自定义标题（默认"QUICK REPLY"）

    _varNullCache: {},      // 缓存空值变量，避免重复请求 { key: timestamp }
    _VAR_NULL_COOLDOWN: 30000, // 空值变量30秒才重试

    _startVarDrivenMode: function () {
        var self = this;
        console.log('[QuickReplyBridge] 变量驱动模式已启动，监听 xb.choice.* 变量');

        this._varTimer = setInterval(function () {
            self._checkVarDrivenOptions();
        }, 3000); // 从2秒改为3秒，降低请求频率

        setTimeout(function () {
            self._checkVarDrivenOptions();
        }, 1500);
    },

    _readVar: function (key) {
        // 如果该变量之前为空，且在冷却期内，直接跳过
        var now = Date.now();
        if (this._varNullCache[key] && (now - this._varNullCache[key]) < this._VAR_NULL_COOLDOWN) {
            return Promise.resolve(null);
        }

        var self = this;

        // [修复v2] 优先使用 ConfigManager.get（通过 BridgeAPI，不走 STscript）
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
        if (ConfigManager && ConfigManager.get) {
            return ConfigManager.get(key)
                .then(function (v) {
                    if (!v || (v.trim && (v.trim() === '' || v === 'null' || v === 'undefined'))) {
                        self._varNullCache[key] = Date.now();
                        return null;
                    }
                    delete self._varNullCache[key];
                    return v.trim();
                })
                .catch(function () {
                    self._varNullCache[key] = Date.now();
                    return null;
                });
        }

        // ConfigManager 不可用时走 BridgeAPI.getVar（可能触发 HTTP 超时）
        if (window.BridgeAPI && window.BridgeAPI.getVar) {
            return window.BridgeAPI.getVar(key).then(function (v) {
                if (!v || v === 'null' || v === 'undefined' || (v.trim && v.trim() === '')) {
                    self._varNullCache[key] = Date.now();
                    return null;
                }
                delete self._varNullCache[key];
                return v.trim ? v.trim() : v;
            }).catch(function () {
                self._varNullCache[key] = Date.now();
                return null;
            });
        }

        return Promise.resolve(null);
    },

    _checkVarDrivenOptions: function () {
        var self = this;
        Promise.all([
            this._readVar('xb.choice.json'),
            this._readVar('xb.choice.1'),
            this._readVar('xb.choice.2'),
            this._readVar('xb.choice.3'),
            this._readVar('xb.choice.4'),
            this._readVar('xb.choice.active'),
            this._readVar('xb.choice.title')
        ]).then(function (results) {
            var jsonStr = results[0];
            var choices = [results[1], results[2], results[3], results[4]];
            var active = results[5];
            var customTitle = results[6];

            if (active === 'false') return;

            var options = [];

            if (jsonStr) {
                try {
                    var parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed)) {
                        for (var i = 0; i < parsed.length; i++) {
                            var item = parsed[i];
                            if (typeof item === 'string' && item) {
                                options.push({ type: self._inferType(item), content: item });
                            } else if (item && item.content) {
                                options.push({ type: item.type || self._inferType(item.content), content: item.content });
                            }
                        }
                    }
                } catch (e) { /* JSON 解析失败 */ }
            }

            if (options.length === 0) {
                var defaultTypes = ['真情', '套路', '试探', '行动'];
                for (var c = 0; c < choices.length; c++) {
                    if (!choices[c]) continue;
                    var val = choices[c];
                    var type, content;
                    if (val.indexOf('|') !== -1) {
                        var parts = val.split('|');
                        type = parts[0].trim();
                        content = parts.slice(1).join('|').trim();
                    } else {
                        type = defaultTypes[c] || '行动';
                        content = val.trim();
                    }
                    if (content) {
                        options.push({ type: type, content: content });
                    }
                }
            }

            var hash = JSON.stringify(options);
            if (hash === self._lastVarHash || hash === '[]') return;
            self._lastVarHash = hash;

            if (options.length > 0) {
                self._renderVarDrivenOptions(options, customTitle);
            }
        });
    },

    _inferType: function (content) {
        if (!content) return '行动';
        var lower = content.toLowerCase();
        if (lower.indexOf('爱') >= 0 || lower.indexOf('喜欢') >= 0 || lower.indexOf('抱') >= 0 || lower.indexOf('亲') >= 0) return '真情';
        if (lower.indexOf('骗') >= 0 || lower.indexOf('套路') >= 0 || lower.indexOf('计谋') >= 0 || lower.indexOf('计划') >= 0) return '套路';
        if (lower.indexOf('问') >= 0 || lower.indexOf('试探') >= 0 || lower.indexOf('调查') >= 0 || lower.indexOf('观察') >= 0) return '试探';
        return '行动';
    },

    _renderVarDrivenOptions: function (options, customTitle) {
        var allMsgs = document.querySelectorAll('.mes:not(.is_user) .mes_text');
        if (allMsgs.length === 0) return;
        var targetEl = allMsgs[allMsgs.length - 1];

        // [QR-Fix-4] 移除所有旧按钮（包括 AI 标签模式的），防止双模式叠加渲染
        var existingBtns = targetEl.querySelectorAll('.quick-reply-container');
        for (var r = 0; r < existingBtns.length; r++) {
            existingBtns[r].remove();
        }

        // 构建分层卡片
        var html = '<div class="quick-reply-container" data-var-driven="true">';
        html += '<div class="qr-header">';
        html += '<span class="qr-title">' + (customTitle || 'QUICK REPLY') + '</span>';
        html += '<span class="qr-mode">小白X驱动</span>';
        html += '</div>';
        html += '<div class="qr-grid">';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var cfg = this.OPTION_TYPES[opt.type] || { cls: 'qr-xingdong', icon: '\u2663', desc: '行动' };
            html += '<div class="quick-reply-btn ' + cfg.cls + '" data-qr-idx="' + i + '">';
            html += '<span class="qr-label"><span class="qr-icon">' + cfg.icon + '</span> ' + opt.type + '</span>';
            html += '<span class="qr-content">' + opt.content + '</span>';
            html += '</div>';
        }
        html += '</div></div>';

        targetEl.insertAdjacentHTML('beforeend', html);

        // 绑定事件
        this._bindButtonEvents(targetEl, '.quick-reply-container[data-var-driven] .quick-reply-btn', true);

        console.log('[QuickReplyBridge/变量驱动] 已渲染', options.length, '个变量驱动按钮');
    }
};

// 挂载到全局
window.QuickReplyBridge = QuickReplyBridge;
console.log('[QuickReplyBridge] v3.0 模块已加载');

// ===== 自动初始化：加载后 600ms 自动启动，无需外部调用 =====
QuickReplyBridge._autoInit();
