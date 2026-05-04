// ==SillyTavern Forum Manager==
// @name         Forum Manager for Mobile Extension
// @version      1.0.0
// @description  论坛自动更新管理器
// @author       Assistant

/**
 * 论坛管理器类
 * 负责管理论坛帖子生成、API调用和与上下文编辑器的集成
 */
class ForumManager {
  constructor() {
    this.isInitialized = false;
    this.currentSettings = {
      enabled: true,
      selectedStyle: '贴吧老哥',
      autoUpdate: true,
      threshold: 10,
      apiConfig: {
        url: '',
        apiKey: '',
        model: '',
      },
    };
    this.isProcessing = false;
    this.lastProcessedCount = 0;

    // 新增：生成状态监控相关
    this.isMonitoringGeneration = false;
    this.pendingInsertions = []; // 待插入的消息队列
    this.generationCheckInterval = null;
    this.statusUpdateTimer = null; // 状态更新定时器
    this.maxWaitTime = 300000; // 最大等待时间: 5分钟

    // 绑定方法
    this.initialize = this.initialize.bind(this);
    this.generateForumContent = this.generateForumContent.bind(this);
    this.updateContextWithForum = this.updateContextWithForum.bind(this);
    this.checkGenerationStatus = this.checkGenerationStatus.bind(this);
    this.waitForGenerationComplete = this.waitForGenerationComplete.bind(this);
    this.processInsertionQueue = this.processInsertionQueue.bind(this);
  }

  /**
   * 初始化论坛管理器
   */
  async initialize() {
    try {
      console.log('[Forum Manager] 初始化开始...');

      // 加载设置
      this.loadSettings();

      // 等待其他模块初始化完成
      await this.waitForDependencies();

      // 创建UI
      this.createForumUI();

      // 注册控制台命令
      this.registerConsoleCommands();

      this.isInitialized = true;
      console.log('[Forum Manager] ✅ 初始化完成');

      // 浏览器兼容性检测和提示
      this.detectBrowserAndShowTips();
    } catch (error) {
      console.error('[Forum Manager] 初始化失败:', error);
    }
  }

  /**
   * 检测浏览器并显示兼容性提示
   */
  detectBrowserAndShowTips() {
    const userAgent = navigator.userAgent;
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isVia = /Via/.test(userAgent);

    if (isSafari || isVia) {
      console.log('%c🍎 Safari/Via兼容性提示', 'color: #ff6b6b; font-weight: bold; font-size: 14px;');
      console.log(
        '%c如果遇到按钮无响应问题，请运行: MobileContext.fixBrowserCompatibility()',
        'color: #4ecdc4; font-size: 12px;',
      );
      console.log('%c更多诊断信息: MobileContext.quickDiagnosis()', 'color: #45b7d1; font-size: 12px;');
    }
  }

  /**
   * 等待依赖模块加载完成
   */
  async waitForDependencies() {
    return new Promise(resolve => {
      const checkDeps = () => {
        const contextEditorReady = window.mobileContextEditor !== undefined;
        const customAPIReady = window.mobileCustomAPIConfig !== undefined;

        if (contextEditorReady && customAPIReady) {
          console.log('[Forum Manager] 依赖模块已就绪');
          resolve();
        } else {
          console.log('[Forum Manager] 等待依赖模块...', {
            contextEditor: contextEditorReady,
            customAPI: customAPIReady,
          });
          setTimeout(checkDeps, 500);
        }
      };
      checkDeps();
    });
  }

  /**
   * 创建论坛UI按钮 - 已移除浮动按钮，现在通过手机框架集成
   */
  createForumUI() {
    console.log('[Forum Manager] ✅ 论坛UI已集成到手机框架中');
  }

