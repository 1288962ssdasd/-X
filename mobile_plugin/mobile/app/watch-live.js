/**
 * Watch Live App - 观看直播应用
 * 基于live-app.js的模式，为mobile-phone.js提供观看直播功能
 * 监听SillyTavern上下文，解析直播数据，实时显示弹幕和互动
 */

// @ts-nocheck
// 避免重复定义
if (typeof window.WatchLiveApp === 'undefined') {
  /**
   * 直播事件监听器
   * 负责监听SillyTavern的消息事件并触发数据解析
   */
  class LiveEventListener {
    constructor(liveApp) {
      this.liveApp = liveApp;
      this.isListening = false;
      this.lastMessageCount = 0;
      this.pollingInterval = null;
      this.messageReceivedHandler = this.onMessageReceived.bind(this);
    }

    /**
     * 开始监听SillyTavern事件
     */
    startListening() {
      if (this.isListening) {
        console.log('[Live App] 监听器已经在运行中');
        return;
      }

      try {
        // 检查SillyTavern接口可用性
        console.log('[Live App] 检查SillyTavern接口可用性:', {
          'window.SillyTavern': !!window?.SillyTavern,
          'window.SillyTavern.getContext': typeof window?.SillyTavern?.getContext,
          eventOn: typeof eventOn,
          tavern_events: typeof tavern_events,
          mobileContextEditor: !!window?.mobileContextEditor,
        });

        // 方法1: 优先使用SillyTavern.getContext().eventSource（iframe环境推荐）
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && context.eventSource && typeof context.eventSource.on === 'function' && context.event_types) {
            console.log('[Live App] 使用SillyTavern.getContext().eventSource监听MESSAGE_RECEIVED事件');
            context.eventSource.on(context.event_types.MESSAGE_RECEIVED, this.messageReceivedHandler);
            this.isListening = true;
            console.log('[Live App] ✅ 成功开始监听SillyTavern消息事件 (context.eventSource)');
            this.updateMessageCount();
            return;
          }
        }

        // 方法2: 尝试使用全局eventOn函数（如果可用）
        if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined' && tavern_events.MESSAGE_RECEIVED) {
          console.log('[Live App] 使用全局eventOn监听MESSAGE_RECEIVED事件');
          eventOn(tavern_events.MESSAGE_RECEIVED, this.messageReceivedHandler);
          this.isListening = true;
          console.log('[Live App] ✅ 成功开始监听SillyTavern消息事件 (eventOn)');
          this.updateMessageCount();
          return;
        }

        // 方法3: 尝试从父窗口使用eventSource
        if (
          typeof window !== 'undefined' &&
          window.parent &&
          window.parent.eventSource &&
          typeof window.parent.eventSource.on === 'function'
        ) {
          console.log('[Live App] 使用父窗口eventSource监听MESSAGE_RECEIVED事件');
          if (window.parent.event_types && window.parent.event_types.MESSAGE_RECEIVED) {
            window.parent.eventSource.on(window.parent.event_types.MESSAGE_RECEIVED, this.messageReceivedHandler);
            this.isListening = true;
            console.log('[Live App] ✅ 成功开始监听SillyTavern消息事件 (parent eventSource)');
            this.updateMessageCount();
            return;
          }
        }

        // 如果所有方法都失败，使用轮询作为备用方案
        console.warn('[Live App] 无法设置事件监听，使用轮询方案');
        this.startPolling();
      } catch (error) {
        console.error('[Live App] 设置事件监听失败:', error);
        this.startPolling();
      }
    }

    /**
     * 停止监听
     */
    stopListening() {
      if (!this.isListening) return;

      try {
        // 尝试移除事件监听器
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && context.eventSource && typeof context.eventSource.off === 'function' && context.event_types) {
            context.eventSource.off(context.event_types.MESSAGE_RECEIVED, this.messageReceivedHandler);
          }
        }

        // 清除轮询
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }

        this.isListening = false;
        console.log('[Live App] 已停止监听SillyTavern事件');
      } catch (error) {
        console.error('[Live App] 停止监听失败:', error);
      }
    }

    /**
     * 启动轮询方案
     */
    startPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }

      this.updateMessageCount();
      this.pollingInterval = setInterval(() => {
        this.checkForNewMessages();
      }, 2000); // 每2秒检查一次

      this.isListening = true;
      console.log('[Live App] ✅ 启动轮询监听方案');
    }

    /**
     * 检查新消息
     */
    checkForNewMessages() {
      const currentMessageCount = this.getCurrentMessageCount();
      if (currentMessageCount > this.lastMessageCount) {
        console.log(`[Live App] 轮询检测到新消息: ${this.lastMessageCount} → ${currentMessageCount}`);
        this.onMessageReceived(currentMessageCount);
      }
    }

    /**
     * 处理AI消息接收事件
     * @param {number} messageId - 接收到的消息ID
     */
    async onMessageReceived(messageId) {
      try {
        console.log(`[Watch Live App] 🎯 接收到AI消息事件，ID: ${messageId}`);

        // 检查是否有新消息
        const currentMessageCount = this.getCurrentMessageCount();
        console.log(`[Watch Live App] 消息数量检查: 当前=${currentMessageCount}, 上次=${this.lastMessageCount}`);

        if (currentMessageCount <= this.lastMessageCount) {
          console.log('[Watch Live App] 没有检测到新消息，跳过解析');
          return;
        }

        console.log(
          `[Watch Live App] ✅ 检测到新消息，消息数量从 ${this.lastMessageCount} 增加到 ${currentMessageCount}`,
        );
        this.lastMessageCount = currentMessageCount;

        // 如果正在等待直播间列表
        if (this.liveApp.isWaitingForLiveList) {
          console.log('[Watch Live App] 检测到直播间列表回复，更新列表');
          this.liveApp.isWaitingForLiveList = false;
          this.liveApp.updateAppContent();
          return;
        }

        // 检查直播是否活跃
        if (!this.liveApp || !this.liveApp.isLiveActive) {
          console.log('[Watch Live App] 直播未激活，跳过处理');
          return;
        }

        // 触发数据解析
        console.log('[Watch Live App] 开始解析新的直播数据...');
        await this.liveApp.parseNewLiveData();
      } catch (error) {
        console.error('[Watch Live App] 处理消息接收事件失败:', error);
      }
    }

    /**
     * 获取当前消息数量
     */
    getCurrentMessageCount() {
      try {
        // 方法1: 使用SillyTavern.getContext().chat（正确的接口）
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && context.chat && Array.isArray(context.chat)) {
            const count = context.chat.length;
            console.log(`[Live App] 通过SillyTavern.getContext().chat获取到 ${count} 条消息`);
            return count;
          }
        }

        // 方法2: 使用mobileContextEditor作为备用
        const mobileContextEditor = window['mobileContextEditor'];
        if (mobileContextEditor && typeof mobileContextEditor.getCurrentChatData === 'function') {
          const chatData = mobileContextEditor.getCurrentChatData();
          if (chatData && chatData.messages && Array.isArray(chatData.messages)) {
            console.log(`[Live App] 通过mobileContextEditor获取到 ${chatData.messages.length} 条消息`);
            return chatData.messages.length;
          }
        }

        // 方法3: 尝试从父窗口获取chat变量
        if (typeof window !== 'undefined' && window.parent && window.parent.chat && Array.isArray(window.parent.chat)) {
          const count = window.parent.chat.length;
          console.log(`[Live App] 通过父窗口chat变量获取到 ${count} 条消息`);
          return count;
        }

        // 方法4: 使用getContext()方法（如果可用）
        if (typeof window !== 'undefined' && window.getContext && typeof window.getContext === 'function') {
          const context = window.getContext();
          if (context && context.chat && Array.isArray(context.chat)) {
            const count = context.chat.length;
            console.log(`[Live App] 通过getContext()获取到 ${count} 条消息`);
            return count;
          }
        }

        console.warn('[Live App] 无法获取消息数量，使用默认值0');
        return 0;
      } catch (error) {
        console.warn('[Live App] 获取消息数量失败:', error);
        return 0;
      }
    }

    /**
     * 更新消息计数
     */
    updateMessageCount() {
      this.lastMessageCount = this.getCurrentMessageCount();
      console.log(`[Live App] 初始化消息计数: ${this.lastMessageCount}`);
    }
  }

  /**
   * 直播数据解析器
   * 负责解析SillyTavern消息中的直播格式数据
   */
  class LiveDataParser {
    constructor() {
      // 正则表达式模式
      this.patterns = {
        viewerCount: /\[直播\|本场人数\|([^\]]+)\]/g,
        liveContent: /\[直播\|直播内容\|([^\]]+)\]/g,
        normalDanmaku: /\[直播\|([^\|]+)\|弹幕\|([^\]]+)\]/g,
        giftDanmaku: /\[直播\|([^\|]+)\|打赏\|([^\]]+)\]/g,
        recommendedInteraction: /\[直播\|推荐互动\|([^\]]+)\]/g,
      };
    }

    /**
     * 解析直播数据
     * @param {string} content - 要解析的文本内容
     * @returns {Object} 解析后的直播数据
     */
    parseLiveData(content) {
      const liveData = {
        viewerCount: 0,
        liveContent: '',
        danmakuList: [],
        giftList: [],
        recommendedInteractions: [],
      };

      if (!content || typeof content !== 'string') {
        return liveData;
      }

      // 1. 解析直播人数
      liveData.viewerCount = this.parseViewerCount(content);

      // 2. 解析直播内容
      liveData.liveContent = this.parseLiveContent(content);

      // 3. 解析所有弹幕（保持原始顺序）
      const { danmakuList, giftList } = this.parseAllDanmaku(content);
      liveData.danmakuList = danmakuList;
      liveData.giftList = giftList;

      // 5. 解析推荐互动
      liveData.recommendedInteractions = this.parseRecommendedInteractions(content);

      return liveData;
    }

    /**
     * 解析直播人数
     */
    parseViewerCount(content) {
      const matches = [...content.matchAll(this.patterns.viewerCount)];
      if (matches.length === 0) return 0;

      // 取最后一个匹配（最新的人数）
      const lastMatch = matches[matches.length - 1];
      const viewerStr = lastMatch[1].trim();

      return this.formatViewerCount(viewerStr);
    }

    /**
     * 格式化观看人数
     */
    formatViewerCount(viewerStr) {
      // 移除非数字字符，保留数字和字母
      const cleanStr = viewerStr.replace(/[^\d\w]/g, '');

      // 尝试解析数字
      const num = parseInt(cleanStr);
      if (isNaN(num)) return 0;

      // 格式化大数字
      if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'W';
      } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
      }

      return num.toString();
    }

    /**
     * 解析直播内容
     */
    parseLiveContent(content) {
      const matches = [...content.matchAll(this.patterns.liveContent)];
      if (matches.length === 0) return '';

      // 取最后一个匹配（最新的内容）
      const lastMatch = matches[matches.length - 1];
      return lastMatch[1].trim();
    }

    /**
     * 解析所有弹幕（保持原始顺序）
     */
    parseAllDanmaku(content) {
      const danmakuList = [];
      const giftList = [];
      const allMatches = [];

      // 收集所有普通弹幕匹配
      const normalMatches = [...content.matchAll(this.patterns.normalDanmaku)];
      normalMatches.forEach(match => {
        allMatches.push({
          type: 'normal',
          match: match,
          index: match.index, // 在原文中的位置
        });
      });

      // 收集所有礼物弹幕匹配
      const giftMatches = [...content.matchAll(this.patterns.giftDanmaku)];
      giftMatches.forEach(match => {
        allMatches.push({
          type: 'gift',
          match: match,
          index: match.index, // 在原文中的位置
        });
      });

      // 按照在原文中的位置排序，保持原始顺序
      allMatches.sort((a, b) => a.index - b.index);

      // 按顺序处理所有弹幕
      allMatches.forEach((item, index) => {
        const match = item.match;
        const username = match[1].trim();
        const content = match[2].trim();
        const timestamp = new Date().toLocaleString();

        if (item.type === 'normal') {
          // 普通弹幕
          danmakuList.push({
            id: Date.now() + index,
            username: username,
            content: content,
            type: 'normal',
            timestamp: timestamp,
          });
        } else if (item.type === 'gift') {
          // 礼物弹幕
          danmakuList.push({
            id: Date.now() + index + 10000, // 避免ID冲突
            username: username,
            content: content,
            type: 'gift',
            timestamp: timestamp,
          });

          // 添加到礼物列表
          giftList.push({
            username: username,
            gift: content,
            timestamp: timestamp,
          });
        }
      });

      return { danmakuList, giftList };
    }

    /**
     * 解析普通弹幕（保留原方法以备兼容）
     */
    parseNormalDanmaku(content) {
      const danmakuList = [];
      const matches = [...content.matchAll(this.patterns.normalDanmaku)];

      matches.forEach((match, index) => {
        const username = match[1].trim();
        const danmakuContent = match[2].trim();

        danmakuList.push({
          id: Date.now() + index,
          username: username,
          content: danmakuContent,
          type: 'normal',
          timestamp: new Date().toLocaleString(),
        });
      });

      return danmakuList;
    }

    /**
     * 解析打赏弹幕
     */
    parseGiftDanmaku(content) {
      const danmakuList = [];
      const giftList = [];
      const matches = [...content.matchAll(this.patterns.giftDanmaku)];

      matches.forEach((match, index) => {
        const username = match[1].trim();
        const giftContent = match[2].trim();
        const timestamp = new Date().toLocaleString();

        // 添加到弹幕列表
        danmakuList.push({
          id: Date.now() + index + 10000, // 避免ID冲突
          username: username,
          content: giftContent,
          type: 'gift',
          timestamp: timestamp,
        });

        // 添加到礼物列表
        giftList.push({
          username: username,
          gift: giftContent,
          timestamp: timestamp,
        });
      });

      return { danmakuList, giftList };
    }

    /**
     * 解析推荐互动
     */
    parseRecommendedInteractions(content) {
      const interactions = [];
      const matches = [...content.matchAll(this.patterns.recommendedInteraction)];

      console.log(`[Live App] 推荐互动解析: 找到 ${matches.length} 个匹配项`);

      // 只取最后4个匹配项（最新的推荐互动）
      const recentMatches = matches.slice(-4);
      console.log(`[Live App] 取最新的 ${recentMatches.length} 个推荐互动`);

      recentMatches.forEach((match, index) => {
        const interactionContent = match[1].trim();
        console.log(`[Live App] 推荐互动 ${index + 1}: "${interactionContent}"`);
        if (!interactions.includes(interactionContent)) {
          interactions.push(interactionContent);
        }
      });

      console.log(`[Live App] 最终推荐互动列表:`, interactions);
      return interactions;
    }

    /**
     * 获取聊天消息内容
     */
    getChatContent() {
      try {
        // 方法1: 使用SillyTavern.getContext().chat（正确的接口）
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && context.chat && Array.isArray(context.chat)) {
            const messages = context.chat;
            if (messages && messages.length > 0) {
              const content = messages.map(msg => msg.mes || '').join('\n');
              console.log(`[Live App] 通过SillyTavern.getContext().chat获取到聊天内容，长度: ${content.length}`);
              return content;
            }
          }
        }

        // 方法2: 使用mobileContextEditor作为备用
        const mobileContextEditor = window['mobileContextEditor'];
        if (mobileContextEditor && typeof mobileContextEditor.getCurrentChatData === 'function') {
          const chatData = mobileContextEditor.getCurrentChatData();
          if (chatData && chatData.messages && Array.isArray(chatData.messages)) {
            const content = chatData.messages.map(msg => msg.mes || '').join('\n');
            console.log(`[Live App] 通过mobileContextEditor获取到聊天内容，长度: ${content.length}`);
            return content;
          }
        }

        // 方法3: 尝试从父窗口获取chat变量
        if (typeof window !== 'undefined' && window.parent && window.parent.chat && Array.isArray(window.parent.chat)) {
          const messages = window.parent.chat;
          if (messages && messages.length > 0) {
            const content = messages.map(msg => msg.mes || '').join('\n');
            console.log(`[Live App] 通过父窗口chat变量获取到聊天内容，长度: ${content.length}`);
            return content;
          }
        }

        // 方法4: 使用getContext()方法（如果可用）
        if (typeof window !== 'undefined' && window.getContext && typeof window.getContext === 'function') {
          const context = window.getContext();
          if (context && context.chat && Array.isArray(context.chat)) {
            const messages = context.chat;
            if (messages && messages.length > 0) {
              const content = messages.map(msg => msg.mes || '').join('\n');
              console.log(`[Live App] 通过getContext()获取到聊天内容，长度: ${content.length}`);
              return content;
            }
          }
        }

        console.warn('[Live App] 无法获取聊天内容');
        return '';
      } catch (error) {
        console.warn('[Live App] 获取聊天内容失败:', error);
        return '';
      }
    }
  }

  /**
   * 直播状态管理器
   * 负责管理直播状态和数据存储
   */
  class LiveStateManager {
    constructor() {
      this.isLiveActive = false;
      this.currentViewerCount = 0;
      this.currentLiveContent = '';
      this.danmakuList = [];
      this.giftList = [];
      this.recommendedInteractions = [];
      // 移除弹幕数量限制，显示所有历史弹幕
    }

    /**
     * 开始直播
     */
    startLive() {
      this.isLiveActive = true;
      this.currentViewerCount = 0;
      this.currentLiveContent = '';
      this.danmakuList = [];
      this.giftList = [];
      this.recommendedInteractions = [];
      console.log('[Live App] 直播状态已激活');
    }

    /**
     * 结束直播
     */
    endLive() {
      this.isLiveActive = false;
      console.log('[Live App] 直播状态已停止');
    }

    /**
     * 更新直播数据
     * @param {Object} liveData - 解析后的直播数据
     */
    updateLiveData(liveData) {
      if (!this.isLiveActive) return;

      // 更新观看人数（仅保留最新的）
      if (liveData.viewerCount !== undefined && liveData.viewerCount !== 0) {
        this.currentViewerCount = liveData.viewerCount;
        console.log(`[Live App] 更新观看人数: ${this.currentViewerCount}`);
      }

      // 更新直播内容（仅保留最新的）
      if (liveData.liveContent && liveData.liveContent.trim() !== '') {
        this.currentLiveContent = liveData.liveContent;
        console.log(`[Live App] 更新直播内容: ${this.currentLiveContent.substring(0, 50)}...`);
      }

      // 更新推荐互动（仅保留最新的）
      if (liveData.recommendedInteractions && liveData.recommendedInteractions.length > 0) {
        this.recommendedInteractions = liveData.recommendedInteractions;
        console.log(`[Live App] 更新推荐互动: ${this.recommendedInteractions.length} 个`);
      }

      // 添加新弹幕（累积所有历史弹幕）
      if (liveData.danmakuList && liveData.danmakuList.length > 0) {
        // 过滤掉已存在的弹幕（基于内容和用户名）
        const newDanmaku = liveData.danmakuList.filter(newItem => {
          return !this.danmakuList.some(
            existingItem =>
              existingItem.username === newItem.username &&
              existingItem.content === newItem.content &&
              existingItem.type === newItem.type,
          );
        });

        if (newDanmaku.length > 0) {
          this.danmakuList = this.danmakuList.concat(newDanmaku);
          console.log(`[Watch Live App] 添加 ${newDanmaku.length} 条新弹幕，总计 ${this.danmakuList.length} 条`);

          // 移除弹幕数量限制，保留所有历史弹幕
          console.log(`[Watch Live App] 保留所有弹幕，当前总数: ${this.danmakuList.length}`);
        }
      }

      // 添加新礼物（累积所有历史礼物）
      if (liveData.giftList && liveData.giftList.length > 0) {
        // 过滤掉已存在的礼物
        const newGifts = liveData.giftList.filter(newGift => {
          return !this.giftList.some(
            existingGift =>
              existingGift.username === newGift.username &&
              existingGift.gift === newGift.gift &&
              existingGift.timestamp === newGift.timestamp,
          );
        });

        if (newGifts.length > 0) {
          this.giftList = this.giftList.concat(newGifts);
          console.log(`[Live App] 添加 ${newGifts.length} 个新礼物，总计 ${this.giftList.length} 个`);
        }
      }
    }

    /**
     * 获取当前直播状态
     */
    getCurrentState() {
      return {
        isLiveActive: this.isLiveActive,
        viewerCount: this.currentViewerCount,
        liveContent: this.currentLiveContent,
        danmakuList: [...this.danmakuList], // 返回副本
        giftList: [...this.giftList], // 返回副本
        recommendedInteractions: [...this.recommendedInteractions], // 返回副本
      };
    }

    /**
     * 清空所有数据
     */
    clearAllData() {
      this.currentViewerCount = 0;
      this.currentLiveContent = '';
      this.danmakuList = [];
      this.giftList = [];
      this.recommendedInteractions = [];
      console.log('[Live App] 已清空所有直播数据');
    }
  }

  /**
   * 观看直播应用主类
   * 协调各个模块，提供统一的接口
   */
  class WatchLiveApp {
    constructor() {
      this.eventListener = new LiveEventListener(this);
      this.dataParser = new LiveDataParser();
      this.stateManager = new LiveStateManager();
      this.currentView = 'start'; // 'start', 'live'
      this.isInitialized = false;
      this.lastRenderTime = 0;
      this.renderCooldown = 500; // 渲染冷却时间
      this.scrollTimeout = null; // 滚动防抖定时器
      this.typingTimer = null; // 直播内容打字机计时器
      this.isTyping = false; // 是否正在打字机效果
      this.pendingAppearDanmakuSigs = new Set(); // 待逐条出现的弹幕签名
      this.pendingAppearGiftSigs = new Set(); // 待逐条出现的礼物签名
      this.saveTimeout = null;
      this.saveDebounceMs = 2000; // 2秒防抖

      this.init();
    }

    /**
     * 初始化应用
     */
    init() {
      console.log('[Watch Live App] 观看直播应用初始化开始');

      // 检查渲染权状态
      const renderingRight = this.getRenderingRight();
      console.log('[Watch Live App] 当前渲染权状态:', renderingRight);

      // 如果渲染权不是watch或end，不进行检测
      if (renderingRight && renderingRight !== 'watch' && renderingRight !== 'end') {
        console.log('[Watch Live App] 渲染权不匹配，跳过初始化检测');
        this.isInitialized = true;
        return;
      }

      // 检测是否有活跃的直播数据
      this.detectActiveLive();

      this.isInitialized = true;
      console.log('[Watch Live App] 观看直播应用初始化完成');
    }

    /**
     * 检测是否有活跃的直播数据
     */
    detectActiveLive() {
      try {
        console.log('[Watch Live App] 检测活跃的直播数据...');

        // 检查渲染权
        const renderingRight = this.getRenderingRight();
        if (renderingRight && renderingRight !== 'watch' && renderingRight !== 'end') {
          console.log(`[Watch Live App] 渲染权被${renderingRight}占用，跳过检测`);
          return;
        }

        // 获取聊天内容
        const chatContent = this.dataParser.getChatContent();
        if (!chatContent) {
          console.log('[Watch Live App] 没有聊天内容，保持观看直播状态');
          return;
        }

        // 检查是否有活跃的直播格式（非历史格式）
        const hasActiveLive = this.hasActiveLiveFormats(chatContent);

        if (hasActiveLive && renderingRight === 'watch') {
          console.log('[Watch Live App] 🎯 检测到活跃的直播数据，自动进入观看直播状态');

          // 设置为直播中状态
          this.stateManager.startLive();
          this.currentView = 'live';

          // 解析并加载现有的直播数据
          const liveData = this.dataParser.parseLiveData(chatContent);
          this.stateManager.updateLiveData(liveData);

          // 开始监听新的消息
          this.eventListener.startListening();

          console.log('[Watch Live App] ✅ 已自动恢复观看直播状态，数据:', {
            viewerCount: this.stateManager.currentViewerCount,
            liveContent: this.stateManager.currentLiveContent
              ? this.stateManager.currentLiveContent.substring(0, 50) + '...'
              : '',
            danmakuCount: this.stateManager.danmakuList.length,
            giftCount: this.stateManager.giftList.length,
            interactionCount: this.stateManager.recommendedInteractions.length,
          });
        } else {
          console.log('[Watch Live App] 没有检测到活跃的直播数据或渲染权不匹配，保持观看直播选择状态');
        }
      } catch (error) {
        console.error('[Watch Live App] 检测活跃直播数据失败:', error);
      }
    }

    /**
     * 检查是否有活跃的直播格式
     */
    hasActiveLiveFormats(content) {
      if (!content || typeof content !== 'string') {
        return false;
      }

      // 检查是否有任何活跃的直播格式（非历史格式）
      const activeLivePatterns = [
        /\[直播\|本场人数\|[^\]]+\]/,
        /\[直播\|直播内容\|[^\]]+\]/,
        /\[直播\|[^|]+\|弹幕\|[^\]]+\]/,
        /\[直播\|[^|]+\|(?:打赏|礼物)\|[^\]]+\]/,
        /\[直播\|推荐互动\|[^\]]+\]/,
      ];

      for (const pattern of activeLivePatterns) {
        if (pattern.test(content)) {
          console.log('[Live App] 找到活跃的直播格式:', pattern.toString());
          return true;
        }
      }

      return false;
    }

    /**
     * 获取直播状态
     */
    get isLiveActive() {
      return this.stateManager.isLiveActive;
    }

    /**
     * 结束直播
     */
    async endLive() {
      try {
        console.log('[Watch Live App] 结束观看直播');

        // 设置渲染权为end，允许用户重新选择
        await this.setRenderingRight('end');

        // 停止监听事件
        this.eventListener.stopListening();

        // 转换历史弹幕格式
        await this.convertLiveToHistory();

        // 完全重置状态，确保下次进入时是全新状态
        this.stateManager.endLive();
        this.stateManager.clearAllData(); // 清空所有数据
        this.currentView = 'start';

        // 重置其他状态
        this.isInitialized = false; // 重置初始化状态
        this.lastRenderTime = 0;

        // 清理定时器
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
          this.scrollTimeout = null;
        }
        if (this.typingTimer) {
          clearInterval(this.typingTimer);
          this.typingTimer = null;
        }

        // 更新界面
        this.updateAppContent();

        this.showToast('已退出直播间', 'success');
        console.log('[Watch Live App] 已退出直播间，状态已完全重置');
      } catch (error) {
        console.error('[Watch Live App] 退出直播间失败:', error);
        this.showToast('退出直播间失败: ' + error.message, 'error');
      }
    }

    /**
     * 继续直播互动
     * @param {string} interaction - 互动内容
     */
    async continueInteraction(interaction) {
      try {
        console.log('[Live App] 继续直播互动:', interaction);

        if (!this.isLiveActive) {
          console.warn('[Live App] 直播未激活，无法继续互动');
          return;
        }

        // 通过手机内部AI生成直播互动内容（不触发ST）
        const message = `用户继续直播，互动为（${interaction}），请按照正确的直播格式要求生成本场人数，直播内容，弹幕，打赏和推荐互动。此次回复内仅生成一次本场人数和直播内容格式，直播内容需要简洁。最后需要生成四条推荐互动。禁止使用错误格式。`;

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播数据并更新状态
        if (result) {
          const liveData = this.dataParser.parseLiveData(result);
          this.stateManager.updateLiveData(liveData);
          console.log('[Watch Live App] AI生成互动数据已解析:', {
            viewerCount: liveData.viewerCount,
            danmakuCount: liveData.danmakuList.length,
            giftCount: liveData.giftList.length,
          });
          this.updateAppContentDebounced();
        }

        console.log('[Watch Live App] 互动消息已生成');
      } catch (error) {
        console.error('[Live App] 继续互动失败:', error);
        this.showToast('发送互动失败: ' + error.message, 'error');
      }
    }

    /**
     * 解析新的直播数据
     */
    async parseNewLiveData() {
      try {
        console.log('[Live App] 开始解析新的直播数据');

        // 获取聊天内容
        const chatContent = this.dataParser.getChatContent();
        if (!chatContent) {
          console.warn('[Live App] 无法获取聊天内容');
          return;
        }

        // 双通道：在更新前记录现有弹幕签名，用于识别"真正新增"
        const existingDanmakuSigs = new Set(
          (this.stateManager.danmakuList || []).map(item => this.createDanmakuSignature(item)),
        );

        // 单独解析"最新楼层"的内容（仅用于决定动画）
        const latestFloorText = this.getLatestFloorTextSafe();
        let latestNewDanmaku = [];
        let latestNewGifts = [];
        if (latestFloorText) {
          const { danmakuList: latestDanmakuList, giftList: latestGiftList } =
            this.dataParser.parseAllDanmaku(latestFloorText);
          latestNewDanmaku = latestDanmakuList || [];
          latestNewGifts = latestGiftList || [];
        }

        // 解析直播数据
        const liveData = this.dataParser.parseLiveData(chatContent);
        console.log('[Live App] 解析到的直播数据:', {
          viewerCount: liveData.viewerCount,
          liveContent: liveData.liveContent ? liveData.liveContent.substring(0, 50) + '...' : '',
          danmakuCount: liveData.danmakuList.length,
          giftCount: liveData.giftList.length,
          interactionCount: liveData.recommendedInteractions.length,
        });

        // 更新状态
        this.stateManager.updateLiveData(liveData);

        // 计算需要动画显示的"新增弹幕/礼物"（仅来自最新楼层）
        if (latestNewDanmaku.length > 0) {
          latestNewDanmaku.forEach(item => {
            const sig = this.createDanmakuSignature(item);
            if (!existingDanmakuSigs.has(sig)) {
              this.pendingAppearDanmakuSigs.add(sig);
            }
          });
        }

        if (latestNewGifts.length > 0) {
          const existingGiftSigs = new Set(
            (this.stateManager.giftList || []).map(item => this.createGiftSignature(item)),
          );
          latestNewGifts.forEach(item => {
            const sig = this.createGiftSignature(item);
            if (!existingGiftSigs.has(sig)) {
              this.pendingAppearGiftSigs.add(sig);
            }
          });
        }

        // 更新界面（带防抖）
        this.updateAppContentDebounced();

        // 若有新的弹幕，刷新后进行一次"必要时跳底"
        setTimeout(() => {
          // 先处理需要动画的节点为隐藏状态，避免定位到空白
          this.runAppearSequence();
          const danmakuContainer = document.getElementById('danmaku-container');
          if (danmakuContainer) {
            this.jumpToBottomIfNeeded(danmakuContainer);
          }
        }, 30);
      } catch (error) {
        console.error('[Live App] 解析直播数据失败:', error);
      }
    }

    /**
     * 防抖更新界面内容
     */
    updateAppContentDebounced() {
      const currentTime = Date.now();
      if (currentTime - this.lastRenderTime < this.renderCooldown) {
        return;
      }

      this.lastRenderTime = currentTime;
      this.updateAppContent();
      this.updateHeader(); // 同时更新header
    }

    /**
     * 更新应用内容
     */
    updateAppContent() {
      const content = this.getAppContent();
      const appElement = document.getElementById('app-content');
      if (appElement) {
        appElement.innerHTML = content;
        // 延迟绑定事件，确保DOM已更新
        setTimeout(() => {
          this.bindEvents();
          this.updateHeader(); // 确保header也被更新
          // 渲染后启动直播内容打字机效果
          if (this.currentView === 'live') {
            const state = this.stateManager.getCurrentState();
            const liveContentEl = document.querySelector('.live-content-text');
            if (liveContentEl) {
              this.applyTypingEffect(liveContentEl, state.liveContent || '');
            }
            // 渲染后尝试触发逐条出现动画（避免丢帧）
            this.runAppearSequence();
          }
        }, 50);
      }
    }

    /**
     * 获取应用内容
     */
    getAppContent() {
      switch (this.currentView) {
        case 'start':
          return this.renderStartView();
        case 'list':
          return this.renderListView();
        case 'live':
          return this.renderLiveView();
        default:
          return this.renderStartView();
      }
    }

    /**
     * 渲染观看直播界面
     */
    renderStartView() {
      return `
        <div class="live-app">
          <div class="watch-live-container">
            <div class="watch-live-header">
              <h2>观看直播</h2>
              <p>选择一种方式开始观看直播吧！</p>
            </div>

            <div class="watch-options">
              <button class="watch-option-btn" id="current-live-list">
                <div class="option-icon">📺</div>
                <div class="option-title">当前开播列表</div>
                <div class="option-desc">查看正在直播的主播</div>
              </button>

              <button class="watch-option-btn" id="specific-live-room">
                <div class="option-icon">🔍</div>
                <div class="option-title">进入指定直播间</div>
                <div class="option-desc">输入主播名称观看</div>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * 渲染直播间列表界面
     */
    renderListView() {
      // 解析直播间列表数据（无论是否在等待，都先解析现有数据）
      const liveRooms = this.parseLiveRoomList();

      const roomsHtml = liveRooms
        .map(
          room => `
        <div class="live-room-item">
          <div class="room-info">
            <div class="room-name">${room.name}</div>
            <div class="room-details">
              <span class="streamer-name">主播：${room.streamer}</span>
              <span class="room-category">分类：${room.category}</span>
              <span class="viewer-count">观看：${room.viewers}</span>
            </div>
          </div>
          <button class="watch-room-btn" data-room='${JSON.stringify(room)}'>观看直播</button>
        </div>
      `,
        )
        .join('');

      // 构建列表内容
      let listContent = '';

      // 如果有现有直播间，显示它们
      if (roomsHtml) {
        listContent = roomsHtml;
      }

      // 如果正在等待新的直播间列表，添加加载提示
      if (this.isWaitingForLiveList) {
        const loadingHtml = `
          <div class="live-loading-update">
            <div class="loading-spinner"></div>
            <span>正在获取更多直播间...</span>
          </div>
        `;
        listContent = listContent ? listContent + loadingHtml : '<div class="live-loading">正在获取直播间列表...</div>';
      } else if (!roomsHtml) {
        // 如果没有现有数据且不在等待，显示无数据提示
        listContent = '<div class="no-rooms">暂无直播间数据，请稍后再试</div>';
      }

      return `
        <div class="live-app">
          <div class="live-list-container">
            <div class="live-list-header">
              <button class="back-btn" id="back-to-watch-options">← 返回</button>
              <h2>当前开播列表</h2>
            </div>

            <div class="live-rooms-list">
              ${listContent}
            </div>
          </div>
        </div>
      `;
    }

    /**
     * 渲染直播中界面
     */
    renderLiveView() {
      const state = this.stateManager.getCurrentState();

      // 渲染推荐互动按钮
      const recommendedButtons = state.recommendedInteractions
        .map(interaction => `<button class="rec-btn" data-interaction="${interaction}">${interaction}</button>`)
        .join('');

      // 渲染弹幕列表
      const danmakuItems = state.danmakuList
        .map(danmaku => {
          const sig = this.createDanmakuSignature(danmaku);
          const needAppearClass = this.pendingAppearDanmakuSigs.has(sig) ? ' need-appear' : '';
          if (danmaku.type === 'gift') {
            return `
            <div class="danmaku-item gift${needAppearClass}" data-sig="${sig}">
              <i class="fas fa-gift"></i>
              <span class="username">${danmaku.username}</span>
              <span class="content">送出 ${danmaku.content}</span>
            </div>
          `;
          } else {
            return `
            <div class="danmaku-item normal${needAppearClass}" data-sig="${sig}">
              <span class="username">${danmaku.username}:</span>
              <span class="content">${danmaku.content}</span>
            </div>
          `;
          }
        })
        .join('');

      return `
        <div class="live-app">
          <div class="live-container">
            <!-- 视频框 -->
            <div class="video-placeholder">
              <p class="live-content-text">${state.liveContent || '等待直播内容...'}</p>
              <div class="live-status-bottom">
                <div class="live-dot"></div>
                <span>LIVE</span>
              </div>
            </div>

            <!-- 观看直播互动 -->
            <div class="interaction-panel">
              <div class="interaction-header">
                <h4>推荐弹幕：</h4>
                <div class="watch-actions">
                  <button class="interact-btn" id="send-danmaku-btn">
                    <i class="fas fa-comment"></i> 发送弹幕
                  </button>
                  <button class="interact-btn" id="send-gift-btn">
                    <i class="fas fa-gift"></i> 打赏礼物
                  </button>
                </div>
              </div>
              <div class="recommended-interactions">
                ${recommendedButtons || '<p class="no-interactions">等待推荐弹幕...</p>'}
              </div>
            </div>

            <!-- 弹幕容器 -->
            <div class="danmaku-container" id="danmaku-container">
              <div class="danmaku-list" id="danmaku-list">
                ${danmakuItems || '<div class="no-danmaku">等待弹幕...</div>'}
              </div>
            </div>
          </div>

          <!-- 发送弹幕弹窗 -->
          <div id="danmaku-modal" class="modal">
            <div class="modal-content">
              <div class="modal-header">
                <h3>发送弹幕</h3>
                <button class="modal-close-btn">&times;</button>
              </div>
              <form id="danmaku-form">
                <textarea id="custom-danmaku-textarea" placeholder="输入弹幕内容..." rows="4"></textarea>
                <button type="submit" class="submit-btn">发送弹幕</button>
              </form>
            </div>
          </div>

          <!-- 打赏礼物弹窗 -->
          <div id="gift-send-modal" class="modal">
            <div class="gift-modal-container">
              <div class="gift-modal-header">
                <div class="gift-modal-title">✨ 打赏礼物</div>
                <button class="gift-modal-close" onclick="watchLiveAppHideModal('gift-send-modal')">&times;</button>
              </div>

              <div class="gift-modal-body">
                <div class="gift-list-container">
                    <!-- 所有礼物按价格排序，单列显示 -->
                    <div class="gift-card" data-gift="应援话筒" data-price="1">
                      <div class="gift-icon">🎤</div>
                      <div class="gift-info">
                        <div class="gift-name">应援话筒</div>
                        <div class="gift-price">¥1</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="应援灯牌" data-price="3">
                      <div class="gift-icon">💡</div>
                      <div class="gift-info">
                        <div class="gift-name">应援灯牌</div>
                        <div class="gift-price">¥3</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="比个心" data-price="5">
                      <div class="gift-icon">💖</div>
                      <div class="gift-info">
                        <div class="gift-name">比个心</div>
                        <div class="gift-price">¥5</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="入场券" data-price="6">
                      <div class="gift-icon">🎟️</div>
                      <div class="gift-info">
                        <div class="gift-name">入场券</div>
                        <div class="gift-price">¥6</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="小金人" data-price="9">
                      <div class="gift-icon">🏆</div>
                      <div class="gift-info">
                        <div class="gift-name">小金人</div>
                        <div class="gift-price">¥9</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="庆功花束" data-price="18">
                      <div class="gift-icon">💐</div>
                      <div class="gift-info">
                        <div class="gift-name">庆功花束</div>
                        <div class="gift-price">¥18</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="秘密情书" data-price="28">
                      <div class="gift-icon">💌</div>
                      <div class="gift-info">
                        <div class="gift-name">秘密情书</div>
                        <div class="gift-price">¥28</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift=""卡！"" data-price="38">
                      <div class="gift-icon">🎬</div>
                      <div class="gift-info">
                        <div class="gift-name">"卡！"</div>
                        <div class="gift-price">¥38</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="闪耀星星" data-price="58">
                      <div class="gift-icon">🌟</div>
                      <div class="gift-info">
                        <div class="gift-name">闪耀星星</div>
                        <div class="gift-price">¥58</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="璀璨钻石" data-price="88">
                      <div class="gift-icon">💎</div>
                      <div class="gift-info">
                        <div class="gift-name">璀璨钻石</div>
                        <div class="gift-price">¥88</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="红毯口红" data-price="128">
                      <div class="gift-icon">💄</div>
                      <div class="gift-info">
                        <div class="gift-name">红毯口红</div>
                        <div class="gift-price">¥128</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="加冕皇冠" data-price="188">
                      <div class="gift-icon">👑</div>
                      <div class="gift-info">
                        <div class="gift-name">加冕皇冠</div>
                        <div class="gift-price">¥188</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift=""菲林"" data-price="288">
                      <div class="gift-icon">📸</div>
                      <div class="gift-info">
                        <div class="gift-name">"菲林"</div>
                        <div class="gift-price">¥288</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="白金唱片" data-price="388">
                      <div class="gift-icon">🎶</div>
                      <div class="gift-info">
                        <div class="gift-name">白金唱片</div>
                        <div class="gift-price">¥388</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="庆功香槟" data-price="488">
                      <div class="gift-icon">🥂</div>
                      <div class="gift-info">
                        <div class="gift-name">庆功香槟</div>
                        <div class="gift-price">¥488</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="巨星墨镜" data-price="588">
                      <div class="gift-icon">🕶️</div>
                      <div class="gift-info">
                        <div class="gift-name">巨星墨镜</div>
                        <div class="gift-price">¥588</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="人气喷射器" data-price="666">
                      <div class="gift-icon">🚀</div>
                      <div class="gift-info">
                        <div class="gift-name">人气喷射器</div>
                        <div class="gift-price">¥666</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="星际飞船" data-price="888">
                      <div class="gift-icon">🚁</div>
                      <div class="gift-info">
                        <div class="gift-name">星际飞船</div>
                        <div class="gift-price">¥888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="星光大道" data-price="999">
                      <div class="gift-icon">📢</div>
                      <div class="gift-info">
                        <div class="gift-name">星光大道</div>
                        <div class="gift-price">¥999</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="神谕剧本" data-price="1288">
                      <div class="gift-icon">📜</div>
                      <div class="gift-info">
                        <div class="gift-name">神谕剧本</div>
                        <div class="gift-price">¥1288</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="天空之城" data-price="1888">
                      <div class="gift-icon">🏰</div>
                      <div class="gift-info">
                        <div class="gift-name">天空之城</div>
                        <div class="gift-price">¥1888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="光速超跑" data-price="2888">
                      <div class="gift-icon">🏎️</div>
                      <div class="gift-info">
                        <div class="gift-name">光速超跑</div>
                        <div class="gift-price">¥2888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="宇宙巡回" data-price="3888">
                      <div class="gift-icon">🌍</div>
                      <div class="gift-info">
                        <div class="gift-name">宇宙巡回</div>
                        <div class="gift-price">¥3888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="梦幻游轮" data-price="4888">
                      <div class="gift-icon">🛳️</div>
                      <div class="gift-info">
                        <div class="gift-name">梦幻游轮</div>
                        <div class="gift-price">¥4888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="星河舰队" data-price="5888">
                      <div class="gift-icon">🌌</div>
                      <div class="gift-info">
                        <div class="gift-name">星河舰队</div>
                        <div class="gift-price">¥5888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="专属星球" data-price="6888">
                      <div class="gift-icon">🪐</div>
                      <div class="gift-info">
                        <div class="gift-name">专属星球</div>
                        <div class="gift-price">¥6888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="奇迹工厂" data-price="7888">
                      <div class="gift-icon">✨</div>
                      <div class="gift-info">
                        <div class="gift-name">奇迹工厂</div>
                        <div class="gift-price">¥7888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="永恒之星" data-price="8888">
                      <div class="gift-icon">🌠</div>
                      <div class="gift-info">
                        <div class="gift-name">永恒之星</div>
                        <div class="gift-price">¥8888</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="星辰主宰" data-price="9999">
                      <div class="gift-icon">🔱</div>
                      <div class="gift-info">
                        <div class="gift-name">星辰主宰</div>
                        <div class="gift-price">¥9999</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                    <div class="gift-card" data-gift="以你为名" data-price="10000">
                      <div class="gift-icon">🔭</div>
                      <div class="gift-info">
                        <div class="gift-name">以你为名</div>
                        <div class="gift-price">¥10000</div>
                      </div>
                      <div class="gift-controls">
                        <button class="qty-btn minus">-</button>
                        <input type="number" class="qty-input" value="0" min="0" max="999">
                        <button class="qty-btn plus">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="gift-message-section">
                  <div class="message-label">💬 打赏留言</div>
                  <textarea id="gift-message-input" placeholder="说点什么吧..."></textarea>
                </div>

                <div class="gift-summary">
                  <div class="total-amount">
                    <span class="amount-label">总金额</span>
                    <span class="amount-value">¥<span id="gift-total-amount">0</span></span>
                  </div>
                  <button class="send-gift-btn" id="confirm-send-gift">
                    <span class="btn-icon">🎁</span>
                    <span class="btn-text">送礼</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 礼物流水弹窗 -->
          <div id="gift-modal" class="modal">
            <div class="modal-content">
              <div class="modal-header">
                <h3>礼物流水</h3>
                <button class="modal-close-btn">&times;</button>
              </div>
              <ul class="gift-list">
                ${
                  state.giftList
                    .map(gift => {
                      const gsig = this.createGiftSignature(gift);
                      const needAppearClass = this.pendingAppearGiftSigs.has(gsig) ? ' need-appear' : '';
                      return `<li class="${needAppearClass.trim()}" data-sig="${gsig}"><span class="username">${
                        gift.username
                      }</span>送出 <span class="gift-name">${gift.gift}</span></li>`;
                    })
                    .join('') || '<li class="no-gifts">暂无礼物</li>'
                }
              </ul>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * 绑定事件
     */
    bindEvents() {
      console.log('[Live App] 绑定事件...');

      const appContainer = document.getElementById('app-content');
      if (!appContainer) {
        console.error('[Live App] 应用容器未找到');
        return;
      }

      try {
        // 观看直播相关事件
        if (this.currentView === 'start') {
          // 当前开播列表按钮
          const currentLiveListBtn = appContainer.querySelector('#current-live-list');
          if (currentLiveListBtn) {
            currentLiveListBtn.addEventListener('click', () => {
              this.requestCurrentLiveList();
            });
          }

          // 进入指定直播间按钮
          const specificLiveRoomBtn = appContainer.querySelector('#specific-live-room');
          if (specificLiveRoomBtn) {
            specificLiveRoomBtn.addEventListener('click', () => {
              this.showSpecificLiveRoomModal();
            });
          }
        }

        // 直播间列表相关事件
        if (this.currentView === 'list') {
          // 返回按钮
          const backBtn = appContainer.querySelector('#back-to-watch-options');
          if (backBtn) {
            backBtn.addEventListener('click', () => {
              // 停止监听并重置状态
              this.eventListener.stopListening();
              this.isWaitingForLiveList = false;
              this.currentView = 'start';
              this.updateAppContent();
            });
          }

          // 观看直播间按钮
          appContainer.querySelectorAll('.watch-room-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const roomData = JSON.parse(btn.dataset.room);
              this.watchSelectedRoom(roomData);
            });
          });
        }

        // 直播中相关事件
        if (this.currentView === 'live') {
          // 推荐弹幕按钮
          appContainer.querySelectorAll('.rec-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const danmaku = btn.dataset.interaction;
              if (danmaku) {
                this.sendDanmaku(danmaku);
              }
            });
          });

          // 发送弹幕按钮
          const sendDanmakuBtn = appContainer.querySelector('#send-danmaku-btn');
          if (sendDanmakuBtn) {
            sendDanmakuBtn.addEventListener('click', () => {
              this.showModal('danmaku-modal');
            });
          }

          // 打赏礼物按钮
          const sendGiftBtn = appContainer.querySelector('#send-gift-btn');
          if (sendGiftBtn) {
            sendGiftBtn.addEventListener('click', () => {
              this.showModal('gift-send-modal');
              this.initGiftModal();
            });
          }

          // 发送弹幕表单
          const danmakuForm = appContainer.querySelector('#danmaku-form');
          if (danmakuForm) {
            danmakuForm.addEventListener('submit', e => {
              e.preventDefault();
              const textarea = appContainer.querySelector('#custom-danmaku-textarea');
              const danmaku = textarea ? textarea.value.trim() : '';
              if (danmaku) {
                this.sendCustomDanmaku(danmaku);
                textarea.value = '';
                this.hideAllModals();
              } else {
                this.showToast('请输入弹幕内容', 'warning');
              }
            });
          }

          // 打赏礼物表单
          const giftSubmitBtn = appContainer.querySelector('#confirm-send-gift');
          if (giftSubmitBtn) {
            giftSubmitBtn.addEventListener('click', () => {
              this.sendGifts();
            });
          }

          // 弹窗关闭按钮
          appContainer.querySelectorAll('.modal-close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              this.hideAllModals();
            });
          });

          // 点击弹窗背景关闭
          appContainer.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', e => {
              if (e.target === modal) {
                this.hideAllModals();
              }
            });
          });

          // 自动"跳转"弹幕到底部（瞬时、仅在未在底部时触发）
          const danmakuContainer = appContainer.querySelector('#danmaku-container');
          if (danmakuContainer) {
            this.jumpToBottomIfNeeded(danmakuContainer);
          }
        }

        console.log('[Live App] 事件绑定完成');
      } catch (error) {
        console.error('[Live App] 绑定事件时发生错误:', error);
        this.showToast('事件绑定失败: ' + error.message, 'error');
      }
    }

    // 若接近底部则保持不动；若不在底部则瞬时跳到底部
    jumpToBottomIfNeeded(container) {
      const threshold = 10; // px判定阈值
      const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
      if (distanceToBottom > threshold) {
        // 瞬间跳转，无动画
        container.scrollTop = container.scrollHeight;
      }
    }

    /**
     * 请求当前开播列表
     */
    async requestCurrentLiveList() {
      try {
        console.log('[Watch Live App] 请求当前开播列表...');

        // 先切换到列表视图
        this.currentView = 'list';
        this.isWaitingForLiveList = false; // 先设为false，立即解析现有内容

        // 立即解析并渲染现有的直播间列表
        console.log('[Watch Live App] 立即解析现有直播间列表...');
        this.updateAppContent();

        // 检查是否已有直播间数据
        const existingRooms = this.parseLiveRoomList();
        if (existingRooms.length > 0) {
          console.log(`[Watch Live App] 找到 ${existingRooms.length} 个现有直播间，已立即渲染`);
        } else {
          console.log('[Watch Live App] 没有找到现有直播间数据');
        }

        // 然后通过手机内部AI获取新的直播间列表（不触发ST）
        const message =
          '用户希望观看直播，请按照正确格式生成5-10个当前可能正在开播的直播间，每个直播间的格式为[直播|直播间名称|主播用户名|直播类别|观看人数]。主播可能是角色，NPC或者是无关路人。每个直播间格式之间需要正确换行';

        // 设置等待状态
        this.isWaitingForLiveList = true;

        // 开始监听AI回复
        this.eventListener.startListening();

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播间列表
        if (result) {
          const liveRoomRegex = /\[直播\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\]/g;
          const rooms = [];
          let match;
          while ((match = liveRoomRegex.exec(result)) !== null) {
            const roomData = {
              name: match[1].trim(),
              streamer: match[2].trim(),
              category: match[3].trim(),
              viewers: match[4].trim(),
            };
            if (roomData.name && roomData.streamer && roomData.category && roomData.viewers) {
              rooms.push(roomData);
            }
          }
          if (rooms.length > 0) {
            console.log(`[Watch Live App] AI生成直播间列表成功，共 ${rooms.length} 个`);
            this.updateAppContent();
          }
        }

        this.isWaitingForLiveList = false;
        console.log('[Watch Live App] 已获取开播列表...');
      } catch (error) {
        console.error('[Watch Live App] 请求开播列表失败:', error);
        this.showToast('请求开播列表失败: ' + error.message, 'error');
        this.isWaitingForLiveList = false;
      }
    }

    /**
     * 显示指定直播间弹窗
     */
    showSpecificLiveRoomModal() {
      // 创建弹窗HTML
      const modalHtml = `
        <div class="modal-overlay" id="specific-live-modal" style="display: flex;">
          <div class="modal-content">
            <div class="modal-header">
              <h3>进入指定直播间</h3>
              <button class="modal-close" onclick="watchLiveAppHideModal('specific-live-modal')">&times;</button>
            </div>
            <div class="modal-body">
              <div class="input-section">
                <label for="streamer-name-input">请输入想要观看的主播名称：</label>
                <input type="text" id="streamer-name-input" placeholder="输入主播名称..." />
              </div>
              <button class="watch-live-btn" id="watch-specific-live">观看直播</button>
            </div>
          </div>
        </div>
      `;

      // 添加到页面
      const appContainer = document.getElementById('app-content');
      if (appContainer) {
        appContainer.insertAdjacentHTML('beforeend', modalHtml);

        // 绑定观看直播按钮事件
        const watchBtn = document.getElementById('watch-specific-live');
        if (watchBtn) {
          watchBtn.addEventListener('click', () => {
            const input = document.getElementById('streamer-name-input');
            const streamerName = input ? input.value.trim() : '';
            if (streamerName) {
              this.watchSpecificLive(streamerName);
            } else {
              this.showToast('请输入主播名称', 'warning');
            }
          });
        }
      }
    }

    /**
     * 观看指定直播
     */
    async watchSpecificLive(streamerName) {
      try {
        console.log('[Watch Live App] 观看指定直播:', streamerName);

        // 设置渲染权为watch
        await this.setRenderingRight('watch');

        const message = `用户选择观看${streamerName}的直播，请按照正确的直播格式要求生成本场人数，直播内容，弹幕，打赏和推荐互动。此次回复内仅生成一次本场人数和直播内容格式，直播内容需要简洁。最后需要生成四条推荐互动。禁止使用错误格式。当前用户正在观看直播，推荐互动需要是用户可能会发送的弹幕。`;

        // 隐藏弹窗
        this.hideModal('specific-live-modal');

        // 切换到直播间视图
        this.currentView = 'live';
        this.stateManager.startLive();
        this.eventListener.startListening();

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播数据并更新状态
        if (result) {
          const liveData = this.dataParser.parseLiveData(result);
          this.stateManager.updateLiveData(liveData);
          console.log('[Watch Live App] AI生成直播数据已解析:', {
            viewerCount: liveData.viewerCount,
            danmakuCount: liveData.danmakuList.length,
          });
        }

        this.updateAppContent();

        console.log('[Watch Live App] 已进入指定直播间');
      } catch (error) {
        console.error('[Watch Live App] 观看指定直播失败:', error);
        this.showToast('进入直播间失败: ' + error.message, 'error');
      }
    }

    /**
     * 解析直播间列表数据
     * 参考live-app的解析方式，支持解析多个直播间格式
     */
    parseLiveRoomList() {
      try {
        // 获取最新的聊天内容
        const chatContent = this.dataParser.getChatContent();
        if (!chatContent) {
          console.log('[Watch Live App] 没有聊天内容可解析');
          return [];
        }

        console.log('[Watch Live App] 开始解析直播间列表，内容长度:', chatContent.length);

        // 匹配直播间格式：[直播|直播间名称|主播用户名|直播类别|观看人数]
        // 使用更严格的正则表达式，确保正确匹配
        const liveRoomRegex = /\[直播\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\]/g;
        const rooms = [];
        let match;
        let matchCount = 0;

        // 重置正则表达式的lastIndex
        liveRoomRegex.lastIndex = 0;

        while ((match = liveRoomRegex.exec(chatContent)) !== null) {
          matchCount++;
          const roomData = {
            name: match[1].trim(),
            streamer: match[2].trim(),
            category: match[3].trim(),
            viewers: match[4].trim(),
          };

          // 验证数据有效性
          if (roomData.name && roomData.streamer && roomData.category && roomData.viewers) {
            rooms.push(roomData);
            console.log(`[Watch Live App] 解析到直播间 ${matchCount}:`, roomData);
          } else {
            console.warn('[Watch Live App] 跳过无效的直播间数据:', roomData);
          }

          // 防止无限循环
          if (matchCount > 50) {
            console.warn('[Watch Live App] 达到最大解析数量限制，停止解析');
            break;
          }
        }

        console.log(`[Watch Live App] 解析完成，共找到 ${rooms.length} 个有效直播间`);
        return rooms;
      } catch (error) {
        console.error('[Watch Live App] 解析直播间列表失败:', error);
        return [];
      }
    }

    /**
     * 观看选中的直播间
     */
    async watchSelectedRoom(roomData) {
      try {
        console.log('[Watch Live App] 观看选中的直播间:', roomData);

        // 设置渲染权为watch
        await this.setRenderingRight('watch');

        const message = `用户选择观看直播：直播间名称：${roomData.name}，主播用户名：${roomData.streamer}，直播类别：${roomData.category}，本次观看人数：${roomData.viewers}。请按照正确的直播格式要求生成本场人数，直播内容，弹幕，打赏和推荐互动。此次回复内仅生成一次本场人数和直播内容格式，直播内容需要简洁，当前直播可以是刚开播或者已经直播一段时间了。最后需要生成四条推荐互动。禁止使用错误格式。当前用户正在观看直播，推荐互动需要是用户可能会发送的弹幕。`;

        // 切换到直播间视图
        this.currentView = 'live';
        this.stateManager.startLive();
        this.eventListener.startListening();

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播数据并更新状态
        if (result) {
          const liveData = this.dataParser.parseLiveData(result);
          this.stateManager.updateLiveData(liveData);
          console.log('[Watch Live App] AI生成直播数据已解析:', {
            viewerCount: liveData.viewerCount,
            danmakuCount: liveData.danmakuList.length,
          });
        }

        this.updateAppContent();

        console.log('[Watch Live App] 已进入选中的直播间');
      } catch (error) {
        console.error('[Watch Live App] 观看选中直播间失败:', error);
        this.showToast('进入直播间失败: ' + error.message, 'error');
      }
    }

    /**
     * 发送推荐弹幕
     */
    async sendDanmaku(danmaku) {
      try {
        console.log('[Watch Live App] 发送推荐弹幕:', danmaku);

        const message = `用户正在观看直播，并发送弹幕"${danmaku}"，请勿重复或替用户发送弹幕。请按照正确的直播格式要求生成本场人数，直播内容，其余弹幕，打赏和推荐互动。此次回复内仅生成一次本场人数和直播内容格式，直播内容需要简洁。最后需要生成四条推荐互动，内容为用户可能会发送的弹幕。禁止使用错误格式。
[直播|{{user}}|弹幕|${danmaku}]`;

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播数据并更新状态
        if (result) {
          const liveData = this.dataParser.parseLiveData(result);
          this.stateManager.updateLiveData(liveData);
          this.updateAppContentDebounced();
        }

        console.log('[Watch Live App] 推荐弹幕已生成');
      } catch (error) {
        console.error('[Watch Live App] 发送推荐弹幕失败:', error);
        this.showToast('发送弹幕失败: ' + error.message, 'error');
      }
    }

    /**
     * 发送自定义弹幕
     */
    async sendCustomDanmaku(danmaku) {
      try {
        console.log('[Watch Live App] 发送自定义弹幕:', danmaku);

        const message = `用户正在观看直播，并发送弹幕"${danmaku}"，请勿重复或替用户发送弹幕。请按照正确的直播格式要求生成本场人数，直播内容，其余弹幕，打赏和推荐互动。此次回复内仅生成一次本场人数和直播内容格式，直播内容需要简洁。最后需要生成四条推荐互动，内容为用户可能会发送的弹幕。禁止使用错误格式。
[直播|{{user}}|弹幕|${danmaku}]`;

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播数据并更新状态
        if (result) {
          const liveData = this.dataParser.parseLiveData(result);
          this.stateManager.updateLiveData(liveData);
          this.updateAppContentDebounced();
        }

        console.log('[Watch Live App] 自定义弹幕已生成');
      } catch (error) {
        console.error('[Watch Live App] 发送自定义弹幕失败:', error);
        this.showToast('发送弹幕失败: ' + error.message, 'error');
      }
    }

    /**
     * 初始化礼物弹窗
     */
    initGiftModal() {
      // 绑定礼物数量调整按钮
      const giftCards = document.querySelectorAll('.gift-card');
      giftCards.forEach(card => {
        const minusBtn = card.querySelector('.qty-btn.minus');
        const plusBtn = card.querySelector('.qty-btn.plus');
        const quantityInput = card.querySelector('.qty-input');

        if (minusBtn && plusBtn && quantityInput) {
          minusBtn.addEventListener('click', () => {
            let quantity = parseInt(quantityInput.value) || 0;
            if (quantity > 0) {
              quantity--;
              quantityInput.value = quantity;
              this.updateGiftTotal();
              this.updateGiftCardState(card, quantity);
            }
          });

          plusBtn.addEventListener('click', () => {
            let quantity = parseInt(quantityInput.value) || 0;
            quantity++;
            quantityInput.value = quantity;
            this.updateGiftTotal();
            this.updateGiftCardState(card, quantity);
          });

          // 监听输入框变化
          quantityInput.addEventListener('input', () => {
            let quantity = parseInt(quantityInput.value) || 0;
            if (quantity < 0) {
              quantity = 0;
              quantityInput.value = quantity;
            }
            if (quantity > 999) {
              quantity = 999;
              quantityInput.value = quantity;
            }
            this.updateGiftTotal();
            this.updateGiftCardState(card, quantity);
          });
        }
      });

      // 初始化总金额
      this.updateGiftTotal();
    }

    /**
     * 更新礼物卡片状态
     */
    updateGiftCardState(card, quantity) {
      if (quantity > 0) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    }

    /**
     * 更新礼物总金额
     */
    updateGiftTotal() {
      let total = 0;
      const giftCards = document.querySelectorAll('.gift-card');

      giftCards.forEach(card => {
        const quantity = parseInt(card.querySelector('.qty-input').value) || 0;
        const price = parseInt(card.dataset.price);
        total += quantity * price;
      });

      const totalAmountSpan = document.getElementById('gift-total-amount');
      if (totalAmountSpan) {
        totalAmountSpan.textContent = total;
      }
    }

    /**
     * 发送礼物
     */
    async sendGifts() {
      try {
        const selectedGifts = [];
        const giftCards = document.querySelectorAll('.gift-card');

        giftCards.forEach(card => {
          const quantity = parseInt(card.querySelector('.qty-input').value) || 0;
          if (quantity > 0) {
            const giftName = card.dataset.gift;
            const price = parseInt(card.dataset.price);
            selectedGifts.push({
              name: giftName,
              quantity: quantity,
              price: price,
              total: quantity * price,
            });
          }
        });

        if (selectedGifts.length === 0) {
          this.showToast('请选择要打赏的礼物', 'warning');
          return;
        }

        const totalAmount = selectedGifts.reduce((sum, gift) => sum + gift.total, 0);
        const giftMessage = document.getElementById('gift-message-input')?.value.trim() || '';

        console.log('[Watch Live App] 发送礼物:', selectedGifts);

        // 构建礼物描述
        const giftDescriptions = selectedGifts
          .map(gift => (gift.quantity === 1 ? gift.name : `${gift.name}*${gift.quantity}`))
          .join('，');

        // 构建消息
        let message = `用户正在观看直播，并打赏礼物"${giftDescriptions}"，花费"${totalAmount}元"`;
        if (giftMessage) {
          message += `，用户打赏留言为"${giftMessage}"`;
        }
        message += `，请勿重复或替用户发送弹幕。请按照正确的直播格式要求生成本场人数，直播内容，其余弹幕，打赏和推荐互动。此次回复内仅生成一次本场人数和直播内容格式，直播内容需要简洁。最后需要生成四条推荐互动，内容为用户可能会发送的弹幕。禁止使用错误格式。
`;

        // 添加打赏格式 - 每种礼物一条记录
        selectedGifts.forEach(gift => {
          const giftFormat = gift.quantity === 1 ? gift.name : `${gift.name}*${gift.quantity}`;
          message += `[直播|{{user}}|打赏|${giftFormat}]\n`;
        });

        // 如果有留言，添加弹幕格式
        if (giftMessage) {
          message += `[直播|{{user}}|弹幕|${giftMessage}]`;
        }

        const result = await this.generateViaPhoneAI(message);

        // 解析AI生成的直播数据并更新状态
        if (result) {
          const liveData = this.dataParser.parseLiveData(result);
          this.stateManager.updateLiveData(liveData);
          this.updateAppContentDebounced();
        }

        // 重置礼物选择
        this.resetGiftModal();
        this.hideAllModals();

        console.log('[Watch Live App] 礼物已发送');
        this.showToast('礼物发送成功！', 'success');
      } catch (error) {
        console.error('[Watch Live App] 发送礼物失败:', error);
        this.showToast('发送礼物失败: ' + error.message, 'error');
      }
    }

    /**
     * 重置礼物弹窗
     */
    resetGiftModal() {
      const giftCards = document.querySelectorAll('.gift-card');
      giftCards.forEach(card => {
        const quantityInput = card.querySelector('.qty-input');
        if (quantityInput) {
          quantityInput.value = '0';
        }
        card.classList.remove('selected');
      });

      // 清空留言
      const messageInput = document.getElementById('gift-message-input');
      if (messageInput) {
        messageInput.value = '';
      }

      this.updateGiftTotal();
    }

    /**
     * 显示弹窗
     */
    showModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
      }
    }

    /**
     * 隐藏弹窗
     */
    hideModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
        // 如果是动态创建的弹窗，移除它
        if (modalId === 'specific-live-modal') {
          modal.remove();
        }
      }
    }

    /**
     * 隐藏所有弹窗
     */
    hideAllModals() {
      const modals = document.querySelectorAll('.modal');
      modals.forEach(modal => {
        modal.classList.remove('active');
      });
    }

    /**
     * 设置渲染权
     */
    async setRenderingRight(type) {
      try {
        console.log(`[Watch Live App] 设置渲染权为: ${type}`);

        if (!window.mobileContextEditor) {
          console.warn('[Watch Live App] 上下文编辑器未就绪，无法设置渲染权');
          return false;
        }

        const chatData = window.mobileContextEditor.getCurrentChatData();
        if (!chatData || !chatData.messages || chatData.messages.length === 0) {
          console.warn('[Watch Live App] 无聊天数据，无法设置渲染权');
          return false;
        }

        const firstMessage = chatData.messages[0];
        let originalContent = firstMessage.mes || '';

        // 检查是否已经包含渲染权标记
        const renderingRightRegex = /<!-- LIVE_RENDERING_RIGHT_START -->([\s\S]*?)<!-- LIVE_RENDERING_RIGHT_END -->/;
        const renderingRightSection = `<!-- LIVE_RENDERING_RIGHT_START -->\n[直播渲染权: ${type}]\n<!-- LIVE_RENDERING_RIGHT_END -->`;

        if (renderingRightRegex.test(originalContent)) {
          // 更新现有的渲染权标记
          originalContent = originalContent.replace(renderingRightRegex, renderingRightSection);
        } else {
          // 在内容开头添加渲染权标记
          originalContent = renderingRightSection + '\n\n' + originalContent;
        }

        // 更新第1楼层
        const success = await window.mobileContextEditor.modifyMessage(0, originalContent);
        if (success) {
          console.log(`[Watch Live App] ✅ 渲染权已设置为: ${type}`);
          return true;
        } else {
          console.error('[Watch Live App] 设置渲染权失败');
          return false;
        }
      } catch (error) {
        console.error('[Watch Live App] 设置渲染权时出错:', error);
        return false;
      }
    }

    /**
     * 获取当前渲染权
     */
    getRenderingRight() {
      try {
        if (!window.mobileContextEditor) {
          return null;
        }

        const chatData = window.mobileContextEditor.getCurrentChatData();
        if (!chatData || !chatData.messages || chatData.messages.length === 0) {
          return null;
        }

        const firstMessage = chatData.messages[0];
        const content = firstMessage.mes || '';

        const renderingRightRegex =
          /<!-- LIVE_RENDERING_RIGHT_START -->\s*\[直播渲染权:\s*(\w+)\]\s*<!-- LIVE_RENDERING_RIGHT_END -->/;
        const match = content.match(renderingRightRegex);

        return match ? match[1] : null;
      } catch (error) {
        console.error('[Watch Live App] 获取渲染权时出错:', error);
        return null;
      }
    }

    /**
     * 清除渲染权
     */
    async clearRenderingRight() {
      try {
        console.log('[Watch Live App] 清除渲染权');

        if (!window.mobileContextEditor) {
          console.warn('[Watch Live App] 上下文编辑器未就绪，无法清除渲染权');
          return false;
        }

        const chatData = window.mobileContextEditor.getCurrentChatData();
        if (!chatData || !chatData.messages || chatData.messages.length === 0) {
          console.warn('[Watch Live App] 无聊天数据，无法清除渲染权');
          return false;
        }

        const firstMessage = chatData.messages[0];
        let originalContent = firstMessage.mes || '';

        // 移除渲染权标记
        const renderingRightRegex =
          /<!-- LIVE_RENDERING_RIGHT_START -->([\s\S]*?)<!-- LIVE_RENDERING_RIGHT_END -->\s*\n*/;
        if (renderingRightRegex.test(originalContent)) {
          originalContent = originalContent.replace(renderingRightRegex, '').trim();

          // 更新第1楼层
          const success = await window.mobileContextEditor.modifyMessage(0, originalContent);
          if (success) {
            console.log('[Watch Live App] ✅ 渲染权已清除');
            return true;
          } else {
            console.error('[Watch Live App] 清除渲染权失败');
            return false;
          }
        } else {
          console.log('[Watch Live App] 没有找到渲染权标记');
          return true;
        }
      } catch (error) {
        console.error('[Watch Live App] 清除渲染权时出错:', error);
        return false;
      }
    }

    /**
     * 通过手机内部独立AI生成内容（不触发ST聊天）
     * @param {string} message - 发送给AI的消息/提示词
     * @returns {Promise<string>} AI生成的文本内容
     */
    async generateViaPhoneAI(message) {
      try {
        console.log('[Watch Live App] 通过手机内部AI生成内容...');

        // 方式1: 使用 RoleAPI
        if (window.RoleAPI && typeof window.RoleAPI.isEnabled === 'function' && window.RoleAPI.isEnabled()) {
          console.log('[Watch Live App] 使用 RoleAPI 生成');
          try {
            const response = await window.RoleAPI.sendMessage('__watch_live_app__', 'watch_live_app', message, { silent: true });
            if (response && response.success && response.text) {
              console.log('[Watch Live App] RoleAPI 生成成功，长度:', response.text.length);
              return response.text;
            }
          } catch (e) {
            console.warn('[Watch Live App] RoleAPI 失败:', e.message);
          }
          console.warn('[Watch Live App] RoleAPI 返回无内容，尝试下一个方式');
        }

        // 方式2: 使用 XBBridge.generate（非流式）
        if (window.XBBridge && typeof window.XBBridge.isAvailable === 'function' && window.XBBridge.isAvailable()) {
          console.log('[Watch Live App] 使用 XBBridge.generate 生成');
          const messages = [
            { role: 'user', content: message }
          ];
          const result = await window.XBBridge.generate.generate({
            provider: 'inherit',
            messages: messages,
            max_tokens: 2000,
            temperature: 0.8,
          });
          if (result && result.text) {
            console.log('[Watch Live App] XBBridge 生成成功，长度:', result.text.length);
            return result.text;
          }
          if (result && typeof result === 'string') {
            console.log('[Watch Live App] XBBridge 生成成功（字符串），长度:', result.length);
            return result;
          }
          console.warn('[Watch Live App] XBBridge 返回无内容，尝试下一个方式');
        }

        // 方式3: 使用 mobileCustomAPIConfig
        if (window.mobileCustomAPIConfig && typeof window.mobileCustomAPIConfig.isAPIAvailable === 'function' && window.mobileCustomAPIConfig.isAPIAvailable()) {
          console.log('[Watch Live App] 使用 mobileCustomAPIConfig 生成');
          const messages = [
            { role: 'user', content: message }
          ];
          const response = await window.mobileCustomAPIConfig.callAPI(messages, {
            temperature: 0.8,
            max_tokens: 2000,
          });
          if (response && response.content) {
            console.log('[Watch Live App] mobileCustomAPIConfig 生成成功，长度:', response.content.length);
            return response.content;
          }
          console.warn('[Watch Live App] mobileCustomAPIConfig 返回无内容');
        }

        throw new Error('没有可用的AI生成方式（RoleAPI、XBBridge、mobileCustomAPIConfig 均不可用）');
      } catch (error) {
        console.error('[Watch Live App] 手机内部AI生成失败:', error);
        throw error;
      }
    }

    /**
     * @deprecated 此方法已废弃，不再使用。保留仅用于向后兼容。
     * 发送消息到SillyTavern（保留方法，但直播功能不再调用）
     */
    async _sendToSillyTavernDeprecated(message) {
      try {
        console.log('[Live App] 发送消息到SillyTavern:', message);

        // 尝试找到文本输入框
        const textarea = document.querySelector('#send_textarea');
        if (!textarea) {
          console.error('[Live App] 未找到消息输入框');
          throw new Error('未找到消息输入框');
        }

        // 设置消息内容
        textarea.value = message;
        textarea.focus();

        // 触发输入事件
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        // 触发发送按钮点击
        const sendButton = document.querySelector('#send_but');
        if (sendButton) {
          sendButton.click();
          console.log('[Live App] 已点击发送按钮');
          return true;
        }

        throw new Error('未找到发送按钮');
      } catch (error) {
        console.error('[Live App] 发送消息时出错:', error);
        throw error;
      }
    }

    /**
     * 将直播格式转换为直播历史格式
     */
    async convertLiveToHistory() {
      try {
        console.log('[Watch Live App] 开始转换直播格式为直播历史格式');

        // 获取当前聊天数据
        const contextData = this.getChatData();
        if (!contextData || contextData.length === 0) {
          console.log('[Watch Live App] 没有找到聊天数据');
          return;
        }

        // 查找包含直播内容的消息
        let hasLiveContent = false;
        let updatedCount = 0;
        const messagesToUpdate = []; // 收集需要更新的消息

        // 第一遍：收集所有需要转换的消息
        for (let i = 0; i < contextData.length; i++) {
          const message = contextData[i];
          const content = message.mes || message.content || '';

          if (content.includes('[直播|')) {
            hasLiveContent = true;
            // 转换格式
            const convertedContent = this.convertLiveFormats(content);

            if (convertedContent !== content) {
              messagesToUpdate.push({
                index: i,
                originalContent: content,
                convertedContent: convertedContent
              });
            }
          }
        }

        if (!hasLiveContent) {
          console.log('[Watch Live App] 没有找到需要转换的直播内容');
          return;
        }

        // 第二遍：批量更新消息，减少频繁的DOM操作和保存
        console.log(`[Watch Live App] 开始批量更新 ${messagesToUpdate.length} 条消息`);

        // 临时禁用自动保存机制，避免每次更新都触发保存
        const originalSaveChatDebounced = window.saveChatDebounced;
        const originalSaveChatConditional = window.saveChatConditional;

        // 临时替换为空函数
        if (window.saveChatDebounced) {
          window.saveChatDebounced = () => {};
        }
        if (window.saveChatConditional) {
          window.saveChatConditional = () => Promise.resolve();
        }

        try {
          for (const messageUpdate of messagesToUpdate) {
            // 批量处理时跳过自动保存，避免频繁保存
            const success = await this.updateMessageContent(messageUpdate.index, messageUpdate.convertedContent, true);
            if (success) {
              updatedCount++;
              console.log(
                `[Watch Live App] 已转换消息 ${messageUpdate.index}，原始长度: ${messageUpdate.originalContent.length}，转换后长度: ${messageUpdate.convertedContent.length}`,
              );
            }
          }
        } finally {
          // 恢复原始的保存函数
          if (originalSaveChatDebounced) {
            window.saveChatDebounced = originalSaveChatDebounced;
          }
          if (originalSaveChatConditional) {
            window.saveChatConditional = originalSaveChatConditional;
          }
        }

        console.log(`[Watch Live App] 直播格式转换完成，共更新了 ${updatedCount} 条消息`);

        // 只在最后保存一次聊天数据，避免频繁保存导致卡顿
        if (updatedCount > 0) {
          await this.saveChatData();
          console.log('[Watch Live App] 转换完成并已保存聊天数据');
        }
      } catch (error) {
        console.error('[Watch Live App] 转换直播格式失败:', error);
        this.showToast('转换直播格式失败: ' + error.message, 'error');
      }
    }

    /**
     * 转换直播格式字符串
     */
    convertLiveFormats(content) {
      let convertedContent = content;
      let conversionCount = 0;

      // 转换弹幕格式: [直播|用户|弹幕|内容] -> [直播历史|用户|弹幕|内容]
      const danmuMatches = convertedContent.match(/\[直播\|([^|]+)\|弹幕\|([^\]]+)\]/g);
      if (danmuMatches) {
        convertedContent = convertedContent.replace(/\[直播\|([^|]+)\|弹幕\|([^\]]+)\]/g, '[直播历史|$1|弹幕|$2]');
        conversionCount += danmuMatches.length;
      }

      // 转换礼物格式: [直播|用户|礼物|内容] -> [直播历史|用户|礼物|内容]
      // 转换打赏格式: [直播|用户|打赏|内容] -> [直播历史|用户|打赏|内容]
      const giftMatches = convertedContent.match(/\[直播\|([^|]+)\|(?:礼物|打赏)\|([^\]]+)\]/g);
      if (giftMatches) {
        convertedContent = convertedContent.replace(/\[直播\|([^|]+)\|礼物\|([^\]]+)\]/g, '[直播历史|$1|礼物|$2]');
        convertedContent = convertedContent.replace(/\[直播\|([^|]+)\|打赏\|([^\]]+)\]/g, '[直播历史|$1|打赏|$2]');
        conversionCount += giftMatches.length;
      }

      // 转换推荐互动格式: [直播|推荐互动|内容] -> [直播历史|推荐互动|内容]
      const recommendMatches = convertedContent.match(/\[直播\|推荐互动\|([^\]]+)\]/g);
      if (recommendMatches) {
        convertedContent = convertedContent.replace(/\[直播\|推荐互动\|([^\]]+)\]/g, '[直播历史|推荐互动|$1]');
        conversionCount += recommendMatches.length;
      }

      // 转换本场人数格式: [直播|本场人数|数字] -> [直播历史|本场人数|数字]
      const audienceMatches = convertedContent.match(/\[直播\|本场人数\|([^\]]+)\]/g);
      if (audienceMatches) {
        convertedContent = convertedContent.replace(/\[直播\|本场人数\|([^\]]+)\]/g, '[直播历史|本场人数|$1]');
        conversionCount += audienceMatches.length;
      }

      // 转换直播内容格式: [直播|直播内容|内容] -> [直播历史|直播内容|内容]
      const contentMatches = convertedContent.match(/\[直播\|直播内容\|([^\]]+)\]/g);
      if (contentMatches) {
        convertedContent = convertedContent.replace(/\[直播\|直播内容\|([^\]]+)\]/g, '[直播历史|直播内容|$1]');
        conversionCount += contentMatches.length;
      }

      // 转换其他可能的直播格式 (兼容旧格式)
      const otherMatches = convertedContent.match(/\[直播\|([^|]+)\|([^\]]+)\]/g);
      if (otherMatches) {
        // 排除已经处理过的格式
        const filteredMatches = otherMatches.filter(
          match =>
            !match.includes('弹幕|') &&
            !match.includes('礼物|') &&
            !match.includes('打赏|') &&
            !match.includes('推荐互动|') &&
            !match.includes('本场人数|') &&
            !match.includes('直播内容|'),
        );
        if (filteredMatches.length > 0) {
          convertedContent = convertedContent.replace(/\[直播\|([^|]+)\|([^\]]+)\]/g, (match, p1, p2) => {
            if (
              !match.includes('弹幕|') &&
              !match.includes('礼物|') &&
              !match.includes('打赏|') &&
              !match.includes('推荐互动|') &&
              !match.includes('本场人数|') &&
              !match.includes('直播内容|')
            ) {
              return `[直播历史|${p1}|${p2}]`;
            }
            return match;
          });
          conversionCount += filteredMatches.length;
        }
      }

      // 移除单个消息转换的日志，避免批量处理时重复输出
      // if (conversionCount > 0) {
      //   console.log(`[Watch Live App] 转换了 ${conversionCount} 个直播格式`);
      // }

      return convertedContent;
    }

    /**
     * 更新消息内容
     * @param {number} messageIndex - 消息索引
     * @param {string} newContent - 新内容
     * @param {boolean} skipAutoSave - 是否跳过自动保存（用于批量处理）
     */
    async updateMessageContent(messageIndex, newContent, skipAutoSave = false) {
      try {
        // 简化日志输出，避免批量处理时过多日志
        console.log(`[Watch Live App] 正在更新消息 ${messageIndex}`);

        // 方法1: 使用与getChatData相同的方法获取chat数组（推荐，不会触发自动保存）
        let chat = null;

        // 优先使用SillyTavern.getContext().chat
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && context.chat && Array.isArray(context.chat)) {
            chat = context.chat;
          }
        }

        // 如果上面的方法失败，尝试从全局变量获取
        if (!chat) {
          chat = window['chat'];
        }

        if (chat && Array.isArray(chat)) {
          // 添加边界检查
          if (messageIndex < 0 || messageIndex >= chat.length) {
            console.warn(`[Watch Live App] 消息索引 ${messageIndex} 超出范围，chat数组长度: ${chat.length}`);
            return false;
          }

          if (!chat[messageIndex]) {
            console.warn(`[Watch Live App] 消息索引 ${messageIndex} 处的消息不存在`);
            return false;
          }

          const originalContent = chat[messageIndex].mes || '';
          chat[messageIndex].mes = newContent;

          // 如果消息有swipes，也需要更新
          if (chat[messageIndex].swipes && chat[messageIndex].swipe_id !== undefined) {
            chat[messageIndex].swipes[chat[messageIndex].swipe_id] = newContent;
          }

          // 标记聊天数据已被修改
          if (window.chat_metadata) {
            window.chat_metadata.tainted = true;
          }

          console.log(
            `[Watch Live App] 已更新消息 ${messageIndex}，原内容长度:${originalContent.length}，新内容长度:${newContent.length}`,
          );
          return true;
        }

        // 添加调试信息
        console.warn(`[Watch Live App] 无法访问chat数组，chat类型: ${typeof chat}, 是否为数组: ${Array.isArray(chat)}`);
        if (chat && Array.isArray(chat)) {
          console.warn(`[Watch Live App] chat数组长度: ${chat.length}, 请求的消息索引: ${messageIndex}`);
        }

        // 如果直接方法失败，尝试备用方法（即使在批量处理时也要尝试）
        // 方法2: 尝试通过编辑器功能更新（可能会触发自动保存）
        if (window.mobileContextEditor && window.mobileContextEditor.modifyMessage) {
          try {
            await window.mobileContextEditor.modifyMessage(messageIndex, newContent);
            console.log(`[Watch Live App] 已通过mobileContextEditor更新消息 ${messageIndex}`);
            return true;
          } catch (error) {
            console.warn(`[Watch Live App] mobileContextEditor更新失败:`, error);
          }
        }

        // 方法3: 尝试通过context-editor更新（可能会触发自动保存）
        if (window.contextEditor && window.contextEditor.modifyMessage) {
          try {
            await window.contextEditor.modifyMessage(messageIndex, newContent);
            console.log(`[Watch Live App] 已通过contextEditor更新消息 ${messageIndex}`);
            return true;
          } catch (error) {
            console.warn(`[Watch Live App] contextEditor更新失败:`, error);
          }
        }

        console.warn('[Watch Live App] 没有找到有效的消息更新方法');
        return false;
      } catch (error) {
        console.error('[Watch Live App] 更新消息内容失败:', error);
        return false;
      }
    }

    /**
     * 保存聊天数据
     */
    async saveChatData() {
      try {
        console.log('[Live App] 开始保存聊天数据...');

        // 方法1: 使用SillyTavern的保存函数
        if (typeof window.saveChatConditional === 'function') {
          await window.saveChatConditional();
          console.log('[Live App] 已通过saveChatConditional保存聊天数据');
          return true;
        }

        // 方法2: 使用延迟保存
        if (typeof window.saveChatDebounced === 'function') {
          window.saveChatDebounced();
          console.log('[Live App] 已通过saveChatDebounced保存聊天数据');
          // 等待一下确保保存完成
          await new Promise(resolve => setTimeout(resolve, 1000));
          return true;
        }

        // 方法3: 使用编辑器的保存功能
        if (window.mobileContextEditor && typeof window.mobileContextEditor.saveChatData === 'function') {
          await window.mobileContextEditor.saveChatData();
          console.log('[Live App] 已通过mobileContextEditor保存聊天数据');
          return true;
        }

        // 方法4: 使用context-editor的保存功能
        if (window.contextEditor && typeof window.contextEditor.saveChatData === 'function') {
          await window.contextEditor.saveChatData();
          console.log('[Live App] 已通过contextEditor保存聊天数据');
          return true;
        }

        // 方法5: 尝试手动保存
        try {
          if (window.jQuery && window.chat && window.this_chid) {
            const response = await window.jQuery.ajax({
              type: 'POST',
              url: '/api/chats/save',
              data: JSON.stringify({
                ch_name: window.characters[window.this_chid]?.name || 'unknown',
                file_name: window.chat_metadata?.file_name || 'default',
                chat: window.chat,
                avatar_url: window.characters[window.this_chid]?.avatar || 'none',
              }),
              cache: false,
              dataType: 'json',
              contentType: 'application/json',
            });
            console.log('[Live App] 已通过手动AJAX保存聊天数据');
            return true;
          }
        } catch (ajaxError) {
          console.warn('[Live App] 手动AJAX保存失败:', ajaxError);
        }

        console.warn('[Live App] 没有找到有效的保存方法');
        return false;
      } catch (error) {
        console.error('[Live App] 保存聊天数据失败:', error);
        return false;
      }
    }

    /**
     * 获取聊天数据
     */
    getChatData() {
      try {
        // 优先使用SillyTavern.getContext().chat
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && context.chat && Array.isArray(context.chat)) {
            return context.chat;
          }
        }

        // 尝试从全局变量获取
        const chat = window['chat'];
        if (chat && Array.isArray(chat)) {
          return chat;
        }

        return [];
      } catch (error) {
        console.error('[Live App] 获取聊天数据失败:', error);
        return [];
      }
    }

    /**
     * 更新header
     */
    updateHeader() {
      if (window.mobilePhone && window.mobilePhone.updateAppHeader) {
        const state = {
          app: 'watch-live', // 修复：使用正确的应用名称
          title: this.currentView === 'live' ? '观看直播中' : '观看直播',
          view: this.currentView,
          viewerCount: this.stateManager.currentViewerCount,
        };
        window.mobilePhone.updateAppHeader(state);
      }
    }

    /**
     * 显示提示消息
     */
    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `live-toast ${type}`;
      toast.textContent = message;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('show');
      }, 100);

      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          toast.remove();
        }, 300);
      }, 3000);
    }

    /**
     * 打字机效果：将文本逐字显示，速度适中
     */
    applyTypingEffect(element, fullText) {
      // 若正在打字，先终止
      if (this.typingTimer) {
        clearInterval(this.typingTimer);
        this.typingTimer = null;
      }

      // 若内容相同且元素已经显示完整文本，则不重复打字
      if (element.getAttribute('data-full-text') === fullText && element.textContent === fullText) {
        return;
      }

      element.setAttribute('data-full-text', fullText);
      element.textContent = '';
      // 确保从顶部开始可见
      if (typeof element.scrollTop === 'number') {
        element.scrollTop = 0;
      }
      this.isTyping = true;

      const chars = Array.from(fullText);
      let index = 0;
      const stepMsHead = 35; // 前100字：逐字
      const stepMsTailChunk = 18; // 尾部：较快的块状显示（非逐字）
      const tailChunkSize = 6; // 每次追加的字符数（流畅但不突兀）

      // 在开始打字前确保滚动位置合理
      const danmakuContainer = document.getElementById('danmaku-container');
      if (danmakuContainer) {
        this.jumpToBottomIfNeeded(danmakuContainer);
      }

      this.typingTimer = setInterval(() => {
        if (index >= chars.length) {
          clearInterval(this.typingTimer);
          this.typingTimer = null;
          this.isTyping = false;
          return;
        }

        if (index < 100) {
          // 前100字逐字
          element.textContent += chars[index++];
        } else {
          // 之后采用块状追加
          const end = Math.min(index + tailChunkSize, chars.length);
          const slice = chars.slice(index, end).join('');
          element.textContent += slice;
          index = end;
          // 动态调整节奏：短暂停顿营造流畅感
          clearInterval(this.typingTimer);
          this.typingTimer = setInterval(() => {
            if (index >= chars.length) {
              clearInterval(this.typingTimer);
              this.typingTimer = null;
              this.isTyping = false;
              return;
            }
            const end2 = Math.min(index + tailChunkSize, chars.length);
            const slice2 = chars.slice(index, end2).join('');
            element.textContent += slice2;
            index = end2;
            if (index >= chars.length) {
              clearInterval(this.typingTimer);
              this.typingTimer = null;
              this.isTyping = false;
            }
          }, stepMsTailChunk);
        }
      }, stepMsHead);
    }

    /**
     * 销毁应用，清理资源
     */
    destroy() {
      console.log('[Live App] 销毁应用，清理资源');

      // 停止监听
      this.eventListener.stopListening();

      // 清理定时器
      if (this.scrollTimeout) {
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = null;
      }
      if (this.typingTimer) {
        clearInterval(this.typingTimer);
        this.typingTimer = null;
      }

      // 清空状态
      this.stateManager.clearAllData();

      // 重置状态
      this.isInitialized = false;
      this.currentView = 'start';
    }

    /**
     * 从最新楼层提取文本（优先使用 getChatMessages 接口）
     */
    getLatestFloorTextSafe() {
      try {
        const gm = (typeof window !== 'undefined' && (window.getChatMessages || globalThis.getChatMessages)) || null;
        if (typeof gm === 'function') {
          // 仅取最新楼层，优先 assistant
          const latestAssistant = gm(-1, { role: 'assistant' });
          if (Array.isArray(latestAssistant) && latestAssistant.length > 0 && latestAssistant[0]?.message) {
            return latestAssistant[0].message;
          }
          // 退化为任意角色
          const latestAny = gm(-1);
          if (Array.isArray(latestAny) && latestAny.length > 0 && latestAny[0]?.message) {
            return latestAny[0].message;
          }
        }
      } catch (e) {
        console.warn('[Live App] 获取最新楼层文本失败（getChatMessages）:', e);
      }

      // 兜底：从上下文数组拿最后一条
      try {
        if (
          typeof window !== 'undefined' &&
          window.SillyTavern &&
          typeof window.SillyTavern.getContext === 'function'
        ) {
          const context = window.SillyTavern.getContext();
          if (context && Array.isArray(context.chat) && context.chat.length > 0) {
            const last = context.chat[context.chat.length - 1];
            return last?.mes || '';
          }
        }
      } catch (e2) {
        console.warn('[Live App] 获取最新楼层文本失败（chat兜底）:', e2);
      }
      return '';
    }

    /** 生成弹幕签名（稳定，不含时间） */
    createDanmakuSignature(item) {
      const username = (item && item.username) || '';
      const content = (item && item.content) || '';
      const type = (item && item.type) || '';
      return `${username}|${content}|${type}`;
    }

    /** 生成礼物签名（稳定，不含时间） */
    createGiftSignature(item) {
      const username = (item && item.username) || '';
      const gift = (item && (item.gift || item.content)) || '';
      return `${username}|${gift}`;
    }

    /** 按顺序逐条显示需要动画的弹幕与礼物 */
    runAppearSequence() {
      try {
        const danmakuList = document.getElementById('danmaku-list');
        if (danmakuList) {
          const nodes = Array.from(danmakuList.querySelectorAll('.danmaku-item.need-appear'));
          // 初始渲染时先隐藏这些需要动画的节点（使用 display:none 避免空白）
          nodes.forEach(el => {
            el.style.display = 'none';
          });
          this.sequentialReveal(nodes);
        }

        const giftList = document.querySelector('.gift-list');
        if (giftList) {
          const giftNodes = Array.from(giftList.querySelectorAll('li.need-appear'));
          giftNodes.forEach(el => {
            el.style.display = 'none';
          });
          this.sequentialReveal(giftNodes);
        }

        // 清空待动画集合，避免重复动画
        this.pendingAppearDanmakuSigs.clear();
        this.pendingAppearGiftSigs.clear();
      } catch (e) {
        console.warn('[Live App] 逐条出现动画执行失败:', e);
      }
    }

    /** 依次为节点添加 appear-init → appear-show（带间隔） */
    sequentialReveal(nodes) {
      if (!nodes || nodes.length === 0) return;

      // 初始状态（先隐藏，避免"跳一下"），随后统一交由 CSS 过渡
      nodes.forEach(el => {
        el.classList.remove('need-appear', 'appear-show');
        el.classList.add('appear-init');
        // 使用 display:none 避免占位
        el.style.display = 'none';
      });

      // 逐条显示：每条约 700ms 一条（更慢），单条过渡 ~300ms（参见CSS）
      const baseDelay = 150;
      const stepDelay = 700; // ≈ 0.7 秒/条
      nodes.forEach((el, idx) => {
        setTimeout(() => {
          // 显示并触发过渡
          el.style.display = '';
          // 强制触发一次 reflow，保证过渡生效
          // eslint-disable-next-line no-unused-expressions
          el.offsetHeight;
          el.classList.add('appear-show');
          // 每条出现后，若容器存在则将其滚动到可见底部（瞬时，无动画）
          const container = document.getElementById('danmaku-container');
          if (container && el?.scrollIntoView) {
            el.scrollIntoView({ block: 'end', inline: 'nearest' });
          }
        }, baseDelay + idx * stepDelay);
      });
    }

    async debouncedSave() {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }

      this.saveTimeout = setTimeout(async () => {
        await this.saveChatData();
        this.saveTimeout = null;
      }, this.saveDebounceMs);
    }
  }

  // 创建全局实例
  window.WatchLiveApp = WatchLiveApp;
  window.watchLiveApp = new WatchLiveApp();
} // 结束类定义检查

