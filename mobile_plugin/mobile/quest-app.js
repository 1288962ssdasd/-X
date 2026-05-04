/**
 * quest-app.js - 动态任务系统手机UI模块
 *
 * SillyTavern外置手机3.0插件
 * 依赖: window.QuestEngine, window.BridgeAPI, window.RoleAPI, window.mobilePhone
 *
 * 兼容要求:
 *   - 不使用 ES Module、顶层 await
 *   - 不使用 optional chaining (?.)、nullish coalescing (??)
 *   - 使用 IIFE + var/function 声明
 */
(function () {
  'use strict';

  /* ============================================================
   *  常量 & 配置
   * ============================================================ */
  var QUEST_TYPES = ['main', 'side', 'daily', 'event']; // 任务类型枚举
  var STEP_TYPES  = ['travel', 'dialogue', 'shopping', 'gift', 'investigate', 'wait', 'select', 'custom'];

  /** 任务类型中文标签 */
  var TYPE_LABELS = {
    main:  '主线',
    side:  '支线',
    daily: '日常',
    event: '事件'
  };

  /** 任务类型图标 (FontAwesome class) */
  var TYPE_ICONS = {
    main:  'fa-solid fa-crown',
    side:  'fa-solid fa-scroll',
    daily: 'fa-solid fa-rotate',
    event: 'fa-solid fa-bolt'
  };

  /** 步骤类型图标 */
  var STEP_ICONS = {
    travel:      'fa-solid fa-location-dot',
    dialogue:    'fa-solid fa-comments',
    shopping:    'fa-solid fa-cart-shopping',
    gift:        'fa-solid fa-gift',
    investigate: 'fa-solid fa-magnifying-glass',
    wait:        'fa-solid fa-hourglass-half',
    select:      'fa-solid fa-code-branch',
    custom:      'fa-solid fa-puzzle-piece'
  };

  /** 步骤类型中文标签 */
  var STEP_LABELS = {
    travel:      '前往地点',
    dialogue:    'NPC对话',
    shopping:    '购物',
    gift:        '送礼',
    investigate: '调查',
    wait:        '等待',
    select:      '选择',
    custom:      '自定义'
  };

  /** 任务状态中文标签 */
  var STATUS_LABELS = {
    available:   '可接取',
    active:      '进行中',
    reward:      '待领奖',
    completable: '待领奖',
    completed:   '已完成',
    failed:      '已失败',
    abandoned:   '已放弃'
  };

  /** 优先级标签 */
  var PRIORITY_LABELS = {
    high:   '高',
    medium: '中',
    low:    '低'
  };

  /* ============================================================
   *  QuestApp 类
   * ============================================================ */
  function QuestApp() {
    // ---- 视图状态 ----
    this.currentView    = 'main';   // main / detail / interaction
    this.currentCategory = 'all';   // all / main / side / daily / event
    this.selectedQuest  = null;     // 当前查看的任务ID
    this.selectedStep   = null;     // 当前交互的步骤索引
    this.viewStack      = [];       // 导航栈，用于 goBack

    // ---- 数据 ----
    this.registry     = [];         // 任务注册表（全部任务定义）
    this.activeQuests = {};         // 进行中的任务状态 { questId: questState }

    // ---- UI状态 ----
    this.isRefreshing  = false;
    this.typingTimer   = null;      // 打字机效果定时器
    this.waitTimer     = null;      // 等待步骤倒计时定时器
    this.travelTimer   = null;      // 前往动画定时器
  }

  /* ----------------------------------------------------------
   *  初始化
   * ---------------------------------------------------------- */
  QuestApp.prototype.init = function () {
    var self = this;
    self.refreshData().then(function () {
      self.bindEvents();
      self.updateHeader();
    });
    self._setupChatChangeListener();
    // [修复v3] 监听 QuestEngine 事件，实时响应任务变化自动刷新面板
    self._setupQuestEngineListener();
  };

  /**
   * [修复v3] 监听 QuestEngine 事件
   * 当任务注册、状态变更、完成等事件触发时，自动刷新数据并重渲染 UI
   */
  QuestApp.prototype._setupQuestEngineListener = function () {
    var self = this;
    if (!window.QuestEngine || typeof window.QuestEngine.on !== 'function') {
      console.warn('[QuestApp] QuestEngine 不可用，跳过事件监听');
      return;
    }

    // [APP-Fix-3] 保存事件监听器引用，以便销毁时移除
    if (!self._questEventHandlers) self._questEventHandlers = [];

    // 需要监听的任务事件列表
    var questEvents = [
      'quest:registered',    // 新任务注册
      'quest:unlocked',      // 任务解锁
      'quest:accepted',      // 任务接取
      'quest:stepCompleted', // 步骤完成
      'quest:completed',     // 任务完成
      'quest:rewardClaimed', // 奖励领取
      'quest:failed',        // 任务失败
      'quest:timeout',       // 任务超时
      'quest:chainTriggered' // 链式任务触发
    ];

    for (var i = 0; i < questEvents.length; i++) {
      (function (eventName) {
        var handler = function () {
          // 防抖：300ms 内只刷新一次
          if (self._questEventTimer) return;
          self._questEventTimer = setTimeout(function () {
            self._questEventTimer = null;
            console.log('[QuestApp] 收到 QuestEngine 事件 (' + eventName + ')，刷新面板');
            self.refreshData().then(function () {
              if (typeof self.renderApp === 'function') {
                self.renderApp();
              }
            });
          }, 300);
        };
        // [APP-Fix-3] 保存引用以便销毁时移除
        self._questEventHandlers.push({ event: eventName, handler: handler });
        window.QuestEngine.on(eventName, handler);
      })(questEvents[i]);
    }

    console.log('[QuestApp] 已注册 QuestEngine 事件监听（' + questEvents.length + '个事件）');
  };

  QuestApp.prototype._setupChatChangeListener = function () {
    var self = this;
    try {
      var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      var eventSource = ctx && ctx.eventSource;
      var eventTypes = ctx && ctx.event_types;
      if (eventSource && eventTypes && eventTypes.CHAT_CHANGED) {
        // [APP-Fix-4] 保存事件引用以便销毁时移除
        var chatChangeHandler = function () {
          console.log('[QuestApp] 检测到聊天切换，刷新任务数据');
          if (window.QuestEngine && window.QuestEngine._cache) {
            window.QuestEngine._cache = { registry: null, activeQuests: {}, lastSync: 0 };
          }
          self.refreshData().then(function () {
            self.currentView = 'list';
            self.currentCategory = 'all';
            if (typeof self.renderApp === 'function') self.renderApp();
          });
        };
        self._chatChangeHandler = chatChangeHandler;
        self._chatChangeEventType = eventTypes.CHAT_CHANGED;
        eventSource.on(eventTypes.CHAT_CHANGED, chatChangeHandler);
        return;
      }
    } catch (e) {}
    var lastChatId = '';
    // [APP-Fix-4] 保存 setInterval 引用到 this，以便 clearTimers 清除
    self._chatCheckInterval = setInterval(function () {
      try {
        var chatId = document.querySelector('#chat_id') ? document.querySelector('#chat_id').value : '';
        if (chatId && chatId !== lastChatId) {
          lastChatId = chatId;
          if (window.QuestEngine && window.QuestEngine._cache) {
            window.QuestEngine._cache = { registry: null, activeQuests: {}, lastSync: 0 };
          }
          self.refreshData().then(function () {
            self.currentView = 'list';
            self.currentCategory = 'all';
            if (typeof self.renderApp === 'function') self.renderApp();
          });
        }
      } catch (e) {}
    }, 3000);
    self._chatCheckTimeout = setTimeout(function () { clearInterval(self._chatCheckInterval); }, 300000);
  };

  /* ============================================================
   *  数据管理
   * ============================================================ */

  /**
   * 从 QuestEngine 刷新所有数据
   */
  QuestApp.prototype.refreshData = function () {
    var self = this;
    self.isRefreshing = true;
    return Promise.all([
      self.loadRegistry(),
      self.loadActiveQuests()
    ]).then(function () {
      self.isRefreshing = false;
    }).catch(function (err) {
      console.error('[QuestApp] 刷新数据失败:', err);
      self.isRefreshing = false;
    });
  };

  /**
   * 加载任务注册表
   */
  QuestApp.prototype.loadRegistry = function () {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.loadRegistry === 'function') {
      return window.QuestEngine.loadRegistry().then(function (data) {
        // QuestEngine.loadRegistry 返回 { quests: [...], version: 1 } 对象
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          self.registry = Array.isArray(data.quests) ? data.quests : [];
        } else if (Array.isArray(data)) {
          self.registry = data;
        } else {
          self.registry = [];
        }
      });
    }
    // 无引擎时尝试从 ConfigManager 恢复数据
    var CM = (window.BridgeAPI && window.BridgeAPI.ConfigManager) || window.ConfigManager;
    if (CM && CM.get) {
      return CM.get('xb.quest.registry').then(function (raw) {
        if (raw) {
          try {
            var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) {
              self.registry = parsed;
            } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.quests)) {
              self.registry = parsed.quests;
            } else {
              self.registry = [];
            }
            console.log('[QuestApp] 从 ConfigManager 恢复了 registry，共 ' + self.registry.length + ' 条任务');
          } catch (e) {
            console.warn('[QuestApp] 解析 ConfigManager 中的 registry 失败:', e);
            self.registry = [];
          }
        } else {
          self.registry = [];
        }
      }).catch(function () {
        self.registry = [];
      });
    }
    self.registry = [];
    return Promise.resolve();
  };

  /**
   * 加载进行中的任务
   */
  QuestApp.prototype.loadActiveQuests = function () {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
      return window.QuestEngine.getActiveQuests().then(function (data) {
        // getActiveQuests 返回数组，需要转换为 { questId: questState } 对象
        if (Array.isArray(data)) {
          var questMap = {};
          for (var i = 0; i < data.length; i++) {
            var q = data[i];
            var qid = q && (q.id || q.questId);
            if (qid) {
              questMap[qid] = q;
            }
          }
          self.activeQuests = questMap;
        } else if (data && typeof data === 'object') {
          self.activeQuests = data;
        } else {
          self.activeQuests = {};
        }
      });
    }
    // 无引擎时尝试从 ConfigManager 恢复活跃任务数据
    var CM = (window.BridgeAPI && window.BridgeAPI.ConfigManager) || window.ConfigManager;
    if (CM && CM.get) {
      // 先从 registry 获取所有任务 ID，再逐个读取 active 状态
      return CM.get('xb.quest.registry').then(function (raw) {
        var questIds = [];
        if (raw) {
          try {
            var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            var list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.quests) ? parsed.quests : []);
            for (var i = 0; i < list.length; i++) {
              if (list[i] && (list[i].id || list[i].questId)) {
                questIds.push(list[i].id || list[i].questId);
              }
            }
          } catch (e) { /* ignore parse error */ }
        }
        if (questIds.length === 0) {
          self.activeQuests = {};
          return;
        }
        // 逐个读取活跃任务
        var promises = [];
        for (var j = 0; j < questIds.length; j++) {
          (function (qid) {
            promises.push(
              CM.get('xb.quest.active.' + qid).then(function (activeRaw) {
                if (activeRaw) {
                  try {
                    var state = typeof activeRaw === 'string' ? JSON.parse(activeRaw) : activeRaw;
                    if (state && typeof state === 'object') {
                      return { id: qid, state: state };
                    }
                  } catch (e) { /* ignore */ }
                }
                return null;
              }).catch(function () { return null; })
            );
          })(questIds[j]);
        }
        return Promise.all(promises).then(function (results) {
          var questMap = {};
          for (var k = 0; k < results.length; k++) {
            if (results[k]) {
              questMap[results[k].id] = results[k].state;
            }
          }
          self.activeQuests = questMap;
          console.log('[QuestApp] 从 ConfigManager 恢复了 ' + Object.keys(questMap).length + ' 个活跃任务');
        });
      }).catch(function () {
        self.activeQuests = {};
      });
    }
    self.activeQuests = {};
    return Promise.resolve();
  };

  /* ============================================================
   *  UI 渲染 - 入口
   * ============================================================ */

  /**
   * 根据当前视图返回完整HTML
   * @returns {string} HTML字符串
   */
  QuestApp.prototype.getAppContent = function () {
    var self = this;
    switch (self.currentView) {
      case 'detail':
        return self.renderDetailView(self.selectedQuest);
      case 'interaction':
        return self.renderInteractionView(self.selectedQuest, self.selectedStep);
      case 'main':
      default:
        return self.renderMainView();
    }
  };

  /* ============================================================
   *  UI 渲染 - 主页面
   * ============================================================ */

  /**
   * 渲染主页面：分类标签 + 任务卡片列表
   */
  QuestApp.prototype.renderMainView = function () {
    var self = this;
    var html = '';

    // ---- 分类标签栏 ----
    html += '<div class="quest-category-bar">';
    var categories = [
      { key: 'all',   label: '全部' },
      { key: 'main',  label: '主线' },
      { key: 'side',  label: '支线' },
      { key: 'daily', label: '日常' },
      { key: 'event', label: '事件' }
    ];
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var isActive = self.currentCategory === cat.key;
      html += '<div class="quest-cat-item' + (isActive ? ' active' : '') + '" data-category="' + cat.key + '">';
      html += cat.label;
      html += '</div>';
    }
    html += '</div>';

    // ---- 任务列表 ----
    var quests = self.getFilteredQuests();
    html += '<div class="quest-list">';

    if (quests.length === 0) {
      html += '<div class="quest-empty">';
      html += '<i class="fa-solid fa-clipboard-list"></i>';
      html += '<p>暂无任务</p>';
      html += '</div>';
    } else {
      for (var j = 0; j < quests.length; j++) {
        html += self.renderQuestCard(quests[j]);
      }
    }
    html += '</div>';

    return html;
  };

  /**
   * 根据当前分类过滤任务列表
   */
  QuestApp.prototype.getFilteredQuests = function () {
    var self = this;
    var result = [];

    // 合并注册表中的可用任务和进行中的任务
    var questMap = {};
    // 先添加注册表中的任务
    for (var i = 0; i < self.registry.length; i++) {
      var q = self.registry[i];
      questMap[q.id] = {
        id: q.id,
        type: q.type || 'side',
        name: q.name || '未命名任务',
        description: q.description || '',
        issuer: q.issuer || '',
        priority: q.priority || 'medium',
        steps: q.steps || [],
        rewards: q.rewards || {},
        timeLimit: q.timeLimit || 0,
        status: 'available'
      };
    }
    // 用活跃任务状态覆盖
    var activeIds = Object.keys(self.activeQuests);
    for (var j = 0; j < activeIds.length; j++) {
      var aq = self.activeQuests[activeIds[j]];
      if (questMap[activeIds[j]]) {
        questMap[activeIds[j]].status = aq.status || 'active';
        questMap[activeIds[j]].currentStep = aq.currentStep || 0;
        questMap[activeIds[j]].completedSteps = aq.completedSteps || [];
        questMap[activeIds[j]].startTime = aq.startTime || 0;
      }
    }

    var ids = Object.keys(questMap);
    for (var k = 0; k < ids.length; k++) {
      var quest = questMap[ids[k]];
      // 分类过滤
      if (self.currentCategory !== 'all' && quest.type !== self.currentCategory) {
        continue;
      }
      result.push(quest);
    }

    // 排序：进行中 > 待领奖 > 可接取 > 已完成，同状态按优先级排序
    var priorityOrder = { high: 0, medium: 1, low: 2 };
    var statusOrder   = { active: 0, reward: 1, completable: 1, available: 2, completed: 3, failed: 4, abandoned: 5 };
    result.sort(function (a, b) {
      var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
      var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
      if (sa !== sb) return sa - sb;
      var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 1;
      var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 1;
      return pa - pb;
    });

    return result;
  };

  /**
   * 渲染单个任务卡片
   */
  QuestApp.prototype.renderQuestCard = function (quest) {
    var self = this;
    var html = '';
    var typeClass = 'quest-type-' + (quest.type || 'side');
    var statusClass = 'quest-status-' + (quest.status || 'available');

    html += '<div class="quest-card ' + typeClass + ' ' + statusClass + '" data-quest-id="' + quest.id + '">';

    // 卡片头部：类型图标 + 名称 + 状态
    html += '<div class="quest-card-header">';
    html += '<div class="quest-card-type-icon"><i class="' + self.getQuestTypeIcon(quest.type) + '"></i></div>';
    html += '<div class="quest-card-title-area">';
    html += '<div class="quest-card-name">' + self.escapeHtml(quest.name) + '</div>';
    html += '<div class="quest-card-issuer">' + self.escapeHtml(quest.issuer || '') + '</div>';
    html += '</div>';
    html += '<div class="quest-card-status-badge ' + statusClass + '">' + self.getStatusLabel(quest.status) + '</div>';
    html += '</div>';

    // 描述
    html += '<div class="quest-card-desc">' + self.escapeHtml(quest.description || '') + '</div>';

    // 底部：优先级 + 进度 + 时间
    html += '<div class="quest-card-footer">';
    // 优先级
    html += '<span class="quest-priority quest-priority-' + (quest.priority || 'medium') + '">';
    html += PRIORITY_LABELS[quest.priority] || '中';
    html += '</span>';

    // 进度
    var totalSteps = quest.steps ? quest.steps.length : 0;
    var completedCount = 0;
    if (quest.completedSteps) {
      completedCount = quest.completedSteps.length;
    }
    if (quest.status === 'completed') {
      completedCount = totalSteps;
    }
    if (totalSteps > 0) {
      var currentNum = Math.min(completedCount + 1, totalSteps);
      if (quest.status === 'completed') currentNum = totalSteps;
      html += '<span class="quest-progress-text">' + currentNum + '/' + totalSteps + '</span>';
      html += '<div class="quest-progress-bar">';
      var pct = Math.round((completedCount / totalSteps) * 100);
      html += '<div class="quest-progress-fill" style="width:' + pct + '%"></div>';
      html += '</div>';
    }

    // 时间限制
    if (quest.timeLimit && quest.startTime && quest.status === 'active') {
      var remaining = quest.timeLimit - (Date.now() - quest.startTime);
      if (remaining > 0) {
        html += '<span class="quest-time-limit" data-deadline="' + (quest.startTime + quest.timeLimit) + '">';
        html += '<i class="fa-solid fa-clock"></i> ' + self.formatCountdown(remaining);
        html += '</span>';
      }
    }
    html += '</div>';

    html += '</div>';
    return html;
  };

  /* ============================================================
   *  UI 渲染 - 任务详情页
   * ============================================================ */

  /**
   * 渲染任务详情页
   */
  QuestApp.prototype.renderDetailView = function (questId) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) {
      return '<div class="quest-empty"><p>任务不存在</p></div>';
    }

    var html = '';

    // ---- 顶部导航栏 ----
    html += '<div class="quest-detail-nav">';
    html += '<button class="quest-back-btn" id="questDetailBack"><i class="fa-solid fa-chevron-left"></i></button>';
    html += '<span class="quest-detail-nav-title">' + self.escapeHtml(quest.name) + '</span>';
    html += '<div class="quest-detail-nav-spacer"></div>';
    html += '</div>';

    // ---- 任务信息卡 ----
    var typeClass = 'quest-type-' + (quest.type || 'side');
    html += '<div class="quest-detail-info ' + typeClass + '">';
    // 类型 + 优先级
    html += '<div class="quest-detail-tags">';
    html += '<span class="quest-tag quest-tag-type"><i class="' + self.getQuestTypeIcon(quest.type) + '"></i> ' + self.getQuestTypeLabel(quest.type) + '</span>';
    html += '<span class="quest-tag quest-tag-priority quest-priority-' + (quest.priority || 'medium') + '">' + (PRIORITY_LABELS[quest.priority] || '中') + '优先级</span>';
    html += '<span class="quest-tag quest-tag-status quest-status-' + (quest.status || 'available') + '">' + self.getStatusLabel(quest.status) + '</span>';
    html += '</div>';
    // 发布者
    if (quest.issuer) {
      html += '<div class="quest-detail-issuer"><i class="fa-solid fa-user"></i> ' + self.escapeHtml(quest.issuer) + '</div>';
    }
    // 描述
    html += '<div class="quest-detail-desc">' + self.escapeHtml(quest.description || '暂无描述') + '</div>';
    html += '</div>';

    // ---- 步骤时间轴 ----
    var steps = quest.steps || [];
      if (steps.length > 0) {
        html += '<div class="quest-steps-section">';
        html += '<div class="quest-section-title"><i class="fa-solid fa-list-check"></i> 任务步骤</div>';
        html += '<div class="quest-timeline">';

        // 兼容两种步骤状态格式：
        // 1. QuestEngine 的 stepStates 数组（每个元素有 status 属性）
        // 2. 旧版 completedSteps 索引数组
        var stepStates = quest.stepStates || [];
        var completedSteps = quest.completedSteps || [];
        var currentStepIdx = quest.currentStep || 0;
        if (quest.status === 'completed' || quest.status === 'completable') {
          currentStepIdx = steps.length; // 全部完成
        }

      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var stepState = 'locked'; // locked / active / completed
        // 优先使用 stepStates 格式
        if (stepStates.length > 0 && stepStates[i]) {
          var ss = stepStates[i].status || stepStates[i];
          if (ss === 'completed' || ss === 'reward') {
            stepState = 'completed';
          } else if (ss === 'active') {
            stepState = 'active';
          }
        } else if (completedSteps.indexOf(i) !== -1 || i < currentStepIdx) {
          stepState = 'completed';
        } else if (i === currentStepIdx && (quest.status === 'active')) {
          stepState = 'active';
        }

        html += '<div class="quest-timeline-item quest-step-' + stepState + '" data-step-index="' + i + '">';
        // 时间轴圆点
        html += '<div class="quest-timeline-dot">';
        if (stepState === 'completed') {
          html += '<i class="fa-solid fa-check"></i>';
        } else if (stepState === 'active') {
          html += '<i class="fa-solid fa-play"></i>';
        } else {
          html += '<i class="fa-solid fa-lock"></i>';
        }
        html += '</div>';
        // 时间轴线
        if (i < steps.length - 1) {
          html += '<div class="quest-timeline-line quest-timeline-line-' + stepState + '"></div>';
        }
        // 内容
        html += '<div class="quest-timeline-content">';
        html += '<div class="quest-step-header">';
        html += '<span class="quest-step-icon"><i class="' + self.getStepTypeIcon(step.type) + '"></i></span>';
        html += '<span class="quest-step-name">' + self.escapeHtml(step.name || STEP_LABELS[step.type] || '步骤 ' + (i + 1)) + '</span>';
        html += '<span class="quest-step-type-label">' + (STEP_LABELS[step.type] || step.type) + '</span>';
        html += '</div>';
        if (step.description) {
          html += '<div class="quest-step-desc">' + self.escapeHtml(step.description) + '</div>';
        }
        // 已完成步骤的结果
        if (stepState === 'completed' && step.result) {
          html += '<div class="quest-step-result">' + self.escapeHtml(step.result) + '</div>';
        }
        html += '</div>';
        html += '</div>';
      }

      html += '</div>'; // .quest-timeline
      html += '</div>'; // .quest-steps-section
    }

    // ---- 奖励预览 ----
    if (quest.rewards) {
      var rewardKeys = Object.keys(quest.rewards);
      if (rewardKeys.length > 0) {
        html += '<div class="quest-rewards-section">';
        html += '<div class="quest-section-title"><i class="fa-solid fa-trophy"></i> 任务奖励</div>';
        html += '<div class="quest-rewards-list">';
        for (var r = 0; r < rewardKeys.length; r++) {
          var rKey = rewardKeys[r];
          var rVal = quest.rewards[rKey];
          html += '<div class="quest-reward-item">';
          html += '<span class="quest-reward-key">' + self.escapeHtml(rKey) + '</span>';
          html += '<span class="quest-reward-value">+' + self.escapeHtml(String(rVal)) + '</span>';
          html += '</div>';
        }
        html += '</div>';
        html += '</div>';
      }
    }

    // ---- 操作按钮 ----
    html += '<div class="quest-detail-actions">';
    if (quest.status === 'available') {
      html += '<button class="quest-btn quest-btn-primary" id="questAcceptBtn" data-quest-id="' + quest.id + '">';
      html += '<i class="fa-solid fa-hand"></i> 接取任务';
      html += '</button>';
    } else if (quest.status === 'active') {
      html += '<button class="quest-btn quest-btn-danger" id="questAbandonBtn" data-quest-id="' + quest.id + '">';
      html += '<i class="fa-solid fa-xmark"></i> 放弃任务';
      html += '</button>';
    } else if (quest.status === 'completable' || quest.status === 'reward') {
      html += '<button class="quest-btn quest-btn-reward" id="questClaimBtn" data-quest-id="' + quest.id + '">';
      html += '<i class="fa-solid fa-gift"></i> 领取奖励';
      html += '</button>';
    }
    html += '</div>';

    return html;
  };

  /* ============================================================
   *  UI 渲染 - 交互页
   * ============================================================ */

  /**
   * 渲染交互页
   */
  QuestApp.prototype.renderInteractionView = function (questId, stepIndex) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) {
      return '<div class="quest-empty"><p>任务不存在</p></div>';
    }
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) {
      return '<div class="quest-empty"><p>步骤不存在</p></div>';
    }

    var html = '';

    // 顶部导航
    html += '<div class="quest-detail-nav">';
    html += '<button class="quest-back-btn" id="questInteractionBack"><i class="fa-solid fa-chevron-left"></i></button>';
    html += '<span class="quest-detail-nav-title">' + self.escapeHtml(step.name || STEP_LABELS[step.type] || '交互') + '</span>';
    html += '<div class="quest-detail-nav-spacer"></div>';
    html += '</div>';

    // 根据步骤类型渲染交互内容
    html += '<div class="quest-interaction-body">';
    html += self.renderStepInteraction(step, quest);
    html += '</div>';

    return html;
  };

  /**
   * 根据步骤类型分发渲染
   */
  QuestApp.prototype.renderStepInteraction = function (step, questState) {
    var self = this;
    switch (step.type) {
      case 'travel':
        return self.renderTravelInteraction(step, questState);
      case 'dialogue':
        return self.renderDialogueInteraction(step, questState);
      case 'shopping':
        return self.renderShoppingInteraction(step, questState);
      case 'gift':
        return self.renderGiftInteraction(step, questState);
      case 'investigate':
        return self.renderInvestigateInteraction(step, questState);
      case 'wait':
        return self.renderWaitInteraction(step, questState);
      case 'select':
        return self.renderSelectInteraction(step, questState);
      case 'custom':
        return self.renderCustomInteraction(step, questState);
      default:
        return '<div class="quest-interaction-unknown"><p>未知交互类型: ' + self.escapeHtml(step.type || '') + '</p></div>';
    }
  };

  /* ----------------------------------------------------------
   *  交互类型：前往地点 (travel)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderTravelInteraction = function (step, questState) {
    var self = this;
    var location = step.location || {};
    var html = '';

    html += '<div class="quest-travel">';
    // 地点信息
    html += '<div class="quest-travel-scene">';
    html += '<div class="quest-travel-icon"><i class="fa-solid fa-map-location-dot"></i></div>';
    html += '<h3 class="quest-travel-name">' + self.escapeHtml(location.name || step.name || '未知地点') + '</h3>';
    if (location.description) {
      html += '<p class="quest-travel-desc">' + self.escapeHtml(location.description) + '</p>';
    }
    if (step.description) {
      html += '<p class="quest-travel-hint">' + self.escapeHtml(step.description) + '</p>';
    }
    html += '</div>';

    // 前往按钮
    html += '<button class="quest-btn quest-btn-primary quest-travel-go-btn" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
    html += '<i class="fa-solid fa-person-walking"></i> 前往' + self.escapeHtml(location.name || '');
    html += '</button>';

    // 动画区域（隐藏，点击后显示）
    html += '<div class="quest-travel-anim" style="display:none">';
    html += '<div class="quest-travel-anim-icon"><i class="fa-solid fa-person-walking quest-walk-anim"></i></div>';
    html += '<p class="quest-travel-anim-text">正在前往...</p>';
    html += '<div class="quest-travel-progress-bar"><div class="quest-travel-progress-fill"></div></div>';
    html += '</div>';

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：NPC对话 (dialogue)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderDialogueInteraction = function (step, questState) {
    var self = this;
    var npc = step.npc || {};
    var html = '';

    html += '<div class="quest-dialogue">';
    // NPC信息
    html += '<div class="quest-dialogue-npc">';
    if (npc.avatar) {
      html += '<div class="quest-npc-avatar"><img src="' + self.escapeHtml(npc.avatar) + '" alt="' + self.escapeHtml(npc.name || 'NPC') + '"></div>';
    } else {
      html += '<div class="quest-npc-avatar quest-npc-avatar-default"><i class="fa-solid fa-user"></i></div>';
    }
    html += '<span class="quest-npc-name">' + self.escapeHtml(npc.name || '神秘人') + '</span>';
    html += '</div>';

    // 对话内容（打字机效果容器）
    html += '<div class="quest-dialogue-messages" id="questDialogueMessages">';
    var messages = step.messages || [];
    if (messages.length > 0 && typeof messages[0] === 'string') {
      // 简单字符串数组
      html += '<div class="quest-dialogue-bubble quest-bubble-npc">';
      html += '<span class="quest-typewriter" data-full-text="' + self.escapeAttr(messages[0]) + '"></span>';
      html += '</div>';
    } else if (messages.length > 0 && typeof messages[0] === 'object') {
      // 对象数组 [{speaker, text}]
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var isPlayer = msg.speaker === 'player' || msg.speaker === 'user';
        html += '<div class="quest-dialogue-bubble ' + (isPlayer ? 'quest-bubble-player' : 'quest-bubble-npc') + '">';
        if (!isPlayer) {
          html += '<span class="quest-bubble-speaker">' + self.escapeHtml(npc.name || 'NPC') + '</span>';
        }
        html += '<span class="quest-typewriter" data-full-text="' + self.escapeAttr(msg.text || '') + '"></span>';
        html += '</div>';
      }
    } else if (step.text) {
      html += '<div class="quest-dialogue-bubble quest-bubble-npc">';
      html += '<span class="quest-typewriter" data-full-text="' + self.escapeAttr(step.text) + '"></span>';
      html += '</div>';
    }
    html += '</div>';

    // 选项按钮
    var choices = step.choices || [];
    if (choices.length > 0) {
      html += '<div class="quest-dialogue-choices">';
      for (var c = 0; c < choices.length; c++) {
        var choice = choices[c];
        html += '<button class="quest-btn quest-btn-choice" data-choice-index="' + c + '" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
        html += self.escapeHtml(choice.text || choice.label || '选项 ' + (c + 1));
        html += '</button>';
      }
      html += '</div>';
    }

    // 继续按钮（无选项时显示）
    if (choices.length === 0) {
      html += '<div class="quest-dialogue-continue">';
      html += '<button class="quest-btn quest-btn-primary quest-dialogue-continue-btn" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
      html += '继续 <i class="fa-solid fa-arrow-right"></i>';
      html += '</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：购物 (shopping)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderShoppingInteraction = function (step, questState) {
    var self = this;
    var shop = step.shop || {};
    var items = shop.items || step.items || [];
    var html = '';

    // 获取当前金钱（使用 _readVar 的缓存版本，同步读取）
    var money = 0;
    try {
      if (window.BridgeAPI && typeof window.BridgeAPI._readVar === 'function') {
        var moneyVal = window.BridgeAPI._readVar('xb.game.money');
        // _readVar 返回 Promise，尝试从缓存获取
        if (moneyVal && typeof moneyVal.then === 'function') {
          money = 0; // 异步，使用默认值，后续可通过事件更新
        } else {
          money = parseInt(moneyVal, 10) || 0;
        }
      }
    } catch (e) {
      money = 0;
    }

    html += '<div class="quest-shopping">';
    // 商店信息
    html += '<div class="quest-shop-header">';
    html += '<div class="quest-shop-icon"><i class="fa-solid fa-store"></i></div>';
    html += '<h3 class="quest-shop-name">' + self.escapeHtml(shop.name || step.name || '商店') + '</h3>';
    if (shop.description) {
      html += '<p class="quest-shop-desc">' + self.escapeHtml(shop.description) + '</p>';
    }
    html += '</div>';

    // 金钱显示
    html += '<div class="quest-shop-money">';
    html += '<i class="fa-solid fa-coins"></i> <span id="questShopMoney">' + money + '</span> G';
    html += '</div>';

    // 商品列表
    html += '<div class="quest-shop-items">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var canAfford = money >= (item.price || 0);
      html += '<div class="quest-shop-item' + (canAfford ? '' : ' quest-shop-item-disabled') + '">';
      html += '<div class="quest-shop-item-info">';
      html += '<div class="quest-shop-item-name">' + self.escapeHtml(item.name || '物品') + '</div>';
      if (item.description) {
        html += '<div class="quest-shop-item-desc">' + self.escapeHtml(item.description) + '</div>';
      }
      html += '</div>';
      html += '<div class="quest-shop-item-right">';
      html += '<span class="quest-shop-item-price"><i class="fa-solid fa-coins"></i> ' + (item.price || 0) + '</span>';
      html += '<button class="quest-btn quest-btn-buy' + (canAfford ? '' : ' quest-btn-disabled') + '" ';
      html += 'data-item-index="' + i + '" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
      html += '购买';
      html += '</button>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';

    // 离开按钮
    html += '<div class="quest-shop-exit">';
    html += '<button class="quest-btn quest-btn-secondary quest-shop-exit-btn" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
    html += '<i class="fa-solid fa-right-from-bracket"></i> 离开商店';
    html += '</button>';
    html += '</div>';

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：送礼 (gift)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderGiftInteraction = function (step, questState) {
    var self = this;
    var target = step.target || {};
    var html = '';

    html += '<div class="quest-gift">';
    // 目标信息
    html += '<div class="quest-gift-target">';
    html += '<div class="quest-gift-target-icon"><i class="fa-solid fa-user"></i></div>';
    html += '<div>';
    html += '<h3 class="quest-gift-target-name">' + self.escapeHtml(target.name || step.name || '某人') + '</h3>';
    if (step.description) {
      html += '<p class="quest-gift-hint">' + self.escapeHtml(step.description) + '</p>';
    }
    html += '</div>';
    html += '</div>';

    // 从背包读取物品
    var inventory = [];
    try {
      if (window.BridgeAPI && typeof window.BridgeAPI._readVar === 'function') {
        var invVal = window.BridgeAPI._readVar('xb.game.inventory');
        if (invVal && typeof invVal.then !== 'function') {
          inventory = JSON.parse(invVal);
          if (!Array.isArray(inventory)) inventory = [];
        }
      }
    } catch (e) {
      inventory = [];
    }

    // 可选物品列表
    var preferredItems = step.preferredItems || [];
    html += '<div class="quest-gift-inventory">';
    html += '<div class="quest-section-title"><i class="fa-solid fa-box-open"></i> 选择礼物</div>';

    if (inventory.length === 0) {
      html += '<div class="quest-gift-empty"><p>背包中没有物品</p></div>';
    } else {
      for (var i = 0; i < inventory.length; i++) {
        var invItem = inventory[i];
        var isPreferred = preferredItems.indexOf(invItem.name || invItem.id) !== -1;
        html += '<div class="quest-gift-item' + (isPreferred ? ' quest-gift-item-preferred' : '') + '">';
        html += '<div class="quest-gift-item-icon"><i class="fa-solid fa-cube"></i></div>';
        html += '<div class="quest-gift-item-info">';
        html += '<div class="quest-gift-item-name">' + self.escapeHtml(invItem.name || invItem.id || '物品') + '</div>';
        if (invItem.description) {
          html += '<div class="quest-gift-item-desc">' + self.escapeHtml(invItem.description) + '</div>';
        }
        html += '</div>';
        html += '<button class="quest-btn quest-btn-gift" data-item-name="' + self.escapeAttr(invItem.name || invItem.id || '') + '" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
        html += '送出';
        html += '</button>';
        html += '</div>';
      }
    }
    html += '</div>';

    // 反馈区域
    html += '<div class="quest-gift-feedback" id="questGiftFeedback" style="display:none"></div>';

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：调查 (investigate)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderInvestigateInteraction = function (step, questState) {
    var self = this;
    var scene = step.scene || {};
    var clues = step.clues || [];
    var html = '';

    html += '<div class="quest-investigate">';
    // 场景描述
    html += '<div class="quest-investigate-scene">';
    html += '<div class="quest-investigate-icon"><i class="fa-solid fa-magnifying-glass"></i></div>';
    html += '<h3 class="quest-investigate-title">' + self.escapeHtml(scene.name || step.name || '调查现场') + '</h3>';
    if (scene.description || step.description) {
      html += '<p class="quest-investigate-desc">' + self.escapeHtml(scene.description || step.description) + '</p>';
    }
    html += '</div>';

    // 可调查点
    html += '<div class="quest-investigate-points">';
    html += '<div class="quest-section-title"><i class="fa-solid fa-crosshairs"></i> 可调查点</div>';
    var points = step.points || [];
    if (points.length === 0 && clues.length > 0) {
      // 兼容：如果没有points但有clues，把clues当作调查点
      points = clues;
    }
    for (var i = 0; i < points.length; i++) {
      var point = points[i];
      html += '<div class="quest-investigate-point" data-point-index="' + i + '" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
      html += '<div class="quest-investigate-point-icon"><i class="fa-solid fa-circle-question"></i></div>';
      html += '<div class="quest-investigate-point-info">';
      html += '<div class="quest-investigate-point-name">' + self.escapeHtml(point.name || point.target || '调查点 ' + (i + 1)) + '</div>';
      if (point.hint) {
        html += '<div class="quest-investigate-point-hint">' + self.escapeHtml(point.hint) + '</div>';
      }
      html += '</div>';
      html += '<i class="fa-solid fa-chevron-right quest-investigate-point-arrow"></i>';
      html += '</div>';
    }
    html += '</div>';

    // 调查结果展示区域
    html += '<div class="quest-investigate-result" id="questInvestigateResult" style="display:none"></div>';

    // 完成调查按钮
    html += '<div class="quest-investigate-complete">';
    html += '<button class="quest-btn quest-btn-primary quest-investigate-done-btn" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
    html += '<i class="fa-solid fa-check"></i> 完成调查';
    html += '</button>';
    html += '</div>';

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：等待 (wait)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderWaitInteraction = function (step, questState) {
    var self = this;
    var duration = step.duration || 60; // 默认60秒
    var canSkip = step.canSkip !== false; // 默认可跳过
    var html = '';

    html += '<div class="quest-wait">';
    html += '<div class="quest-wait-icon"><i class="fa-solid fa-hourglass-half quest-hourglass-anim"></i></div>';
    html += '<h3 class="quest-wait-title">' + self.escapeHtml(step.name || '等待中') + '</h3>';
    if (step.description) {
      html += '<p class="quest-wait-desc">' + self.escapeHtml(step.description) + '</p>';
    }

    // 倒计时
    html += '<div class="quest-wait-timer">';
    html += '<div class="quest-wait-timer-ring" id="questWaitTimerRing">';
    html += '<svg viewBox="0 0 100 100">';
    html += '<circle class="quest-wait-ring-bg" cx="50" cy="50" r="45"></circle>';
    html += '<circle class="quest-wait-ring-fill" cx="50" cy="50" r="45" data-duration="' + duration + '"></circle>';
    html += '</svg>';
    html += '<span class="quest-wait-timer-text" id="questWaitTimerText">' + self.formatSeconds(duration) + '</span>';
    html += '</div>';
    html += '</div>';

    // 跳过按钮
    if (canSkip) {
      html += '<div class="quest-wait-skip">';
      html += '<button class="quest-btn quest-btn-secondary quest-wait-skip-btn" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
      html += '<i class="fa-solid fa-forward"></i> 跳过等待';
      html += '</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：选择分支 (select)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderSelectInteraction = function (step, questState) {
    var self = this;
    var html = '';

    html += '<div class="quest-select">';
    // 问题描述
    html += '<div class="quest-select-question">';
    html += '<div class="quest-select-icon"><i class="fa-solid fa-code-branch"></i></div>';
    if (step.name) {
      html += '<h3 class="quest-select-title">' + self.escapeHtml(step.name) + '</h3>';
    }
    if (step.description) {
      html += '<p class="quest-select-desc">' + self.escapeHtml(step.description) + '</p>';
    }
    html += '</div>';

    // 选项列表
    var options = step.options || step.choices || [];
    html += '<div class="quest-select-options">';
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      html += '<button class="quest-btn quest-btn-option" data-option-index="' + i + '" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
      html += '<span class="quest-option-letter">' + String.fromCharCode(65 + i) + '</span>';
      html += '<span class="quest-option-text">' + self.escapeHtml(opt.text || opt.label || '选项 ' + (i + 1)) + '</span>';
      html += '</button>';
    }
    html += '</div>';

    // 选择结果区域
    html += '<div class="quest-select-result" id="questSelectResult" style="display:none"></div>';

    html += '</div>';
    return html;
  };

  /* ----------------------------------------------------------
   *  交互类型：自定义 (custom)
   * ---------------------------------------------------------- */
  QuestApp.prototype.renderCustomInteraction = function (step, questState) {
    var self = this;
    var html = '';

    html += '<div class="quest-custom">';
    html += '<div class="quest-custom-header">';
    html += '<div class="quest-custom-icon"><i class="fa-solid fa-puzzle-piece"></i></div>';
    if (step.name) {
      html += '<h3 class="quest-custom-title">' + self.escapeHtml(step.name) + '</h3>';
    }
    if (step.description) {
      html += '<p class="quest-custom-desc">' + self.escapeHtml(step.description) + '</p>';
    }
    html += '</div>';

    // 自定义内容区域
    if (step.content) {
      html += '<div class="quest-custom-content">' + step.content + '</div>';
    }

    // 自定义按钮
    var actions = step.actions || [];
    if (actions.length > 0) {
      html += '<div class="quest-custom-actions">';
      for (var i = 0; i < actions.length; i++) {
        var action = actions[i];
        var btnClass = 'quest-btn';
        if (action.style === 'primary') btnClass += ' quest-btn-primary';
        else if (action.style === 'danger') btnClass += ' quest-btn-danger';
        else btnClass += ' quest-btn-secondary';
        html += '<button class="' + btnClass + ' quest-custom-action-btn" data-action-index="' + i + '" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
        html += '<i class="' + self.escapeHtml(action.icon || 'fa-solid fa-hand-pointer') + '"></i> ';
        html += self.escapeHtml(action.label || '操作');
        html += '</button>';
      }
      html += '</div>';
    }

    // 通用完成按钮
    html += '<div class="quest-custom-complete">';
    html += '<button class="quest-btn quest-btn-primary quest-custom-done-btn" data-quest-id="' + (questState.id || '') + '" data-step-index="' + (questState.currentStep || 0) + '">';
    html += '<i class="fa-solid fa-check"></i> 完成';
    html += '</button>';
    html += '</div>';

    html += '</div>';
    return html;
  };

  /* ============================================================
   *  任务操作
   * ============================================================ */

  /**
   * 接取任务
   */
  QuestApp.prototype.acceptQuest = function (questId) {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.acceptQuest === 'function') {
      return window.QuestEngine.acceptQuest(questId).then(function () {
        self.showToast('任务已接取', 'success');
        return self.refreshData();
      }).then(function () {
        self.showDetail(questId);
      }).catch(function (err) {
        console.error('[QuestApp] 接取任务失败:', err);
        self.showToast('接取任务失败', 'error');
      });
    }
    self.showToast('任务引擎不可用', 'error');
    return Promise.resolve();
  };

  /**
   * 开始步骤
   */
  QuestApp.prototype.startStep = function (questId, stepIndex) {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.startStep === 'function') {
      return window.QuestEngine.startStep(questId, stepIndex).then(function () {
        return self.refreshData();
      });
    }
    return Promise.resolve();
  };

  /**
   * 完成步骤
   */
  QuestApp.prototype.completeStep = function (questId, stepIndex, result) {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.completeStep === 'function') {
      return window.QuestEngine.completeStep(questId, stepIndex, result).then(function () {
        self.showToast('步骤完成', 'success');
        return self.refreshData();
      }).then(function () {
        self.showDetail(questId);
      }).catch(function (err) {
        console.error('[QuestApp] 完成步骤失败:', err);
        self.showToast('完成步骤失败', 'error');
      });
    }
    return Promise.resolve();
  };

  /**
   * 领取奖励
   */
  QuestApp.prototype.claimReward = function (questId) {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.claimReward === 'function') {
      return window.QuestEngine.claimReward(questId).then(function () {
        self.showToast('奖励已领取', 'success');
        return self.refreshData();
      }).then(function () {
        self.showMain();
      }).catch(function (err) {
        console.error('[QuestApp] 领取奖励失败:', err);
        self.showToast('领取奖励失败', 'error');
      });
    }
    return Promise.resolve();
  };

  /**
   * 放弃任务
   */
  QuestApp.prototype.abandonQuest = function (questId) {
    var self = this;
    if (window.QuestEngine && typeof window.QuestEngine.abandonQuest === 'function') {
      return window.QuestEngine.abandonQuest(questId).then(function () {
        self.showToast('已放弃任务', 'warning');
        return self.refreshData();
      }).then(function () {
        self.showMain();
      }).catch(function (err) {
        console.error('[QuestApp] 放弃任务失败:', err);
        self.showToast('放弃任务失败', 'error');
      });
    }
    return Promise.resolve();
  };

  /* ============================================================
   *  导航
   * ============================================================ */

  /**
   * 显示主页面
   */
  QuestApp.prototype.showMain = function () {
    var self = this;
    self.clearTimers();
    self.currentView = 'main';
    self.selectedQuest = null;
    self.selectedStep = null;
    self.viewStack = [];
    self.updateHeader();
    self.renderApp();
  };

  /**
   * 显示任务详情页
   */
  QuestApp.prototype.showDetail = function (questId) {
    var self = this;
    self.clearTimers();
    self.viewStack.push({ view: self.currentView, questId: self.selectedQuest, stepIndex: self.selectedStep });
    self.currentView = 'detail';
    self.selectedQuest = questId;
    self.selectedStep = null;
    self.updateHeader();
    self.renderApp();
  };

  /**
   * 显示交互页
   */
  QuestApp.prototype.showInteraction = function (questId, stepIndex) {
    var self = this;
    self.clearTimers();
    self.viewStack.push({ view: self.currentView, questId: self.selectedQuest, stepIndex: self.selectedStep });
    self.currentView = 'interaction';
    self.selectedQuest = questId;
    self.selectedStep = stepIndex;
    self.updateHeader();
    self.renderApp();
  };

  /**
   * 返回上一页
   */
  QuestApp.prototype.goBack = function () {
    var self = this;
    self.clearTimers();
    if (self.viewStack.length > 0) {
      var prev = self.viewStack.pop();
      self.currentView = prev.view;
      self.selectedQuest = prev.questId;
      self.selectedStep = prev.stepIndex;
    } else {
      self.currentView = 'main';
      self.selectedQuest = null;
      self.selectedStep = null;
    }
    self.updateHeader();
    self.renderApp();
  };

  /**
   * 渲染应用到容器
   */
  QuestApp.prototype.renderApp = function () {
    var self = this;
    var container = document.getElementById('questAppContainer');
    if (container) {
      container.innerHTML = self.getAppContent();
      self.bindEvents();
      // 启动打字机效果
      self.startTypewriterEffect();
      // 启动等待倒计时
      self.startWaitTimer();
    }
  };

  /* ============================================================
   *  事件绑定
   * ============================================================ */
  QuestApp.prototype.bindEvents = function () {
    var self = this;

    // ---- 分类标签切换 ----
    var catItems = document.querySelectorAll('.quest-cat-item');
    for (var i = 0; i < catItems.length; i++) {
      catItems[i].addEventListener('click', function () {
        self.currentCategory = this.getAttribute('data-category');
        self.renderApp();
      });
    }

    // ---- 任务卡片点击 ----
    var cards = document.querySelectorAll('.quest-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () {
        var questId = this.getAttribute('data-quest-id');
        if (questId) self.showDetail(questId);
      });
    }

    // ---- 详情页返回 ----
    var detailBack = document.getElementById('questDetailBack');
    if (detailBack) {
      detailBack.addEventListener('click', function () { self.goBack(); });
    }

    // ---- 交互页返回 ----
    var interactionBack = document.getElementById('questInteractionBack');
    if (interactionBack) {
      interactionBack.addEventListener('click', function () { self.goBack(); });
    }

    // ---- 接取任务 ----
    var acceptBtn = document.getElementById('questAcceptBtn');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        if (qid) self.acceptQuest(qid);
      });
    }

    // ---- 放弃任务 ----
    var abandonBtn = document.getElementById('questAbandonBtn');
    if (abandonBtn) {
      abandonBtn.addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        if (qid) {
          if (confirm('确定要放弃这个任务吗？')) {
            self.abandonQuest(qid);
          }
        }
      });
    }

    // ---- 领取奖励 ----
    var claimBtn = document.getElementById('questClaimBtn');
    if (claimBtn) {
      claimBtn.addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        if (qid) self.claimReward(qid);
      });
    }

    // ---- 时间轴步骤点击（当前步骤可进入交互） ----
    var timelineItems = document.querySelectorAll('.quest-step-active');
    for (var t = 0; t < timelineItems.length; t++) {
      timelineItems[t].addEventListener('click', function () {
        var stepIdx = parseInt(this.getAttribute('data-step-index'), 10);
        if (!isNaN(stepIdx) && self.selectedQuest) {
          self.showInteraction(self.selectedQuest, stepIdx);
        }
      });
    }

    // ---- 前往地点按钮 ----
    var travelBtns = document.querySelectorAll('.quest-travel-go-btn');
    for (var tb = 0; tb < travelBtns.length; tb++) {
      travelBtns[tb].addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleTravel(qid, sIdx);
      });
    }

    // ---- 对话选项 ----
    var choiceBtns = document.querySelectorAll('.quest-btn-choice');
    for (var cb = 0; cb < choiceBtns.length; cb++) {
      choiceBtns[cb].addEventListener('click', function () {
        var cIdx = parseInt(this.getAttribute('data-choice-index'), 10);
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleDialogueChoice(qid, sIdx, cIdx);
      });
    }

    // ---- 对话继续按钮 ----
    var continueBtns = document.querySelectorAll('.quest-dialogue-continue-btn');
    for (var ctb = 0; ctb < continueBtns.length; ctb++) {
      continueBtns[ctb].addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.completeStep(qid, sIdx, '对话完成');
      });
    }

    // ---- 购买按钮 ----
    var buyBtns = document.querySelectorAll('.quest-btn-buy');
    for (var bb = 0; bb < buyBtns.length; bb++) {
      buyBtns[bb].addEventListener('click', function () {
        if (this.classList.contains('quest-btn-disabled')) return;
        var iIdx = parseInt(this.getAttribute('data-item-index'), 10);
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleBuyItem(qid, sIdx, iIdx);
      });
    }

    // ---- 离开商店按钮 ----
    var exitShopBtns = document.querySelectorAll('.quest-shop-exit-btn');
    for (var es = 0; es < exitShopBtns.length; es++) {
      exitShopBtns[es].addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.completeStep(qid, sIdx, '离开商店');
      });
    }

    // ---- 送礼按钮 ----
    var giftBtns = document.querySelectorAll('.quest-btn-gift');
    for (var gb = 0; gb < giftBtns.length; gb++) {
      giftBtns[gb].addEventListener('click', function () {
        var itemName = this.getAttribute('data-item-name');
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleGiftItem(qid, sIdx, itemName);
      });
    }

    // ---- 调查点点击 ----
    var investPoints = document.querySelectorAll('.quest-investigate-point');
    for (var ip = 0; ip < investPoints.length; ip++) {
      investPoints[ip].addEventListener('click', function () {
        var pIdx = parseInt(this.getAttribute('data-point-index'), 10);
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleInvestigatePoint(qid, sIdx, pIdx);
      });
    }

    // ---- 完成调查按钮 ----
    var investDoneBtns = document.querySelectorAll('.quest-investigate-done-btn');
    for (var idb = 0; idb < investDoneBtns.length; idb++) {
      investDoneBtns[idb].addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.completeStep(qid, sIdx, '调查完成');
      });
    }

    // ---- 等待跳过按钮 ----
    var waitSkipBtns = document.querySelectorAll('.quest-wait-skip-btn');
    for (var ws = 0; ws < waitSkipBtns.length; ws++) {
      waitSkipBtns[ws].addEventListener('click', function () {
        self.clearTimers();
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.completeStep(qid, sIdx, '等待结束');
      });
    }

    // ---- 选择分支选项 ----
    var optionBtns = document.querySelectorAll('.quest-btn-option');
    for (var ob = 0; ob < optionBtns.length; ob++) {
      optionBtns[ob].addEventListener('click', function () {
        var oIdx = parseInt(this.getAttribute('data-option-index'), 10);
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleSelectOption(qid, sIdx, oIdx);
      });
    }

    // ---- 自定义操作按钮 ----
    var customActionBtns = document.querySelectorAll('.quest-custom-action-btn');
    for (var ca = 0; ca < customActionBtns.length; ca++) {
      customActionBtns[ca].addEventListener('click', function () {
        var aIdx = parseInt(this.getAttribute('data-action-index'), 10);
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.handleCustomAction(qid, sIdx, aIdx);
      });
    }

    // ---- 自定义完成按钮 ----
    var customDoneBtns = document.querySelectorAll('.quest-custom-done-btn');
    for (var cd = 0; cd < customDoneBtns.length; cd++) {
      customDoneBtns[cd].addEventListener('click', function () {
        var qid = this.getAttribute('data-quest-id');
        var sIdx = parseInt(this.getAttribute('data-step-index'), 10);
        self.completeStep(qid, sIdx, '自定义步骤完成');
      });
    }
  };

  /* ============================================================
   *  交互处理函数
   * ============================================================ */

  /**
   * 处理"前往地点"交互
   */
  QuestApp.prototype.handleTravel = function (questId, stepIndex) {
    var self = this;
    // 显示动画
    var goBtn = document.querySelector('.quest-travel-go-btn');
    var animEl = document.querySelector('.quest-travel-anim');
    if (goBtn) goBtn.style.display = 'none';
    if (animEl) animEl.style.display = 'block';

    // 进度条动画
    var fillEl = document.querySelector('.quest-travel-progress-fill');
    if (fillEl) {
      fillEl.style.transition = 'width 3s ease-in-out';
      // 触发重绘后设置宽度
      fillEl.offsetWidth;
      fillEl.style.width = '100%';
    }

    // 3秒后自动完成
    self.travelTimer = setTimeout(function () {
      self.completeStep(questId, stepIndex, '已到达目的地');
    }, 3000);
  };

  /**
   * 处理对话选项选择
   */
  QuestApp.prototype.handleDialogueChoice = function (questId, stepIndex, choiceIndex) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) return;
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) return;

    var choices = step.choices || [];
    var choice = choices[choiceIndex];

    // 添加玩家消息气泡
    var messagesEl = document.getElementById('questDialogueMessages');
    if (messagesEl && choice) {
      var bubble = document.createElement('div');
      bubble.className = 'quest-dialogue-bubble quest-bubble-player';
      bubble.innerHTML = '<span>' + self.escapeHtml(choice.text || choice.label || '') + '</span>';
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // 如果有NPC回复
    if (choice && choice.reply) {
      setTimeout(function () {
        if (messagesEl) {
          var replyBubble = document.createElement('div');
          replyBubble.className = 'quest-dialogue-bubble quest-bubble-npc';
          var npcName = (step.npc && step.npc.name) ? step.npc.name : 'NPC';
          replyBubble.innerHTML = '<span class="quest-bubble-speaker">' + self.escapeHtml(npcName) + '</span>' +
            '<span class="quest-typewriter" data-full-text="' + self.escapeAttr(choice.reply) + '"></span>';
          messagesEl.appendChild(replyBubble);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          self.startTypewriterEffect();
        }
      }, 500);
    }

    // 隐藏选项
    var choicesEl = document.querySelector('.quest-dialogue-choices');
    if (choicesEl) choicesEl.style.display = 'none';

    // 显示继续按钮
    var continueEl = document.querySelector('.quest-dialogue-continue');
    if (continueEl) continueEl.style.display = 'block';

    // 保存选择结果
    self._lastChoiceResult = choice;
  };

  /**
   * 处理购买物品
   */
  QuestApp.prototype.handleBuyItem = function (questId, stepIndex, itemIndex) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) return;
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) return;

    var shop = step.shop || {};
    var items = shop.items || step.items || [];
    var item = items[itemIndex];
    if (!item) return;

    // 检查金钱
    var money = 0;
    try {
      if (window.BridgeAPI && typeof window.BridgeAPI._readVar === 'function') {
        var moneyVal = window.BridgeAPI._readVar('xb.game.money');
        if (moneyVal && typeof moneyVal.then !== 'function') {
          money = parseInt(moneyVal, 10) || 0;
        }
      }
    } catch (e) {
      money = 0;
    }

    if (money < (item.price || 0)) {
      self.showToast('金钱不足', 'error');
      return;
    }

    // 扣除金钱
    if (window.BridgeAPI && typeof window.BridgeAPI._writeVar === 'function') {
      window.BridgeAPI._writeVar('xb.game.money', String(money - (item.price || 0)));
    }

    // 添加到背包
    if (window.BridgeAPI && typeof window.BridgeAPI.get === 'function') {
      try {
        var invStr = window.BridgeAPI.get('inventory', '[]');
        var inventory = JSON.parse(invStr);
        if (!Array.isArray(inventory)) inventory = [];
        inventory.push({ name: item.name, description: item.description });
        if (typeof window.BridgeAPI.set === 'function') {
          window.BridgeAPI.set('inventory', JSON.stringify(inventory));
        }
      } catch (e) {
        console.error('[QuestApp] 更新背包失败:', e);
      }
    }

    self.showToast('购买成功: ' + (item.name || '物品'), 'success');

    // 更新金钱显示
    var moneyEl = document.getElementById('questShopMoney');
    if (moneyEl) {
      moneyEl.textContent = String(money - (item.price || 0));
    }

    // 更新按钮状态
    var buyBtns = document.querySelectorAll('.quest-btn-buy');
    for (var i = 0; i < buyBtns.length; i++) {
      var idx = parseInt(buyBtns[i].getAttribute('data-item-index'), 10);
      if (idx === itemIndex) {
        buyBtns[i].classList.add('quest-btn-disabled');
        buyBtns[i].textContent = '已购买';
      }
    }
  };

  /**
   * 处理送礼
   */
  QuestApp.prototype.handleGiftItem = function (questId, stepIndex, itemName) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) return;
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) return;

    // 从背包移除物品
    try {
      if (window.BridgeAPI && typeof window.BridgeAPI._readVar === 'function') {
        var invVal = window.BridgeAPI._readVar('xb.game.inventory');
        if (invVal && typeof invVal.then !== 'function') {
          var inventory = JSON.parse(invVal);
          if (Array.isArray(inventory)) {
            var newInv = [];
            var removed = false;
            for (var i = 0; i < inventory.length; i++) {
              if (!removed && (inventory[i].name === itemName || inventory[i].id === itemName)) {
                removed = true;
                continue;
              }
              newInv.push(inventory[i]);
            }
            if (typeof window.BridgeAPI._writeVar === 'function') {
              window.BridgeAPI._writeVar('xb.game.inventory', JSON.stringify(newInv));
            }
          }
        }
      }
    } catch (e) {
      console.error('[QuestApp] 更新背包失败:', e);
    }

    // 显示反馈
    var feedbackEl = document.getElementById('questGiftFeedback');
    if (feedbackEl) {
      var preferredItems = step.preferredItems || [];
      var isPreferred = preferredItems.indexOf(itemName) !== -1;
      var reaction = '';
      if (isPreferred) {
        reaction = (step.preferredReaction) || ('对方非常喜欢' + itemName + '！');
      } else {
        reaction = (step.normalReaction) || ('对方收下了' + itemName + '。');
      }
      feedbackEl.innerHTML = '<div class="quest-gift-reaction ' + (isPreferred ? 'quest-reaction-happy' : 'quest-reaction-normal') + '">' +
        '<i class="fa-solid ' + (isPreferred ? 'fa-heart' : 'fa-face-smile') + '"></i>' +
        '<p>' + self.escapeHtml(reaction) + '</p></div>';
      feedbackEl.style.display = 'block';
    }

    self.showToast('已送出 ' + itemName, 'success');
  };

  /**
   * 处理调查点
   */
  QuestApp.prototype.handleInvestigatePoint = function (questId, stepIndex, pointIndex) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) return;
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) return;

    var points = step.points || step.clues || [];
    var point = points[pointIndex];
    if (!point) return;

    // 标记已调查
    var pointEl = document.querySelectorAll('.quest-investigate-point')[pointIndex];
    if (pointEl) {
      pointEl.classList.add('quest-investigated');
      var iconEl = pointEl.querySelector('.quest-investigate-point-icon');
      if (iconEl) {
        iconEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      }
    }

    // 显示调查结果
    var resultEl = document.getElementById('questInvestigateResult');
    if (resultEl) {
      resultEl.style.display = 'block';
      var clueHtml = '<div class="quest-clue-found">';
      clueHtml += '<div class="quest-clue-icon"><i class="fa-solid fa-magnifying-glass-plus"></i></div>';
      clueHtml += '<div class="quest-clue-content">';
      clueHtml += '<h4>' + self.escapeHtml(point.name || point.target || '发现') + '</h4>';
      clueHtml += '<p>' + self.escapeHtml(point.result || point.description || point.clue || '你仔细观察了一番...') + '</p>';
      clueHtml += '</div>';
      clueHtml += '</div>';
      resultEl.innerHTML = clueHtml;
    }
  };

  /**
   * 处理选择分支
   */
  QuestApp.prototype.handleSelectOption = function (questId, stepIndex, optionIndex) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) return;
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) return;

    var options = step.options || step.choices || [];
    var option = options[optionIndex];

    // 高亮选中项
    var optionBtns = document.querySelectorAll('.quest-btn-option');
    for (var i = 0; i < optionBtns.length; i++) {
      optionBtns[i].classList.remove('quest-option-selected');
      optionBtns[i].classList.add('quest-option-disabled');
    }
    if (optionBtns[optionIndex]) {
      optionBtns[optionIndex].classList.add('quest-option-selected');
    }

    // 显示结果
    var resultEl = document.getElementById('questSelectResult');
    if (resultEl && option) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<div class="quest-select-result-content">' +
        '<div class="quest-select-result-icon"><i class="fa-solid fa-lightbulb"></i></div>' +
        '<p>' + self.escapeHtml(option.result || option.feedback || '你做出了选择。') + '</p>' +
        '</div>' +
        '<button class="quest-btn quest-btn-primary" onclick="window.questApp.completeStep(\'' + questId + '\', ' + stepIndex + ', \'选择完成\')">' +
        '<i class="fa-solid fa-arrow-right"></i> 继续' +
        '</button>';
    }
  };

  /**
   * 处理自定义操作
   */
  QuestApp.prototype.handleCustomAction = function (questId, stepIndex, actionIndex) {
    var self = this;
    var quest = self.findQuest(questId);
    if (!quest) return;
    var steps = quest.steps || [];
    var step = steps[stepIndex];
    if (!step) return;

    var actions = step.actions || [];
    var action = actions[actionIndex];
    if (!action) return;

    // 执行自定义回调
    if (action.callback && typeof action.callback === 'function') {
      action.callback(questId, stepIndex, actionIndex);
    }

    // 如果有自定义结果
    if (action.result) {
      self.showToast(action.result, 'info');
    }
  };

  /* ============================================================
   *  打字机效果
   * ============================================================ */
  QuestApp.prototype.startTypewriterEffect = function () {
    var self = this;
    var elements = document.querySelectorAll('.quest-typewriter:not(.quest-typed)');
    for (var i = 0; i < elements.length; i++) {
      (function (el) {
        var fullText = el.getAttribute('data-full-text') || '';
        if (!fullText) return;
        el.textContent = '';
        el.classList.add('quest-typing');
        var charIndex = 0;
        var speed = 30; // 每字符毫秒数

        function typeNext() {
          if (charIndex < fullText.length) {
            el.textContent += fullText.charAt(charIndex);
            charIndex++;
            // 滚动到底部
            var container = el.closest('.quest-dialogue-messages');
            if (container) container.scrollTop = container.scrollHeight;
            self.typingTimer = setTimeout(typeNext, speed);
          } else {
            el.classList.remove('quest-typing');
            el.classList.add('quest-typed');
          }
        }
        typeNext();
      })(elements[i]);
    }
  };

  /* ============================================================
   *  等待倒计时
   * ============================================================ */
  QuestApp.prototype.startWaitTimer = function () {
    var self = this;
    var ringFill = document.querySelector('.quest-wait-ring-fill');
    var timerText = document.getElementById('questWaitTimerText');
    if (!ringFill || !timerText) return;

    var duration = parseInt(ringFill.getAttribute('data-duration'), 10) || 60;
    var circumference = 2 * Math.PI * 45; // r=45
    ringFill.style.strokeDasharray = String(circumference);
    ringFill.style.strokeDashoffset = '0';

    var startTime = Date.now();
    var endTime = startTime + duration * 1000;

    function updateTimer() {
      var now = Date.now();
      var remaining = Math.max(0, endTime - now);
      var seconds = Math.ceil(remaining / 1000);

      timerText.textContent = self.formatSeconds(seconds);

      // 更新环形进度
      var progress = 1 - (remaining / (duration * 1000));
      var offset = circumference * (1 - progress);
      ringFill.style.strokeDashoffset = String(offset);

      if (remaining <= 0) {
        // 等待结束，自动完成步骤
        var qid = '';
        var sIdx = 0;
        var skipBtn = document.querySelector('.quest-wait-skip-btn');
        if (skipBtn) {
          qid = skipBtn.getAttribute('data-quest-id');
          sIdx = parseInt(skipBtn.getAttribute('data-step-index'), 10);
        }
        self.completeStep(qid, sIdx, '等待完成');
        return;
      }

      self.waitTimer = setTimeout(updateTimer, 100);
    }

    updateTimer();
  };

  /* ============================================================
   *  工具方法
   * ============================================================ */

  /**
   * 查找任务（合并注册表和活跃任务）
   */
  QuestApp.prototype.findQuest = function (questId) {
    var self = this;
    // 先在注册表中查找
    for (var i = 0; i < self.registry.length; i++) {
      if (self.registry[i].id === questId) {
        var base = self.registry[i];
        // 合并活跃状态
        var active = self.activeQuests[questId];
        if (active) {
          var merged = {};
          for (var key in base) {
            if (base.hasOwnProperty(key)) merged[key] = base[key];
          }
          for (var aKey in active) {
            if (active.hasOwnProperty(aKey)) merged[aKey] = active[aKey];
          }
          return merged;
        }
        return base;
      }
    }
    // 在活跃任务中查找（可能不在注册表中）
    if (self.activeQuests[questId]) {
      return self.activeQuests[questId];
    }
    return null;
  };

  /**
   * 获取任务类型标签
   */
  QuestApp.prototype.getQuestTypeLabel = function (type) {
    return TYPE_LABELS[type] || '未知';
  };

  /**
   * 获取任务类型图标
   */
  QuestApp.prototype.getQuestTypeIcon = function (type) {
    return TYPE_ICONS[type] || 'fa-solid fa-question';
  };

  /**
   * 获取步骤类型图标
   */
  QuestApp.prototype.getStepTypeIcon = function (type) {
    return STEP_ICONS[type] || 'fa-solid fa-circle';
  };

  /**
   * 获取状态标签
   */
  QuestApp.prototype.getStatusLabel = function (status) {
    return STATUS_LABELS[status] || '未知';
  };

  /**
   * 格式化时间戳
   */
  QuestApp.prototype.formatTime = function (timestamp) {
    if (!timestamp) return '';
    var date = new Date(timestamp);
    var h = date.getHours();
    var m = date.getMinutes();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return month + '/' + day + ' ' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  };

  /**
   * 格式化倒计时
   */
  QuestApp.prototype.formatCountdown = function (ms) {
    if (ms <= 0) return '已超时';
    var totalSec = Math.floor(ms / 1000);
    var hours = Math.floor(totalSec / 3600);
    var minutes = Math.floor((totalSec % 3600) / 60);
    var seconds = totalSec % 60;
    if (hours > 0) {
      return hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  };

  /**
   * 格式化秒数为 mm:ss
   */
  QuestApp.prototype.formatSeconds = function (seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  /**
   * 显示Toast提示
   */
  QuestApp.prototype.showToast = function (message, type) {
    var self = this;
    // 移除已有toast
    var existing = document.querySelector('.quest-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'quest-toast quest-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发动画
    toast.offsetWidth;
    toast.classList.add('quest-toast-show');

    setTimeout(function () {
      toast.classList.remove('quest-toast-show');
      toast.classList.add('quest-toast-hide');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 2000);
  };

  /**
   * 更新手机界面头部
   */
  QuestApp.prototype.updateHeader = function () {
    var self = this;
    if (window.mobilePhone && typeof window.mobilePhone.updateAppHeader === 'function') {
      var title = '任务';
      if (self.currentView === 'detail') {
        var quest = self.findQuest(self.selectedQuest);
        title = quest ? quest.name : '任务详情';
      } else if (self.currentView === 'interaction') {
        title = '交互';
      }
      window.mobilePhone.updateAppHeader({
        title: title,
        icon: 'fa-solid fa-scroll',
        showBack: self.currentView !== 'main'
      });
    }
  };

  /**
   * HTML转义
   */
  QuestApp.prototype.escapeHtml = function (str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  /**
   * 属性值转义
   */
  QuestApp.prototype.escapeAttr = function (str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  /**
   * 清除所有定时器
   */
  QuestApp.prototype.clearTimers = function () {
    var self = this;
    if (self.typingTimer) {
      clearTimeout(self.typingTimer);
      self.typingTimer = null;
    }
    if (self.waitTimer) {
      clearTimeout(self.waitTimer);
      self.waitTimer = null;
    }
    if (self.travelTimer) {
      clearTimeout(self.travelTimer);
      self.travelTimer = null;
    }
    // [APP-Fix-4] 清理聊天监听的 setInterval 和 setTimeout
    if (self._chatCheckInterval) {
      clearInterval(self._chatCheckInterval);
      self._chatCheckInterval = null;
    }
    if (self._chatCheckTimeout) {
      clearTimeout(self._chatCheckTimeout);
      self._chatCheckTimeout = null;
    }
  };

  /* ============================================================
   *  全局接口
   * ============================================================ */

  /** 创建单例 */
  var app = new QuestApp();

  /** 挂载到 window */
  window.QuestApp  = QuestApp;
  window.questApp  = app;

  /**
   * 获取应用HTML内容（供手机框架调用）
   */
  window.getQuestAppContent = function () {
    return '<div id="questAppContainer" class="quest-app-container">' + app.getAppContent() + '</div>';
  };

  /**
   * 绑定事件（供手机框架调用）
   */
  window.bindQuestAppEvents = function () {
    app.bindEvents();
    app.startTypewriterEffect();
    app.startWaitTimer();
  };

  /**
   * 销毁应用（供手机框架调用）
   */
  window.questAppDestroy = function () {
    app.clearTimers();

    // [APP-Fix-3] 移除 QuestEngine 事件监听器
    if (app._questEventHandlers && window.QuestEngine && typeof window.QuestEngine.removeListener === 'function') {
      for (var i = 0; i < app._questEventHandlers.length; i++) {
        window.QuestEngine.removeListener(app._questEventHandlers[i].event, app._questEventHandlers[i].handler);
      }
      app._questEventHandlers = [];
      console.log('[QuestApp] 已移除 QuestEngine 事件监听器');
    }

    // [APP-Fix-4] 移除 CHAT_CHANGED 事件监听器
    if (app._chatChangeHandler) {
      try {
        var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        var eventSource = ctx && ctx.eventSource;
        if (eventSource && typeof eventSource.removeListener === 'function') {
          eventSource.removeListener(app._chatChangeEventType, app._chatChangeHandler);
        }
      } catch (e) {}
      app._chatChangeHandler = null;
      app._chatChangeEventType = null;
    }

    app.currentView = 'main';
    app.currentCategory = 'all';
    app.selectedQuest = null;
    app.selectedStep = null;
    app.viewStack = [];
  };

  /**
   * 强制刷新（供手机框架调用）
   */
  window.questAppForceReload = function () {
    app.clearTimers();
    app.refreshData().then(function () {
      app.renderApp();
    });
  };

})();
