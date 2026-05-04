/**
 * Message Sender - 消息发送处理器
 * 专门处理消息发送格式和逻辑，参考qq-app.js的发送功能
 */

// 避免重复定义
if (typeof window.MessageSender === 'undefined') {
  class MessageSender {
    constructor() {
      this.currentFriendId = null;
      this.currentFriendName = null;
      this.isGroup = false;
      this.contextEditor = null;
      this.init();
    }

    init() {
      console.log('[Message Sender] 消息发送器初始化完成');
      this.loadContextEditor();
    }

    /**
     * 检查是否启用延迟点击发送按钮
     */
    isDelayClickEnabled() {
      try {
        const settings = localStorage.getItem('messageSenderSettings');
        if (settings) {
          const parsed = JSON.parse(settings);
          // 如果明确设置了 delayClickEnabled，使用该值；否则默认为 true
          return parsed.delayClickEnabled === undefined ? true : parsed.delayClickEnabled;
        }
        return true; // 默认启用
      } catch (error) {
        console.warn('[Message Sender] 获取延迟点击设置失败:', error);
        return true; // 默认启用
      }
    }

    /**
     * 设置是否启用延迟点击发送按钮
     */
    setDelayClickEnabled(enabled) {
      try {
        let settings = {};
        const existing = localStorage.getItem('messageSenderSettings');
        if (existing) {
          settings = JSON.parse(existing);
        }
        settings.delayClickEnabled = enabled;
        localStorage.setItem('messageSenderSettings', JSON.stringify(settings));
        console.log('[Message Sender] 延迟点击设置已保存:', enabled);
      } catch (error) {
        console.error('[Message Sender] 保存延迟点击设置失败:', error);
      }
    }

    /**
     * 检查是否启用禁止正文功能
     */
    isDisableBodyTextEnabled() {
      try {
        // 尝试从SillyTavern的extension_settings中获取
        if (window.SillyTavern && window.SillyTavern.getContext) {
          const context = window.SillyTavern.getContext();
          if (context.extensionSettings && context.extensionSettings.mobile_context) {
            return context.extensionSettings.mobile_context.disableBodyText || false;
          }
        }

        // 回退到全局extension_settings
        if (window.extension_settings && window.extension_settings.mobile_context) {
          return window.extension_settings.mobile_context.disableBodyText || false;
        }

        return false; // 默认不启用
      } catch (error) {
        console.warn('[Message Sender] 获取禁止正文设置失败:', error);
        return false; // 默认不启用
      }
    }

    /**
     * 加载上下文编辑器
     */
    loadContextEditor() {
      // 检查mobile上下文编辑器是否可用
      if (window.mobileContextEditor) {
        this.contextEditor = window.mobileContextEditor;
        console.log('[Message Sender] Mobile上下文编辑器已连接');
      } else {
        console.warn('[Message Sender] Mobile上下文编辑器未找到，延迟重试...');
        setTimeout(() => this.loadContextEditor(), 1000);
      }
    }

    /**
     * 设置当前聊天对象
     */
    setCurrentChat(friendId, friendName, isGroup = false) {
      this.currentFriendId = friendId;
      this.currentFriendName = friendName;
      this.isGroup = isGroup;

      console.log(`[Message Sender] 设置当前聊天对象:`, {
        friendId,
        friendName,
        isGroup,
      });
    }

    /**
     * 发送消息到SillyTavern
     * 参考qq-app.js的sendToChat方法
     */
    async sendToChat(message) {
      try {
        console.log('[Message Sender] 尝试发送消息到SillyTavern:', message);

        // 转义消息中的 / 字符，避免触发ST的斜杠命令解析器
        // ES5兼容写法：用占位符保护已转义的 \/ 和 URL中的 ://
        var temp = message.replace(/\\\//g, '\x00ESCAPED_SLASH\x00');
        temp = temp.replace(/:\/\//g, '\x00URL_SLASH\x00');
        temp = temp.replace(/\//g, '\\/');
        temp = temp.replace(/\x00ESCAPED_SLASH\x00/g, '\\/');
        temp = temp.replace(/\x00URL_SLASH\x00/g, '://');
        message = temp;

        // 方法1: 直接使用DOM元素
        const originalInput = document.getElementById('send_textarea');
        const sendButton = document.getElementById('send_but');

        if (!originalInput || !sendButton) {
          console.error('[Message Sender] 找不到输入框或发送按钮元素');
          return await this.sendToChatBackup(message);
        }

        // 检查输入框是否可用
        if (originalInput.disabled) {
          console.warn('[Message Sender] 输入框被禁用');
          return false;
        }

        // 检查发送按钮是否可用
        if (sendButton.classList.contains('disabled')) {
          console.warn('[Message Sender] 发送按钮被禁用');
          return false;
        }

        // 追加消息到现有内容
        const existingValue = originalInput.value;
        const newValue = existingValue ? existingValue + '\n' + message : message;
        originalInput.value = newValue;
        console.log('[Message Sender] 已追加消息到输入框:', {
          原有内容: existingValue,
          新增内容: message,
          最终内容: newValue
        });

        // 触发输入事件
        originalInput.dispatchEvent(new Event('input', { bubbles: true }));
        originalInput.dispatchEvent(new Event('change', { bubbles: true }));

        // 根据设置决定是否延迟点击发送按钮
        if (this.isDelayClickEnabled()) {
          // 延迟点击发送按钮
          await new Promise(resolve => setTimeout(resolve, 300));
          sendButton.click();
          console.log('[Message Sender] 已延迟点击发送按钮');
        } else {

        }

        return true;
      } catch (error) {
        console.error('[Message Sender] 发送消息时出错:', error);
        return await this.sendToChatBackup(message);
      }
    }

    /**
     * 备用发送方法
     */
    async sendToChatBackup(message) {
      try {
        console.log('[Message Sender] 尝试备用发送方法:', message);

        // 转义 / 字符（ES5兼容写法）
        var temp = message.replace(/\\\//g, '\x00ESCAPED_SLASH\x00');
        temp = temp.replace(/:\/\//g, '\x00URL_SLASH\x00');
        temp = temp.replace(/\//g, '\\/');
        temp = temp.replace(/\x00ESCAPED_SLASH\x00/g, '\\/');
        temp = temp.replace(/\x00URL_SLASH\x00/g, '://');
        message = temp;

        // 尝试查找其他可能的输入框
        const textareas = document.querySelectorAll('textarea');
        const inputs = document.querySelectorAll('input[type="text"]');

        if (textareas.length > 0) {
          const textarea = textareas[0];
          textarea.value = message;
          textarea.focus();

          // 模拟键盘事件
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return true;
        }

        return false;
      } catch (error) {
        console.error('[Message Sender] 备用发送方法失败:', error);
        return false;
      }
    }

    /**
     * 构建消息格式并发送
     * 参考qq-app.js的buildAndSendQQMessage方法
     */
    async buildAndSendMessage(message) {
      if (!this.currentFriendId || !this.currentFriendName) {
        throw new Error('未设置当前聊天对象');
      }

      // 将消息按行分割，过滤空行
      const messageLines = message.split('\n').filter(line => line.trim());

      if (messageLines.length === 0) {
        throw new Error('消息内容不能为空');
      }

      console.log(`[Message Sender] 处理${messageLines.length}条消息:`, messageLines);

      // 🌟 新增：检查是否为已格式化的特殊消息（语音、红包、表情包）
      const voiceMessageRegex = /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|语音\|[^\]]*\]$/;
      const redpackMessageRegex = /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|红包\|[^\]]*\]$/;
      const stickerMessageRegex = /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|表情包\|[^\]]*\]$/;
      const hasSpecialMessages = messageLines.some(line => {
        const trimmed = line.trim();
        return (
          voiceMessageRegex.test(trimmed) || redpackMessageRegex.test(trimmed) || stickerMessageRegex.test(trimmed)
        );
      });

      if (hasSpecialMessages) {
        // 如果包含已格式化的语音消息，需要对混合消息进行分别处理
        const processedMessages = [];

        messageLines.forEach((line, index) => {
          const trimmedLine = line.trim();

          if (voiceMessageRegex.test(trimmedLine)) {
            // 语音消息直接保留
            processedMessages.push(trimmedLine);
            console.log(`[Message Sender] 第${index + 1}条: 保留语音消息格式:`, trimmedLine);
          } else if (redpackMessageRegex.test(trimmedLine)) {
            // 红包消息直接保留
            processedMessages.push(trimmedLine);
            console.log(`[Message Sender] 第${index + 1}条: 保留红包消息格式:`, trimmedLine);
          } else if (stickerMessageRegex.test(trimmedLine)) {
            // 🌟 新增：表情包消息直接保留
            processedMessages.push(trimmedLine);
            console.log(`[Message Sender] 第${index + 1}条: 保留表情包消息格式:`, trimmedLine);
          } else if (trimmedLine) {
            // 普通文字需要格式化为正确的格式
            const formattedMessage = this.isGroup
              ? `[我方消息|我|${this.currentFriendId}|文字|${trimmedLine}]`
              : `[我方消息|我|${this.currentFriendId}|文字|${trimmedLine}]`;

            processedMessages.push(formattedMessage);
            console.log(`[Message Sender] 第${index + 1}条: 格式化文字消息:`, formattedMessage);
          }
        });

        const targetPrefix = this.isGroup
          ? `向${this.currentFriendName}（${this.currentFriendId}）发送群聊`
          : `向${this.currentFriendName}（${this.currentFriendId}）发送消息`;

        // 检查是否启用禁止正文功能
        let finalMessage;
        if (this.isDisableBodyTextEnabled()) {
          finalMessage = `<手机消息模式：当前用户正在使用手机插件发送消息，请严格遵守以下规则>\n1. 只以手机消息格式回复（[对方消息|角色名|ID|消息类型|内容]）\n2. 绝对不要推进主线剧情、不要切换场景、不要切换角色\n3. 不要输出任何叙事描写、环境描写、心理描写\n4. 不要生成四选项（[真情][套路][试探][行动]）\n5. 不要输出状态栏和<state>变量更新\n6. 回复内容要简短自然，像真实的手机聊天\n</手机消息模式>\n请用规定格式，${targetPrefix}\n${processedMessages.join('\n')}`;
          console.log('[Message Sender] 手机消息模式已启用，添加隔离前缀');
        } else {
          finalMessage = `请用规定格式，${targetPrefix}\n${processedMessages.join('\n')}`;
        }

        console.log('[Message Sender] 发送混合消息（包含特殊格式）:', finalMessage);

        const success = await this.sendToChat(finalMessage);

        if (success) {
          const voiceCount = processedMessages.filter(msg => voiceMessageRegex.test(msg)).length;
          const redpackCount = processedMessages.filter(msg => redpackMessageRegex.test(msg)).length;
          const stickerCount = processedMessages.filter(msg => stickerMessageRegex.test(msg)).length;
          const textCount = processedMessages.length - voiceCount - redpackCount - stickerCount;

          let summaryMessage = '';
          const parts = [];

          if (textCount > 0) parts.push(`${textCount}条文字`);
          if (voiceCount > 0) parts.push(`${voiceCount}条语音`);
          if (redpackCount > 0) parts.push(`${redpackCount}条红包`);
          if (stickerCount > 0) parts.push(`${stickerCount}条表情包`);

          if (parts.length > 1) {
            summaryMessage = parts.join(' + ');
          } else if (parts.length === 1) {
            summaryMessage = parts[0] + '消息';
          } else {
            summaryMessage = `${processedMessages.length}条消息`;
          }

          this.showSendSuccessToast(summaryMessage);
        }

        return success;
      }

      // 检查是否全为表情包消息
      const stickerRegex = /^\[表情包\|([^\|]+)\|([^\]]+)\]$/;
      const allStickers = messageLines.every(line => stickerRegex.test(line.trim()));

      if (allStickers && messageLines.length > 0) {
        return await this.sendStickerMessages(messageLines);
      }

      // 处理普通消息
      return await this.sendNormalMessages(messageLines);
    }

    /**
     * 发送表情包消息
     */
    async sendStickerMessages(messageLines) {
      const targetPrefix = this.isGroup
        ? `向${this.currentFriendName}（${this.currentFriendId}）发送群聊`
        : `向${this.currentFriendName}（${this.currentFriendId}）发送消息`;

      // 检查是否启用禁止正文功能
      let finalMessage;
      if (this.isDisableBodyTextEnabled()) {
        finalMessage = `<手机消息模式：当前用户正在使用手机插件发送消息，请严格遵守以下规则>\n1. 只以手机消息格式回复（[对方消息|角色名|ID|消息类型|内容]）\n2. 绝对不要推进主线剧情、不要切换场景、不要切换角色\n3. 不要输出任何叙事描写、环境描写、心理描写\n4. 不要生成四选项（[真情][套路][试探][行动]）\n5. 不要输出状态栏和<state>变量更新\n6. 回复内容要简短自然，像真实的手机聊天\n</手机消息模式>\n请用规定格式，${targetPrefix}\n${messageLines.join('\n')}`;
        console.log('[Message Sender] 手机消息模式已启用，添加隔离前缀');
      } else {
        finalMessage = `请用规定格式，${targetPrefix}\n${messageLines.join('\n')}`;
      }

      console.log('[Message Sender] 发送纯表情包消息:', finalMessage);

      const success = await this.sendToChat(finalMessage);

      if (success) {
        const summaryMessage = messageLines.length > 1 ? `${messageLines.length}个表情包` : '1个表情包';

        this.showSendSuccessToast(summaryMessage);
      }

      return success;
    }

    /**
     * 发送普通消息
     */
    async sendNormalMessages(messageLines) {
      const formattedMessages = [];

      messageLines.forEach((line, index) => {
        // 为每条消息生成独立的时间戳（间隔1秒）
        const messageTime = new Date(Date.now() + index * 1000);
        const currentTime = messageTime.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        let messageContent = line.trim();
        let singleMessage;

        // 检查是否包含特殊格式
        if (this.isSpecialFormat(messageContent)) {
          // 处理特殊格式消息
          singleMessage = this.formatSpecialMessage(messageContent, currentTime);
        } else {
          // 处理普通文本消息
          singleMessage = this.formatNormalMessage(messageContent, currentTime);
        }

        formattedMessages.push(singleMessage);
        console.log(`[Message Sender] 第${index + 1}条消息格式:`, singleMessage);
      });

      // 验证消息格式
      const validatedMessages = this.validateMessages(formattedMessages);

      // 构建最终消息
      let targetPrefix;
      if (this.isGroup) {
        // 获取群聊成员列表
        const groupMembers = this.getCurrentGroupMembers();
        const membersText = groupMembers.length > 0 ? `，群聊内成员有${groupMembers.join('、')}` : '';

        targetPrefix = `向${this.currentFriendName}（${this.currentFriendId}）发送群聊${membersText}。请按照线上聊天群聊消息中的要求和格式生成群聊内角色回复，回复需要符合所有角色的人设和当前剧情`;
      } else {
        targetPrefix = `向${this.currentFriendName}（${this.currentFriendId}）发送消息，请按照线上聊天私聊消息中的要求和格式生成角色回复，回复需要符合角色人设和当前剧情`;
      }

      // 检查是否启用禁止正文功能
      let finalMessage;
      if (this.isDisableBodyTextEnabled()) {
        finalMessage = `<手机消息模式：当前用户正在使用手机插件发送消息，请严格遵守以下规则>\n1. 只以手机消息格式回复（[对方消息|角色名|ID|消息类型|内容]）\n2. 绝对不要推进主线剧情、不要切换场景、不要切换角色\n3. 不要输出任何叙事描写、环境描写、心理描写\n4. 不要生成四选项（[真情][套路][试探][行动]）\n5. 不要输出状态栏和<state>变量更新\n6. 回复内容要简短自然，像真实的手机聊天\n</手机消息模式>\n请用规定格式，${targetPrefix}\n${validatedMessages.join('\n')}`;
        console.log('[Message Sender] 手机消息模式已启用，添加隔离前缀');
      } else {
        finalMessage = `请用规定格式，${targetPrefix}\n${validatedMessages.join('\n')}`;
      }

      console.log('[Message Sender] 最终消息:', finalMessage);

      const success = await this.sendToChat(finalMessage);

      if (success) {
        const summaryMessage =
          messageLines.length > 1
            ? `${messageLines.length}条消息: ${messageLines[0].substring(0, 10)}...`
            : messageLines[0];

        this.showSendSuccessToast(summaryMessage);
      }

      return success;
    }

    /**
     * 检查是否为特殊格式（表情包、语音、红包等）
     */
    isSpecialFormat(content) {
      const specialFormats = [
        /^\[表情包\|([^\|]+)\|([^\]]+)\]$/, // 旧表情包格式
        /^\[语音\|([^\|]+)\|([^\]]+)\]$/, // 旧语音格式
        /^\[红包\|([^\|]+)\|([^\]]+)\]$/, // 旧红包格式
        /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|语音\|[^\]]*\]$/, // 新语音消息格式
        /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|红包\|[^\]]*\]$/, // 新红包消息格式
        /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|表情包\|[^\]]*\]$/, // 新表情包消息格式
        /^语音：/, // 语音前缀
        /^红包：/, // 红包前缀
      ];

      return specialFormats.some(regex => regex.test(content));
    }

    /**
     * 格式化特殊消息
     */
    formatSpecialMessage(content, currentTime) {
      // 🌟 检查是否为已格式化的语音消息，如果是则直接返回，不再包装
      const voiceMessageRegex = /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|语音\|[^\]]*\]$/;
      if (voiceMessageRegex.test(content)) {
        console.log(`[Message Sender] 检测到已格式化的语音消息，直接返回:`, content);
        return content; // 直接返回，不再包装
      }

      // 🌟 检查是否为已格式化的红包消息，如果是则直接返回，不再包装
      const redpackMessageRegex = /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|红包\|[^\]]*\]$/;
      if (redpackMessageRegex.test(content)) {
        console.log(`[Message Sender] 检测到已格式化的红包消息，直接返回:`, content);
        return content; // 直接返回，不再包装
      }

      // 🌟 检查是否为已格式化的表情包消息，如果是则直接返回，不再包装
      const stickerMessageRegex = /^\[(?:我方消息\|我\|[^|]*|群聊消息\|[^|]*\|我)\|表情包\|[^\]]*\]$/;
      if (stickerMessageRegex.test(content)) {
        console.log(`[Message Sender] 检测到已格式化的表情包消息，直接返回:`, content);
        return content; // 直接返回，不再包装
      }

      // 如果已经是完整的特殊格式，直接包装
      if (content.startsWith('[') && content.endsWith(']')) {
        return this.isGroup
          ? `[我方消息|${this.currentFriendName}|${this.currentFriendId}|我|${content}|${currentTime}]`
          : `[我方消息|${this.currentFriendName}|${this.currentFriendId}|${content}|${currentTime}]`;
      }

      // 处理简单前缀格式
      if (content.startsWith('语音：')) {
        content = `语音：${content.substring(3)}`;
      } else if (content.startsWith('红包：')) {
        content = `红包：${content.substring(3)}`;
      }

      return this.isGroup
        ? `[我方消息|${this.currentFriendName}|${this.currentFriendId}|我|${content}|${currentTime}]`
        : `[我方消息|${this.currentFriendName}|${this.currentFriendId}|${content}|${currentTime}]`;
    }

    /**
     * 格式化普通消息
     */
    formatNormalMessage(content, currentTime) {
      return this.isGroup
        ? `[我方消息|我|${this.currentFriendId}|文字|${content}]`
        : `[我方消息|我|${this.currentFriendId}|文字|${content}]`;
    }

    /**
     * 验证消息格式
     */
    validateMessages(messages) {
      return messages.map((msg, index) => {
        if (!msg.trim().endsWith(']')) {
          console.warn(`[Message Sender] 第${index + 1}条消息格式不完整:`, msg);
          return msg.trim() + ']';
        }
        return msg.trim();
      });
    }

    /**
     * 显示发送成功提示
     */
    showSendSuccessToast(message) {
      const toast = document.createElement('div');
      toast.className = 'send-status-toast success';
      toast.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">✅ 消息已发送</div>
            <div style="font-size: 12px; opacity: 0.9;">
                发送给: ${this.currentFriendName}<br>
                内容: ${message.length > 20 ? message.substring(0, 20) + '...' : message}
            </div>
        `;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 2000);
    }

    /**
     * 显示发送失败提示
     */
    showSendErrorToast(error) {
      const toast = document.createElement('div');
      toast.className = 'send-status-toast error';
      toast.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">❌ 发送失败</div>
            <div style="font-size: 12px; opacity: 0.9;">
                错误: ${error}
            </div>
        `;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3000);
    }

    /**
     * 处理回车发送
     */
    handleEnterSend(event, textareaElement) {
      if (event.key === 'Enter' && !event.shiftKey) {
        // 不再阻止默认行为，让回车键正常换行
        // event.preventDefault();

        // 换行后重新调整textarea高度
        setTimeout(() => {
          this.adjustTextareaHeight(textareaElement);
        }, 0);
      }
    }

    /**
     * 发送消息的主要方法
     */
    async sendMessage(message) {
      if (!message.trim()) {
        this.showSendErrorToast('消息内容不能为空');
        return false;
      }

      if (!this.currentFriendId) {
        this.showSendErrorToast('请选择一个聊天对象');
        return false;
      }

      try {
        // Check independent AI mode
        var independentEnabled = window.independentAI && window.independentAI.isEnabled();
        console.log('[Message Sender] independentAI.isEnabled():', independentEnabled,
          '| RoleAPI exists:', !!window.RoleAPI,
          '| API config:', window.RoleAPI ? window.RoleAPI.getAPIConfig() : 'N/A');
        if (independentEnabled) {
          console.log('[Message Sender] Using independent AI mode');
          this.setSendingState(true);

          // Parse message type from bracket tag format
          // Supports: [我方消息|我|ID|类型|内容], plain text, etc.
          let msgType = '文字';
          let msgContent = message;
          let msgFullMatch = '[我方消息|我|' + this.currentFriendId + '|文字|' + message + ']';

          const tagMatch = message.match(/^\[(我方消息|群聊消息)\|([^|]+)\|([^|]+)\|([^|]+)\|(.+)\]$/);
          if (tagMatch) {
            msgType = tagMatch[4]; // e.g. 红包, 表情包, 图片, 语音
            msgContent = tagMatch[5];
            msgFullMatch = message;
          }

          // Add user message bubble to chat UI using renderSingleMessage for proper rendering
          if (window.messageRenderer) {
            const container = document.querySelector('.messages-container');
            if (container) {
              // 去重检查：避免与 _appendIndependentAIHistory 重复渲染
              const existingMsgs = container.querySelectorAll('.message-detail.message-sent');
              let isDuplicate = false;
              for (let i = existingMsgs.length - 1; i >= 0; i--) {
                const textEl = existingMsgs[i].querySelector('.message-text');
                if (textEl && textEl.textContent.trim() === msgContent.trim()) {
                  isDuplicate = true;
                  break;
                }
              }
              if (!isDuplicate) {
                const userMsg = {
                  fullMatch: msgFullMatch,
                  messageType: msgType,
                  sender: '我',
                  content: msgContent,
                  number: this.currentFriendId,
                  isUser: true
                };
                const html = window.messageRenderer.renderSingleMessage(userMsg);
                if (html) {
                  container.insertAdjacentHTML('beforeend', html);
                  window.independentAI.scrollToBottom();
                }
              } else {
                console.log('[Message Sender] 跳过重复用户消息渲染');
              }
            }
          }

          // Auto-add friend to phone contact list (independent AI mode)
          if (window.friendRenderer && window.friendRenderer.addFriend) {
            window.friendRenderer.addFriend(this.currentFriendName, this.currentFriendId);
          }

          // Send text content to independent AI (strip tag wrapper for AI context)
          // 三级降级策略：RoleAPI -> XBBridge -> mobileCustomAPIConfig
          const aiMessage = tagMatch ? msgType + ': ' + msgContent : message;
          var result = await this._sendViaPhoneAI(
            this.currentFriendName,
            this.currentFriendId,
            aiMessage,
            { fullMatch: msgFullMatch, messageType: msgType, content: msgContent }
          );

          this.setSendingState(false);

          if (!result.success) {
            this.showSendErrorToast(result.error || 'AI回复失败');
          }

          // Cancel delayed re-render to prevent clearing independent AI bubbles
          if (window.messageApp && typeof window.messageApp.cancelDelayedRender === 'function') {
            window.messageApp.cancelDelayedRender();
          }

          return result.success;
        }

        // Original ST-based sending
        this.setSendingState(true);
        const success = await this.buildAndSendMessage(message);
        if (!success) {
          this.showSendErrorToast('发送失败，请重试');
        }
        return success;
      } catch (error) {
        console.error('[Message Sender] 发送消息失败:', error);
        this.showSendErrorToast(error.message || '发送失败');
        return false;
      } finally {
        this.setSendingState(false);
      }
    }

    /**
     * 三级降级策略发送消息到AI（不触发ST聊天）
     * 降级顺序：RoleAPI -> XBBridge -> mobileCustomAPIConfig
     * @param {string} friendName - 好友名称
     * @param {string} friendId - 好友ID
     * @param {string} userMessage - 用户消息
     * @param {Object} meta - 消息元数据
     * @returns {Promise<{success: boolean, text?: string, error?: string}>}
     */
    async _sendViaPhoneAI(friendName, friendId, userMessage, meta) {
      // 方式1: 使用 RoleAPI（独立AI模式）
      if (window.independentAI && typeof window.independentAI.isEnabled === 'function' && window.independentAI.isEnabled()) {
        console.log('[Message Sender] 三级降级: 尝试 RoleAPI');
        try {
          var result = await window.independentAI.sendMessage(friendName, friendId, userMessage, meta);
          if (result && result.success) {
            console.log('[Message Sender] RoleAPI 成功');
            return result;
          }
          console.warn('[Message Sender] RoleAPI 返回失败:', result ? result.error : '无结果');
        } catch (e) {
          console.warn('[Message Sender] RoleAPI 异常:', e.message);
        }
      }

      // 方式2: 使用 XBBridge（小白X宿主）
      if (window.XBBridge && typeof window.XBBridge.isAvailable === 'function' && window.XBBridge.isAvailable()) {
        console.log('[Message Sender] 三级降级: 尝试 XBBridge');
        try {
          var systemPrompt = '';
          if (window.RoleAPI && typeof window.RoleAPI.buildSystemPrompt === 'function') {
            systemPrompt = await window.RoleAPI.buildSystemPrompt(friendName, friendId);
          }
          var messages = [];
          if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
          }
          // 添加历史消息
          if (window.RoleAPI && window.RoleAPI.chatHistories && window.RoleAPI.chatHistories[friendId]) {
            var history = window.RoleAPI.chatHistories[friendId];
            for (var i = 0; i < history.length; i++) {
              messages.push({ role: history[i].role, content: history[i].content });
            }
          }
          messages.push({ role: 'user', content: userMessage });

          var xbResult = await window.XBBridge.generate.generate({
            provider: 'inherit',
            messages: messages,
            max_tokens: 300,
            temperature: 0.8
          });
          var replyText = '';
          if (xbResult && xbResult.text) {
            replyText = xbResult.text;
          } else if (typeof xbResult === 'string') {
            replyText = xbResult;
          }
          if (replyText) {
            console.log('[Message Sender] XBBridge 成功，长度:', replyText.length);
            // 渲染回复气泡
            if (window.RoleAPI) {
              window.RoleAPI.addToHistory(friendId, 'user', userMessage, meta);
              window.RoleAPI.addToHistory(friendId, 'assistant', replyText, null);
            }
            if (window.RoleAPI && typeof window.RoleAPI.createStreamBubble === 'function') {
              var bubbleEl = window.RoleAPI.createStreamBubble(friendName, friendId);
              window.RoleAPI.updateStreamBubble(bubbleEl, replyText);
              window.RoleAPI.finalizeStreamBubble(bubbleEl, replyText, friendName, friendId);
            }
            return { success: true, text: replyText };
          }
          console.warn('[Message Sender] XBBridge 返回无内容');
        } catch (e) {
          console.warn('[Message Sender] XBBridge 异常:', e.message);
        }
      }

      // 方式3: 使用 mobileCustomAPIConfig
      if (window.mobileCustomAPIConfig && typeof window.mobileCustomAPIConfig.isAPIAvailable === 'function' && window.mobileCustomAPIConfig.isAPIAvailable()) {
        console.log('[Message Sender] 三级降级: 尝试 mobileCustomAPIConfig');
        try {
          var messages3 = [];
          if (window.RoleAPI && typeof window.RoleAPI.buildSystemPrompt === 'function') {
            var sp = await window.RoleAPI.buildSystemPrompt(friendName, friendId);
            if (sp) messages3.push({ role: 'system', content: sp });
          }
          messages3.push({ role: 'user', content: userMessage });

          var response = await window.mobileCustomAPIConfig.callAPI(messages3, {
            temperature: 0.8,
            max_tokens: 300
          });
          if (response && response.content) {
            console.log('[Message Sender] mobileCustomAPIConfig 成功，长度:', response.content.length);
            if (window.RoleAPI) {
              window.RoleAPI.addToHistory(friendId, 'user', userMessage, meta);
              window.RoleAPI.addToHistory(friendId, 'assistant', response.content, null);
            }
            if (window.RoleAPI && typeof window.RoleAPI.createStreamBubble === 'function') {
              var bubbleEl2 = window.RoleAPI.createStreamBubble(friendName, friendId);
              window.RoleAPI.updateStreamBubble(bubbleEl2, response.content);
              window.RoleAPI.finalizeStreamBubble(bubbleEl2, response.content, friendName, friendId);
            }
            return { success: true, text: response.content };
          }
          console.warn('[Message Sender] mobileCustomAPIConfig 返回无内容');
        } catch (e) {
          console.warn('[Message Sender] mobileCustomAPIConfig 异常:', e.message);
        }
      }

      console.error('[Message Sender] 三级降级全部失败：RoleAPI、XBBridge、mobileCustomAPIConfig 均不可用');
      return { success: false, error: '没有可用的AI生成方式，请检查API配置' };
    }

    /**
     * 设置发送中状态
     */
    setSendingState(isSending) {
      const sendButton = document.getElementById('send-message-btn');
      const textareaElement = document.getElementById('message-send-input');

      if (sendButton) {
        if (isSending) {
          sendButton.classList.add('sending');
          sendButton.disabled = true;
          sendButton.textContent = '发送中...';
        } else {
          sendButton.classList.remove('sending');
          sendButton.disabled = false;
          sendButton.textContent = '发送';
        }
      }

      if (textareaElement) {
        textareaElement.disabled = isSending;
      }
    }

    /**
     * 自动调整textarea高度
     */
    adjustTextareaHeight(textareaElement) {
      textareaElement.style.height = 'auto';
      textareaElement.style.height = Math.min(textareaElement.scrollHeight, 100) + 'px';
    }

    /**
     * 插入特殊格式到输入框
     */
    insertSpecialFormat(format, params) {
      const textareaElement = document.getElementById('message-send-input');
      if (!textareaElement) return;

      let specialText = '';

      switch (format) {
        case 'sticker':
          specialText = `[表情包|${params.filename}|${params.filepath}]`;
          break;
        case 'voice':
          specialText = `[语音|${params.duration}|${params.content}]`;
          break;
        case 'redpack':
          specialText = `[红包|${params.amount}|${params.message}]`;
          break;
        case 'emoji':
          specialText = params.emoji;
          break;
        default:
          return;
      }

      // 获取当前输入框的值和光标位置
      const currentValue = textareaElement.value;
      const cursorPosition = textareaElement.selectionStart;

      // 如果输入框不为空且光标前的字符不是换行符，添加换行
      let newValue;
      if (currentValue && cursorPosition > 0 && currentValue[cursorPosition - 1] !== '\n') {
        newValue = currentValue.slice(0, cursorPosition) + '\n' + specialText + currentValue.slice(cursorPosition);
      } else {
        newValue = currentValue.slice(0, cursorPosition) + specialText + currentValue.slice(cursorPosition);
      }

      // 设置新值
      textareaElement.value = newValue;

      // 调整高度
      this.adjustTextareaHeight(textareaElement);

      // 设置光标位置
      const newCursorPosition = cursorPosition + specialText.length + (newValue !== currentValue + specialText ? 1 : 0);
      textareaElement.setSelectionRange(newCursorPosition, newCursorPosition);
      textareaElement.focus();
    }

    /**
     * 获取当前聊天对象信息
     */
    getCurrentChatInfo() {
      return {
        friendId: this.currentFriendId,
        friendName: this.currentFriendName,
        isGroup: this.isGroup,
      };
    }

    /**
     * 清空当前聊天对象
     */
    clearCurrentChat() {
      this.currentFriendId = null;
      this.currentFriendName = null;
      this.isGroup = false;
    }

    /**
     * 获取当前群聊的成员列表
     */
    getCurrentGroupMembers() {
      if (!this.isGroup || !this.currentFriendId) {
        return [];
      }

      try {
        // 方法1: 从聊天记录中查找最新的群聊信息
        const messageElements = document.querySelectorAll('.mes_text, .mes_block');
        let latestGroupInfo = null;

        // 创建正则表达式匹配该群的信息：[群聊|群名|群号|成员列表] 或 [创建群聊|群号|群名|成员列表]
        const groupRegex1 = new RegExp(`\\[群聊\\|([^\\|]+)\\|${this.currentFriendId}\\|([^\\]]+)\\]`, 'g');
        const groupRegex2 = new RegExp(`\\[创建群聊\\|${this.currentFriendId}\\|([^\\|]+)\\|([^\\]]+)\\]`, 'g');

        // 从最新消息开始查找
        for (let i = messageElements.length - 1; i >= 0; i--) {
          const messageText = messageElements[i].textContent || '';

          // 重置正则表达式索引
          groupRegex1.lastIndex = 0;
          groupRegex2.lastIndex = 0;

          // 尝试匹配第一种格式：[群聊|群名|群号|成员列表]
          let match = groupRegex1.exec(messageText);
          if (match) {
            latestGroupInfo = {
              groupName: match[1],
              members: match[2],
            };
            console.log('[Message Sender] 找到群聊信息 (格式1):', latestGroupInfo);
            break;
          }

          // 尝试匹配第二种格式：[创建群聊|群号|群名|成员列表]
          match = groupRegex2.exec(messageText);
          if (match) {
            latestGroupInfo = {
              groupName: match[1],
              members: match[2],
            };
            console.log('[Message Sender] 找到群聊信息 (格式2):', latestGroupInfo);
            break;
          }
        }

        if (latestGroupInfo) {
          // 解析成员列表
          const members = latestGroupInfo.members
            .split(/[、,，]/)
            .map(name => name.trim())
            .filter(name => name);

          console.log('[Message Sender] 解析到群聊成员:', members);
          return members;
        } else {
          console.log('[Message Sender] 未找到群聊成员信息，返回空数组');
          return [];
        }
      } catch (error) {
        console.error('[Message Sender] 获取群聊成员失败:', error);
        return [];
      }
    }

    /**
     * 调试方法
     */
    debug() {
      console.log('[Message Sender] 调试信息:', {
        currentFriendId: this.currentFriendId,
        currentFriendName: this.currentFriendName,
        isGroup: this.isGroup,
        contextEditor: !!this.contextEditor,
      });
    }
  }

  // 创建全局实例
  window.MessageSender = MessageSender;

  // 如果页面已加载，立即创建实例
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.messageSender = new MessageSender();
      console.log('[Message Sender] 全局实例已创建');
    });
  } else {
    window.messageSender = new MessageSender();
    console.log('[Message Sender] 全局实例已创建');
  }
} // 结束 if (typeof window.MessageSender === 'undefined') 检查
