// ============================================================
// memory-bridge.js -- 向量记忆桥接模块
// 职责：手机对话原子事实提取、L3 Fact写入、记忆增强Prompt构建
// 运行环境：Android WebView + Node.js（不使用 ES Module、顶层 await、optional chaining 等）
// 依赖：window.XBBridge（xiaobaix-bridge.js）、window.BridgeAPI（bridge-api.js）、window.RoleAPI（role-api.js）
// ============================================================

(function () {
  'use strict';

  // ===== 常量 =====
  var LOG_PREFIX = '[MemoryBridge]';
  var VAR_PREFIX = 'phone_fact';       // L3 Fact 变量前缀
  var SYNC_DEBOUNCE_MS = 30000;        // 同步防抖：同一好友30秒
  var AUTO_SYNC_DELAY_AI = 10000;      // AI回复后延迟10秒同步
  var AUTO_SYNC_DELAY_USER = 5000;     // 用户发消息后延迟5秒同步
  var MAX_ENHANCE_LENGTH = 500;        // 增强Prompt最大500字
  var MAX_RECENT_MESSAGES = 10;        // 批量同步最近10条聊天
  var MAX_FACTS_PER_SYNC = 5;          // 每次同步最多提取5条事实
  var FACT_TTL_MS = 86400000 * 7;      // Fact有效期7天

  // ===== 内部状态 =====
  var _syncTimers = {};                // 防抖计时器 { friendName: timestamp }
  var _autoSyncRunning = false;
  var _autoSyncHandler = null;         // 自动同步事件处理器引用
  var _pollingTimerId = null;          // 轮询定时器ID
  // [MC-Fix-7] 保存事件监听器引用，以便 stopAutoSync 正确移除
  var _xbbEventHandlers = {};          // XBBridge 事件处理器 { eventName: handlerFn }
  var _customEventHandlers = {};       // 自定义 DOM 事件处理器 { eventName: handlerFn }
  var _factCache = null;               // Fact缓存
  var _factCacheTime = 0;
  var _factCacheTTL = 15000;           // Fact缓存15秒

  // ===== 工具函数 =====

  function log() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.log.apply(console, args);
  }

  function warn() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.warn.apply(console, args);
  }

  function logError() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.error.apply(console, args);
  }

  /**
   * 格式化时间差为可读文本
   * @param {number} timestamp - 毫秒时间戳
   * @returns {string} 如 "2小时前"、"30分钟前"
   */
  function formatTimeAgo(timestamp) {
    var now = Date.now();
    var diff = now - timestamp;
    var minutes = Math.floor(diff / 60000);
    var hours = Math.floor(diff / 3600000);
    var days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + '分钟前';
    if (hours < 24) return hours + '小时前';
    return days + '天前';
  }

  /**
   * 生成Fact变量key
   * @param {string} friendName - 角色名
   * @param {number} timestamp - 时间戳
   * @returns {string} 如 "phone_fact.苏晚晴.1713897600000"
   */
  function makeFactKey(friendName, timestamp) {
    return VAR_PREFIX + '.' + friendName + '.' + String(timestamp);
  }

  /**
   * 检查小白X是否可用
   * @returns {boolean}
   */
  function isXBAvailable() {
    return !!(window.XBBridge && window.XBBridge.isAvailable && window.XBBridge.isAvailable());
  }

  /**
   * 检查BridgeAPI是否可用
   * @returns {boolean}
   */
  function isBridgeAvailable() {
    return !!(window.BridgeAPI && window.BridgeAPI.setVar && window.BridgeAPI.getVar);
  }

  /**
   * 检查RoleAPI是否可用
   * @returns {boolean}
   */
  function isRoleAvailable() {
    return !!(window.RoleAPI && window.RoleAPI.getChatHistory);
  }

  // ===== 简单规则提取（小白X不可用时的降级方案） =====

  /**
   * 关键词-动作映射表
   * 用于从聊天文本中提取结构化原子事实
   */
  var ACTION_PATTERNS = [
    { keywords: ['喜欢', '爱', '表白', '告白', '心动', '暗恋'], predicate: '向吴宇伦表白', object: '表达了好感' },
    { keywords: ['分手', '分手吧', '再见', '别联系'], predicate: '与吴宇伦分手', object: '结束了关系' },
    { keywords: ['送', '礼物', '花', '玫瑰', '巧克力'], predicate: '送给吴宇伦礼物', object: '表达了心意' },
    { keywords: ['约', '见面', '出来', '一起', '约会', '吃饭', '看电影'], predicate: '约吴宇伦见面', object: '发起了约会' },
    { keywords: ['生气', '讨厌', '烦', '不理', '滚'], predicate: '对吴宇伦生气', object: '表达了不满' },
    { keywords: ['对不起', '抱歉', '原谅', '错了'], predicate: '向吴宇伦道歉', object: '承认了错误' },
    { keywords: ['谢谢', '感谢', '真好', '太好了'], predicate: '感谢吴宇伦', object: '表达了谢意' },
    { keywords: ['担心', '小心', '注意', '照顾好'], predicate: '关心吴宇伦', object: '表达了关心' },
    { keywords: ['偷', '盗', '丢', '警察', '报警'], predicate: '提到安全事件', object: '涉及治安问题' },
    { keywords: ['搬家', '新房', '装修', '入住'], predicate: '提到居住变化', object: '涉及住所变动' },
    { keywords: ['工作', '上班', '加班', '辞职', '升职'], predicate: '提到工作情况', object: '涉及职业变动' },
    { keywords: ['生病', '不舒服', '医院', '感冒', '发烧'], predicate: '提到身体不适', object: '涉及健康问题' },
    { keywords: ['生日', '节日', '纪念', '庆祝'], predicate: '提到重要日子', object: '涉及时间节点' },
    { keywords: ['哭', '难过', '伤心', '不开心', '郁闷'], predicate: '表达了负面情绪', object: '情绪低落' },
    { keywords: ['开心', '高兴', '快乐', '幸福', '哈哈'], predicate: '表达了正面情绪', object: '心情愉快' }
  ];

  /**
   * 从单条消息中用规则提取原子事实
   * @param {string} text - 消息文本
   * @param {string} friendName - 角色名
   * @param {string} role - 'user' 或 'assistant'
   * @param {number} timestamp - 消息时间戳
   * @returns {object|null} 原子事实对象，无匹配时返回null
   */
  function extractFactByRules(text, friendName, role, timestamp) {
    if (!text || text.length < 2) return null;

    var subject = role === 'user' ? '吴宇伦' : friendName;
    var normalizedText = text.replace(/[，。！？、；：""''（）\[\]{}]/g, ' ');

    for (var i = 0; i < ACTION_PATTERNS.length; i++) {
      var pattern = ACTION_PATTERNS[i];
      for (var j = 0; j < pattern.keywords.length; j++) {
        if (normalizedText.indexOf(pattern.keywords[j]) !== -1) {
          // 提取上下文片段作为object
          var idx = normalizedText.indexOf(pattern.keywords[j]);
          var start = Math.max(0, idx - 15);
          var end = Math.min(normalizedText.length, idx + pattern.keywords[j].length + 15);
          var contextSnippet = normalizedText.substring(start, end).replace(/\s+/g, '').substring(0, 30);

          return {
            subject: subject,
            predicate: pattern.predicate,
            object: contextSnippet || pattern.object,
            timestamp: timestamp,
            source: 'phone_chat',
            confidence: 0.5
          };
        }
      }
    }

    return null;
  }

  /**
   * 从多条聊天记录中批量提取原子事实（规则方式）
   * @param {Array} messages - 聊天记录数组 [{role, content, time}]
   * @param {string} friendName - 角色名
   * @returns {Array} 原子事实数组
   */
  function batchExtractByRules(messages, friendName) {
    var facts = [];
    var seen = {};  // 去重：同一predicate在短时间内只保留一条

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var text = msg.msgContent || msg.content || '';
      var role = msg.role || 'user';
      var time = msg.time || Date.now();

      var fact = extractFactByRules(text, friendName, role, time);
      if (fact) {
        var dedupeKey = fact.subject + '|' + fact.predicate;
        if (!seen[dedupeKey]) {
          seen[dedupeKey] = true;
          facts.push(fact);
        }
      }

      if (facts.length >= MAX_FACTS_PER_SYNC) break;
    }

    return facts;
  }

  // ===== LLM提取（小白X可用时） =====

  /**
   * 通过小白X LLM提取原子事实
   * @param {Array} messages - 聊天记录数组
   * @param {string} friendName - 角色名
   * @returns {Promise<Array>} 原子事实数组
   */
  function extractByLLM(messages, friendName) {
    if (!isXBAvailable()) {
      warn('extractByLLM: 小白X不可用，回退到规则提取');
      return Promise.resolve(batchExtractByRules(messages, friendName));
    }

    // 构建对话文本
    var chatText = '';
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var role = msg.role === 'user' ? '吴宇伦' : friendName;
      var text = (msg.msgContent || msg.content || '').substring(0, 100);
      chatText += role + ': ' + text + '\n';
    }

    var prompt = '分析以下微信聊天记录，提取关键原子事实。\n\n' +
      '聊天记录:\n' + chatText + '\n' +
      '要求:\n' +
      '1. 提取最多' + MAX_FACTS_PER_SYNC + '条重要事实\n' +
      '2. 每条事实包含: subject(主语), predicate(动作/关系), object(宾语/细节)\n' +
      '3. subject只能是"吴宇伦"或"' + friendName + '"\n' +
      '4. 只输出JSON数组，不要其他内容\n' +
      '5. 格式: [{"subject":"苏晚晴","predicate":"向吴宇伦表白","object":"在咖啡厅"}]\n' +
      '6. 如果没有重要事实，输出空数组 []';

    var llmMessages = [
      { role: 'system', content: '你是一个事实提取助手，只输出JSON格式结果。' },
      { role: 'user', content: prompt }
    ];

    return window.XBBridge.generate.generate({
      provider: 'inherit',
      messages: llmMessages,
      max_tokens: 500,
      temperature: 0.3
    }).then(function (result) {
      var text = '';
      if (typeof result === 'string') {
        text = result;
      } else if (result && result.choices && result.choices[0]) {
        text = result.choices[0].message && result.choices[0].message.content
          ? result.choices[0].message.content
          : result.choices[0].text || '';
      } else if (result && typeof result === 'object') {
        text = String(result);
      }

      log('extractByLLM: LLM返回', text.substring(0, 200));

      // 解析JSON
      try {
        // 尝试从返回文本中提取JSON数组
        var jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          var parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            // 标准化并补充字段
            var facts = [];
            for (var i = 0; i < parsed.length; i++) {
              var item = parsed[i];
              if (item && item.subject && item.predicate) {
                facts.push({
                  subject: String(item.subject),
                  predicate: String(item.predicate),
                  object: String(item.object || ''),
                  timestamp: Date.now(),
                  source: 'phone_chat',
                  confidence: 0.8
                });
              }
            }
            log('extractByLLM: 成功提取', facts.length, '条事实');
            return facts;
          }
        }
      } catch (e) {
        warn('extractByLLM: JSON解析失败，回退到规则提取', e);
      }

      // LLM提取失败，回退到规则提取
      return batchExtractByRules(messages, friendName);
    }).catch(function (err) {
      warn('extractByLLM: LLM调用失败，回退到规则提取', err);
      return batchExtractByRules(messages, friendName);
    });
  }

  // ===== 主模块 =====

  var MemoryBridge = {

    // ========== 1. 手机对话原子事实提取 ==========

    /**
     * 从手机聊天记录中提取结构化原子事实
     * @param {string} friendName - 好友角色名
     * @param {string} friendId - 好友ID
     * @returns {Promise<Array>} 原子事实数组
     */
    extractPhoneAtoms: function (friendName, friendId) {
      log('extractPhoneAtoms: 开始提取', friendName, friendId);

      if (!isRoleAvailable()) {
        warn('extractPhoneAtoms: RoleAPI不可用');
        return Promise.resolve([]);
      }

      // 获取聊天历史
      var history = window.RoleAPI.getChatHistory(friendId);
      if (!history || history.length === 0) {
        log('extractPhoneAtoms: 无聊天记录', friendName);
        return Promise.resolve([]);
      }

      // 取最近N条
      var recent = history.slice(-MAX_RECENT_MESSAGES);
      log('extractPhoneAtoms: 获取到', recent.length, '条记录');

      // 根据小白X可用性选择提取方式
      if (isXBAvailable()) {
        return extractByLLM(recent, friendName);
      } else {
        log('extractPhoneAtoms: 小白X不可用，使用规则提取');
        return Promise.resolve(batchExtractByRules(recent, friendName));
      }
    },

    // ========== 2. 写入L3 Fact约束 ==========

    /**
     * 将手机对话事实写入小白X变量系统（L3 Fact）
     * @param {string} friendName - 好友角色名
     * @param {object} fact - 原子事实对象
     * @returns {Promise<boolean>} 是否写入成功
     */
    writePhoneFact: function (friendName, fact) {
      if (!fact) {
        warn('writePhoneFact: fact为空');
        return Promise.resolve(false);
      }

      if (!isBridgeAvailable()) {
        warn('writePhoneFact: BridgeAPI不可用');
        return Promise.resolve(false);
      }

      var key = makeFactKey(friendName, fact.timestamp || Date.now());
      var value = JSON.stringify({
        subject: fact.subject || '',
        predicate: fact.predicate || '',
        object: fact.object || '',
        timestamp: fact.timestamp || Date.now(),
        source: fact.source || 'phone_chat',
        confidence: fact.confidence || 0.5
      });

      log('writePhoneFact: 写入Fact', key, value.substring(0, 80));

      return window.BridgeAPI.setVar(key, value).then(function (result) {
        if (result) {
          // 清除缓存
          _factCache = null;
          _factCacheTime = 0;
          log('writePhoneFact: 写入成功', key);
        } else {
          warn('writePhoneFact: 写入失败', key);
        }
        return !!result;
      }).catch(function (err) {
        logError('writePhoneFact: 写入异常', key, err);
        return false;
      });
    },

    // ========== 3. 批量同步手机记忆 ==========

    /**
     * 批量同步手机记忆：提取事实 + 写入L3
     * @param {string} friendName - 好友角色名
     * @param {string} friendId - 好友ID
     * @returns {Promise<number>} 成功写入的Fact数量
     */
    syncPhoneMemory: function (friendName, friendId) {
      var self = this;
      var now = Date.now();

      // 防抖检查
      if (_syncTimers[friendName] && (now - _syncTimers[friendName]) < SYNC_DEBOUNCE_MS) {
        log('syncPhoneMemory: 防抖跳过', friendName, '距上次同步', (now - _syncTimers[friendName]) / 1000, '秒');
        return Promise.resolve(0);
      }
      _syncTimers[friendName] = now;

      log('syncPhoneMemory: 开始同步', friendName, friendId);

      return self.extractPhoneAtoms(friendName, friendId).then(function (facts) {
        if (!facts || facts.length === 0) {
          log('syncPhoneMemory: 无事实可写入', friendName);
          return 0;
        }

        log('syncPhoneMemory: 提取到', facts.length, '条事实，开始写入');

        // 逐条写入Fact
        var chain = Promise.resolve(0);
        for (var i = 0; i < facts.length; i++) {
          (function (fact) {
            chain = chain.then(function (count) {
              return self.writePhoneFact(friendName, fact).then(function (success) {
                return success ? count + 1 : count;
              });
            });
          })(facts[i]);
        }

        return chain.then(function (writeCount) {
          log('syncPhoneMemory: 同步完成', friendName, '成功写入', writeCount, '/', facts.length, '条');
          return writeCount;
        });
      }).catch(function (err) {
        logError('syncPhoneMemory: 同步失败', friendName, err);
        return 0;
      });
    },

    // ========== 4. 记忆增强Prompt构建 ==========

    /**
     * 读取该角色的所有手机相关Fact
     * @param {string} friendName - 好友角色名
     * @returns {Promise<Array>} Fact数组（按时间倒序）
     */
    getPhoneFacts: function (friendName) {
      if (!isBridgeAvailable()) {
        warn('getPhoneFacts: BridgeAPI不可用');
        return Promise.resolve([]);
      }

      // 使用缓存
      var now = Date.now();
      if (_factCache && _factCacheTime && (now - _factCacheTime) < _factCacheTTL) {
        if (_factCache[friendName]) {
          return Promise.resolve(_factCache[friendName]);
        }
      }

      // 通过BridgeAPI.ConfigManager读取所有phone_fact变量
      // 由于小白X变量系统不支持通配符查询，我们使用STscript批量读取
      var facts = [];

      return Promise.resolve().then(function () {
        // 尝试通过 ConfigManager.listVar 读取变量列表
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
        if (ConfigManager && ConfigManager.listVar) {
          return ConfigManager.listVar('phone_fact.' + friendName).then(function (result) {
            var keys = Array.isArray(result) ? result : [];
            var chain = Promise.resolve();
              for (var i = 0; i < keys.length; i++) {
                (function (key) {
                  key = key.trim();
                  if (!key) return;
                  chain = chain.then(function () {
                    return window.BridgeAPI.getVar(key);
                  }).then(function (val) {
                    if (val) {
                      try {
                        var fact = JSON.parse(val);
                        // 过滤过期Fact
                        if (fact.timestamp && (now - fact.timestamp) < FACT_TTL_MS) {
                          facts.push(fact);
                        }
                      } catch (e) {
                        // 忽略解析失败的值
                      }
                    }
                  });
                })(keys[i]);
              }
              return chain;
          }).catch(function () {
            // listvar不可用，回退到直接读取已知时间范围的变量
          });
        }
      }).then(function () {
        // 如果listvar方式没有获取到数据，尝试通过localStorage缓存补充
        if (facts.length === 0) {
          try {
            var cacheKey = 'memory_bridge_facts_' + friendName;
            var cached = localStorage.getItem(cacheKey);
            if (cached) {
              var parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) {
                for (var i = 0; i < parsed.length; i++) {
                  if (parsed[i].timestamp && (now - parsed[i].timestamp) < FACT_TTL_MS) {
                    facts.push(parsed[i]);
                  }
                }
              }
            }
          } catch (e) {
            // 忽略
          }
        }

        // 按时间倒序排列
        facts.sort(function (a, b) {
          return (b.timestamp || 0) - (a.timestamp || 0);
        });

        // 更新缓存
        if (!_factCache) _factCache = {};
        _factCache[friendName] = facts;
        _factCacheTime = now;

        // 同时写入localStorage作为备份
        try {
          var cacheKey = 'memory_bridge_facts_' + friendName;
          localStorage.setItem(cacheKey, JSON.stringify(facts));
        } catch (e) {
          // 忽略
        }

        log('getPhoneFacts:', friendName, '获取到', facts.length, '条Fact');
        return facts;
      });
    },

    /**
     * 获取最近的全局手机Fact（不限角色）
     * @param {number} count - 返回数量
     * @returns {Promise<Array>} Fact数组
     */
    getRecentFacts: function (count) {
      if (!isBridgeAvailable()) {
        warn('getRecentFacts: BridgeAPI不可用');
        return Promise.resolve([]);
      }

      // 从localStorage缓存中收集所有角色的Fact
      var allFacts = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf('memory_bridge_facts_') === 0) {
            var cached = localStorage.getItem(key);
            if (cached) {
              try {
                var parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                  for (var j = 0; j < parsed.length; j++) {
                    allFacts.push(parsed[j]);
                  }
                }
              } catch (e) {
                // 忽略
              }
            }
          }
        }
      } catch (e) {
        // 忽略
      }

      // 按时间倒序排列并截取
      allFacts.sort(function (a, b) {
        return (b.timestamp || 0) - (a.timestamp || 0);
      });

      var result = allFacts.slice(0, count || 10);
      log('getRecentFacts: 获取到', result.length, '条Fact');
      return Promise.resolve(result);
    },

    /**
     * 清除指定角色的手机Fact
     * @param {string} friendName - 好友角色名
     * @returns {Promise<boolean>}
     */
    clearPhoneFacts: function (friendName) {
      log('clearPhoneFacts: 清除', friendName, '的Fact');

      // 清除缓存
      if (_factCache && _factCache[friendName]) {
        delete _factCache[friendName];
      }

      // 清除localStorage缓存
      try {
        localStorage.removeItem('memory_bridge_facts_' + friendName);
      } catch (e) {
        // 忽略
      }

      // 尝试通过 ConfigManager.listVar 清除小白X变量
      var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
      if (ConfigManager && ConfigManager.listVar) {
        return ConfigManager.listVar('phone_fact.' + friendName).then(function (result) {
          var keys = Array.isArray(result) ? result : [];
          var chain = Promise.resolve(true);
          for (var i = 0; i < keys.length; i++) {
            (function (key) {
              key = key.trim();
              if (!key) return;
              chain = chain.then(function () {
                return window.BridgeAPI.setVar(key, '');
              });
            })(keys[i]);
          }
          return chain;
        }).catch(function () {
          return true;
        });
      }

      return Promise.resolve(true);
    },

    /**
     * 记忆增强Prompt构建
     * @param {string} systemPrompt - 原始system prompt
     * @param {string} friendName - 好友角色名
     * @returns {Promise<string>} 增强后的system prompt
     */
    enhancePrompt: function (systemPrompt, friendName) {
      var self = this;
      log('enhancePrompt: 开始增强', friendName);

      return self.getPhoneFacts(friendName).then(function (facts) {
        if (!facts || facts.length === 0) {
          log('enhancePrompt: 无相关Fact，跳过增强');
          return systemPrompt;
        }

        // 构建记忆增强段落
        var memoryBlock = '=== 手机互动记忆 ===\n';
        var totalLength = memoryBlock.length;

        for (var i = 0; i < facts.length; i++) {
          var fact = facts[i];
          var timeStr = formatTimeAgo(fact.timestamp);
          var line = '- ' + fact.subject + fact.predicate + '（' + fact.object + '）(' + timeStr + ')\n';

          // 控制总长度不超过MAX_ENHANCE_LENGTH
          if (totalLength + line.length > MAX_ENHANCE_LENGTH) {
            break;
          }

          memoryBlock += line;
          totalLength += line.length;
        }

        log('enhancePrompt: 记忆段落长度', totalLength, '字');

        // 追加到systemPrompt末尾
        var enhanced = systemPrompt + '\n\n' + memoryBlock;
        return enhanced;
      }).catch(function (err) {
        logError('enhancePrompt: 增强失败，返回原始prompt', err);
        return systemPrompt;
      });
    },

    // ========== 5. 自动记忆同步 ==========

    /**
     * 启动自动记忆同步
     * 监听手机聊天活动，在AI回复或用户发消息后自动同步
     */
    startAutoSync: function () {
      if (_autoSyncRunning) {
        log('startAutoSync: 已在运行中');
        return;
      }

      _autoSyncRunning = true;
      log('startAutoSync: 启动自动记忆同步');

      var self = this;

      // 定义事件处理函数
      _autoSyncHandler = function (event) {
        if (!_autoSyncRunning) return;

        // 获取当前聊天的好友信息
        var friendName = '';
        var friendId = '';

        // 从messageApp获取当前好友
        if (window.messageApp && window.messageApp.currentFriendId) {
          friendId = window.messageApp.currentFriendId;
        }
        if (window.messageApp && window.messageApp.currentFriend) {
          friendName = window.messageApp.currentFriend.name || '';
        }

        // 从friendRenderer获取好友名
        if (!friendName && window.friendRenderer && window.friendRenderer.friends) {
          var friends = window.friendRenderer.friends;
          for (var i = 0; i < friends.length; i++) {
            if (String(friends[i].number) === String(friendId)) {
              friendName = friends[i].name || '';
              break;
            }
          }
        }

        if (!friendName || !friendId) return;

        // 根据事件类型选择延迟
        var delay = AUTO_SYNC_DELAY_USER;
        if (event && event.type === 'ai_reply') {
          delay = AUTO_SYNC_DELAY_AI;
        }

        log('startAutoSync: 触发同步', friendName, '延迟', delay / 1000, '秒');

        setTimeout(function () {
          if (!_autoSyncRunning) return;
          self.syncPhoneMemory(friendName, friendId);
        }, delay);
      };

      // 监听XBBridge事件（如果可用）
      if (window.XBBridge && window.XBBridge.events) {
        // [MC-Fix-7] 保存事件处理器引用，以便 stopAutoSync 正确移除
        _xbbEventHandlers['GENERATE_AFTER'] = function () {
          _autoSyncHandler({ type: 'ai_reply' });
        };
        _xbbEventHandlers['MESSAGE_SENT'] = function () {
          _autoSyncHandler({ type: 'user_message' });
        };
        _xbbEventHandlers['MESSAGE_RECEIVED'] = function () {
          _autoSyncHandler({ type: 'message_received' });
        };

        window.XBBridge.events.on('GENERATE_AFTER', _xbbEventHandlers['GENERATE_AFTER']);
        window.XBBridge.events.on('MESSAGE_SENT', _xbbEventHandlers['MESSAGE_SENT']);
        window.XBBridge.events.on('MESSAGE_RECEIVED', _xbbEventHandlers['MESSAGE_RECEIVED']);

        log('startAutoSync: 已注册XBBridge事件监听');
      }

      // 备用：监听自定义事件（从message-sender.js等模块发出）
      try {
        // [MC-Fix-7] 保存自定义事件处理器引用
        _customEventHandlers['phone-message-sent'] = function () {
          _autoSyncHandler({ type: 'user_message' });
        };
        _customEventHandlers['phone-ai-reply'] = function () {
          _autoSyncHandler({ type: 'ai_reply' });
        };

        window.addEventListener('phone-message-sent', _customEventHandlers['phone-message-sent']);
        window.addEventListener('phone-ai-reply', _customEventHandlers['phone-ai-reply']);
        log('startAutoSync: 已注册自定义事件监听');
      } catch (e) {
        warn('startAutoSync: 自定义事件监听注册失败', e);
      }

      // 备用：定时轮询检测新消息（最低保障）
      var _lastMsgCount = {};
      _pollingTimerId = setInterval(function () {
        if (!_autoSyncRunning) return;
        if (!window.RoleAPI) return;

        // 检查所有好友的聊天历史变化
        var histories = window.RoleAPI.chatHistories || {};
        var keys = Object.keys(histories);
        for (var i = 0; i < keys.length; i++) {
          var id = keys[i];
          var history = histories[id];
          var currentCount = history ? history.length : 0;
          var lastCount = _lastMsgCount[id] || 0;

          if (currentCount > lastCount && lastCount > 0) {
            // 获取好友名
            var name = id;
            if (window.friendRenderer && window.friendRenderer.friends) {
              var friends = window.friendRenderer.friends;
              for (var j = 0; j < friends.length; j++) {
                if (String(friends[j].number) === String(id)) {
                  name = friends[j].name || id;
                  break;
                }
              }
            }
            log('startAutoSync: 轮询检测到新消息', name);
            setTimeout(function () {
              if (!_autoSyncRunning) return;
              self.syncPhoneMemory(name, id);
            }, AUTO_SYNC_DELAY_USER);
          }

          _lastMsgCount[id] = currentCount;
        }
      }, 30000); // 每30秒检查一次
    },

    /**
     * 停止自动记忆同步
     */
    stopAutoSync: function () {
      _autoSyncRunning = false;
      log('stopAutoSync: 自动记忆同步已停止');

      // 清除轮询定时器
      if (_pollingTimerId) {
        clearInterval(_pollingTimerId);
        _pollingTimerId = null;
      }

      // [MC-Fix-7] 使用保存的引用正确移除 XBBridge 事件监听
      if (window.XBBridge && window.XBBridge.events) {
        try {
          var xbbEvents = Object.keys(_xbbEventHandlers);
          for (var i = 0; i < xbbEvents.length; i++) {
            window.XBBridge.events.off(xbbEvents[i], _xbbEventHandlers[xbbEvents[i]]);
          }
          _xbbEventHandlers = {};
        } catch (e) {
          warn('stopAutoSync: 移除XBBridge事件监听失败', e);
        }
      }

      // [MC-Fix-7] 移除自定义 DOM 事件监听
      try {
        var customEvents = Object.keys(_customEventHandlers);
        for (var j = 0; j < customEvents.length; j++) {
          window.removeEventListener(customEvents[j], _customEventHandlers[customEvents[j]]);
        }
        _customEventHandlers = {};
      } catch (e) {
        warn('stopAutoSync: 移除自定义事件监听失败', e);
      }

      _autoSyncHandler = null;
    },

    // ========== 6. 辅助方法 ==========

    /**
     * 获取模块状态信息
     * @returns {object} 状态对象
     */
    getStatus: function () {
      return {
        xbAvailable: isXBAvailable(),
        bridgeAvailable: isBridgeAvailable(),
        roleAvailable: isRoleAvailable(),
        autoSyncRunning: _autoSyncRunning,
        syncTimers: Object.keys(_syncTimers).length,
        factCacheValid: _factCache !== null && (Date.now() - _factCacheTime) < _factCacheTTL
      };
    },

    /**
     * 清除内部缓存
     */
    clearCache: function () {
      _factCache = null;
      _factCacheTime = 0;
      log('clearCache: 缓存已清除');
    },

    /**
     * 销毁模块，释放所有资源
     */
    destroy: function () {
      this.stopAutoSync();
      this.clearCache();
      _syncTimers = {};
      log('destroy: 模块已销毁');
    }
  };

  // ===== 挂载全局 =====
  window.MemoryBridge = MemoryBridge;

  // ===== 初始化日志 =====
  log('模块已加载');
  log('小白X可用:', isXBAvailable());
  log('BridgeAPI可用:', isBridgeAvailable());
  log('RoleAPI可用:', isRoleAvailable());

})();
