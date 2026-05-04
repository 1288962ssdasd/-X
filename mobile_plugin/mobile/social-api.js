// ============================================================
// social-api.js -- 社交API模块
// 职责：ImageManager + BizyAir生图 + CDN图床 + 表情包/朋友圈生图
// 运行环境：Android WebView + Node.js（不使用 ES Module、顶层 await、optional chaining 等）
// 依赖：BridgeAPI（通过 window.BridgeAPI 访问 ConfigManager）
// ============================================================

(function () {
  'use strict';

  // ===== SocialAPI（社交API） =====

  var SocialAPI = {
    // CDN图床基础URL
    CDN_BASE: 'https://cdn.jsdelivr.net/gh/1288962ssdasd/images@main',

    // 角色图片映射
    charImages: {
      '苏晚晴': { prefix: '苏晚晴', count: 16, available: [1, 2, 3, 4, 5, 6, 7, 9] },
      '柳如烟': { prefix: '柳如烟', count: 16, available: [1, 2, 3, 4, 5, 6, 7] },
      '王捷': { prefix: '王捷', count: 16, available: [1, 2, 3, 4, 5, 6, 7, 9, 10] },
      '苏媚': { prefix: '苏媚', count: 16, available: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 17, 18] },
      '吴梦娜': { prefix: '吴梦娜', count: 16, available: [1, 2, 3, 4, 5, 6, 7] }
    },

    // ===== 社交场景BizyAir预设映射 =====
    SCENE_PRESETS: {
      moments_selfie: {
        name: '朋友圈自拍',
        tags: 'selfie, phone in hand, mirror selfie, indoor, casual clothes, natural lighting',
        template: 'face_detailer',
        triggerKeywords: ['自拍', '照片', '镜子', '今天', '打卡', 'OOTD', '穿搭']
      },
      cafe_date: {
        name: '咖啡厅约会',
        tags: 'cafe, coffee shop, indoor, two people, warm lighting, coffee cup, table',
        template: 'face_detailer',
        triggerKeywords: ['咖啡', '约会', '见面', '等', '奶茶', '甜品']
      },
      live_stream: {
        name: '直播截图',
        tags: 'streaming room, LED ring light, microphone, webcam setup, gaming chair, monitor',
        template: 'legacy',
        triggerKeywords: ['直播', '开播', '观众', '打赏', '直播间', '主播']
      },
      weibo_daily: {
        name: '微博日常',
        tags: 'street, casual, outdoor, city, walking, natural lighting, lifestyle',
        template: 'face_detailer',
        triggerKeywords: ['逛街', '购物', '外出', '天气', '风景', '美食']
      },
      stage_change: {
        name: '沉沦阶段变化',
        // 根据阶段动态生成标签（见 getScenePrompt 方法）
        tags: '',
        template: 'face_detailer',
        triggerKeywords: ['沉沦', '阶段', '变化', '觉醒', '堕落']
      },
      general: {
        name: '通用场景',
        tags: '',
        template: 'legacy',
        triggerKeywords: []
      }
    },

    // 角色生图prompt映射（提取为独立属性以便复用）
    charImagePrompts: {
      '苏晚晴': '1girl, solo, long black hair, hair over one shoulder, beautiful face, delicate features, light makeup, slender body, white casual dress, gentle smile, upper body, looking at viewer, soft lighting, anime style, high quality',
      '柳如烟': '1girl, solo, short black hair, bob cut, cute face, big eyes, round face, innocent expression, shy blush, petite body, pink sundress, holding small bear plushie, upper body, bright lighting, anime style, high quality',
      '王捷': '1girl, solo, short black hair, messy hair, sharp eyes, cold expression, tall body, athletic build, black leather jacket, combat boots, arms crossed, full body, dramatic lighting, dark background, anime style, high quality',
      '苏媚': '1girl, solo, long wavy brown hair, low ponytail, gold rim glasses, intellectual beauty, calm expression, slender body, linen shirt, long skirt, bohemian style, holding a book, sitting, soft natural lighting, anime style, high quality',
      '吴梦娜': '1girl, solo, long straight black hair, mature beauty, mysterious expression, tall body, dark purple silk dress, platinum necklace, phoenix pendant, sitting on luxury sofa, upper body, dim luxury lighting, anime style, high quality'
    },

    // BizyAir配置
    _bizyAirConfig: {
      get apiKey() { return localStorage.getItem('bizyair_api_key') || ''; },
      get webAppId() { return localStorage.getItem('bizyair_web_app_id') || '44306'; },
      get templateId() { return localStorage.getItem('bizyair_active_template') || 'legacy'; },
      createUrl: 'https://api.bizyair.cn/w/v1/webapp/task/openapi/create',
      queryUrl: 'https://api.bizyair.cn/w/v1/webapp/task/openapi/query'
    },

    // ---------- 初始化 ----------

    init: function () {
      this._injectBizyAirPresets();
      this._initBizyAirListener();
      console.log('[SocialAPI] 初始化完成');
    },

    // ---------- 获取场景Prompt（社交场景BizyAir预设） ----------

    getScenePrompt: function (friendName, sceneType, extraContext) {
      var self = this;
      var preset = self.SCENE_PRESETS[sceneType] || self.SCENE_PRESETS.general;
      var basePrompt = self.charImagePrompts[friendName] || (friendName + ', anime style, high quality, beautiful');
      var sceneTags = preset.tags || '';

      // 对于 stage_change 类型，从变量读取沉沦度，动态调整标签
      if (sceneType === 'stage_change') {
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;
        // 同步读取沉沦度（使用缓存的 Promise）
        var stagePromise = ConfigManager
          ? ConfigManager._readVar('游戏数据.' + friendName + '.沉沦度')
          : Promise.resolve(null);

        return stagePromise.then(function (corruptionStr) {
          var corruption = parseInt(corruptionStr) || 0;
          var stageTags = '';

          if (corruption >= 0 && corruption <= 20) {
            stageTags = 'innocent, pure, gentle smile, white dress';
          } else if (corruption >= 21 && corruption <= 40) {
            stageTags = 'curious, slight blush, casual outfit, warm expression';
          } else if (corruption >= 41 && corruption <= 60) {
            stageTags = 'confident, direct gaze, fashionable outfit, slight smirk';
          } else if (corruption >= 61 && corruption <= 80) {
            stageTags = 'alluring, seductive pose, revealing outfit, intense gaze';
          } else if (corruption >= 81 && corruption <= 100) {
            stageTags = 'dominant, commanding presence, dark outfit, mysterious aura';
          }

          console.log('[SocialAPI] 沉沦阶段生图:', friendName, '沉沦度:', corruption, '标签:', stageTags);
          var finalPrompt = basePrompt + ', ' + stageTags;
          if (extraContext) finalPrompt += ', ' + extraContext;
          return {
            prompt: finalPrompt,
            template: preset.template,
            sceneName: preset.name
          };
        });
      }

      // 非 stage_change 类型，直接合并
      var finalPrompt = basePrompt;
      if (sceneTags) finalPrompt += ', ' + sceneTags;
      if (extraContext) finalPrompt += ', ' + extraContext;

      return Promise.resolve({
        prompt: finalPrompt,
        template: preset.template,
        sceneName: preset.name
      });
    },

    // ===== SmartImageStrategy（CDN + BizyAir智能混合策略） =====

    SmartImageStrategy: {
      // 网络状态检测
      _isOnline: true,
      _lastNetworkCheck: 0,

      checkNetwork: function () {
        var self = this;
        var now = Date.now();
        // 缓存结果60秒
        if (now - self._lastNetworkCheck < 60000) {
          return Promise.resolve(self._isOnline);
        }
        self._lastNetworkCheck = now;
        // 简单的网络检测：尝试fetch一个小资源
        return fetch('https://cdn.jsdelivr.net/gh/1288962ssdasd/images@main/favicon.ico', {
          method: 'HEAD',
          cache: 'no-store'
        }).then(function () {
          self._isOnline = true;
          return true;
        }).catch(function () {
          self._isOnline = false;
          return false;
        });
      },

      // BizyAir冷却管理
      _lastBizyAirTime: 0,
      _cooldownMs: 30000, // 30秒冷却

      isBizyAirReady: function () {
        var now = Date.now();
        var elapsed = now - this._lastBizyAirTime;
        return elapsed >= this._cooldownMs;
      },

      markBizyAirUsed: function () {
        this._lastBizyAirTime = Date.now();
      },

      // 智能选择图片源
      // priority: 'user_manual' > 'bizyair' > 'cdn'
      // 返回 Promise<'bizyair' | 'cdn'>
      selectImageSource: function (friendName, sceneType, priority) {
        var self = this;
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;

        // 1. 如果优先级是 user_manual，返回 'cdn'（用户手动发的图直接用）
        if (priority === 'user_manual') {
          return Promise.resolve('cdn');
        }

        // 2. 检查网络状态
        return self.checkNetwork().then(function (online) {
          if (!online) {
            console.log('[SocialAPI] 网络不可用，使用CDN');
            return 'cdn';
          }

          // 3. 检查 BizyAir 是否启用（从 ConfigManager 读取）
          var enabledPromise = ConfigManager
            ? ConfigManager.get('xb.phone.bizyair.enabled')
            : Promise.resolve('false');

          return enabledPromise.then(function (bizyEnabled) {
            if (bizyEnabled !== 'true') {
              console.log('[SocialAPI] BizyAir未启用，使用CDN');
              return 'cdn';
            }

            // 4. 检查 BizyAir 冷却
            if (!self.isBizyAirReady()) {
              var remaining = Math.ceil((self._cooldownMs - (Date.now() - self._lastBizyAirTime)) / 1000);
              console.log('[SocialAPI] BizyAir冷却中，剩余', remaining, '秒，使用CDN');
              return 'cdn';
            }

            // 5. 检查 API Key 是否配置
            var apiKey = localStorage.getItem('bizyair_api_key') || '';
            if (!apiKey) {
              console.log('[SocialAPI] BizyAir API Key未配置，使用CDN');
              return 'cdn';
            }

            // 6. 全部通过返回 'bizyair'
            console.log('[SocialAPI] 选择BizyAir生图，场景:', sceneType);
            return 'bizyair';
          });
        });
      },

      // 获取图片（统一入口）
      // options: { priority, forceSource, bubbleEl }
      // 返回 Promise<string|null>（图片URL）
      getImage: function (friendName, sceneType, options) {
        options = options || {};
        var self = this;
        var SocialAPI = window.SocialAPI;

        // 如果强制指定来源
        if (options.forceSource === 'cdn') {
          return Promise.resolve(SocialAPI.getCdnUrl(friendName));
        }
        if (options.forceSource === 'bizyair') {
          return SocialAPI.getScenePrompt(friendName, sceneType).then(function (sceneData) {
            self.markBizyAirUsed();
            return SocialAPI.generateBizyAirImage(friendName, null, {
              template: sceneData.template,
              description: sceneData.prompt
            });
          });
        }

        // 智能选择
        return self.selectImageSource(friendName, sceneType, options.priority).then(function (source) {
          if (source === 'bizyair') {
            return SocialAPI.getScenePrompt(friendName, sceneType).then(function (sceneData) {
              console.log('[SocialAPI] BizyAir场景生图:', sceneData.sceneName);
              self.markBizyAirUsed();
              return SocialAPI.generateBizyAirImage(friendName, null, {
                template: sceneData.template,
                description: sceneData.prompt
              }).then(function (bizyUrl) {
                if (bizyUrl) return bizyUrl;
                // BizyAir失败，回退CDN
                console.log('[SocialAPI] BizyAir生图失败，回退CDN');
                return SocialAPI.getCdnUrl(friendName);
              });
            });
          } else {
            return SocialAPI.getCdnUrl(friendName);
          }
        });
      }
    },

    // ===== ImageTriggerRules（生图触发规则） =====

    ImageTriggerRules: {
      // 分析聊天内容，判断是否需要生图
      // role: 'user' 或 'assistant'
      // 返回 { shouldGenerate: boolean, sceneType: string, confidence: number }
      analyzeMessage: function (message, role) {
        var self = this;
        var SocialAPI = window.SocialAPI;
        var result = { shouldGenerate: false, sceneType: 'general', confidence: 0 };

        if (!message || typeof message !== 'string') return result;

        // 规则1: 用户消息中包含场景关键词 → 可能需要生图（confidence 0.6）
        if (role === 'user') {
          var presets = SocialAPI.SCENE_PRESETS;
          var presetKeys = Object.keys(presets);
          for (var i = 0; i < presetKeys.length; i++) {
            var key = presetKeys[i];
            if (key === 'general') continue;
            var keywords = presets[key].triggerKeywords || [];
            for (var j = 0; j < keywords.length; j++) {
              if (message.indexOf(keywords[j]) !== -1) {
                return { shouldGenerate: true, sceneType: key, confidence: 0.6 };
              }
            }
          }
        }

        // 规则2: AI消息中包含[图片]或[自拍]等标记 → 需要生图（confidence 0.9）
        if (role === 'assistant') {
          if (/\[图片[：:]/.test(message) || /\[自拍\]/.test(message) ||
              /\[朋友圈图\]/.test(message) || /\[直播截图\]/.test(message)) {
            return { shouldGenerate: true, sceneType: 'moments_selfie', confidence: 0.9 };
          }
        }

        // 规则3: AI消息中包含表情动作描述（如*苏晚晴对着镜头比了个耶*）→ 可能需要生图（confidence 0.5）
        if (role === 'assistant') {
          var actionPattern = /\*[^\*]+(比|镜头|拍照|自拍|微笑|笑|看|转头|摆)[^\*]+\*/;
          if (actionPattern.test(message)) {
            return { shouldGenerate: true, sceneType: 'moments_selfie', confidence: 0.5 };
          }
        }

        // 规则4: 朋友圈相关消息 → 朋友圈生图（confidence 0.8）
        if (message.indexOf('朋友圈') !== -1 || message.indexOf('动态') !== -1 ||
            message.indexOf('发个') !== -1) {
          return { shouldGenerate: true, sceneType: 'moments_selfie', confidence: 0.8 };
        }

        // 规则5: 普通闲聊 → 不需要生图
        return result;
      },

      // 从AI回复中提取图片标记
      // 返回匹配结果数组
      extractImageMarkers: function (aiMessage) {
        var markers = [];
        if (!aiMessage || typeof aiMessage !== 'string') return markers;

        // [图片:描述] → { type: 'custom', description: '描述' }
        var customPattern = /\[图片[：:]([^\]]+)\]/g;
        var customMatch;
        while ((customMatch = customPattern.exec(aiMessage)) !== null) {
          markers.push({ type: 'custom', description: customMatch[1] });
        }

        // [自拍] → { type: 'selfie', sceneType: 'moments_selfie' }
        if (/\[自拍\]/.test(aiMessage)) {
          markers.push({ type: 'selfie', sceneType: 'moments_selfie' });
        }

        // [朋友圈图] → { type: 'moments', sceneType: 'moments_selfie' }
        if (/\[朋友圈图\]/.test(aiMessage)) {
          markers.push({ type: 'moments', sceneType: 'moments_selfie' });
        }

        // [直播截图] → { type: 'live', sceneType: 'live_stream' }
        if (/\[直播截图\]/.test(aiMessage)) {
          markers.push({ type: 'live', sceneType: 'live_stream' });
        }

        return markers;
      },

      // 自动生图入口
      // 返回 Promise<string|null>（图片URL或null）
      autoGenerateIfNeeded: function (friendName, aiMessage) {
        var self = this;
        var SocialAPI = window.SocialAPI;
        var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;

        // 1. 调用 extractImageMarkers 检查标记
        var markers = self.extractImageMarkers(aiMessage);

        if (markers.length > 0) {
          // 有标记，根据类型生图
          var marker = markers[0]; // 使用第一个标记
          var sceneType = marker.sceneType || 'general';
          console.log('[SocialAPI] 检测到图片标记:', marker.type, '场景:', sceneType);

          if (marker.type === 'custom') {
            // 自定义描述生图
            return SocialAPI.generateBizyAirImage(friendName, null, {
              description: marker.description
            });
          }

          // 其他标记类型，使用SmartImageStrategy
          return SocialAPI.SmartImageStrategy.getImage(friendName, sceneType, {
            priority: 'bizyair'
          });
        }

        // 2. 如果没有标记，检查是否启用自动生图
        var autoGenPromise = ConfigManager
          ? ConfigManager.get('xb.phone.bizyair.autoGenerate')
          : Promise.resolve('true');

        return autoGenPromise.then(function (autoGen) {
          if (autoGen !== 'true') return null;

          // 3. 调用 analyzeMessage 检查是否需要自动生图
          var analysis = self.analyzeMessage(aiMessage, 'assistant');
          if (!analysis.shouldGenerate) return null;

          // 4. 根据概率决定是否生图（从 ConfigManager 读取概率配置）
          var probPromise = ConfigManager
            ? ConfigManager.get('xb.phone.bizyair.triggerProbability')
            : Promise.resolve('30');

          return probPromise.then(function (probStr) {
            var prob = parseInt(probStr) || 30;
            // confidence 越高，实际概率越高
            var adjustedProb = prob * analysis.confidence;
            if (Math.random() * 100 < adjustedProb) {
              console.log('[SocialAPI] 自动生图触发，场景:', analysis.sceneType,
                '置信度:', analysis.confidence, '调整后概率:', Math.round(adjustedProb) + '%');
              return SocialAPI.SmartImageStrategy.getImage(friendName, analysis.sceneType, {
                priority: 'bizyair'
              });
            }
            return null;
          });
        });
      }
    },

    // ---------- 获取CDN图片URL ----------

    getCdnUrl(friendName, index) {
      var info = this.charImages[friendName];
      if (!info) return null;
      var nums = info.available || [];
      if (nums.length === 0) {
        // 生成001到count的编号
        for (var n = 1; n <= info.count; n++) nums.push(n);
      }
      var imgNum = (index !== undefined) ? index : nums[Math.floor(Math.random() * nums.length)];
      var padded = imgNum < 10 ? '00' + imgNum : '0' + imgNum;
      return this.CDN_BASE + '/' + info.prefix + '_' + padded + '.jpg';
    },

    // ---------- 在聊天中插入图片（使用SmartImageStrategy） ----------

    insertImage: function (bubbleEl, friendName, options) {
      options = options || {};
      var self = this;
      var ConfigManager = window.BridgeAPI ? window.BridgeAPI.ConfigManager : null;

      var enabledPromise = ConfigManager ? ConfigManager.get('xb.phone.image.autoInsert') : Promise.resolve('true');
      return enabledPromise.then(function (enabled) {
        if (enabled === 'false') return;

        // 从变量读取当前场景
        var scenePromise = ConfigManager ? ConfigManager.get('xb.game.scene') : Promise.resolve('翡翠湾小区');
        return scenePromise.then(function (scene) {
          scene = scene || '翡翠湾小区';

          // 场景到 sceneType 的映射
          var sceneToTypeMap = {
            '翡翠湾小区': 'general',
            '咖啡店': 'cafe_date',
            '商场': 'weibo_daily',
            '公司': 'general',
            '酒吧': 'general',
            '酒店': 'general'
          };
          var sceneType = options.sceneType || sceneToTypeMap[scene] || 'general';

          console.log('[SocialAPI] insertImage:', friendName, '场景:', scene, 'sceneType:', sceneType);

          // 使用 SmartImageStrategy 获取图片
          return self.SmartImageStrategy.getImage(friendName, sceneType, {
            priority: options.priority,
            forceSource: options.forceSource
          }).then(function (url) {
            if (!url) return;

            console.log('[SocialAPI] 图片已获取:', url.substring(0, 60));

            // 插入图片到气泡
            var textEl = bubbleEl.querySelector('.message-text');
            if (textEl) {
              var imgHtml = '<br><img src="' + url + '" ' +
                  'style="max-width:180px;border-radius:8px;cursor:pointer;display:block;margin-top:6px;" ' +
                  'onclick="window.independentAI._enlargeImage(this)" ' +
                  'onerror="this.style.display=\'none\'" loading="lazy" />';
              textEl.innerHTML += imgHtml;
              console.log('[SocialAPI] 图片已插入气泡');
            }
          }).catch(function (e) {
            console.warn('[SocialAPI] insertImage异常:', e);
          });
        });
      });
    }, // end of insertImage

    // ---------- BizyAir生图 ----------

    generateBizyAirImage: function (friendName, callback, options) {
      options = options || {};
      var config = this._bizyAirConfig;
      var apiKey = config.apiKey;
      if (!apiKey) {
        console.warn('[SocialAPI] BizyAir API Key未配置');
        return null;
      }

      var templateId = options.template || config.templateId;
      var webAppId = parseInt(config.webAppId, 10) || 44306;

      // 角色生图prompt映射（使用已提取的 charImagePrompts 属性）
      var description = options.description || this.charImagePrompts[friendName] || (friendName + ', anime style, high quality, beautiful');

      // 模板配置
      var templates = {
        legacy: {
          webAppId: 44306,
          positiveKey: '31:CLIPTextEncode.text',
          negativeKey: '32:CLIPTextEncode.text',
          outputIndexFromEnd: 1,
          negativePrompt: 'blurry, noisy, messy, lowres, jpeg, artifacts, text, watermark',
          params: {
            '27:KSampler.seed': Math.floor(Math.random() * 999999999),
            '27:KSampler.steps': 20,
            '27:KSampler.sampler_name': 'euler_ancestral',
            '61:CM_SDXLExtendedResolution.resolution': '832x1216',
            '69:DF_Latent_Scale_by_ratio.modifier': 1.2,
            '54:EmptyLatentImage.batch_size': 1,
            '57:dynamicThresholdingFull.mimic_scale': 8
          }
        },
        face_detailer: {
          webAppId: 47362,
          positiveKey: '93:CLIPTextEncode.text',
          negativeKey: '55:CLIPTextEncode.text',
          outputIndexFromEnd: 1,
          negativePrompt: 'text, watermark, worst quality',
          params: {
            '47:EmptyLatentImage.width': 960,
            '47:EmptyLatentImage.height': 1280,
            '47:EmptyLatentImage.batch_size': 1,
            '27:KSampler.seed': Math.floor(Math.random() * 999999999),
            '89:FaceDetailer.steps': 20,
            '89:FaceDetailer.seed': Math.floor(Math.random() * 999999999),
            '89:FaceDetailer.cfg': 7,
            '89:FaceDetailer.sampler_name': 'euler',
            '89:FaceDetailer.scheduler': 'simple',
            '74:LatentUpscaleBy.scale_by': 1.5
          }
        },
        zimage: {
          webAppId: 48570,
          positiveKey: '6:CLIPTextEncode.text',
          negativeKey: '7:CLIPTextEncode.text',
          outputIndexFromEnd: 1,
          negativePrompt: 'blurry ugly bad',
          params: {
            '3:KSampler.seed': Math.floor(Math.random() * 999999999),
            '3:KSampler.steps': 10,
            '3:KSampler.cfg': 1,
            '3:KSampler.sampler_name': 'euler',
            '3:KSampler.scheduler': 'simple',
            '3:KSampler.denoise': 1,
            '13:EmptySD3LatentImage.width': 1024,
            '13:EmptySD3LatentImage.height': 1024,
            '13:EmptySD3LatentImage.batch_size': 1
          }
        }
      };

      var tmpl = templates[templateId] || templates.legacy;
      webAppId = tmpl.webAppId || webAppId;

      // 深拷贝参数
      var params = JSON.parse(JSON.stringify(tmpl.params));

      // 应用自定义参数
      if (options.width) {
        var widthKeys = Object.keys(params).filter(function (k) { return k.indexOf('width') !== -1; });
        if (widthKeys.length > 0) params[widthKeys[0]] = options.width;
      }
      if (options.height) {
        var heightKeys = Object.keys(params).filter(function (k) { return k.indexOf('height') !== -1; });
        if (heightKeys.length > 0) params[heightKeys[0]] = options.height;
        if (options.width) {
          var resKeys = Object.keys(params).filter(function (k) { return k.indexOf('resolution') !== -1; });
          if (resKeys.length > 0) params[resKeys[0]] = options.width + 'x' + options.height;
        }
      }
      if (options.steps) {
        var stepsKeys = Object.keys(params).filter(function (k) { return k.indexOf('steps') !== -1; });
        if (stepsKeys.length > 0) params[stepsKeys[0]] = options.steps;
      }

      if (tmpl.positiveKey) params[tmpl.positiveKey] = description;
      if (tmpl.negativeKey) params[tmpl.negativeKey] = tmpl.negativePrompt || '';

      console.log('[SocialAPI] BizyAir生成中:', templateId, description.substring(0, 60) + '...');

      var createRespPromise = fetch(config.createUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            web_app_id: webAppId,
            suppress_preview_output: true,
            input_values: params
          })
        });

        return createRespPromise.then(function (createResp) {
          return createResp.json().then(function (createResult) {
            if (!createResp.ok) {
              console.error('[SocialAPI] BizyAir创建失败:', createResult.message || createResult.error);
              return null;
            }

            var imageUrl = null;
            if (createResult.outputs && Array.isArray(createResult.outputs) && createResult.outputs.length > 0) {
              var fromEnd = tmpl.outputIndexFromEnd || 1;
              var idx = createResult.outputs.length - fromEnd;
              if (idx < 0) idx = createResult.outputs.length - 1;
              imageUrl = createResult.outputs[idx].object_url;
              return imageUrl;
            } else if (createResult.request_id) {
              var taskId = createResult.request_id;
              console.log('[SocialAPI] BizyAir任务已创建，轮询中:', taskId);
              return pollTask(taskId);
            }
            return null;
          });
        }).catch(function (err) {
          console.error('[SocialAPI] BizyAir生成失败:', err);
          return null;
        });

        function pollTask(taskId) {
          return new Promise(function (resolve) { setTimeout(resolve, 2000); }).then(function () {
            return fetch(config.queryUrl + '?task_id=' + taskId, {
              headers: { 'Authorization': 'Bearer ' + apiKey }
            });
          }).then(function (queryResp) {
            return queryResp.json();
          }).then(function (queryData) {
            if (queryData.status === 'Success' && queryData.outputs && queryData.outputs.length > 0) {
              var fromEnd2 = tmpl.outputIndexFromEnd || 1;
              var idx2 = queryData.outputs.length - fromEnd2;
              if (idx2 < 0) idx2 = queryData.outputs.length - 1;
              var imageUrl = queryData.outputs[idx2].object_url;
              if (imageUrl) {
                console.log('[SocialAPI] BizyAir图片已生成:', imageUrl);
              }
              return imageUrl;
            } else if (queryData.status === 'failed') {
              console.error('[SocialAPI] BizyAir任务失败:', queryData.error);
              return null;
            } else {
              // 任务仍在处理中，自动继续轮询（最多重试10次，每次间隔3秒）
              if (!pollTask._pollCount) pollTask._pollCount = 0;
              pollTask._pollCount++;
              if (pollTask._pollCount < 10) {
                return new Promise(function (resolve) {
                  setTimeout(function () {
                    pollTask(taskId).then(function (result) {
                      resolve(result);
                    });
                  }, 3000);
                });
              } else {
                pollTask._pollCount = 0;
                console.warn('[SocialAPI] BizyAir 任务轮询超时:', taskId);
                return null;
              }
            }
          });
        }
    },

    // ---------- 生成图片后通过ST发送 ----------

    generateAndSendBizyImage: function (description) {
      var self = this;
      return self.generateBizyAirImage(null, null, { description: description }).then(function (imageUrl) {
        if (!imageUrl) return null;
        var mdImage = '![' + description + '](' + imageUrl + ')';
        try {
          if (window.STscript) {
            return window.STscript('/send ' + mdImage).then(function () {
              return imageUrl;
            });
          }
        } catch (e) {
          console.warn('[SocialAPI] STscript发送失败:', e);
        }
        return imageUrl;
      });
    },

    // ---------- 朋友圈生图 ----------

    generateFriendCircleImage: function (friendName) {
      return this.generateBizyAirImage(friendName, null, { template: 'face_detailer' });
    },

    // ---------- 表情包生图 ----------

    generateStickerImage: function (friendName, emotion) {
      var emotionPrompts = {
        '开心': 'chibi, cute, happy, smiling, laughing, sparkles, joyful expression',
        '生气': 'chibi, cute, angry, pouting, annoyed expression, crossed arms, fuming',
        '害羞': 'chibi, cute, shy, blushing, covering face, peeking, embarrassed',
        '伤心': 'chibi, cute, sad, crying, tears, puppy eyes, heartbroken',
        '惊讶': 'chibi, cute, surprised, shocked, wide eyes, open mouth, gasping',
        '撒娇': 'chibi, cute, pleading, puppy eyes, hands together, begging',
        '无语': 'chibi, cute, speechless, deadpan, sweatdrop, blank stare',
        '爱心': 'chibi, cute, love, heart eyes, holding heart, romantic, blush',
        '默认': 'chibi, cute, casual, relaxed, peace sign, friendly smile'
      };
      var charBaseFeatures = {
        '苏晚晴': 'long black hair, hair over one shoulder',
        '柳如烟': 'short black hair, bob cut',
        '王捷': 'short black hair, messy hair',
        '苏媚': 'long wavy brown hair, low ponytail, glasses',
        '吴梦娜': 'long straight black hair'
      };
      var emotionPrompt = emotionPrompts[emotion] || emotionPrompts['默认'];
      var charFeature = charBaseFeatures[friendName] || '';
      var fullPrompt = '1girl, solo, ' + charFeature + ', ' + emotionPrompt + ', anime style, high quality, white background, sticker';
      console.log('[SocialAPI] 生成表情包:', friendName, '情绪:', emotion);
      return this.generateBizyAirImage(friendName, null, {
        template: 'legacy', width: 512, height: 512, steps: 10,
        description: fullPrompt
      });
    },

    // ---------- BizyAir预设注入 ----------

    _injectBizyAirPresets() {
      function inject() {
        var existingTask = localStorage.getItem('bizyair_prompt_task');
        if (existingTask) {
          try {
            var parsed = JSON.parse(existingTask);
            if (Array.isArray(parsed) && parsed.length > 0) return;
          } catch (e) { /* 数据损坏，重新注入 */ }
        }

        var jailbreak = {
          id: 'qr_jb_001', name: 'QuickReply生图越狱', active: true, history: [],
          content: '你是一个专业的AI绘图提示词生成器。你的任务是根据聊天上下文，为每个角色生成适合的Stable Diffusion提示词。\n\n输出格式要求（严格遵守）：\n<角色>英文提示词</角色>\n<定位>中文场景描述（用于在聊天中定位插入位置）</定位>\n\n提示词规则：\n1. 使用英文逗号分隔的标签格式\n2. 包含：角色外貌特征 + 服装 + 表情 + 场景 + 风格\n3. 固定后缀：anime style, high quality, masterpiece\n4. 不要包含负面提示词\n5. 每次只生成一组 <角色>...</角色><定位>...</定位>'
        };
        var task = {
          id: 'qr_task_001', name: '日常生图', active: true, history: [],
          content: '根据最近的聊天上下文，判断是否需要生成配图。\n\n规则：\n1. 分析最近2条消息的内容和氛围\n2. 如果场景适合配图（约会、见面、特殊事件等），生成提示词\n3. 如果只是普通闲聊，输出：跳过\n4. 生成的图片要符合当前场景和角色情绪\n5. 定位文本选择聊天中最近的场景描述句子\n6. 每次只生成一张图'
        };
        var characters = [
          { id: 'qr_char_sq', name: '苏晚晴', active: true, history: [], content: '苏晚晴：20岁女主播，清纯外表下隐藏心机。外貌：黑色长发，大眼睛，白皙皮肤，身材纤细。常见服装：白色连衣裙、直播装、休闲装。表情：甜美微笑、撒娇、偶尔冷酷。性格关键词：表面清纯、内心算计、主播腔。' },
          { id: 'qr_char_lry', name: '柳如烟', active: true, history: [], content: '柳如烟：22岁，温柔内向的咖啡店员。外貌：黑色短发，可爱脸蛋，小巧身材。常见服装：围裙工作服、休闲装、碎花裙。表情：害羞、温柔微笑、偶尔哭泣。性格关键词：温柔、内向、容易害羞、单纯。' },
          { id: 'qr_char_wj', name: '王捷', active: true, history: [], content: '王捷：25岁，冷漠的神秘男子。外貌：黑色短发，锐利眼神，身材高大。常见服装：黑色西装、休闲衬衫、皮夹克。表情：冷漠、偶尔微笑、严肃。性格关键词：冷漠、神秘、保护欲强、少言。' },
          { id: 'qr_char_sm', name: '苏媚', active: true, history: [], content: '苏媚：28岁，知性优雅的作家/记者。外貌：黑色长卷发，知性气质，身材丰满。常见服装：职业装、文艺长裙、眼镜。表情：优雅微笑、思考、偶尔挑逗。性格关键词：知性、优雅、理性、暗藏热情。' },
          { id: 'qr_char_wmn', name: '吴梦娜', active: true, history: [], content: '吴梦娜：26岁，神秘组织的核心人物。外貌：黑色长发，妩媚眼神，性感身材。常见服装：黑色紧身装、晚礼服、皮衣。表情：神秘微笑、挑逗、冷酷。性格关键词：神秘、性感、掌控欲强、危险。' }
        ];

        localStorage.setItem('bizyair_prompt_jailbreak', JSON.stringify([jailbreak]));
        localStorage.setItem('bizyair_prompt_task', JSON.stringify([task]));
        localStorage.setItem('bizyair_prompt_char', JSON.stringify(characters));
        console.log('[SocialAPI] BizyAir预设已注入');
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(inject, 3000); });
      } else {
        setTimeout(inject, 3000);
      }
    },

    // ---------- BizyAir图片结果监听 ----------

    _initBizyAirListener() {
      function syncImageToPhone(imageUrl) {
        if (!imageUrl || typeof imageUrl !== 'string') return;
        var phoneContainer = document.querySelector('.messages-container') ||
            document.querySelector('[data-app="messages"] .message-list');
        if (!phoneContainer) return;

        var placeholders = phoneContainer.querySelectorAll('.message-bubble .message-text');
        var replaced = false;
        for (var i = 0; i < placeholders.length; i++) {
          if (replaced) break;
          var textEl = placeholders[i];
          var text = (textEl.textContent || '').trim();
          if (/^\[图片[|】\]]/.test(text) || text === '图片加载中...' ||
              (text.startsWith('http') && text.endsWith('.jpg'))) {
            if (textEl.dataset.bizyairReplaced) continue;
            textEl.dataset.bizyairReplaced = '1';
            textEl.innerHTML = '<img src="' + imageUrl + '" ' +
                'style="max-width:200px;border-radius:8px;cursor:pointer;display:block;" ' +
                'onclick="window.independentAI._enlargeImage(this)" ' +
                'onerror="this.style.display=\'none\'" loading="lazy" />';
            console.log('[SocialAPI] BizyAir图片已同步:', imageUrl.substring(0, 60));
            replaced = true;
          }
        }
      }

      var bizyairObserver = new MutationObserver(function (mutations) {
        for (var mi = 0; mi < mutations.length; mi++) {
          var addedNodes = mutations[mi].addedNodes;
          for (var ni = 0; ni < addedNodes.length; ni++) {
            var node = addedNodes[ni];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'IMG' && node.classList.contains('bizyair-result-img')) {
              syncImageToPhone(node.src); continue;
            }
            var img = node.querySelector && node.querySelector('img.bizyair-result-img');
            if (img) { syncImageToPhone(img.src); continue; }
            if (node.classList && node.classList.contains('bizyair-result-wrapper')) {
              var resultImg = node.querySelector('img');
              if (resultImg) syncImageToPhone(resultImg.src);
            }
          }
        }
      });
      bizyairObserver.observe(document.body, { childList: true, subtree: true });

      // 初始扫描
      setTimeout(function () {
        var imgs = document.querySelectorAll('img.bizyair-result-img');
        for (var i = 0; i < imgs.length; i++) {
          syncImageToPhone(imgs[i].src);
        }
      }, 5000);
    }
  };

  // ===== 挂载全局 =====
  window.SocialAPI = SocialAPI;
  window.ImageManager = SocialAPI;

  console.log('[SocialAPI] 模块已加载');
})();
