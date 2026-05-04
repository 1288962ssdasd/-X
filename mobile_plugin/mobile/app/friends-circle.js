/**
 * Friends Circle - 朋友圈功能
 * 为mobile-phone.js提供朋友圈功能，仿照QQ空间和微信朋友圈设计
 */

// 避免重复定义
if (typeof window.FriendsCircle === 'undefined') {
  /**
   * 朋友圈数据管理器
   * 负责朋友圈数据的解析、存储和管理
   */
  class FriendsCircleManager {
    constructor() {
      this.circlesData = []; // 存储朋友圈数据（从变量读取的数组）
      this.lastProcessedMessageIndex = -1; // 兼容字段

      console.log('[Friends Circle] 朋友圈数据管理器初始化完成（变量驱动模式）');
    }

    /**
     * 从变量读取朋友圈数据
     * @returns {Array} 朋友圈数据数组
     */
    parseFriendsCircleData() {
      return this.circlesData || [];
    }

    /**
     * 获取排序后的朋友圈列表（按 timestamp 降序）
     * @returns {Array} 按时间戳降序排序的朋友圈数组
     */
    getSortedFriendsCircles() {
      const circles = Array.isArray(this.circlesData) ? [...this.circlesData] : [];
      return circles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    /**
     * 切换点赞状态（修改变量）
     * @param {string} circleId - 朋友圈ID
     * @returns {Object} 点赞数据 { likes, isLiked }
     */
    async toggleLike(circleId) {
      try {
        var circles = this.circlesData || [];
        var circle = circles.find(c => c.id === circleId);
        if (!circle) return { likes: 0, isLiked: false };

        // 确保 likes 是数组
        if (!Array.isArray(circle.likes)) {
          circle.likes = [];
        }

        var isCurrentlyLiked = circle.isLiked || false;
        var userId = '483920'; // 当前用户ID

        if (isCurrentlyLiked) {
          // 取消点赞
          circle.likes = circle.likes.filter(id => id !== userId);
          circle.isLiked = false;
        } else {
          // 添加点赞
          circle.likes.push(userId);
          circle.isLiked = true;
        }

        // 写回变量
        await this._saveCirclesToVariable();
        return { likes: circle.likes.length, isLiked: circle.isLiked };
      } catch (e) {
        console.error('[Friends Circle] 切换点赞失败:', e);
        return { likes: 0, isLiked: false };
      }
    }

    /**
     * 添加回复（修改变量）
     * @param {string} circleId - 朋友圈ID
     * @param {Object} reply - 回复数据
     */
    async addReply(circleId, reply) {
      try {
        var circles = this.circlesData || [];
        var circle = circles.find(c => c.id === circleId);
        if (!circle) return;

        if (!circle.replies) circle.replies = [];
        circle.replies.push(reply);
        circle.latestActivityIndex = -1;

        // 写回变量
        await this._saveCirclesToVariable();
      } catch (e) {
        console.error('[Friends Circle] 添加回复失败:', e);
      }
    }

    /**
     * 删除朋友圈（从变量数组中移除）
     * @param {string} circleId - 朋友圈ID
     */
    async deleteCircle(circleId) {
      try {
        var circles = this.circlesData || [];
        this.circlesData = circles.filter(c => c.id !== circleId);
        await this._saveCirclesToVariable();
      } catch (e) {
        console.error('[Friends Circle] 删除朋友圈失败:', e);
      }
    }

    /**
     * 将 circlesData 写回变量
     */
    async _saveCirclesToVariable() {
      try {
        if (window.ConfigManager && typeof window.ConfigManager.set === 'function') {
          await window.ConfigManager.set('xb.friendsCircle.circles', JSON.stringify(this.circlesData));
        } else if (window.BridgeAPI && window.BridgeAPI.configManager) {
          await window.BridgeAPI.configManager.setVar('xb.friendsCircle.circles', JSON.stringify(this.circlesData));
        }
      } catch (e) {
        console.error('[Friends Circle] 写入变量失败:', e);
      }
    }

    /**
     * 获取用户签名（从变量读取）
     * @returns {Promise<string>} 用户签名
     */
    async getUserSignature() {
      try {
        var sig = null;
        if (window.ConfigManager && typeof window.ConfigManager.get === 'function') {
          sig = await window.ConfigManager.get('xb.friendsCircle.userSignature');
        } else if (window.BridgeAPI && window.BridgeAPI.configManager) {
          sig = await window.BridgeAPI.configManager.getVar('xb.friendsCircle.userSignature');
        }
        return sig || '这个人很懒，什么都没写~';
      } catch (e) {
        return '这个人很懒，什么都没写~';
      }
    }

    /**
     * 设置用户签名（写入变量）
     * @param {string} signature - 新签名
     */
    async setUserSignature(signature) {
      try {
        if (window.ConfigManager && typeof window.ConfigManager.set === 'function') {
          await window.ConfigManager.set('xb.friendsCircle.userSignature', signature);
        } else if (window.BridgeAPI && window.BridgeAPI.configManager) {
          await window.BridgeAPI.configManager.setVar('xb.friendsCircle.userSignature', signature);
        }
      } catch (e) {
        console.error('[Friends Circle] 设置用户签名失败:', e);
      }
    }

    /**
     * 获取聊天内容（从变量读取，变量驱动模式下不再从聊天消息获取）
     * @returns {Promise<string>} JSON 字符串
     */
    async getChatContent() {
      try {
        var raw = null;
        if (window.ConfigManager && typeof window.ConfigManager.get === 'function') {
          raw = await window.ConfigManager.get('xb.friendsCircle.circles');
        } else if (window.BridgeAPI && window.BridgeAPI.configManager) {
          raw = await window.BridgeAPI.configManager.getVar('xb.friendsCircle.circles');
        }
        if (raw) {
          return (typeof raw === 'string') ? raw : JSON.stringify(raw);
        }
        return '[]';
      } catch (e) {
        console.error('[Friends Circle] 读取变量失败:', e);
        return '[]';
      }
    }

    /**
     * 刷新朋友圈数据（从变量读取并更新内部数据）
     * @param {boolean} forceFullRefresh - 是否强制全量刷新（变量驱动模式下始终全量）
     */
    async refreshData(forceFullRefresh) {
      try {
        var raw = null;
        if (window.ConfigManager && typeof window.ConfigManager.get === 'function') {
          raw = await window.ConfigManager.get('xb.friendsCircle.circles');
        } else if (window.BridgeAPI && window.BridgeAPI.configManager) {
          raw = await window.BridgeAPI.configManager.getVar('xb.friendsCircle.circles');
        }

        var circles = [];
        if (raw) {
          circles = (typeof raw === 'string') ? JSON.parse(raw) : raw;
          if (!Array.isArray(circles)) circles = [];
        }

        // 更新内部数据
        this.circlesData = circles;
        this.lastProcessedMessageIndex = circles.length;
        console.log('[Friends Circle] 从变量加载了', circles.length, '条朋友圈');
      } catch (e) {
        console.error('[Friends Circle] 刷新数据失败:', e);
      }
    }
  }

  /**
   * 朋友圈事件监听器
   * 复用live-app的智能检测机制
   */
  class FriendsCircleEventListener {
    constructor(friendsCircle) {
      this.friendsCircle = friendsCircle;
      this.isListening = false;
      this._variableChangedHandler = this._onVariableChanged.bind(this);
    }

    /**
     * 开始监听变量变更事件
     */
    startListening() {
      if (this.isListening) {
        console.log('[Friends Circle] 监听器已经在运行中');
        return;
      }

      this.isListening = true;

      // 监听 EventBus 的 variable:changed 事件
      if (window.EventBus) {
        window.EventBus.on('variable:changed', this._variableChangedHandler);
        console.log('[Friends Circle] 已注册 EventBus variable:changed 监听');
      } else {
        console.warn('[Friends Circle] EventBus 不可用，无法监听变量变更');
      }

      console.log('[Friends Circle] 事件监听器已启动（变量驱动模式）');
    }

    /**
     * 变量变更事件处理
     * @param {Object} eventData - 事件数据
     */
    async _onVariableChanged(eventData) {
      try {
        if (eventData && eventData.key === 'xb.friendsCircle.circles') {
          console.log('[Friends Circle] 检测到朋友圈变量变更');
          if (this.friendsCircle) {
            await this.friendsCircle.manager.refreshData(true);
            if (this.friendsCircle.isActive) {
              this.friendsCircle.updateDisplay();
            }
          }
        }
      } catch (error) {
        console.error('[Friends Circle] 处理变量变更事件失败:', error);
      }
    }

    /**
     * 停止监听
     */
    stopListening() {
      if (!this.isListening) return;

      try {
        // 移除 EventBus 监听
        if (window.EventBus) {
          window.EventBus.off('variable:changed', this._variableChangedHandler);
        }

        this.isListening = false;
        console.log('[Friends Circle] 已停止监听事件');
      } catch (error) {
        console.error('[Friends Circle] 停止监听失败:', error);
      }
    }
  }

  /**
   * 朋友圈UI渲染器
   * 负责朋友圈界面的渲染和交互
   */
  class FriendsCircleRenderer {
    constructor(friendsCircle) {
      this.friendsCircle = friendsCircle;
      this.publishModal = null;
    }

    /**
     * 渲染朋友圈页面
     * @returns {string} 朋友圈页面HTML
     */
    renderFriendsCirclePage() {
      const userInfo = this.renderUserInfo();
      const circlesList = this.renderCirclesList();

      return `
        <div class="friends-circle-page">
          <div class="friends-circle-content">
            ${userInfo}
            <div class="circles-container">
              ${circlesList}
            </div>
          </div>
        </div>
      `;
    }

    /**
     * 渲染用户信息区域
     * @returns {string} 用户信息HTML
     */
    renderUserInfo() {
      const userName = this.getCurrentUserName();
      const userAvatar = this.getCurrentUserAvatar();
      const userSignature = this.friendsCircle.userSignature || '这个人很懒，什么都没写~';

      return `
        <div class="user-info-section">
          <div class="user-cover">
            <div class="user-avatar">
              <img src="${userAvatar}" alt="${userName}" />
            </div>
            <div class="user-details">
              <div class="user-name">${userName}</div>
              <div class="user-signature" onclick="window.friendsCircle?.editUserSignature()">
                <span class="signature-text">${userSignature}</span>
                <i class="fas fa-edit signature-edit-icon"></i>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * 🌟 方案B+C：批量渲染朋友圈列表（懒加载）
     * @returns {string} 朋友圈列表HTML
     */
    renderCirclesList() {
      if (!this.friendsCircle.manager) {
        return '<div class="empty-circles"><i class="fas fa-heart"></i><span>暂无朋友圈</span></div>';
      }

      const circles = this.friendsCircle.manager.getSortedFriendsCircles();

      if (circles.length === 0) {
        return '<div class="empty-circles"><i class="fas fa-heart"></i><span>暂无朋友圈</span></div>';
      }

      // 🌟 方案B：同步批量获取基础信息，避免重复调用
      try {
        // 同步调用批量获取，如果缓存过期则更新
        this.friendsCircle.batchGetBasicInfo();
      } catch (error) {
        console.warn('[Friends Circle] 批量获取基础信息失败，使用降级处理:', error);
      }

      // 🌟 方案C：懒加载 - 只渲染前10条朋友圈
      const visibleCircles = circles.slice(0, 10);
      const remainingCount = circles.length - 10;

      let html = visibleCircles.map(circle => this.renderSingleCircle(circle)).join('');

      // 如果还有更多朋友圈，添加加载更多按钮
      if (remainingCount > 0) {
        html += `
          <div class="load-more-container" data-remaining="${remainingCount}" style="text-align: center; padding: 20px;">
            <button class="load-more-btn" onclick="window.friendsCircle.loadMoreCircles()"
                    style="background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-size: 14px;">
              <i class="fas fa-chevron-down" style="margin-right: 5px;"></i>
              加载更多 (还有${remainingCount}条)
            </button>
          </div>
        `;
      }

      return html;
    }

    /**
     * 渲染单个朋友圈
     * @param {Object} circle - 朋友圈数据
     * @returns {string} 单个朋友圈HTML
     */
    renderSingleCircle(circle) {
      // 🌟 方案B：使用批量缓存的信息，避免重复调用
      let friendAvatar;
      const cache = this.friendsCircle.batchCache;
      const currentUserName = cache.userName || this.getCurrentUserName();

      if (circle.author === currentUserName || circle.friendId === '483920') {
        // 用户自己的朋友圈，使用缓存的用户头像
        friendAvatar = cache.userAvatar || this.getCurrentUserAvatar();
      } else {
        // 其他好友的朋友圈，使用缓存的好友头像
        friendAvatar = cache.friendAvatars.get(circle.friendId) || this.getFriendAvatar(circle.friendId);
      }

      const timeStr = this.formatTime(circle.timestamp || 0);
      const contentHtml = this.renderCircleContent(circle);
      const repliesHtml = this.renderCircleReplies(circle.replies, circle.id);
      const actionsHtml = this.renderCircleActions(circle);

      return `
        <div class="circle-item" data-circle-id="${circle.id}">
          <div class="circle-header">
            <div class="friend-avatar">
              <img src="${friendAvatar}" alt="${circle.author}" />
            </div>
            <div class="friend-info">
              <div class="friend-name">${circle.author}</div>
              <div class="circle-time">${timeStr}</div>
            </div>
          </div>

          <div class="circle-content">
            ${contentHtml}
          </div>

          <div class="circle-actions">
            ${actionsHtml}
          </div>

          ${repliesHtml}

          <div class="reply-input-container" id="reply-input-${circle.id}" style="display: none;">
            <input type="text" class="reply-input" placeholder="写下你的想法..." />
            <button class="reply-send-btn" onclick="window.friendsCircle?.sendCircleReply('${circle.id}')">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      `;
    }

    /**
     * 渲染朋友圈内容
     * @param {Object} circle - 朋友圈数据
     * @returns {string} 朋友圈内容HTML
     */
    renderCircleContent(circle) {
      if (circle.type === 'visual') {
        // 检查是否有真实图片URL
        const hasRealImage = circle.imageUrl && circle.imageUrl.trim();

        let imageHtml;
        if (hasRealImage) {
          // 显示真实图片
          imageHtml = `
            <div class="circle-image-container">
              <img src="${circle.imageUrl}"
                   alt="${circle.imageDescription || '朋友圈图片'}"
                   class="circle-image"
                   onclick="this.style.transform=this.style.transform?'':'scale(2)'; setTimeout(()=>this.style.transform='', 3000);"
                   loading="lazy"
                   onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'><i class=\\'fas fa-image\\'></i><span class=\\'image-description\\'>${
                     circle.imageDescription || '图片加载失败'
                   }</span></div>'">
            </div>
          `;
        } else {
          // 显示占位符
          imageHtml = `
            <div class="image-placeholder">
              <i class="fas fa-image"></i>
              <span class="image-description">${circle.imageDescription || '图片描述缺失'}</span>
            </div>
          `;
        }

        const visualHtml = `
          <div class="visual-circle-content">
            ${circle.content ? `<div class="text-content">${circle.content}</div>` : ''}
            ${imageHtml}
          </div>
        `;
        return visualHtml;
      } else {
        const textHtml = `<div class="text-circle-content">${circle.content}</div>`;
        return textHtml;
      }
    }

    /**
     * 渲染朋友圈操作按钮
     * @param {Object} circle - 朋友圈数据
     * @returns {string} 操作按钮HTML
     */
    renderCircleActions(circle) {
      const likeIcon = circle.isLiked ? 'fas fa-heart liked' : 'far fa-heart';
      const likeCount = Array.isArray(circle.likes) ? circle.likes.length : (circle.likes || 0);

      return `
        <div class="actions-bar">
          <button class="action-btn like-btn" onclick="window.friendsCircle?.toggleCircleLike('${circle.id}')">
            <i class="${likeIcon}"></i>
            <span class="like-count">${likeCount}</span>
          </button>
          <button class="action-btn reply-btn" onclick="window.friendsCircle?.toggleReplyInput('${circle.id}')">
            <i class="fas fa-comment"></i>
            <span>回复</span>
          </button>
        </div>
      `;
    }

    /**
     * 渲染朋友圈回复
     * @param {Array} replies - 回复数组
     * @param {string} circleId - 朋友圈ID
     * @returns {string} 回复HTML
     */
    renderCircleReplies(replies, circleId) {
      if (!replies || replies.length === 0) {
        return '';
      }

      const repliesHtml = replies
        .map(reply => {
          // 🔧 修复用户回复头像显示问题 + 使用批量缓存优化性能
          let replyAvatar;
          const cache = this.friendsCircle.batchCache;
          const currentUserName = cache.userName || this.getCurrentUserName();

          if (reply.author === currentUserName || reply.friendId === '483920') {
            // 用户自己的回复，使用缓存的用户头像
            replyAvatar = cache.userAvatar || this.getCurrentUserAvatar();
          } else {
            // 其他好友的回复，使用缓存的好友头像
            replyAvatar = cache.friendAvatars.get(reply.friendId) || this.getFriendAvatar(reply.friendId);
          }

          const timeStr = this.formatTime(reply.timestamp || 0);

          return `
          <div class="circle-reply" data-reply-id="${reply.id}" data-reply-author="${reply.author}">
            <div class="reply-avatar">
              <img src="${replyAvatar}" alt="${reply.author}" />
            </div>
            <div class="reply-content">
              <div class="reply-header">
                <span class="reply-author">${reply.author}</span>
                <span class="reply-time">${timeStr}</span>
                <button class="reply-to-comment-btn" onclick="window.friendsCircle?.showReplyToComment('${circleId}', '${reply.id}', '${reply.author}')">
                  <i class="fas fa-reply"></i>
                </button>
              </div>
              <div class="reply-text">${reply.content}</div>
            </div>
          </div>
        `;
        })
        .join('');

      return `
        <div class="replies-section">
          <div class="replies-list">
            ${repliesHtml}
          </div>
        </div>
      `;
    }

    /**
     * 获取好友头像
     * @param {string} friendId - 好友ID
     * @returns {string} 头像URL
     */
    getFriendAvatar(friendId) {
      // 尝试从StyleConfigManager获取头像配置
      if (window.styleConfigManager) {
        try {
          const config = window.styleConfigManager.getConfig();
          if (config && config.messageReceivedAvatars) {
            // 查找匹配的好友头像配置
            const avatarConfig = config.messageReceivedAvatars.find(avatar => avatar.friendId === friendId);

            if (avatarConfig) {
              const imageUrl = avatarConfig.backgroundImage || avatarConfig.backgroundImageUrl;
              if (imageUrl) {
                return imageUrl;
              }
            }
          }
        } catch (error) {
          console.warn('[Friends Circle] 获取头像配置失败:', error);
        }
      }

      // 备用方案：使用默认头像
      return this.getDefaultAvatar(friendId);
    }

    /**
     * 获取默认头像
     * @param {string} friendId - 好友ID
     * @returns {string} 默认头像URL
     */
    getDefaultAvatar(friendId) {
      // 根据好友ID生成不同颜色的默认头像
      const colors = [
        '#FF6B9D',
        '#4ECDC4',
        '#45B7D1',
        '#96CEB4',
        '#FFEAA7',
        '#DDA0DD',
        '#98D8C8',
        '#F7DC6F',
        '#BB8FCE',
        '#85C1E9',
      ];

      const colorIndex = friendId
        ? friendId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length
        : 0;
      const color = colors[colorIndex];

      // 生成SVG头像
      const svg = `
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="20" fill="${color}"/>
          <circle cx="20" cy="16" r="6" fill="white" opacity="0.9"/>
          <path d="M10 32C10 26.4771 14.4771 22 19 22H21C25.5229 22 30 26.4771 30 32V34H10V32Z" fill="white" opacity="0.9"/>
        </svg>
      `;

      return 'data:image/svg+xml;base64,' + btoa(svg);
    }

    /**
     * 获取当前用户信息
     * @returns {string} 用户名
     */
    getCurrentUserName() {
      try {
        // 方法1: 尝试从SillyTavern的persona系统获取当前选中的用户角色名称
        const selectedPersona = this.getSelectedPersonaName();
        if (selectedPersona && selectedPersona !== '{{user}}' && selectedPersona !== 'User') {
          return selectedPersona;
        }

        // 方法2: 从SillyTavern的全局变量获取
        if (typeof window.name1 !== 'undefined' && window.name1 && window.name1.trim() && window.name1 !== '{{user}}') {
          return window.name1.trim();
        }

        // 方法3: 从power_user获取
        if (
          window.power_user &&
          window.power_user.name &&
          window.power_user.name.trim() &&
          window.power_user.name !== '{{user}}'
        ) {
          console.log('[Friends Circle] 从power_user获取用户名:', window.power_user.name);
          return window.power_user.name.trim();
        }

        // 方法4: 从SillyTavern的getContext获取
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
          const context = window.SillyTavern.getContext();
          if (context && context.name1 && context.name1.trim() && context.name1 !== '{{user}}') {
            console.log('[Friends Circle] 从SillyTavern context获取用户名:', context.name1);
            return context.name1.trim();
          }
        }

        // 方法5: 从localStorage获取
        const storedName = localStorage.getItem('name1');
        if (storedName && storedName.trim() && storedName !== '{{user}}') {
          console.log('[Friends Circle] 从localStorage获取用户名:', storedName);
          return storedName.trim();
        }

        console.log('[Friends Circle] 所有方法都未能获取到有效用户名，使用默认值');
        console.log('[Friends Circle] 调试信息:');
        console.log('- window.name1:', window.name1);
        console.log('- window.power_user:', window.power_user);
        console.log('- localStorage name1:', localStorage.getItem('name1'));
      } catch (error) {
        console.warn('[Friends Circle] 获取用户名失败:', error);
      }

      return '我';
    }

    /**
     * 获取当前选中的persona名称
     * @returns {string|null} persona名称
     */
    getSelectedPersonaName() {
      try {
        console.log('[Friends Circle] 尝试获取选中的persona名称...');

        // 方法1: 从DOM中查找选中的persona
        const selectedPersonaElement = document.querySelector('#user_avatar_block .avatar-container.selected .ch_name');
        if (selectedPersonaElement) {
          const personaName = selectedPersonaElement.textContent?.trim();
          if (personaName && personaName !== '{{user}}' && personaName !== 'User') {
            console.log('[Friends Circle] 从DOM获取选中persona名称:', personaName);
            return personaName;
          }
        }

        // 方法2: 从SillyTavern的全局变量获取当前persona
        if (window.user_avatar && window.user_avatar.name) {
          const personaName = window.user_avatar.name.trim();
          if (personaName && personaName !== '{{user}}' && personaName !== 'User') {
            console.log('[Friends Circle] 从user_avatar获取persona名称:', personaName);
            return personaName;
          }
        }

        // 方法3: 从power_user的persona设置获取
        if (window.power_user && window.power_user.persona_description) {
          // 尝试从persona描述中提取名称（通常在开头）
          const personaDesc = window.power_user.persona_description;
          const nameMatch = personaDesc.match(/^([^\n\r]+)/);
          if (nameMatch) {
            const personaName = nameMatch[1].trim();
            if (personaName && personaName !== '{{user}}' && personaName !== 'User') {
              console.log('[Friends Circle] 从persona描述获取名称:', personaName);
              return personaName;
            }
          }
        }

        // 方法4: 尝试从其他可能的全局变量获取
        const possibleVars = ['persona_name', 'current_persona', 'selected_persona'];
        for (const varName of possibleVars) {
          if (window[varName] && typeof window[varName] === 'string') {
            const personaName = window[varName].trim();
            if (personaName && personaName !== '{{user}}' && personaName !== 'User') {
              console.log(`[Friends Circle] 从${varName}获取persona名称:`, personaName);
              return personaName;
            }
          }
        }

        // 方法5: 尝试其他DOM选择器
        const alternativeSelectors = [
          '.avatar-container.selected .character_name_block .ch_name',
          '.avatar-container.selected span.ch_name',
          '#user_avatar_block .selected .ch_name',
          '.persona_management_left_column .selected .ch_name',
        ];

        for (const selector of alternativeSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const personaName = element.textContent?.trim();
            if (personaName && personaName !== '{{user}}' && personaName !== 'User') {
              console.log(`[Friends Circle] 从DOM选择器 ${selector} 获取persona名称:`, personaName);
              return personaName;
            }
          }
        }

        // 方法6: 尝试从SillyTavern的personas数组获取
        if (window.personas && Array.isArray(window.personas)) {
          const selectedPersona = window.personas.find(p => p.selected || p.active);
          if (selectedPersona && selectedPersona.name) {
            const personaName = selectedPersona.name.trim();
            if (personaName && personaName !== '{{user}}' && personaName !== 'User') {
              console.log('[Friends Circle] 从personas数组获取persona名称:', personaName);
              return personaName;
            }
          }
        }

        console.log('[Friends Circle] 未能从任何来源获取到有效的persona名称');
        console.log('[Friends Circle] 调试信息:');
        console.log('- DOM选中元素:', document.querySelector('#user_avatar_block .avatar-container.selected'));
        console.log('- window.user_avatar:', window.user_avatar);
        console.log('- window.personas:', window.personas);
        console.log('- window.power_user.persona_description:', window.power_user?.persona_description);

        return null;
      } catch (error) {
        console.warn('[Friends Circle] 获取persona名称失败:', error);
        return null;
      }
    }

    /**
     * 调试函数：测试所有可能的用户名获取方法
     * 在浏览器控制台中调用 window.friendsCircle.debugUserNameMethods() 来测试
     */
    debugUserNameMethods() {
      console.log('=== 调试用户名获取方法 ===');

      // 测试DOM方法
      console.log('\n1. DOM方法测试:');
      const domSelectors = [
        '#user_avatar_block .avatar-container.selected .ch_name',
        '.avatar-container.selected .character_name_block .ch_name',
        '.avatar-container.selected span.ch_name',
        '#user_avatar_block .selected .ch_name',
        '.persona_management_left_column .selected .ch_name',
      ];

      domSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        console.log(`  ${selector}:`, element ? element.textContent?.trim() : 'null');
      });

      // 测试全局变量
      console.log('\n2. 全局变量测试:');
      const globalVars = ['name1', 'user_name', 'persona_name', 'current_persona', 'selected_persona', 'user_persona'];

      globalVars.forEach(varName => {
        console.log(`  window.${varName}:`, window[varName]);
      });

      // 测试对象属性
      console.log('\n3. 对象属性测试:');
      console.log('  window.power_user:', window.power_user);
      console.log('  window.user_avatar:', window.user_avatar);
      console.log('  window.personas:', window.personas);

      // 测试SillyTavern context
      console.log('\n4. SillyTavern Context测试:');
      if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
        const context = window.SillyTavern.getContext();
        console.log('  SillyTavern context:', context);
        console.log('  context.name1:', context?.name1);
      } else {
        console.log('  SillyTavern.getContext 不可用');
      }

      // 测试localStorage
      console.log('\n5. LocalStorage测试:');
      console.log('  localStorage.name1:', localStorage.getItem('name1'));
      console.log('  localStorage.persona_name:', localStorage.getItem('persona_name'));

      console.log('\n=== 调试完成 ===');

      // 测试当前实际获取的用户名
      console.log('\n6. 当前获取结果:');
      console.log('  getCurrentUserName():', this.getCurrentUserName());
      console.log('  getSelectedPersonaName():', this.getSelectedPersonaName());
    }

    /**
     * 获取当前用户头像
     * @returns {string} 用户头像URL
     */
    getCurrentUserAvatar() {
      // 尝试从StyleConfigManager获取用户头像配置
      if (window.styleConfigManager) {
        try {
          const config = window.styleConfigManager.getConfig();
          if (config && config.messageSentAvatar) {
            const imageUrl = config.messageSentAvatar.backgroundImage || config.messageSentAvatar.backgroundImageUrl;
            if (imageUrl) {
              return imageUrl;
            }
          }
        } catch (error) {
          console.warn('[Friends Circle] 获取用户头像配置失败:', error);
        }
      }

      // 备用方案：使用默认用户头像
      const svg = `
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="20" fill="#74B9FF"/>
          <circle cx="20" cy="16" r="6" fill="white" opacity="0.9"/>
          <path d="M10 32C10 26.4771 14.4771 22 19 22H21C25.5229 22 30 26.4771 30 32V34H10V32Z" fill="white" opacity="0.9"/>
        </svg>
      `;

      return 'data:image/svg+xml;base64,' + btoa(svg);
    }

    /**
     * 格式化时间（基于时间戳显示相对时间）
     * @param {number} timestamp - 时间戳（毫秒）
     * @returns {string} 格式化后的时间
     */
    formatTime(timestamp) {
      if (!timestamp || timestamp <= 0) {
        return '刚刚';
      }

      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) {
        return '刚刚';
      } else if (diffMins < 60) {
        return `${diffMins}分钟前`;
      } else if (diffMins < 1440) {
        const diffHours = Math.floor(diffMins / 60);
        return `${diffHours}小时前`;
      } else if (diffMins < 2880) {
        return '昨天';
      } else if (diffMins < 10080) {
        const diffDays = Math.floor(diffMins / 1440);
        return `${diffDays}天前`;
      } else {
        // 超过一周，显示具体日期
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${month}月${day}日`;
      }
    }

    /**
     * 显示发布选择弹窗
     */
    showPublishModal() {
      if (this.publishModal) {
        this.publishModal.remove();
      }

      this.publishModal = document.createElement('div');
      this.publishModal.className = 'friends-circle-publish-modal';
      this.publishModal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h3>发布朋友圈</h3>
            <button class="modal-close">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="publish-options">
            <button class="publish-option-btn text-btn">
              <i class="fas fa-font"></i>
              <span>发文字</span>
            </button>
            <button class="publish-option-btn image-btn">
              <i class="fas fa-image"></i>
              <span>发图片</span>
            </button>
          </div>
        </div>
      `;

      // 查找元素
      const overlay = this.publishModal.querySelector('.modal-overlay');
      const closeBtn = this.publishModal.querySelector('.modal-close');
      const textBtn = this.publishModal.querySelector('.text-btn');
      const imageBtn = this.publishModal.querySelector('.image-btn');

      console.log('[Friends Circle Debug] 元素查找结果:', {
        overlay: !!overlay,
        closeBtn: !!closeBtn,
        textBtn: !!textBtn,
        imageBtn: !!imageBtn,
      });

      // 绑定事件
      if (overlay) {
        overlay.addEventListener('click', () => {
          console.log('[Friends Circle Debug] 点击了遮罩层');
          this.hidePublishModal();
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          console.log('[Friends Circle Debug] 点击了关闭按钮');
          this.hidePublishModal();
        });
      }

      if (textBtn) {
        textBtn.addEventListener('click', () => {
          console.log('[Friends Circle Debug] 点击了发文字按钮');
          this.showTextPublishModal();
        });
      }

      if (imageBtn) {
        imageBtn.addEventListener('click', () => {
          console.log('[Friends Circle Debug] 点击了发图片按钮');
          this.showImagePublishModal();
        });
      }

      // 使用手机容器定位
      const mobileContainer = document.querySelector('.mobile-phone-container');
      console.log('[Friends Circle Debug] 手机容器查找结果:', !!mobileContainer);

      if (mobileContainer) {
        mobileContainer.appendChild(this.publishModal);
        console.log('[Friends Circle Debug] 弹窗已添加到手机容器');
      } else {
        document.body.appendChild(this.publishModal);
        console.log('[Friends Circle Debug] 弹窗已添加到body');
      }

      // 检查弹窗是否可见
      setTimeout(() => {
        if (!this.publishModal) {
          console.log('[Friends Circle Debug] 弹窗已被移除，跳过调试');
          return;
        }

        const modalRect = this.publishModal.getBoundingClientRect();
        const modalStyle = window.getComputedStyle(this.publishModal);
        console.log('[Friends Circle Debug] 弹窗位置和大小:', modalRect);
        console.log('[Friends Circle Debug] 弹窗关键样式:', {
          display: modalStyle.display,
          position: modalStyle.position,
          zIndex: modalStyle.zIndex,
          visibility: modalStyle.visibility,
          opacity: modalStyle.opacity,
          pointerEvents: modalStyle.pointerEvents,
        });

        // 检查弹窗内部元素
        const overlay = this.publishModal.querySelector('.modal-overlay');
        const content = this.publishModal.querySelector('.modal-content');
        const buttons = this.publishModal.querySelectorAll('button');

        console.log('[Friends Circle Debug] 弹窗内部元素:', {
          overlay: !!overlay,
          overlayRect: overlay?.getBoundingClientRect(),
          content: !!content,
          contentRect: content?.getBoundingClientRect(),
          buttonsCount: buttons.length,
        });

        // 测试点击事件
        buttons.forEach((btn, index) => {
          console.log(`[Friends Circle Debug] 按钮 ${index}:`, {
            className: btn.className,
            rect: btn.getBoundingClientRect(),
            style: {
              pointerEvents: window.getComputedStyle(btn).pointerEvents,
              zIndex: window.getComputedStyle(btn).zIndex,
            },
          });
        });
      }, 100);

      console.log('[Friends Circle Debug] 发布弹窗显示完成');
    }

    /**
     * 隐藏发布弹窗
     */
    hidePublishModal() {
      if (this.publishModal) {
        this.publishModal.remove();
        this.publishModal = null;
      }
    }

    /**
     * 显示文字发布弹窗
     */
    showTextPublishModal() {
      this.hidePublishModal();

      const modal = document.createElement('div');
      modal.className = 'friends-circle-text-publish-modal';
      modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h3>发布文字朋友圈</h3>
            <button class="modal-close">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <textarea class="text-input" placeholder="分享新鲜事..." maxlength="500"></textarea>
            <div class="char-count">0/500</div>
          </div>
          <div class="modal-footer">
            <button class="cancel-btn">取消</button>
            <button class="send-btn">发布</button>
          </div>
        </div>
      `;

      // 绑定事件
      const overlay = modal.querySelector('.modal-overlay');
      const closeBtn = modal.querySelector('.modal-close');
      const cancelBtn = modal.querySelector('.cancel-btn');
      const sendBtn = modal.querySelector('.send-btn');

      const closeModal = () => modal.remove();

      overlay.addEventListener('click', closeModal);
      closeBtn.addEventListener('click', closeModal);
      cancelBtn.addEventListener('click', closeModal);
      sendBtn.addEventListener('click', () => {
        console.log('[Friends Circle] 文字发布按钮被点击');
        console.log('[Friends Circle] this上下文检查:', {
          thisExists: !!this,
          thisConstructorName: this?.constructor?.name,
          hasHandleTextPublish: typeof this?.handleTextPublish === 'function',
        });

        if (this && typeof this.handleTextPublish === 'function') {
          this.handleTextPublish(modal);
        } else {
          console.error('[Friends Circle] handleTextPublish方法不存在或this上下文丢失');
          // 备用方案：直接处理文字发布
          const textInput = modal.querySelector('.text-input');
          if (textInput) {
            const content = textInput.value.trim();
            if (content) {
              // 直接调用全局朋友圈实例的方法
              if (window.friendsCircle && typeof window.friendsCircle.sendTextCircle === 'function') {
                window.friendsCircle.sendTextCircle(content);
                modal.remove();
              } else {
                console.error('[Friends Circle] 无法找到全局朋友圈实例');
              }
            }
          }
        }
      });

      // 使用手机容器定位
      const mobileContainer = document.querySelector('.mobile-phone-container');
      if (mobileContainer) {
        mobileContainer.appendChild(modal);
      } else {
        document.body.appendChild(modal);
      }

      // 绑定字数统计
      const textInput = modal.querySelector('.text-input');
      const charCount = modal.querySelector('.char-count');
      if (textInput && charCount) {
        textInput.addEventListener('input', () => {
          const count = textInput.value.length;
          charCount.textContent = `${count}/500`;
          if (count > 450) {
            charCount.style.color = '#ff6b9d';
          } else {
            charCount.style.color = '#999';
          }
        });
        textInput.focus();
      }

      console.log('[Friends Circle] 文字发布弹窗已显示，事件已绑定');
    }

    /**
     * 显示图片发布弹窗
     */
    showImagePublishModal() {
      this.hidePublishModal();

      const modal = document.createElement('div');
      modal.className = 'friends-circle-image-publish-modal';
      modal.innerHTML = `
        <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
        <div class="modal-content">
          <div class="modal-header">
            <h3>发布图片朋友圈</h3>
            <button class="modal-close" onclick="this.parentElement.parentElement.remove()">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>图片描述</label>
              <textarea class="image-desc-input" placeholder="描述图片内容..." maxlength="200"></textarea>
              <div class="char-count">0/200</div>
            </div>
            <div class="form-group">
              <label>配文（必填！！！）</label>
              <textarea class="text-input" placeholder="说点什么..." maxlength="300"></textarea>
              <div class="char-count">0/300</div>
            </div>
            <div class="form-group">
              <label>上传图片</label>
              <div class="attachment-upload-area">
                <div class="file-drop-zone" id="friends-circle-drop-zone">
                  <div class="drop-zone-content">
                    <i class="fas fa-image"></i>
                    <div class="upload-text">点击选择图片或拖拽图片到此处</div>
                    <div class="upload-hint">支持jpg、png、gif、webp等格式，最大10MB</div>
                  </div>
                  <input type="file" class="hidden-file-input" accept="image/*" id="friends-circle-file-input">
                </div>
                <div class="image-preview-area" id="friends-circle-preview-area" style="display: none;">
                  <div class="preview-image-container">
                    <img class="preview-image" alt="预览图片" id="friends-circle-preview-image">
                    <button class="remove-image-btn" id="friends-circle-remove-image">×</button>
                    <div class="image-info">
                      <span class="image-name" id="friends-circle-image-name"></span>
                      <span class="image-size" id="friends-circle-image-size"></span>
                    </div>
                  </div>
                </div>
                <div class="upload-status" id="friends-circle-upload-status" style="display: none;">
                  <div class="upload-progress">
                    <div class="progress-bar" id="friends-circle-progress-bar"></div>
                  </div>
                  <div class="upload-text" id="friends-circle-upload-text">上传中...</div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="cancel-btn" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
            <button class="send-btn" id="friends-circle-publish-btn">发布</button>
          </div>
        </div>
      `;

      // 使用手机容器定位
      const mobileContainer = document.querySelector('.mobile-phone-container');
      if (mobileContainer) {
        mobileContainer.appendChild(modal);
      } else {
        document.body.appendChild(modal);
      }

      // 绑定字数统计
      const imageDescInput = modal.querySelector('.image-desc-input');
      const textInput = modal.querySelector('.text-input');
      const charCounts = modal.querySelectorAll('.char-count');

      if (imageDescInput && charCounts[0]) {
        imageDescInput.addEventListener('input', () => {
          const count = imageDescInput.value.length;
          charCounts[0].textContent = `${count}/200`;
          if (count > 180) {
            charCounts[0].style.color = '#ff6b9d';
          } else {
            charCounts[0].style.color = '#999';
          }
        });
      }

      if (textInput && charCounts[1]) {
        textInput.addEventListener('input', () => {
          const count = textInput.value.length;
          charCounts[1].textContent = `${count}/300`;
          if (count > 270) {
            charCounts[1].style.color = '#ff6b9d';
          } else {
            charCounts[1].style.color = '#999';
          }
        });
      }

      // 绑定图片上传功能
      this.bindImageUploadEvents(modal);

      if (imageDescInput) {
        imageDescInput.focus();
      }
    }

    /**
     * 绑定图片上传相关事件
     */
    bindImageUploadEvents(modal) {
      const dropZone = modal.querySelector('#friends-circle-drop-zone');
      const fileInput = modal.querySelector('#friends-circle-file-input');
      const previewArea = modal.querySelector('#friends-circle-preview-area');
      const previewImage = modal.querySelector('#friends-circle-preview-image');
      const removeBtn = modal.querySelector('#friends-circle-remove-image');
      const imageName = modal.querySelector('#friends-circle-image-name');
      const imageSize = modal.querySelector('#friends-circle-image-size');
      const uploadStatus = modal.querySelector('#friends-circle-upload-status');
      const publishBtn = modal.querySelector('#friends-circle-publish-btn');

      if (!dropZone || !fileInput) {
        console.warn('[Friends Circle] 上传区域元素未找到');
        return;
      }

      // 点击上传区域触发文件选择
      dropZone.addEventListener('click', () => {
        fileInput.click();
      });

      // 文件选择事件
      fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
          this.handleImageFileSelection(file, {
            previewArea,
            previewImage,
            imageName,
            imageSize,
            uploadStatus,
            publishBtn,
            dropZone,
          });
        }
      });

      // 拖拽事件
      dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
          const file = files[0];
          this.handleImageFileSelection(file, {
            previewArea,
            previewImage,
            imageName,
            imageSize,
            uploadStatus,
            publishBtn,
            dropZone,
          });
        }
      });

      // 移除图片事件
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          this.clearImageSelection({
            previewArea,
            uploadStatus,
            publishBtn,
            dropZone,
            fileInput,
          });
        });
      }

      // 绑定发布按钮事件 - 使用全局引用确保正确调用
      if (publishBtn) {
        publishBtn.addEventListener('click', () => {
          console.log('[Friends Circle] 发布按钮被点击');
          console.log('[Friends Circle] 检查全局朋友圈实例:', !!window.friendsCircle);
          console.log('[Friends Circle] 检查handleImagePublish方法:', typeof window.friendsCircle?.handleImagePublish);

          if (window.friendsCircle && typeof window.friendsCircle.handleImagePublish === 'function') {
            window.friendsCircle.handleImagePublish();
          } else {
            console.error('[Friends Circle] 无法调用handleImagePublish方法');
          }
        });
        console.log('[Friends Circle] 发布按钮事件已绑定');
      } else {
        console.warn('[Friends Circle] 发布按钮未找到，无法绑定事件');
      }
    }

    /**
     * 处理图片文件选择
     */
    async handleImageFileSelection(file, elements) {
      console.log('[Friends Circle] 处理图片文件选择:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        elementsProvided: !!elements,
      });

      // 确保AttachmentSender可用
      if (!window.attachmentSender) {
        console.error('[Friends Circle] AttachmentSender未找到');
        this.showToast('图片上传功能未就绪', 'error');
        return;
      }

      // 验证文件
      console.log('[Friends Circle] 开始验证文件...');
      const validation = window.attachmentSender.validateFile(file);
      console.log('[Friends Circle] 文件验证结果:', validation);

      if (!validation.isValid) {
        console.warn('[Friends Circle] 文件验证失败:', validation.errors);
        this.showToast(validation.errors.join(', '), 'error');
        return;
      }

      console.log('[Friends Circle] 文件验证成功，开始显示预览...');

      // 显示预览
      this.showImagePreview(file, elements);

      // 存储文件信息供后续上传使用
      this.selectedImageFile = file;
      this.selectedImageElements = elements;

      console.log('[Friends Circle] 文件信息已存储:', {
        selectedImageFile: !!this.selectedImageFile,
        selectedImageFileName: this.selectedImageFile ? this.selectedImageFile.name : 'none',
        thisInstanceId: this.constructor.name,
        globalInstanceExists: !!window.friendsCircle,
        globalInstanceSame: window.friendsCircle === this,
      });

      // 同时存储到全局实例中，确保数据不丢失
      if (window.friendsCircle && window.friendsCircle !== this) {
        console.warn('[Friends Circle] 检测到不同的实例，同步文件信息到全局实例');
        window.friendsCircle.selectedImageFile = file;
        window.friendsCircle.selectedImageElements = elements;
      }

      // 更新发布按钮状态
      if (elements.publishBtn) {
        elements.publishBtn.disabled = false;
        elements.publishBtn.textContent = '发布';
        console.log('[Friends Circle] 发布按钮已启用');
      } else {
        console.warn('[Friends Circle] 发布按钮未找到');
      }

      console.log('[Friends Circle] 图片文件选择处理完成');
    }

    /**
     * 显示图片预览
     */
    showImagePreview(file, elements) {
      console.log('[Friends Circle] 开始显示图片预览:', file.name);

      const { previewArea, previewImage, imageName, imageSize, dropZone } = elements;

      console.log('[Friends Circle] 预览元素检查:', {
        previewArea: !!previewArea,
        previewImage: !!previewImage,
        imageName: !!imageName,
        imageSize: !!imageSize,
        dropZone: !!dropZone,
      });

      if (!previewArea || !previewImage) {
        console.warn('[Friends Circle] 预览区域或预览图片元素未找到');
        return;
      }

      // 创建预览URL
      const previewUrl = URL.createObjectURL(file);
      console.log('[Friends Circle] 创建预览URL:', previewUrl);

      // 设置预览图片
      previewImage.src = previewUrl;
      previewImage.onload = () => {
        console.log('[Friends Circle] 预览图片加载完成');
        URL.revokeObjectURL(previewUrl); // 释放内存
      };

      // 设置文件信息
      if (imageName) {
        imageName.textContent = file.name;
        console.log('[Friends Circle] 设置文件名:', file.name);
      }
      if (imageSize) {
        const sizeText = this.formatFileSize(file.size);
        imageSize.textContent = sizeText;
        console.log('[Friends Circle] 设置文件大小:', sizeText);
      }

      // 显示预览区域，隐藏上传区域
      previewArea.style.display = 'block';
      if (dropZone) {
        dropZone.style.display = 'none';
      }

      console.log('[Friends Circle] 图片预览显示完成');
    }

    /**
     * 清除图片选择
     */
    clearImageSelection(elements) {
      const { previewArea, uploadStatus, publishBtn, dropZone, fileInput } = elements;

      // 隐藏预览和上传状态
      if (previewArea) previewArea.style.display = 'none';
      if (uploadStatus) uploadStatus.style.display = 'none';

      // 显示上传区域
      if (dropZone) dropZone.style.display = 'block';

      // 清除文件输入
      if (fileInput) fileInput.value = '';

      // 重置按钮状态
      if (publishBtn) {
        publishBtn.disabled = false;
        publishBtn.textContent = '发布';
      }

      // 清除存储的文件
      this.selectedImageFile = null;
      this.selectedImageElements = null;
    }

    /**
     * 格式化文件大小
     */
    formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
  }

  /**
   * 朋友圈主类
   * 整合所有朋友圈功能
   */
  class FriendsCircle {
    constructor() {
      this.manager = new FriendsCircleManager();
      this.eventListener = new FriendsCircleEventListener(this);
      this.renderer = new FriendsCircleRenderer(this);
      this.isActive = false;

      // 🌟 方案B：批量处理缓存
      this.batchCache = {
        userName: null,
        userAvatar: null,
        friendAvatars: new Map(),
        lastCacheTime: 0,
        cacheTimeout: 30000, // 30秒缓存过期
      };
      this.userSignature = '这个人很懒，什么都没留下';

      // 初始化AttachmentSender用于图片上传
      this.initializeAttachmentSender();

      // 存储选中的图片文件信息
      this.selectedImageFile = null;
      this.selectedImageElements = null;

      console.log('[Friends Circle] 朋友圈功能初始化完成');
    }

    /**
     * 🌟 方案B：批量获取基础信息
     * 一次性获取用户名、用户头像和所有好友头像，避免重复调用
     */
    batchGetBasicInfo() {
      const now = Date.now();

      // 检查缓存是否过期
      if (this.batchCache.lastCacheTime && now - this.batchCache.lastCacheTime < this.batchCache.cacheTimeout) {
        return this.batchCache;
      }

      try {
        // 批量获取用户信息
        if (!this.batchCache.userName) {
          this.batchCache.userName = this.renderer.getCurrentUserName();
        }
        if (!this.batchCache.userAvatar) {
          this.batchCache.userAvatar = this.renderer.getCurrentUserAvatar();
        }

        // 批量获取好友头像（从现有朋友圈数据中提取好友ID）
        const friendIds = new Set();
        const circles = this.manager.circlesData || [];
        for (const circle of circles) {
          if (circle.friendId && circle.friendId !== '483920') {
            // 排除用户自己的ID
            friendIds.add(circle.friendId);
          }
        }

        // 批量获取所有好友头像
        for (const friendId of friendIds) {
          if (!this.batchCache.friendAvatars.has(friendId)) {
            const avatar = this.renderer.getFriendAvatar(friendId);
            if (avatar) {
              this.batchCache.friendAvatars.set(friendId, avatar);
            }
          }
        }

        this.batchCache.lastCacheTime = now;
        return this.batchCache;
      } catch (error) {
        console.error('[Friends Circle] 批量获取基础信息失败:', error);
        // 返回当前缓存状态，即使部分失败也能继续工作
        return this.batchCache;
      }
    }

    /**
     * 🌟 方案B：清空缓存（用户切换角色时调用）
     */
    clearBatchCache() {
      this.batchCache.userName = null;
      this.batchCache.userAvatar = null;
      this.batchCache.friendAvatars.clear();
      this.batchCache.lastCacheTime = 0;
    }

    /**
     * 🌟 方案C：加载更多朋友圈（懒加载）
     */
    loadMoreCircles() {
      try {
        const loadMoreContainer = document.querySelector('.load-more-container');
        if (!loadMoreContainer) return;

        const remaining = parseInt(loadMoreContainer.dataset.remaining) || 0;
        if (remaining <= 0) return;

        const circlesContainer = document.querySelector('.circles-container');
        if (!circlesContainer) return;

        // 获取所有朋友圈数据
        const allCircles = this.manager.getSortedFriendsCircles();
        const currentCount = circlesContainer.querySelectorAll('.circle-item').length; // 当前已显示的朋友圈数量

        // 加载下一批（最多10条）
        const nextBatch = allCircles.slice(currentCount, currentCount + 10);
        const newRemaining = remaining - nextBatch.length;

        // 渲染新的朋友圈
        const newHtml = nextBatch.map(circle => this.renderer.renderSingleCircle(circle)).join('');

        // 插入到加载更多按钮之前
        loadMoreContainer.insertAdjacentHTML('beforebegin', newHtml);

        // 更新或移除加载更多按钮
        if (newRemaining > 0) {
          loadMoreContainer.dataset.remaining = newRemaining;
          loadMoreContainer.querySelector('.load-more-btn').innerHTML = `
            <i class="fas fa-chevron-down"></i>
            加载更多 (还有${newRemaining}条)
          `;
        } else {
          loadMoreContainer.remove();
        }
      } catch (error) {
        console.error('[Friends Circle] 加载更多朋友圈失败:', error);
      }
    }

    /**
     * 获取当前用户名
     * @returns {string} 用户名
     */
    getCurrentUserName() {
      // 委托给renderer的方法
      if (this.renderer && typeof this.renderer.getCurrentUserName === 'function') {
        return this.renderer.getCurrentUserName();
      }

      // 备用方案：直接获取
      try {
        // 方法1: 从persona系统获取
        if (typeof getSelectedPersona === 'function') {
          const persona = getSelectedPersona();
          if (persona && persona.name && persona.name.trim() && persona.name !== '{{user}}') {
            return persona.name.trim();
          }
        }

        // 方法2: 从DOM获取选中的persona名称
        const personaSelect = document.querySelector('#persona-management-block .persona_name_block .menu_button');
        if (
          personaSelect &&
          personaSelect.textContent &&
          personaSelect.textContent.trim() &&
          personaSelect.textContent.trim() !== '{{user}}'
        ) {
          return personaSelect.textContent.trim();
        }

        // 方法3: 从SillyTavern的全局变量获取
        if (typeof window.name1 !== 'undefined' && window.name1 && window.name1.trim() && window.name1 !== '{{user}}') {
          return window.name1.trim();
        }
      } catch (error) {
        console.warn('[Friends Circle] 获取用户名失败:', error);
      }

      // 默认返回
      return '用户';
    }

    /**
     * 初始化AttachmentSender
     */
    initializeAttachmentSender() {
      try {
        if (window.attachmentSender) {
          // 设置朋友圈为当前聊天对象
          window.attachmentSender.setCurrentChat('friends_circle', '朋友圈', false);
          console.log('[Friends Circle] AttachmentSender已配置为朋友圈模式');
        } else {
          console.warn('[Friends Circle] AttachmentSender未找到，图片上传功能可能不可用');
        }
      } catch (error) {
        console.error('[Friends Circle] 初始化AttachmentSender失败:', error);
      }
    }

    /**
     * 激活朋友圈功能
     */
    activate() {
      console.log('[Friends Circle] 开始激活朋友圈功能...');

      this.isActive = true;
      console.log('[Friends Circle] 朋友圈状态已设置为激活');

      // 启动事件监听器
      if (this.eventListener) {
        this.eventListener.startListening();
        console.log('[Friends Circle] 事件监听器已启动');
      } else {
        console.error('[Friends Circle] 事件监听器不存在！');
      }

      // 确保header正确显示
      this.updateHeader();

      // 刷新朋友圈数据
      this.refreshFriendsCircle();
      console.log('[Friends Circle] 朋友圈功能激活完成');
    }

    /**
     * 停用朋友圈功能
     */
    deactivate() {
      this.isActive = false;
      this.eventListener.stopListening();
      console.log('[Friends Circle] 朋友圈功能已停用');
    }

    /**
     * 更新朋友圈header
     */
    updateHeader() {
      console.log('[Friends Circle] 更新朋友圈header...');

      // 通知主框架更新应用状态
      if (window.mobilePhone) {
        const friendsCircleState = {
          app: 'messages',
          view: 'friendsCircle',
          title: '朋友圈',
          showBackButton: false,
          showAddButton: true,
          addButtonIcon: 'fas fa-plus',
          addButtonAction: () => {
            if (window.friendsCircle) {
              window.friendsCircle.showPublishModal();
            }
          },
        };

        window.mobilePhone.currentAppState = friendsCircleState;
        window.mobilePhone.updateAppHeader(friendsCircleState);
        console.log('[Friends Circle] Header更新完成');
      } else {
        console.warn('[Friends Circle] mobilePhone不存在，无法更新header');
      }
    }

    /**
     * 刷新朋友圈数据
     */
    async refreshFriendsCircle() {
      try {
        console.log('[Friends Circle] 开始刷新朋友圈数据...');
        console.log('[Friends Circle] 当前激活状态:', this.isActive);

        // 从变量加载用户签名
        await this.getUserSignature();

        // 从变量刷新朋友圈数据
        await this.manager.refreshData(true);

        // 无论是否激活都尝试更新UI（如果页面存在的话）
        this.updateDisplay();
      } catch (error) {
        console.error('[Friends Circle] 刷新朋友圈数据失败:', error);
      }
    }

    /**
     * 更新朋友圈显示
     */
    updateDisplay() {
      try {
        console.log('[Friends Circle] 更新朋友圈显示...');

        // 直接重新渲染UI，不依赖事件系统
        var appContent = document.getElementById('app-content');
        if (appContent && this.renderer) {
          var fcPage = appContent.querySelector('.friends-circle-page');
          if (fcPage) {
            // 朋友圈页面已存在，更新内容
            var circlesContainer = fcPage.querySelector('.circles-container');
            if (circlesContainer && this.renderer.renderCirclesList) {
              circlesContainer.innerHTML = this.renderer.renderCirclesList();
              console.log('[Friends Circle] 直接更新了朋友圈列表内容');
            }
          }
        }

        // 同时触发事件作为备用通知
        this.dispatchUpdateEvent();

        console.log('[Friends Circle] 朋友圈显示更新完成');
      } catch (error) {
        console.error('[Friends Circle] 更新显示失败:', error);
      }
    }

    /**
     * 获取用户签名（从变量读取）
     * @returns {Promise<string>} 用户签名
     */
    async getUserSignature() {
      try {
        var sig = await this.manager.getUserSignature();
        this.userSignature = sig;
        return sig;
      } catch (e) {
        return this.userSignature || '这个人很懒，什么都没写~';
      }
    }

    /**
     * 设置用户签名（写入变量）
     * @param {string} signature - 新签名
     */
    async setUserSignature(signature) {
      this.userSignature = signature;
      await this.manager.setUserSignature(signature);
      this.dispatchUpdateEvent();
    }

    /**
     * 编辑用户签名
     */
    async editUserSignature() {
      const currentSig = this.userSignature || '这个人很懒，什么都没留下';
      const newSignature = prompt('请输入新的个性签名:', currentSig);
      if (newSignature !== null && newSignature.trim() !== '') {
        await this.setUserSignature(newSignature.trim());
      }
    }

    /**
     * 切换朋友圈点赞
     * @param {string} circleId - 朋友圈ID
     */
    async toggleCircleLike(circleId) {
      const likeData = await this.manager.toggleLike(circleId);

      // 直接更新DOM，避免重新渲染整个页面
      this.updateLikeButtonUI(circleId, likeData);

      // 不调用dispatchUpdateEvent()，避免页面重新加载
      console.log(
        `[Friends Circle] 点赞状态已更新: ${circleId}, 点赞数: ${likeData.likes}, 已点赞: ${likeData.isLiked}`,
      );
    }

    /**
     * 更新点赞按钮UI
     * @param {string} circleId - 朋友圈ID
     * @param {Object} likeData - 点赞数据
     */
    updateLikeButtonUI(circleId, likeData) {
      // 查找对应的点赞按钮
      const circleElement = document.querySelector(`[data-circle-id="${circleId}"]`);
      if (!circleElement) return;

      const likeBtn = circleElement.querySelector('.like-btn');
      const likeIcon = likeBtn?.querySelector('i');
      const likeCount = likeBtn?.querySelector('.like-count');

      if (likeBtn && likeIcon && likeCount) {
        // 更新图标
        if (likeData.isLiked) {
          likeIcon.className = 'fas fa-heart liked';
          likeBtn.classList.add('liked');

          // 添加点赞动画效果
          likeBtn.classList.add('liked-animation');
          setTimeout(() => {
            likeBtn.classList.remove('liked-animation');
          }, 300);
        } else {
          likeIcon.className = 'far fa-heart';
          likeBtn.classList.remove('liked');
        }

        // 更新点赞数
        likeCount.textContent = likeData.likes;
      }
    }

    /**
     * 切换回复输入框
     * @param {string} circleId - 朋友圈ID
     */
    toggleReplyInput(circleId) {
      const inputContainer = document.getElementById(`reply-input-${circleId}`);
      if (inputContainer) {
        const isVisible = inputContainer.style.display !== 'none';

        // 隐藏所有其他回复输入框
        document.querySelectorAll('.reply-input-container').forEach(container => {
          container.style.display = 'none';
        });

        // 切换当前输入框
        if (!isVisible) {
          inputContainer.style.display = 'flex';
          const input = inputContainer.querySelector('.reply-input');
          if (input) {
            input.focus();
          }
        }
      }
    }

    /**
     * 发送朋友圈回复
     * @param {string} circleId - 朋友圈ID
     */
    async sendCircleReply(circleId) {
      const inputContainer = document.getElementById(`reply-input-${circleId}`);
      if (!inputContainer) return;

      const input = inputContainer.querySelector('.reply-input');
      if (!input) return;

      const content = input.value.trim();
      if (!content) {
        alert('请输入回复内容');
        return;
      }

      try {
        // 检查是否是回复评论
        const replyToAuthor = input.dataset.replyToAuthor;

        if (replyToAuthor) {
          // 发送回复评论
          await this.sendReplyToComment(circleId, content, replyToAuthor);
        } else {
          // 构建回复数据
          const currentUserName = this.getCurrentUserName();
          const replyData = {
            id: `fc_reply_${Date.now()}`,
            author: currentUserName,
            friendId: '483920',
            content: content,
            timestamp: Date.now(),
          };

          // 添加回复到变量
          await this.manager.addReply(circleId, replyData);

          // 使用手机内部独立AI生成好友的响应回复
          const aiResult = await this.generateViaPhoneAI(
            `用户正在回复朋友圈（ID: ${circleId}）。请为用户的回复生成1-3个他人的响应回复，以JSON数组格式返回，每个元素包含 author, friendId, content 字段。只生成回复JSON数组，不要其他内容。`,
          );

          if (aiResult) {
            // 尝试解析AI返回的回复并添加到变量
            try {
              // 尝试提取JSON数组
              const jsonMatch = aiResult.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const aiReplies = JSON.parse(jsonMatch[0]);
                for (const reply of aiReplies) {
                  if (reply.author && reply.content) {
                    await this.manager.addReply(circleId, {
                      id: `fc_reply_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                      author: reply.author,
                      friendId: reply.friendId || '',
                      content: reply.content,
                      timestamp: Date.now(),
                    });
                  }
                }
              }
            } catch (parseError) {
              console.warn('[Friends Circle] 解析AI回复失败:', parseError);
            }

            this.showToast('回复已发送', 'success');
            this._notifySTFriendsCircleActivity('reply', currentUserName, content);
          } else {
            this.showToast('回复已发送', 'success');
          }

          // 刷新显示
          if (this.isActive) {
            await this.manager.refreshData(true);
            this.updateDisplay();
          }
        }

        // 清空输入框并隐藏
        input.value = '';
        input.placeholder = '写下你的想法...';
        input.removeAttribute('data-reply-to-author');
        input.removeAttribute('data-reply-to-id');
        inputContainer.style.display = 'none';
      } catch (error) {
        console.error('[Friends Circle] 发送回复失败:', error);
        this.showToast('发送失败，请重试', 'error');
      }
    }

    /**
     * 显示回复评论输入框
     * @param {string} circleId - 朋友圈ID
     * @param {string} replyId - 被回复的评论ID
     * @param {string} replyAuthor - 被回复的评论作者
     */
    showReplyToComment(circleId, replyId, replyAuthor) {
      // 隐藏所有其他回复输入框
      document.querySelectorAll('.reply-input-container').forEach(container => {
        container.style.display = 'none';
      });

      // 显示主回复输入框
      const inputContainer = document.getElementById(`reply-input-${circleId}`);
      if (inputContainer) {
        inputContainer.style.display = 'flex';
        const input = inputContainer.querySelector('.reply-input');
        if (input) {
          // 设置占位符提示回复对象
          input.placeholder = `回复 ${replyAuthor}...`;
          input.focus();

          // 存储回复目标信息
          input.dataset.replyToAuthor = replyAuthor;
          input.dataset.replyToId = replyId;
        }
      }
    }

    /**
     * 发送回复评论
     * @param {string} circleId - 朋友圈ID
     * @param {string} content - 回复内容
     * @param {string} replyToAuthor - 被回复的评论作者
     */
    async sendReplyToComment(circleId, content, replyToAuthor) {
      try {
        const currentUserName = this.getCurrentUserName();

        // 构建回复数据
        const replyData = {
          id: `fc_reply_${Date.now()}`,
          author: currentUserName,
          friendId: '483920',
          content: `回复${replyToAuthor}：${content}`,
          timestamp: Date.now(),
        };

        // 添加回复到变量
        await this.manager.addReply(circleId, replyData);

        // 使用手机内部独立AI生成好友的响应回复
        const aiResult = await this.generateViaPhoneAI(
          `用户正在回复朋友圈评论（ID: ${circleId}，回复${replyToAuthor}）。请为用户的回复生成1-3个他人的响应回复，以JSON数组格式返回，每个元素包含 author, friendId, content 字段。只生成回复JSON数组，不要其他内容。`,
        );

        if (aiResult) {
          try {
            const jsonMatch = aiResult.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const aiReplies = JSON.parse(jsonMatch[0]);
              for (const reply of aiReplies) {
                if (reply.author && reply.content) {
                  await this.manager.addReply(circleId, {
                    id: `fc_reply_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    author: reply.author,
                    friendId: reply.friendId || '',
                    content: reply.content,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          } catch (parseError) {
            console.warn('[Friends Circle] 解析AI回复失败:', parseError);
          }

          this.showToast('回复已发送', 'success');
          this._notifySTFriendsCircleActivity('reply', currentUserName, content);
        } else {
          this.showToast('回复已发送', 'success');
        }

        // 刷新显示
        if (this.isActive) {
          await this.manager.refreshData(true);
          this.updateDisplay();
        }
      } catch (error) {
        console.error('[Friends Circle] 发送回复评论失败:', error);
        this.showToast('发送失败，请重试', 'error');
      }
    }

    /**
     * 通过手机内部独立AI生成回复（不污染ST聊天上下文）
     * @param {string} message - 消息内容
     * @returns {Promise<string|null>} AI生成的回复文本，失败时返回null
     */
    async generateViaPhoneAI(message) {
      // 方法1：使用自定义API配置
      if (window.mobileCustomAPIConfig && window.mobileCustomAPIConfig.isAPIAvailable && window.mobileCustomAPIConfig.isAPIAvailable()) {
        try {
          const messages = [{ role: 'user', content: message }];
          const result = await window.mobileCustomAPIConfig.callAPI(messages, { temperature: 0.9, maxTokens: 300 });
          if (typeof result === 'string') return result;
          if (result && result.choices && result.choices[0]) return result.choices[0].message.content;
        } catch (e) {
          console.warn('[FriendsCircle] customAPI failed:', e);
        }
      }
      // 方法2：使用RoleAPI
      if (window.RoleAPI && window.RoleAPI.isEnabled && window.RoleAPI.isEnabled()) {
        try {
          const result = await window.RoleAPI.sendMessage('system', 'system', message, { skipHistory: true });
          if (result) return result;
        } catch (e) {
          console.warn('[FriendsCircle] RoleAPI failed:', e);
        }
      }
      // 方法3：使用XBBridge
      if (window.XBBridge && window.XBBridge.isAvailable && window.XBBridge.isAvailable()) {
        try {
          const result = await new Promise((resolve, reject) => {
            window.XBBridge.generate.generate({ prompt: message }, (response) => {
              resolve(response);
            }, (error) => {
              reject(error);
            });
          });
          if (result) return result;
        } catch (e) {
          console.warn('[FriendsCircle] XBBridge failed:', e);
        }
      }
      console.warn('[FriendsCircle] 所有AI后端不可用');
      return null;
    }

    /**
     * 通过小白X变量通知ST朋友圈动态（可选）
     * @param {string} type - 动态类型：'publish' 或 'reply'
     * @param {string} author - 作者名
     * @param {string} content - 简要内容
     */
    _notifySTFriendsCircleActivity(type, author, content) {
      try {
        if (window.BridgeAPI && window.BridgeAPI.configManager) {
          window.BridgeAPI.configManager.setVar('xb.phone.friendsCircle.lastActivity', JSON.stringify({
            type: type,
            author: author,
            content: content,
            timestamp: Date.now()
          }));
        }
      } catch (e) {
        console.warn('[FriendsCircle] 通知ST朋友圈动态失败:', e);
      }
    }

    /**
     * 显示提示消息
     * @param {string} message - 提示消息
     * @param {string} type - 消息类型
     */
    showToast(message, type = 'info') {
      if (window.showMobileToast) {
        window.showMobileToast(message, type);
      } else {
        alert(message);
      }
    }

    /**
     * 显示发布弹窗
     */
    showPublishModal() {
      if (this.renderer) {
        this.renderer.showPublishModal();
      }
    }

    /**
     * 隐藏发布弹窗
     */
    hidePublishModal() {
      if (this.renderer) {
        this.renderer.hidePublishModal();
      }
    }

    /**
     * 显示文字发布界面
     */
    showTextPublish() {
      if (this.renderer) {
        this.renderer.showTextPublishModal();
      }
    }

    /**
     * 显示文字发布弹窗
     */
    showTextPublishModal() {
      if (this.renderer) {
        this.renderer.showTextPublishModal();
      }
    }

    /**
     * 显示图片发布界面
     */
    showImagePublish() {
      if (this.renderer) {
        this.renderer.showImagePublishModal();
      }
    }

    /**
     * 显示图片发布弹窗
     */
    showImagePublishModal() {
      if (this.renderer) {
        this.renderer.showImagePublishModal();
      }
    }

    /**
     * 发送文字朋友圈
     * @param {string} content - 朋友圈内容
     */
    async sendTextCircle(content) {
      try {
        // 生成唯一ID
        const circleId = `fc_${Date.now()}`;

        const currentUserName = this.getCurrentUserName();
        const circleData = {
          id: circleId,
          author: currentUserName,
          friendId: '483920',
          type: 'text',
          content: content,
          timestamp: Date.now(),
          messageIndex: -1,
          latestActivityIndex: -1,
          replies: [],
          likes: [],
          isLiked: false,
        };

        // 添加到变量
        this.manager.circlesData.push(circleData);
        await this.manager._saveCirclesToVariable();

        console.log('[Friends Circle] 文字朋友圈已写入变量:', circleData);

        // 触发界面更新
        this.dispatchUpdateEvent();

        // 使用手机内部独立AI生成好友回复
        const aiResult = await this.generateViaPhoneAI(
          `用户发送了一条文字朋友圈："${content}"。请以JSON数组格式生成3-5条可能的好友回复，每个元素包含 author, friendId, content 字段。只生成JSON数组，不要其他内容。`,
        );

        if (aiResult) {
          try {
            const jsonMatch = aiResult.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const aiReplies = JSON.parse(jsonMatch[0]);
              for (const reply of aiReplies) {
                if (reply.author && reply.content) {
                  await this.manager.addReply(circleId, {
                    id: `fc_reply_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    author: reply.author,
                    friendId: reply.friendId || '',
                    content: reply.content,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          } catch (parseError) {
            console.warn('[Friends Circle] 解析AI回复失败:', parseError);
          }

          this._notifySTFriendsCircleActivity('publish', currentUserName, content);
        }

        // 刷新显示
        if (this.isActive) {
          await this.manager.refreshData(true);
          this.updateDisplay();
        }

        this.showToast('朋友圈已发送', 'success');
        this.hidePublishModal();
      } catch (error) {
        console.error('[Friends Circle] 发送文字朋友圈失败:', error);
        this.showToast('发送失败，请重试', 'error');
      }
    }

    /**
     * 发送图片朋友圈
     * @param {string} imageDescription - 图片描述
     * @param {string} textContent - 文字内容
     * @param {File} imageFile - 图片文件（可选）
     */
    async sendImageCircle(imageDescription, textContent, imageFile) {
      try {
        // 生成唯一ID
        const circleId = `fc_${Date.now()}`;

        let finalImageDesc = imageDescription;
        let imageUrl = null;
        let imageFileName = null;

        // 如果有图片文件，先上传
        if (imageFile && window.mobileUploadManager) {
          try {
            const uploadResult = await window.mobileUploadManager.uploadFile(imageFile);
            if (uploadResult && uploadResult.success) {
              imageUrl = uploadResult.fileUrl || null;
              imageFileName = uploadResult.fileName || imageFile.name;
              finalImageDesc = imageDescription || '图片';
            }
          } catch (uploadError) {
            console.warn('[Friends Circle] 图片上传失败，使用描述文本:', uploadError);
          }
        }

        const currentUserName = this.getCurrentUserName();
        const circleData = {
          id: circleId,
          author: currentUserName,
          friendId: '483920',
          type: 'visual',
          imageDescription: finalImageDesc,
          imageUrl: imageUrl,
          imageFileName: imageFileName,
          content: textContent || '',
          timestamp: Date.now(),
          messageIndex: -1,
          latestActivityIndex: -1,
          replies: [],
          likes: [],
          isLiked: false,
        };

        // 添加到变量
        this.manager.circlesData.push(circleData);
        await this.manager._saveCirclesToVariable();

        console.log('[Friends Circle] 图片朋友圈已写入变量:', circleData);

        // 触发界面更新
        this.dispatchUpdateEvent();

        // 使用手机内部独立AI生成好友回复
        const aiResult = await this.generateViaPhoneAI(
          `用户发送了一条图片朋友圈，图片描述："${finalImageDesc}"，配文："${textContent || ''}"。请以JSON数组格式生成3-5条可能的好友回复，每个元素包含 author, friendId, content 字段。只生成JSON数组，不要其他内容。`,
        );

        if (aiResult) {
          try {
            const jsonMatch = aiResult.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const aiReplies = JSON.parse(jsonMatch[0]);
              for (const reply of aiReplies) {
                if (reply.author && reply.content) {
                  await this.manager.addReply(circleId, {
                    id: `fc_reply_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    author: reply.author,
                    friendId: reply.friendId || '',
                    content: reply.content,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          } catch (parseError) {
            console.warn('[Friends Circle] 解析AI回复失败:', parseError);
          }

          this.showToast('朋友圈已发送', 'success');
          this._notifySTFriendsCircleActivity('publish', currentUserName, textContent || finalImageDesc);
        } else {
          this.showToast('朋友圈已发送', 'success');
        }

        // 刷新显示
        if (this.isActive) {
          await this.manager.refreshData(true);
          this.updateDisplay();
        }

        this.hidePublishModal();
      } catch (error) {
        console.error('[Friends Circle] 发送图片朋友圈失败:', error);
        this.showToast('发送失败，请重试', 'error');
      }
    }

    /**
     * 处理文字发布
     * @param {HTMLElement} modal - 弹窗元素
     */
    handleTextPublish(modal = null) {
      if (!modal) {
        modal = document.querySelector('.friends-circle-text-publish-modal');
      }
      if (!modal) return;

      const textInput = modal.querySelector('.text-input');
      if (!textInput) return;

      const content = textInput.value.trim();
      if (!content) {
        this.showToast('请输入朋友圈内容', 'error');
        return;
      }

      // 发送文字朋友圈
      this.sendTextCircle(content);
      modal.remove();
    }

    /**
     * 处理图片发布
     */
    async handleImagePublish() {
      console.log('[Friends Circle] 开始处理图片发布...');
      console.log('[Friends Circle] this上下文检查:', {
        thisExists: !!this,
        thisConstructorName: this?.constructor?.name,
        hasSelectedImageFile: !!this?.selectedImageFile,
        selectedImageFileName: this?.selectedImageFile?.name,
        globalInstanceExists: !!window.friendsCircle,
        globalInstanceSame: window.friendsCircle === this,
        globalHasSelectedFile: !!window.friendsCircle?.selectedImageFile,
        globalSelectedFileName: window.friendsCircle?.selectedImageFile?.name,
      });

      // 如果当前实例没有文件，但全局实例有，则使用全局实例的文件
      if (!this.selectedImageFile && window.friendsCircle?.selectedImageFile) {
        console.log('[Friends Circle] 从全局实例恢复文件信息');
        this.selectedImageFile = window.friendsCircle.selectedImageFile;
        this.selectedImageElements = window.friendsCircle.selectedImageElements;
      }

      const modal = document.querySelector('.friends-circle-image-publish-modal');
      if (!modal) {
        console.error('[Friends Circle] 未找到发布弹窗');
        return;
      }

      const imageDescInput = modal.querySelector('.image-desc-input');
      const textInput = modal.querySelector('.text-input');
      const publishBtn = modal.querySelector('#friends-circle-publish-btn');
      const uploadStatus = modal.querySelector('#friends-circle-upload-status');
      const uploadText = modal.querySelector('#friends-circle-upload-text');
      const progressBar = modal.querySelector('#friends-circle-progress-bar');

      console.log('[Friends Circle] 弹窗元素检查:', {
        imageDescInput: !!imageDescInput,
        textInput: !!textInput,
        publishBtn: !!publishBtn,
        uploadStatus: !!uploadStatus,
        uploadText: !!uploadText,
        progressBar: !!progressBar,
      });

      if (!imageDescInput) {
        console.error('[Friends Circle] 图片描述输入框未找到');
        return;
      }

      const imageDescription = imageDescInput.value.trim();
      const textContent = textInput ? textInput.value.trim() : '';
      const imageFile = this.selectedImageFile;

      console.log('[Friends Circle] 发布数据检查:', {
        imageDescription: imageDescription,
        textContent: textContent,
        hasImageFile: !!imageFile,
        imageFileName: imageFile ? imageFile.name : 'none',
        selectedImageFileExists: !!this.selectedImageFile,
      });

      // 验证输入 - 至少需要图片描述或图片文件其中之一
      if (!imageDescription && !imageFile) {
        console.warn('[Friends Circle] 验证失败 - 缺少描述和图片文件');
        this.showToast('请输入图片描述或上传图片', 'error');
        return;
      }

      console.log('[Friends Circle] 发布验证通过:', {
        hasDescription: !!imageDescription,
        hasImageFile: !!imageFile,
        imageFileName: imageFile ? imageFile.name : 'none',
      });

      try {
        // 禁用发布按钮，显示上传状态
        if (publishBtn) {
          publishBtn.disabled = true;
          publishBtn.textContent = '发布中...';
        }

        let uploadResult = null;
        let finalImageDescription = imageDescription || '图片';

        // 如果有图片文件，先上传
        if (imageFile) {
          console.log('[Friends Circle] 开始上传图片文件:', imageFile.name);

          // 显示上传状态
          if (uploadStatus) {
            uploadStatus.style.display = 'block';
            if (uploadText) uploadText.textContent = '正在上传图片...';
            if (progressBar) progressBar.style.width = '30%';
          }

          // 使用SillyTavern原生附件系统
          if (!window.attachmentSender) {
            throw new Error('图片上传功能未就绪');
          }

          // 直接使用simulateFileInputUpload，让SillyTavern处理附件
          uploadResult = await window.attachmentSender.simulateFileInputUpload(imageFile);

          if (!uploadResult.success) {
            throw new Error(uploadResult.error || '图片上传失败');
          }

          console.log('[Friends Circle] 图片已附加到SillyTavern:', uploadResult);

          // 更新进度
          if (progressBar) progressBar.style.width = '70%';
          if (uploadText) uploadText.textContent = '图片已附加，正在发布...';

          // 如果没有描述，使用文件名作为描述
          if (!imageDescription) {
            finalImageDescription = `我的图片: ${uploadResult.fileName}`;
          }
        }

        // 更新进度
        if (progressBar) progressBar.style.width = '90%';
        if (uploadText) uploadText.textContent = '正在发布朋友圈...';

        // 发送朋友圈
        await this.sendImageCircleWithUpload(finalImageDescription, textContent, uploadResult);

        // 完成
        if (progressBar) progressBar.style.width = '100%';
        if (uploadText) uploadText.textContent = '发布成功！';

        // 延迟关闭弹窗
        setTimeout(() => {
          modal.remove();
          this.showToast('朋友圈发布成功！', 'success');
        }, 1000);
      } catch (error) {
        console.error('[Friends Circle] 图片朋友圈发布失败:', error);

        // 恢复按钮状态
        if (publishBtn) {
          publishBtn.disabled = false;
          publishBtn.textContent = '发布';
        }

        // 隐藏上传状态
        if (uploadStatus) {
          uploadStatus.style.display = 'none';
        }

        this.showToast(error.message || '发布失败，请重试', 'error');
      }
    }

    /**
     * 发送带上传结果的图片朋友圈
     */
    async sendImageCircleWithUpload(imageDescription, textContent, uploadResult) {
      try {
        // 生成唯一ID
        const circleId = `fc_${Date.now()}`;

        // 从uploadResult中获取文件名和URL
        const fileName = uploadResult?.file?.name || uploadResult?.fileName || '图片';
        let imageUrl = null;

        if (uploadResult && uploadResult.fileUrl && uploadResult.fileUrl !== 'attached_to_sillytavern') {
          imageUrl = uploadResult.fileUrl;
        }

        const currentUserName = this.getCurrentUserName();
        const circleData = {
          id: circleId,
          author: currentUserName,
          friendId: '483920',
          type: 'visual',
          imageDescription: `我的图片: ${fileName}`,
          imageUrl: imageUrl,
          imageFileName: fileName,
          content: textContent || '',
          timestamp: Date.now(),
          messageIndex: -1,
          latestActivityIndex: -1,
          replies: [],
          likes: [],
          isLiked: false,
        };

        // 添加到变量
        this.manager.circlesData.push(circleData);
        await this.manager._saveCirclesToVariable();

        console.log('[Friends Circle] 图片朋友圈已写入变量:', circleData);

        // 触发界面更新
        this.dispatchUpdateEvent();

        // 使用手机内部独立AI生成好友回复
        const aiResult = await this.generateViaPhoneAI(
          `用户发送了一条图片朋友圈，图片描述："我的图片: ${fileName}"，配文："${textContent || ''}"。请以JSON数组格式生成3-5条可能的好友回复，每个元素包含 author, friendId, content 字段。只生成JSON数组，不要其他内容。`,
        );

        if (aiResult) {
          try {
            const jsonMatch = aiResult.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const aiReplies = JSON.parse(jsonMatch[0]);
              for (const reply of aiReplies) {
                if (reply.author && reply.content) {
                  await this.manager.addReply(circleId, {
                    id: `fc_reply_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    author: reply.author,
                    friendId: reply.friendId || '',
                    content: reply.content,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          } catch (parseError) {
            console.warn('[Friends Circle] 解析AI回复失败:', parseError);
          }

          this._notifySTFriendsCircleActivity('publish', currentUserName, textContent || imageDescription);
        }

        // 刷新显示
        if (this.isActive) {
          await this.manager.refreshData(true);
          this.updateDisplay();
        }

        console.log('[Friends Circle] 图片朋友圈发送成功');
      } catch (error) {
        console.error('[Friends Circle] 发送图片朋友圈失败:', error);
        throw error;
      }
    }

    /**
     * 派发更新事件
     */
    dispatchUpdateEvent() {
      const event = new CustomEvent('friendsCircleUpdate', {
        detail: {
          timestamp: Date.now(),
          circles: this.manager.getSortedFriendsCircles(),
        },
      });
      window.dispatchEvent(event);
    }

  }

  // 导出类到全局
  window.FriendsCircleManager = FriendsCircleManager;
  window.FriendsCircleEventListener = FriendsCircleEventListener;
  window.FriendsCircleRenderer = FriendsCircleRenderer;
  window.FriendsCircle = FriendsCircle;

  console.log('[Friends Circle] 朋友圈模块加载完成');
}
