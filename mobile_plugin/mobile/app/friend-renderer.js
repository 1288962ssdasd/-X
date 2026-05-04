/**
 * Friend Renderer - 好友渲染器
 * 从上下文中提取好友信息并渲染成消息列表
 */

// 避免重复定义
if (typeof window.FriendRenderer === 'undefined') {
  class FriendRenderer {
    constructor() {
      // 使用统一的正则表达式管理器
      this.contextMonitor =
        window['contextMonitor'] || (window['ContextMonitor'] ? new window['ContextMonitor']() : null);
      if (!this.contextMonitor) {
        console.warn('[Friend Renderer] 上下文监控器未初始化，使用默认正则表达式');
        this.friendPattern = /\[好友id\|([^|]+)\|(\d+)\]/g;
      } else {
        this.friendPattern = this.contextMonitor.getRegexForFormat('friend');
      }
      this.extractedFriends = [];
      this.lastChatRecord = '';
      this.init();
    }

    init() {
      console.log('[Friend Renderer] 好友渲染器初始化完成');
      // 异步预加载好友列表到缓存，确保后续 getSync 能命中
      setTimeout(function() {
        if (window.friendRenderer && window.friendRenderer.preloadFriendsList) {
          window.friendRenderer.preloadFriendsList();
        }
      }, 500);
    }

    /**
     * 从上下文中提取所有好友和群聊信息
     * [PhoneDataStore集成] 优先从统一数据层读取，保持数据一致性
     */
    extractFriendsFromContext() {
      // [PhoneDataStore集成] 优先从统一数据层读取
      if (window.PhoneDataStore) {
        var pdsFriends = PhoneDataStore.get('friends');
        if (pdsFriends && Array.isArray(pdsFriends) && pdsFriends.length > 0) {
          console.log('[Friend Renderer] 从 PhoneDataStore 加载好友列表:', pdsFriends.length, '个');
          this.extractedFriends = pdsFriends.map(function(f) {
            return {
              type: f.type || 'friend',
              name: f.name,
              number: String(f.number),
              messageIndex: f.messageIndex || 0,
              addTime: f.addTime || Date.now(),
              isGroup: f.isGroup || false,
              source: 'phoneDataStore',
              lastMessage: f.lastMessage || ''
            };
          });
          return this.extractedFriends;
        }
      }

      // [修复v3] 保留通过 addFriend 直接添加的好友（避免异步写入变量时被清空）
      var preservedFriends = [];
      if (this.extractedFriends && this.extractedFriends.length > 0) {
        for (var p = 0; p < this.extractedFriends.length; p++) {
          if (this.extractedFriends[p].source === 'direct') {
            preservedFriends.push(this.extractedFriends[p]);
          }
        }
      }
      this.extractedFriends = preservedFriends;

      // ===== 优先从小白X变量读取好友列表（不污染ST上下文） =====
      var varFriendsLoaded = false;
      try {
        if (window.BridgeAPI && window.BridgeAPI.ConfigManager) {
          var friendsListStr = window.BridgeAPI.ConfigManager.getSync
            ? window.BridgeAPI.ConfigManager.getSync('xb.phone.friends.list')
            : null;
          if (!friendsListStr && window.BridgeAPI.ConfigManager.get) {
            friendsListStr = window.BridgeAPI._varCache
              ? window.BridgeAPI._varCache['xb.phone.friends.list']
              : null;
          }
          if (friendsListStr) {
            var friendsList = JSON.parse(friendsListStr);
            if (Array.isArray(friendsList) && friendsList.length > 0) {
              console.log('[Friend Renderer] 从小白X变量加载好友列表:', friendsList.length, '个');
              var self = this;
              friendsList.forEach(function(f) {
                self.extractedFriends.push({
                  type: 'friend',
                  name: f.name,
                  number: String(f.number),
                  messageIndex: -1,
                  addTime: f.addTime || Date.now(),
                  isGroup: false,
                  source: 'variable'
                });
              });
              varFriendsLoaded = true;
            }
          }
        }
      } catch (e) {
        console.warn('[Friend Renderer] 从变量读取好友列表失败:', e);
      }

      // [修复v3] 备用数据源：从 ST 角色列表（characters）读取 NPC 角色
      // 当 xb.phone.friends.list 为空时，自动从角色卡列表中提取非玩家角色
      if (!varFriendsLoaded) {
        try {
          if (typeof characters !== 'undefined' && Array.isArray(characters) && characters.length > 0) {
            var playerCharId = (typeof this_chid !== 'undefined') ? this_chid : -1;
            for (var ci = 0; ci < characters.length; ci++) {
              var charObj = characters[ci];
              if (!charObj || !charObj.name) continue;
              // 跳过当前玩家角色
              if (ci === playerCharId) continue;
              // 跳过系统角色（如 Assistant, System）
              if (charObj.name === 'Assistant' || charObj.name === 'System') continue;
              // 检查是否已在列表中
              var charExists = this.extractedFriends.some(function(f) {
                return f.name === charObj.name;
              });
              if (!charExists) {
                this.extractedFriends.push({
                  type: 'friend',
                  name: charObj.name,
                  number: String(1000 + ci),  // 自动分配号码
                  messageIndex: -1,
                  addTime: Date.now(),
                  isGroup: false,
                  source: 'character_list'
                });
              }
            }
            if (this.extractedFriends.length > 0) {
              console.log('[Friend Renderer] 从角色列表加载好友:', this.extractedFriends.length, '个');
              varFriendsLoaded = true;
            }
          }
        } catch (e) {
          console.warn('[Friend Renderer] 从角色列表读取失败:', e);
        }
      }

      // [修复v3] 备用数据源：从 chatMetadata.variables 中扫描可能的 NPC 变量
      // 小白X 的变量可能存储在 xb.game、游戏数据 等路径下
      if (!varFriendsLoaded) {
        try {
          if (typeof getLocalVariable === 'function') {
            // 尝试读取 xb.game.friends（旧格式，逗号分隔）
            var gameFriends = getLocalVariable('xb');
            if (gameFriends) {
              var xbObj = (typeof gameFriends === 'string') ? JSON.parse(gameFriends) : gameFriends;
              if (xbObj && xbObj.game && xbObj.game.friends) {
                var friendNames = String(xbObj.game.friends).split(',');
                for (var fi = 0; fi < friendNames.length; fi++) {
                  var fName = friendNames[fi].trim();
                  if (!fName) continue;
                  var fExists = this.extractedFriends.some(function(f) { return f.name === fName; });
                  if (!fExists) {
                    this.extractedFriends.push({
                      type: 'friend',
                      name: fName,
                      number: String(2000 + fi),
                      messageIndex: -1,
                      addTime: Date.now(),
                      isGroup: false,
                      source: 'game_variable'
                    });
                  }
                }
                if (this.extractedFriends.length > 0) {
                  console.log('[Friend Renderer] 从 xb.game.friends 加载好友:', this.extractedFriends.length, '个');
                  varFriendsLoaded = true;
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Friend Renderer] 从 xb.game.friends 读取失败:', e);
        }
      }

      // ===== [Fix-3] 已禁用：从ST聊天记录正则抓取好友 =====
      // 好友数据只从 xb.phone.friends.list 变量读取（上方第51-86行）
      // 正则抓取 ST 聊天记录会导致：误提取非好友文本、与变量数据冲突、性能浪费
      // 如需恢复，取消下方注释即可
      /*
      // ===== 从ST聊天记录提取好友（备用/向后兼容） =====
      try {
        // 检查移动端上下文编辑器是否可用
        if (!window.mobileContextEditor) {
          if (!varFriendsLoaded) {
            console.warn('[Friend Renderer] 移动端上下文编辑器未加载');
          }
          return this.extractedFriends;
        }

        // 检查SillyTavern是否准备就绪
        if (!window.mobileContextEditor.isSillyTavernReady()) {
          if (!varFriendsLoaded) {
            console.warn('[Friend Renderer] SillyTavern未准备就绪');
          }
          return this.extractedFriends;
        }

        // 获取上下文数据
        const context = window.SillyTavern.getContext();
        if (!context || !context.chat || !Array.isArray(context.chat)) {
          if (!varFriendsLoaded) {
            console.warn('[Friend Renderer] 聊天数据不可用');
          }
          return this.extractedFriends;
        }

        // 遍历所有消息，提取好友和群聊信息
        const friendsMap = new Map();
        const groupsMap = new Map();

        // 定义正则表达式
        const friendPattern = /\[好友id\|([^|]+)\|(\d+)\]/g;
        const groupPattern = /\[群聊\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;

        // 新增：支持群聊消息格式来提取群聊信息
        const groupMessagePattern = /\[群聊消息\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;
        // 新增：支持我方群聊消息格式
        const myGroupMessagePattern = /\[我方群聊消息\|我\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;

        // 新增：从消息标签中自动提取联系人（无需[好友id]定义）
        const autoFriendFromMsgPattern = /\[(?:对方消息|我方消息)\|([^|]+)\|([^|]+)\|[^\]]+\]/g;

        context.chat.forEach((message, index) => {
          if (message.mes && typeof message.mes === 'string') {
            // 移除thinking标签后再进行匹配，避免提取thinking内的内容
            const messageForMatching = this.removeThinkingTags(message.mes);

            // 提取好友信息
            const friendMatches = [...messageForMatching.matchAll(friendPattern)];
            friendMatches.forEach(match => {
              const friendName = match[1];
              const friendNumber = match[2];
              const friendKey = `friend_${friendName}_${friendNumber}`;

              if (!friendsMap.has(friendKey) || friendsMap.get(friendKey).messageIndex < index) {
                friendsMap.set(friendKey, {
                  type: 'friend',
                  name: friendName,
                  number: friendNumber,
                  messageIndex: index,
                  addTime: message.send_date || Date.now(),
                  isGroup: false,
                });
              }
            });

            // 自动从消息标签中提取联系人（补充[好友id]缺失的情况）
            const autoFriendMatches = [...messageForMatching.matchAll(autoFriendFromMsgPattern)];
            autoFriendMatches.forEach(match => {
              const senderName = match[1];
              const senderNumber = match[2];
              // 跳过"我"自己
              if (senderName === '我' || senderName === '吴宇伦' || senderName === '宇伦') return;
              const friendKey = `friend_${senderName}_${senderNumber}`;

              if (!friendsMap.has(friendKey) || friendsMap.get(friendKey).messageIndex < index) {
                friendsMap.set(friendKey, {
                  type: 'friend',
                  name: senderName,
                  number: senderNumber,
                  messageIndex: index,
                  addTime: message.send_date || Date.now(),
                  isGroup: false,
                });
              }
            });

            // 提取群聊信息（原有格式）
            const groupMatches = [...messageForMatching.matchAll(groupPattern)];
            groupMatches.forEach(match => {
              const groupName = match[1];
              const groupId = match[2];
              const groupMembers = match[3];
              const groupKey = `group_${groupId}`; // 统一使用群ID作为key

              if (!groupsMap.has(groupKey) || groupsMap.get(groupKey).messageIndex < index) {
                groupsMap.set(groupKey, {
                  type: 'group',
                  name: groupName,
                  number: groupId,
                  members: groupMembers,
                  messageIndex: index,
                  addTime: message.send_date || Date.now(),
                  isGroup: true,
                });
              }
            });

            // 处理群聊消息格式
            const groupMessageMatches = [...messageForMatching.matchAll(groupMessagePattern)];
            groupMessageMatches.forEach(match => {
              const groupId = match[1];
              const senderName = match[2];
              const messageType = match[3];
              const messageContent = match[4];

              const groupKey = `group_${groupId}`; // 统一使用群ID作为key

              if (!groupsMap.has(groupKey)) {
                // 如果群聊不存在，创建一个基于消息的群聊记录
                groupsMap.set(groupKey, {
                  type: 'group',
                  name: `群聊${groupId}`,
                  number: groupId,
                  members: senderName,
                  messageIndex: index,
                  addTime: message.send_date || Date.now(),
                  isGroup: true,
                });
              } else {
                // 如果已存在，更新成员列表和最新消息索引
                const existingGroup = groupsMap.get(groupKey);
                if (existingGroup.members && !existingGroup.members.includes(senderName)) {
                  existingGroup.members += `、${senderName}`;
                }
                if (existingGroup.messageIndex < index) {
                  existingGroup.messageIndex = index;
                  existingGroup.addTime = message.send_date || Date.now();
                }
              }
            });

            // 处理我方群聊消息格式
            const myGroupMessageMatches = [...messageForMatching.matchAll(myGroupMessagePattern)];
            myGroupMessageMatches.forEach(match => {
              const groupId = match[1];
              const messageType = match[2];
              const messageContent = match[3];

              const groupKey = `group_${groupId}`; // 统一使用群ID作为key

              if (!groupsMap.has(groupKey)) {
                // 如果群聊不存在，创建一个基于消息的群聊记录
                groupsMap.set(groupKey, {
                  type: 'group',
                  name: `群聊${groupId}`,
                  number: groupId,
                  members: '我',
                  messageIndex: index,
                  addTime: message.send_date || Date.now(),
                  isGroup: true,
                });
              } else {
                // 如果已存在，更新最新消息索引
                const existingGroup = groupsMap.get(groupKey);
                if (!existingGroup.members.includes('我')) {
                  existingGroup.members += '、我';
                }
                if (existingGroup.messageIndex < index) {
                  existingGroup.messageIndex = index;
                  existingGroup.addTime = message.send_date || Date.now();
                }
              }
            });
          }
        });

        // 合并好友和群聊，按添加时间排序
        const allContacts = [...Array.from(friendsMap.values()), ...Array.from(groupsMap.values())].sort(
          (a, b) => b.addTime - a.addTime,
        );

        // 为每个联系人找到最后一条消息
        this.extractedFriends = allContacts.map(contact => {
          const lastMessage = this.getLastMessageForContact(context.chat, contact);
          return {
            ...contact,
            lastMessage: lastMessage,
          };
        });

        // 只在联系人数量变化时输出日志，避免重复输出
        if (!this.lastContactCount || this.lastContactCount !== this.extractedFriends.length) {
          console.log(`[Friend Renderer] 从上下文中提取到 ${this.extractedFriends.length} 个联系人 (好友+群聊)`);
          this.lastContactCount = this.extractedFriends.length;
        }

        return this.extractedFriends;
      } catch (error) {
        console.error('[Friend Renderer] 提取联系人信息失败:', error);
        return [];
      }
      */ // [Fix-3] end of disabled ST chat regex extraction
      // [Fix-A] 确保始终返回数组
      if (!Array.isArray(this.extractedFriends)) {
        this.extractedFriends = [];
      }
      return this.extractedFriends;
      } // end of extractFriendsFromContext

    /**
     * 获取指定联系人的最后一条消息
     */
    getLastMessageForContact(chatMessages, contact) {
      if (!chatMessages || chatMessages.length === 0) {
        return '暂无聊天记录';
      }

      // 创建匹配模式
      let messagePatterns = [];

      if (contact.isGroup) {
        // 群聊消息模式
        messagePatterns = [
          // 我方群聊消息：[我方群聊消息|我|群ID|消息类型|消息内容]
          new RegExp(`\\[我方群聊消息\\|我\\|${this.escapeRegex(contact.number)}\\|[^|]+\\|([^\\]]+)\\]`, 'g'),
          // 群聊消息格式：[群聊消息|群ID|发送者|消息类型|消息内容]
          new RegExp(`\\[群聊消息\\|${this.escapeRegex(contact.number)}\\|[^|]+\\|[^|]+\\|([^\\]]+)\\]`, 'g'),
          // 原有格式兼容（如果还有的话）
          new RegExp(
            `\\[我方群聊消息\\|${this.escapeRegex(contact.name)}\\|${this.escapeRegex(
              contact.number,
            )}\\|[^|]+\\|([^|]+)\\|[^\\]]+\\]`,
            'g',
          ),
          new RegExp(
            `\\[对方群聊消息\\|${this.escapeRegex(contact.name)}\\|${this.escapeRegex(
              contact.number,
            )}\\|[^|]+\\|[^|]+\\|([^\\]]+)\\]`,
            'g',
          ),
        ];
      } else {
        // 私聊消息模式
        messagePatterns = [
          // 我方消息：[我方消息|我|好友号|消息内容|时间]
          new RegExp(`\\[我方消息\\|我\\|${this.escapeRegex(contact.number)}\\|([^|]+)\\|[^\\]]+\\]`, 'g'),
          // 对方消息：[对方消息|好友名|好友号|消息类型|消息内容]
          new RegExp(
            `\\[对方消息\\|${this.escapeRegex(contact.name)}\\|${this.escapeRegex(
              contact.number,
            )}\\|[^|]+\\|([^\\]]+)\\]`,
            'g',
          ),
        ];
      }

      // 从最后一条消息开始往前找
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        const message = chatMessages[i];
        if (message.mes && typeof message.mes === 'string') {
          for (const pattern of messagePatterns) {
            const matches = [...message.mes.matchAll(pattern)];
            if (matches.length > 0) {
              // 找到最后一条匹配的消息，提取内容
              const lastMatch = matches[matches.length - 1];
              if (lastMatch[1]) {
                const content = lastMatch[1].trim();
                return content.length > 50 ? content.substring(0, 50) + '...' : content;
              }
            }
            pattern.lastIndex = 0; // 重置正则表达式
          }
        }
      }

      return contact.isGroup ? '暂无群聊记录' : '暂无聊天记录';
    }

    /**
     * 转义正则表达式特殊字符
     */
    escapeRegex(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 获取最后一条聊天记录（保留兼容性）
     */
    getLastChatRecord(chatMessages) {
      if (!chatMessages || chatMessages.length === 0) {
        return '暂无聊天记录';
      }

      // 从最后一条消息开始往前找，找到第一条非好友添加/群聊添加消息
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        const message = chatMessages[i];
        if (message.mes && typeof message.mes === 'string') {
          // 如果不是好友添加或群聊格式的消息，则作为最后聊天记录
          const friendPattern = /\[好友id\|[^|]+\|\d+\]/;
          const groupPattern = /\[群聊\|[^|]+\|[^|]+\|[^\]]+\]/;

          if (!friendPattern.test(message.mes) && !groupPattern.test(message.mes)) {
            // 提取实际的消息内容
            const actualContent = this.extractActualMessageContent(message.mes);
            return actualContent.length > 50 ? actualContent.substring(0, 50) + '...' : actualContent;
          }
        }
      }

      return '暂无聊天记录';
    }

    /**
     * 提取实际的消息内容（过滤思考过程，提取QQ格式消息）
     */
    extractActualMessageContent(messageText) {
      try {
        // 1. 移除 <thinking> 标签及其内容
        let cleanedText = messageText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

        // 2. 尝试提取QQ格式的消息
        const qqMessagePatterns = [
          // 我方消息格式：[我方消息|好友名|好友号|消息内容|时间]
          /\[我方消息\|[^|]+\|[^|]+\|([^|]+)\|[^\]]+\]/g,
          // 我方群聊消息格式：[我方群聊消息|群名|群号|我|消息内容|时间]
          /\[我方群聊消息\|[^|]+\|[^|]+\|[^|]+\|([^|]+)\|[^\]]+\]/g,
          // 对方消息格式：[对方消息|角色名|数字id|消息类型|消息内容]
          /\[对方消息\|[^|]+\|[^|]+\|[^|]+\|([^\]]+)\]/g,
          // 对方群聊消息格式：[对方群聊消息|群名|群号|发言者|消息类型|消息内容]
          /\[对方群聊消息\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|([^\]]+)\]/g,
          // 新增：群聊消息格式：[群聊消息|群ID|发送者|消息类型|消息内容]
          /\[群聊消息\|[^|]+\|[^|]+\|[^|]+\|([^\]]+)\]/g,
          // 表情包格式：[表情包|文件名|文件路径]
          /\[表情包\|[^|]+\|[^\]]+\]/g,
          // 语音格式：[语音|时长|内容]
          /\[语音\|[^|]+\|([^\]]+)\]/g,
          // 红包格式：[红包|金额|祝福语]
          /\[红包\|([^|]+)\|[^\]]+\]/g,
        ];

        // 查找所有匹配的消息
        const extractedMessages = [];

        for (const pattern of qqMessagePatterns) {
          let match;
          while ((match = pattern.exec(cleanedText)) !== null) {
            if (match[1]) {
              let content = match[1];

              // 检查是否包含HTML标签
              if (content.includes('<img')) {
                content = '[图片]';
              } else if (content.includes('<video')) {
                content = '[视频]';
              } else if (content.includes('<audio')) {
                content = '[音频]';
              } else if (/<[^>]+>/.test(content)) {
                // 移除其他HTML标签，只保留文本内容
                content = content.replace(/<[^>]*>/g, '').trim();
                if (!content) {
                  content = '[富文本消息]';
                }
              }

              // 对于红包，显示 "红包：金额"
              if (pattern.source.includes('红包')) {
                extractedMessages.push(`红包：${content}`);
              } else if (pattern.source.includes('表情包')) {
                extractedMessages.push('表情包');
              } else if (pattern.source.includes('语音')) {
                extractedMessages.push(`语音：${content}`);
              } else {
                extractedMessages.push(content);
              }
            } else if (match[0]) {
              // 对于表情包这种没有提取内容的，直接显示类型
              if (pattern.source.includes('表情包')) {
                extractedMessages.push('表情包');
              }
            }
          }
          pattern.lastIndex = 0; // 重置正则表达式
        }

        // 如果提取到了消息，返回最后一条
        if (extractedMessages.length > 0) {
          return extractedMessages[extractedMessages.length - 1];
        }

        // 3. 如果没有匹配到QQ格式，尝试其他常见格式
        cleanedText = cleanedText.trim();

        // 移除多余的空行
        cleanedText = cleanedText.replace(/\n\s*\n/g, '\n');

        // 如果还是很长，取第一行作为预览
        if (cleanedText.length > 50) {
          const firstLine = cleanedText.split('\n')[0];
          return firstLine || '消息内容';
        }

        return cleanedText || '消息内容';
      } catch (error) {
        console.error('[Friend Renderer] 提取消息内容失败:', error);
        return '消息内容';
      }
    }

    /**
     * HTML转义函数
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    /**
     * 渲染好友和群聊列表HTML
     */
    renderFriendsHTML() {
      // 先提取好友和群聊信息
      const contacts = this.extractFriendsFromContext();

      // [Fix-A] 安全防护：确保 contacts 是数组，防止 undefined 导致 .length 报错
      const safeContacts = Array.isArray(contacts) ? contacts : [];

      if (safeContacts.length === 0) {
        return `
                <div class="empty-state">
                    <div class="empty-icon">💬</div>
                    <div class="empty-text">暂无联系人</div>
                    <div class="empty-hint">点击右上角"添加"按钮添加好友或创建群聊</div>
                </div>
            `;
      }

      // 渲染联系人列表
      const contactsHTML = safeContacts
        .map(contact => {
          const lastMessage = this.escapeHtml(contact.lastMessage || '暂无消息');

          if (contact.isGroup) {
            // 群聊条目
            return `
                    <div class="message-item group-item" data-friend-id="${contact.number}" data-is-group="true">
                        <div class="message-avatar group-avatar"></div>
                        <div class="message-content">
                            <div class="message-name">
                                ${contact.name}
                                <span class="group-badge">群聊</span>
                            </div>
                            <div class="message-text">${lastMessage}</div>
                        </div>
                        <div class="group-members-info">
                            <span class="member-count">${this.getMemberCount(contact.members)}</span>
                        </div>
                    </div>
                `;
          } else {
            // 个人好友条目
            const avatar = this.getRandomAvatar();
            return `
                    <div class="message-item friend-item" data-friend-id="${contact.number}" data-is-group="false">
                        <div class="message-avatar">${avatar}</div>
                        <div class="message-content">
                            <div class="message-name">${contact.name}</div>
                            <div class="message-text">${lastMessage}</div>
                        </div>
                    </div>
                `;
          }
        })
        .join('');

      return contactsHTML;
    }

    /**
     * 获取群成员数量
     */
    getMemberCount(membersString) {
      if (!membersString) return 0;
      // 群成员格式：我、张三、李四、王五
      const members = membersString.split('、').filter(m => m.trim());
      return members.length;
    }

    /**
     * 获取随机头像
     */
    getRandomAvatar() {
      // 返回空字符串，不显示表情符号，只显示背景图片
      return '';
    }

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      // 处理各种可能的时间戳格式
      let date;

      if (!timestamp) {
        // 如果没有时间戳，使用当前时间
        date = new Date();
      } else if (typeof timestamp === 'string') {
        // 如果是字符串，尝试解析
        date = new Date(timestamp);
        // 如果解析失败，使用当前时间
        if (isNaN(date.getTime())) {
          date = new Date();
        }
      } else if (typeof timestamp === 'number') {
        // 如果是数字，直接使用
        date = new Date(timestamp);
        // 检查是否为有效时间戳
        if (isNaN(date.getTime())) {
          date = new Date();
        }
      } else {
        // 其他情况使用当前时间
        date = new Date();
      }

      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      // 如果时间差异过大（超过1年），可能是时间戳格式问题，显示简单格式
      if (Math.abs(diffDays) > 365) {
        return date.toLocaleDateString('zh-CN', {
          month: 'short',
          day: 'numeric',
        });
      }

      if (diffMins < 1) {
        return '刚刚';
      } else if (diffMins < 60) {
        return `${diffMins}分钟前`;
      } else if (diffHours < 24) {
        return `${diffHours}小时前`;
      } else if (diffDays < 7) {
        return `${diffDays}天前`;
      } else {
        return date.toLocaleDateString('zh-CN', {
          month: 'short',
          day: 'numeric',
        });
      }
    }

    /**
     * 获取好友数量
     */
    getFriendCount() {
      return this.extractedFriends.length;
    }

    /**
     * 根据ID获取好友信息
     */
    getFriendById(friendId) {
      return this.extractedFriends.find(friend => friend.number === friendId);
    }

    /**
     * 刷新好友列表
     */
    refresh() {
      this.extractFriendsFromContext();
      console.log('[Friend Renderer] 好友列表已刷新');
    }

    /**
     * 提取好友信息（兼容方法名）
     */
    extractFriends() {
      return this.extractFriendsFromContext();
    }

    /**
     * 移除thinking标签包裹的内容
     */
    removeThinkingTags(text) {
      if (!text || typeof text !== 'string') {
        return text;
      }

      // 移除 <think>...</think> 和 <thinking>...</thinking> 标签及其内容
      const thinkingTagRegex = /<think>[\s\S]*?<\/think>|<thinking>[\s\S]*?<\/thinking>/gi;
      return text.replace(thinkingTagRegex, '');
    }

    /**
     * 检查格式标记是否在thinking标签内
     */
    isPatternInsideThinkingTags(text, patternStart, patternEnd) {
      if (!text || typeof text !== 'string') {
        return false;
      }

      const thinkingTagRegex = /<think>[\s\S]*?<\/think>|<thinking>[\s\S]*?<\/thinking>/gi;
      let match;

      while ((match = thinkingTagRegex.exec(text)) !== null) {
        const thinkStart = match.index;
        const thinkEnd = match.index + match[0].length;

        // 检查格式标记是否完全在thinking标签内
        if (patternStart >= thinkStart && patternEnd <= thinkEnd) {
          return true;
        }
      }

      return false;
    }

    /**
     * 只移除不在thinking标签内的格式标记
     */
    removePatternOutsideThinkingTags(text, pattern) {
      if (!text || typeof text !== 'string') {
        return text;
      }

      // 创建新的正则表达式实例，避免lastIndex问题
      const newPattern = new RegExp(pattern.source, pattern.flags);
      let result = text;
      const replacements = [];
      let match;

      // 找到所有匹配
      while ((match = newPattern.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;

        // 检查这个匹配是否在thinking标签内
        if (!this.isPatternInsideThinkingTags(text, matchStart, matchEnd)) {
          replacements.push({
            start: matchStart,
            end: matchEnd,
            text: match[0],
          });
        }
      }

      // 从后往前替换，避免索引问题
      replacements.reverse().forEach(replacement => {
        result = result.substring(0, replacement.start) + result.substring(replacement.end);
      });

      return result;
    }

    /**
     * 调试输出
     */
    debug() {
      // 修复：只在调试模式下输出详细信息
      if (window.DEBUG_FRIEND_RENDERER) {
        console.group('[Friend Renderer] 调试信息');
        console.log('提取的好友数量:', this.extractedFriends.length);
        console.log('好友列表:', this.extractedFriends);
        console.log('最后聊天记录:', this.lastChatRecord);
        console.log('正则表达式:', this.friendPattern);
        console.groupEnd();
      }
    }
  }

  // 创建全局实例
  window.FriendRenderer = FriendRenderer;
  window.friendRenderer = new FriendRenderer();

  // 异步预加载好友列表到缓存
  window.friendRenderer.preloadFriendsList = function() {
    var self = this;
    var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
    if (ConfigManager && ConfigManager.get) {
      ConfigManager.get('xb.phone.friends.list').then(function(val) {
        if (val) {
          console.log('[FriendRenderer] 好友列表已预加载到缓存');
        }
      }).catch(function() {});
    }
  };

  // Public method: add a friend directly (for independent AI mode)
  // [修复v3] addFriend 不再调用 refresh()，避免清空 extractedFriends 导致刚添加的好友丢失
  // 改为同时写入 xb.phone.friends.list 变量，确保 refresh() 时能重新提取到
  window.friendRenderer.addFriend = function(name, number) {
    if (!name || !number) return false;
    // Defensive: ensure extractedFriends exists
    if (!this.extractedFriends) this.extractedFriends = [];
    // Check if already exists in the current friends list
    var existing = this.extractedFriends.find(function(f) { return f.name === name && f.number === number; });
    if (existing) return false;
    this.extractedFriends.push({
      type: 'friend',
      name: name,
      number: String(number),
      messageIndex: 0,
      addTime: Date.now(),
      isGroup: false,
      source: 'direct'
    });

    // 如果 WorldbookContact 可用，缓存联系人信息
    if (window.WorldbookContact && window.WorldbookContact._contactCache) {
      if (!window.WorldbookContact._contactCache[number]) {
        window.WorldbookContact._contactCache[number] = {
          name: name,
          friendId: number,
          addedAt: Date.now()
        };
      }
    }

    // [修复v3] 同步写入 xb.phone.friends.list 变量，确保 refresh() 不会丢失此好友
    if (window.BridgeAPI && window.BridgeAPI.ConfigManager && window.BridgeAPI.ConfigManager.get && window.BridgeAPI.ConfigManager.set) {
      window.BridgeAPI.ConfigManager.get('xb.phone.friends.list').then(function(existingList) {
        var friends = [];
        if (existingList) {
          try { friends = JSON.parse(existingList); } catch(e) { friends = []; }
        }
        if (!Array.isArray(friends)) friends = [];
        // 检查变量中是否已存在
        var dup = friends.some(function(f) {
          return String(f.number) === String(number) || f.name === name;
        });
        if (!dup) {
          friends.push({ name: name, number: String(number), addTime: Date.now() });
          window.BridgeAPI.ConfigManager.set('xb.phone.friends.list', JSON.stringify(friends));
          console.log('[FriendRenderer] 好友已同步到 xb.phone.friends.list 变量');
        }
      }).catch(function(e) {
        console.warn('[FriendRenderer] 同步好友到变量失败:', e);
      });
    }

    // [修复v3] 不再调用 this.refresh()，避免清空 extractedFriends
    // 改为触发消息列表 UI 刷新
    if (window.messageApp && window.messageApp.updateAppContent) {
      try { window.messageApp.updateAppContent(); } catch(e) {}
    }
    console.log('[FriendRenderer] Added friend:', name, number);
    return true;
  };

  // 为message-app提供的接口
  window.renderFriendsFromContext = function () {
    return window.friendRenderer.renderFriendsHTML();
  };

  window.refreshFriendsList = function () {
    window.friendRenderer.refresh();
  };

  console.log('[Friend Renderer] 好友渲染器模块加载完成');
} // 结束 if (typeof window.FriendRenderer === 'undefined') 检查