// 全局函数供调用
window.getWatchLiveAppContent = function () {
  console.log('[Watch Live App] 获取观看直播应用内容');

  if (!window.watchLiveApp) {
    console.error('[Watch Live App] watchLiveApp实例不存在');
    return '<div class="error-message">观看直播应用加载失败</div>';
  }

  try {
    // 每次获取内容时都重新检测活跃直播状态
    window.watchLiveApp.detectActiveLive();
    return window.watchLiveApp.getAppContent();
  } catch (error) {
    console.error('[Watch Live App] 获取应用内容失败:', error);
    return '<div class="error-message">观看直播应用内容加载失败</div>';
  }
};

window.bindWatchLiveAppEvents = function () {
  console.log('[Watch Live App] 绑定观看直播应用事件');

  if (!window.watchLiveApp) {
    console.error('[Watch Live App] watchLiveApp实例不存在');
    return;
  }

  try {
    // 延迟绑定，确保DOM完全加载
    setTimeout(() => {
      window.watchLiveApp.bindEvents();
      window.watchLiveApp.updateHeader();
    }, 100);
  } catch (error) {
    console.error('[Watch Live App] 绑定事件失败:', error);
  }
};

// 其他全局函数
window.watchLiveAppEndLive = function () {
  if (window.watchLiveApp) {
    window.watchLiveApp.endLive();
  }
};

