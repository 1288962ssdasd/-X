/**
 * 角色卡数据隔离管理器
 * 确保每个角色卡的数据独立存储，切换角色时不会相互污染
 */

class CharacterDataIsolation {
  constructor() {
    this.currentCharacterId = null;
    this.currentCharacterName = null;
    this.characterDataStore = {}; // 按角色ID存储数据
    this.dataStorageKey = 'mobile_plugin_character_data';
    this.listeners = [];
    this.initialized = false;
  }

  /**
   * 初始化数据隔离管理器
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[Character Data Isolation] 初始化角色卡数据隔离管理器...');

    // 从localStorage加载数据
    this.loadFromStorage();

    // 获取当前角色信息
    this.updateCurrentCharacter();

    // 监听角色切换事件
    this.setupCharacterChangeListener();

    this.initialized = true;
    console.log('[Character Data Isolation] ✅ 角色卡数据隔离管理器初始化完成');
  }

  /**
   * 从localStorage加载数据
   */
  loadFromStorage() {
    try {
      const savedData = localStorage.getItem(this.dataStorageKey);
      if (savedData) {
        this.characterDataStore = JSON.parse(savedData);
        console.log('[Character Data Isolation] 从localStorage加载数据:', Object.keys(this.characterDataStore));
      }
    } catch (error) {
      console.error('[Character Data Isolation] 从localStorage加载数据失败:', error);
    }
  }

  /**
   * 保存数据到localStorage
   */
  saveToStorage() {
    try {
      localStorage.setItem(this.dataStorageKey, JSON.stringify(this.characterDataStore));
    } catch (error) {
      console.error('[Character Data Isolation] 保存数据到localStorage失败:', error);
    }
  }

  /**
   * 获取当前角色信息
   */
  getCurrentCharacterInfo() {
    let characterId = null;
    let characterName = null;

    // 方法1：通过SillyTavern.getContext()获取
    if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
      const context = window.SillyTavern.getContext();
      if (context) {
        if (context.characterId !== undefined) {
          characterId = context.characterId;
        } else if (context.this_chid !== undefined) {
          characterId = context.this_chid;
        }

        if (context.characters && characterId !== null && context.characters[characterId]) {
          characterName = context.characters[characterId].name;
        } else if (context.name2) {
          characterName = context.name2;
        }
      }
    }

    // 方法2：通过全局变量获取
    if (!characterId && typeof window.this_chid !== 'undefined') {
      characterId = window.this_chid;
    }

    if (!characterName && typeof window.characters !== 'undefined' && characterId !== null) {
      if (window.characters[characterId]) {
        characterName = window.characters[characterId].name;
      }
    }

    if (!characterName && typeof window.name2 !== 'undefined') {
      characterName = window.name2;
    }

    // 如果没有找到角色ID，使用角色名作为替代ID
    if (!characterId && characterName) {
      characterId = `char_${characterName.replace(/\s+/g, '_')}`;
    }