  /**
   * 显示论坛控制面板
   */
  showForumPanel() {
    // 如果面板已存在，直接显示
    if (document.getElementById('forum-panel-overlay')) {
      document.getElementById('forum-panel-overlay').style.display = 'flex';
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'forum-panel-overlay';
    overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

    const panel = document.createElement('div');
    panel.id = 'forum-control-panel';
    panel.style.cssText = `
            background: #fff;
            border-radius: 15px;
            padding: 30px;
            width: 90%;
            max-width: 500px;
            max-height: 80%;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            color: white;
        `;

    panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #667eea;">📰 论坛管理器</h2>
                <button id="close-forum-panel" style="background: none; border: none; color: #ccc; font-size: 24px; cursor: pointer;">×</button>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 10px; color: #333;">选择论坛风格:</label>
                <select id="forum-style-select" style="width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #444; background: #eee; color: #333;">
                    <!-- 风格选项将通过JavaScript动态加载 -->
                </select>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 10px; color: #333;">自定义前缀 (发送给模型的额外提示词):</label>
                <textarea id="forum-custom-prefix" placeholder="在此输入自定义前缀，将添加到风格提示词前面..."
                          style="width: 100%; height: 80px; padding: 10px; border-radius: 5px; border: 1px solid #444; background: #eee; color: #333; resize: vertical; font-family: monospace; font-size: 16px;"></textarea>
                <div style="margin-top: 5px; font-size: 16px; color: #333;">
                    提示: 可以用来添加特殊指令、角色设定或生成要求
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 10px; color: #333;">消息阈值 (触发论坛生成):</label>
                <input type="number" id="forum-threshold" value="${this.currentSettings.threshold}" min="1" max="100"
                       style="width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #444; background: #eee; color: #333;">
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: flex; align-items: center; color: #333; cursor: pointer;">
                    <input type="checkbox" id="forum-auto-update" ${this.currentSettings.autoUpdate ? 'checked' : ''}
                           style="margin-right: 10px;background: #fff;color: #333;">
                    自动生成论坛内容
                </label>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button id="generate-forum-now" style="flex: 1; padding: 12px; background: #667eea; color: #fff; border: none; border-radius: 5px; cursor: pointer; min-width: 120px;">
                    立即生成论坛
                </button>
                <button id="clear-forum-content" style="flex: 1; padding: 12px; background: #e74c3c; color: #fff; border: none; border-radius: 5px; cursor: pointer; min-width: 120px;">
                    清除论坛内容
                </button>
                <button id="forum-settings" style="flex: 1; padding: 12px; background: #95a5a6; color: #fff; border: none; border-radius: 5px; cursor: pointer; min-width: 120px;">
                    API设置
                </button>
            </div>

            <div id="forum-status" style="margin-top: 20px; padding: 10px; background: #2c3e50; border-radius: 5px; font-size: 12px; color: #fff;">
                状态: 就绪
            </div>

            <div id="forum-queue-status" style="margin-top: 10px; padding: 8px; background: #34495e; border-radius: 5px; font-size: 11px; color: #ecf0f1;">
                <div style="font-weight: bold; margin-bottom: 5px;">🔄 生成状态监控</div>
                <div>SillyTavern生成状态: <span id="generation-status">检查中...</span></div>
                <div>待插入队列: <span id="queue-count">0</span> 项</div>
                <div style="margin-top: 5px;">
                    <button id="clear-queue-btn" style="background: #e67e22; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; font-size: 10px; cursor: pointer;">清空队列</button>
                    <button id="refresh-status-btn" style="background: #3498db; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; font-size: 10px; cursor: pointer; margin-left: 5px;">刷新状态</button>
                </div>
            </div>
        `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // 初始化风格选择器
    this.initializePanelStyleSelector();

    // 设置前缀值
    if (window.forumStyles) {
      document.getElementById('forum-custom-prefix').value = window.forumStyles.getCustomPrefix();
    }

    // 绑定事件
    this.bindPanelEvents();
  }

  /**
   * 初始化面板风格选择器
   */
  initializePanelStyleSelector() {
    const styleSelect = document.getElementById('forum-style-select');
    if (!styleSelect) return;

    try {
      // 清空现有选项
      styleSelect.innerHTML = '';

      // 添加预设风格
      if (window.forumStyles && window.forumStyles.styles) {
        const presetStyles = Object.keys(window.forumStyles.styles);
        if (presetStyles.length > 0) {
          const presetGroup = document.createElement('optgroup');
          presetGroup.label = '预设风格';

          presetStyles.forEach(styleName => {
            const option = document.createElement('option');
            option.value = styleName;
            option.textContent = styleName;
            presetGroup.appendChild(option);
          });

          styleSelect.appendChild(presetGroup);
        }
      }

      // 添加自定义风格
      if (window.forumStyles && window.forumStyles.getAllCustomStyles) {
        const customStyles = window.forumStyles.getAllCustomStyles();
        if (customStyles.length > 0) {
          const customGroup = document.createElement('optgroup');
          customGroup.label = '自定义风格';

          customStyles.forEach(style => {
            const option = document.createElement('option');
            option.value = style.name;
            option.textContent = `${style.name} (自定义)`;
            customGroup.appendChild(option);
          });

          styleSelect.appendChild(customGroup);
        }
      }

      // 设置当前选中的风格
      if (this.currentSettings.selectedStyle) {
        styleSelect.value = this.currentSettings.selectedStyle;
      }

      // 如果没有找到当前风格，默认选择第一个
      if (!styleSelect.value && styleSelect.options.length > 0) {
        styleSelect.selectedIndex = 0;
        this.currentSettings.selectedStyle = styleSelect.value;
        this.saveSettings();
      }

      console.log('[ForumManager] 面板风格选择器已初始化，共', styleSelect.options.length, '个选项');
    } catch (error) {
      console.error('[ForumManager] 初始化面板风格选择器失败:', error);

      // 降级处理：添加默认风格
      styleSelect.innerHTML = '<option value="贴吧老哥">贴吧老哥</option>';
      styleSelect.value = '贴吧老哥';
      this.currentSettings.selectedStyle = '贴吧老哥';
    }
  }

  /**
   * 绑定面板事件
   */
  bindPanelEvents() {
    const overlay = document.getElementById('forum-panel-overlay');

    // 关闭面板
    document.getElementById('close-forum-panel').addEventListener('click', () => {
      overlay.style.display = 'none';
      this.stopStatusUpdateTimer();
    });

    // 点击遮罩层关闭
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
        this.stopStatusUpdateTimer();
      }
    });

    // 风格选择
    document.getElementById('forum-style-select').addEventListener('change', e => {
      this.currentSettings.selectedStyle = e.target.value;
      this.saveSettings();
    });

    // 自定义前缀设置
    document.getElementById('forum-custom-prefix').addEventListener('input', e => {
      if (window.forumStyles) {
        window.forumStyles.setCustomPrefix(e.target.value);
      }
    });

    // 前缀输入框失焦时保存
    document.getElementById('forum-custom-prefix').addEventListener('blur', e => {
      if (window.forumStyles) {
        window.forumStyles.setCustomPrefix(e.target.value);
        console.log('[Forum Manager] 前缀已更新');
      }
    });

    // 阈值设置
    document.getElementById('forum-threshold').addEventListener('change', e => {
      this.currentSettings.threshold = parseInt(e.target.value);
      this.saveSettings();
    });

    // 自动更新开关
    document.getElementById('forum-auto-update').addEventListener('change', e => {
      this.currentSettings.autoUpdate = e.target.checked;
      this.saveSettings();
    });

    // 立即生成论坛
    document.getElementById('generate-forum-now').addEventListener('click', () => {
      console.log('[Forum Manager] 🔘 立即生成按钮被点击（来自forum-manager.js）');
      this.generateForumContent(true); // 强制生成，不检查消息增量
    });

    // 清除论坛内容
    document.getElementById('clear-forum-content').addEventListener('click', () => {
      this.clearForumContent();
    });

    // API设置
    document.getElementById('forum-settings').addEventListener('click', () => {
      if (window.mobileCustomAPIConfig) {
        window.mobileCustomAPIConfig.showConfigPanel();
      } else {
        this.updateStatus('API配置模块未就绪', 'error');
      }
    });

    // 新增：队列管理按钮
    document.getElementById('clear-queue-btn').addEventListener('click', () => {
      this.clearQueue();
      this.updateQueueStatusDisplay();
    });

    document.getElementById('refresh-status-btn').addEventListener('click', () => {
      this.updateQueueStatusDisplay();
    });

    // 启动状态更新定时器
    this.startStatusUpdateTimer();
  }

  /**
   * 生成论坛内容
   */
  async generateForumContent(force = false) {
    // 记录调用源
    const caller = force ? '手动强制生成' : '自动检查生成';
    console.log(`[Forum Manager] 📞 调用源: ${caller}`);

    // 如果是强制模式，立即阻止auto-listener
    if (force && window.forumAutoListener) {
      if (window.forumAutoListener.isProcessingRequest) {
        console.log('[Forum Manager] ⚠️ auto-listener正在处理，但强制生成优先');
      }
      window.forumAutoListener.isProcessingRequest = true;
      console.log('[Forum Manager] 🚫 已阻止auto-listener干扰');
    }

    // 严格的重复请求防护 - 增强Safari兼容性
    if (this.isProcessing) {
      console.log('[Forum Manager] 检测到正在处理中，检查是否为Safari兼容性问题...');

      // Safari兼容性处理：如果是强制模式，给予一次机会重置状态
      if (force) {
        console.log('[Forum Manager] 🍎 Safari兼容模式：强制重置状态');
        this.isProcessing = false;
        if (window.forumAutoListener) {
          window.forumAutoListener.isProcessingRequest = false;
        }
        // 继续执行，不返回false
      } else {
        console.log('[Forum Manager] 正在处理中，跳过重复请求');
        this.updateStatus('正在处理中，请稍候...', 'warning');

        // 如果是强制模式，恢复auto-listener状态
        if (force && window.forumAutoListener) {
          window.forumAutoListener.isProcessingRequest = false;
        }
        return false;
      }
    }

    // 如果是强制模式，临时暂停auto-listener
    let autoListenerPaused = false;
    if (force && window.forumAutoListener && window.forumAutoListener.isListening) {
      autoListenerPaused = true;
      // 设置处理请求锁，阻止auto-listener触发
      window.forumAutoListener.isProcessingRequest = true;
      console.log('[Forum Manager] 🔄 临时暂停auto-listener（设置处理锁）');
    }

    // 检查是否有足够的消息变化
    try {
      const chatData = await this.getCurrentChatData();
      if (!chatData || !chatData.messages || chatData.messages.length === 0) {
        console.log('[Forum Manager] 无聊天数据，跳过生成');
        return false;
      }

      // 只有在非强制模式下才检查消息增量
      if (!force) {
        // 检查是否有足够的新消息
        const currentCount = chatData.messages.length;
        const increment = currentCount - this.lastProcessedCount;

        if (increment < this.currentSettings.threshold) {
          console.log(
            `[Forum Manager] [自动检查] 消息增量不足 (${increment}/${this.currentSettings.threshold})，跳过生成`,
          );
          return false;
        }
      } else {
        console.log('[Forum Manager] 🚀 强制生成模式，跳过消息增量检查');
      }

      // 开始处理
      this.isProcessing = true;
      this.updateStatus('正在生成论坛内容...', 'info');

      const currentCount = chatData.messages.length;
      const increment = currentCount - this.lastProcessedCount;
      console.log(`[Forum Manager] 开始生成论坛内容 (消息数: ${currentCount}, 增量: ${increment}, 强制模式: ${force})`);

      // 2. 调用API生成论坛内容
      const forumContent = await this.callForumAPI(chatData);
      if (!forumContent) {
        throw new Error('API返回空内容');
      }

      // 3. 通过上下文编辑器安全更新到第1楼层（带生成状态检查）
      const success = await this.safeUpdateContextWithForum(forumContent);
      if (success) {
        this.updateStatus('论坛内容已添加到第1楼层', 'success');
        this.lastProcessedCount = currentCount;

        // 同步到auto-listener
        if (window.forumAutoListener) {
          window.forumAutoListener.lastProcessedMessageCount = currentCount;
        }

        // 刷新论坛UI界面以显示新内容
        this.clearForumUICache();

        console.log(`[Forum Manager] ✅ 论坛内容生成成功`);
        return true;
      } else {
        throw new Error('更新上下文失败');
      }
    } catch (error) {
      console.error('[Forum Manager] 生成论坛内容失败:', error);
      this.updateStatus(`生成失败: ${error.message}`, 'error');

      // 显示错误提示
      if (window.showMobileToast) {
        window.showMobileToast(`❌ 论坛生成失败: ${error.message}`, 'error');
      }

      return false;
    } finally {
      // 确保状态被重置
      this.isProcessing = false;

      // 恢复auto-listener
      if (autoListenerPaused && force) {
        setTimeout(() => {
          if (window.forumAutoListener) {
            window.forumAutoListener.isProcessingRequest = false;
            console.log('[Forum Manager] 🔄 恢复auto-listener（释放处理锁）');
          }
        }, 2000); // 2秒后恢复，确保手动操作完成
      }

      // 强制重置状态，防止卡住
      setTimeout(() => {
        if (this.isProcessing) {
          console.warn('[Forum Manager] 强制重置处理状态');
          this.isProcessing = false;
        }
      }, 5000);

      // 通知auto-listener处理完成
      if (window.forumAutoListener) {
        window.forumAutoListener.isProcessingRequest = false;
      }
    }
  }

  /**
   * 获取当前聊天数据
   */
  async getCurrentChatData() {
    try {
      if (window.mobileContextEditor) {
        return window.mobileContextEditor.getCurrentChatData();
      } else if (window.MobileContext) {
        return await window.MobileContext.loadChatToEditor();
      } else {
        throw new Error('上下文编辑器未就绪');
      }
    } catch (error) {
      console.error('[Forum Manager] 获取聊天数据失败:', error);
      throw error;
    }
  }

  /**
   * 调用论坛API
   */
  async callForumAPI(chatData) {
    try {
      console.log('🚀 [论坛API] ===== 开始生成论坛内容 =====');

      // 检查API配置
      if (!window.mobileCustomAPIConfig || !window.mobileCustomAPIConfig.isAPIAvailable()) {
        throw new Error('请先配置API');
      }

      // 构建上下文信息
      const contextInfo = this.buildContextInfo(chatData);

      // 获取风格提示词（立即生成论坛）
      const stylePrompt = window.forumStyles
        ? window.forumStyles.getStylePrompt(this.currentSettings.selectedStyle, 'generate')
        : '';

      console.log('📋 [论坛API] 系统提示词（立即生成论坛）:');
      console.log(stylePrompt);
      console.log('\n📝 [论坛API] 用户消息内容:');
      console.log(`请根据以下聊天记录生成论坛内容：\n\n${contextInfo}`);

      // 构建API请求
      const messages = [
        {
          role: 'system',
          content: `${stylePrompt}\n\n🎯 【特别注意】：\n- 重点关注用户的发帖和回帖内容，它们标记有⭐和特殊说明\n- 延续用户的语言风格、话题偏好和互动习惯\n- 让论坛内容体现用户的参与特点和行为模式\n- 如果用户有特定的观点或兴趣，请在论坛中适当呼应`,
        },
        {
          role: 'user',
          content: `🎯 请根据以下聊天记录生成论坛内容，特别注意用户的发帖和回帖模式：\n\n${contextInfo}`,
        },
      ];

      console.log('📡 [论坛API] 完整API请求:');
      console.log(JSON.stringify(messages, null, 2));

      // 调用API
      const response = await window.mobileCustomAPIConfig.callAPI(messages, {
        temperature: 0.8,
        max_tokens: 2000,
      });

      console.log('📥 [论坛API] 模型返回内容:');
      console.log(response);

      if (response && response.content) {
        console.log('✅ [论坛API] 生成的论坛内容:');
        console.log(response.content);
        console.log('🏁 [论坛API] ===== 论坛内容生成完成 =====\n');
        return response.content;
      } else {
        throw new Error('API返回格式错误');
      }
    } catch (error) {
      console.error('❌ [论坛API] API调用失败:', error);
      console.log('🏁 [论坛API] ===== 论坛内容生成失败 =====\n');
      throw error;
    }
  }

  /**
   * 构建上下文信息（只发送倒数5层楼和论坛变量内容）
   */
  buildContextInfo(chatData) {
    let contextInfo = `角色: ${chatData.characterName || '未知'}\n`;
    contextInfo += `消息数量: ${chatData.messages.length}\n\n`;

    const messages = chatData.messages;
    const selectedMessages = [];

    // 1. 从变量中读取论坛内容作为第1层楼的信息
    // 注意：这里同步读取可能有延迟，但buildContextInfo是同步方法
    // 论坛内容会通过其他方式传递给API
    selectedMessages.push({
      mes: '[论坛内容存储在变量中，由系统自动读取]',
      floor: 1,
      isFirstFloor: true,
      hasForumContent: true,
    });

    // 2. 取倒数3条消息（排除第1层楼，避免重复）
    const lastFiveMessages = messages.slice(-3);
    lastFiveMessages.forEach((msg, index) => {
      // 跳过第1层楼（已在上面处理）
      if (messages.indexOf(msg) !== 0) {
        selectedMessages.push({
          ...msg,
          floor: messages.indexOf(msg) + 1,
          isRecentMessage: true,
        });
      }
    });

    // 3. 去重并按楼层排序
    const uniqueMessages = [];
    const addedIndices = new Set();

    selectedMessages.forEach(msg => {
      const originalIndex = messages.findIndex(m => m === msg || (m.mes === msg.mes && m.is_user === msg.is_user));
      if (!addedIndices.has(originalIndex)) {
        addedIndices.add(originalIndex);
        uniqueMessages.push({
          ...msg,
          originalIndex,
        });
      }
    });

    // 按原始索引排序
    uniqueMessages.sort((a, b) => a.originalIndex - b.originalIndex);

    // 4. 分析用户参与模式
    const userMessages = uniqueMessages.filter(msg => msg.is_user);
    const userForumPosts = [];
    const userReplies = [];

    userMessages.forEach(msg => {
      if (msg.isFirstFloor && msg.hasForumContent) {
        userForumPosts.push(msg);
      } else if (msg.mes && msg.mes.trim()) {
        userReplies.push(msg);
      }
    });

    // 5. 构建增强注意力的内容
    contextInfo += '选择的对话内容:\n';

    // 特别标记用户的论坛参与行为
    if (userForumPosts.length > 0 || userReplies.length > 0) {
      contextInfo += '\n⭐ 【重点关注：用户论坛参与模式】\n';

      if (userForumPosts.length > 0) {
        contextInfo += '👤 用户的发帖内容：\n';
        userForumPosts.forEach(msg => {
          contextInfo += `  📝 [用户发帖] ${msg.mes}\n`;
        });
        contextInfo += '\n';
      }

      if (userReplies.length > 0) {
        contextInfo += '💬 用户的回帖内容：\n';
        userReplies.forEach(msg => {
          contextInfo += `  💭 [用户回复] ${msg.mes}\n`;
        });
        contextInfo += '\n';
      }

      contextInfo += '⚠️ 生成论坛内容时请特别注意延续和呼应用户的发帖风格、话题偏好和互动模式！\n\n';
    }

    contextInfo += '完整对话记录:\n';
    uniqueMessages.forEach(msg => {
      const speaker = msg.is_user ? '👤用户' : `🤖${chatData.characterName || '角色'}`;
      let floorInfo = '';
      let attentionMark = '';

      if (msg.isFirstFloor) {
        floorInfo = msg.hasForumContent ? '[第1楼层-含论坛]' : '[第1楼层]';
      } else if (msg.isRecentMessage) {
        floorInfo = '[最近消息]';
      }

      // 为用户消息添加特殊注意力标记
      if (msg.is_user) {
        attentionMark = '⭐ ';
      }

      contextInfo += `${attentionMark}${speaker}${floorInfo}: ${msg.mes}\n`;
    });

    console.log('📋 [上下文构建] ===== 上下文信息构建完成 =====');
    console.log(`[上下文构建] 总消息数: ${chatData.messages.length}`);
    console.log(`[上下文构建] 选择消息数: ${uniqueMessages.length}`);
    console.log(`[上下文构建] 包含第1楼层: ${uniqueMessages.some(m => m.isFirstFloor)}`);
    console.log(`[上下文构建] 最近消息数: ${uniqueMessages.filter(m => m.isRecentMessage).length}`);
    console.log('📝 [上下文构建] 构建的完整上下文信息:');
    console.log(contextInfo);
    console.log('🏁 [上下文构建] ===== 上下文信息构建完成 =====\n');

    return contextInfo;
  }

  /**
   * 将论坛数据写入变量
   */
  async updateContextWithForum(content) {
    try {
      var data = (typeof content === 'string') ? JSON.parse(content) : content;
      await ConfigManager.set('xb.forum.threads', JSON.stringify(data));
      console.log('[ForumManager] 论坛数据已写入变量');
      return true;
    } catch (e) {
      console.error('[ForumManager] 写入论坛变量失败:', e);
      return false;
    }
  }

  /**
   * 智能合并论坛内容
   * @param {string} existingForumContent - 现有的论坛内容（JSON字符串或数组）
   * @param {string} newForumContent - 新生成的论坛内容（JSON字符串或数组）
   * @returns {Array} 合并后的论坛数据数组
   */
  async mergeForumContent(existingForumContent, newForumContent) {
    try {
      console.log('[Forum Manager] 🔄 开始智能合并论坛内容...');

      // 解析现有内容
      let existingData;
      if (typeof existingForumContent === 'string') {
        try {
          existingData = JSON.parse(existingForumContent);
        } catch (e) {
          // 如果不是JSON，尝试用旧的文本格式解析
          existingData = this.parseForumContent(existingForumContent);
          existingData = existingData.threads || [];
        }
      } else {
        existingData = Array.isArray(existingForumContent) ? existingForumContent : [];
      }

      // 解析新内容
      let newData;
      if (typeof newForumContent === 'string') {
        try {
          newData = JSON.parse(newForumContent);
        } catch (e) {
          // 如果不是JSON，尝试用旧的文本格式解析
          newData = this.parseForumContent(newForumContent);
          newData = newData.threads || [];
        }
      } else {
        newData = Array.isArray(newForumContent) ? newForumContent : [];
      }

      console.log('[Forum Manager] 📋 现有帖子数:', existingData.length);
      console.log('[Forum Manager] 📋 新帖子数:', newData.length);

      // 合并逻辑
      const mergedThreads = new Map();

      // 1. 先添加所有现有帖子
      existingData.forEach(thread => {
        mergedThreads.set(thread.id, thread);
      });

      // 2. 处理新内容
      const currentTime = new Date();
      newData.forEach(newThread => {
        if (mergedThreads.has(newThread.id)) {
          // 如果是现有帖子，合并回复
          console.log(`[Forum Manager] 📝 发现对现有帖子 ${newThread.id} 的内容，合并回复...`);
          const existingThread = mergedThreads.get(newThread.id);

          // 合并回复
          if (newThread.replies && newThread.replies.length > 0) {
            if (!existingThread.replies) {
              existingThread.replies = [];
            }

            newThread.replies.forEach(newReply => {
              // 简单的重复检测：相同作者和相似内容
              const isDuplicate = existingThread.replies.some(
                existingReply =>
                  existingReply.author === newReply.author &&
                  existingReply.content &&
                  newReply.content &&
                  existingReply.content.includes(newReply.content.substring(0, 20)),
              );

              if (!isDuplicate) {
                // 为新回复设置当前时间戳
                newReply.timestamp = newReply.timestamp || currentTime.getTime();
                existingThread.replies.push(newReply);
                console.log(`[Forum Manager] 💬 添加新回复到帖子 ${newThread.id}: ${newReply.author}`);
              }
            });
          }
        } else {
          // 如果是新帖子，直接添加
          console.log(`[Forum Manager] ✨ 添加新帖子: ${newThread.id}`);
          if (!newThread.timestamp) {
            newThread.timestamp = currentTime.getTime();
          }
          mergedThreads.set(newThread.id, newThread);
        }
      });

      const mergedArray = Array.from(mergedThreads.values());

      console.log('[Forum Manager] ✅ 论坛内容合并完成，合并后帖子数:', mergedArray.length);

      return mergedArray;
    } catch (error) {
      console.error('[Forum Manager] ❌ 合并论坛内容失败:', error);
      // 如果合并失败，返回新内容
      if (typeof newForumContent === 'string') {
        try {
          return JSON.parse(newForumContent);
        } catch (e) {
          return [];
        }
      }
      return Array.isArray(newForumContent) ? newForumContent : [];
    }
  }

  /**
   * 解析论坛内容
   * @param {string} forumContent - 论坛内容文本
   * @returns {object} 解析后的数据 {threads: [], replies: {}}
   */
  parseForumContent(forumContent) {
    const threads = [];
    const replies = {};

    if (!forumContent || forumContent.trim() === '') {
      return { threads, replies };
    }

    // 解析标题格式: [标题|发帖人昵称|帖子id|标题内容|帖子详情]
    const titleRegex = /\[标题\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;
    // 解析回复格式: [回复|回帖人昵称|帖子id|回复内容]
    const replyRegex = /\[回复\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;
    // 解析楼中楼格式: [楼中楼|回帖人昵称|帖子id|父楼层|回复内容]
    const subReplyRegex = /\[楼中楼\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;

    let match;

    // 解析标题
    let threadIndex = 0;
    while ((match = titleRegex.exec(forumContent)) !== null) {
      // 为现有帖子设置递增的时间戳，保持原有顺序
      const baseTime = new Date('2024-01-01 10:00:00');
      const threadTime = new Date(baseTime.getTime() + threadIndex * 60000); // 每个帖子间隔1分钟

      const thread = {
        id: match[2],
        author: match[1],
        title: match[3],
        content: match[4],
        timestamp: threadTime.toLocaleString(),
        latestActivityTime: threadTime, // 初始活动时间等于发布时间
      };

      threads.push(thread);
      replies[thread.id] = [];
      threadIndex++;
    }

    // 解析普通回复
    let replyIndex = 0;
    while ((match = replyRegex.exec(forumContent)) !== null) {
      // 为现有回复设置递增的时间戳，保持原有顺序
      const baseTime = new Date('2024-01-01 11:00:00');
      const replyTime = new Date(baseTime.getTime() + replyIndex * 30000); // 每个回复间隔30秒

      const reply = {
        id: `reply_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        threadId: match[2],
        author: match[1],
        content: match[3],
        timestamp: replyTime.toLocaleString(),
        type: 'reply',
        subReplies: [],
      };

      if (replies[reply.threadId]) {
        replies[reply.threadId].push(reply);

        // 更新对应帖子的最新活动时间
        const thread = threads.find(t => t.id === reply.threadId);
        if (thread && replyTime > thread.latestActivityTime) {
          thread.latestActivityTime = replyTime;
        }
      }
      replyIndex++;
    }

