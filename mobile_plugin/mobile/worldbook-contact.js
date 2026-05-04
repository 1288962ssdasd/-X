// ============================================================
// worldbook-contact.js -- 大世界联系人集成
// 职责：从世界书同步联系人到手机好友列表，管理关系数据，映射邀约/短信事件
// 运行环境：Android WebView + Node.js（不使用 ES Module、顶层 await、optional chaining 等）
// 依赖：window.XBBridge（xiaobaix-bridge.js）、window.BridgeAPI（bridge-api.js）、window.friendRenderer（friend-renderer.js）
// ============================================================

(function () {
  'use strict';

  // ===== 常量 =====
  var LOG_PREFIX = '[WBContact]';
  var DEFAULT_SYNC_INTERVAL = 60; // 默认自动同步间隔（秒）
  var CONTACT_MARKERS = ['联系人', '好友', 'NPC', '角色卡', 'character']; // 世界书条目联系人标记关键词

  // ===== 内部状态 =====
  var _contactCache = {};   // { friendId: contactObj } 联系人缓存，用于去重
  var _syncTimerId = null;  // 自动同步定时器ID
  var _isSyncing = false;   // 同步锁，防止并发
  var _lastSyncTime = 0;    // 上次同步时间戳
  var _worldbookFileCache = null; // 世界书文件列表缓存

  // ===== 工具函数 =====

  /**
   * 日志输出
   */
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
   * 检查小白X桥接是否可用
   * @returns {boolean}
   */
  function isXBBridgeAvailable() {
    return !!(window.XBBridge && window.XBBridge.isAvailable && window.XBBridge.isAvailable());
  }

  /**
   * 检查 BridgeAPI 是否可用
   * @returns {boolean}
   */
  function isBridgeAPIAvailable() {
    return !!(window.BridgeAPI && window.BridgeAPI.getVar);
  }

  /**
   * 检查 friendRenderer 是否可用
   * @returns {boolean}
   */
  function isFriendRendererAvailable() {
    return !!(window.friendRenderer && typeof window.friendRenderer.addFriend === 'function');
  }

  /**
   * 判断世界书条目的key是否包含联系人标记
   * @param {string} key - 世界书条目的key字段
   * @returns {boolean}
   */
  function normalizeKey(key) {
    if (!key) return '';
    if (Array.isArray(key)) return key.join(',');
    return String(key);
  }

  function isContactEntry(key) {
    if (!key) return false;
    var keyStr = normalizeKey(key);
    if (!keyStr) return false;
    var lowerKey = keyStr.toLowerCase();
    for (var i = 0; i < CONTACT_MARKERS.length; i++) {
      if (lowerKey.indexOf(CONTACT_MARKERS[i].toLowerCase()) !== -1) {
        return true;
      }
    }
    return false;
  }

  /**
   * 从世界书条目数据中提取联系人信息
   * @param {object} entry - 世界书条目
   * @returns {object|null} 联系人对象或null
   */
  function extractContactFromEntry(entry) {
    if (!entry) return null;

    var uid = entry.uid || entry.id || '';
    var key = normalizeKey(entry.key || entry.comment || '');
    var content = entry.content || '';

    // uid为空则跳过
    if (!uid) return null;

    // key为空则跳过
    if (!key) return null;

    // 尝试从key中提取角色名（取第一个|之前的内容，或整个key）
    var name = key;
    if (key.indexOf('|') !== -1) {
      name = key.split('|')[0].trim();
    }
    // 去除标记关键词，获取纯净名称
    for (var i = 0; i < CONTACT_MARKERS.length; i++) {
      name = name.replace(new RegExp(CONTACT_MARKERS[i], 'gi'), '').trim();
    }
    // 如果清理后名称为空，使用原始key
    if (!name) {
      name = key;
    }

    // 尝试从content中解析关系类型
    var relationship = '陌生人';
    var affection = 50;

    if (content) {
      // 匹配关系标记：恋人/朋友/熟人/同事/敌对等
      var relMatch = content.match(/关系[：:]\s*([^\n,，]+)/);
      if (relMatch) {
        relationship = relMatch[1].trim();
      } else {
        // 尝试从内容中推断关系
        if (content.indexOf('恋人') !== -1 || content.indexOf('女朋友') !== -1 || content.indexOf('男朋友') !== -1) {
          relationship = '恋人';
        } else if (content.indexOf('朋友') !== -1 || content.indexOf('好友') !== -1) {
          relationship = '朋友';
        } else if (content.indexOf('同事') !== -1) {
          relationship = '同事';
        } else if (content.indexOf('敌对') !== -1 || content.indexOf('仇人') !== -1) {
          relationship = '敌对';
        } else if (content.indexOf('熟人') !== -1) {
          relationship = '熟人';
        }
      }

      // 匹配好感度/沉沦度数值
      var affMatch = content.match(/(?:好感度|沉沦度|亲密度)[：:]\s*(\d+)/);
      if (affMatch) {
        affection = parseInt(affMatch[1], 10) || 50;
        affection = Math.max(0, Math.min(100, affection));
      }
    }

    return {
      uid: uid,
      name: name,
      friendId: uid,
      description: content,
      relationship: relationship,
      affection: affection,
      source: 'worldbook',
      syncedAt: Date.now()
    };
  }

  /**
   * 获取自动同步间隔（从配置读取，回退到默认值）
   * @returns {Promise<number>}
   */
  function getSyncInterval() {
    if (isBridgeAPIAvailable()) {
      return window.BridgeAPI.ConfigManager.get('xb.phone.contact.syncInterval')
        .then(function (val) {
          var interval = parseInt(val, 10);
          if (interval && interval > 0) return interval;
          return DEFAULT_SYNC_INTERVAL;
        })
        .catch(function () {
          return DEFAULT_SYNC_INTERVAL;
        });
    }
    return Promise.resolve(DEFAULT_SYNC_INTERVAL);
  }

  // ===== WorldbookContact 主对象 =====

  var WorldbookContact = {

    // ---------- 1. 从世界书同步联系人 ----------

    /**
     * 从世界书同步联系人到手机好友列表
     * - 获取全局世界书和角色卡世界书
     * - 搜索包含联系人标记的条目
     * - 提取联系人信息并添加到好友列表
     * - 自动去重
     * @returns {Promise<Array>} 新增的联系人列表
     */
    syncContacts: function () {
      if (_isSyncing) {
        warn('syncContacts: 正在同步中，跳过本次请求');
        return Promise.resolve([]);
      }

      if (!isXBBridgeAvailable()) {
        warn('syncContacts: 小白X不可用，跳过同步');
        return Promise.resolve([]);
      }

      _isSyncing = true;
      log('syncContacts: 开始同步联系人');

      var allEntries = [];
      var globalBooksDone = false;
      var charBookDone = false;

      // 并行获取全局世界书和角色卡世界书
      return Promise.all([
        // 获取全局世界书列表
        window.XBBridge.worldbook.getGlobalBooks()
          .then(function (books) {
            log('syncContacts: 获取到全局世界书', books ? books.length : 0, '本');
            return books || [];
          })
          .catch(function (e) {
            warn('syncContacts: 获取全局世界书失败', e);
            return [];
          }),

        // 获取角色卡世界书
        window.XBBridge.worldbook.getCharBook({})
          .then(function (charBook) {
            log('syncContacts: 获取到角色卡世界书');
            return charBook ? [charBook] : [];
          })
          .catch(function (e) {
            warn('syncContacts: 获取角色卡世界书失败', e);
            return [];
          })
      ]).then(function (results) {
        var globalBooks = results[0];
        var charBooks = results[1];
        var allBooks = globalBooks.concat(charBooks);

        if (allBooks.length === 0) {
          log('syncContacts: 没有可用的世界书');
          _isSyncing = false;
          return [];
        }

        // 逐个世界书列出条目（跳过没有有效 file 的世界书）
        var listChain = Promise.resolve([]);
        for (var i = 0; i < allBooks.length; i++) {
          (function (book) {
            var bookName = book.name || book.file || '';
            var bookFile = book.file || book.name || '';
            listChain = listChain.then(function (entries) {
              // 跳过没有有效文件名的世界书，避免 VALIDATION_FAILED 刷屏
              if (!bookFile || bookFile.trim() === '') {
                log('syncContacts: 跳过无文件名的世界书', bookName || '(unnamed)');
                return entries;
              }
              return window.XBBridge.worldbook.listEntries({ file: bookFile })
                .then(function (bookEntries) {
                  if (bookEntries && Array.isArray(bookEntries)) {
                    // 为每个条目标记来源世界书
                    for (var j = 0; j < bookEntries.length; j++) {
                      bookEntries[j]._sourceBook = bookName;
                    }
                    return entries.concat(bookEntries);
                  }
                  return entries;
                })
                .catch(function (e) {
                  warn('syncContacts: 列出世界书条目失败', bookName, e);
                  return entries;
                });
            });
          })(allBooks[i]);
        }

        return listChain;
      }).then(function (entries) {
        allEntries = entries;
        log('syncContacts: 共获取到', allEntries.length, '个世界书条目');

        // 筛选包含联系人标记的条目
        var contactEntries = [];
        for (var i = 0; i < allEntries.length; i++) {
          var entry = allEntries[i];
          var key = normalizeKey(entry.key || entry.comment || '');
          // 通过key中的标记关键词筛选
          if (isContactEntry(key)) {
            contactEntries.push(entry);
          }
        }

        // 如果没有通过标记找到联系人，尝试使用模糊搜索
        if (contactEntries.length === 0) {
          log('syncContacts: 未通过标记找到联系人，尝试模糊搜索');
          return searchContactsByKeyword().then(function (searchResults) {
            contactEntries = contactEntries.concat(searchResults);
            return contactEntries;
          });
        }

        return Promise.resolve(contactEntries);
      }).then(function (contactEntries) {
        // 提取联系人信息并去重添加
        var addedContacts = [];

        for (var i = 0; i < contactEntries.length; i++) {
          var contact = extractContactFromEntry(contactEntries[i]);
          if (!contact) continue;

          // 去重：已存在的好友不重复添加
          if (_contactCache[contact.friendId]) {
            // 更新缓存中的信息
            _contactCache[contact.friendId].description = contact.description || _contactCache[contact.friendId].description;
            _contactCache[contact.friendId].relationship = contact.relationship || _contactCache[contact.friendId].relationship;
            _contactCache[contact.friendId].syncedAt = contact.syncedAt;
            continue;
          }

          // 添加到缓存
          _contactCache[contact.friendId] = contact;

          // 添加到手机好友列表
          if (isFriendRendererAvailable()) {
            var added = window.friendRenderer.addFriend(contact.name, contact.friendId);
            if (added) {
              addedContacts.push(contact);
              log('syncContacts: 添加联系人', contact.name, '(' + contact.friendId + ')');
            }
          } else {
            warn('syncContacts: friendRenderer不可用，联系人', contact.name, '仅缓存未添加到列表');
            addedContacts.push(contact);
          }
        }

        _lastSyncTime = Date.now();
        _isSyncing = false;

        log('syncContacts: 同步完成，新增', addedContacts.length, '个联系人，总计', Object.keys(_contactCache).length, '个');
        return addedContacts;
      }).catch(function (e) {
        logError('syncContacts: 同步失败', e);
        _isSyncing = false;
        return [];
      });
    },

    // ---------- 2. 联系人关系同步 ----------

    /**
     * 从变量系统同步联系人关系数据
     * - 读取各角色的沉沦度、阶段、状态
     * - 更新手机好友的显示信息
     * @returns {Promise<object>} 更新后的关系数据 { friendId: { relationship, affection, phase, status } }
     */
    syncRelationships: function () {
      if (!isBridgeAPIAvailable()) {
        warn('syncRelationships: BridgeAPI不可用，跳过关系同步');
        return Promise.resolve({});
      }

      log('syncRelationships: 开始同步关系数据');

      var contactIds = Object.keys(_contactCache);
      if (contactIds.length === 0) {
        log('syncRelationships: 无联系人缓存，跳过');
        return Promise.resolve({});
      }

      var results = {};

      // 并行处理所有联系人（替代原来的串行 chain 模式，避免任务阻塞）
      var contactPromises = contactIds.map(function (friendId) {
        var contact = _contactCache[friendId];
        var name = contact.name;

        return Promise.all([
          // 沉沦度（新路径）
          window.BridgeAPI.getVar('游戏数据.' + name + '.沉沦度')
            .catch(function () { return null; }),
          // 阶段
          window.BridgeAPI.getVar('游戏数据.' + name + '.阶段')
            .catch(function () { return null; }),
          // 状态
          window.BridgeAPI.getVar('游戏数据.' + name + '.状态')
            .catch(function () { return null; }),
          // 好感度（备用路径）
          window.BridgeAPI.getVar('phone.' + name + '.affection')
            .catch(function () { return null; }),
          // 关系类型（备用路径）
          window.BridgeAPI.getVar('phone.' + name + '.relationship')
            .catch(function () { return null; })
        ]).then(function (vars) {
          var sinkingDegree = vars[0]; // 游戏数据.{name}.沉沦度
          var phase = vars[1];          // 游戏数据.{name}.阶段
          var status = vars[2];         // 游戏数据.{name}.状态
          var affection = vars[3];      // phone.{name}.affection
          var relationship = vars[4];   // phone.{name}.relationship

          // 优先使用游戏数据中的沉沦度，回退到phone变量中的好感度
          var finalAffection = contact.affection;
          if (sinkingDegree !== null && sinkingDegree !== '') {
            finalAffection = parseInt(sinkingDegree, 10) || finalAffection;
            finalAffection = Math.max(0, Math.min(100, finalAffection));
          } else if (affection !== null && affection !== '') {
            finalAffection = parseInt(affection, 10) || finalAffection;
            finalAffection = Math.max(0, Math.min(100, finalAffection));
          }

          // 更新关系类型
          var finalRelationship = contact.relationship;
          if (relationship !== null && relationship !== '') {
            finalRelationship = relationship;
          }

          // 更新缓存
          _contactCache[friendId].affection = finalAffection;
          _contactCache[friendId].relationship = finalRelationship;
          if (phase !== null && phase !== '') {
            _contactCache[friendId].phase = phase;
          }
          if (status !== null && status !== '') {
            _contactCache[friendId].status = status;
          }
          _contactCache[friendId].relationshipSyncedAt = Date.now();

          return {
            friendId: friendId,
            name: name,
            relationship: finalRelationship,
            affection: finalAffection,
            phase: phase || '',
            status: status || ''
          };
        });
      });

      return Promise.all(contactPromises).then(function (allResults) {
        for (var i = 0; i < allResults.length; i++) {
          var item = allResults[i];
          results[item.friendId] = item;
        }
        log('syncRelationships: 关系同步完成，更新了', Object.keys(results).length, '个联系人');
        return results;
      }).catch(function (e) {
        logError('syncRelationships: 关系同步失败', e);
        return results;
      });
    },

    // ---------- 3. 邀约/短信功能映射 ----------

    /**
     * 发起邀约：将手机中的"邀请见面"映射为大世界的邀约事件
     * @param {string} friendName - 好友名称
     * @param {string} location - 邀约地点
     * @returns {Promise<boolean>} 是否成功
     */
    sendInvitation: function (friendName, location) {
      if (!friendName) {
        warn('sendInvitation: 缺少好友名称');
        return Promise.resolve(false);
      }

      log('sendInvitation: 发起邀约', friendName, '->', location || '未指定地点');

      // 构建邀约事件内容
      var eventContent = '邀约事件：吴宇伦邀请' + friendName + '在' + (location || '约定地点') + '见面';
      var timestamp = new Date().toLocaleString('zh-CN');

      // 优先尝试通过世界书写入邀约记录
      if (isXBBridgeAvailable()) {
        // 先获取当前聊天世界书文件名
        var wbFile = null;
        return window.XBBridge.worldbook.getChatBook({})
          .then(function (chatBook) {
            if (chatBook) {
              wbFile = chatBook.file_name || chatBook.name || chatBook.file || null;
            }
            if (!wbFile) {
              warn('sendInvitation: 无法获取聊天世界书文件名，回退到变量通知');
              return notifyPendingEvent('invitation', friendName, location)
                .then(function () { return true; })
                .catch(function () { return false; });
            }
            log('sendInvitation: 使用世界书文件', wbFile);
            return window.XBBridge.worldbook.createEntry({
              file: wbFile,
              key: '邀约|' + friendName + '|' + timestamp,
              content: eventContent + '\n状态：待确认\n时间：' + timestamp
            });
          })
          .then(function () {
            log('sendInvitation: 邀约事件已写入世界书');
            // 同时通过变量通知循环任务
            return notifyPendingEvent('invitation', friendName, location);
          })
          .then(function () {
            return true;
          })
          .catch(function (e) {
            warn('sendInvitation: 写入世界书失败，尝试仅通过变量通知', e);
            return notifyPendingEvent('invitation', friendName, location)
              .then(function () { return true; })
              .catch(function () { return false; });
          });
      }

      // 小白X不可用，仅通过变量通知
      if (isBridgeAPIAvailable()) {
        return notifyPendingEvent('invitation', friendName, location)
          .then(function () { return true; })
          .catch(function () { return false; });
      }

      warn('sendInvitation: 小白X和BridgeAPI均不可用');
      return Promise.resolve(false);
    },

    /**
     * 发送短信通知：将手机短信映射为大世界事件
     * @param {string} friendName - 好友名称
     * @param {string} messageContent - 短信内容
     * @returns {Promise<boolean>}
     */
    sendSMSNotification: function (friendName, messageContent) {
      if (!friendName) {
        warn('sendSMSNotification: 缺少好友名称');
        return Promise.resolve(false);
      }

      log('sendSMSNotification: 发送短信通知', friendName);

      return notifyPendingEvent('sms', friendName, messageContent)
        .then(function () { return true; })
        .catch(function (e) {
          warn('sendSMSNotification: 通知失败', e);
          return false;
        });
    },

    // ---------- 4. 自动同步监听 ----------

    /**
     * 启动自动同步
     * @param {number} [interval] - 同步间隔（秒），不传则从配置读取或使用默认值60秒
     */
    startAutoSync: function (interval) {
      if (_syncTimerId) {
        warn('startAutoSync: 自动同步已在运行中');
        return;
      }

      var startSync = function (syncInterval) {
        log('startAutoSync: 启动自动同步，间隔', syncInterval, '秒');

        // 立即执行一次同步
        WorldbookContact.syncContacts().then(function () {
          return WorldbookContact.syncRelationships();
        }).catch(function (e) {
          warn('startAutoSync: 首次同步异常', e);
        });

        // 定时同步
        _syncTimerId = setInterval(function () {
          log('startAutoSync: 定时同步触发');
          WorldbookContact.syncContacts().then(function () {
            return WorldbookContact.syncRelationships();
          }).catch(function (e) {
            warn('startAutoSync: 定时同步异常', e);
          });
        }, syncInterval * 1000);
      };

      if (interval && interval > 0) {
        startSync(interval);
      } else {
        // 从配置读取间隔
        getSyncInterval().then(function (configuredInterval) {
          startSync(configuredInterval);
        });
      }
    },

    /**
     * 停止自动同步
     */
    stopAutoSync: function () {
      if (_syncTimerId) {
        clearInterval(_syncTimerId);
        _syncTimerId = null;
        log('stopAutoSync: 自动同步已停止');
      } else {
        log('stopAutoSync: 自动同步未在运行');
      }
    },

    /**
     * 检查自动同步是否正在运行
     * @returns {boolean}
     */
    isAutoSyncRunning: function () {
      return _syncTimerId !== null;
    },

    // ---------- 5. 手动触发接口 ----------

    /**
     * 从世界书手动添加指定UID的联系人
     * @param {string} uid - 世界书条目UID
     * @returns {Promise<object|null>} 添加的联系人信息，失败返回null
     */
    addContactFromWorldbook: function (uid) {
      if (!uid) {
        warn('addContactFromWorldbook: 缺少UID');
        return Promise.resolve(null);
      }

      if (!isXBBridgeAvailable()) {
        warn('addContactFromWorldbook: 小白X不可用');
        return Promise.resolve(null);
      }

      log('addContactFromWorldbook: 添加联系人', uid);

      // 去重检查
      if (_contactCache[uid]) {
        warn('addContactFromWorldbook: 联系人已存在', uid);
        return Promise.resolve(_contactCache[uid]);
      }

      // 需要先找到该UID所在的世界书文件
      return findEntryByUid(uid).then(function (entry) {
        if (!entry) {
          warn('addContactFromWorldbook: 未找到UID对应的条目', uid);
          return null;
        }

        var contact = extractContactFromEntry(entry);
        if (!contact) {
          warn('addContactFromWorldbook: 无法从条目提取联系人信息', uid);
          return null;
        }

        // 添加到缓存
        _contactCache[contact.friendId] = contact;

        // 添加到手机好友列表
        if (isFriendRendererAvailable()) {
          var added = window.friendRenderer.addFriend(contact.name, contact.friendId);
          if (added) {
            log('addContactFromWorldbook: 成功添加联系人', contact.name);
          } else {
            warn('addContactFromWorldbook: friendRenderer返回添加失败（可能已存在）', contact.name);
          }
        }

        return contact;
      }).catch(function (e) {
        logError('addContactFromWorldbook: 添加失败', uid, e);
        return null;
      });
    },

    /**
     * 移除联系人
     * @param {string} friendId - 好友ID（即世界书条目UID）
     * @returns {Promise<boolean>} 是否成功移除
     */
    removeContact: function (friendId) {
      if (!friendId) {
        warn('removeContact: 缺少friendId');
        return Promise.resolve(false);
      }

      log('removeContact: 移除联系人', friendId);

      if (!_contactCache[friendId]) {
        warn('removeContact: 联系人不存在于缓存中', friendId);
        return Promise.resolve(false);
      }

      var contact = _contactCache[friendId];
      delete _contactCache[friendId];

      // 尝试从friendRenderer中移除
      if (isFriendRendererAvailable() && window.friendRenderer.extractedFriends) {
        var friends = window.friendRenderer.extractedFriends;
        for (var i = friends.length - 1; i >= 0; i--) {
          if (friends[i].number === friendId) {
            friends.splice(i, 1);
            break;
          }
        }
        try {
          window.friendRenderer.refresh();
        } catch (e) {
          // refresh可能失败，不影响主流程
        }
      }

      log('removeContact: 已移除联系人', contact.name, '(' + friendId + ')');
      return Promise.resolve(true);
    },

    /**
     * 获取联系人列表
     * @returns {Array} 联系人数组
     */
    getContactList: function () {
      var list = [];
      var ids = Object.keys(_contactCache);
      for (var i = 0; i < ids.length; i++) {
        list.push(_contactCache[ids[i]]);
      }
      log('getContactList: 返回', list.length, '个联系人');
      return list;
    },

    /**
     * 获取联系人详情
     * @param {string} friendId - 好友ID
     * @returns {object|null} 联系人详情，不存在返回null
     */
    getContactDetail: function (friendId) {
      if (!friendId) {
        warn('getContactDetail: 缺少friendId');
        return null;
      }

      var contact = _contactCache[friendId] || null;
      if (!contact) {
        log('getContactDetail: 联系人不存在', friendId);
      }
      return contact;
    },

    // ---------- 状态查询 ----------

    /**
     * 获取上次同步时间
     * @returns {number} 时间戳
     */
    getLastSyncTime: function () {
      return _lastSyncTime;
    },

    /**
     * 获取缓存的联系人数量
     * @returns {number}
     */
    getContactCount: function () {
      return Object.keys(_contactCache).length;
    },

    /**
     * 清空联系人缓存
     */
    clearCache: function () {
      _contactCache = {};
      _lastSyncTime = 0;
      log('clearCache: 联系人缓存已清空');
    }
  };

  // ===== 内部辅助函数 =====

  /**
   * 通过模糊搜索在世界书中查找联系人条目
   * 当标记关键词筛选无结果时使用
   * @returns {Promise<Array>}
   */
  function searchContactsByKeyword() {
    if (!isXBBridgeAvailable()) {
      return Promise.resolve([]);
    }

    var results = [];

    // 先获取所有世界书列表（全局 + 角色卡）
    return Promise.all([
      window.XBBridge.worldbook.getGlobalBooks()
        .then(function (books) { return books || []; })
        .catch(function () { return []; }),
      window.XBBridge.worldbook.getCharBook({})
        .then(function (charBook) { return charBook ? [charBook] : []; })
        .catch(function () { return []; })
    ]).then(function (bookGroups) {
      var allBooks = bookGroups[0].concat(bookGroups[1]);

      if (allBooks.length === 0) {
        log('searchContactsByKeyword: 没有可用的世界书，跳过模糊搜索');
        return [];
      }

      // 逐个世界书、逐个关键词搜索
      var searchChain = Promise.resolve();

      for (var b = 0; b < allBooks.length; b++) {
        (function (book) {
          var bookFile = book.file_name || book.name || book.file || '';

          if (!bookFile || bookFile.trim() === '') {
            return;
          }

          for (var k = 0; k < CONTACT_MARKERS.length; k++) {
            (function (keyword) {
              searchChain = searchChain.then(function () {
                return window.XBBridge.worldbook.findEntry({
                  file: bookFile,
                  field: 'key',
                  text: keyword
                });
              }).then(function (found) {
                if (found && Array.isArray(found)) {
                  for (var j = 0; j < found.length; j++) {
                    results.push(found[j]);
                  }
                } else if (found && typeof found === 'object') {
                  results.push(found);
                }
              }).catch(function (e) {
                warn('searchContactsByKeyword: findEntry 在', bookFile, '中搜索', keyword, '失败:', e);
              });
            })(CONTACT_MARKERS[k]);
          }
        })(allBooks[b]);
      }

      return searchChain.then(function () {
        // 去重（按uid）
        var seen = {};
        var unique = [];
        for (var i = 0; i < results.length; i++) {
          var uid = results[i].uid || results[i].id || '';
          if (uid && !seen[uid]) {
            seen[uid] = true;
            unique.push(results[i]);
          }
        }
        log('searchContactsByKeyword: 模糊搜索找到', unique.length, '个条目');
        return unique;
      });
    });
  }

  /**
   * 通过UID查找世界书条目
   * 遍历所有世界书查找指定UID的条目
   * @param {string} uid - 条目UID
   * @returns {Promise<object|null>}
   */
  function findEntryByUid(uid) {
    if (!isXBBridgeAvailable()) {
      return Promise.resolve(null);
    }

    // 先尝试直接获取条目字段（如果世界书API支持按UID查询）
    return window.XBBridge.worldbook.getGlobalBooks()
      .then(function (books) {
        return books || [];
      })
      .then(function (books) {
        // 同时获取角色卡世界书
        return window.XBBridge.worldbook.getCharBook({})
          .then(function (charBook) {
            if (charBook) books.push(charBook);
            return books;
          })
          .catch(function () {
            return books;
          });
      })
      .then(function (allBooks) {
        // 逐个世界书列出条目，查找匹配UID
        var searchChain = Promise.resolve(null);

        for (var i = 0; i < allBooks.length; i++) {
          (function (book) {
            var bookName = book.name || book.file || '';

            searchChain = searchChain.then(function (found) {
              if (found) return found; // 已找到，短路

              return window.XBBridge.worldbook.listEntries({ file: bookName })
                .then(function (entries) {
                  if (!entries || !Array.isArray(entries)) return null;

                  for (var j = 0; j < entries.length; j++) {
                    if (entries[j].uid === uid || entries[j].id === uid) {
                      return entries[j];
                    }
                  }
                  return null;
                })
                .catch(function () {
                  return null;
                });
            });
          })(allBooks[i]);
        }

        return searchChain;
      })
      .catch(function (e) {
        warn('findEntryByUid: 查找失败', uid, e);
        return null;
      });
  }

  /**
   * 通过变量系统通知循环任务有待处理事件
   * @param {string} eventType - 事件类型 ('invitation' | 'sms')
   * @param {string} target - 目标（好友名）
   * @param {string} detail - 事件详情（地点/内容）
   * @returns {Promise}
   */
  function notifyPendingEvent(eventType, target, detail) {
    if (!isBridgeAPIAvailable()) {
      return Promise.resolve();
    }

    var eventValue = eventType + '|' + target + '|' + (detail || '');

    return window.BridgeAPI.setVar('xb.phone.pendingEvent', eventValue)
      .then(function () {
        log('notifyPendingEvent: 已设置待处理事件', eventValue);
      })
      .catch(function (e) {
        warn('notifyPendingEvent: 设置变量失败', e);
      });
  }

  // ===== 挂载全局 =====
  window.WorldbookContact = WorldbookContact;

  // ===== 初始化日志 =====
  log('模块已加载');
  log('小白X可用:', isXBBridgeAvailable());
  log('BridgeAPI可用:', isBridgeAPIAvailable());
  log('friendRenderer可用:', isFriendRendererAvailable());

})();