window.watchLiveAppShowModal = function (modalId) {
  if (window.watchLiveApp) {
    window.watchLiveApp.showModal(modalId);
  }
};

window.watchLiveAppHideModal = function (modalId) {
  if (window.watchLiveApp) {
    window.watchLiveApp.hideModal(modalId);
  }
};

window.watchLiveAppDestroy = function () {
  if (window.watchLiveApp) {
    window.watchLiveApp.destroy();
    console.log('[Watch Live App] 应用已销毁');
  }
};

window.watchLiveAppDetectActive = function () {
  if (window.watchLiveApp) {
    console.log('[Watch Live App] 🔍 手动检测活跃直播状态...');
    window.watchLiveApp.detectActiveLive();

    // 更新界面
    if (typeof window.bindWatchLiveAppEvents === 'function') {
      window.bindWatchLiveAppEvents();
    }

    console.log('[Watch Live App] ✅ 检测完成，当前状态:', {
      view: window.watchLiveApp.currentView,
      isLiveActive: window.watchLiveApp.isLiveActive,
    });
  } else {
    console.error('[Watch Live App] watchLiveApp实例不存在');
  }
};

window.watchLiveAppForceReload = function () {
  console.log('[Watch Live App] 🔄 强制重新加载应用...');

  // 先销毁旧实例
  if (window.watchLiveApp) {
    window.watchLiveApp.destroy();
  }

  // 创建新实例
  window.watchLiveApp = new WatchLiveApp();
  console.log('[Watch Live App] ✅ 应用已重新加载');
};