    // 解析楼中楼回复
    let subReplyIndex = 0;
    while ((match = subReplyRegex.exec(forumContent)) !== null) {
      // 为现有楼中楼回复设置递增的时间戳
      const baseTime = new Date('2024-01-01 12:00:00');
      const subReplyTime = new Date(baseTime.getTime() + subReplyIndex * 15000); // 每个楼中楼回复间隔15秒

      const subReply = {
        id: `subreply_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        threadId: match[2],
        author: match[1],
        content: match[4],
        parentFloor: match[3],
        timestamp: subReplyTime.toLocaleString(),
        type: 'subreply',
      };

      // 查找父回复并添加到其子回复中
      if (replies[subReply.threadId]) {
        const parentReply = replies[subReply.threadId].find(r => r.author === subReply.parentFloor);
        if (parentReply) {
          if (!parentReply.subReplies) {
            parentReply.subReplies = [];
          }
          parentReply.subReplies.push(subReply);
        } else {
          // 如果找不到父楼层，作为普通回复处理
          subReply.type = 'reply';
          subReply.subReplies = [];
          replies[subReply.threadId].push(subReply);
        }

        // 更新对应帖子的最新活动时间
        const thread = threads.find(t => t.id === subReply.threadId);
        if (thread && subReplyTime > thread.latestActivityTime) {
          thread.latestActivityTime = subReplyTime;
        }
      }
      subReplyIndex++;
    }

    return { threads, replies };
  }

  /**
   * 构建论坛内容
   * @param {Map} threadsMap - 帖子Map
   * @param {Map} repliesMap - 回复Map
   * @returns {string} 构建的论坛内容（JSON字符串）
   */
  buildForumContent(threadsMap, repliesMap) {
    const threads = Array.from(threadsMap.values()).map(thread => {
      const threadReplies = repliesMap.get(thread.id) || [];
      return {
        ...thread,
        replies: threadReplies,
      };
    });

    return JSON.stringify(threads);
  }

  /**
   * 获取当前论坛内容
   * @returns {string} 当前的论坛内容（JSON字符串）
   */
  async getCurrentForumContent() {
    try {
      var raw = await ConfigManager.get('xb.forum.threads');
      if (raw) {
        return (typeof raw === 'string') ? raw : JSON.stringify(raw);
      }
      return '[]';
    } catch (error) {
      console.error('[Forum Manager] 获取当前论坛内容失败:', error);
      return '[]';
    }
  }

  /**
   * 清除论坛内容
   */
  async clearForumContent() {
    try {
      this.updateStatus('正在清除论坛内容...', 'info');

      await ConfigManager.set('xb.forum.threads', '[]');
      this.updateStatus('论坛内容已清除', 'success');
      console.log('[Forum Manager] ✅ 论坛变量已清除');

      // 立即重置处理状态 - 兼容Safari
      this.isProcessing = false;

      // 重置auto-listener状态 - 确保不会被阻止
      if (window.forumAutoListener) {
        window.forumAutoListener.isProcessingRequest = false;
      }

      // 刷新论坛UI界面以反映数据变化
      this.clearForumUICache();

      console.log('[Forum Manager] 🔄 清除完成，状态已重置（兼容Safari）');
    } catch (error) {
      console.error('[Forum Manager] 清除论坛内容失败:', error);
      this.updateStatus(`清除失败: ${error.message}`, 'error');

      // 确保状态被重置 - 立即重置，不依赖setTimeout
      this.isProcessing = false;
      if (window.forumAutoListener) {
        window.forumAutoListener.isProcessingRequest = false;
      }
    } finally {
      // Safari兼容性：立即重置而不是延迟重置
      this.isProcessing = false;
      if (window.forumAutoListener) {
        window.forumAutoListener.isProcessingRequest = false;
      }

      // 额外的保险：仍然保留延迟重置作为最后保障
      setTimeout(() => {
        this.isProcessing = false;
        if (window.forumAutoListener) {
          window.forumAutoListener.isProcessingRequest = false;
        }
        console.log('[Forum Manager] 🛡️ 延迟状态重置完成（最后保障）');
      }, 500); // 减少到500ms，提升响应速度
    }
  }

  /**
   * 刷新论坛UI界面
   */
  clearForumUICache() {
    try {
      // 刷新论坛UI界面，因为论坛UI现在没有缓存数据，只需要重新渲染即可
      if (window.forumUI && window.forumUI.refreshThreadList) {
        window.forumUI.refreshThreadList();
        console.log('[Forum Manager] ✅ 论坛UI界面已刷新');
      }

      // 如果有其他论坛UI实例，也刷新它们
      if (window.mobileForumUI && window.mobileForumUI.refreshThreadList) {
        window.mobileForumUI.refreshThreadList();
        console.log('[Forum Manager] ✅ 移动论坛UI界面已刷新');
      }

      // 清除localStorage中的论坛相关数据（如果有）
      const forumDataKeys = ['mobile_forum_threads', 'mobile_forum_replies', 'mobile_forum_cache'];

      forumDataKeys.forEach(key => {
        if (localStorage.getItem(key)) {
          localStorage.removeItem(key);
          console.log(`[Forum Manager] ✅ 已清除localStorage中的${key}`);
        }
      });
    } catch (error) {
      console.warn('[Forum Manager] 刷新论坛UI界面时出现警告:', error);
    }
  }

  /**
   * 发送回复到API
   */
  async sendReplyToAPI(replyFormat) {
    try {
      console.log('💬 [回复API] ===== 开始发送用户回复 =====');
      this.updateStatus('正在发送回复...', 'info');

      // 检查API配置
      if (!window.mobileCustomAPIConfig || !window.mobileCustomAPIConfig.isAPIAvailable()) {
        throw new Error('请先配置API');
      }

      // 获取当前聊天数据
      const chatData = await this.getCurrentChatData();
      if (!chatData || !chatData.messages || chatData.messages.length === 0) {
        throw new Error('无法获取聊天数据');
      }

      // 构建上下文信息
      const contextInfo = this.buildContextInfo(chatData);

      // 获取风格提示词（用户回复）
      const stylePrompt = window.forumStyles
        ? window.forumStyles.getStylePrompt(this.currentSettings.selectedStyle, 'reply')
        : '';

      console.log('📋 [回复API] 系统提示词（用户回复）:');
      console.log(stylePrompt);
      console.log('\n💭 [回复API] 用户回复内容:');
      console.log(replyFormat);
      console.log('\n📝 [回复API] 完整用户消息:');
      const userMessage = `🎯 请根据以下聊天记录和用户回复，生成包含用户回复和AI回复的完整论坛内容：

📋 聊天记录：
${contextInfo}

💬 用户新发布的回复：
${replyFormat}

🎯 【重要要求】：
1. 必须在论坛内容中包含用户刚发布的回复
2. 基于用户回复生成其他网友的回复和互动
3. 保持论坛的活跃氛围和真实感
4. 生成完整的论坛内容，包括原有帖子、用户回复、以及AI生成的其他回复
5. 确保用户的回复在论坛中得到合理的回应和互动`;
      console.log(userMessage);

      // 构建API请求，包含用户的回复
      const messages = [
        {
          role: 'system',
          content: `${stylePrompt}\n\n🎯 【回复处理特别指令】：\n- 你正在处理用户的论坛回复\n- 必须生成包含用户回复的完整论坛内容\n- 用户的回复应该得到其他网友的回应和互动\n- 保持论坛的真实感和活跃度\n- 生成的内容应该是完整的论坛页面，不是追加内容`,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ];

      console.log('📡 [回复API] 完整API请求:');
      console.log(JSON.stringify(messages, null, 2));

      // 调用API
      const response = await window.mobileCustomAPIConfig.callAPI(messages, {
        temperature: 0.8,
        max_tokens: 2000,
      });

      console.log('📥 [回复API] 模型返回内容:');
      console.log(response);

      if (response && response.content) {
        console.log('✅ [回复API] 更新后的论坛内容:');
        console.log(response.content);

        // 安全更新论坛内容（带生成状态检查）
        const success = await this.safeUpdateContextWithForum(response.content);
        if (success) {
          this.updateStatus('回复已发送并更新论坛内容', 'success');
          this.clearForumUICache(); // 刷新UI
          console.log('🏁 [回复API] ===== 用户回复处理完成 =====\n');
          return true;
        } else {
          throw new Error('更新论坛内容失败');
        }
      } else {
        throw new Error('API返回格式错误');
      }
    } catch (error) {
      console.error('❌ [回复API] 发送回复失败:', error);
      console.log('🏁 [回复API] ===== 用户回复处理失败 =====\n');
      this.updateStatus(`发送回复失败: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 发送新帖到API
   */
  async sendPostToAPI(postFormat) {
    try {
      console.log('📝 [发帖API] ===== 开始发布新帖 =====');
      this.updateStatus('正在发布帖子...', 'info');

      // 检查API配置
      if (!window.mobileCustomAPIConfig || !window.mobileCustomAPIConfig.isAPIAvailable()) {
        throw new Error('请先配置API');
      }

      // 获取当前聊天数据
      const chatData = await this.getCurrentChatData();
      if (!chatData || !chatData.messages || chatData.messages.length === 0) {
        throw new Error('无法获取聊天数据');
      }

      // 构建上下文信息
      const contextInfo = this.buildContextInfo(chatData);

      // 获取风格提示词（用户发帖）
      const stylePrompt = window.forumStyles
        ? window.forumStyles.getStylePrompt(this.currentSettings.selectedStyle, 'post')
        : '';

      console.log('📋 [发帖API] 系统提示词（用户发帖）:');
      console.log(stylePrompt);
      console.log('\n📝 [发帖API] 用户发布的帖子:');
      console.log(postFormat);
      console.log('\n📝 [发帖API] 完整用户消息:');
      const userMessage = `请根据以下聊天记录和用户发布的新帖子，更新论坛内容：\n\n${contextInfo}\n\n用户发布的新帖子：${postFormat}`;
      console.log(userMessage);

      // 构建API请求，包含用户的新帖
      const messages = [
        {
          role: 'system',
          content: stylePrompt,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ];

      console.log('📡 [发帖API] 完整API请求:');
      console.log(JSON.stringify(messages, null, 2));

      // 调用API
      const response = await window.mobileCustomAPIConfig.callAPI(messages, {
        temperature: 0.8,
        max_tokens: 2000,
      });

      console.log('📥 [发帖API] 模型返回内容:');
      console.log(response);

      if (response && response.content) {
        console.log('✅ [发帖API] 更新后的论坛内容:');
        console.log(response.content);

        // 安全更新论坛内容（带生成状态检查）
        const success = await this.safeUpdateContextWithForum(response.content);
        if (success) {
          this.updateStatus('帖子已发布并更新论坛内容', 'success');
          this.clearForumUICache(); // 刷新UI
          console.log('🏁 [发帖API] ===== 新帖发布完成 =====\n');
          return true;
        } else {
          throw new Error('更新论坛内容失败');
        }
      } else {
        throw new Error('API返回格式错误');
      }
    } catch (error) {
      console.error('❌ [发帖API] 发布帖子失败:', error);
      console.log('🏁 [发帖API] ===== 新帖发布失败 =====\n');
      this.updateStatus(`发布帖子失败: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 直接将回复插入到论坛变量中（带生成状态检查）
   */
  async insertReplyToFirstLayer(replyPrefix, replyFormat) {
    try {
      console.log('[Forum Manager] 🔒 开始安全插入回复到论坛变量...');

      // 检查是否正在生成
      if (this.checkGenerationStatus()) {
        console.log('[Forum Manager] ⚠️ 检测到SillyTavern正在生成回复，将回复加入队列...');
        return this.queueInsertion('reply', replyFormat, { replyPrefix, replyFormat });
      }

      this.updateStatus('正在插入回复...', 'info');

      // 从变量中读取当前论坛数据
      var raw = await ConfigManager.get('xb.forum.threads');
      var threads = [];
      if (raw) {
        var data = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        threads = Array.isArray(data) ? data : [];
      }

      // 解析回复格式，提取帖子ID和回复内容
      // 格式: [回复|回帖人昵称|帖子id|回复内容]
      const replyRegex = /\[回复\|([^|]+)\|([^|]+)\|([^\]]+)\]/;
      const replyMatch = replyFormat.match(replyRegex);

      if (replyMatch) {
        const replyAuthor = replyMatch[1];
        const threadId = replyMatch[2];
        const replyContent = replyMatch[3];

        // 找到对应的帖子
        const thread = threads.find(t => t.id === threadId);
        if (thread) {
          if (!thread.replies) {
            thread.replies = [];
          }
          thread.replies.push({
            id: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            author: replyAuthor,
            content: replyContent,
            timestamp: Date.now(),
            type: 'reply',
            subReplies: [],
          });

          // 写回变量
          await ConfigManager.set('xb.forum.threads', JSON.stringify(threads));
          this.updateStatus('回复已插入到论坛变量', 'success');
          console.log('[Forum Manager] ✅ 回复已插入到论坛变量');

          // 刷新UI
          this.clearForumUICache();
          return true;
        } else {
          console.warn('[Forum Manager] 未找到对应的帖子:', threadId);
          this.updateStatus('未找到对应的帖子', 'warning');
          return false;
        }
      }

      // 如果无法解析回复格式，尝试直接追加到变量
      console.warn('[Forum Manager] 无法解析回复格式，直接追加');
      await ConfigManager.set('xb.forum.threads', JSON.stringify(threads));
      this.clearForumUICache();
      return true;
    } catch (error) {
      console.error('[Forum Manager] 插入回复失败:', error);
      this.updateStatus(`插入回复失败: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 检查是否需要自动生成论坛内容
   */
  async checkAutoGenerate() {
    // 检查基本条件
    if (!this.currentSettings.autoUpdate || this.isProcessing) {
      return false;
    }

    // 检查auto-listener是否正在处理
    if (window.forumAutoListener && window.forumAutoListener.isProcessingRequest) {
      console.log('[Forum Manager] Auto-listener正在处理，跳过检查');
      return false;
    }

    try {
      const chatData = await this.getCurrentChatData();
      if (!chatData || !chatData.messages) {
        return false;
      }

      const currentCount = chatData.messages.length;
      const increment = currentCount - this.lastProcessedCount;

      console.log(
        `[Forum Manager] 检查自动生成条件: 当前消息数=${currentCount}, 已处理=${this.lastProcessedCount}, 增量=${increment}, 阈值=${this.currentSettings.threshold}`,
      );

      if (increment >= this.currentSettings.threshold) {
        console.log(`[Forum Manager] 自动触发论坛生成 (增量: ${increment})`);
        const result = await this.generateForumContent();
        return result;
      } else {
        console.log(`[Forum Manager] 增量不足，未触发自动生成`);
        return false;
      }
    } catch (error) {
      console.error('[Forum Manager] 自动检查失败:', error);
      return false;
    }
  }

  /**
   * 更新状态显示
   */
  updateStatus(message, type = 'info') {
    const statusEl = document.getElementById('forum-status');
    if (statusEl) {
      const colors = {
        info: '#3498db',
        success: '#27ae60',
        warning: '#f39c12',
        error: '#e74c3c',
      };

      statusEl.textContent = `状态: ${message}`;
      statusEl.style.color = colors[type] || colors.info;
    }

    console.log(`[Forum Manager] ${message}`);
  }

  /**
   * 保存设置
   */
  saveSettings() {
    try {
      localStorage.setItem('mobile_forum_settings', JSON.stringify(this.currentSettings));
      console.log('[Forum Manager] 设置已保存');
    } catch (error) {
      console.error('[Forum Manager] 保存设置失败:', error);
    }
  }

  /**
   * 加载设置
   */
  loadSettings() {
    try {
      const saved = localStorage.getItem('mobile_forum_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.currentSettings = { ...this.currentSettings, ...parsed };
        console.log('[Forum Manager] 设置已加载:', this.currentSettings);
      }
    } catch (error) {
      console.error('[Forum Manager] 加载设置失败:', error);
    }
  }

  /**
   * 注册控制台命令
   */
  registerConsoleCommands() {
    // 创建全局命令对象
    if (!window.MobileContext) {
      window.MobileContext = {};
    }

    // 论坛管理命令
    window.MobileContext.generateForum = (force = true) => this.generateForumContent(force); // 控制台命令默认强制生成
    window.MobileContext.forceGenerateForum = () => this.generateForumContent(true); // 专门的强制生成命令
    window.MobileContext.autoGenerateForum = () => this.generateForumContent(false); // 按规则自动生成
    window.MobileContext.showForum = () => this.showForumPanel();
    window.MobileContext.clearForum = () => this.clearForumContent();
    window.MobileContext.showForumPanel = () => this.showForumPanel();
    window.MobileContext.clearForumCache = () => this.clearForumUICache();
    window.MobileContext.sendReply = replyFormat => this.sendReplyToAPI(replyFormat);
    window.MobileContext.insertReply = (prefix, format) => this.insertReplyToFirstLayer(prefix, format);
    window.MobileContext.sendPost = postFormat => this.sendPostToAPI(postFormat);
    window.MobileContext.getForumStatus = () => this.getStatus();
    window.MobileContext.forceReset = () => this.forceReset(); // 注册强制重置命令

    // 新增：调试和测试命令
    window.MobileContext.testForceGenerate = () => {
      console.log('[Test] 🧪 测试强制生成功能...');
      return this.generateForumContent(true);
    };
    window.MobileContext.testDuplicateProtection = () => this.testDuplicateProtection();
    window.MobileContext.getListenerStatus = () => this.getListenerStatus();
    window.MobileContext.resetForumState = () => this.resetForumState();
    window.MobileContext.simulateMessageSpam = (count = 10) => this.simulateMessageSpam(count);

    // 浏览器兼容性命令
    window.MobileContext.fixBrowserCompatibility = () => this.fixBrowserCompatibility();
    window.MobileContext.quickDiagnosis = () => this.quickDiagnosis();

    // 生成状态监控命令
    window.MobileContext.checkGenerating = () => this.checkGenerationStatus();
    window.MobileContext.getQueueStatus = () => this.getQueueStatus();
    window.MobileContext.clearQueue = () => this.clearQueue();
    window.MobileContext.forceStopQueue = () => this.stopInsertionQueueProcessor();

    // 论坛内容合并测试命令
    window.MobileContext.testMergeContent = (existing, newContent) => this.mergeForumContent(existing, newContent);
    window.MobileContext.parseForumContent = content => this.parseForumContent(content);
    window.MobileContext.buildForumContent = (threads, replies) => this.buildForumContent(threads, replies);
    window.MobileContext.getCurrentForumContent = () => this.getCurrentForumContent();

    // 自动监听器命令
    window.MobileContext.startAutoListener = () => {
      if (window.forumAutoListener) {
        window.forumAutoListener.start();
      }
    };
    window.MobileContext.stopAutoListener = () => {
      if (window.forumAutoListener) {
        window.forumAutoListener.stop();
      }
    };
    window.MobileContext.getAutoListenerDebug = () => {
      if (window.forumAutoListener) {
        return window.forumAutoListener.getDebugInfo();
      }
    };

    // 帮助命令
    console.log('🚀 [论坛管理器] 控制台命令已注册:');
    console.log('');
    console.log('📝 [基本命令]:');
    console.log('  - MobileContext.generateForum(force=true) // 生成论坛内容（默认强制）');
    console.log('  - MobileContext.forceGenerateForum() // 强制生成论坛内容（无视阈值）');
    console.log('  - MobileContext.autoGenerateForum() // 按规则自动生成（检查阈值）');
    console.log('  - MobileContext.showForum() // 显示论坛面板');
    console.log('  - MobileContext.clearForum() // 清除论坛内容');
    console.log('  - MobileContext.showForumPanel() // 显示论坛面板');
    console.log('  - MobileContext.clearForumCache() // 刷新论坛界面');
    console.log('  - MobileContext.sendReply(replyFormat) // 发送回复');
    console.log('  - MobileContext.insertReply(prefix, format) // 直接插入回复到第一层');
    console.log('  - MobileContext.sendPost(postFormat) // 发送新帖');
    console.log('  - MobileContext.getForumStatus() // 获取论坛状态');
    console.log('  - MobileContext.forceReset() // 强制重置所有状态');
    console.log('');
    console.log('🔧 [调试和测试命令]:');
    console.log('  - MobileContext.testForceGenerate() // 测试强制生成功能');
    console.log('  - MobileContext.testDuplicateProtection() // 测试重复请求防护');
    console.log('  - MobileContext.getListenerStatus() // 获取监听器状态');
    console.log('  - MobileContext.resetForumState() // 重置论坛状态');
    console.log('  - MobileContext.simulateMessageSpam(count) // 模拟消息轰炸测试');
    console.log('');
    console.log('🍎 [浏览器兼容性命令]:');
    console.log('  - MobileContext.fixBrowserCompatibility() // 修复Safari/Via兼容性问题');
    console.log('  - MobileContext.quickDiagnosis() // 快速诊断按钮无响应问题');
    console.log('');
    console.log('🎧 [自动监听器命令]:');
    console.log('  - MobileContext.startAutoListener() // 启动自动监听器');
    console.log('  - MobileContext.stopAutoListener() // 停止自动监听器');
    console.log('  - MobileContext.getAutoListenerDebug() // 获取监听器调试信息');
    console.log('');
    console.log('📊 [生成状态监控命令]:');
    console.log('  - MobileContext.checkGenerating() // 检查SillyTavern是否正在生成');
    console.log('  - MobileContext.getQueueStatus() // 获取插入队列状态');
    console.log('  - MobileContext.clearQueue() // 清空插入队列');
    console.log('  - MobileContext.forceStopQueue() // 强制停止队列处理器');
    console.log('');
    console.log('� [论坛内容合并命令]:');
    console.log('  - MobileContext.getCurrentForumContent() // 获取当前论坛内容');
    console.log('  - MobileContext.parseForumContent(content) // 解析论坛内容');
    console.log('  - MobileContext.buildForumContent(threads, replies) // 构建论坛内容');
    console.log('  - MobileContext.testMergeContent(existing, newContent) // 测试内容合并');
    console.log('');
    console.log('�📄 [论坛管理器] 📄 所有发送给模型的内容都会在控制台详细显示！');
    console.log('🔍 包含: 系统提示词、用户消息、完整API请求、模型返回内容等');
    console.log('📋 查看控制台输出可以了解论坛生成的完整过程');
    console.log('');
    console.log('📝 [发帖格式] 示例: MobileContext.sendPost("[标题|我|帖子|我的标题|我的内容]")');
    console.log('💬 [回复格式] 示例: MobileContext.sendReply("我回复帖子\'xxx\'\\n[回复|我|帖子id|回复内容]")');
    console.log('');
    console.log('🚀 [生成模式说明]:');
    console.log('  - 强制生成：立即生成，无视消息数量阈值');
    console.log('  - 自动生成：仅在消息增量达到设定阈值时生成');
    console.log('  - 立即生成按钮 = 强制生成模式');
    console.log('  - Auto-listener = 自动生成模式');
    console.log('');
    console.log('🛡️ [重复请求修复] 如果遇到重复请求问题，请运行: MobileContext.testDuplicateProtection()');
    console.log('');
    console.log('🔄 [智能合并功能] 新功能说明:');
    console.log('  - 立即生成论坛时，新内容会与历史帖子智能合并');
    console.log('  - 历史帖子会被保留，新帖子追加到后面');
    console.log('  - 如果新内容包含对历史帖子的回复，会自动插入到对应帖子中');
    console.log('  - 避免重复回复，保持论坛内容的连贯性');
    console.log('');
    console.log('🍎 [Safari/Via兼容性] 如果按钮无响应，请运行: MobileContext.fixBrowserCompatibility()');
    console.log('📊 [问题诊断] 如果遇到任何问题，请运行: MobileContext.quickDiagnosis()');
    console.log('');
  }

  /**
   * 测试重复请求防护
   */
  async testDuplicateProtection() {
    console.log('🛡️ [重复请求防护测试] 开始测试...');

    const results = [];

    // 测试1: 多次快速调用generateForumContent
    console.log('📋 测试1: 多次快速调用generateForumContent');
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(this.generateForumContent());
    }

    const testResults = await Promise.all(promises);
    const successCount = testResults.filter(r => r === true).length;

    console.log(`✅ 测试1结果: ${successCount}/5 次成功，其余被防护拦截`);
    results.push(`测试1: ${successCount}/5 次成功`);

    // 测试2: 检查状态同步
    console.log('📋 测试2: 检查状态同步');
    const managerStatus = this.isProcessing;
    const listenerStatus = window.forumAutoListener ? window.forumAutoListener.isProcessingRequest : false;

    console.log(`✅ 测试2结果: Manager处理状态=${managerStatus}, Listener处理状态=${listenerStatus}`);
    results.push(`测试2: Manager=${managerStatus}, Listener=${listenerStatus}`);

    // 测试3: 检查计数同步
    console.log('📋 测试3: 检查计数同步');
    const managerCount = this.lastProcessedCount;
    const listenerCount = window.forumAutoListener ? window.forumAutoListener.lastProcessedMessageCount : 0;

    console.log(`✅ 测试3结果: Manager计数=${managerCount}, Listener计数=${listenerCount}`);
    results.push(`测试3: Manager=${managerCount}, Listener=${listenerCount}`);

    console.log('🛡️ [重复请求防护测试] 完成');
    return results;
  }

  /**
   * 获取监听器状态
   */
  getListenerStatus() {
    const status = {
      forumManager: {
        isProcessing: this.isProcessing,
        lastProcessedCount: this.lastProcessedCount,
        settings: this.currentSettings,
      },
      forumAutoListener: window.forumAutoListener ? window.forumAutoListener.getDebugInfo() : null,
    };

    console.log('📊 [监听器状态]', status);
    return status;
  }

  /**
   * 重置论坛状态
   */
  resetForumState() {
    console.log('🔄 [重置论坛状态] 开始重置...');

    // 重置管理器状态
    this.isProcessing = false;
    this.lastProcessedCount = 0;

    // 重置监听器状态
    if (window.forumAutoListener) {
      window.forumAutoListener.reset();
    }

    console.log('✅ [重置论坛状态] 完成');
  }

  /**
   * 模拟消息轰炸测试
   */
  async simulateMessageSpam(count = 10) {
    console.log(`🔥 [消息轰炸测试] 模拟${count}次连续消息事件...`);

    if (!window.forumAutoListener) {
      console.log('❌ Auto-listener未找到');
      return;
    }

    const originalCount = window.forumAutoListener.lastMessageCount;

    for (let i = 0; i < count; i++) {
      window.forumAutoListener.onMessageReceived({ test: true, index: i });
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms间隔
    }

    const finalCount = window.forumAutoListener.lastMessageCount;
    console.log(`✅ [消息轰炸测试] 完成。原始计数: ${originalCount}, 最终计数: ${finalCount}`);
  }

  /**
   * 获取实例
   */
  static getInstance() {
    if (!window.forumManager) {
      window.forumManager = new ForumManager();
    }
    return window.forumManager;
  }

  /**
   * 检查SillyTavern是否正在生成回复
   */
  checkGenerationStatus() {
    try {
      // 方法1: 检查全局变量 is_send_press
      const is_send_press = window.is_send_press;
      if (is_send_press === true) {
        return true;
      }

      // 方法2: 检查 DOM 元素的 data-generating 属性
      const bodyElement = document.body;
      if (bodyElement && bodyElement.dataset.generating === 'true') {
        return true;
      }

      // 方法3: 检查是否有其他生成相关的标志
      const is_generation_stopped = window.is_generation_stopped;
      if (is_generation_stopped === false) {
        return true;
      }

      // 方法4: 检查群组生成状态（如果可用）
      const is_group_generating = window.is_group_generating;
      if (is_group_generating === true) {
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[Forum Manager] 检查生成状态时出错:', error);
      return false; // 出错时假设没有生成
    }
  }

  /**
   * 等待SillyTavern生成完成
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<boolean>} - 是否成功等待完成
   */
  async waitForGenerationComplete(timeout = this.maxWaitTime) {
    return new Promise(resolve => {
      const startTime = Date.now();
      let checkCount = 0;

      console.log('[Forum Manager] 🕐 开始等待SillyTavern生成完成...');

      const checkInterval = setInterval(() => {
        checkCount++;
        const isGenerating = this.checkGenerationStatus();
        const elapsed = Date.now() - startTime;

        // 每10次检查打印一次状态
        if (checkCount % 10 === 0) {
          console.log(`[Forum Manager] ⏳ 等待中... (${Math.round(elapsed / 1000)}s, 检查次数: ${checkCount})`);
        }

        if (!isGenerating) {
          clearInterval(checkInterval);
          console.log(`[Forum Manager] ✅ SillyTavern生成已完成! (等待时间: ${Math.round(elapsed / 1000)}s)`);
          resolve(true);
        } else if (elapsed >= timeout) {
          clearInterval(checkInterval);
          console.warn(`[Forum Manager] ⏰ 等待超时 (${Math.round(timeout / 1000)}s)，强制继续`);
          resolve(false);
        }
      }, 500); // 每500ms检查一次
    });
  }

  /**
   * 安全地更新论坛变量（带生成状态检查）
   */
  async safeUpdateContextWithForum(forumContent) {
    try {
      console.log('[Forum Manager] 🔒 开始安全更新论坛变量...');

      // 检查是否正在生成
      if (this.checkGenerationStatus()) {
        console.log('[Forum Manager] ⚠️ 检测到SillyTavern正在生成回复，等待完成...');
        this.updateStatus('等待SillyTavern生成完成...', 'warning');

        // 等待生成完成
        const waitSuccess = await this.waitForGenerationComplete();
        if (!waitSuccess) {
          console.warn('[Forum Manager] ⏰ 等待超时，但仍尝试更新');
          this.updateStatus('等待超时，尝试强制更新...', 'warning');
        }
      }

      // 再次确认生成状态
      if (this.checkGenerationStatus()) {
        console.warn('[Forum Manager] ⚠️ 生成状态仍然活跃，将消息加入队列');
        return this.queueInsertion('forum_content', forumContent);
      }

      // 读取现有论坛数据，与新生成的内容合并
      const existingRaw = await ConfigManager.get('xb.forum.threads');
      const mergedData = await this.mergeForumContent(existingRaw || '[]', forumContent);

      // 执行实际更新
      console.log('[Forum Manager] 🚀 开始更新论坛变量...');
      const result = await this.updateContextWithForum(mergedData);

      // 显示结果提示
      if (result && window.showMobileToast) {
        window.showMobileToast('✅ 论坛内容已成功更新', 'success');
      } else if (!result && window.showMobileToast) {
        window.showMobileToast('❌ 论坛内容更新失败', 'error');
      }

      return result;
    } catch (error) {
      console.error('[Forum Manager] 安全更新失败:', error);
      return false;
    }
  }

  /**
   * 将插入操作加入队列
   */
  async queueInsertion(type, content, additionalData = {}) {
    const insertion = {
      id: Date.now() + Math.random(),
      type: type,
      content: content,
      timestamp: new Date(),
      additionalData: additionalData,
    };

    this.pendingInsertions.push(insertion);
    console.log(`[Forum Manager] 📝 消息已加入队列 (ID: ${insertion.id}, 类型: ${type})`);

    this.updateStatus(`消息已加入队列，等待插入 (队列长度: ${this.pendingInsertions.length})`, 'info');

    // 开始处理队列
    this.startInsertionQueueProcessor();

    return true;
  }

  /**
   * 开始处理插入队列
   */
  startInsertionQueueProcessor() {
    if (this.isMonitoringGeneration) {
      return; // 已经在处理中
    }

    this.isMonitoringGeneration = true;
    console.log('[Forum Manager] 🎛️ 开始队列处理器...');

    this.generationCheckInterval = setInterval(async () => {
      await this.processInsertionQueue();
    }, 1000); // 每秒检查一次
  }

  /**
   * 处理插入队列
   */
  async processInsertionQueue() {
    if (this.pendingInsertions.length === 0) {
      this.stopInsertionQueueProcessor();
      return;
    }

    // 检查是否正在生成
    if (this.checkGenerationStatus()) {
      console.log(`[Forum Manager] ⏳ SillyTavern正在生成，等待... (队列: ${this.pendingInsertions.length} 项)`);
      return;
    }

    // 处理队列中的第一个项目
    const insertion = this.pendingInsertions.shift();
    if (!insertion) return;

    console.log(`[Forum Manager] 🔄 处理队列项目 (ID: ${insertion.id}, 类型: ${insertion.type})`);

    try {
      let success = false;

      switch (insertion.type) {
        case 'forum_content':
          success = await this.updateContextWithForum(insertion.content);
          break;
        case 'reply':
          const { replyPrefix, replyFormat } = insertion.additionalData;
          success = await this.insertReplyToFirstLayer(replyPrefix, replyFormat);
          break;
        default:
          console.warn(`[Forum Manager] 未知的插入类型: ${insertion.type}`);
          success = false;
      }

      if (success) {
        console.log(`[Forum Manager] ✅ 队列项目处理成功 (ID: ${insertion.id})`);
        this.updateStatus('消息插入成功', 'success');
      } else {
        console.error(`[Forum Manager] ❌ 队列项目处理失败 (ID: ${insertion.id})`);
        this.updateStatus('消息插入失败', 'error');
      }
    } catch (error) {
      console.error(`[Forum Manager] 处理队列项目时出错 (ID: ${insertion.id}):`, error);
    }

    // 如果还有项目，继续处理
    if (this.pendingInsertions.length > 0) {
      this.updateStatus(`队列处理中... (剩余: ${this.pendingInsertions.length} 项)`, 'info');
    }
  }

  /**
   * 停止队列处理器
   */
  stopInsertionQueueProcessor() {
    if (this.generationCheckInterval) {
      clearInterval(this.generationCheckInterval);
      this.generationCheckInterval = null;
    }
    this.isMonitoringGeneration = false;
    console.log('[Forum Manager] 🛑 队列处理器已停止');
  }

  /**
   * 获取队列状态
   */
  getQueueStatus() {
    return {
      isMonitoring: this.isMonitoringGeneration,
      pendingCount: this.pendingInsertions.length,
      isGenerating: this.checkGenerationStatus(),
      queue: this.pendingInsertions.map(item => ({
        id: item.id,
        type: item.type,
        timestamp: item.timestamp,
      })),
    };
  }

  /**
   * 清空队列
   */
  clearQueue() {
    this.pendingInsertions = [];
    this.stopInsertionQueueProcessor();
    console.log('[Forum Manager] 🗑️ 插入队列已清空');
    this.updateStatus('插入队列已清空', 'info');
  }

  /**
   * 更新队列状态显示
   */
  updateQueueStatusDisplay() {
    try {
      const generationStatusEl = document.getElementById('generation-status');
      const queueCountEl = document.getElementById('queue-count');

      if (generationStatusEl) {
        const isGenerating = this.checkGenerationStatus();
        generationStatusEl.textContent = isGenerating ? '🟠 正在生成' : '🟢 空闲';
        generationStatusEl.style.color = isGenerating ? '#f39c12' : '#27ae60';
      }

      if (queueCountEl) {
        queueCountEl.textContent = this.pendingInsertions.length;
        queueCountEl.style.color = this.pendingInsertions.length > 0 ? '#e74c3c' : '#95a5a6';
      }
    } catch (error) {
      console.warn('[Forum Manager] 更新队列状态显示时出错:', error);
    }
  }

  /**
   * 启动状态更新定时器
   */
  startStatusUpdateTimer() {
    // 如果已有定时器，先清除
    if (this.statusUpdateTimer) {
      clearInterval(this.statusUpdateTimer);
    }

    // 立即更新一次
    this.updateQueueStatusDisplay();

    // 设置定时更新（每2秒）
    this.statusUpdateTimer = setInterval(() => {
      this.updateQueueStatusDisplay();
    }, 2000);

    console.log('[Forum Manager] 📊 状态更新定时器已启动');
  }

  /**
   * 停止状态更新定时器
   */
  stopStatusUpdateTimer() {
    if (this.statusUpdateTimer) {
      clearInterval(this.statusUpdateTimer);
      this.statusUpdateTimer = null;
      console.log('[Forum Manager] 📊 状态更新定时器已停止');
    }
  }

  /**
   * 强制重置所有状态 - 用于解决按钮卡住问题
   */
  async forceReset() {
    console.log('[Forum Manager] 🔄 执行强制重置...');

    // 重置所有状态标志
    this.isProcessing = false;
    this.isMonitoringGeneration = false;

    // 清除所有定时器
    if (this.generationCheckInterval) {
      clearInterval(this.generationCheckInterval);
      this.generationCheckInterval = null;
    }

    if (this.statusUpdateTimer) {
      clearTimeout(this.statusUpdateTimer);
      this.statusUpdateTimer = null;
    }

    // 清空队列
    if (this.pendingInsertions) {
      this.pendingInsertions = [];
    }

    // 停止队列处理器
    this.stopInsertionQueueProcessor();

    // 重置计数器到当前消息数量
    await this.resetMessageCounts();

    // 重置auto-listener状态
    if (window.forumAutoListener) {
      window.forumAutoListener.isProcessingRequest = false;
      // 同时重置auto-listener的消息计数
      try {
        const chatData = await this.getCurrentChatData();
        if (chatData && chatData.messages && window.forumAutoListener) {
          const currentCount = chatData.messages.length;
          window.forumAutoListener.lastProcessedMessageCount = currentCount;
          window.forumAutoListener.lastMessageCount = currentCount;
          console.log(`[Forum Manager] 🔄 已同步auto-listener消息计数: ${currentCount}`);
        }
      } catch (err) {
        console.warn('[Forum Manager] 同步消息计数失败:', err);
      }
    }

    // 更新状态显示
    this.updateStatus('已强制重置所有状态', 'success');

    console.log('[Forum Manager] ✅ 强制重置完成');

    return true;
  }

  /**
   * 浏览器兼容性检测和修复
   */
  async fixBrowserCompatibility() {
    console.log('[Forum Manager] 🍎 开始浏览器兼容性检测...');

    const userAgent = navigator.userAgent;
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isVia = /Via/.test(userAgent);
    const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);

    console.log(`[Forum Manager] 浏览器信息:`, {
      userAgent: userAgent,
      isSafari: isSafari,
      isVia: isVia,
      isMobile: isMobile,
      currentProcessingState: this.isProcessing,
    });

    // Safari/Via 特殊处理
    if (isSafari || isVia) {
      console.log('[Forum Manager] 🔧 检测到Safari/Via浏览器，应用兼容性修复...');

      // 1. 强制重置状态
      this.isProcessing = false;
      if (window.forumAutoListener) {
        window.forumAutoListener.isProcessingRequest = false;
      }

      // 2. 清除可能卡住的定时器
      if (this.statusUpdateTimer) {
        clearTimeout(this.statusUpdateTimer);
        this.statusUpdateTimer = null;
      }

      // 3. 立即更新状态显示
      this.updateStatus('Safari/Via兼容性修复完成', 'success');

      console.log('[Forum Manager] ✅ Safari/Via兼容性修复完成');
      return true;
    } else {
      console.log('[Forum Manager] ℹ️ Chrome浏览器，无需特殊兼容性处理');
      return false;
    }
  }

  /**
   * 快速诊断方法 - 用于排查按钮无响应问题
   */
  quickDiagnosis() {
    const status = {
      timestamp: new Date().toISOString(),
      browser: navigator.userAgent,
      states: {
        isProcessing: this.isProcessing,
        isMonitoringGeneration: this.isMonitoringGeneration,
        pendingInsertionsCount: this.pendingInsertions.length,
        lastProcessedCount: this.lastProcessedCount,
      },
      timers: {
        generationCheckInterval: !!this.generationCheckInterval,
        statusUpdateTimer: !!this.statusUpdateTimer,
      },
      autoListener: window.forumAutoListener
        ? {
            isListening: window.forumAutoListener.isListening,
            isProcessingRequest: window.forumAutoListener.isProcessingRequest,
            lastProcessedMessageCount: window.forumAutoListener.lastProcessedMessageCount,
          }
        : null,
    };

    console.log('[Forum Manager] 📊 快速诊断结果:', status);
    return status;
  }

  /**
   * 重置消息计数器
   */
  async resetMessageCounts() {
    try {
      const chatData = await this.getCurrentChatData();
      if (chatData && chatData.messages) {
        const currentCount = chatData.messages.length;
        this.lastProcessedCount = currentCount;
        console.log(`[Forum Manager] 🔄 已重置消息计数: ${currentCount}`);
      }
    } catch (error) {
      console.warn('[Forum Manager] 重置消息计数失败:', error);
    }
  }

  /**
   * 获取调试信息
   */
  getDebugInfo() {
    return {
      isInitialized: this.isInitialized,
      isProcessing: this.isProcessing,
      lastProcessedCount: this.lastProcessedCount,
      currentSettings: this.currentSettings,
      isMonitoringGeneration: this.isMonitoringGeneration,
      pendingInsertionsCount: this.pendingInsertions ? this.pendingInsertions.length : 0,
      autoListenerStatus: window.forumAutoListener
        ? {
            isListening: window.forumAutoListener.isListening,
            isProcessingRequest: window.forumAutoListener.isProcessingRequest,
            lastProcessedMessageCount: window.forumAutoListener.lastProcessedMessageCount,
          }
        : null,
    };
  }
}

// 创建全局实例
window.forumManager = ForumManager.getInstance();

// 智能初始化：确保论坛管理器在动态加载时也能正确初始化
function initializeForumManager() {
  if (window.forumManager && !window.forumManager.isInitialized) {
    console.log('[Forum Manager] 开始初始化论坛管理器...');
    window.forumManager.initialize();
  }
}

// 如果DOM已经加载完成，立即初始化；否则等待DOMContentLoaded
if (document.readyState === 'loading') {
  console.log('[Forum Manager] DOM正在加载，等待DOMContentLoaded事件');
  document.addEventListener('DOMContentLoaded', initializeForumManager);
} else {
  console.log('[Forum Manager] DOM已加载完成，立即初始化');
  // 使用setTimeout确保模块完全加载后再初始化
  setTimeout(initializeForumManager, 0);
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ForumManager;
}
