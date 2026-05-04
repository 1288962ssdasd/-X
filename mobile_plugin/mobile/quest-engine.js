/**
 * quest-engine.js - 动态任务系统核心引擎
 *
 * 运行环境：Android WebView + Node.js（SillyTavern 外置手机 3.0 插件）
 * 依赖：window.BridgeAPI（变量读写）、window.XBBridge（世界书 CRUD）、window.Phone（命名空间）
 *
 * 任务状态机：locked → available → active → reward → completed / failed / archived
 *
 * 变量协议：
 *   xb.quest.registry          - 任务注册表（JSON 字符串）
 *   xb.quest.active.{questId}  - 活跃任务状态（JSON 字符串）
 *   xb.quest.result.{questId}  - 任务结果（JSON 字符串）
 *   xb.quest.pendingAction     - 待处理的用户操作（JSON 字符串）
 *   xb.quest.lastUpdate        - 最后更新时间戳
 */
(function () {
  'use strict';

  // ============================================================
  //  常量
  // ============================================================

  /** 任务状态枚举 */
  var STATUS = {
    LOCKED: 'locked',
    AVAILABLE: 'available',
    ACTIVE: 'active',
    REWARD: 'reward',
    COMPLETED: 'completed',
    FAILED: 'failed',
    ARCHIVED: 'archived'
  };

  /** 任务类型 */
  var QUEST_TYPE = {
    MAIN: 'main',
    SIDE: 'side',
    DAILY: 'daily',
    EVENT: 'event'
  };

  /** 步骤类型 */
  var STEP_TYPE = {
    TRAVEL: 'travel',
    DIALOGUE: 'dialogue',
    SHOPPING: 'shopping',
    GIFT: 'gift',
    INVESTIGATE: 'investigate',
    WAIT: 'wait',
    CUSTOM: 'custom'
  };

  /** 交互类型 */
  var INTERACTION_TYPE = {
    GOTO: 'goto',
    SELECT: 'select',
    INPUT: 'input',
    CONFIRM: 'confirm',
    WAIT: 'wait'
  };

  /** 完成条件类型 */
  var COMPLETION_TYPE = {
    AUTO: 'auto',
    MANUAL: 'manual',
    VARIABLE: 'variable'
  };

  /** 奖励类型 */
  var REWARD_TYPE = {
    VARIABLE: 'variable',
    ITEM: 'item',
    RELATIONSHIP: 'relationship',
    QUEST: 'quest',
    FRIEND: 'friend'       // [修复v3] 好友奖励：任务步骤完成后自动添加好友到小手机
  };

  /** 变量操作符 */
  var OP_MAP = {
    '==': function (a, b) { return a == b; },
    '!=': function (a, b) { return a != b; },
    '>': function (a, b) { return a > b; },
    '>=': function (a, b) { return a >= b; },
    '<': function (a, b) { return a < b; },
    '<=': function (a, b) { return a <= b; },
    '+': function (a, b) { return (Number(a) || 0) + (Number(b) || 0); },
    '-': function (a, b) { return (Number(a) || 0) - (Number(b) || 0); }
  };

  /** 注册表最大任务数 */
  var MAX_REGISTRY_SIZE = 50;

  /** 超时检查间隔（毫秒） */
  var TIMEOUT_CHECK_INTERVAL = 30000;

  // ============================================================
  //  工具函数
  // ============================================================

  /**
   * 安全 JSON 解析，失败返回默认值
   * @param {string} str - JSON 字符串
   * @param {*} fallback - 解析失败时的默认值
   * @returns {*}
   */
  function safeParse(str, fallback) {
    if (str === undefined || str === null || str === '') {
      return fallback;
    }
    try {
      return JSON.parse(str);
    } catch (e) {
      console.warn('[QuestEngine] JSON 解析失败:', e.message);
      return fallback;
    }
  }

  /**
   * 安全 JSON 序列化
   * @param {*} obj
   * @returns {string}
   */
  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      console.error('[QuestEngine] JSON 序列化失败:', e.message);
      return '{}';
    }
  }

  /**
   * 安全调用 BridgeAPI._readVar
   * [PhoneDataStore集成] 优先从 PhoneDataStore 读取缓存
   * @param {string} varPath - 变量路径
   * @returns {Promise<*>}
   */
  function safeReadVar(varPath) {
    // [PhoneDataStore集成] 从缓存读取
    if (window.PhoneDataStore) {
      var key = varPath.replace('xb.phone.', '').replace('xb.quest.', 'quests.');
      var cached = PhoneDataStore.get(key);
      if (cached !== undefined) {
        return Promise.resolve(JSON.stringify(cached));
      }
    }
    
    if (typeof BridgeAPI === 'undefined' || !BridgeAPI || typeof BridgeAPI._readVar !== 'function') {
      return Promise.resolve(null);
    }
    return BridgeAPI._readVar(varPath);
  }

  /**
   * 安全调用 BridgeAPI._writeVar
   * [PhoneDataStore集成] 同时写入 PhoneDataStore 缓存
   * @param {string} varPath - 变量路径
   * @param {string} value - 变量值
   * @returns {Promise<*>}
   */
  function safeWriteVar(varPath, value) {
    // [PhoneDataStore集成] 写入缓存
    if (window.PhoneDataStore) {
      var key = varPath.replace('xb.phone.', '').replace('xb.quest.', 'quests.');
      try {
        var parsed = JSON.parse(value);
        PhoneDataStore.set(key, parsed, { persist: false });
      } catch (e) {
        PhoneDataStore.set(key, value, { persist: false });
      }
    }
    
    if (typeof BridgeAPI === 'undefined' || !BridgeAPI || typeof BridgeAPI._writeVar !== 'function') {
      console.warn('[QuestEngine] BridgeAPI 不可用，跳过写入: ' + varPath);
      return Promise.resolve(null);
    }
    return BridgeAPI._writeVar(varPath, value);
  }

  /**
   * 获取当前时间戳
   * @returns {number}
   */
  function now() {
    return Date.now();
  }

  /**
   * 深拷贝简单对象（仅支持 JSON 安全数据）
   * @param {*} obj
   * @returns {*}
   */
  function deepClone(obj) {
    return safeParse(safeStringify(obj), null);
  }

  /**
   * 生成唯一 ID（基于时间戳 + 随机数）
   * @param {string} [prefix] - ID 前缀
   * @returns {string}
   */
  function generateId(prefix) {
    var ts = now().toString(36);
    var rand = Math.floor(Math.random() * 10000).toString(36);
    return (prefix || 'q') + '_' + ts + '_' + rand;
  }

  // ============================================================
  //  QuestEngine 主对象
  // ============================================================

  var QuestEngine = {
    // ----------------------------------------------------------
    //  配置
    // ----------------------------------------------------------
    config: {
      /** 注册表变量路径 */
      registryVarPath: 'xb.quest.registry',
      /** 活跃任务变量路径模板 */
      activeVarTemplate: 'xb.quest.active.{questId}',
      /** 任务结果变量路径模板 */
      resultVarTemplate: 'xb.quest.result.{questId}',
      /** 待处理操作变量路径 */
      pendingActionVarPath: 'xb.quest.pendingAction',
      /** 最后更新时间变量路径 */
      lastUpdateVarPath: 'xb.quest.lastUpdate',
      /** 游戏阶段变量路径 */
      phaseVarPath: 'xb.game.phase',
      /** 游戏时间变量路径 */
      gameTimeVarPath: 'xb.game.time',
      /** 缓存 TTL（毫秒） */
      cacheTTL: 5000,
      /** 超时检查间隔（毫秒） */
      timeoutCheckInterval: TIMEOUT_CHECK_INTERVAL,
      /** 注册表最大任务数 */
      maxRegistrySize: MAX_REGISTRY_SIZE
    },

    // ----------------------------------------------------------
    //  缓存
    // ----------------------------------------------------------
    _cache: {
      registry: null,
      activeQuests: {},
      lastSync: 0,
      CACHE_TTL: 5000,
      varCache: {},
      VAR_CACHE_TTL: 5000
    },

    // ----------------------------------------------------------
    //  事件监听器
    // ----------------------------------------------------------
    _listeners: {},

    /** 超时检查定时器 ID */
    _timeoutTimerId: null,

    /** 是否已初始化 */
    _initialized: false,

    // ----------------------------------------------------------
    //  初始化
    // ----------------------------------------------------------

    /**
     * 初始化任务引擎
     * 加载注册表、恢复活跃任务缓存、启动超时检查
     * @returns {Promise<boolean>}
     */
    init: function () {
      var self = this;
      if (self._initialized) {
        console.log('[QuestEngine] 已经初始化，跳过');
        return Promise.resolve(true);
      }

      console.log('[QuestEngine] 正在初始化...');

      return self.loadRegistry()
        .then(function (registry) {
          console.log('[QuestEngine] 注册表加载完成，共 ' +
            (registry && registry.quests ? registry.quests.length : 0) + ' 个任务');
          return self.preloadGameVariables();
        })
        .then(function () {
          return self.getActiveQuests();
        })
        .then(function (activeQuests) {
          console.log('[QuestEngine] 活跃任务加载完成，共 ' + activeQuests.length + ' 个');
          self._startTimeoutCheck();
          self._initialized = true;
          self.emit('engine:initialized', { timestamp: now() });
          console.log('[QuestEngine] 初始化完成');
          return true;
        })
        .catch(function (err) {
          console.error('[QuestEngine] 初始化失败:', err);
          return false;
        });
    },

    /**
     * 销毁引擎，清理定时器和缓存
     */
    destroy: function () {
      if (this._timeoutTimerId) {
        clearInterval(this._timeoutTimerId);
        this._timeoutTimerId = null;
      }
      this._cache = { registry: null, activeQuests: {}, lastSync: 0, CACHE_TTL: 5000, varCache: {}, VAR_CACHE_TTL: 5000 };
      this._listeners = {};
      this._initialized = false;
      console.log('[QuestEngine] 引擎已销毁');
    },

    // ============================================================
    //  任务注册表管理
    // ============================================================

    /**
     * 从变量加载任务注册表
     * 优先读取缓存，缓存过期则从 BridgeAPI 重新加载
     * @returns {Promise<Object>} 注册表对象 { quests: [...], version: 1 }
     */
    loadRegistry: function () {
      var self = this;

      // 检查缓存是否有效
      if (self._cache.registry && (now() - self._cache.lastSync) < self.config.cacheTTL) {
        return Promise.resolve(self._cache.registry);
      }

      return safeReadVar(self.config.registryVarPath)
        .then(function (raw) {
          var registry = safeParse(raw, null);

          // 如果注册表不存在或格式不正确，创建空注册表
          if (!registry || !Array.isArray(registry.quests)) {
            registry = { quests: [], version: 1 };
          }

          self._cache.registry = registry;
          self._cache.lastSync = now();
          return registry;
        })
        .catch(function (err) {
          console.error('[QuestEngine] 加载注册表失败:', err);
          var emptyRegistry = { quests: [], version: 1 };
          self._cache.registry = emptyRegistry;
          self._cache.lastSync = now();
          return emptyRegistry;
        });
    },

    /**
     * 保存任务注册表到变量
     * @param {Object} registry - 注册表对象
     * @returns {Promise<boolean>}
     */
    saveRegistry: function (registry) {
      var self = this;

      if (!registry) {
        return Promise.reject(new Error('[QuestEngine] registry 不能为空'));
      }

      // 更新缓存
      self._cache.registry = registry;
      self._cache.lastSync = now();

      var jsonStr = safeStringify(registry);

      return safeWriteVar(self.config.registryVarPath, jsonStr)
        .then(function () {
          // 更新最后修改时间
          return safeWriteVar(self.config.lastUpdateVarPath, String(now()));
        })
        .then(function () {
          // [修复] 返回 true 表示保存成功
          return true;
        })
        .catch(function (err) {
          console.error('[QuestEngine] 保存注册表失败:', err);
          return false;
        });
    },

    /**
     * 注册新任务到注册表
     * 如果任务 ID 已存在则更新
     * @param {Object} questDef - 任务定义对象
     * @returns {Promise<Object>} 注册后的任务定义
     */
    registerQuest: function (questDef) {
      var self = this;

      if (!questDef || !questDef.id) {
        return Promise.reject(new Error('[QuestEngine] 任务定义缺少 id'));
      }

      return self.loadRegistry()
        .then(function (registry) {
          // 检查注册表大小
          var existIndex = -1;
          for (var i = 0; i < registry.quests.length; i++) {
            if (registry.quests[i].id === questDef.id) {
              existIndex = i;
              break;
            }
          }

          if (existIndex >= 0) {
            // 更新已有任务
            questDef.updatedAt = now();
            questDef.version = (registry.quests[existIndex].version || 1) + 1;
            registry.quests[existIndex] = questDef;
            console.log('[QuestEngine] 更新任务: ' + questDef.id);
          } else {
            // 检查注册表是否已满
            if (registry.quests.length >= self.config.maxRegistrySize) {
              console.warn('[QuestEngine] 注册表已满（最大 ' + self.config.maxRegistrySize + ' 个）');
              return Promise.reject(new Error('[QuestEngine] 注册表已满'));
            }

            // 新增任务
            questDef.createdAt = questDef.createdAt || now();
            questDef.updatedAt = now();
            questDef.version = questDef.version || 1;
            registry.quests.push(questDef);
            console.log('[QuestEngine] 注册新任务: ' + questDef.id);
          }

          return self.saveRegistry(registry);
        })
        .then(function () {
          self.emit('quest:registered', { questId: questDef.id, questDef: questDef });
          return questDef;
        });
    },

    /**
     * 批量注册任务
     * @param {Array<Object>} questDefs - 任务定义数组
     * @returns {Promise<Array<Object>>} 所有注册后的任务定义
     */
    registerQuests: function (questDefs) {
      var self = this;

      if (!Array.isArray(questDefs) || questDefs.length === 0) {
        return Promise.resolve([]);
      }

      // 串行注册，避免并发写入冲突
      var results = [];
      var promise = Promise.resolve();

      questDefs.forEach(function (def) {
        promise = promise.then(function () {
          return self.registerQuest(def).then(function (result) {
            results.push(result);
          });
        });
      });

      return promise.then(function () {
        return results;
      });
    },

    /**
     * 从注册表中移除任务
     * @param {string} questId - 任务 ID
     * @returns {Promise<boolean>}
     */
    unregisterQuest: function (questId) {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          var newQuests = [];
          var found = false;
          for (var i = 0; i < registry.quests.length; i++) {
            if (registry.quests[i].id === questId) {
              found = true;
            } else {
              newQuests.push(registry.quests[i]);
            }
          }

          if (!found) {
            console.warn('[QuestEngine] 任务不存在: ' + questId);
            return true;
          }

          registry.quests = newQuests;
          return self.saveRegistry(registry);
        })
        .then(function () {
          return true;
        });
    },

    /**
     * 根据任务 ID 从注册表获取任务定义
     * @param {string} questId - 任务 ID
     * @returns {Promise<Object|null>}
     */
    getQuestDef: function (questId) {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return null;
          }
          for (var i = 0; i < registry.quests.length; i++) {
            if (registry.quests[i].id === questId) {
              return registry.quests[i];
            }
          }
          return null;
        });
    },

    // ============================================================
    //  活跃任务管理
    // ============================================================

    /**
     * 加载指定活跃任务的状态
     * 优先读取缓存
     * @param {string} questId - 任务 ID
     * @returns {Promise<Object|null>} 任务状态对象
     */
    loadActiveQuest: function (questId) {
      var self = this;

      // 检查缓存是否存在且未过期（5秒TTL）
      var cached = self._cache.activeQuests[questId];
      if (cached && cached._cachedAt && (now() - cached._cachedAt) < self.config.cacheTTL) {
        return Promise.resolve(cached._data);
      }

      var varPath = self.config.activeVarTemplate.replace('{questId}', questId);

      return safeReadVar(varPath)
        .then(function (raw) {
          var state = safeParse(raw, null);
          if (state) {
            // 带时间戳缓存
            self._cache.activeQuests[questId] = { _data: state, _cachedAt: now() };
          }
          return state;
        })
        .catch(function (err) {
          console.error('[QuestEngine] 加载活跃任务失败 (' + questId + '):', err);
          return null;
        });
    },

    /**
     * 保存活跃任务状态
     * @param {string} questId - 任务 ID
     * @param {Object} state - 任务状态对象
     * @returns {Promise<boolean>}
     */
    saveActiveQuest: function (questId, state) {
      var self = this;

      if (!state) {
        return Promise.reject(new Error('[QuestEngine] state 不能为空'));
      }

      // [修复] 不清除缓存，而是直接更新缓存为最新 state
      self._cache.activeQuests[questId] = { _data: state, _cachedAt: now() };

      var varPath = self.config.activeVarTemplate.replace('{questId}', questId);
      var jsonStr = safeStringify(state);

      return safeWriteVar(varPath, jsonStr)
        .then(function () {
          return safeWriteVar(self.config.lastUpdateVarPath, String(now()));
        })
        .then(function () {
          return true;
        })
        .catch(function (err) {
          console.error('[QuestEngine] 保存活跃任务失败 (' + questId + '):', err);
          return false;
        });
    },

    /**
     * 获取所有活跃任务（状态为 active 或 reward 的任务）
     * @returns {Promise<Array<Object>>}
     */
    getActiveQuests: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests || registry.quests.length === 0) {
            return [];
          }

          // 并行加载所有可能活跃的任务状态
          var loadPromises = [];
          for (var i = 0; i < registry.quests.length; i++) {
            loadPromises.push(self.loadActiveQuest(registry.quests[i].id));
          }

          return Promise.all(loadPromises);
        })
        .then(function (states) {
          var activeQuests = [];
          for (var i = 0; i < states.length; i++) {
            var state = states[i];
            if (state && state.status && state.status !== 'available') {
              activeQuests.push(state);
            }
          }
          return activeQuests;
        });
    },

    /**
     * 获取所有任务的状态概览（含 locked / available / completed 等）
     * @returns {Promise<Array<Object>>}
     */
    getAllQuestStatuses: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return [];
          }

          var promises = [];
          for (var i = 0; i < registry.quests.length; i++) {
            (function (questDef) {
              promises.push(
                self.loadActiveQuest(questDef.id)
                  .then(function (state) {
                    return {
                      id: questDef.id,
                      name: questDef.name,
                      type: questDef.type,
                      priority: questDef.priority,
                      status: state ? state.status : STATUS.LOCKED,
                      currentStep: state ? state.currentStep : -1,
                      totalSteps: questDef.steps ? questDef.steps.length : 0
                    };
                  })
              );
            })(registry.quests[i]);
          }

          return Promise.all(promises);
        });
    },

    // ============================================================
    //  任务生命周期
    // ============================================================

    /**
     * 检查并解锁可用任务
     * 遍历注册表中所有 locked 任务，检查解锁条件
     * @returns {Promise<Array<string>>} 新解锁的任务 ID 列表
     */
    checkUnlocks: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return [];
          }

          var unlockPromises = [];

          for (var i = 0; i < registry.quests.length; i++) {
            (function (questDef) {
              unlockPromises.push(
                self.loadActiveQuest(questDef.id)
                  .then(function (state) {
                    // 只处理 locked 状态的任务
                    if (state && state.status !== STATUS.LOCKED) {
                      return null;
                    }

                    // 检查解锁条件
                    var unlocked = self.checkConditions(questDef.conditions);

                    if (unlocked) {
                      // 创建初始状态
                      var newState = {
                        questId: questDef.id,
                        status: STATUS.AVAILABLE,
                        currentStep: -1,
                        stepStates: [],
                        acceptedAt: null,
                        completedAt: null,
                        rewardClaimed: false,
                        progress: {}
                      };

                      return self.saveActiveQuest(questDef.id, newState)
                        .then(function () {
                          self.emit('quest:unlocked', { questId: questDef.id, questDef: questDef });
                          return questDef.id;
                        });
                    }

                    return null;
                  })
              );
            })(registry.quests[i]);
          }

          return Promise.all(unlockPromises);
        })
        .then(function (results) {
          var unlockedIds = [];
          for (var i = 0; i < results.length; i++) {
            if (results[i]) {
              unlockedIds.push(results[i]);
            }
          }
          return unlockedIds;
        });
    },

    /**
     * 接取任务
     * 将任务从 available 状态变为 active，并开始第一个步骤
     * @param {string} questId - 任务 ID
     * @returns {Promise<Object>} 更新后的任务状态
     */
    acceptQuest: function (questId) {
      var self = this;

      return Promise.all([
        self.getQuestDef(questId),
        self.loadActiveQuest(questId)
      ])
        .then(function (results) {
          var questDef = results[0];
          var state = results[1];

          if (!questDef) {
            return Promise.reject(new Error('[QuestEngine] 任务不存在: ' + questId));
          }

          if (!state) {
            return Promise.reject(new Error('[QuestEngine] 任务状态不存在: ' + questId));
          }

          if (state.status !== STATUS.AVAILABLE) {
            return Promise.reject(new Error('[QuestEngine] 任务不可接取，当前状态: ' + state.status));
          }

          // 检查是否一次性任务已完成过
          if (questDef.conditions && questDef.conditions.oneTime) {
            return self.loadQuestResult(questId)
              .then(function (result) {
                if (result && result.status === STATUS.COMPLETED) {
                  return Promise.reject(new Error('[QuestEngine] 一次性任务已完成: ' + questId));
                }
                return { questDef: questDef, state: state };
              });
          }

          return { questDef: questDef, state: state };
        })
        .then(function (data) {
          var questDef = data.questDef;
          var state = data.state;

          // 更新状态
          state.status = STATUS.ACTIVE;
          state.acceptedAt = now();
          state.currentStep = 0;

          // 初始化步骤状态
          state.stepStates = [];
          if (questDef.steps) {
            for (var i = 0; i < questDef.steps.length; i++) {
              state.stepStates.push({
                status: i === 0 ? STATUS.ACTIVE : STATUS.LOCKED,
                startedAt: i === 0 ? now() : null,
                completedAt: null,
                result: null
              });
            }
          }

          return self.saveActiveQuest(questId, state);
        })
        .then(function (savedState) {
          self.emit('quest:accepted', { questId: questId, state: savedState });
          return savedState;
        });
    },

    /**
     * 开始任务步骤
     * @param {string} questId - 任务 ID
     * @param {number} stepIndex - 步骤索引
     * @returns {Promise<Object>} 更新后的任务状态
     */
    startStep: function (questId, stepIndex) {
      var self = this;

      return Promise.all([
        self.getQuestDef(questId),
        self.loadActiveQuest(questId)
      ])
        .then(function (results) {
          var questDef = results[0];
          var state = results[1];

          if (!questDef) {
            return Promise.reject(new Error('[QuestEngine] 任务不存在: ' + questId));
          }

          if (!state || state.status !== STATUS.ACTIVE) {
            return Promise.reject(new Error('[QuestEngine] 任务未激活: ' + questId));
          }

          if (stepIndex < 0 || stepIndex >= questDef.steps.length) {
            return Promise.reject(new Error('[QuestEngine] 步骤索引越界: ' + stepIndex));
          }

          if (stepIndex !== state.currentStep) {
            return Promise.reject(new Error('[QuestEngine] 不能跳过步骤，当前步骤: ' + state.currentStep));
          }

          // 更新步骤状态
          state.stepStates[stepIndex].status = STATUS.ACTIVE;
          state.stepStates[stepIndex].startedAt = now();

          return self.saveActiveQuest(questId, state);
        })
        .then(function (savedState) {
          self.emit('quest:stepStarted', {
            questId: questId,
            stepIndex: stepIndex,
            state: savedState
          });
          return savedState;
        });
    },

    /**
     * 完成任务步骤
     * @param {string} questId - 任务 ID
     * @param {number} stepIndex - 步骤索引
     * @param {*} [result] - 步骤完成结果
     * @returns {Promise<Object>} 更新后的任务状态
     */
    completeStep: function (questId, stepIndex, result) {
      var self = this;

      return Promise.all([
        self.getQuestDef(questId),
        self.loadActiveQuest(questId)
      ])
        .then(function (results) {
          var questDef = results[0];
          var state = results[1];

          if (!questDef) {
            return Promise.reject(new Error('[QuestEngine] 任务不存在: ' + questId));
          }

          if (!state || state.status !== STATUS.ACTIVE) {
            return Promise.reject(new Error('[QuestEngine] 任务未激活: ' + questId));
          }

          if (stepIndex < 0 || stepIndex >= questDef.steps.length) {
            return Promise.reject(new Error('[QuestEngine] 步骤索引越界: ' + stepIndex));
          }

          if (state.stepStates[stepIndex].status !== STATUS.ACTIVE) {
            return Promise.reject(new Error('[QuestEngine] 步骤未激活: ' + stepIndex));
          }

          // 标记步骤完成
          state.stepStates[stepIndex].status = STATUS.COMPLETED;
          state.stepStates[stepIndex].completedAt = now();
          state.stepStates[stepIndex].result = result || null;

          // 处理步骤奖励
          var stepDef = questDef.steps[stepIndex];
          if (stepDef.rewards && stepDef.rewards.length > 0) {
            self._processRewards(stepDef.rewards);
          }

          // 检查是否还有下一步
          var nextStep = stepIndex + 1;
          if (nextStep < questDef.steps.length) {
            // 激活下一步
            state.currentStep = nextStep;
            state.stepStates[nextStep].status = STATUS.ACTIVE;
            state.stepStates[nextStep].startedAt = now();
          } else {
            // 所有步骤完成，任务进入 reward 状态
            state.status = STATUS.REWARD;
            state.completedAt = now();
          }

          return self.saveActiveQuest(questId, state);
        })
        .then(function (savedState) {
          self.emit('quest:stepCompleted', {
            questId: questId,
            stepIndex: stepIndex,
            result: result,
            state: savedState
          });

          // 如果任务进入 reward 状态，发出完成事件
          if (savedState.status === STATUS.REWARD) {
            self.emit('quest:completed', {
              questId: questId,
              state: savedState
            });
          }

          return savedState;
        });
    },

    /**
     * 领取任务奖励
     * @param {string} questId - 任务 ID
     * @returns {Promise<Object>} 更新后的任务状态
     */
    claimReward: function (questId) {
      var self = this;

      return Promise.all([
        self.getQuestDef(questId),
        self.loadActiveQuest(questId)
      ])
        .then(function (results) {
          var questDef = results[0];
          var state = results[1];

          if (!questDef) {
            return Promise.reject(new Error('[QuestEngine] 任务不存在: ' + questId));
          }

          if (!state || state.status !== STATUS.REWARD) {
            return Promise.reject(new Error('[QuestEngine] 任务不在奖励状态: ' + questId));
          }

          if (state.rewardClaimed) {
            return Promise.reject(new Error('[QuestEngine] 奖励已领取: ' + questId));
          }

          // 处理任务奖励
          if (questDef.rewards && questDef.rewards.length > 0) {
            self._processRewards(questDef.rewards);
          }

          // 更新状态
          state.status = STATUS.COMPLETED;
          state.rewardClaimed = true;

          // 保存任务结果
          var questResult = {
            questId: questId,
            status: STATUS.COMPLETED,
            completedAt: now(),
            totalSteps: questDef.steps ? questDef.steps.length : 0,
            rewards: questDef.rewards || []
          };

          return self.saveQuestResult(questId, questResult)
            .then(function () {
              return self.saveActiveQuest(questId, state);
            })
            .then(function () {
              return { state: state, questDef: questDef };
            });
        })
        .then(function (data) {
          self.emit('quest:rewardClaimed', {
            questId: questId,
            state: data.state,
            rewards: data.questDef.rewards
          });

          // 检查链式任务
          if (data.questDef.chainTo) {
            return self.checkAndTriggerChains(questId)
              .then(function () {
                return data.state;
              });
          }

          return data.state;
        });
    },

    /**
     * 放弃任务
     * 将任务标记为 failed
     * @param {string} questId - 任务 ID
     * @returns {Promise<Object>} 更新后的任务状态
     */
    abandonQuest: function (questId) {
      var self = this;

      return self.loadActiveQuest(questId)
        .then(function (state) {
          if (!state) {
            return Promise.reject(new Error('[QuestEngine] 任务状态不存在: ' + questId));
          }

          if (state.status !== STATUS.ACTIVE && state.status !== STATUS.AVAILABLE) {
            return Promise.reject(new Error('[QuestEngine] 只能放弃进行中或可接取的任务，当前状态: ' + state.status));
          }

          state.status = STATUS.FAILED;
          state.completedAt = now();

          return self.saveActiveQuest(questId, state);
        })
        .then(function (savedState) {
          // 保存失败结果
          var questResult = {
            questId: questId,
            status: STATUS.FAILED,
            completedAt: now()
          };
          return self.saveQuestResult(questId, questResult)
            .then(function () {
              return savedState;
            });
        })
        .then(function (savedState) {
          self.emit('quest:failed', { questId: questId, state: savedState });
          return savedState;
        });
    },

    // ============================================================
    //  任务结果管理
    // ============================================================

    /**
     * 保存任务结果
     * @param {string} questId - 任务 ID
     * @param {Object} result - 结果对象
     * @returns {Promise<boolean>}
     */
    saveQuestResult: function (questId, result) {
      var varPath = this.config.resultVarTemplate.replace('{questId}', questId);
      return safeWriteVar(varPath, safeStringify(result))
        .then(function () { return true; })
        .catch(function (err) {
          console.error('[QuestEngine] 保存任务结果失败 (' + questId + '):', err);
          return false;
        });
    },

    /**
     * 加载任务结果
     * @param {string} questId - 任务 ID
     * @returns {Promise<Object|null>}
     */
    loadQuestResult: function (questId) {
      var varPath = this.config.resultVarTemplate.replace('{questId}', questId);
      return safeReadVar(varPath)
        .then(function (raw) {
          return safeParse(raw, null);
        })
        .catch(function () {
          return null;
        });
    },

    // ============================================================
    //  条件判定
    // ============================================================

    /**
     * 检查任务解锁条件
     * @param {Object} conditions - 条件对象
     * @returns {boolean}
     */
    checkConditions: function (conditions) {
      if (!conditions) {
        return true;
      }

      // 检查前置任务
      if (conditions.requiredQuests && conditions.requiredQuests.length > 0) {
        for (var i = 0; i < conditions.requiredQuests.length; i++) {
          var reqQuestId = conditions.requiredQuests[i];
          var result = this._getCachedQuestResult(reqQuestId);
          if (!result || result.status !== STATUS.COMPLETED) {
            return false;
          }
        }
      }

      // 检查变量条件（同步检查缓存值）
      if (conditions.requiredVariables && conditions.requiredVariables.length > 0) {
        for (var j = 0; j < conditions.requiredVariables.length; j++) {
          var req = conditions.requiredVariables[j];
          if (!this._checkVariableCondition(req)) {
            return false;
          }
        }
      }

      // 检查阶段
      if (conditions.minPhase !== undefined && conditions.minPhase !== null) {
        var phase = this._getCachedVariable(this.config.phaseVarPath);
        if (Number(phase) < conditions.minPhase) {
          return false;
        }
      }

      if (conditions.maxPhase !== undefined && conditions.maxPhase !== null) {
        var phaseMax = this._getCachedVariable(this.config.phaseVarPath);
        if (Number(phaseMax) > conditions.maxPhase) {
          return false;
        }
      }

      // 检查时间范围
      if (conditions.timeRange) {
        var gameTime = this.getGameTime();
        if (gameTime && !this._isInTimeRange(gameTime, conditions.timeRange)) {
          return false;
        }
      }

      return true;
    },

    /**
     * 异步检查任务解锁条件（从变量实时读取）
     * @param {Object} conditions - 条件对象
     * @returns {Promise<boolean>}
     */
    checkConditionsAsync: function (conditions) {
      var self = this;

      if (!conditions) {
        return Promise.resolve(true);
      }

      var checks = [];

      // 检查前置任务
      if (conditions.requiredQuests && conditions.requiredQuests.length > 0) {
        var questChecks = conditions.requiredQuests.map(function (qid) {
          return self.loadQuestResult(qid).then(function (result) {
            return !!(result && result.status === STATUS.COMPLETED);
          });
        });
        checks = checks.concat(questChecks);
      }

      // 检查变量条件
      if (conditions.requiredVariables && conditions.requiredVariables.length > 0) {
        var varChecks = conditions.requiredVariables.map(function (req) {
          return safeReadVar(req.path).then(function (val) {
            return self._compareValues(val, req.op, req.value);
          });
        });
        checks = checks.concat(varChecks);
      }

      // 检查阶段
      if (conditions.minPhase !== undefined && conditions.minPhase !== null) {
        checks.push(
          safeReadVar(self.config.phaseVarPath).then(function (val) {
            return Number(val) >= conditions.minPhase;
          })
        );
      }

      if (conditions.maxPhase !== undefined && conditions.maxPhase !== null) {
        checks.push(
          safeReadVar(self.config.phaseVarPath).then(function (val) {
            return Number(val) <= conditions.maxPhase;
          })
        );
      }

      if (checks.length === 0) {
        return Promise.resolve(true);
      }

      return Promise.all(checks).then(function (results) {
        for (var i = 0; i < results.length; i++) {
          if (!results[i]) {
            return false;
          }
        }
        return true;
      });
    },

    /**
     * 检查步骤完成条件
     * @param {Object} step - 步骤定义
     * @param {Object} questState - 当前任务状态
     * @returns {boolean}
     */
    checkStepConditions: function (step, questState) {
      if (!step || !step.completionConditions) {
        return false;
      }

      var cc = step.completionConditions;

      switch (cc.type) {
        case COMPLETION_TYPE.AUTO:
          // 自动完成：步骤开始即视为可完成
          return true;

        case COMPLETION_TYPE.MANUAL:
          // 手动完成：由外部调用 completeStep
          return false;

        case COMPLETION_TYPE.VARIABLE:
          // 变量条件完成：检查指定变量是否满足条件
          if (!cc.variablePath || !cc.variableOp) {
            return false;
          }
          var varValue = this._getCachedVariable(cc.variablePath);
          return this._compareValues(varValue, cc.variableOp, cc.variableValue);

        default:
          return false;
      }
    },

    /**
     * 检查任务是否超时
     * @param {Object} questState - 任务状态
     * @param {Object} [questDef] - 任务定义（含 timeLimit）
     * @returns {boolean}
     */
    checkTimeout: function (questState, questDef) {
      if (!questState || !questDef || !questDef.timeLimit) {
        return false;
      }

      if (!questState.acceptedAt) {
        return false;
      }

      var elapsed = now() - questState.acceptedAt;
      var limitMs = questDef.timeLimit * 60 * 1000;

      return elapsed > limitMs;
    },

    // ============================================================
    //  任务链
    // ============================================================

    /**
     * 检查并触发后续链式任务
     * @param {string} completedQuestId - 已完成的任务 ID
     * @returns {Promise<Array<string>>} 触发的任务 ID 列表
     */
    checkAndTriggerChains: function (completedQuestId) {
      var self = this;

      return self.getQuestDef(completedQuestId)
        .then(function (questDef) {
          if (!questDef || !questDef.chainTo) {
            return [];
          }

          var chainQuestId = questDef.chainTo;
          var chainDelay = questDef.chainDelay || 0;

          if (chainDelay > 0) {
            // 延迟触发
            console.log('[QuestEngine] 链式任务将在 ' + chainDelay + ' 分钟后触发: ' + chainQuestId);
            setTimeout(function () {
              self._triggerChainQuest(chainQuestId);
            }, chainDelay * 60 * 1000);
            return [chainQuestId];
          }

          // 立即触发
          return self._triggerChainQuest(chainQuestId);
        });
    },

    /**
     * 触发链式任务（内部方法）
     * @param {string} chainQuestId - 链式任务 ID
     * @returns {Promise<Array<string>>}
     */
    _triggerChainQuest: function (chainQuestId) {
      var self = this;

      return self.getQuestDef(chainQuestId)
        .then(function (chainDef) {
          if (!chainDef) {
            console.warn('[QuestEngine] 链式任务不存在: ' + chainQuestId);
            return [];
          }

          // 创建初始状态为 available
          var newState = {
            questId: chainQuestId,
            status: STATUS.AVAILABLE,
            currentStep: -1,
            stepStates: [],
            acceptedAt: null,
            completedAt: null,
            rewardClaimed: false,
            progress: {}
          };

          return self.saveActiveQuest(chainQuestId, newState)
            .then(function () {
              self.emit('quest:chainTriggered', {
                questId: chainQuestId,
                questDef: chainDef
              });

              // 设置待处理操作，通知 UI
              return self.setPendingAction({
                type: 'quest:unlocked',
                questId: chainQuestId,
                questName: chainDef.name,
                timestamp: now()
              });
            })
            .then(function () {
              return [chainQuestId];
            });
        })
        .catch(function (err) {
          console.error('[QuestEngine] 触发链式任务失败 (' + chainQuestId + '):', err);
          return [];
        });
    },

    // ============================================================
    //  待处理操作
    // ============================================================

    /**
     * 设置待处理操作（供 UI 消费）
     * @param {Object} action - 操作对象
     * @returns {Promise<boolean>}
     */
    setPendingAction: function (action) {
      if (!action) {
        return Promise.resolve(false);
      }

      return safeWriteVar(
        this.config.pendingActionVarPath,
        safeStringify(action)
      )
        .then(function () { return true; })
        .catch(function (err) {
          console.error('[QuestEngine] 设置待处理操作失败:', err);
          return false;
        });
    },

    /**
     * 消费待处理操作（读取后清除）
     * @returns {Promise<Object|null>}
     */
    consumePendingAction: function () {
      var self = this;
      var varPath = self.config.pendingActionVarPath;

      return safeReadVar(varPath)
        .then(function (raw) {
          var action = safeParse(raw, null);
          // 清除待处理操作
          return safeWriteVar(varPath, '')
            .then(function () {
              return action;
            });
        })
        .catch(function (err) {
          console.error('[QuestEngine] 消费待处理操作失败:', err);
          return null;
        });
    },

    // ============================================================
    //  事件系统
    // ============================================================

    /**
     * 注册事件监听器
     * @param {string} event - 事件名称
     * @param {Function} handler - 处理函数
     */
    on: function (event, handler) {
      if (!event || typeof handler !== 'function') {
        return;
      }
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(handler);
    },

    /**
     * 移除事件监听器
     * @param {string} event - 事件名称
     * @param {Function} handler - 处理函数
     */
    off: function (event, handler) {
      if (!event || !this._listeners[event]) {
        return;
      }

      if (!handler) {
        // 移除该事件的所有监听器
        delete this._listeners[event];
        return;
      }

      var list = this._listeners[event];
      var newList = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] !== handler) {
          newList.push(list[i]);
        }
      }
      this._listeners[event] = newList;
    },

    /**
     * 触发事件
     * @param {string} event - 事件名称
     * @param {*} data - 事件数据
     */
    emit: function (event, data) {
      if (!event) {
        return;
      }

      // 1. 本地事件分发（原有逻辑）
      if (this._listeners[event]) {
        var list = this._listeners[event];
        for (var i = 0; i < list.length; i++) {
          try {
            list[i](data);
          } catch (e) {
            console.error('[QuestEngine] 事件处理出错 (' + event + '):', e);
          }
        }
      }

      // 2. 远程事件发布（通过 PluginBridge）
      //    将 quest:* 事件转发到 PluginBridge 服务器
      //    其他插件（如小白X）可以订阅这些事件实现实时联动
      if (window.BridgeAPI && window.BridgeAPI._bridgeEnabled && event.indexOf('quest:') === 0) {
        try {
          window.BridgeAPI._publishEvent(event, data);
        } catch (e) {
          // 远程发布失败不影响本地事件处理
          console.warn('[QuestEngine] 远程事件发布失败 (' + event + '):', e && e.message);
        }
      }
    },

    // ============================================================
    //  奖励处理
    // ============================================================

    /**
     * 处理奖励列表（内部方法）
     * @param {Array<Object>} rewards - 奖励数组
     */
    _processRewards: function (rewards) {
      if (!rewards || rewards.length === 0) {
        return;
      }

      var self = this;

      for (var i = 0; i < rewards.length; i++) {
        var reward = rewards[i];

        switch (reward.type) {
          case REWARD_TYPE.VARIABLE:
            // 变量奖励：修改变量值
            self._applyVariableReward(reward);
            break;

          case REWARD_TYPE.ITEM:
            // 物品奖励：记录到变量
            self._applyItemReward(reward);
            break;

          case REWARD_TYPE.RELATIONSHIP:
            // 关系奖励：修改好感度
            self._applyRelationshipReward(reward);
            break;

          case REWARD_TYPE.QUEST:
            // 任务奖励：解锁后续任务（由 claimReward 中的链式任务处理）
            console.log('[QuestEngine] 任务奖励将在链式任务处理中触发: ' + reward.questId);
            break;

          case REWARD_TYPE.FRIEND:
            // [修复v3] 好友奖励：自动添加好友到小手机
            self._applyFriendReward(reward);
            break;

          default:
            console.warn('[QuestEngine] 未知奖励类型: ' + reward.type);
        }
      }
    },

    /**
     * 应用变量奖励
     * @param {Object} reward - 奖励对象 { path, op, value }
     */
    _applyVariableReward: function (reward) {
      if (!reward.path) {
        return;
      }

      var self = this;
      safeReadVar(reward.path)
        .then(function (currentVal) {
          var current = Number(currentVal) || 0;
          var opFunc = OP_MAP[reward.op];
          if (opFunc) {
            var newVal = opFunc(current, reward.value);
            return safeWriteVar(reward.path, String(newVal));
          }
        })
        .then(function () {
          console.log('[QuestEngine] 变量奖励已应用: ' + reward.path + ' ' + (reward.op || '+') + ' ' + reward.value);
        })
        .catch(function (err) {
          console.error('[QuestEngine] 应用变量奖励失败:', err);
        });
    },

    /**
     * 应用物品奖励
     * @param {Object} reward - 奖励对象 { name, description }
     */
    _applyItemReward: function (reward) {
      if (!reward.name) {
        return;
      }

      // 将物品信息追加到 xb.game.items 变量
      var self = this;
      var itemsPath = 'xb.game.items';

      safeReadVar(itemsPath)
        .then(function (raw) {
          var items = safeParse(raw, []);
          if (!Array.isArray(items)) {
            items = [];
          }
          items.push({
            name: reward.name,
            description: reward.description || '',
            obtainedAt: now()
          });
          return safeWriteVar(itemsPath, safeStringify(items));
        })
        .then(function () {
          console.log('[QuestEngine] 物品奖励已应用: ' + reward.name);
        })
        .catch(function (err) {
          console.error('[QuestEngine] 应用物品奖励失败:', err);
        });
    },

    /**
     * 应用关系奖励
     * @param {Object} reward - 奖励对象 { target, op, value }
     */
    _applyRelationshipReward: function (reward) {
      if (!reward.target) {
        return;
      }

      var self = this;
      var relPath = 'xb.game.relationship.' + reward.target;

      safeReadVar(relPath)
        .then(function (currentVal) {
          var current = Number(currentVal) || 0;
          var opFunc = OP_MAP[reward.op] || OP_MAP['+'];
          var newVal = opFunc(current, reward.value);
          return safeWriteVar(relPath, String(newVal));
        })
        .then(function () {
          console.log('[QuestEngine] 关系奖励已应用: ' + reward.target + ' ' + (reward.op || '+') + ' ' + reward.value);
        })
        .catch(function (err) {
          console.error('[QuestEngine] 应用关系奖励失败:', err);
        });
    },

    /**
     * [修复v3] 应用好友奖励：任务步骤完成后自动添加好友到小手机
     * @param {Object} reward - 奖励对象 { type: 'friend', name: '角色名', number: '角色ID' }
     * 
     * 使用示例（在任务定义的 steps[].rewards 中）：
     * {
     *   "type": "friend",
     *   "name": "苏晚晴",
     *   "number": "554321"
     * }
     */
    _applyFriendReward: function (reward) {
      if (!reward.name) {
        console.warn('[QuestEngine] 好友奖励缺少 name 字段，跳过');
        return;
      }

      var friendName = reward.name;
      var friendNumber = String(reward.number || (1000 + Math.floor(Math.random() * 9000)));

      console.log('[QuestEngine] 执行好友奖励: 添加 ' + friendName + ' (' + friendNumber + ')');

      // 方式1：通过 friendRenderer.addFriend 添加到内存
      if (window.friendRenderer && typeof window.friendRenderer.addFriend === 'function') {
        window.friendRenderer.addFriend(friendName, friendNumber);
      }

      // 方式2：同步写入 xb.phone.friends.list 变量（确保持久化）
      try {
        if (window.BridgeAPI && window.BridgeAPI.ConfigManager) {
          // 异步写入变量
          window.BridgeAPI.ConfigManager.get('xb.phone.friends.list').then(function(existingList) {
            var friends = [];
            if (existingList) {
              try { friends = JSON.parse(existingList); } catch(e) { friends = []; }
            }
            if (!Array.isArray(friends)) friends = [];
            var dup = friends.some(function(f) {
              return String(f.number) === String(friendNumber) || f.name === friendName;
            });
            if (!dup) {
              friends.push({ name: friendName, number: friendNumber, addTime: Date.now() });
              window.BridgeAPI.ConfigManager.set('xb.phone.friends.list', JSON.stringify(friends));
              console.log('[QuestEngine] 好友已写入 xb.phone.friends.list: ' + friendName);
            }
          }).catch(function(e) {
            console.warn('[QuestEngine] 写入好友变量失败:', e);
          });
        }
      } catch (e) {
        console.warn('[QuestEngine] 好友奖励异常:', e);
      }

      // 方式3：通过 BridgeAPI 的 pendingFriend 触发完整的好友添加流程
      try {
        if (window.BridgeAPI && window.BridgeAPI.processPendingFriend) {
          var pendingData = JSON.stringify({ name: friendName, friendId: friendNumber, source: 'quest_reward' });
          window.BridgeAPI.ConfigManager.set('xb.phone.pendingFriend', pendingData).then(function() {
            // 触发变量变更事件，让 WorkflowEngine 处理
            if (window.BridgeAPI.EventBus) {
              window.BridgeAPI.EventBus.emit('variable:changed', {
                key: 'xb.phone.pendingFriend',
                value: pendingData,
                source: 'quest_reward'
              });
            }
          });
        }
      } catch (e) {
        // 静默失败，方式1和方式2已足够
      }

      // 触发消息列表 UI 刷新
      setTimeout(function() {
        if (window.messageApp && window.messageApp.updateAppContent) {
          try { window.messageApp.updateAppContent(); } catch(e) {}
        }
      }, 500);
    },

    // ============================================================
    //  超时检查
    // ============================================================

    /**
     * 启动超时检查定时器
     * 每 30 秒检查一次所有活跃任务是否超时
     */
    _startTimeoutCheck: function () {
      var self = this;

      if (self._timeoutTimerId) {
        clearInterval(self._timeoutTimerId);
      }

      self._timeoutTimerId = setInterval(function () {
        self._checkAllTimeouts();
      }, self.config.timeoutCheckInterval);

      console.log('[QuestEngine] 超时检查已启动，间隔: ' + self.config.timeoutCheckInterval + 'ms');
    },

    /**
     * 检查所有活跃任务是否超时
     * @returns {Promise<void>}
     */
    _checkAllTimeouts: function () {
      var self = this;

      self.getActiveQuests()
        .then(function (activeQuests) {
          if (activeQuests.length === 0) {
            return;
          }

          var timeoutPromises = [];

          for (var i = 0; i < activeQuests.length; i++) {
            (function (state) {
              timeoutPromises.push(
                self.getQuestDef(state.questId)
                  .then(function (questDef) {
                    if (self.checkTimeout(state, questDef)) {
                      console.log('[QuestEngine] 任务超时: ' + state.questId);

                      // 标记为失败
                      state.status = STATUS.FAILED;
                      state.completedAt = now();

                      return self.saveActiveQuest(state.questId, state)
                        .then(function () {
                          var questResult = {
                            questId: state.questId,
                            status: STATUS.FAILED,
                            completedAt: now(),
                            reason: 'timeout'
                          };
                          return self.saveQuestResult(state.questId, questResult);
                        })
                        .then(function () {
                          self.emit('quest:timeout', {
                            questId: state.questId,
                            state: state
                          });
                        });
                    }
                  })
              );
            })(activeQuests[i]);
          }

          return Promise.all(timeoutPromises);
        })
        .catch(function (err) {
          console.error('[QuestEngine] 超时检查出错:', err);
        });
    },

    // ============================================================
    //  工具方法
    // ============================================================

    /**
     * 生成任务 ID
     * 格式：q_{type}_{序号} 或自定义前缀
     * @param {string} [type] - 任务类型（main/side/daily/event）
     * @returns {string}
     */
    generateQuestId: function (type) {
      var prefix = 'q';
      if (type && QUEST_TYPE[type.toUpperCase()]) {
        prefix = 'q_' + type.toLowerCase();
      }
      return generateId(prefix);
    },

    /**
     * 获取当前游戏时间
     * @returns {string|null} 游戏时间字符串（如 "14:30"）
     */
    getGameTime: function () {
      var timeStr = this._getCachedVariable(this.config.gameTimeVarPath);
      return timeStr || null;
    },

    /**
     * 获取当前游戏阶段
     * @returns {number|null}
     */
    getGamePhase: function () {
      var phase = this._getCachedVariable(this.config.phaseVarPath);
      return phase !== null ? Number(phase) : null;
    },

    /**
     * 防抖函数
     * @param {Function} func - 要防抖的函数
     * @param {number} wait - 等待时间（毫秒）
     * @returns {Function}
     */
    debounce: function (func, wait) {
      var timeoutId = null;
      var context = null;
      var args = null;

      return function () {
        context = this;
        args = arguments;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(function () {
          timeoutId = null;
          func.apply(context, args);
        }, wait);
      };
    },

    /**
     * 节流函数
     * @param {Function} func - 要节流的函数
     * @param {number} limit - 间隔时间（毫秒）
     * @returns {Function}
     */
    throttle: function (func, limit) {
      var lastCall = 0;
      var timeoutId = null;

      return function () {
        var context = this;
        var args = arguments;
        var nowTime = now();

        var remaining = limit - (nowTime - lastCall);

        if (remaining <= 0) {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          lastCall = nowTime;
          func.apply(context, args);
        } else if (!timeoutId) {
          timeoutId = setTimeout(function () {
            lastCall = now();
            timeoutId = null;
            func.apply(context, args);
          }, remaining);
        }
      };
    },

    // ============================================================
    //  内部辅助方法
    // ============================================================

    /**
     * 从缓存获取变量值（同步）
     * @param {string} path - 变量路径
     * @returns {string|null}
     */
    _getCachedVariable: function (path) {
      var self = this;
      var cached = self._cache.varCache[path];
      if (cached && (now() - cached.cachedAt) < self._cache.VAR_CACHE_TTL) {
        return cached.value;
      }
      return null;
    },

    /**
     * 从缓存获取任务结果（同步）
     * @param {string} questId - 任务 ID
     * @returns {Object|null}
     */
    _getCachedQuestResult: function (questId) {
      var self = this;
      var varPath = this.config.resultVarTemplate.replace('{questId}', questId);
      var cached = self._cache.varCache[varPath];
      if (cached && (now() - cached.cachedAt) < self._cache.VAR_CACHE_TTL) {
        return safeParse(cached.value, null);
      }
      return null;
    },

    /**
     * 异步刷新变量缓存
     * @param {Array<string>} paths - 变量路径数组
     * @returns {Promise<void>}
     */
    refreshVarCache: function (paths) {
      var self = this;
      if (!Array.isArray(paths) || paths.length === 0) return Promise.resolve();

      var chain = Promise.resolve();
      for (var i = 0; i < paths.length; i++) {
        (function (p) {
          chain = chain.then(function () {
            return safeReadVar(p).then(function (val) {
              self._cache.varCache[p] = { value: val, cachedAt: now() };
            }).catch(function () {});
          });
        })(paths[i]);
      }
      return chain;
    },

    /**
     * 预加载常用游戏变量到缓存
     * @returns {Promise<void>}
     */
    preloadGameVariables: function () {
      var paths = [
        'xb.game.phase',
        'xb.game.money',
        'xb.game.rose',
        'xb.game.activeChar',
        'xb.game.scene',
        '游戏数据.系统.当前角色',
        '游戏数据.系统.当前场景'
      ];
      return this.refreshVarCache(paths);
    },

    /**
     * 比较两个值
     * @param {*} actual - 实际值
     * @param {string} op - 操作符
     * @param {*} expected - 期望值
     * @returns {boolean}
     */
    _compareValues: function (actual, op, expected) {
      var opFunc = OP_MAP[op];
      if (!opFunc) {
        console.warn('[QuestEngine] 未知操作符: ' + op);
        return false;
      }

      // 数值比较
      if (op === '>' || op === '>=' || op === '<' || op === '<=') {
        return opFunc(Number(actual), Number(expected));
      }

      // 等值比较
      return opFunc(actual, expected);
    },

    /**
     * 检查变量条件（同步，使用缓存）
     * @param {Object} req - 条件对象 { path, op, value }
     * @returns {boolean}
     */
    _checkVariableCondition: function (req) {
      if (!req || !req.path) {
        return true;
      }

      var varValue = this._getCachedVariable(req.path);
      return this._compareValues(varValue, req.op, req.value);
    },

    /**
     * 检查时间是否在指定范围内
     * @param {string} gameTime - 游戏时间（如 "14:30"）
     * @param {Object} range - 时间范围 { start: "08:00", end: "20:00" }
     * @returns {boolean}
     */
    _isInTimeRange: function (gameTime, range) {
      if (!gameTime || !range || !range.start || !range.end) {
        return true;
      }

      var time = gameTime.replace(':', '');
      var start = range.start.replace(':', '');
      var end = range.end.replace(':', '');

      return time >= start && time <= end;
    },

    // ============================================================
    //  便捷方法（供外部快速调用）
    // ============================================================

    /**
     * 获取当前可接取的任务列表
     * @returns {Promise<Array<Object>>}
     */
    getAvailableQuests: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return [];
          }

          var promises = [];
          for (var i = 0; i < registry.quests.length; i++) {
            (function (questDef) {
              promises.push(
                self.loadActiveQuest(questDef.id)
                  .then(function (state) {
                    if (state && state.status === STATUS.AVAILABLE) {
                      return questDef;
                    }
                    return null;
                  })
              );
            })(registry.quests[i]);
          }

          return Promise.all(promises);
        })
        .then(function (results) {
          var available = [];
          for (var i = 0; i < results.length; i++) {
            if (results[i]) {
              available.push(results[i]);
            }
          }
          // 按优先级排序（数字越大优先级越高）
          available.sort(function (a, b) {
            return (b.priority || 0) - (a.priority || 0);
          });
          return available;
        });
    },

    /**
     * 获取已完成的任务列表
     * @returns {Promise<Array<Object>>}
     */
    getCompletedQuests: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return [];
          }

          var promises = [];
          for (var i = 0; i < registry.quests.length; i++) {
            (function (questDef) {
              promises.push(
                self.loadActiveQuest(questDef.id)
                  .then(function (state) {
                    if (state && state.status === STATUS.COMPLETED) {
                      return { questDef: questDef, state: state };
                    }
                    return null;
                  })
              );
            })(registry.quests[i]);
          }

          return Promise.all(promises);
        })
        .then(function (results) {
          var completed = [];
          for (var i = 0; i < results.length; i++) {
            if (results[i]) {
              completed.push(results[i]);
            }
          }
          return completed;
        });
    },

    /**
     * 获取任务进度摘要（供 UI 显示）
     * @returns {Promise<Object>} { total, locked, available, active, reward, completed, failed }
     */
    getProgressSummary: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return { total: 0, locked: 0, available: 0, active: 0, reward: 0, completed: 0, failed: 0 };
          }

          var summary = {
            total: registry.quests.length,
            locked: 0,
            available: 0,
            active: 0,
            reward: 0,
            completed: 0,
            failed: 0
          };

          var promises = [];
          for (var i = 0; i < registry.quests.length; i++) {
            (function (questId) {
              promises.push(
                self.loadActiveQuest(questId)
                  .then(function (state) {
                    var status = state ? state.status : STATUS.LOCKED;
                    if (summary.hasOwnProperty(status)) {
                      summary[status]++;
                    }
                  })
              );
            })(registry.quests[i].id);
          }

          return Promise.all(promises).then(function () {
            return summary;
          });
        });
    },

    /**
     * 重置所有任务数据（危险操作，仅用于调试）
     * @returns {Promise<boolean>}
     */
    resetAll: function () {
      var self = this;

      console.warn('[QuestEngine] 正在重置所有任务数据...');

      // 清空注册表
      return self.saveRegistry({ quests: [], version: 1 })
        .then(function () {
          // 清空缓存
          self._cache.activeQuests = {};
          self._cache.lastSync = 0;
          return true;
        })
        .catch(function (err) {
          console.error('[QuestEngine] 重置失败:', err);
          return false;
        });
    },

    /**
     * 归档已完成的任务
     * 将 completed 状态的任务标记为 archived
     * @returns {Promise<number>} 归档的任务数量
     */
    archiveCompleted: function () {
      var self = this;

      return self.loadRegistry()
        .then(function (registry) {
          if (!registry || !registry.quests) {
            return 0;
          }

          var archivePromises = [];
          for (var i = 0; i < registry.quests.length; i++) {
            (function (questId) {
              archivePromises.push(
                self.loadActiveQuest(questId)
                  .then(function (state) {
                    if (state && state.status === STATUS.COMPLETED) {
                      state.status = STATUS.ARCHIVED;
                      return self.saveActiveQuest(questId, state)
                        .then(function () { return 1; });
                    }
                    return 0;
                  })
              );
            })(registry.quests[i].id);
          }

          return Promise.all(archivePromises);
        })
        .then(function (results) {
          var count = 0;
          for (var i = 0; i < results.length; i++) {
            count += results[i];
          }
          console.log('[QuestEngine] 已归档 ' + count + ' 个任务');
          return count;
        });
    }
  };

  // ============================================================
  //  挂载到全局（单例保护）
  // ============================================================

  if (!window.QuestEngine) {
    window.QuestEngine = QuestEngine;
    console.log('[QuestEngine] 模块已加载');
  } else {
    console.log('[QuestEngine] 已存在，跳过重复加载');
  }

})();
