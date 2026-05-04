// ==Phone TTS Integration Module==
// @name         Phone TTS
// @version      1.0.0
// @description  TTS playback for mobile phone voice messages via CatboxTTS backend
// @author       SOLO
// @license      MIT

class PhoneTTS {
    constructor() {
        this._pollTimer = null;
        this._ttsConfig = {
            baseUrl: 'http://127.0.0.1:1221',
            ttsEndpoint: '/api/tts',
            timeoutMs: 30000,
            defaultVoice: 'zh-CN-YunxiNeural',
            defaultSpeed: 50,
            defaultPitch: 100
        };
        this._voiceMap = {
            // Map character names to voice IDs
            // Users can customize this via window.phoneTTS.setVoiceMap()
        };
        window.phoneTTS = this;
        console.log('[PhoneTTS] Module created');
    }

    // ========== Config ==========

    getConfig() {
        // Try to read from CatboxTTS config if available
        if (window.config) {
            const catboxConfig = window.config;
            return {
                baseUrl: catboxConfig.directTtsUrl
                    ? catboxConfig.directTtsUrl.replace(/\/api\/tts$/, '')
                    : this._ttsConfig.baseUrl,
                ttsEndpoint: '/api/tts',
                timeoutMs: catboxConfig.requestTimeoutMs || this._ttsConfig.timeoutMs,
                defaultVoice: catboxConfig.defaultVoice || this._ttsConfig.defaultVoice,
                defaultSpeed: catboxConfig.speechRate || this._ttsConfig.defaultSpeed,
                defaultPitch: catboxConfig.pitch || this._ttsConfig.defaultPitch,
                requestMode: catboxConfig.requestMode || 'direct',
                bridgeServer: catboxConfig.bridgeServer || 'http://127.0.0.1:3002',
                globalHeaders: catboxConfig.globalHeaders || ''
            };
        }
        return this._ttsConfig;
    }

    setVoiceMap(map) {
        this._voiceMap = map;
        console.log('[PhoneTTS] Voice map updated:', Object.keys(map));
    }

    getVoiceForCharacter(charName) {
        return this._voiceMap[charName] || this.getConfig().defaultVoice;
    }

    // ========== Core: Synthesize ==========

    async synthesize(text, voiceId) {
        const config = this.getConfig();
        const voice = voiceId || config.defaultVoice;

        if (!text || !text.trim()) {
            throw new Error('No text to synthesize');
        }

        const requestMode = config.requestMode || 'direct';
        let targetUrl;
        let requestBody;

        if (requestMode === 'direct') {
            targetUrl = config.baseUrl + config.ttsEndpoint;
            requestBody = {
                text: text.trim(),
                engine: '',
                locale: '',
                voice: voice,
                speed: config.defaultSpeed,
                pitch: config.defaultPitch
            };
        } else {
            // bridge mode (compatible with CatboxTTS bridge)
            targetUrl = config.bridgeServer + '/tts';
            requestBody = {
                text: text.trim(),
                voice: voice,
                rate: config.defaultSpeed,
                pitch: config.defaultPitch,
                stream: true
            };
        }

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'audio/wav, audio/mpeg, */*'
        };

        // Parse global headers from CatboxTTS config
        if (config.globalHeaders) {
            try {
                const customHeaders = this._parseGlobalHeaders(config.globalHeaders);
                Object.assign(headers, customHeaders);
            } catch (e) {
                console.warn('[PhoneTTS] Failed to parse global headers:', e);
            }
        }

        console.log('[PhoneTTS] Synthesizing:', text.substring(0, 50) + '...', 'voice:', voice);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

        try {
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error('TTS Error ' + response.status + ': ' + errorText.substring(0, 200));
            }

