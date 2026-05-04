/**
 * quest-planner-bridge.js
 * ENA Planner 桥接模块 —— 将小白X的ENA Planner与动态任务系统连接
 *
 * 运行环境：Android WebView + Node.js（SillyTavern外置手机3.0插件）
 * 依赖：window.QuestEngine, window.BridgeAPI, window.XBBridge, window.RoleAPI
 *
 * 兼容约束：
 *   - 不使用 ES Module、顶层 await
 *   - 不使用 optional chaining (?.)、nullish coalescing (??)
 *   - 使用 IIFE + var/function 声明
 */

(function () {
  'use strict';

  // ============================================================
  // 常量定义
  // ============================================================

  /** 世界书中任务状态条目的固定 key */
  var WB_QUEST_KEY = '手机任务/当前任务/quest';

  /** 世界书中任务状态条目的固定 UID（用于查找/更新） */
  var WB_QUEST_UID = 'quest_planner_active_status';

  /** 自动生成定时器的最小间隔（30秒），防止过于频繁 */
  var MIN_AUTO_INTERVAL = 30000;

  /** 变量路径前缀 */
  var VAR_PREFIX = 'xb.quest';

  // ============================================================
  // 默认配置
  // ============================================================

  var DEFAULT_CONFIG = {
    enabled: true,              // 模块总开关
    autoGenerate: true,         // 是否自动生成任务
    generateInterval: 300000,   // 自动生成间隔（5分钟）
    maxActiveQuests: 10,        // 最大同时活跃任务数
    maxRegistrySize: 50,        // 注册表最大任务数
    apiChannel: 'xb',           // 'xb'使用小白X桥接, 'custom'使用自定义API
    temperature: 0.9,           // AI生成温度
    maxTokens: 2000             // AI生成最大token数
  };

  // ============================================================
  // Prompt 模板
  // ============================================================

  /**
   * 任务生成 Prompt 模板
   * 占位符会在 buildPrompt 中被替换为实际值
   */
  var QUEST_GENERATE_PROMPT = [
    '你是一个剧情任务设计师。根据当前游戏状态，生成2-3个新的可交互任务。',
    '',
    '【当前角色】{charName}',
    '【当前场景】{scene}',
    '【游戏时间】{gameTime}',
    '【玩家状态】金钱:{money} 玫瑰值:{rose}',
    '【角色关系】{relationships}',
    '',
    '【已有任务】',
    '{activeQuests}',
    '',
    '【任务生成规则】',
    '1. 任务必须与当前剧情相关',
    '2. 任务类型：主线(main)、支线(side)、日常(daily)、临时事件(event)',
    '3. 交互类型：travel(前往地点)、dialogue(对话)、shopping(购物)、gift(送礼)、investigate(调查)、select(选择分支)、wait(等待)',
    '4. 每个任务1-4个步骤',
    '5. 奖励要合理（金钱、物品、关系值提升）',
    '6. 考虑前置条件和时间限制',
    '',
    '请以JSON数组格式返回任务定义，格式如下：',
    '[',
    '  {',
    '    "name": "任务名称",',
    '    "description": "任务描述",',
    '    "type": "main|side|daily|event",',
    '    "category": "investigation|shopping|gift|travel|social|combat",',
    '    "priority": 1-5,',
    '    "publisher": "发布者名称",',
    '    "conditions": {',
    '      "requiredQuests": [],',
    '      "requiredVariables": [],',
    '      "minPhase": 0',
    '    },',
    '    "timeLimit": null或分钟数,',
    '    "rewards": [',
    '      {"type": "variable", "path": "xb.game.money", "op": "+", "value": 500}',
    '    ],',
    '    "steps": [',
    '      {',
    '        "name": "步骤名称",',
    '        "description": "步骤描述",',
    '        "type": "travel|dialogue|shopping|gift|investigate|select|wait|custom",',
    '        "target": "目标",',
    '        "interactionType": "goto|select|input|confirm|wait",',
    '        "completionConditions": {"type": "auto"},',
    '        "choices": null或[{"text": "选项", "result": "结果"}],',
    '        "rewards": []',
    '      }',
    '    ],',
    '    "chainTo": null或后续任务ID',
    '  }',
    ']',
    '',
    '只返回JSON数组，不要其他内容。'
  ].join('\n');

  /**
   * 后续任务生成 Prompt 模板
   * 用于任务完成后生成后续/关联任务
   */
  var FOLLOWUP_PROMPT = [
    '你是一个剧情任务设计师。根据刚完成的任务，生成1-2个后续任务。',
    '',
    '【刚完成的任务】',
    '名称：{completedName}',
    '类型：{completedType}',
    '结果：{completedResult}',
    '',
    '【当前角色】{charName}',
    '【当前场景】{scene}',
    '【游戏时间】{gameTime}',
    '【玩家状态】金钱:{money} 玫瑰值:{rose}',
    '',
    '【已有任务】',
    '{activeQuests}',
    '',
    '【后续任务生成规则】',
    '1. 后续任务应与刚完成的任务有逻辑关联',
    '2. 可以是任务的延续、奖励领取、或解锁的新线索',
    '3. 遵循与主任务相同的格式要求',
    '',
    '请以JSON数组格式返回任务定义，格式与主任务生成相同。',
    '只返回JSON数组，不要其他内容。'
  ].join('\n');

  // ============================================================
  // 辅助函数
  // ============================================================

  /**
   * 安全获取嵌套属性值
   * 替代 optional chaining，兼容旧环境
   * @param {Object} obj - 目标对象
   * @param {string} path - 属性路径，如 'a.b.c'
   * @param {*} defaultValue - 默认值
   * @returns {*}
   */
  function safeGet(obj, path, defaultValue) {
    if (!obj || typeof path !== 'string') {
      return defaultValue;
    }
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      current = current[parts[i]];
    }
    return (current === null || current === undefined) ? defaultValue : current;
  }

  /**
   * 生成唯一ID
   * 格式：qp_{时间戳}_{随机数}
   * @returns {string}
   */
  function generateId() {
    var ts = Date.now().toString(36);
    var rand = Math.floor(Math.random() * 10000).toString(36);
    return 'qp_' + ts + '_' + rand;
  }

  /**
   * 简单的延迟 Promise
   * @param {number} ms - 毫秒
   * @returns {Promise}
   */
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * 将字符串安全截断
   * @param {string} str
   * @param {number} maxLen
   * @returns {string}
   */
  function truncate(str, maxLen) {
    if (typeof str !== 'string') return '';
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen) + '...';
  }

  /**
   * 序列化对象为可读字符串（用于日志）
   * @param {*} obj
   * @returns {string}
   */
  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return String(obj);
    }
  }

  /**
   * 深度合并两个对象（仅合并普通对象属性）
   * @param {Object} target
   * @param {Object} source
   * @returns {Object}
   */
  function deepMerge(target, source) {
    var result = {};
    var key;

    // 复制 target 的属性
    for (key in target) {
      if (target.hasOwnProperty(key)) {
        result[key] = target[key];
      }
    }

    // 合并 source 的属性
    for (key in source) {
      if (source.hasOwnProperty(key)) {
        var sourceVal = source[key];
        var targetVal = result[key];

        if (
          sourceVal !== null &&
          typeof sourceVal === 'object' &&
          !Array.isArray(sourceVal) &&
          targetVal !== null &&
          typeof targetVal === 'object' &&
          !Array.isArray(targetVal)
        ) {
          // 递归合并普通对象
          result[key] = deepMerge(targetVal, sourceVal);
        } else {
          // 直接覆盖
          result[key] = sourceVal;
        }
      }
    }

    return result;
  }

  /**
   * 从文本中提取 JSON 数组
   * AI 返回的内容可能包含 markdown 代码块或其他文本
   * @param {string} text
   * @returns {Array|null}
   */
  function extractJSONArray(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    // 尝试1：直接解析
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      // 继续尝试其他方式
    }

    // 尝试2：提取 ```json ... ``` 代码块
    var codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    var match = codeBlockRegex.exec(text);
    while (match) {
      try {
        var blockContent = match[1].trim();
        var parsed2 = JSON.parse(blockContent);
        if (Array.isArray(parsed2)) {
          return parsed2;
        }
      } catch (e) {
        // 继续尝试下一个代码块
      }
      match = codeBlockRegex.exec(text);
    }

    // 尝试3：提取第一个 [ 到最后一个 ] 之间的内容
    var firstBracket = text.indexOf('[');
    var lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        var extracted = text.substring(firstBracket, lastBracket + 1);
        var parsed3 = JSON.parse(extracted);
        if (Array.isArray(parsed3)) {
          return parsed3;
        }
      } catch (e) {
        // 解析失败
      }
    }

    return null;
  }

  /**
   * 日志输出（统一管理）
   * @param {string} level - 'log' | 'warn' | 'error'
   * @param {string} msg
   * @param {*} [data]
   */
  function log(level, msg, data) {
    var prefix = '[QuestPlannerBridge]';
    if (data !== undefined) {
      console[level](prefix + ' ' + msg, data);
    } else {
      console[level](prefix + ' ' + msg);
    }
  }

  // ============================================================
  // QuestPlannerBridge 主对象
  // ============================================================

  var QuestPlannerBridge = {
    // ----------------------------------------------------------
    // 配置
    // ----------------------------------------------------------
    config: deepMerge({}, DEFAULT_CONFIG),

    /** 自动生成定时器句柄 */
    _timer: null,

    /** 是否正在生成中（防止并发） */
    _isGenerating: false,

    /** 上次生成时间戳 */
    _lastGenerateTime: 0,

    /** 统计数据 */
    _stats: {
      totalGenerated: 0,     // 总共生成的任务数
      totalRegistered: 0,    // 总共注册的任务数
      totalCompleted: 0,     // 总共完成的任务数
      totalFollowUps: 0,     // 总共生成的后续任务数
      generateCount: 0,      // 生成调用次数
      lastError: null,       // 最后一次错误信息
      lastErrorTime: 0       // 最后一次错误时间
    },

    /**
     * 发布远程事件（通过 PluginBridge）
     * @param {string} eventName - 事件名
     * @param {Object} data - 事件数据
     */
    _emitRemote: function (eventName, data) {
      if (window.BridgeAPI && window.BridgeAPI._bridgeEnabled) {
        try {
          window.BridgeAPI._publishEvent(eventName, data);
        } catch (e) {
          console.warn('[QuestPlannerBridge] 远程事件发布失败 (' + eventName + '):', e && e.message);
        }
      }
    },

    // ==========================================================
    // 初始化
    // ==========================================================

    /**
     * 初始化模块
     * - 检查依赖是否可用
     * - 加载已保存的配置
     * - 监听 QuestEngine 事件
     * - 如果配置了自动生成，则启动定时器
     */
    init: function () {
      log('log', '初始化 QuestPlannerBridge...');

      // 检查依赖
      if (!this.isAvailable()) {
        log('warn', '依赖检查未通过，模块将在依赖就绪后自动激活');
        return false;
      }

      // 从 BridgeAPI 加载已保存的配置（如果有）
      this._loadConfig();

      // 注册 QuestEngine 事件监听
      this._registerEventListeners();

      // 如果启用了自动生成，启动定时器
      if (this.config.enabled && this.config.autoGenerate) {
        this.startAutoGenerate();
      }

      log('log', 'QuestPlannerBridge 初始化完成', {
        enabled: this.config.enabled,
        autoGenerate: this.config.autoGenerate,
        generateInterval: this.config.generateInterval
      });

      // 发布桥接模块就绪事件
      this._emitRemote('quest.planner_ready', {
        config: this.config,
        timestamp: Date.now()
      });

      return true;
    },

    /**
     * 从 BridgeAPI 加载已保存的配置
     * @private
     */
    _loadConfig: function () {
      var self = this;
      return new Promise(function (resolve) {
        try {
          if (window.BridgeAPI && typeof window.BridgeAPI._readVar === 'function') {
            window.BridgeAPI._readVar('xb.quest.planner.config').then(function (savedConfig) {
              if (savedConfig) {
                // _readVar 可能返回字符串或对象，需要兼容处理
                var parsed = savedConfig;
                if (typeof savedConfig === 'string') {
                  try {
                    parsed = JSON.parse(savedConfig);
                  } catch (parseErr) {
                    log('warn', '配置JSON解析失败:', parseErr.message);
                    resolve();
                    return;
                  }
                }
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                  self.config = deepMerge(DEFAULT_CONFIG, parsed);
                  log('log', '已从变量加载配置');
                }
              }
              resolve();
            }).catch(function () {
              resolve();
            });
          } else {
            resolve();
          }
        } catch (e) {
          log('warn', '加载配置失败: ' + e.message);
          resolve();
        }
      });
    },

    /**
     * 保存当前配置到 BridgeAPI
     * @private
     */
    _saveConfig: function () {
      var self = this;
      return new Promise(function (resolve) {
        try {
          if (window.BridgeAPI && typeof window.BridgeAPI._writeVar === 'function') {
            // 将配置对象序列化为 JSON 字符串再写入
            var configStr = JSON.stringify(self.config);
            window.BridgeAPI._writeVar('xb.quest.planner.config', configStr).then(function () {
              log('log', '配置已保存到变量');
              resolve();
            }).catch(function () {
              resolve();
            });
          } else {
            resolve();
          }
        } catch (e) {
          log('warn', '保存配置失败: ' + e.message);
          resolve();
        }
      });
    },

    /**
     * 注册 QuestEngine 事件监听
     * @private
     */
    _registerEventListeners: function () {
      var self = this;

      try {
        if (window.QuestEngine && typeof window.QuestEngine.on === 'function') {
          // 监听任务完成事件
          window.QuestEngine.on('quest:completed', function (event) {
            self.onQuestCompleted(event.questId, event.state || event.questState);
          });

          // 监听步骤完成事件
          window.QuestEngine.on('quest:stepCompleted', function (event) {
            self.onStepCompleted(event.questId, event.stepIndex, event.result);
          });

          log('log', '已注册 QuestEngine 事件监听');
        }
      } catch (e) {
        log('warn', '注册事件监听失败: ' + e.message);
      }
    },

    // ==========================================================
    // 任务生成
    // ==========================================================

    /**
     * 手动触发任务生成
     * 完整流程：收集上下文 → 构建Prompt → 调用AI → 解析结果 → 注册任务
     *
     * @param {Object} [options] - 可选参数
     * @param {number} [options.count] - 期望生成的任务数量（默认2-3）
     * @param {string} [options.type] - 指定任务类型过滤
     * @param {string} [options.focus] - 生成侧重点描述
     * @returns {Promise<Array>} 生成的任务定义数组
     */
    generateQuests: function (options) {
      var self = this;

      // 参数默认值
      options = options || {};

      // 防止并发生成
      if (this._isGenerating) {
        log('warn', '任务生成正在进行中，跳过本次请求');
        return Promise.resolve([]);
      }

      // 检查依赖
      if (!this.isAvailable()) {
        log('error', '依赖不可用，无法生成任务');
        return Promise.reject(new Error('依赖不可用'));
      }

      // 检查活跃任务数是否已达上限
      var activeCount = this._getActiveQuestCount();
      if (activeCount >= this.config.maxActiveQuests) {
        log('warn', '活跃任务数已达上限 (' + activeCount + '/' + this.config.maxActiveQuests + ')');
        return Promise.resolve([]);
      }

      this._isGenerating = true;
      this._stats.generateCount++;

      log('log', '开始生成任务...', options);

      return this.collectContext()
        .then(function (context) {
          var prompt = self.buildPrompt(context, options);
          return self.callAI(prompt);
        })
        .then(function (response) {
          var quests = self.parseQuestDefinitions(response);
          log('log', '解析到 ' + quests.length + ' 个任务定义');

          // 更新统计
          self._stats.totalGenerated += quests.length;

          return self.registerGeneratedQuests(quests);
        })
        .then(function (registered) {
          self._stats.totalRegistered += registered.length;
          self._lastGenerateTime = Date.now();
          log('log', '成功注册 ' + registered.length + ' 个任务');

          // 发布任务创建事件（远程通知）
          self._emitRemote('quest.batch_created', {
            quests: registered,
            count: registered.length,
            timestamp: Date.now()
          });

          return registered;
        })
        .catch(function (err) {
          log('error', '任务生成失败: ' + err.message, err);
          self._stats.lastError = err.message;
          self._stats.lastErrorTime = Date.now();
          return [];
        })
        .then(function (result) {
          self._isGenerating = false;
          return result;
        });
    },

    /**
     * 收集上下文信息
     * 从小白X桥接获取角色卡、世界书、聊天历史、当前任务状态等
     *
     * @returns {Promise<Object>} 上下文对象
     */
    collectContext: function () {
      var self = this;
      var context = {
        charName: '未知角色',
        scene: '未知场景',
        gameTime: '未知',
        money: 0,
        rose: 0,
        relationships: '',
        activeQuests: [],
        chatHistory: [],
        worldInfo: ''
      };

      return new Promise(function (resolve) {
        // 1. 获取角色信息（同步）
        var snapshot = null;
        try {
          if (window.XBBridge && window.XBBridge.context && typeof window.XBBridge.context.getSnapshot === 'function') {
            snapshot = window.XBBridge.context.getSnapshot();
            if (snapshot) {
              if (snapshot.characterName) context.charName = snapshot.characterName;
              if (snapshot.scene) context.scene = snapshot.scene;
              if (snapshot.gameTime) context.gameTime = snapshot.gameTime;
              if (snapshot.chatId) context.chatId = snapshot.chatId;
              if (snapshot.characterId) context.characterId = snapshot.characterId;
            }
          }
        } catch (e) {
          log('warn', '获取上下文快照失败:', e);
        }

        // 5. 从 snapshot 获取最近消息（替代不存在的 RoleAPI.getRecentMessages）
        if (snapshot && snapshot.chat && Array.isArray(snapshot.chat)) {
          var recent = snapshot.chat.slice(-10);
          context.chatHistory = recent.map(function (msg) {
            var role = msg.is_user ? 'user' : 'assistant';
            var content = msg.mes || msg.message || '';
            return { role: role, content: content };
          });
        }

        // 2. 获取游戏变量（金钱、玫瑰值、场景、时间等）—— 异步，需要等待
        var moneyPromise;
        var rosePromise;
        var relationshipsPromise;
        var activeQuestsPromise;
        var scenePromise;
        var gameTimePromise;

        try {
          if (window.BridgeAPI && typeof window.BridgeAPI._readVar === 'function') {
            moneyPromise = window.BridgeAPI._readVar('xb.game.money')
              .then(function (val) { context.money = val || 0; })
              .catch(function () {});
            rosePromise = window.BridgeAPI._readVar('xb.game.rose')
              .then(function (val) { context.rose = val || 0; })
              .catch(function () {});
            relationshipsPromise = window.BridgeAPI._readVar('xb.game.relationships')
              .then(function (relationships) {
                if (relationships) {
                  if (typeof relationships === 'object') {
                    var relParts = [];
                    var relKey;
                    for (relKey in relationships) {
                      if (relationships.hasOwnProperty(relKey)) {
                        relParts.push(relKey + ':' + relationships[relKey]);
                      }
                    }
                    context.relationships = relParts.join(', ');
                  } else {
                    context.relationships = String(relationships);
                  }
                }
              })
              .catch(function () {});
            // 从变量读取场景和时间（当 snapshot 中没有时作为回退）
            scenePromise = window.BridgeAPI._readVar('xb.game.scene')
              .then(function (val) {
                if (val && context.scene === '未知场景') {
                  context.scene = String(val);
                }
              })
              .catch(function () {});
            gameTimePromise = window.BridgeAPI._readVar('xb.game.time')
              .then(function (val) {
                if (val && context.gameTime === '未知') {
                  context.gameTime = String(val);
                }
              })
              .catch(function () {});
          } else {
            moneyPromise = Promise.resolve();
            rosePromise = Promise.resolve();
            relationshipsPromise = Promise.resolve();
            scenePromise = Promise.resolve();
            gameTimePromise = Promise.resolve();
          }
        } catch (e) {
          log('warn', '获取游戏变量失败: ' + e.message);
          moneyPromise = Promise.resolve();
          rosePromise = Promise.resolve();
          relationshipsPromise = Promise.resolve();
          scenePromise = Promise.resolve();
          gameTimePromise = Promise.resolve();
        }

        // 4. 获取当前活跃任务列表 —— 异步，需要等待
        try {
          if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
            activeQuestsPromise = window.QuestEngine.getActiveQuests()
              .then(function (activeQuests) {
                if (Array.isArray(activeQuests)) {
                  context.activeQuests = activeQuests.map(function (q) {
                    return {
                      id: safeGet(q, 'id', ''),
                      name: safeGet(q, 'name', '未命名'),
                      type: safeGet(q, 'type', 'side'),
                      status: safeGet(q, 'status', 'active'),
                      currentStep: safeGet(q, 'currentStep', 0),
                      totalSteps: safeGet(q, 'steps.length', 0)
                    };
                  });
                }
              })
              .catch(function () {});
          } else {
            activeQuestsPromise = Promise.resolve();
          }
        } catch (e) {
          log('warn', '获取活跃任务失败: ' + e.message);
          activeQuestsPromise = Promise.resolve();
        }

        // 等待所有异步操作完成后，再加载任务模板并 resolve
        Promise.all([moneyPromise, rosePromise, relationshipsPromise, activeQuestsPromise, scenePromise, gameTimePromise])
          .then(function () {
            // 6. 获取世界书中的任务模板
            return self.loadQuestTemplates();
          })
          .then(function (templates) {
            context.questTemplates = templates || [];
            resolve(context);
          })
          .catch(function () {
            // 模板加载失败不影响上下文收集
            context.questTemplates = [];
            resolve(context);
          });
      });
    },

    /**
     * 构建生成 Prompt
     * 将上下文信息填充到模板中
     *
     * @param {Object} context - collectContext 返回的上下文
     * @param {Object} [options] - 生成选项
     * @returns {string} 完整的 Prompt 字符串
     */
    buildPrompt: function (context, options) {
      options = options || {};

      // 格式化活跃任务列表
      var activeQuestsText = '无';
      if (context.activeQuests && context.activeQuests.length > 0) {
        activeQuestsText = context.activeQuests.map(function (q) {
          var stepInfo = '';
          if (q.totalSteps > 0) {
            stepInfo = ' (步骤 ' + (q.currentStep + 1) + '/' + q.totalSteps + ')';
          }
          return '- [' + q.type + '] ' + q.name + stepInfo + ' (' + q.status + ')';
        }).join('\n');
      }

      // 格式化聊天历史摘要（最近几条，用于理解剧情）
      var chatSummary = '';
      if (context.chatHistory && context.chatHistory.length > 0) {
        var recentChats = context.chatHistory.slice(-5);
        chatSummary = '\n【近期对话摘要】\n' +
          recentChats.map(function (m) {
            return (m.role === 'user' ? '玩家' : '角色') + ': ' + truncate(m.content, 100);
          }).join('\n');
      }

      // 如果有任务模板，添加到 Prompt 中
      var templateHint = '';
      if (context.questTemplates && context.questTemplates.length > 0) {
        templateHint = '\n【可用任务模板】\n' +
          context.questTemplates.map(function (t) {
            return '- ' + safeGet(t, 'name', '') + ': ' + truncate(safeGet(t, 'description', ''), 80);
          }).join('\n');
      }

      // 如果有生成侧重点，添加提示
      var focusHint = '';
      if (options.focus) {
        focusHint = '\n【生成侧重点】' + options.focus;
      }

      // 如果指定了任务类型，添加过滤提示
      var typeHint = '';
      if (options.type) {
        typeHint = '\n【任务类型要求】只生成 ' + options.type + ' 类型的任务';
      }

      // 填充模板
      var prompt = QUEST_GENERATE_PROMPT
        .replace('{charName}', context.charName || '未知角色')
        .replace('{scene}', context.scene || '未知场景')
        .replace('{gameTime}', context.gameTime || '未知')
        .replace('{money}', String(context.money || 0))
        .replace('{rose}', String(context.rose || 0))
        .replace('{relationships}', context.relationships || '无')
        .replace('{activeQuests}', activeQuestsText);

      // 拼接额外提示
      prompt = prompt + chatSummary + templateHint + focusHint + typeHint;

      return prompt;
    },

    /**
     * 调用 AI 生成任务
     * 根据 config.apiChannel 选择不同的 API 通道
     *
     * @param {string} prompt - 完整的 Prompt
     * @returns {Promise<string>} AI 返回的原始文本
     */
    callAI: function (prompt) {
      var self = this;

      return new Promise(function (resolve, reject) {
        // 优先使用 UnifiedAI（小手机自己的 AI 调用模块）
        if (window.UnifiedAI && typeof window.UnifiedAI.call === 'function') {
          window.UnifiedAI.call(prompt, {
            maxTokens: self.config.maxTokens || 2000,
            temperature: self.config.temperature || 0.9,
            backend: 'auto',
            fallback: true
          }).then(resolve).catch(reject);
          return;
        }

        // 降级：使用小白X桥接
        if (self.config.apiChannel === 'xb') {
          self._callViaXBBridge(prompt, resolve, reject);
        } else if (self.config.apiChannel === 'custom') {
          self._callViaCustomAPI(prompt, resolve, reject);
        } else {
          reject(new Error('不支持的 API 通道: ' + self.config.apiChannel));
        }
      });
    },

    /**
     * 通过小白X桥接调用 AI
     * @private
     * @param {string} prompt
     * @param {Function} resolve
     * @param {Function} reject
     */
    _callViaXBBridge: function (prompt, resolve, reject) {
      try {
        // XBBridge.generate 是一个对象，不是函数
        var generateFn = null;
        if (window.XBBridge && window.XBBridge.generate && typeof window.XBBridge.generate.generate === 'function') {
          generateFn = window.XBBridge.generate.generate;
        }
        if (!generateFn) {
          reject(new Error('XBBridge.generate.generate 不可用'));
          return;
        }
        var generateOptions = {
          provider: 'inherit',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: this.config.maxTokens || 2000,
          temperature: this.config.temperature || 0.9
        };
        generateFn(generateOptions).then(function (response) {
          var text = '';
          if (typeof response === 'string') {
            text = response;
          } else if (response && response.text) {
            text = response.text;
          } else if (response && response.choices && response.choices[0]) {
            text = response.choices[0].message && response.choices[0].message.content || '';
          }
          resolve(text);
        }).catch(function (err) {
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    },

    /**
     * 通过自定义 API 调用 AI（预留扩展点）
     * @private
     * @param {string} prompt
     * @param {Function} resolve
     * @param {Function} reject
     */
    _callViaCustomAPI: function (prompt, resolve, reject) {
      // 预留自定义 API 扩展
      // 可通过 window.QuestPlannerBridge._customAPICallback 注入
      var callback = this._customAPICallback;
      if (typeof callback === 'function') {
        try {
          var result = callback(prompt, this.config);
          if (result && typeof result.then === 'function') {
            result.then(resolve).catch(reject);
          } else {
            resolve(String(result || ''));
          }
        } catch (e) {
          reject(new Error('自定义 API 调用异常: ' + e.message));
        }
      } else {
        reject(new Error('自定义 API 未配置，请设置 QuestPlannerBridge._customAPICallback'));
      }
    },

    /**
     * 解析 AI 返回的任务定义
     * 从 AI 返回的文本中提取 JSON 数组
     *
     * @param {string} response - AI 返回的原始文本
     * @returns {Array} 解析后的任务定义数组
     */
    parseQuestDefinitions: function (response) {
      var rawArray = extractJSONArray(response);

      if (!rawArray || !Array.isArray(rawArray)) {
        log('warn', '无法从 AI 响应中解析任务定义');
        return [];
      }

      // 规范化每个任务定义
      var quests = [];
      for (var i = 0; i < rawArray.length; i++) {
        try {
          var normalized = this.normalizeQuestDef(rawArray[i]);
          if (normalized) {
            quests.push(normalized);
          }
        } catch (e) {
          log('warn', '规范化第 ' + (i + 1) + ' 个任务定义失败: ' + e.message);
        }
      }

      return quests;
    },

    /**
     * 规范化任务定义
     * 确保所有必要字段完整，填充默认值
     *
     * @param {Object} raw - 原始任务定义
     * @returns {Object|null} 规范化后的任务定义，无效则返回 null
     */
    normalizeQuestDef: function (raw) {
      if (!raw || typeof raw !== 'object') {
        return null;
      }

      // 任务名称是必须的
      var name = raw.name || raw.title || '';
      if (!name) {
        log('warn', '任务定义缺少名称，已跳过');
        return null;
      }

      // 规范化任务类型
      var type = raw.type || 'side';
      var validTypes = ['main', 'side', 'daily', 'event'];
      if (validTypes.indexOf(type) === -1) {
        type = 'side';
      }

      // 规范化分类
      var category = raw.category || 'social';
      var validCategories = ['investigation', 'shopping', 'gift', 'travel', 'social', 'combat'];
      if (validCategories.indexOf(category) === -1) {
        category = 'social';
      }

      // 规范化优先级（1-5）
      var priority = parseInt(raw.priority, 10);
      if (isNaN(priority) || priority < 1 || priority > 5) {
        priority = 3;
      }

      // 规范化条件
      var conditions = raw.conditions || {};
      if (typeof conditions !== 'object' || Array.isArray(conditions)) {
        conditions = {};
      }
      if (!Array.isArray(conditions.requiredQuests)) {
        conditions.requiredQuests = [];
      }
      if (!Array.isArray(conditions.requiredVariables)) {
        conditions.requiredVariables = [];
      }
      if (typeof conditions.minPhase !== 'number') {
        conditions.minPhase = 0;
      }

      // 规范化奖励
      var rewards = raw.rewards || [];
      if (!Array.isArray(rewards)) {
        rewards = [];
      }

      // 规范化步骤
      var steps = raw.steps || [];
      if (!Array.isArray(steps) || steps.length === 0) {
        // 如果没有步骤，创建一个默认的"确认"步骤
        steps = [{
          name: '完成任务',
          description: raw.description || '完成此任务',
          type: 'custom',
          target: '',
          interactionType: 'confirm',
          completionConditions: { type: 'auto' },
          choices: null,
          rewards: []
        }];
      } else {
        // 规范化每个步骤
        steps = steps.map(function (step, idx) {
          var stepType = step.type || 'custom';
          var validStepTypes = ['travel', 'dialogue', 'shopping', 'gift', 'investigate', 'select', 'wait', 'custom'];
          if (validStepTypes.indexOf(stepType) === -1) {
            stepType = 'custom';
          }

          var interactionType = step.interactionType || 'confirm';
          var validInteractionTypes = ['goto', 'select', 'input', 'confirm', 'wait'];
          if (validInteractionTypes.indexOf(interactionType) === -1) {
            interactionType = 'confirm';
          }

          var completionConditions = step.completionConditions || { type: 'auto' };
          if (typeof completionConditions !== 'object' || Array.isArray(completionConditions)) {
            completionConditions = { type: 'auto' };
          }

          var stepRewards = step.rewards || [];
          if (!Array.isArray(stepRewards)) {
            stepRewards = [];
          }

          return {
            name: step.name || ('步骤 ' + (idx + 1)),
            description: step.description || '',
            type: stepType,
            target: step.target || '',
            interactionType: interactionType,
            completionConditions: completionConditions,
            choices: step.choices || null,
            rewards: stepRewards
          };
        });
      }

      // 构建规范化后的任务定义
      return {
        id: raw.id || generateId(),
        name: name,
        description: raw.description || '',
        type: type,
        category: category,
        priority: priority,
        publisher: raw.publisher || '系统',
        conditions: conditions,
        timeLimit: (typeof raw.timeLimit === 'number' && raw.timeLimit > 0) ? raw.timeLimit : null,
        rewards: rewards,
        steps: steps,
        chainTo: raw.chainTo || null,
        // 内部标记：由 Planner 生成的任务
        _source: 'planner',
        _generatedAt: Date.now()
      };
    },

    /**
     * 注册生成的任务到 QuestEngine
     * 检查活跃任务上限和注册表大小限制
     *
     * @param {Array} quests - 规范化后的任务定义数组
     * @returns {Promise<Array>} 成功注册的任务数组
     */
    registerGeneratedQuests: function (quests) {
      var self = this;

      return new Promise(function (resolve) {
        if (!Array.isArray(quests) || quests.length === 0) {
          resolve([]);
          return;
        }

        // 检查 QuestEngine 是否可用
        if (!window.QuestEngine || typeof window.QuestEngine.registerQuest !== 'function') {
          log('error', 'QuestEngine.registerQuest 不可用');
          resolve([]);
          return;
        }

        // 检查活跃任务上限
        var activeCount = self._getActiveQuestCount();
        var remaining = self.config.maxActiveQuests - activeCount;
        if (remaining <= 0) {
          log('warn', '活跃任务已达上限，无法注册新任务');
          resolve([]);
          return;
        }

        // 按优先级排序，优先注册高优先级任务
        var sorted = quests.slice().sort(function (a, b) {
          return (b.priority || 3) - (a.priority || 3);
        });

        // 限制注册数量
        var toRegister = sorted.slice(0, remaining);

        // 检查注册表大小
        var registrySize = self._getRegistrySize();
        if (registrySize + toRegister.length > self.config.maxRegistrySize) {
          var canRegister = self.config.maxRegistrySize - registrySize;
          if (canRegister <= 0) {
            log('warn', '注册表已满，无法注册新任务');
            resolve([]);
            return;
          }
          toRegister = toRegister.slice(0, canRegister);
        }

        // 逐个注册任务
        var registered = [];
        var errors = [];

        for (var i = 0; i < toRegister.length; i++) {
          try {
            var quest = toRegister[i];

            // 去重检查：避免注册同名任务
            var duplicate = self._findQuestByName(quest.name);
            if (duplicate) {
              log('warn', '任务 "' + quest.name + '" 已存在，跳过注册');
              continue;
            }

            window.QuestEngine.registerQuest(quest);
            registered.push(quest);
            log('log', '已注册任务: ' + quest.name + ' (' + quest.type + ')');
          } catch (e) {
            errors.push('注册任务失败: ' + e.message);
            log('warn', '注册任务失败: ' + e.message);
          }
        }

        if (errors.length > 0) {
          log('warn', errors.length + ' 个任务注册失败');
        }

        // 注册成功后，同步状态到变量和世界书
        if (registered.length > 0) {
          self.syncToVariables()
            .catch(function () { /* 忽略同步错误 */ });

          self.updateWorldbookWithQuestInfo()
            .catch(function () { /* 忽略同步错误 */ });
        }

        resolve(registered);
      });
    },

    // ==========================================================
    // 任务结果处理
    // ==========================================================

    /**
     * 处理任务完成事件
     * 由 QuestEngine 的 questCompleted 事件触发
     *
     * @param {string} questId - 完成的任务ID
     * @param {Object} questState - 任务最终状态
     */
    onQuestCompleted: function (questId, questState) {
      log('log', '任务完成: ' + questId);

      this._stats.totalCompleted++;

      // 1. 将任务结果写入小白X变量
      var result = {
        questId: questId,
        questName: safeGet(questState, 'name', '未知任务'),
        type: safeGet(questState, 'type', 'side'),
        completedAt: Date.now(),
        rewards: safeGet(questState, 'rewards', [])
      };

      this.writeQuestResultToVariables(questId, result)
        .then(function () {
          log('log', '任务结果已写入变量');
        })
        .catch(function (e) {
          log('warn', '写入任务结果到变量失败: ' + e.message);
        });

      // 2. 生成后续任务（异步，不阻塞）
      if (safeGet(questState, '_source') === 'planner') {
        this.generateFollowUpQuests(questId, result)
          .then(function (followUps) {
            if (followUps.length > 0) {
              log('log', '已生成 ' + followUps.length + ' 个后续任务');
            }
          })
          .catch(function (e) {
            log('warn', '生成后续任务失败: ' + e.message);
          });
      }

      // 3. 更新世界书中的任务信息
      this.updateWorldbookWithQuestInfo()
        .catch(function () { /* 忽略 */ });
    },

    /**
     * 处理任务步骤完成事件
     * 由 QuestEngine 的 stepCompleted 事件触发
     *
     * @param {string} questId - 任务ID
     * @param {number} stepIndex - 完成的步骤索引
     * @param {Object} result - 步骤结果
     */
    onStepCompleted: function (questId, stepIndex, result) {
      log('log', '任务步骤完成: ' + questId + ' 步骤' + stepIndex);

      // 步骤完成时，可以触发一些中间逻辑
      // 例如：更新变量、发送通知等

      try {
        if (window.BridgeAPI && typeof window.BridgeAPI._writeVar === 'function') {
          // 更新当前任务进度变量
          window.BridgeAPI._writeVar(
            VAR_PREFIX + '.currentProgress',
            '任务 ' + questId + ' 步骤 ' + (stepIndex + 1) + ' 已完成'
          ).catch(function () {});
        }
      } catch (e) {
        log('warn', '更新步骤进度变量失败: ' + e.message);
      }
    },

    /**
     * 将任务结果写入小白X变量
     * 供循环任务和其他模块读取
     *
     * @param {string} questId - 任务ID
     * @param {Object} result - 任务结果
     * @returns {Promise}
     */
    writeQuestResultToVariables: function (questId, result) {
      var self = this;

      return new Promise(function (resolve, reject) {
        try {
          if (!window.BridgeAPI || typeof window.BridgeAPI._writeVar !== 'function') {
            reject(new Error('BridgeAPI._writeVar 不可用'));
            return;
          }

          // 写入标准变量（链式调用）
          window.BridgeAPI._writeVar(
            VAR_PREFIX + '.lastCompleted',
            questId
          ).then(function () {
            return window.BridgeAPI._writeVar(
              VAR_PREFIX + '.lastCompletedType',
              safeGet(result, 'type', 'side')
            );
          }).then(function () {
            return window.BridgeAPI._writeVar(
              VAR_PREFIX + '.lastCompletedResult',
              safeGet(result, 'questName', '未知') + ' - 已完成'
            );
          }).then(function () {
            // 构建通知内容（供 independent-ai.js 消费）
            var notifyContent = {
              type: 'quest_completed',
              questId: questId,
              questName: safeGet(result, 'questName', '未知任务'),
              questType: safeGet(result, 'type', 'side'),
              timestamp: Date.now()
            };

            return window.BridgeAPI._writeVar(
              VAR_PREFIX + '.pendingNotify',
              JSON.stringify(notifyContent)
            );
          }).then(function () {
            // 更新活跃任务摘要
            self._updateActiveSummary();
            resolve();
          }).catch(function (e) {
            reject(e);
          });
        } catch (e) {
          reject(e);
        }
      });
    },

    /**
     * 生成后续任务
     * 基于已完成的任务结果，生成关联的后续任务
     *
     * @param {string} completedQuestId - 已完成的任务ID
     * @param {Object} result - 完成结果
     * @returns {Promise<Array>} 生成的后续任务数组
     */
    generateFollowUpQuests: function (completedQuestId, result) {
      var self = this;

      if (this._isGenerating) {
        return Promise.resolve([]);
      }

      this._isGenerating = true;

      return this.collectContext()
        .then(function (context) {
          // 构建后续任务 Prompt
          var prompt = FOLLOWUP_PROMPT
            .replace('{completedName}', safeGet(result, 'questName', '未知任务'))
            .replace('{completedType}', safeGet(result, 'type', 'side'))
            .replace('{completedResult}', safeGet(result, 'questName', '') + ' 已完成')
            .replace('{charName}', context.charName || '未知角色')
            .replace('{scene}', context.scene || '未知场景')
            .replace('{gameTime}', context.gameTime || '未知')
            .replace('{money}', String(context.money || 0))
            .replace('{rose}', String(context.rose || 0));

          // 填充活跃任务列表
          var activeQuestsText = '无';
          if (context.activeQuests && context.activeQuests.length > 0) {
            activeQuestsText = context.activeQuests.map(function (q) {
              return '- [' + q.type + '] ' + q.name + ' (' + q.status + ')';
            }).join('\n');
          }
          prompt = prompt.replace('{activeQuests}', activeQuestsText);

          return self.callAI(prompt);
        })
        .then(function (response) {
          var quests = self.parseQuestDefinitions(response);

          // 为后续任务设置前置条件
          for (var i = 0; i < quests.length; i++) {
            if (!quests[i].conditions) {
              quests[i].conditions = {};
            }
            if (!Array.isArray(quests[i].conditions.requiredQuests)) {
              quests[i].conditions.requiredQuests = [];
            }
            quests[i].conditions.requiredQuests.push(completedQuestId);
          }

          self._stats.totalFollowUps += quests.length;
          return self.registerGeneratedQuests(quests);
        })
        .catch(function (err) {
          log('warn', '生成后续任务失败: ' + err.message);
          return [];
        })
        .then(function (result) {
          self._isGenerating = false;
          return result;
        });
    },

    // ==========================================================
    // 变量同步
    // ==========================================================

    /**
     * 从小白X变量同步任务相关数据
     * 读取外部设置的任务参数，更新内部配置
     *
     * @returns {Promise}
     */
    syncFromVariables: function () {
      var self = this;

      return new Promise(function (resolve, reject) {
        try {
          if (!window.BridgeAPI || typeof window.BridgeAPI._readVar !== 'function') {
            reject(new Error('BridgeAPI 不可用'));
            return;
          }

          // 读取外部配置覆盖（链式调用）
          window.BridgeAPI._readVar(VAR_PREFIX + '.enabled').then(function (externalEnabled) {
            if (typeof externalEnabled === 'boolean') {
              self.config.enabled = externalEnabled;
            }
            return window.BridgeAPI._readVar(VAR_PREFIX + '.autoGenerate');
          }).then(function (externalAutoGenerate) {
            if (typeof externalAutoGenerate === 'boolean') {
              self.config.autoGenerate = externalAutoGenerate;
            }
            return window.BridgeAPI._readVar(VAR_PREFIX + '.generateInterval');
          }).then(function (externalInterval) {
            if (typeof externalInterval === 'number' && externalInterval >= MIN_AUTO_INTERVAL) {
              self.config.generateInterval = externalInterval;
            }
            return window.BridgeAPI._readVar(VAR_PREFIX + '.templateRefs');
          }).then(function (templateRefs) {
            if (Array.isArray(templateRefs)) {
              self._externalTemplateRefs = templateRefs;
            }

            log('log', '变量同步完成');
            resolve();
          }).catch(function (e) {
            reject(e);
          });
        } catch (e) {
          reject(e);
        }
      });
    },

    /**
     * 将任务状态写入小白X变量
     * 供其他模块（循环任务、独立AI等）读取
     *
     * @returns {Promise}
     */
    syncToVariables: function () {
      var self = this;

      return new Promise(function (resolve, reject) {
        try {
          if (!window.BridgeAPI || typeof window.BridgeAPI._writeVar !== 'function') {
            reject(new Error('BridgeAPI 不可用'));
            return;
          }

          // 写入活跃任务数量
          var activeCount = self._getActiveQuestCount();
          window.BridgeAPI._writeVar(
            VAR_PREFIX + '.activeCount',
            activeCount
          ).then(function () {
            // 写入活跃任务摘要
            self._updateActiveSummary();
            return window.BridgeAPI._writeVar(
              VAR_PREFIX + '.stats',
              JSON.stringify(self._stats)
            );
          }).then(function () {
            // 写入最后生成时间
            return window.BridgeAPI._writeVar(
              VAR_PREFIX + '.lastGenerateTime',
              self._lastGenerateTime
            );
          }).then(function () {
            log('log', '任务状态已同步到变量');
            resolve();
          }).catch(function (e) {
            reject(e);
          });
        } catch (e) {
          reject(e);
        }
      });
    },

    /**
     * 更新活跃任务摘要变量
     * @private
     */
    _updateActiveSummary: function () {
      var self = this;
      try {
        if (!window.BridgeAPI || typeof window.BridgeAPI._writeVar !== 'function') {
          return;
        }

        // 使用异步版本获取摘要
        self._buildActiveSummaryAsync().then(function (summary) {
          window.BridgeAPI._writeVar(
            VAR_PREFIX + '.activeSummary',
            summary
          ).catch(function () {});
        }).catch(function () {
          // 降级使用同步版本
          var summary = self._buildActiveSummary();
          window.BridgeAPI._writeVar(
            VAR_PREFIX + '.activeSummary',
            summary
          ).catch(function () {});
        });
      } catch (e) {
        log('warn', '更新活跃任务摘要失败: ' + e.message);
      }
    },

    /**
     * 构建活跃任务摘要文本
     * @private
     * @returns {string}
     */
    _buildActiveSummary: function () {
      // 注意: getActiveQuests 是异步方法，这里返回同步版本用于简单场景
      // 完整版本应使用 _buildActiveSummaryAsync
      var quests = [];
      try {
        if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
          var result = window.QuestEngine.getActiveQuests();
          // 如果结果是 Promise，返回默认文本（异步版本由调用方处理）
          if (result && typeof result.then === 'function') {
            return '当前没有活跃任务。';
          }
          quests = result || [];
        }
      } catch (e) {
        // 忽略
      }

      if (!Array.isArray(quests) || quests.length === 0) {
        return '当前没有活跃任务。';
      }

      var lines = [];
      for (var i = 0; i < quests.length; i++) {
        var q = quests[i];
        var name = safeGet(q, 'name', '未命名');
        var type = safeGet(q, 'type', 'side');
        var status = safeGet(q, 'status', 'active');
        var steps = safeGet(q, 'steps', []);
        var currentStep = safeGet(q, 'currentStep', 0);

        var typeLabel = {
          'main': '主线',
          'side': '支线',
          'daily': '日常',
          'event': '事件'
        };
        var typeText = typeLabel[type] || type;

        var stepInfo = '';
        if (steps.length > 0) {
          stepInfo = ' (进度 ' + (currentStep + 1) + '/' + steps.length + ')';
        }

        var statusText = status === 'active' ? '进行中' :
                         status === 'completed' ? '已完成' :
                         status === 'failed' ? '已失败' : status;

        lines.push('- [' + typeText + '] ' + name + stepInfo + ' (' + statusText + ')');
      }

      return lines.join('\n');
    },

    /**
     * 异步构建活跃任务摘要文本
     * @private
     * @returns {Promise<string>}
     */
    _buildActiveSummaryAsync: function () {
      var self = this;
      return new Promise(function (resolve) {
        try {
          if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
            window.QuestEngine.getActiveQuests().then(function (quests) {
              if (!Array.isArray(quests) || quests.length === 0) {
                resolve('当前没有活跃任务。');
                return;
              }
              var lines = [];
              for (var i = 0; i < quests.length; i++) {
                var q = quests[i];
                var name = safeGet(q, 'name', '未命名');
                var type = safeGet(q, 'type', 'side');
                var status = safeGet(q, 'status', 'active');
                var steps = safeGet(q, 'steps', []);
                var currentStep = safeGet(q, 'currentStep', 0);
                var typeLabel = { 'main': '主线', 'side': '支线', 'daily': '日常', 'event': '事件' };
                var typeText = typeLabel[type] || type;
                var stepInfo = steps.length > 0 ? ' (进度 ' + (currentStep + 1) + '/' + steps.length + ')' : '';
                var statusText = status === 'active' ? '进行中' : status === 'completed' ? '已完成' : status === 'failed' ? '已失败' : status;
                lines.push('- [' + typeText + '] ' + name + stepInfo + ' (' + statusText + ')');
              }
              resolve(lines.join('\n'));
            }).catch(function () {
              resolve('当前没有活跃任务。');
            });
          } else {
            resolve('当前没有活跃任务。');
          }
        } catch (e) {
          resolve('当前没有活跃任务。');
        }
      });
    },

    // ==========================================================
    // 自动生成
    // ==========================================================

    /**
     * 启动自动生成定时器
     * 按配置的间隔自动调用 generateQuests
     */
    startAutoGenerate: function () {
      // 先停止已有的定时器
      this.stopAutoGenerate();

      var interval = this.config.generateInterval;
      if (interval < MIN_AUTO_INTERVAL) {
        interval = MIN_AUTO_INTERVAL;
      }

      var self = this;
      this._timer = setInterval(function () {
        self._autoGenerateTick();
      }, interval);

      log('log', '自动生成已启动，间隔: ' + (interval / 1000) + '秒');
    },

    /**
     * 停止自动生成定时器
     */
    stopAutoGenerate: function () {
      if (this._timer !== null) {
        clearInterval(this._timer);
        this._timer = null;
        log('log', '自动生成已停止');
      }
    },

    /**
     * 自动生成定时器回调
     * @private
     */
    _autoGenerateTick: function () {
      // 检查模块是否启用
      if (!this.config.enabled) {
        return;
      }

      // 检查是否正在生成
      if (this._isGenerating) {
        return;
      }

      // 检查距离上次生成是否已过足够时间
      var now = Date.now();
      var elapsed = now - this._lastGenerateTime;
      if (elapsed < this.config.generateInterval * 0.8) {
        // 还没到时间（留20%缓冲）
        return;
      }

      // 检查活跃任务数
      var activeCount = this._getActiveQuestCount();
      if (activeCount >= this.config.maxActiveQuests) {
        return;
      }

      log('log', '自动生成触发');
      this.generateQuests();
    },

    // ==========================================================
    // 世界书集成
    // ==========================================================

    /**
     * 从世界书读取任务模板
     * 查找以 "任务模板/" 或 "quest_template/" 开头的条目
     *
     * @returns {Promise<Array>} 任务模板数组
     */
    loadQuestTemplates: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (window.XBBridge && window.XBBridge.worldbook && typeof window.XBBridge.worldbook.findEntry === 'function') {
          window.XBBridge.worldbook.findEntry({ field: 'key', text: '任务模板' })
            .then(function (found) {
              if (found && found.content) {
                resolve(self.parseQuestDefinitions(found.content));
              } else {
                // 尝试英文key
                return window.XBBridge.worldbook.findEntry({ field: 'key', text: 'quest_template' });
              }
            })
            .then(function (found) {
              if (found && found.content) {
                resolve(self.parseQuestDefinitions(found.content));
              } else {
                resolve([]);
              }
            })
            .catch(function () { resolve([]); });
        } else {
          resolve([]);
        }
      });
    },

    /**
     * 解析单个世界书条目为任务模板
     * @private
     * @param {Object} entry - 世界书条目
     * @returns {Object|null}
     */
    _parseTemplateEntry: function (entry) {
      try {
        var key = safeGet(entry, 'key', '') || safeGet(entry, 'comment', '');
        var content = safeGet(entry, 'content', '');

        // 尝试从内容中解析 JSON 模板
        var templateData = null;
        try {
          templateData = JSON.parse(content);
        } catch (e) {
          // 不是 JSON，当作纯文本模板描述
          templateData = { description: content };
        }

        return {
          key: key,
          name: safeGet(templateData, 'name', key),
          description: safeGet(templateData, 'description', content),
          type: safeGet(templateData, 'type', 'side'),
          category: safeGet(templateData, 'category', 'social'),
          steps: safeGet(templateData, 'steps', []),
          conditions: safeGet(templateData, 'conditions', {}),
          raw: templateData
        };
      } catch (e) {
        return null;
      }
    },

    /**
     * 将当前任务信息写入世界书
     * 创建/更新一个 constant + always on 的条目，
     * 让 ST 主 AI 在生成回复时能感知当前任务状态
     *
     * @returns {Promise}
     */
    updateWorldbookWithQuestInfo: function () {
      var self = this;

      return new Promise(function (resolve) {
        if (!window.XBBridge || !window.XBBridge.worldbook) {
          resolve(false);
          return;
        }

        // 使用异步版本构建摘要
        self._buildActiveSummaryAsync().then(function (summary) {
          var worldbookContent = [
            '{{char}}当前的手机任务状态：',
            summary,
            '',
            '基于此在剧情中自然提及相关任务。'
          ].join('\n');

        var wb = window.XBBridge.worldbook;

        // 先查找是否已存在该条目
        var findPromise = null;
        if (typeof wb.findEntry === 'function') {
          findPromise = wb.findEntry({ field: 'key', text: WB_QUEST_KEY });
        } else {
          findPromise = Promise.resolve(null);
        }

        findPromise.then(function (found) {
          if (found && found.uid) {
            // 更新已有条目
            if (typeof wb.setEntryField === 'function') {
              return wb.setEntryField({ uid: found.uid, field: 'content', value: worldbookContent });
            }
          } else {
            // 创建新条目
            if (typeof wb.createEntry === 'function') {
              return wb.createEntry({ key: WB_QUEST_KEY, content: worldbookContent });
            }
          }
          return Promise.resolve(false);
        }).then(function () {
          // 发布世界书同步事件
          self._emitRemote('quest.worldbook_synced', {
            timestamp: Date.now()
          });
          resolve(true);
        }); // 关闭 findPromise.then
        }).catch(function (e) {
          console.warn('[QuestPlanner] 更新世界书失败:', e);
          resolve(false);
        }); // 关闭 _buildActiveSummaryAsync().then + catch
      }); // 关闭 new Promise
    },

    // ==========================================================
    // 工具方法
    // ==========================================================

    /**
     * 检查依赖是否可用
     * 验证 QuestEngine、BridgeAPI、XBBridge 等核心依赖
     *
     * @returns {boolean}
     */
    isAvailable: function () {
      var hasQuestEngine = !!(window.QuestEngine &&
        typeof window.QuestEngine.registerQuest === 'function');

      var hasBridgeAPI = !!(window.BridgeAPI &&
        typeof window.BridgeAPI._readVar === 'function');

      var hasXBBridge = !!(window.XBBridge);

      // QuestEngine 是必须的，其他为可选
      if (!hasQuestEngine) {
        log('warn', 'QuestEngine 不可用');
        return false;
      }

      if (!hasBridgeAPI) {
        log('warn', 'BridgeAPI 不可用');
        return false;
      }

      return true;
    },

    /**
     * 获取统计信息
     * 返回模块运行状态和统计数据
     *
     * @returns {Object}
     */
    getStats: function () {
      return {
        // 配置状态
        enabled: this.config.enabled,
        autoGenerate: this.config.autoGenerate,
        apiChannel: this.config.apiChannel,
        generateInterval: this.config.generateInterval,
        isAutoRunning: this._timer !== null,
        isGenerating: this._isGenerating,

        // 任务统计
        activeQuests: this._getActiveQuestCount(),
        registrySize: this._getRegistrySize(),
        maxActiveQuests: this.config.maxActiveQuests,
        maxRegistrySize: this.config.maxRegistrySize,

        // 累计统计
        totalGenerated: this._stats.totalGenerated,
        totalRegistered: this._stats.totalRegistered,
        totalCompleted: this._stats.totalCompleted,
        totalFollowUps: this._stats.totalFollowUps,
        generateCount: this._stats.generateCount,

        // 时间信息
        lastGenerateTime: this._lastGenerateTime,
        lastGenerateAgo: this._lastGenerateTime > 0 ?
          Math.floor((Date.now() - this._lastGenerateTime) / 1000) + '秒前' : '从未',

        // 错误信息
        lastError: this._stats.lastError,
        lastErrorTime: this._stats.lastErrorTime > 0 ?
          new Date(this._stats.lastErrorTime).toISOString() : null,

        // 依赖状态
        dependencies: {
          questEngine: !!(window.QuestEngine),
          bridgeAPI: !!(window.BridgeAPI),
          xbBridge: !!(window.XBBridge),
          roleAPI: !!(window.RoleAPI)
        }
      };
    },

    /**
     * 更新配置
     * 合并新配置到现有配置，并保存
     *
     * @param {Object} newConfig - 新配置项
     */
    updateConfig: function (newConfig) {
      if (!newConfig || typeof newConfig !== 'object') {
        return;
      }

      this.config = deepMerge(this.config, newConfig);
      this._saveConfig();

      // 如果自动生成配置变更，重新启动定时器
      if (newConfig.autoGenerate !== undefined || newConfig.generateInterval !== undefined) {
        if (this.config.enabled && this.config.autoGenerate) {
          this.startAutoGenerate();
        } else {
          this.stopAutoGenerate();
        }
      }

      log('log', '配置已更新');
    },

    /**
     * 重置统计信息
     */
    resetStats: function () {
      this._stats = {
        totalGenerated: 0,
        totalRegistered: 0,
        totalCompleted: 0,
        totalFollowUps: 0,
        generateCount: 0,
        lastError: null,
        lastErrorTime: 0
      };
      log('log', '统计信息已重置');
    },

    // ==========================================================
    // 内部辅助方法
    // ==========================================================

    /**
     * 获取当前活跃任务数量
     * @private
     * @returns {number}
     */
    _getActiveQuestCount: function () {
      try {
        if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
          var result = window.QuestEngine.getActiveQuests();
          // 如果是 Promise，尝试从缓存获取数量
          if (result && typeof result.then === 'function') {
            // 异步方法，返回 -1 表示需要异步获取
            // 调用方应使用 _getActiveQuestCountAsync
            return -1;
          }
          return Array.isArray(result) ? result.length : 0;
        }
      } catch (e) {
        // 忽略
      }
      return 0;
    },

    /**
     * 异步获取活跃任务数量
     * @private
     * @returns {Promise<number>}
     */
    _getActiveQuestCountAsync: function () {
      return new Promise(function (resolve) {
        try {
          if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
            window.QuestEngine.getActiveQuests().then(function (quests) {
              resolve(Array.isArray(quests) ? quests.length : 0);
            }).catch(function () {
              resolve(0);
            });
          } else {
            resolve(0);
          }
        } catch (e) {
          resolve(0);
        }
      });
    },

    /**
     * 获取注册表中的任务总数
     * @private
     * @returns {number}
     */
    _getRegistrySize: function () {
      try {
        if (window.QuestEngine && typeof window.QuestEngine.getRegistrySize === 'function') {
          return window.QuestEngine.getRegistrySize() || 0;
        }
        if (window.QuestEngine && typeof window.QuestEngine.getAllQuests === 'function') {
          var all = window.QuestEngine.getAllQuests();
          return Array.isArray(all) ? all.length : 0;
        }
      } catch (e) {
        // 忽略
      }
      return 0;
    },

    /**
     * 按名称查找已存在的任务（去重用）
     * @private
     * @param {string} name - 任务名称
     * @returns {Object|null}
     */
    _findQuestByName: function (name) {
      try {
        if (window.QuestEngine && typeof window.QuestEngine.getActiveQuests === 'function') {
          var result = window.QuestEngine.getActiveQuests();
          // 如果是 Promise，无法同步查找，返回 null
          if (result && typeof result.then === 'function') {
            return null;
          }
          var quests = result;
          if (Array.isArray(quests)) {
            for (var i = 0; i < quests.length; i++) {
              if (quests[i].name === name) {
                return quests[i];
              }
            }
          }
        }
      } catch (e) {
        // 忽略
      }
      return null;
    },

    /**
     * 销毁模块
     * 停止定时器，清理资源
     */
    destroy: function () {
      this.stopAutoGenerate();
      this._isGenerating = false;
      log('log', 'QuestPlannerBridge 已销毁');
    }
  };

  // ============================================================
  // 挂载到全局
  // ============================================================

  window.QuestPlannerBridge = QuestPlannerBridge;

  log('log', 'QuestPlannerBridge 已加载');

})();