// 测试转换功能
window.watchLiveAppTestConversion = function () {
  console.log('[Watch Live App] 🧪 测试转换功能...');

  if (!window.watchLiveApp) {
    console.error('[Watch Live App] watchLiveApp实例不存在');
    return;
  }

  const testContent = `这是一条测试消息
[直播|小明|弹幕|主播你好！今天吃的什么呀？]
[直播|小红|礼物|璀璨火箭*2]
[直播|推荐互动|回答小明的弹幕问题]
[直播|推荐互动|感谢小红的礼物]
[直播|本场人数|55535]
[直播|直播内容|你微笑着调整了一下耳机，准备开始今天的杂谈直播。]
测试结束`;

  console.log('原始内容:', testContent);
  const converted = window.watchLiveApp.convertLiveFormats(testContent);
  console.log('转换后内容:', converted);

  return converted;
};

// 测试布局高度
window.watchLiveAppTestLayout = function () {
  console.log('[Watch Live App] 📐 测试布局高度...');

  const appContent = document.getElementById('app-content');
  if (!appContent) {
    console.error('[Watch Live App] app-content元素不存在');
    return;
  }

  const liveContainer = appContent.querySelector('.live-container');
  if (!liveContainer) {
    console.error('[Live App] live-container元素不存在');
    return;
  }

  const videoBox = liveContainer.querySelector('.video-placeholder');
  const interactionPanel = liveContainer.querySelector('.interaction-panel');
  const danmakuContainer = liveContainer.querySelector('.danmaku-container');

  const measurements = {
    appContent: {
      height: appContent.offsetHeight,
      scrollHeight: appContent.scrollHeight,
      clientHeight: appContent.clientHeight,
    },
    liveContainer: {
      height: liveContainer.offsetHeight,
      scrollHeight: liveContainer.scrollHeight,
      clientHeight: liveContainer.clientHeight,
    },
    videoBox: videoBox
      ? {
          height: videoBox.offsetHeight,
          scrollHeight: videoBox.scrollHeight,
          clientHeight: videoBox.clientHeight,
        }
      : null,
    interactionPanel: interactionPanel
      ? {
          height: interactionPanel.offsetHeight,
          scrollHeight: interactionPanel.scrollHeight,
          clientHeight: interactionPanel.clientHeight,
        }
      : null,
    danmakuContainer: danmakuContainer
      ? {
          height: danmakuContainer.offsetHeight,
          scrollHeight: danmakuContainer.scrollHeight,
          clientHeight: danmakuContainer.clientHeight,
        }
      : null,
  };

  console.log('[Live App] 📐 布局测量结果:', measurements);

  // 检查是否有溢出
  const hasOverflow = measurements.liveContainer.scrollHeight > measurements.liveContainer.clientHeight;
  const danmakuCanScroll =
    measurements.danmakuContainer &&
    measurements.danmakuContainer.scrollHeight > measurements.danmakuContainer.clientHeight;

  console.log('[Watch Live App] 📐 布局检查:');
  console.log(`- 容器是否溢出: ${hasOverflow ? '❌ 是' : '✅ 否'}`);
  console.log(`- 弹幕是否可滚动: ${danmakuCanScroll ? '✅ 是' : '❌ 否'}`);

  return measurements;
};

