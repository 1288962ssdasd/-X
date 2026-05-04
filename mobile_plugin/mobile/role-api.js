// ============================================================
// role-api.js -- 角色API模块
// 职责：聊天历史 + System Prompt + 消息发送 + 自动消息 + UI渲染
// 运行环境：Android WebView + Node.js（不使用 ES Module、顶层 await、optional chaining 等）
// 依赖：BridgeAPI（通过 window.BridgeAPI 访问 ConfigManager 和变量操作）
// ============================================================

(function () {
  'use strict';

  // ===== RoleAPI（角色扮演API） =====

  var RoleAPI = {
    chatHistories: {},        // 用户主动聊天的历史（每个好友独立）
    autoMsgHistories: {},     // 主动消息历史（独立隔离）
    isGenerating: false,
    abortController: null,
    _systemPromptCache: null,
    _systemPromptCacheTime: 0,
    _autoMsgTimer: null,
    _autoMsgRunning: false,
    _msgCount: 0,

    // ---------- 初始化 ----------

    init: function () {
      var self = this;
      self._loadHistories();
      self._loadAutoMsgHistories();
      self._watchCharacterChange();
      if (window.BridgeAPI) {
        window.BridgeAPI.syncGameVariables();
      }
      console.log('[RoleAPI] 初始化完成');
    },

    // ---------- 配置与状态 ----------

    isEnabled() {
      var config = this.getAPIConfig();
      var enabled = !!(config && config.apiKey && config.apiUrl);
      if (enabled) this.startAutoMessages();
      return enabled;
    },

    getAPIConfig() {
      if (window.BridgeAPI) {
        return window.BridgeAPI.getAPIConfig();
      }
      // 回退默认配置
      return {
        apiUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'Qwen/Qwen2.5-7B-Instruct',
        temperature: 0.8,
        maxTokens: 300
      };
    },

    // ---------- 历史记录持久化 ----------

    _getCurrentCharName() {
      try {
        var el = document.querySelector('#character_name_input') ||
                 document.querySelector('.character_select .selected_char_name');
        return el ? (el.value || el.textContent || '').trim() : '';
      } catch (e) { return ''; }
    },

    _loadHistories() {
      try {
        var charName = this._getCurrentCharName();
        var saved = localStorage.getItem('mobile_independent_ai_histories_' + (charName || 'default'));
        this.chatHistories = saved ? JSON.parse(saved) : {};
      } catch (e) { this.chatHistories = {}; }
    },

    _loadAutoMsgHistories() {
      try {
        var charName = this._getCurrentCharName();
        var saved = localStorage.getItem('mobile_independent_ai_auto_histories_' + (charName || 'default'));
        this.autoMsgHistories = saved ? JSON.parse(saved) : {};
      } catch (e) { this.autoMsgHistories = {}; }
    },

    _saveHistories() {
      try {
        var charName = this._getCurrentCharName();
        localStorage.setItem('mobile_independent_ai_histories_' + (charName || 'default'), JSON.stringify(this.chatHistories));
      } catch (e) { /* 忽略 */ }
    },

    _saveAutoMsgHistories() {
      try {
        var charName = this._getCurrentCharName();
        localStorage.setItem('mobile_independent_ai_auto_histories_' + (charName || 'default'), JSON.stringify(this.autoMsgHistories));
      } catch (e) { /* 忽略 */ }
    },

    getChatHistory(friendId) {
      if (!this.chatHistories[friendId]) this.chatHistories[friendId] = [];
      return this.chatHistories[friendId];
    },

    getAutoMsgHistory(friendId) {
      if (!this.autoMsgHistories[friendId]) this.autoMsgHistories[friendId] = [];
      return this.autoMsgHistories[friendId];
    },

    addToHistory(friendId, role, content, meta) {
      var history = this.getChatHistory(friendId);
      var entry = { role: role, content: content, time: Date.now() };
      if (meta) {
        entry.fullMatch = meta.fullMatch || null;
        entry.messageType = meta.messageType || '文字';
        entry.msgContent = meta.content || content;
      }
      history.push(entry);
      if (history.length > 30) this.chatHistories[friendId] = history.slice(-30);
      this._saveHistories();
    },

    addToAutoMsgHistory(friendId, role, content) {
      var history = this.getAutoMsgHistory(friendId);
      history.push({ role: role, content: content, time: Date.now() });
      if (history.length > 10) this.autoMsgHistories[friendId] = history.slice(-10);
      this._saveAutoMsgHistories();
    },

    clearHistory(friendId) {
      this.chatHistories[friendId] = [];
      this._saveHistories();
    },

    clearAllHistories() {
      var count = Object.keys(this.chatHistories).length;
      this.chatHistories = {};
      this.autoMsgHistories = {};
      this._saveHistories();
      this._saveAutoMsgHistories();
      // 清除手机变量
      if (window.BridgeAPI) {
        window.BridgeAPI._clearPhoneVars();
      }
      if (window.friendRenderer && window.friendRenderer.friends) {
        window.friendRenderer.friends = [];
        window.friendRenderer.refresh();
      }
      console.log('[RoleAPI] 已清除所有聊天记录和变量，共', count, '个联系人');
    },

    // 监听角色切换
    _watchCharacterChange() {
      var self = this;
      var lastCharId = this._getCurrentCharName();
      setInterval(function () {
        try {
          var current = self._getCurrentCharName();
          if (current && lastCharId && current !== lastCharId) {
            console.log('[RoleAPI] 角色切换:', lastCharId, '->', current);
            self._loadHistories();
            self._loadAutoMsgHistories();
            if (window.friendRenderer && window.friendRenderer.refresh) window.friendRenderer.refresh();
          }
          if (current) lastCharId = current;
        } catch (e) { /* 忽略 */ }
      }, 5000);
      window.addEventListener('hashchange', function () {
        setTimeout(function () {
          var current = self._getCurrentCharName();
          if (current && lastCharId && current !== lastCharId) {
            self._loadHistories();
            self._loadAutoMsgHistories();
          }
        }, 1000);
      });
    },

    // ---------- System Prompt构建 ----------

    buildSystemPrompt: function (friendName, friendId) {
      var self = this;
      var now = Date.now();
      if (self._systemPromptCache && (now - self._systemPromptCacheTime) < 60000) {
        return Promise.resolve(self._systemPromptCache);
      }

      var prompt = '';
      var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;

      // 1. 读取角色卡
      try {
        if (window.SillyTavern && window.SillyTavern.getContext) {
          var context = window.SillyTavern.getContext();
          if (context && context.characterId !== undefined) {
            var charData = context.characters && context.characters[context.characterId];
            if (charData) {
              var charName = charData.name || '';
              var desc = charData.description || '';
              var sysPrompt = charData.system_prompt || '';
              var personality = charData.personality || '';

              prompt += '=== Role Setting ===\n';
              prompt += 'Game: ' + charName + '\n';
              prompt += 'Player: 吴宇伦\n\n';

              if (desc) {
                prompt += '=== World View ===\n';
                prompt += desc.substring(0, 2000) + '\n\n';
              }
              if (personality) {
                prompt += '=== Style ===\n';
                prompt += personality + '\n\n';
              }
              if (sysPrompt) {
                prompt += '=== Core Rules ===\n';
                var sections = ['角色管理与切换规则', '沉沦度追踪系统', '手机消息系统'];
                for (var si = 0; si < sections.length; si++) {
                  var regex = new RegExp('[一二三四五六七八九十]+、' + sections[si] + '[\\s\\S]*?(?=[一二三四五六七八九十]+、|$)', 'i');
                  var match = sysPrompt.match(regex);
                  if (match) prompt += match[0].trim() + '\n\n';
                }
              }
            }
          }
        }
      } catch (e) { /* 忽略 */ }

      // 2. 读取世界书（使用同步方式，避免动态import）
      try {
        if (window.world_info && window.world_info.world) {
          var entries = window.world_info.world.entries || {};
          var entryList = [];
          var entryKeys = Object.keys(entries);
          for (var ei = 0; ei < entryKeys.length; ei++) {
            entryList.push(entries[entryKeys[ei]]);
          }
          var relevantEntries = entryList.filter(function (entry) {
            var keys = entry.key || entry.keys || [];
            var comment = entry.comment || '';
            var allText = (Array.isArray(keys) ? keys.join(' ') : String(keys)) + ' ' + comment;
            return allText.indexOf(friendName) !== -1 || allText.indexOf(friendId) !== -1;
          });
          if (relevantEntries.length > 0) {
            prompt += '=== Character Profile: ' + friendName + ' ===\n';
            for (var ri = 0; ri < relevantEntries.length; ri++) {
              var content = relevantEntries[ri].content || '';
              if (content.length < 3000) prompt += content + '\n\n';
            }
          }
        }
      } catch (e) { /* 忽略 */ }

      // 3. 读取最近ST聊天上下文（最近3条，每条最多100字）
      try {
        if (window.SillyTavern && window.SillyTavern.getContext) {
          var ctx = window.SillyTavern.getContext();
          var chat = ctx.chat || [];
          if (chat.length > 0) {
            var recent = chat.slice(-3);
            var stContext = '=== Recent Main Chat (for context only, do not repeat) ===\n';
            for (var ci = 0; ci < recent.length; ci++) {
              var role = recent[ci].is_user ? '吴宇伦' : 'AI';
              var text = (recent[ci].mes || '').replace(/<[^>]+>/g, '').trim();
              if (text.length > 100) text = text.substring(0, 100) + '...';
              if (text) stContext += role + ': ' + text + '\n';
            }
            prompt += stContext + '\n';
          }
        }
      } catch (e) { /* 忽略 */ }

      // 4. 读取好友变量和全局上下文
      var affectionInfo = '';
      var readVarsPromise = Promise.resolve();
      if (window.BridgeAPI) {
        readVarsPromise = readVarsPromise.then(function () {
          return window.BridgeAPI.readFriendVars(friendName);
        }).then(function (vars) {
          if (vars.affection) affectionInfo += '好感度: ' + vars.affection + '/100\n';
          else if (vars.legacy_沉沦度) affectionInfo += '沉沦度: ' + vars.legacy_沉沦度 + '/100\n';
          if (vars.legacy_阶段) affectionInfo += '关系阶段: ' + vars.legacy_阶段 + '\n';
          if (vars.msgCount) affectionInfo += '已聊天: ' + vars.msgCount + '条\n';
        });
      }

      var globalCtx = null;
      if (window.BridgeAPI) {
        readVarsPromise = readVarsPromise.then(function () {
          return window.BridgeAPI.readGlobalContext();
        }).then(function (ctx) {
          globalCtx = ctx;
        });
      }

      // 4.5 读取全局游戏状态变量（并行读取提升性能）
      var gameState = {};
      if (ConfigManager) {
        readVarsPromise = readVarsPromise.then(function () {
          return Promise.all([
            ConfigManager.get('xb.game.activeChar'),
            ConfigManager.get('xb.game.phase'),
            ConfigManager.get('xb.game.scene'),
            ConfigManager.get('xb.game.money'),
            ConfigManager.get('xb.game.rose'),
            ConfigManager.get('xb.game.friends')
          ]).then(function (results) {
            gameState.activeChar = results[0] || '苏晚晴';
            gameState.phase = results[1] || '完全职业';
            gameState.scene = results[2] || '翡翠湾小区';
            gameState.money = results[3] || '10000';
            gameState.rose = results[4] || '0';
            gameState.friends = results[5] || '';
          });
        });
      } else {
        gameState = { activeChar: '苏晚晴', phase: '完全职业', scene: '翡翠湾小区', money: '10000', rose: '0', friends: '' };
      }

      return readVarsPromise.then(function () {
        if (globalCtx) {
          prompt += '=== 当前剧情状态 ===\n';
          prompt += globalCtx + '\n\n';
        }

        prompt += '=== 游戏状态（从全局变量读取） ===\n';
        prompt += '当前活跃角色: ' + gameState.activeChar + '\n';
        prompt += '当前阶段: ' + gameState.phase + '\n';
        prompt += '当前场景: ' + gameState.scene + '\n';
        prompt += '当前金钱: ' + gameState.money + '\n';
        prompt += '玫瑰值: ' + gameState.rose + '\n';
        if (gameState.friends) prompt += '已添加的好友: ' + gameState.friends + '\n';
        prompt += '\n';

      // 5. 手机聊天模式核心指令
      prompt += '=== 手机聊天模式 ===\n';
      prompt += '你是' + friendName + '，正在通过微信和吴宇伦聊天。\n';
      if (affectionInfo) prompt += affectionInfo + '\n';
      prompt += '严格规则:\n';
      prompt += '1. 只以' + friendName + '的身份回复，像真人发微信一样简短随意（1-3句话）\n';
      prompt += '2. 根据上面的角色档案和关系阶段保持人设\n';
      prompt += '3. 偶尔用emoji，像真人聊天\n';
      prompt += '4. 不要推进主线剧情、切换场景或时间跳跃\n';
      prompt += '5. 不要输出旁白、环境描写或心理描写\n';
      prompt += '6. 不要生成四选项（[真情][套路][试探][行动]）\n';
      prompt += '7. 不要输出状态栏、<state>标签、变量更新或游戏数据\n';
      prompt += '8. 不要使用 > 📱 格式或代码块\n';
      prompt += '9. 不要在回复中使用内部标签如[勾引][思考][分析][表情包|xxx]\n';
      prompt += '10. 根据好感度/沉沦度自然反应\n';
      prompt += '11. 只输出纯文本回复或图片URL，不要任何其他前缀、标签或元数据\n';
      prompt += '12. 当需要发送图片时，先说一句简短的话（1句话），然后换行输出图片URL。\n';
      prompt += '格式：一句话\nhttps://cdn.jsdelivr.net/gh/1288962ssdasd/images@main/角色名_编号.jpg\n';
      prompt += '角色名用当前聊天对象的名字。可用编号：001-016。\n';
      prompt += '必须使用完整的CDN直链URL（含@main分支），不要使用github.com网页链接。\n';
      prompt += '13. 图片编号对应场景：001=登场/日常，002=特定场景日常，003=约会/亲密互动，004=沉沦阶段1，005=沉沦阶段2，006=沉沦阶段3，007=沉沦阶段4/结局\n';
      prompt += '14. 每隔5-8条消息可以发一张图片，不要每条都发\n';
      prompt += '15. 如果需要发送图片，只输出图片URL（一行一个），不要输出HTML标签、不要输出网页链接、不要输出Markdown图片语法\n';

        self._systemPromptCache = prompt;
        self._systemPromptCacheTime = now;

        // 如果 MemoryBridge 可用，增强prompt
        if (window.MemoryBridge && window.MemoryBridge.enhancePrompt) {
          return window.MemoryBridge.enhancePrompt(prompt, friendName);
        }

        return prompt;
      });
    },

    // ---------- 构建消息数组 ----------

    buildMessages(friendId, userMessage, systemPrompt) {
      var history = this.getChatHistory(friendId);
      var messages = [{ role: 'system', content: systemPrompt }];
      var recent = history.slice(-10);
      for (var i = 0; i < recent.length; i++) {
        messages.push({ role: recent[i].role, content: recent[i].content });
      }
      messages.push({ role: 'user', content: userMessage });
      return messages;
    },

    // ---------- 核心：发送消息 ----------

    sendMessage: function (friendName, friendId, userMessage, meta) {
      var self = this;
      if (self.isGenerating) return Promise.resolve({ success: false, error: '正在生成回复' });

      var config = self.getAPIConfig();
      if (!config || !config.apiUrl || !config.apiKey) {
        return Promise.resolve({ success: false, error: 'API未配置' });
      }

      // 优先尝试通过小白X CallGenerateService 发送（如果可用且配置启用）
      if (window.XBBridge && window.XBBridge.isAvailable()) {
        var useXBBridge = false;
        // 检查配置是否启用
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
        var xbBridgeConfigPromise = ConfigManager ? ConfigManager.get('xb.phone.api.useXBBridge') : Promise.resolve(null);

        return xbBridgeConfigPromise.then(function (bridgeEnabled) {
          // 如果未配置，默认尝试使用
          if (bridgeEnabled !== 'false') {
            useXBBridge = true;
          }

          if (useXBBridge) {
            // 使用 XBBridge.generate.generateStream()
            self.isGenerating = true;
            if (typeof AbortController !== 'undefined') {
              self.abortController = new AbortController();
            } else {
              self.abortController = null;
            }

            return self.buildSystemPrompt(friendName, friendId).then(function (systemPrompt) {
              var messages = self.buildMessages(friendId, userMessage, systemPrompt);
              self.addToHistory(friendId, 'user', userMessage, meta);
              self.showTypingIndicator(friendName);

              var bubbleEl = self.createStreamBubble(friendName, friendId);
              var fullReply = '';

              // generateStream 签名: generateStream(options, onChunk, onDone, onError)
              // options 需要包含 messages 数组
              return new Promise(function (resolve, reject) {
                window.XBBridge.generate.generateStream({
                  messages: messages,
                  max_tokens: config ? config.maxTokens || 300 : 300,
                  temperature: config ? config.temperature || 0.8 : 0.8
                },
                  function (delta) {
                    fullReply += delta;
                    self.updateStreamBubble(bubbleEl, fullReply);
                  },
                  function () {
                    self.hideTypingIndicator();
                    self.finalizeStreamBubble(bubbleEl, fullReply, friendName, friendId);
                    self.addToHistory(friendId, 'assistant', fullReply, null);
                    self.scrollToBottom();
                    if (window.friendRenderer && window.friendRenderer.addFriend) {
                      window.friendRenderer.addFriend(friendName, friendId);
                    }
                    if (window.BridgeAPI) {
                      window.BridgeAPI.updateFriendVars(friendName, friendId);
                    }
                    console.log('[RoleAPI] XBBridge 回复完成');
                    self.isGenerating = false;
                    self.abortController = null;
                    resolve({ success: true, text: fullReply });
                  },
                  function (err) {
                    self.hideTypingIndicator();
                    self.isGenerating = false;
                    self.abortController = null;
                    console.error('[RoleAPI] XBBridge 错误:', err);
                    reject(err);
                  }
                );
              });
            });
          }

          // XBBridge 未启用，走原有独立API路径
          return self._sendMessageViaAPI(friendName, friendId, userMessage, meta, config);
        });
      }

      // 原有的独立API fetch 调用逻辑
      return this._sendMessageViaAPI(friendName, friendId, userMessage, meta, config);
    },

    // 内部方法：通过独立API发送消息（回退路径）
    _sendMessageViaAPI: function (friendName, friendId, userMessage, meta, config) {
      var self = this;
      self.isGenerating = true;
      // AbortController 特性检测
      if (typeof AbortController !== 'undefined') {
        self.abortController = new AbortController();
      } else {
        self.abortController = null;
      }

      return Promise.resolve().then(function () {
        // 1. 构建system prompt和消息
        return self.buildSystemPrompt(friendName, friendId);
      }).then(function (systemPrompt) {
        var messages = self.buildMessages(friendId, userMessage, systemPrompt);
        self.addToHistory(friendId, 'user', userMessage, meta);

        // 2. 显示打字指示器
        self.showTypingIndicator(friendName);

        // 3. 构建API URL
        var apiUrl = config.apiUrl.replace(/\/+$/, '').replace(/^[\s`'"]+|[\s`'"]+$/g, '');
        if (!apiUrl.endsWith('/chat/completions')) {
          if (!apiUrl.endsWith('/v1')) apiUrl += '/v1';
          apiUrl += '/chat/completions';
        }

        // 4. 验证API Key
        var apiKey = String(config.apiKey || '').replace(/^[\s`'"]+|[\s`'"]+$/g, '');
        if (!apiKey || apiKey === '你的API Key' || /[^\x00-\x7F]/.test(apiKey)) {
          throw new Error('API Key未设置或包含无效字符');
        }

        // 5. 流式请求
        var fetchOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: config.model || 'gpt-3.5-turbo',
            messages: messages,
            max_tokens: config.maxTokens || 300,
            temperature: config.temperature || 0.8,
            stream: true
          })
        };
        if (self.abortController && self.abortController.signal) {
          fetchOptions.signal = self.abortController.signal;
        }

        return fetch(apiUrl, fetchOptions).then(function (response) {
          if (!response.ok) {
            return response.text().then(function (errorText) {
              throw new Error('API Error ' + response.status + ': ' + errorText.substring(0, 200));
            });
          }

          self.hideTypingIndicator();
          var bubbleEl = self.createStreamBubble(friendName, friendId);

          // 6. 读取流式响应（带特性检测）
          if (response.body && typeof response.body.getReader === 'function') {
            // 支持 ReadableStream
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var fullReply = '';
            var buffer = '';

            function readChunk() {
              return reader.read().then(function (result) {
                if (result.done) return fullReply;
                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (var li = 0; li < lines.length; li++) {
                  var trimmed = lines[li].trim();
                  if (!trimmed || !trimmed.startsWith('data: ')) continue;
                  var data = trimmed.slice(6);
                  if (data === '[DONE]') continue;
                  try {
                    var parsed = JSON.parse(data);
                    var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
                    if (delta) {
                      fullReply += delta;
                      self.updateStreamBubble(bubbleEl, fullReply);
                    }
                  } catch (e) {
                    /* 跳过格式错误的JSON */
                    console.warn('[RoleAPI] SSE JSON解析失败:', data.substring(0, 100), e.message);
                  }
                }
                return readChunk();
              });
            }

            return readChunk().then(function (fullReply) {
              return { bubbleEl: bubbleEl, fullReply: fullReply };
            });
          } else {
            // 回退：非流式读取
            return response.text().then(function (text) {
              var fullReply = '';
              var lines = text.split('\n');
              for (var li = 0; li < lines.length; li++) {
                var trimmed = lines[li].trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                var data = trimmed.slice(6);
                if (data === '[DONE]') continue;
                try {
                  var parsed = JSON.parse(data);
                  var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
                  if (delta) fullReply += delta;
                } catch (e) { /* 跳过 */ }
              }
              if (!fullReply) {
                // 尝试解析为普通JSON响应
                try {
                  var json = JSON.parse(text);
                  fullReply = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '';
                } catch (e) { /* 忽略 */ }
              }
              self.updateStreamBubble(bubbleEl, fullReply);
              return { bubbleEl: bubbleEl, fullReply: fullReply };
            });
          }
        });
      }).then(function (result) {
        var bubbleEl = result.bubbleEl;
        var fullReply = result.fullReply || '';

        // 7. 检查回复是否为空
        if (!fullReply.trim()) {
          console.warn('[RoleAPI] AI返回空内容，移除气泡');
          if (bubbleEl) bubbleEl.remove();
          self.isGenerating = false;
          self.hideTypingIndicator();
          return { success: false, error: 'AI返回空内容' };
        }

        // 8. 完成流式气泡
        self.finalizeStreamBubble(bubbleEl, fullReply, friendName, friendId);

        // 8. 随机语音消息（20%概率）
        var isVoiceMsg = Math.random() < 0.2 && fullReply.length > 5 && fullReply.length < 100;
        var voicePromise = Promise.resolve();
        if (isVoiceMsg && window.messageRenderer) {
          var voiceMsgObj = {
            fullMatch: '[对方消息|' + friendName + '|' + friendId + '|语音|' + fullReply + ']',
            messageType: '语音',
            sender: friendName,
            content: fullReply,
            number: friendId,
            isUser: false
          };
          var voiceHtml = window.messageRenderer.renderSingleMessage(voiceMsgObj);
          if (voiceHtml && bubbleEl) {
            bubbleEl.outerHTML = voiceHtml;
            if (window.phoneTTS) window.phoneTTS.bindVoiceBubbleEvents();
            voicePromise = new Promise(function (resolve) {
              setTimeout(function () {
                var voiceBubble = document.querySelector('.message-detail.message-received:last-child .voice-bubble') ||
                                  document.querySelector('.message-detail.message-received:last-child .message-text');
                if (voiceBubble) {
                  voiceBubble.dataset.ttsText = fullReply;
                  voiceBubble.setAttribute('data-tts-text', fullReply);
                }
                resolve();
              }, 500);
            });
          }
        }

        return voicePromise.then(function () {
          // 9. 保存到历史
          self.addToHistory(friendId, 'assistant', fullReply, isVoiceMsg ? {
            fullMatch: '[对方消息|' + friendName + '|' + friendId + '|语音|' + fullReply + ']',
            messageType: '语音',
            content: fullReply
          } : null);

          // 10. 滚动到底部
          self.scrollToBottom();

          // 11. 自动添加好友
          if (window.friendRenderer && window.friendRenderer.addFriend) {
            window.friendRenderer.addFriend(friendName, friendId);
          }

          // 12. 自动插入图片
          self._msgCount++;
          var imgConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
          var imgPromise = Promise.resolve(5);
          if (imgConfigManager) {
            imgPromise = imgConfigManager.get('xb.phone.image.interval').then(function (v) {
              return parseInt(v) || 5;
            });
          }
          return imgPromise.then(function (imgInterval) {
            if (self._msgCount % imgInterval === 0 && bubbleEl) {
              var imageAutoInsertPromise = Promise.resolve('true');
              if (imgConfigManager) {
                imageAutoInsertPromise = imgConfigManager.get('xb.phone.image.autoInsert');
              }
              return imageAutoInsertPromise.then(function (imageAutoInsert) {
                if (imageAutoInsert !== 'false') {
                  if (window.SocialAPI) {
                    return window.SocialAPI.insertImage(bubbleEl, friendName);
                  }
                }
              });
            }
          });
        });
      }).then(function () {
        // 13. 更新好友变量
        if (window.BridgeAPI) {
          window.BridgeAPI.updateFriendVars(friendName, friendId);
        }

        console.log('[RoleAPI] 回复完成');
        return { success: true };
      }).catch(function (error) {
        self.hideTypingIndicator();
        if (self.abortController && error.name === 'AbortError') {
          return { success: false, error: '已取消' };
        }
        console.error('[RoleAPI] 错误:', error);
        return { success: false, error: error.message };
      }).then(function (result) {
        self.isGenerating = false;
        self.abortController = null;
        return result;
      });
    },

    cancelGeneration() {
      if (this.abortController) this.abortController.abort();
    },

    // ---------- UI：打字指示器 ----------

    showTypingIndicator(friendName) {
      this.hideTypingIndicator();
      var container = document.querySelector('.messages-container');
      if (!container) return;
      var el = document.createElement('div');
      el.className = 'message-detail message-received independent-typing';
      el.id = 'independent-typing-indicator';
      el.innerHTML = '<span class="message-sender">' + friendName + '</span>' +
          '<div class="message-body"><div class="message-avatar"></div>' +
          '<div class="message-content"><div class="message-text">' +
          '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>' +
          '</div></div></div>';
      container.appendChild(el);
      this.scrollToBottom();
    },

    hideTypingIndicator() {
      var el = document.getElementById('independent-typing-indicator');
      if (el) el.remove();
    },

    // ---------- UI：流式气泡 ----------

    createStreamBubble(friendName, friendId) {
      var container = document.querySelector('.messages-container');
      if (!container) return null;
      var el = document.createElement('div');
      el.className = 'message-detail message-received independent-stream';
      el.id = 'independent-stream-bubble';
      el.innerHTML = '<span class="message-sender">' + friendName + '</span>' +
          '<div class="message-body"><div class="message-avatar"></div>' +
          '<div class="message-content"><div class="message-text">' +
          '<span class="stream-cursor">|</span></div></div></div>';
      container.appendChild(el);
      this.scrollToBottom();
      return el;
    },

    updateStreamBubble(el, text) {
      if (!el) return;
      var textEl = el.querySelector('.message-text');
      if (!textEl) return;
      var imgPattern = /^https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)(\?\S*)?$/i;
      if (imgPattern.test(text.trim())) {
        textEl.innerHTML = '<div style="color:#888;font-size:0.85em;padding:4px 0;">图片加载中...</div><span class="stream-cursor">|</span>';
      } else {
        textEl.innerHTML = this.escapeHtml(text) + '<span class="stream-cursor">|</span>';
      }
      this.scrollToBottom();
    },

    finalizeStreamBubble(el, text, friendName, friendId) {
      if (!el) return;
      var textEl = el.querySelector('.message-text');
      if (!textEl) return;
      var cdnImgPattern = /https?:\/\/cdn\.jsdelivr\.net\/gh\/\S+\.(jpg|jpeg|png|gif|webp)(\?\S*)?/i;
      var generalImgPattern = /https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)(\?\S*)?/gi;
      var trimmed = text.trim();
      var isPureImgUrl = cdnImgPattern.test(trimmed) && trimmed.replace(cdnImgPattern, '').trim().length < 5;

      if (isPureImgUrl) {
        var urlMatch = trimmed.match(cdnImgPattern);
        var url = urlMatch ? urlMatch[0] : trimmed;
        textEl.innerHTML = '<img src="' + this.escapeHtml(url) + '" ' +
            'style="max-width:200px;border-radius:8px;cursor:pointer;display:block;" ' +
            'onclick="window.independentAI._enlargeImage(this)" ' +
            'onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'<span style=color:#c0392b;font-size:.85em>图片加载失败</span>\')" />';
      } else if (generalImgPattern.test(text)) {
        generalImgPattern.lastIndex = 0;
        var rendered = this.escapeHtml(text);
        rendered = rendered.replace(
          /(https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)(\?\S*)?)/gi,
          function (match) {
            return '<img src="' + match + '" ' +
                'style="max-width:200px;border-radius:8px;cursor:pointer;display:block;margin:4px 0;" ' +
                'onclick="window.independentAI._enlargeImage(this)" ' +
                'onerror="this.style.display=\'none\'" />';
          }
        );
        textEl.innerHTML = rendered;
      } else {
        textEl.textContent = text;
      }

      // 手机消息格式替换为通知图标（从 independent-ai.js 迁移）
      var html = textEl.innerHTML;
      if (html) {
        // [修复] 第一遍：将直播/微博/朋友圈等手机系统标签合并为紧凑状态提示
        var systemTagRegex = /\[(直播|微博|朋友圈|动态|论坛|商城|任务)\|([^\]]*)\]/g;
        if (systemTagRegex.test(html)) {
          systemTagRegex.lastIndex = 0;
          // 收集所有标签类型
          var foundTags = {};
          html = html.replace(systemTagRegex, function(match, tagType, content) {
            if (!foundTags[tagType]) foundTags[tagType] = [];
            foundTags[tagType].push(content);
            return ''; // 先移除所有标签
          });
          // 生成合并的状态提示
          var statusParts = [];
          var iconMap = {
            '直播': '📺', '微博': '📝', '朋友圈': '📷',
            '动态': '📰', '论坛': '💬', '商城': '🛒', '任务': '📋'
          };
          var statusMap = {
            '直播': '直播中', '微博': '新微博', '朋友圈': '新动态',
            '动态': '新动态', '论坛': '新帖子', '商城': '商城刷新', '任务': '任务更新'
          };
          var tagTypes = Object.keys(foundTags);
          for (var t = 0; t < tagTypes.length; t++) {
            var tag = tagTypes[t];
            var icon = iconMap[tag] || '📱';
            var status = statusMap[tag] || tag;
            statusParts.push(
              '<span class="st-phone-status" style="' +
              'display:inline-flex;align-items:center;gap:3px;' +
              'background:linear-gradient(135deg,#667eea15,#764ba215);' +
              'color:#667eea;font-size:0.72em;padding:2px 8px;border-radius:12px;margin:2px 3px;' +
              'border:1px solid #667eea25;cursor:default;white-space:nowrap;" ' +
              'title="' + tag + ': ' + foundTags[tag].join(' | ') + '">' +
              '<span style="font-size:11px;">' + icon + '</span>' +
              '<span style="font-weight:500;">' + status + '</span>' +
              '</span>'
            );
          }
          if (statusParts.length > 0) {
            // 在消息开头插入合并的状态栏
            var statusHtml = '<div class="st-phone-status-bar" style="' +
              'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;padding:4px 0;' +
              'border-bottom:1px dashed #667eea20;">' +
              statusParts.join('') + '</div>';
            html = statusHtml + html;
          }
          textEl.innerHTML = html;
          html = textEl.innerHTML;
        }

        // 第二遍：手机消息格式（对方消息/我方消息等）
        var phoneMsgRegex = /\[(对方消息|我方消息|群聊消息|我方群聊消息)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]*)\]/g;
        if (phoneMsgRegex.test(html)) {
          phoneMsgRegex.lastIndex = 0;
          html = html.replace(phoneMsgRegex, function(match, msgType, sender, number, mType, content) {
            var isSent = (msgType === '我方消息' || msgType === '我方群聊消息');
            var iconColor = isSent ? '#4caf50' : '#2196f3';
            var label = isSent ? '你' : sender;
            var icon = '📱';
            var preview = '';

            if (mType === '红包' || mType === '转账') {
              icon = '🧧';
              preview = (mType === '红包' ? '红包' : '转账') + ' ¥' + (content || '0');
            } else if (mType === '语音') {
              icon = '🎤'; preview = '[语音消息]';
            } else if (mType === '图片') {
              icon = '🖼️'; preview = '[图片]';
            } else if (mType === '定位') {
              icon = '📍'; preview = '[位置分享]';
            } else {
              var txt = content.trim();
              preview = txt.length > 20 ? txt.substring(0, 20) + '...' : txt;
            }
            return '<span class="st-phone-notification" style="' +
              'display:inline-flex;align-items:center;gap:4px;' +
              'background:' + iconColor + '15;color:' + iconColor + ';' +
              'font-size:0.8em;padding:2px 8px 2px 4px;border-radius:12px;margin:2px 3px;' +
              'border:1px solid ' + iconColor + '30;cursor:default;" ' +
              'title="' + sender + '(' + number + '): ' + content + '">' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;' +
              'width:18px;height:18px;border-radius:50%;background:' + iconColor + ';' +
              'color:#fff;font-size:10px;font-weight:700;">' + icon + '</span>' +
              '<span style="font-weight:600;">' + label + '</span>' +
              '<span style="opacity:0.7;font-size:0.9em;">' + preview + '</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;' +
              'min-width:14px;height:14px;border-radius:7px;background:#f44336;' +
              'color:#fff;font-size:9px;font-weight:700;padding:0 3px;margin-left:2px;">●</span>' +
              '</span>';
          });
          textEl.innerHTML = html;
        }
      }

      el.classList.remove('independent-stream');
    },

    _enlargeImage(imgEl) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      var bigImg = document.createElement('img');
      bigImg.src = imgEl.src;
      bigImg.style.cssText = 'max-width:95%;max-height:95%;object-fit:contain;border-radius:8px;';
      overlay.appendChild(bigImg);
      overlay.addEventListener('click', function () { overlay.remove(); });
      document.body.appendChild(overlay);
    },

    scrollToBottom() {
      setTimeout(function () {
        var el = document.querySelector('.message-detail-content');
        if (el) el.scrollTop = el.scrollHeight;
      }, 50);
    },

    escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    // ---------- 自动消息（NPC主动发消息） ----------

    startAutoMessages() {
      if (this._autoMsgTimer) return;
      var self = this;
      var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
      console.log('[RoleAPI] 自动消息系统已启动');

      if (ConfigManager) {
        ConfigManager.get('xb.phone.autoMsg.interval').then(function (interval) {
          var ms = (parseInt(interval) || 180) * 1000;
          self._autoMsgTimer = setInterval(function () { self._tryAutoMessage(); }, ms);
        });
      }

      // 首次检查在2分钟后
      setTimeout(function () { self._tryAutoMessage(); }, 120000);
    },

    stopAutoMessages() {
      if (this._autoMsgTimer) {
        clearInterval(this._autoMsgTimer);
        this._autoMsgTimer = null;
      }
    },

    _getCurrentFriendId() {
      if (window.messageApp && window.messageApp.currentFriendId) {
        return window.messageApp.currentFriendId;
      }
      return null;
    },

    _tryAutoMessage() {
      var self = this;
      if (this._autoMsgRunning || this.isGenerating) return;

      // 先检查待添加好友变量（发布-订阅模式消费）
      var pendingFriendPromise = window.BridgeAPI ? window.BridgeAPI.processPendingFriend() : Promise.resolve();
      // 消费待发送消息变量（微信弹窗任务写入）
      var pendingMsgPromise = window.BridgeAPI ? window.BridgeAPI.processPendingMessages() : Promise.resolve();

      pendingFriendPromise.then(function () {
        return pendingMsgPromise;
      }).then(function () {
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;

        // 读取配置
        var autoMsgEnabledPromise = ConfigManager ? ConfigManager.get('xb.phone.autoMsg.enabled') : Promise.resolve('true');
        return autoMsgEnabledPromise.then(function (autoMsgEnabled) {
          if (autoMsgEnabled === 'false') return;

          var probabilityPromise = ConfigManager ? ConfigManager.get('xb.phone.autoMsg.probability') : Promise.resolve('30');
          return probabilityPromise.then(function (probStr) {
            var probability = parseInt(probStr) || 30;
            if (Math.random() * 100 > probability) return;

        // 筛选有足够交互历史的好友
        var friendsWithHistory = Object.keys(self.autoMsgHistories).filter(function (id) {
          return self.autoMsgHistories[id] && self.autoMsgHistories[id].length >= 2;
        });

        var chatFriends = Object.keys(self.chatHistories).filter(function (id) {
          return self.chatHistories[id] && self.chatHistories[id].length >= 4;
        });

        var allEligibleIds = [];
        var seen = {};
        for (var i = 0; i < friendsWithHistory.length; i++) {
          if (!seen[friendsWithHistory[i]]) { allEligibleIds.push(friendsWithHistory[i]); seen[friendsWithHistory[i]] = true; }
        }
        for (var j = 0; j < chatFriends.length; j++) {
          if (!seen[chatFriends[j]]) { allEligibleIds.push(chatFriends[j]); seen[chatFriends[j]] = true; }
        }

        if (allEligibleIds.length < 2) return;

        var phoneFriends = (window.friendRenderer && window.friendRenderer.friends) || [];
        var phoneFriendIds = {};
        for (var k = 0; k < phoneFriends.length; k++) phoneFriendIds[String(phoneFriends[k].number)] = true;

        var currentFriend = self._getCurrentFriendId();
        var eligible = allEligibleIds.filter(function (id) {
          return id !== currentFriend && phoneFriendIds[String(id)];
        });

        if (eligible.length === 0) return;

        var targetId = eligible[Math.floor(Math.random() * eligible.length)];
        var friendName = targetId;

        // 获取好友名字
        for (var fi = 0; fi < phoneFriends.length; fi++) {
          if (String(phoneFriends[fi].number) === String(targetId) && phoneFriends[fi].name) {
            friendName = phoneFriends[fi].name;
            break;
          }
        }
        if (friendName === targetId) {
          var hist = self.chatHistories[targetId] || self.autoMsgHistories[targetId] || [];
          if (hist.length > 0) {
            var lastMsg = hist[hist.length - 1];
            friendName = lastMsg.msgContent || lastMsg.content || targetId;
          }
        }

        self._autoMsgRunning = true;
        try {
          var proactivePrompts = [
            '突然想起一件事，想跟你分享...',
            '你现在在忙吗？',
            '刚刚看到一个东西，觉得你会喜欢',
            '无聊了，来骚扰你一下~',
            '你在干嘛呀？',
            '有点想你...',
            '刚刚发生了一件好笑的事',
            '你今天过得怎么样？'
          ];
          var randomPrompt = proactivePrompts[Math.floor(Math.random() * proactivePrompts.length)];

          // 使用独立的system prompt
          var systemPromptPromise = self.buildSystemPrompt(friendName, targetId);
          systemPromptPromise.then(function (systemPrompt) {
            var shortPrompt = systemPrompt.substring(0, 2000) +
              '\n\nYou are sending a proactive message to 吴宇伦. ' +
              'Send ONLY the message content (1-2 sentences), no quotes, no prefixes. ' +
              'Be in character. The message should feel natural and spontaneous.';

            // 使用独立的主动消息历史
            var autoHistory = self.getAutoMsgHistory(targetId);
            var autoMessages = [{ role: 'system', content: shortPrompt }];
            var recentAuto = autoHistory.slice(-3);
            for (var ai = 0; ai < recentAuto.length; ai++) {
              autoMessages.push({ role: recentAuto[ai].role, content: recentAuto[ai].content });
            }
            autoMessages.push({
              role: 'user',
              content: 'Send a proactive WeChat message to 吴宇伦. Context: ' + randomPrompt
            });

            var apiConfig = self.getAPIConfig();
            if (!apiConfig || !apiConfig.apiKey || !apiConfig.apiUrl) return;

            var apiUrl = apiConfig.apiUrl.replace(/\/+$/, '').replace(/^[\s`'"]+|[\s`'"]+$/g, '');
            if (!apiUrl.endsWith('/chat/completions')) {
              if (!apiUrl.endsWith('/v1')) apiUrl += '/v1';
              apiUrl += '/chat/completions';
            }

            return fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiConfig.apiKey
              },
              body: JSON.stringify({
                model: apiConfig.model || 'Qwen/Qwen2.5-7B-Instruct',
                messages: autoMessages,
                max_tokens: 300,
                temperature: 0.9
              })
            });
          }).then(function (autoResponse) {
            if (!autoResponse || !autoResponse.ok) return;
            return autoResponse.json();
          }).then(function (data) {
            if (!data) return;
            var aiText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (aiText) aiText = aiText.trim();
            if (!aiText || aiText.length > 500) return;

            // 保存到独立历史
            self.addToAutoMsgHistory(targetId, 'user', randomPrompt);
            self.addToAutoMsgHistory(targetId, 'assistant', aiText);

            // 同时保存到用户可见的聊天历史
            self.addToHistory(targetId, 'assistant', aiText, {
              fullMatch: '[对方消息|' + friendName + '|' + targetId + '|文字|' + aiText + ']',
              messageType: '对方消息',
              msgType: '文字',
              content: aiText
            });

            if (window.friendRenderer && window.friendRenderer.addFriend) {
              window.friendRenderer.addFriend(friendName, targetId);
            }

            console.log('[RoleAPI] 主动消息来自', friendName, ':', aiText.substring(0, 50));
          }).catch(function (e) {
            console.warn('[RoleAPI] 主动消息失败:', e);
          }).then(function () {
            self._autoMsgRunning = false;
          });
        } catch (autoMsgErr) {
          console.warn('[RoleAPI] 主动消息异常:', autoMsgErr);
          self._autoMsgRunning = false;
        }

        // 确保在 Promise 链异常（包括 buildSystemPrompt 自身 reject）时重置标志
        systemPromptPromise.catch(function (err) {
          console.error('[RoleAPI] 自动消息异常:', err);
          if (self._autoMsgRunning) {
            self._autoMsgRunning = false;
            console.log('[RoleAPI] 已重置 _autoMsgRunning 标志');
          }
        });
          }); // end of probabilityPromise.then
          }); // end of autoMsgEnabledPromise.then
      }); // end of pendingMsgPromise.then
    }
  };

  // ===== 语音消息 data-content 设置（从 independent-ai.js 迁移）=====
  // 监听语音消息插入，自动设置data-content属性（供voice-message-handler和phone-tts读取）
  var voiceObserver = new MutationObserver(function(mutations) {
    for (var mi = 0; mi < mutations.length; mi++) {
      var mutation = mutations[mi];
      var addedNodes = mutation.addedNodes;
      for (var ni = 0; ni < addedNodes.length; ni++) {
        var node = addedNodes[ni];
        if (node.nodeType !== 1) continue;
        var voiceDetails = node.querySelectorAll ? node.querySelectorAll('.message-detail[title="语音"]') : [];
        if (node.title === '语音' && node.classList && node.classList.contains('message-detail')) {
          voiceDetails = [node];
        }
        for (var vi = 0; vi < voiceDetails.length; vi++) {
          var detail = voiceDetails[vi];
          if (detail.dataset.contentSet === '1') continue;
          var textEl = detail.querySelector('.message-text');
          if (textEl) {
            var text = textEl.textContent.trim();
            if (/^\d{1,2}:\d{2}$/.test(text)) {
              var allText = detail.textContent || '';
              var match = allText.match(/[（(]([^)）]+)[)）]/);
              if (match) {
                text = match[1];
              }
            }
            if (text && !/^\d{1,2}:\d{2}$/.test(text)) {
              detail.dataset.content = text;
              detail.setAttribute('data-content', text);
              detail.dataset.contentSet = '1';
              console.log('[RoleAPI] 语音消息data-content已设置:', text.substring(0, 30));
            }
          }
        }
      }
    }
  });
  // 延迟启动观察器（等待手机容器渲染）
  setTimeout(function() {
    var phoneContainer = document.querySelector('.mobile-phone-container') || document.body;
    voiceObserver.observe(phoneContainer, { childList: true, subtree: true });
    console.log('[RoleAPI] 语音消息观察器已启动');
  }, 5000);

  // ===== 挂载全局 =====
  window.RoleAPI = RoleAPI;
  window.independentAI = window.RoleAPI;

  console.log('[RoleAPI] 模块已加载');
})();
