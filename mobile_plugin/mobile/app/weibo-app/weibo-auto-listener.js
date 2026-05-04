// ==SillyTavern Weibo Auto Listener==
// @name         Weibo Auto Listener for Mobile Extension
// @version      1.0.0
// @description  微博自动监听器，监听聊天变化并自动触发微博生成
// @author       Assistant

// 防止重复加载
if (typeof window.WeiboAutoListener !== 'undefined') {
  console.log('[Weibo Auto Listener] 已存在，跳过重复加载');
} else {
  /**
   * 微博自动监听器类
   * 负责监听聊天变化并自动触发微博内容生成
   */
  class WeiboAutoListener {
    constructor() {
      this.isListening = false;
      this.isProcessingRequest = false;
      this.lastProcessedMessageCount = 0;
      this.checkInterval = null;
      this.checkIntervalMs = 3000; // 检查间隔：3秒
      this.settings = {
        enabled: true,
        threshold: 10, // 消息增量阈值
      };

      // 绑定方法
      this.startListening = this.startListening.bind(this);
      this.stopListening = this.stopListening.bind(this);
      this.checkForUpdates = this.checkForUpdates.bind(this);
      this.handleChatUpdate = this.handleChatUpdate.bind(this);

      this.init();
    }

    /**
     * 初始化监听器 - 参考Forum-App的智能启动机制
     */
    init() {
      console.log('[Weibo Auto Listener] 初始化微博自动监听器');
      this.loadSettings();

      // 参考Forum-App：设置UI观察器，而不是自动启动
      setTimeout(() => {
        this.setupUIObserver();
      }, 2000);
    }

    /**
     * 设置UI观察器 - 参考Forum-App
     */
    setupUIObserver() {
      try {
        console.log('[Weibo Auto Listener] 设置UI观察器...');

        // 检查微博应用状态
        this.checkWeiboAppState();

        // 设置定期检查UI状态（降低频率）
        setInterval(() => {
          this.checkWeiboAppState();
        }, 10000); // 每10秒检查一次UI状态
      } catch (error) {
        console.error('[Weibo Auto Listener] 设置UI观察器失败:', error);
      }
    }

    /**
     * 检查微博应用状态 - 参考Forum-App
     */
    checkWeiboAppState() {
      try {
        // 检查微博应用是否在当前视图中激活
        const weiboAppActive = this.isWeiboAppActive();

        if (weiboAppActive && !this.isListening && this.settings.enabled) {
          console.log('[Weibo Auto Listener] 检测到微博应用激活，启动监听器');
          this.startListening();
        } else if (!weiboAppActive && this.isListening) {
          console.log('[Weibo Auto Listener] 检测到微博应用未激活，停止监听器');
          this.stopListening();
        }
      } catch (error) {
        console.warn('[Weibo Auto Listener] 检查微博应用状态失败:', error);
      }
    }

    /**
     * 检查微博应用是否激活
     */
    isWeiboAppActive() {
      try {
        // 检查是否有微博相关的DOM元素可见
        const weiboElements = document.querySelectorAll('.weibo-page, .weibo-container, [data-app="weibo"]');
        const hasVisibleWeiboElements = Array.from(weiboElements).some(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

        // 检查当前页面URL或状态
        const urlContainsWeibo = window.location.href.includes('weibo') || window.location.hash.includes('weibo');

        // 检查移动框架的当前应用状态
        const mobileFrameworkActive = window.mobileFramework && window.mobileFramework.currentApp === 'weibo';

        return hasVisibleWeiboElements || urlContainsWeibo || mobileFrameworkActive;
      } catch (error) {
        console.warn('[Weibo Auto Listener] 检查微博应用激活状态失败:', error);
        // 如果检查失败，默认认为激活（保守策略）
        return true;
      }
    }

    /**
     * 加载设置
     */
    loadSettings() {
      try {
        const saved = localStorage.getItem('mobile_weibo_auto_listener_settings');
        if (saved) {
          const settings = JSON.parse(saved);
          this.settings = { ...this.settings, ...settings };
          console.log('[Weibo Auto Listener] 设置已加载:', this.settings);
        }
      } catch (error) {
        console.warn('[Weibo Auto Listener] 加载设置失败:', error);
      }
    }

    /**
     * 保存设置
     */
    saveSettings() {
      try {
        localStorage.setItem('mobile_weibo_auto_listener_settings', JSON.stringify(this.settings));
        console.log('[Weibo Auto Listener] 设置已保存:', this.settings);
      } catch (error) {
        console.warn('[Weibo Auto Listener] 保存设置失败:', error);
      }
    }

    /**
     * 开始监听
     */
    startListening() {
      if (this.isListening) {
        console.log('[Weibo Auto Listener] 已在监听中');
        return;
      }

      console.log('[Weibo Auto Listener] 🎧 开始监听聊天变化...');
      this.isListening = true;

      // 获取初始消息数量
      this.updateLastProcessedCount();

      // 开始定时检查
      this.checkInterval = setInterval(this.checkForUpdates, this.checkIntervalMs);

      console.log(`[Weibo Auto Listener] ✅ 监听已启动，检查间隔: ${this.checkIntervalMs}ms`);
    }

    /**
     * 开始监听（startListening 的别名）
     */
    start() {
      this.startListening();
    }

    /**
     * 停止监听
     */
    stopListening() {
      if (!this.isListening) {
        console.log('[Weibo Auto Listener] 未在监听中');
        return;
      }

      console.log('[Weibo Auto Listener] 🔇 停止监听聊天变化...');
      this.isListening = false;

      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }

      console.log('[Weibo Auto Listener] ✅ 监听已停止');
    }

    /**
     * 检查更新 - 参考Forum-App的智能日志输出
     */
    async checkForUpdates() {
      // 如果未启用或正在处理请求，跳过检查
      if (!this.settings.enabled || this.isProcessingRequest) {
        return;
      }

      // 如果微博管理器正在处理，跳过检查
      if (window.weiboManager && window.weiboManager.isProcessing) {
        return; // 移除无意义的日志输出
      }

      try {
        const chatData = await this.getCurrentChatData();
        if (!chatData || !chatData.messages) {
          return;
        }

        const currentCount = chatData.messages.length;
        const increment = currentCount - this.lastProcessedMessageCount;

        // 参考Forum-App：只在有实际消息增量时输出日志
        if (increment > 0) {
          if (window.DEBUG_WEIBO_AUTO_LISTENER) {
            console.log(
              `[Weibo Auto Listener] 检测到新消息: +${increment} (${this.lastProcessedMessageCount} -> ${currentCount})`,
            );
          }

          // 检查是否达到阈值
          if (increment >= this.settings.threshold) {
            console.log(`[Weibo Auto Listener] 🚀 达到阈值 (${increment}/${this.settings.threshold})，触发微博生成`);
            await this.handleChatUpdate(currentCount);
          } else {
            if (window.DEBUG_WEIBO_AUTO_LISTENER) {
              console.log(
                `[Weibo Auto Listener] 消息增量未达到阈值 (${increment}/${this.settings.threshold})，继续监听`,
              );
            }
          }
        }
        // 如果没有新消息，不输出任何日志（避免刷屏）
      } catch (error) {
        // 降低错误日志频率，避免刷屏
        if (Math.random() < 0.01) {
          console.error('[Weibo Auto Listener] 检查更新失败:', error);
        }
      }
    }

    /**
     * 处理聊天更新
     */
    async handleChatUpdate(currentCount) {
      if (this.isProcessingRequest) {
        console.log('[Weibo Auto Listener] 正在处理请求，跳过');
        return;
      }

      try {
        this.isProcessingRequest = true;
        console.log('[Weibo Auto Listener] 📝 开始处理聊天更新...');

        // 调用微博管理器生成内容
        if (window.weiboManager && window.weiboManager.generateWeiboContent) {
          const success = await window.weiboManager.generateWeiboContent(false); // 非强制模式

          if (success) {
            console.log('[Weibo Auto Listener] ✅ 微博内容生成成功');
            this.lastProcessedMessageCount = currentCount;

            // 同步到微博管理器
            if (window.weiboManager) {
              window.weiboManager.lastProcessedCount = currentCount;
            }
          } else {
            console.log('[Weibo Auto Listener] ⚠️ 微博内容生成失败或被跳过');
          }
        } else {
          console.warn('[Weibo Auto Listener] 微博管理器未就绪');
        }
      } catch (error) {
        console.error('[Weibo Auto Listener] 处理聊天更新失败:', error);
      } finally {
        // 延迟重置处理状态，避免重复触发
        setTimeout(() => {
          this.isProcessingRequest = false;
          console.log('[Weibo Auto Listener] 🔄 处理状态已重置');
        }, 2000);
      }
    }

    /**
     * 获取当前聊天数据 - 参考Forum-App的错误处理
     */
    async getCurrentChatData() {
      try {
        if (window.mobileContextEditor) {
          return window.mobileContextEditor.getCurrentChatData();
        } else if (window.MobileContext) {
          return await window.MobileContext.loadChatToEditor();
        } else {
          // 静默处理，避免刷屏
          return null;
        }
      } catch (error) {
        // 参考Forum-App：只在特定条件下输出错误日志
        if (!this._lastErrorTime || Date.now() - this._lastErrorTime > 60000) {
          // 每分钟最多输出一次错误日志
          console.warn('[Weibo Auto Listener] 获取聊天数据失败:', error.message);
          this._lastErrorTime = Date.now();
        }
        return null;
      }
    }

    /**
     * 更新最后处理的消息数量
     */
    async updateLastProcessedCount() {
      try {
        const chatData = await this.getCurrentChatData();
        if (chatData && chatData.messages) {
          this.lastProcessedMessageCount = chatData.messages.length;
          console.log(`[Weibo Auto Listener] 初始消息数量: ${this.lastProcessedMessageCount}`);
        }
      } catch (error) {
        console.warn('[Weibo Auto Listener] 更新消息数量失败:', error);
      }
    }

    /**
     * 启用自动监听
     */
    enable() {
      this.settings.enabled = true;
      this.saveSettings();

      if (!this.isListening) {
        this.startListening();
      }

      console.log('[Weibo Auto Listener] ✅ 自动监听已启用');
    }

    /**
     * 禁用自动监听
     */
    disable() {
      this.settings.enabled = false;
      this.saveSettings();

      if (this.isListening) {
        this.stopListening();
      }

      console.log('[Weibo Auto Listener] ❌ 自动监听已禁用');
    }

    /**
     * 设置消息阈值
     */
    setThreshold(threshold) {
      if (typeof threshold === 'number' && threshold > 0) {
        this.settings.threshold = threshold;
        this.saveSettings();
        console.log(`[Weibo Auto Listener] 阈值已设置为: ${threshold}`);
      } else {
        console.warn('[Weibo Auto Listener] 无效的阈值:', threshold);
      }
    }

    /**
     * 设置检查间隔
     */
    setCheckInterval(intervalMs) {
      if (typeof intervalMs === 'number' && intervalMs >= 1000) {
        this.checkIntervalMs = intervalMs;

        // 如果正在监听，重启监听以应用新间隔
        if (this.isListening) {
          this.stopListening();
          setTimeout(() => {
            this.startListening();
          }, 100);
        }

        console.log(`[Weibo Auto Listener] 检查间隔已设置为: ${intervalMs}ms`);
      } else {
        console.warn('[Weibo Auto Listener] 无效的检查间隔:', intervalMs);
      }
    }

    /**
     * 手动触发检查
     */
    async manualCheck() {
      console.log('[Weibo Auto Listener] 🔍 手动触发检查...');

      try {
        // 临时启用处理，即使当前被禁用
        const originalEnabled = this.settings.enabled;
        this.settings.enabled = true;

        await this.checkForUpdates();

        // 恢复原始设置
        this.settings.enabled = originalEnabled;

        console.log('[Weibo Auto Listener] ✅ 手动检查完成');
      } catch (error) {
        console.error('[Weibo Auto Listener] 手动检查失败:', error);
      }
    }

    /**
     * 重置监听器状态
     */
    reset() {
      console.log('[Weibo Auto Listener] 🔄 重置监听器状态...');

      // 停止监听
      this.stopListening();

      // 重置状态
      this.isProcessingRequest = false;
      this.lastProcessedMessageCount = 0;

      // 更新消息数量
      this.updateLastProcessedCount();

      // 如果启用，重新开始监听
      if (this.settings.enabled) {
        setTimeout(() => {
          this.startListening();
        }, 1000);
      }

      console.log('[Weibo Auto Listener] ✅ 监听器状态已重置');
    }

    /**
     * 获取监听器状态
     */
    getStatus() {
      return {
        isListening: this.isListening,
        isProcessingRequest: this.isProcessingRequest,
        lastProcessedMessageCount: this.lastProcessedMessageCount,
        settings: { ...this.settings },
        checkIntervalMs: this.checkIntervalMs,
      };
    }

    /**
     * 获取调试信息
     */
    getDebugInfo() {
      const status = this.getStatus();

      return {
        ...status,
        hasWeiboManager: !!window.weiboManager,
        hasContextEditor: !!window.mobileContextEditor,
        hasMobileContext: !!window.MobileContext,
        timestamp: new Date().toISOString(),
      };
    }

    /**
     * 强制同步消息数量
     */
    async forceSyncMessageCount() {
      console.log('[Weibo Auto Listener] 🔄 强制同步消息数量...');

      try {
        const chatData = await this.getCurrentChatData();
        if (chatData && chatData.messages) {
          const oldCount = this.lastProcessedMessageCount;
          this.lastProcessedMessageCount = chatData.messages.length;

          // 同步到微博管理器
          if (window.weiboManager) {
            window.weiboManager.lastProcessedCount = this.lastProcessedMessageCount;
          }

          console.log(`[Weibo Auto Listener] ✅ 消息数量已同步: ${oldCount} -> ${this.lastProcessedMessageCount}`);
        } else {
          console.warn('[Weibo Auto Listener] 无法获取聊天数据');
        }
      } catch (error) {
        console.error('[Weibo Auto Listener] 强制同步消息数量失败:', error);
      }
    }

    /**
     * 检查依赖项
     */
    checkDependencies() {
      const deps = {
        weiboManager: !!window.weiboManager,
        mobileContextEditor: !!window.mobileContextEditor,
        mobileContext: !!window.MobileContext,
      };

      // 只在依赖状态发生变化时输出日志
      const depsString = JSON.stringify(deps);
      if (this._lastDepsString !== depsString) {
        console.log('[Weibo Auto Listener] 依赖项状态变化:', deps);
        this._lastDepsString = depsString;
      }

      const allReady = Object.values(deps).some(ready => ready);
      if (!allReady && (!this._lastWarnTime || Date.now() - this._lastWarnTime > 300000)) {
        // 每5分钟最多警告一次
        console.warn('[Weibo Auto Listener] ⚠️ 关键依赖项未就绪');
        this._lastWarnTime = Date.now();
      }

      return deps;
    }

    /**
     * 确保监听器持续运行 - 参考Forum-App的状态恢复机制
     */
    ensureContinuousListening() {
      // 如果处理状态卡住了，重置它
      if (this.isProcessingRequest) {
        const now = Date.now();
        const timeSinceLastCheck = now - (this._lastCheckTime || 0);

        // 如果超过30秒还在处理状态，认为卡住了
        if (timeSinceLastCheck > 30000) {
          console.warn('[Weibo Auto Listener] 检测到处理状态卡住，重置状态...');
          this.isProcessingRequest = false;
          this._lastCheckTime = now;
        }
      }

      // 检查定时器是否还在运行（如果监听器已启动）
      if (this.isListening && !this.checkInterval) {
        console.warn('[Weibo Auto Listener] 检测到定时器丢失，重新设置...');
        this.checkInterval = setInterval(this.checkForUpdates, this.checkIntervalMs);
      }
    }
  }

  // 创建全局实例 - 参考Forum-App的初始化方式
  if (typeof window !== 'undefined') {
    // 设置类和实例，与 forum-auto-listener.js 保持一致
    window.WeiboAutoListener = WeiboAutoListener;
    window.weiboAutoListener = new WeiboAutoListener();
    console.log('[Weibo Auto Listener] ✅ 微博自动监听器已创建');

    // 参考Forum-App：设置健康检查机制（降低频率）
    setTimeout(() => {
      if (window.weiboAutoListener) {
        // 每5分钟检查一次状态，而不是频繁检查
        setInterval(() => {
          try {
            window.weiboAutoListener.ensureContinuousListening();
          } catch (error) {
            console.error('[Weibo Auto Listener] 健康检查失败:', error);
          }
        }, 300000); // 5分钟
      }
    }, 10000); // 10秒后开始健康检查
  }
} // 结束防重复加载检查