// 测试函数
window.watchLiveAppTest = function () {
  console.log('[Watch Live App] 🧪 开始测试观看直播应用...');

  const tests = [
    {
      name: '检查WatchLiveApp类是否存在',
      test: () => typeof window.WatchLiveApp === 'function',
    },
    {
      name: '检查watchLiveApp实例是否存在',
      test: () => window.watchLiveApp instanceof window.WatchLiveApp,
    },
    {
      name: '检查全局函数是否存在',
      test: () =>
        typeof window.getWatchLiveAppContent === 'function' && typeof window.bindWatchLiveAppEvents === 'function',
    },
    {
      name: '检查数据解析器',
      test: () => {
        const parser = new window.WatchLiveApp().dataParser;
        const testData = parser.parseLiveData('[直播|本场人数|1234][直播|直播内容|测试内容][直播|用户1|弹幕|测试弹幕]');
        return (
          testData.viewerCount === '1.2K' && testData.liveContent === '测试内容' && testData.danmakuList.length === 1
        );
      },
    },
    {
      name: '检查应用内容生成',
      test: () => {
        const content = window.getWatchLiveAppContent();
        return typeof content === 'string' && content.includes('live-app');
      },
    },
    {
      name: '检查活跃直播检测',
      test: () => {
        const app = new window.WatchLiveApp();
        const testContent1 = '[直播|本场人数|1234][直播|直播内容|测试内容]';
        const testContent2 = '[直播历史|本场人数|1234][直播历史|直播内容|测试内容]';
        const testContent3 = '没有直播内容的普通聊天';

        return (
          app.hasActiveLiveFormats(testContent1) === true &&
          app.hasActiveLiveFormats(testContent2) === false &&
          app.hasActiveLiveFormats(testContent3) === false
        );
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach(test => {
    try {
      const result = test.test();
      if (result) {
        console.log(`✅ ${test.name}: 通过`);
        passed++;
      } else {
        console.log(`❌ ${test.name}: 失败`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name}: 错误 - ${error.message}`);
      failed++;
    }
  });

  console.log(`[Watch Live App] 🧪 测试完成: ${passed} 通过, ${failed} 失败`);

  if (failed === 0) {
    console.log('[Watch Live App] 🎉 所有测试通过！观看直播应用已准备就绪');
  } else {
    console.log('[Watch Live App] ⚠️ 部分测试失败，请检查相关功能');
  }

  return { passed, failed, total: tests.length };
};

console.log('[Watch Live App] 观看直播应用模块加载完成');
console.log('[Watch Live App] 💡 可用的函数:');
console.log('[Watch Live App] - watchLiveAppTest() 测试应用功能');
console.log('[Watch Live App] - watchLiveAppTestConversion() 测试格式转换功能');
console.log('[Watch Live App] - watchLiveAppTestLayout() 测试布局高度');
console.log('[Watch Live App] - watchLiveAppDetectActive() 手动检测活跃直播状态');
console.log('[Watch Live App] - watchLiveAppForceReload() 强制重新加载应用');