            const audioBlob = await response.blob();
            console.log('[PhoneTTS] Audio received:', audioBlob.size, 'bytes');
            return audioBlob;
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                throw new Error('TTS timeout');
            }
            throw err;
        }
    }

    // ========== Core: Play (system mode - backend plays directly, no audio stream back) ==========

    async play(text, voiceId, onStateChange) {
        const config = this.getConfig();
        const voice = voiceId || config.defaultVoice;

        if (!text || !text.trim()) {
            throw new Error('No text to speak');
        }

        if (onStateChange) onStateChange('loading');

        try {
            // Use system speak endpoint - backend synthesizes and plays directly
            const speakUrl = config.baseUrl + '/api/tts/speak';
            const requestBody = {
                text: text.trim(),
                voice: voice,
                speed: config.defaultSpeed,
                pitch: config.defaultPitch
            };

            const headers = { 'Content-Type': 'application/json' };
            if (config.globalHeaders) {
                try {
                    Object.assign(headers, this._parseGlobalHeaders(config.globalHeaders));
                } catch (e) { /* skip */ }
            }

            console.log('[PhoneTTS] System speak:', text.substring(0, 50) + '...', 'voice:', voice);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

            const response = await fetch(speakUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error('TTS Error ' + response.status + ': ' + errorText.substring(0, 200));
            }

            if (onStateChange) onStateChange('playing');

            // Poll status until playback ends
            this._pollPlaybackStatus(onStateChange);

        } catch (err) {
            console.error('[PhoneTTS] Play failed:', err);
            if (onStateChange) onStateChange('error');
            throw err;
        }
    }

    async _pollPlaybackStatus(onStateChange) {
        const config = this.getConfig();
        const statusUrl = config.baseUrl + '/api/tts/status';

        const poll = async () => {
            try {
                const response = await fetch(statusUrl, { method: 'GET' });
                if (!response.ok) return;

                const status = await response.json();
                if (status && status.playing === false) {
                    if (onStateChange) onStateChange('ended');
                    return;
                }
                // Still playing, poll again after 500ms
                this._pollTimer = setTimeout(poll, 500);
            } catch (e) {
                // Stop polling on error
                if (onStateChange) onStateChange('ended');
            }
        };

        // Start polling after a short delay to let backend start playing
        this._pollTimer = setTimeout(poll, 1000);
    }

    stop() {
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        // Stop backend playback
        const config = this.getConfig();
        fetch(config.baseUrl + '/api/tts/stop', { method: 'POST' }).catch(() => {});
        // Reset all voice bubble states
        document.querySelectorAll('.phone-tts-playing').forEach(el => {
            el.classList.remove('phone-tts-playing');
        });
    }

    // ========== UI: Bind Click Events ==========

    bindVoiceBubbleEvents() {
        // 直接在document上监听，不依赖特定容器选择器
        if (this._eventsBound) {
            console.log('[PhoneTTS] 事件已绑定，跳过');
            return;
        }
        this._eventsBound = true;

        document.addEventListener('click', (e) => {
            console.log('[PhoneTTS-DEBUG] document点击, target:', e.target.className, e.target.tagName, e.target.textContent.substring(0, 50));
            
            // 向上查找语音消息气泡（多种选择器）
            const voiceBubble = e.target.closest(
                '.message-detail[data-msg-type="语音"], ' +
                '.message-detail[title="语音"], ' +
                '.message-detail[data-msg-type="voice"], ' +
                '.message-detail[title="voice"], ' +
                '.message-detail .voice-bubble, ' +
                '.voice-message, ' +
                '.message-detail[data-type*="语音"], ' +
                '.message-detail[data-type*="voice"], ' +
                '.message-detail[data-msg-type*="语音"]'
            );
            console.log('[PhoneTTS-DEBUG] voiceBubble:', !!voiceBubble);
            
            let targetBubble = voiceBubble;
            if (!targetBubble) {
                // 回退：检查是否在消息气泡内
                const msgDetail = e.target.closest('.message-detail');
                if (msgDetail) {
                    console.log('[PhoneTTS-DEBUG] msgDetail dataset:', JSON.stringify(msgDetail.dataset));
                    console.log('[PhoneTTS-DEBUG] msgDetail HTML前300字:', msgDetail.innerHTML.substring(0, 300));
                    const msgText = msgDetail.querySelector('.message-text');
                    if (msgText && (
                        msgText.textContent.includes('🎤') ||
                        msgText.textContent.includes('[语音消息]') ||
                        msgText.textContent.includes('语音') ||
                        msgDetail.innerHTML.includes('voice') ||
                        msgDetail.innerHTML.includes('语音')
                    )) {
                        targetBubble = msgDetail;
                        console.log('[PhoneTTS-DEBUG] 回退匹配成功');
                    }
                }
            }
            if (!targetBubble) {
                console.log('[PhoneTTS-DEBUG] ❌ 非语音气泡，跳过');
                return;
            }
            console.log('[PhoneTTS-DEBUG] ✅ 语音气泡匹配成功');

            // Extract text content from the bubble
            const textEl = targetBubble.querySelector('.message-text, .voice-content');
            console.log('[PhoneTTS-DEBUG] textEl:', !!textEl);
            if (!textEl) {
                console.log('[PhoneTTS-DEBUG] ❌ 找不到.message-text/.voice-content');
                // 回退：直接取targetBubble的文本
                var fallbackText = targetBubble.textContent.trim();
                console.log('[PhoneTTS-DEBUG] 回退文本:', fallbackText.substring(0, 100));
                if (fallbackText && fallbackText.length > 1) {
                    this._doTTS(targetBubble, fallbackText);
                }
                return;
            }

            // 优先读取 data-tts-text 属性（由 independent-ai.js 设置的消息内容）
            var text = textEl.getAttribute('data-tts-text') || textEl.dataset.ttsText || '';
            console.log('[PhoneTTS-DEBUG] data-tts-text:', text ? text.substring(0, 50) : '(空)');
            if (!text) {
                text = textEl.textContent.trim();
            }
            console.log('[PhoneTTS-DEBUG] textContent:', text ? text.substring(0, 100) : '(空)');
            // 过滤掉纯时间格式（如 0:01、1:23），尝试从子元素中获取真实文本
            if (/^\d{1,2}:\d{2}$/.test(text)) {
                console.log('[PhoneTTS-DEBUG] ⚠️ 文本是时间格式，尝试查找真实内容');
                // 遍历所有子元素，跳过时间节点，找到有实际内容的文本
                var allSpans = textEl.querySelectorAll('span, div, p');
                for (var si = 0; si < allSpans.length; si++) {
                    var spanText = allSpans[si].textContent.trim();
                    if (spanText && !/^\d{1,2}:\d{2}$/.test(spanText) && spanText.length > 1) {
                        text = spanText;
                        console.log('[PhoneTTS-DEBUG] 从子元素找到文本:', text.substring(0, 100));
                        break;
                    }
                }
                // 还是没有，尝试从父元素的 data 属性获取
                if (/^\d{1,2}:\d{2}$/.test(text) || !text) {
                    text = targetBubble.getAttribute('data-content') || 
                          targetBubble.getAttribute('data-msg-content') || '';
                    console.log('[PhoneTTS-DEBUG] data-content:', text ? text.substring(0, 50) : '(空)');
                }
            }
            if (!text) {
                console.log('[PhoneTTS-DEBUG] ❌ 最终文本为空，放弃TTS');
                return;
            }
            console.log('[PhoneTTS-DEBUG] ✅ 最终TTS文本:', text.substring(0, 100));

            // Get character name for voice selection
            const senderEl = targetBubble.querySelector('.message-sender');
            const senderName = senderEl ? senderEl.textContent.trim() : '';
            const voiceId = this.getVoiceForCharacter(senderName);
            console.log('[PhoneTTS-DEBUG] senderName:', senderName, 'voiceId:', voiceId);

            // Toggle play/stop
            if (targetBubble.classList.contains('phone-tts-playing')) {
                this.stop();
                return;
            }

            // Play TTS
            console.log('[PhoneTTS-DEBUG] 调用 this.play(), text长度:', text.length);
            this.play(text, voiceId, (state) => {
                if (state === 'loading') {
                    targetBubble.classList.add('phone-tts-loading');
                    targetBubble.classList.remove('phone-tts-playing');
                } else if (state === 'playing') {
                    targetBubble.classList.remove('phone-tts-loading');
                    targetBubble.classList.add('phone-tts-playing');
                } else {
                    targetBubble.classList.remove('phone-tts-loading', 'phone-tts-playing');
                }
            });
        });

        console.log('[PhoneTTS] Voice bubble click events bound');
    }

    // ========== Utility ==========

    _parseGlobalHeaders(headerString) {
        if (!headerString || typeof headerString !== 'string') return {};
        const headers = {};
        headerString.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                if (key && value) {
                    headers[key] = value;
                }
            }
        });
        return headers;
    }

    // Check if TTS backend is available
    async checkAvailability() {
        const config = this.getConfig();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            // Try to hit the status endpoint
            const statusUrl = config.baseUrl + '/api/tts/status';
            const response = await fetch(statusUrl, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return response.ok;
        } catch (e) {
            // Even if status endpoint fails, TTS might still work
            return true;
        }
    }
}

// Initialize
window.phoneTTS = new PhoneTTS();
console.log('[PhoneTTS] Initialized');

// 自动绑定语音气泡点击事件（延迟等待小手机渲染）
setTimeout(function() {
    console.log('[PhoneTTS] 自动绑定语音气泡事件...');
    window.phoneTTS.bindVoiceBubbleEvents();
}, 3000);