    return {
      id: characterId,
      name: characterName
    };
  }

  /**
   * 更新当前角色信息
   */
  updateCurrentCharacter() {
    const charInfo = this.getCurrentCharacterInfo();
    
    if (charInfo.id !== this.currentCharacterId) {
      const oldId = this.currentCharacterId;
      const oldName = this.currentCharacterName;
      
      this.currentCharacterId = charInfo.id;
      this.currentCharacterName = charInfo.name;
      
      console.log(`[Character Data Isolation] 角色切换: ${oldName || '无'} (${oldId || '无'}) -> ${charInfo.name || '未知'} (${charInfo.id || '未知'})`);
      
      // 触发角色切换事件
      this.notifyCharacterChanged(oldId, charInfo.id);
    }
    
    return charInfo;
  }

  /**
   * 设置角色切换监听器
   */
  setupCharacterChangeListener() {
    // 监听SillyTavern的事件系统
    if (window.eventSource && window.event_types) {
      if (window.event_types.CHAT_CHANGED) {
        window.eventSource.on(window.event_types.CHAT_CHANGED, () => {
          console.log('[Character Data Isolation] 检测到聊天切换事件');
          this.updateCurrentCharacter();
        });
      }
      
      if (window.event_types.CHARACTER_CHANGED) {
        window.eventSource.on(window.event_types.CHARACTER_CHANGED, () => {
          console.log('[Character Data Isolation] 检测到角色切换事件');
          this.updateCurrentCharacter();
        });
      }
    }
    
    // 定期检查角色变化（备用方案）
    setInterval(() => {
      this.updateCurrentCharacter();
    }, 2000);
  }

  /**
   * 添加角色切换监听器
   */
  addCharacterChangeListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * 移除角色切换监听器
   */
  removeCharacterChangeListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知角色切换
   */
  notifyCharacterChanged(oldId, newId) {
    this.listeners.forEach(callback => {
      try {
        callback(oldId, newId);
      } catch (error) {
        console.error('[Character Data Isolation] 角色切换监听器执行失败:', error);
      }
    });
  }

  /**
   * 获取当前角色的数据
   */
  getCharacterData(namespace = 'default') {
    if (!this.currentCharacterId) {
      console.warn('[Character Data Isolation] 无法获取角色数据：当前角色ID未知');
      return {};
    }

    if (!this.characterDataStore[this.currentCharacterId]) {
      this.characterDataStore[this.currentCharacterId] = {};
    }

    if (!this.characterDataStore[this.currentCharacterId][namespace]) {
      this.characterDataStore[this.currentCharacterId][namespace] = {};
    }

    return { ...this.characterDataStore[this.currentCharacterId][namespace] };
  }

  /**
   * 设置当前角色的数据
   */
  setCharacterData(namespace, data) {
    if (!this.currentCharacterId) {
      console.warn('[Character Data Isolation] 无法设置角色数据：当前角色ID未知');
      return false;
    }

    if (!this.characterDataStore[this.currentCharacterId]) {
      this.characterDataStore[this.currentCharacterId] = {};
    }

    this.characterDataStore[this.currentCharacterId][namespace] = { ...data };
    this.saveToStorage();

    console.log(`[Character Data Isolation] 角色${this.currentCharacterName || this.currentCharacterId}的${namespace}数据已更新`);
    return true;
  }

  /**
   * 更新角色数据（合并而不是覆盖）
   */
  updateCharacterData(namespace, partialData) {
    const currentData = this.getCharacterData(namespace);
    const updatedData = { ...currentData, ...partialData };
    return this.setCharacterData(namespace, updatedData);
  }

  /**
   * 删除角色数据
   */
  deleteCharacterData(namespace) {
    if (!this.currentCharacterId) {
      return false;
    }

    if (this.characterDataStore[this.currentCharacterId]) {
      delete this.characterDataStore[this.currentCharacterId][namespace];
      this.saveToStorage();
      return true;
    }

    return false;
  }

  /**
   * 清除所有角色数据
   */
  clearAllCharacterData() {
    this.characterDataStore = {};
    this.saveToStorage();
    console.log('[Character Data Isolation] 已清除所有角色数据');
  }

  /**
   * 获取所有角色ID列表
   */
  getAllCharacterIds() {
    return Object.keys(this.characterDataStore);
  }

  /**
   * 获取数据存储统计信息
   */
  getStorageStats() {
    const stats = {
      totalCharacters: Object.keys(this.characterDataStore).length,
      characters: {}
    };

    for (const charId in this.characterDataStore) {
      const namespaces = Object.keys(this.characterDataStore[charId]);
      stats.characters[charId] = {
        namespaces: namespaces,
        namespaceCount: namespaces.length
      };
    }

    return stats;
  }
}

// 创建全局实例
if (!window.CharacterDataIsolation) {
  window.CharacterDataIsolation = CharacterDataIsolation;
  window.characterDataIsolation = new CharacterDataIsolation();
}

console.log('[Character Data Isolation] 模块已加载');

