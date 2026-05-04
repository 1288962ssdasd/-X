# PhoneEngine 工作流引擎设计方案

> **版本**: v1.0
> **日期**: 2026-04-26
> **适用范围**: SillyTavern 外置手机3.0插件
> **核心理念**: 小白X负责驱动，小手机负责执行，ST主LLM负责反馈

---

## 目录

1. [背景与问题分析](#1-背景与问题分析)
2. [现有模块清单](#2-现有模块清单)
3. [关键全局依赖](#3-关键全局依赖)
4. [PhoneEngine 核心架构](#4-phoneengine-核心架构)
5. [输入层设计](#5-输入层设计)
6. [规则层设计](#6-规则层设计)
7. [执行层设计](#7-执行层设计)
8. [输出层设计](#8-输出层设计)
9. [全局记忆共享机制](#9-全局记忆共享机制)
10. [与现有代码的集成策略](#10-与现有代码的集成策略)
11. [接口定义](#11-接口定义)
12. [实施阶段](#12-实施阶段)
13. [现有问题修复清单](#13-现有问题修复清单)
14. [风险与注意事项](#14-风险与注意事项)

---

## 1. 背景与问题分析

### 1.1 现状

当前小手机3.0插件各模块（消息、商城、朋友圈、微博、任务等）各自为政，缺乏统一的调度机制：

| 问题 | 具体表现 |
|------|----------|
| **通信方式不统一** | 消息模块轮询变量；商城模块监听 MESSAGE_RECEIVED；微博模块自己轮询3秒；朋友圈被动等待调用 |
| **AI调用重复** | `generateViaPhoneAI()` 在 shop-app、friends-circle、task-app 中重复实现3次 |
| **缺乏全局协调** | 小白X推演完成后写入变量，小手机收到变量但缺少统一"调度大脑"编排响应 |
| **记忆孤岛** | 各模块各自维护状态，无法共享上下文 |
| **事件监听冗余** | pending-msg-event-patch.js 和 bridge-api.js 的变量监听器功能重复 |

### 1.2 用户愿景

> 小白X负责驱动，小手机负责执行，ST主LLM负责反馈。
> 总的调度引擎应该调用这些模块然后统一传递信息来实现全局记忆共享。

### 1.3 设计目标

1. **统一调度**：一个引擎编排所有模块的响应逻辑
2. **统一AI接口**：消除重复的 AI 调用实现
3. **统一事件总线**：模块间通过事件总线通信，解耦直接依赖
4. **全局记忆共享**：小白X、小手机、ST主LLM三方信息互通
5. **渐进式集成**：不新增文件，嵌入现有代码结构

---

## 2. 现有模块清单

| 模块 | 文件 | 全局变量 | 独立LLM | 数据源 |
|------|------|----------|---------|--------|
| 消息应用 | `message-app.js` | `window.messageApp` | 有 (RoleAPI) | ST聊天上下文 + BridgeAPI变量 |
| 消息渲染 | `message-renderer.js` | `window.messageRenderer` | 无 | 被 message-app 调用 |
| 商城 | `shop-app.js` | `window.shopApp` | 有 (三后端) | Mvu stat_data['商品'] |
| 朋友圈 | `friends-circle.js` | (message-app 内) | 有 (三后端) | 聊天上下文正则解析 |
| 微博 | `weibo-app/` | `window.weiboManager` | 无 (依赖 weiboManager) | mobileContextEditor |
| 任务 | `task-app.js` | `window.taskApp` | 有 (三后端) | Mvu stat_data['任务'] |
| 独立AI | `independent-ai.js` | `window.independentAI` | 有 (RoleAPI) | ST DOM消息 |
| 手机框架 | `mobile-phone.js` | `window.mobilePhone` | 无 | 模块注册/切换 |

---

## 3. 关键全局依赖

```
window.Mvu                    -- 变量读写框架
window.BridgeAPI              -- 配置管理、消息处理
window.RoleAPI                -- 独立AI对话
window.mobileCustomAPIConfig  -- 自定义API配置
window.XBBridge               -- 小白X桥接
window.SillyTavern            -- ST核心
window.eventSource            -- ST事件系统
window.mobilePhone            -- 手机框架实例
window.BridgeClient           -- PluginBridge客户端
```

---

## 4. PhoneEngine 核心架构

### 4.1 总体架构图

```
+=====================================================================+
|                        PhoneEngine 工作流引擎                         |
+=====================================================================+
|                                                                     |
|  +---------------------------+    +----------------------------+    |
|  |        输 入 层            |    |        输 出 层             |    |
|  |  (Input Layer)            |    |  (Output Layer)            |    |
|  |                           |    |                            |    |
|  |  [MonkeyPatch] setLocalVar|    |  [变量写入] setLocalVariable|    |
|  |  [事件兜底] pending-msg   |    |  [UI更新]  手机界面刷新     |    |
|  |  [ST事件]  GENERATE_AFTER |    |  [上下文]  世界书/变量注入  |    |
|  |  [WS事件]  PluginBridge   |    |  [通知]    小白X回调       |    |
|  +-------------+-------------+    +-------------+--------------+    |
|                |                                ^                   |
|                v                                |                   |
|  +-------------+----------------+  +-----------+--------------+    |
|  |        规 则 层              |  |        执 行 层           |    |
|  |  (Rule Layer)               |  |  (Execution Layer)        |    |
|  |                             |  |                           |    |
|  |  [工作流定义] 条件触发       |  |  [UnifiedAI] 统一AI调用   |    |
|  |  [优先级队列] 防抖/节流     |  |  [模块管理] 生命周期控制   |    |
|  |  [条件判断]  上下文评估     |  |  [事件总线] 模块间通信     |    |
|  |  [内置规则]  5大工作流      |  |  [降级策略] 错误处理       |    |
|  +-----------------------------+  +---------------------------+    |
|                                                                     |
|  +-------------------------------------------------------------+   |
|  |                    全局记忆共享层 (Memory Layer)               |   |
|  |                                                             |   |
|  |   xb.game.*  <------>  xb.quest.result.*  <------>  xb.*    |   |
|  |   (小白X写入)          (小手机写入)            (ST读取)      |   |
|  |                                                             |   |
|  |   xb.phone.{name}.summary  -- 三方共享记忆摘要               |   |
|  +-------------------------------------------------------------+   |
+=====================================================================+
```

### 4.2 三方协作模型

```
+------------------+         +------------------+         +------------------+
|                  |  驱动    |                  |  执行    |                  |
|     小白X        | -------> |    小手机        | -------> |   ST 主LLM      |
|   (大脑/推演)    |         |  (PhoneEngine)   |         |   (反馈/对话)    |
|                  | <------- |                  | <------- |                  |
|                  |  结果    |                  |  上下文  |                  |
+------------------+         +------------------+         +------------------+
      |                            |                            |
      |  xb.game.* 变量            |  xb.quest.result.*          |  世界书条目
      |  (推演指令/剧情变化)        |  (操作结果/状态更新)         |  (读取 xb.*)
      |                            |                            |
      +----------------------------+----------------------------+
                       全局记忆共享 (xb.* 命名空间)
```

### 4.3 数据流总览

```
小白X推演完成
    |
    v
setLocalVariable("xb.game.event", "任务完成:击败Boss")
    |
    v
[输入层] MonkeyPatch 拦截变量变更
    |
    v
[规则层] 匹配工作流: "ENA推演完成 → 解析剧情变化 → 触发对应模块响应"
    |
    v
[执行层] UnifiedAI.call("解析剧情变化", { backend: "customAPI" })
    |         |
    |         v
    |    AI返回: { action: "task_complete", taskId: "boss_fight", rewards: [...] }
    |
    v
[执行层] 调度 taskApp.updateTask("boss_fight", "completed")
    |         |
    |         v
    |    taskApp 内部更新 stat_data['任务']
    |
    v
[执行层] 调度 messageApp.sendNotification("恭喜！Boss已被击败！")
    |
    v
[输出层] setLocalVariable("xb.quest.result.task", "completed")
    |
    v
[输出层] 更新手机UI + 注入世界书条目
    |
    v
ST主LLM在下一轮对话中感知到变化
```

---

## 5. 输入层设计

### 5.1 输入源矩阵

```
+-------------------+----------+------------+---------------------------+
| 输入源            | 实时性   | 可靠性     | 监听方式                  |
+-------------------+----------+------------+---------------------------+
| MonkeyPatch       | 毫秒级   | 高         | 拦截 setLocalVariable     |
| pending-msg-event | 秒级     | 中(兜底)   | 事件监听                  |
| ST事件系统        | 实时     | 高         | eventSource.on()          |
| PluginBridge WS   | 实时     | 高         | BridgeClient.on()         |
+-------------------+----------+------------+---------------------------+
```

### 5.2 MonkeyPatch 变量拦截

```javascript
/**
 * 输入层 - 变量变更拦截器
 * 嵌入位置: bridge-api.js (已有 _publishEvent 基础设施)
 */
const VariableInterceptor = {
    _originalSetLocalVariable: null,
    _watchedPatterns: [],

    init() {
        // 保存原始方法
        this._originalSetLocalVariable = Mvu.setLocalVariable.bind(Mvu);

        // 替换为拦截版本
        Mvu.setLocalVariable = (key, value, ...args) => {
            const result = this._originalSetLocalVariable(key, value, ...args);

            // 检查是否匹配监听模式
            for (const pattern of this._watchedPatterns) {
                if (this._matchPattern(key, pattern.keyPattern)) {
                    PhoneEngine.emit('variable:changed', {
                        key,
                        value,
                        oldValue: Mvu.getLocalVariable(key),
                        pattern: pattern.name,
                        timestamp: Date.now()
                    });
                }
            }

            return result;
        };
    },

    /**
     * 注册变量监听模式
     * @param {string} name - 监听器名称
     * @param {string|RegExp} keyPattern - 变量名匹配模式
     * @param {Function} callback - 回调函数
     */
    watch(name, keyPattern, callback) {
        this._watchedPatterns.push({ name, keyPattern, callback });
        PhoneEngine.on(`variable:changed:${name}`, callback);
    },

    _matchPattern(key, pattern) {
        if (pattern instanceof RegExp) return pattern.test(key);
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(key);
        }
        return key === pattern;
    }
};
```

### 5.3 输入事件标准化

所有输入源统一转换为标准事件格式：

```javascript
/**
 * 标准输入事件
 * @typedef {Object} EngineEvent
 * @property {string} type - 事件类型
 * @property {string} source - 来源 (monkeypatch | st-event | bridge-ws | fallback)
 * @property {Object} data - 事件数据
 * @property {number} timestamp - 时间戳
 * @property {string} id - 唯一事件ID
 */
```

---

## 6. 规则层设计

### 6.1 工作流定义结构

```javascript
/**
 * 工作流定义
 * @typedef {Object} Workflow
 * @property {string} id - 工作流唯一标识
 * @property {string} name - 工作流名称
 * @property {number} priority - 优先级 (0-100, 越高越优先)
 * @property {WorkflowTrigger} trigger - 触发条件
 * @property {WorkflowCondition} condition - 执行条件 (可选)
 * @property {WorkflowAction[]} actions - 动作序列
 * @property {Object} options - 选项 (防抖、重试等)
 */

/**
 * 触发条件
 * @typedef {Object} WorkflowTrigger
 * @property {string} type - 触发类型 (variable_changed | st_event | timer | manual)
 * @property {string|RegExp} pattern - 匹配模式
 * @property {Object} filter - 附加过滤条件
 */

/**
 * 动作定义
 * @typedef {Object} WorkflowAction
 * @property {string} type - 动作类型 (ai_call | module_call | variable_set | ui_update | event_emit)
 * @property {string} target - 目标模块或变量
 * @property {Object} params - 动作参数
 * @property {WorkflowCondition} condition - 前置条件 (可选)
 * @property {boolean} parallel - 是否与前一个动作并行 (默认 false)
 * @property {number} timeout - 超时时间(ms)
 */
```

### 6.2 内置工作流

#### 工作流 1: 消息到达处理

```
触发: variable:changed (xb.msg.* 或 pending_message)
    |
    v
[条件判断] 消息来源是否为NPC?
    |           |
    | Yes       | No
    v           v
[AI解析意图]  [直接转发]
    |
    v
[渲染到UI] messageRenderer.render()
    |
    v
[通知小白X] setLocalVariable("xb.phone.msg.received", ...)
    |
    v
[更新记忆] xb.phone.{sender}.summary
```

```javascript
const MessageArrivalWorkflow = {
    id: 'msg-arrival',
    name: '消息到达处理',
    priority: 90,
    trigger: {
        type: 'variable_changed',
        pattern: 'xb.msg.*'
    },
    condition: {
        type: 'expr',
        expr: 'data.value && data.value.trim().length > 0'
    },
    actions: [
        {
            type: 'ai_call',
            target: 'UnifiedAI',
            params: {
                prompt: '分析以下消息的意图和情感: {{data.value}}',
                options: { maxTokens: 200, backend: 'auto' }
            },
            resultKey: 'intentAnalysis'
        },
        {
            type: 'module_call',
            target: 'messageApp',
            params: {
                method: 'renderMessage',
                args: ['{{data.key}}', '{{data.value}}', '{{intentAnalysis}}']
            }
        },
        {
            type: 'variable_set',
            target: 'xb.phone.msg.received',
            params: {
                value: { sender: '{{data.key}}', intent: '{{intentAnalysis.intent}}' }
            }
        },
        {
            type: 'event_emit',
            target: 'engine:notification',
            params: { message: '收到新消息', source: '{{data.key}}' }
        }
    ],
    options: {
        debounce: 500,    // 500ms 防抖
        dedup: true,      // 去重
        timeout: 10000    // 10秒超时
    }
};
```

#### 工作流 2: ENA推演完成响应

```
触发: variable:changed (xb.game.event 或 xb.game.state)
    |
    v
[AI解析剧情变化]
    |
    v
[分支判断] 剧情变化类型
    |
    +-- 任务相关 --> taskApp.updateTask() + messageApp.notify()
    |
    +-- 角色相关 --> friendsCircle.update() + weiboManager.post()
    |
    +-- 世界相关 --> 更新世界书 + 通知所有模块
    |
    v
[统一回传结果] xb.quest.result.*
```

```javascript
const ENAResponseWorkflow = {
    id: 'ena-response',
    name: 'ENA推演完成响应',
    priority: 95,
    trigger: {
        type: 'variable_changed',
        pattern: 'xb.game.*'
    },
    actions: [
        {
            type: 'ai_call',
            target: 'UnifiedAI',
            params: {
                prompt: `根据以下推演结果，判断需要触发哪些模块响应:
                    推演事件: {{data.value}}
                    当前任务状态: {{Mvu.stat_data.任务}}
                    可用模块: message, shop, friends-circle, weibo, task
                    返回JSON格式的响应计划。`,
                options: { maxTokens: 500, backend: 'auto' }
            },
            resultKey: 'responsePlan'
        },
        {
            type: 'module_call',
            target: 'dynamic',
            params: {
                method: 'executePlan',
                args: ['{{responsePlan}}']
            },
            condition: {
                type: 'expr',
                expr: 'responsePlan.actions && responsePlan.actions.length > 0'
            }
        },
        {
            type: 'variable_set',
            target: 'xb.quest.result.engine',
            params: {
                value: { status: 'processed', plan: '{{responsePlan}}' }
            }
        }
    ],
    options: {
        debounce: 1000,
        timeout: 30000
    }
};
```

#### 工作流 3: 任务状态变更

```
触发: variable:changed (xb.quest.* 或 stat_data['任务'])
    |
    v
[更新任务UI] taskApp.refreshUI()
    |
    v
[反馈小白X] setLocalVariable("xb.quest.result.*", ...)
    |
    v
[共享记忆给ST] 更新世界书条目
```

#### 工作流 4: 角色阶段变化

```
触发: variable:changed (xb.char.stage.*)
    |
    v
[CG展示] mobilePhone.showCG()
    |
    v
[更新朋友圈] friendsCircle.postMilestone()
    |
    v
[微博动态] weiboManager.postStageChange()
    |
    v
[通知小白X] xb.quest.result.stage
```

#### 工作流 5: 定时触发

```
触发: timer (可配置间隔)
    |
    +-- 每30秒 --> 微博自动生成 (weiboManager.autoGenerate)
    |
    +-- 每60秒 --> 朋友圈自动更新 (friendsCircle.autoUpdate)
    |
    +-- 每5分钟 --> 记忆摘要整理 (memoryLayer.compact)
```

### 6.3 工作流引擎核心

```javascript
/**
 * 规则层 - 工作流引擎
 * 嵌入位置: quest-planner-bridge.js (已有 _emitRemote 基础设施)
 */
const WorkflowEngine = {
    _workflows: new Map(),
    _runningWorkflows: new Map(),
    _debounceTimers: new Map(),

    /**
     * 注册工作流
     */
    register(workflow) {
        if (this._workflows.has(workflow.id)) {
            console.warn(`[PhoneEngine] 工作流 ${workflow.id} 已存在，将被覆盖`);
        }
        this._workflows.set(workflow.id, workflow);

        // 绑定触发器
        this._bindTrigger(workflow);
    },

    /**
     * 绑定触发器到事件源
     */
    _bindTrigger(workflow) {
        const { trigger } = workflow;

        switch (trigger.type) {
            case 'variable_changed':
                PhoneEngine.on('variable:changed', (event) => {
                    if (this._matchTrigger(event, trigger)) {
                        this._executeWorkflow(workflow, event);
                    }
                });
                break;

            case 'st_event':
                if (window.eventSource) {
                    eventSource.on(trigger.pattern, (event) => {
                        this._executeWorkflow(workflow, {
                            ...event,
                            source: 'st-event'
                        });
                    });
                }
                break;

            case 'timer':
                setInterval(() => {
                    this._executeWorkflow(workflow, {
                        type: 'timer',
                        source: 'internal',
                        timestamp: Date.now()
                    });
                }, trigger.interval);
                break;

            case 'bridge_ws':
                if (window.BridgeClient) {
                    BridgeClient.on(trigger.pattern, (event) => {
                        this._executeWorkflow(workflow, {
                            ...event,
                            source: 'bridge-ws'
                        });
                    });
                }
                break;
        }
    },

    /**
     * 执行工作流 (带防抖)
     */
    async _executeWorkflow(workflow, event) {
        const { id, options = {} } = workflow;

        // 防抖处理
        if (options.debounce > 0) {
            if (this._debounceTimers.has(id)) {
                clearTimeout(this._debounceTimers.get(id));
            }
            this._debounceTimers.set(id, setTimeout(() => {
                this._debounceTimers.delete(id);
                this._runActions(workflow, event);
            }, options.debounce));
            return;
        }

        await this._runActions(workflow, event);
    },

    /**
     * 顺序执行动作序列
     */
    async _runActions(workflow, event) {
        const { id, actions, options = {} } = workflow;

        // 防止同一工作流并发执行
        if (this._runningWorkflows.has(id)) {
            console.log(`[PhoneEngine] 工作流 ${id} 正在执行中，跳过`);
            return;
        }

        this._runningWorkflows.set(id, true);
        const context = { event, results: {}, variables: {} };

        try {
            for (const action of actions) {
                // 条件判断
                if (action.condition && !this._evaluateCondition(action.condition, context)) {
                    console.log(`[PhoneEngine] 动作条件不满足，跳过: ${action.type}:${action.target}`);
                    continue;
                }

                // 超时控制
                const timeout = action.timeout || options.timeout || 10000;

                await Promise.race([
                    this._executeAction(action, context),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`动作超时: ${action.type}`)), timeout)
                    )
                ]);

                // 并行标记 - 如果下一个动作标记为 parallel，则不等待
                // (简化实现中保持顺序执行)
            }
        } catch (error) {
            console.error(`[PhoneEngine] 工作流 ${id} 执行失败:`, error);
            PhoneEngine.emit('workflow:error', { workflowId: id, error });
        } finally {
            this._runningWorkflows.delete(id);
        }
    },

    /**
     * 执行单个动作
     */
    async _executeAction(action, context) {
        const resolvedParams = this._resolveTemplate(action.params, context);

        switch (action.type) {
            case 'ai_call':
                context.results[action.resultKey] = await UnifiedAI.call(
                    resolvedParams.prompt,
                    resolvedParams.options
                );
                break;

            case 'module_call':
                await this._callModule(action.target, resolvedParams.method, resolvedParams.args);
                break;

            case 'variable_set':
                await Mvu.setLocalVariable(action.target, resolvedParams.value);
                break;

            case 'ui_update':
                if (window.mobilePhone) {
                    mobilePhone.refresh(action.target, resolvedParams);
                }
                break;

            case 'event_emit':
                PhoneEngine.emit(action.target, resolvedParams);
                break;
        }
    },

    /**
     * 模板变量解析 {{data.value}} → 实际值
     */
    _resolveTemplate(obj, context) {
        if (typeof obj === 'string') {
            return obj.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
                return this._getByPath(context, path.trim());
            });
        }
        if (typeof obj === 'object' && obj !== null) {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this._resolveTemplate(value, context);
            }
            return result;
        }
        return obj;
    },

    _getByPath(obj, path) {
        return path.split('.').reduce((acc, part) => acc?.[part], obj);
    },

    _matchTrigger(event, trigger) {
        if (trigger.pattern instanceof RegExp) {
            return trigger.pattern.test(event.key || event.type);
        }
        if (typeof trigger.pattern === 'string' && trigger.pattern.includes('*')) {
            const regex = new RegExp('^' + trigger.pattern.replace(/\*/g, '.*') + '$');
            return regex.test(event.key || event.type);
        }
        return (event.key || event.type) === trigger.pattern;
    },

    _evaluateCondition(condition, context) {
        if (condition.type === 'expr') {
            try {
                // 安全的表达式求值 (仅允许 context 引用)
                const fn = new Function('context', `with(context){ return ${condition.expr}; }`);
                return fn(context);
            } catch {
                return false;
            }
        }
        return true;
    },

    _callModule(target, method, args) {
        const modules = {
            messageApp: window.messageApp,
            messageRenderer: window.messageRenderer,
            shopApp: window.shopApp,
            weiboManager: window.weiboManager,
            taskApp: window.taskApp,
            independentAI: window.independentAI,
            mobilePhone: window.mobilePhone
        };

        const mod = modules[target];
        if (!mod || typeof mod[method] !== 'function') {
            throw new Error(`模块方法不存在: ${target}.${method}`);
        }
        return mod[method](...(args || []));
    }
};
```

---

## 7. 执行层设计

### 7.1 统一AI调用接口

```javascript
/**
 * 执行层 - 统一AI调用接口
 * 嵌入位置: bridge-api.js (已有 _publishEvent 基础设施)
 */
const UnifiedAI = {
    _backends: [],
    _callStats: { total: 0, success: 0, failed: 0, byBackend: {} },
    _requestQueue: [],
    _concurrency: 3,
    _processing: 0,

    /**
     * 初始化后端优先级链
     */
    init() {
        this._backends = [
            {
                name: 'customAPI',
                available: () => !!window.mobileCustomAPIConfig,
                call: async (prompt, options) => {
                    const config = window.mobileCustomAPIConfig;
                    // 调用自定义API
                    return await this._callCustomAPI(config, prompt, options);
                },
                priority: 100
            },
            {
                name: 'RoleAPI',
                available: () => !!window.RoleAPI,
                call: async (prompt, options) => {
                    return await window.RoleAPI.generate(prompt, options);
                },
                priority: 80
            },
            {
                name: 'XBBridge',
                available: () => !!window.XBBridge,
                call: async (prompt, options) => {
                    return await window.XBBridge.send(prompt, options);
                },
                priority: 60
            }
        ];
    },

    /**
     * 统一AI调用入口
     * @param {string} prompt - 提示词
     * @param {Object} options - 选项
     * @param {string} options.backend - 指定后端 ('auto' | 'customAPI' | 'RoleAPI' | 'XBBridge')
     * @param {number} options.maxTokens - 最大token数
     * @param {number} options.temperature - 温度
     * @param {number} options.timeout - 超时(ms)
     * @param {boolean} options.fallback - 是否允许降级 (默认 true)
     * @returns {Promise<string>} AI响应文本
     */
    async call(prompt, options = {}) {
        const {
            backend = 'auto',
            maxTokens = 500,
            temperature = 0.7,
            timeout = 30000,
            fallback = true
        } = options;

        this._callStats.total++;

        try {
            let result;

            if (backend === 'auto') {
                result = await this._callWithFallback(prompt, { maxTokens, temperature, timeout });
            } else {
                const target = this._backends.find(b => b.name === backend);
                if (!target || !target.available()) {
                    if (fallback) {
                        result = await this._callWithFallback(prompt, { maxTokens, temperature, timeout }, backend);
                    } else {
                        throw new Error(`指定后端 ${backend} 不可用`);
                    }
                } else {
                    result = await this._callWithTimeout(target, prompt, { maxTokens, temperature }, timeout);
                }
            }

            this._callStats.success++;
            return result;
        } catch (error) {
            this._callStats.failed++;
            console.error(`[UnifiedAI] 调用失败:`, error);
            throw error;
        }
    },

    /**
     * 按优先级降级调用
     */
    async _callWithFallback(prompt, options, excludeBackend = null) {
        const errors = [];

        for (const backend of this._backends) {
            if (backend.name === excludeBackend) continue;
            if (!backend.available()) continue;

            try {
                const result = await this._callWithTimeout(
                    backend, prompt, options, options.timeout
                );
                this._trackBackend(backend.name, true);
                return result;
            } catch (error) {
                errors.push({ backend: backend.name, error });
                this._trackBackend(backend.name, false);
                console.warn(`[UnifiedAI] 后端 ${backend.name} 调用失败，尝试下一个:`, error.message);
            }
        }

        throw new Error(`所有AI后端均失败: ${errors.map(e => e.backend).join(', ')}`);
    },

    /**
     * 带超时的后端调用
     */
    async _callWithTimeout(backend, prompt, options, timeout) {
        return Promise.race([
            backend.call(prompt, options),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`后端 ${backend.name} 超时 (${timeout}ms)`)), timeout)
            )
        ]);
    },

    _trackBackend(name, success) {
        if (!this._callStats.byBackend[name]) {
            this._callStats.byBackend[name] = { success: 0, failed: 0 };
        }
        if (success) {
            this._callStats.byBackend[name].success++;
        } else {
            this._callStats.byBackend[name].failed++;
        }
    },

    /**
     * 获取调用统计
     */
    getStats() {
        return { ...this._callStats };
    }
};
```

### 7.2 模块生命周期管理

```javascript
/**
 * 执行层 - 模块生命周期管理
 */
const ModuleManager = {
    _modules: new Map(),
    _states: {},

    /**
     * 模块状态枚举
     */
    STATES: {
        UNINITIALIZED: 'uninitialized',
        INITIALIZING: 'initializing',
        ACTIVE: 'active',
        DEACTIVATED: 'deactivated',
        DESTROYED: 'destroyed',
        ERROR: 'error'
    },

    /**
     * 注册模块
     * @param {string} name - 模块名
     * @param {Object} module - 模块实例
     * @param {Object} config - 模块配置
     */
    register(name, module, config = {}) {
        this._modules.set(name, {
            name,
            instance: module,
            config,
            state: this.STATES.UNINITIALIZED,
            dependencies: config.dependencies || []
        });
    },

    /**
     * 初始化模块 (按依赖顺序)
     */
    async init(name) {
        const mod = this._modules.get(name);
        if (!mod) throw new Error(`模块不存在: ${name}`);

        if (mod.state === this.STATES.ACTIVE) return;
        if (mod.state === this.STATES.INITIALIZING) {
            // 等待初始化完成
            return new Promise(resolve => {
                const check = setInterval(() => {
                    if (this._states[name] !== this.STATES.INITIALIZING) {
                        clearInterval(check);
                        resolve();
                    }
                }, 100);
            });
        }

        // 先初始化依赖
        for (const dep of mod.dependencies) {
            await this.init(dep);
        }

        mod.state = this.STATES.INITIALIZING;
        try {
            if (typeof mod.instance.init === 'function') {
                await mod.instance.init();
            }
            mod.state = this.STATES.ACTIVE;
            PhoneEngine.emit('module:activated', { name });
        } catch (error) {
            mod.state = this.STATES.ERROR;
            PhoneEngine.emit('module:error', { name, error });
            throw error;
        }
    },

    /**
     * 停用模块
     */
    async deactivate(name) {
        const mod = this._modules.get(name);
        if (!mod || mod.state !== this.STATES.ACTIVE) return;

        if (typeof mod.instance.deactivate === 'function') {
            await mod.instance.deactivate();
        }
        mod.state = this.STATES.DEACTIVATED;
        PhoneEngine.emit('module:deactivated', { name });
    },

    /**
     * 销毁模块
     */
    async destroy(name) {
        const mod = this._modules.get(name);
        if (!mod) return;

        await this.deactivate(name);
        if (typeof mod.instance.destroy === 'function') {
            await mod.instance.destroy();
        }
        mod.state = this.STATES.DESTROYED;
        this._modules.delete(name);
    },

    /**
     * 获取模块状态
     */
    getState(name) {
        return this._modules.get(name)?.state || 'unknown';
    },

    /**
     * 获取所有模块状态
     */
    getAllStates() {
        const states = {};
        for (const [name, mod] of this._modules) {
            states[name] = { state: mod.state, config: mod.config };
        }
        return states;
    }
};
```

### 7.3 统一事件总线

```javascript
/**
 * 执行层 - 统一事件总线
 * 复用 BridgeClient 的事件系统，在其基础上扩展
 */
const EventBus = {
    _listeners: new Map(),
    _onceListeners: new Map(),
    _history: [],
    _maxHistory: 100,

    /**
     * 注册事件监听
     */
    on(event, callback, options = {}) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        const listener = { callback, priority: options.priority || 0, id: Date.now() + Math.random() };
        this._listeners.get(event).push(listener);
        // 按优先级排序
        this._listeners.get(event).sort((a, b) => b.priority - a.priority);
        return () => this.off(event, listener.id);
    },

    /**
     * 注册一次性监听
     */
    once(event, callback) {
        const off = this.on(event, (...args) => {
            off();
            callback(...args);
        });
        return off;
    },

    /**
     * 移除监听
     */
    off(event, idOrCallback) {
        const listeners = this._listeners.get(event);
        if (!listeners) return;

        if (typeof idOrCallback === 'function') {
            const idx = listeners.findIndex(l => l.callback === idOrCallback);
            if (idx >= 0) listeners.splice(idx, 1);
        } else {
            const idx = listeners.findIndex(l => l.id === idOrCallback);
            if (idx >= 0) listeners.splice(idx, 1);
        }
    },

    /**
     * 触发事件
     */
    emit(event, data) {
        // 记录历史
        this._history.push({ event, data, timestamp: Date.now() });
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }

        // 通知监听器
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const listener of [...listeners]) {
                try {
                    listener.callback(data);
                } catch (error) {
                    console.error(`[EventBus] 事件处理器错误 (${event}):`, error);
                }
            }
        }

        // 通配符监听
        const wildcardListeners = this._listeners.get('*');
        if (wildcardListeners) {
            for (const listener of [...wildcardListeners]) {
                try {
                    listener.callback({ event, data });
                } catch (error) {
                    console.error(`[EventBus] 通配符处理器错误:`, error);
                }
            }
        }
    },

    /**
     * 获取事件历史
     */
    getHistory(eventFilter, limit = 20) {
        let filtered = this._history;
        if (eventFilter) {
            filtered = filtered.filter(h => h.event === eventFilter);
        }
        return filtered.slice(-limit);
    }
};
```

---

## 8. 输出层设计

### 8.1 输出通道

```
+------------------+     +------------------+     +------------------+
|   变量写入通道    |     |    UI更新通道     |     |   上下文注入通道  |
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
| setLocalVariable |     | mobilePhone.     |     | 世界书条目更新    |
| xb.game.*        |     |   refresh()      |     | xb.* 变量        |
| xb.quest.result.*|     | messageRenderer  |     | ST上下文注入     |
| xb.phone.*       |     |   .render()      |     |                  |
|                  |     |                  |     |                  |
| 目标: 小白X读取  |     | 目标: 用户界面   |     | 目标: ST主LLM    |
+------------------+     +------------------+     +------------------+
```

### 8.2 输出层实现

```javascript
/**
 * 输出层 - 统一输出管理
 */
const OutputLayer = {
    /**
     * 写入变量并通知小白X
     */
    async writeToXB(key, value) {
        await Mvu.setLocalVariable(key, value);
        PhoneEngine.emit('output:variable', { key, value, target: 'xiaobaix' });
    },

    /**
     * 更新手机UI
     */
    updateUI(component, data) {
        if (!window.mobilePhone) return;

        switch (component) {
            case 'messages':
                if (window.messageRenderer) {
                    messageRenderer.refresh(data);
                }
                break;
            case 'shop':
                if (window.shopApp) {
                    shopApp.refreshUI(data);
                }
                break;
            case 'tasks':
                if (window.taskApp) {
                    taskApp.refreshUI(data);
                }
                break;
            case 'friends':
                if (window.messageApp?.friendsCircle) {
                    messageApp.friendsCircle.refresh(data);
                }
                break;
            case 'weibo':
                if (window.weiboManager) {
                    weiboManager.refresh(data);
                }
                break;
            default:
                mobilePhone.refresh(component, data);
        }

        PhoneEngine.emit('output:ui', { component, data });
    },

    /**
     * 注入上下文到ST主LLM
     * 通过世界书条目或变量让ST主LLM感知变化
     */
    async injectContext(contextData) {
        // 写入变量供世界书引用
        const key = `xb.phone.context.${Date.now()}`;
        await Mvu.setLocalVariable(key, JSON.stringify(contextData));

        PhoneEngine.emit('output:context', { key, data: contextData });
    }
};
```

---

## 9. 全局记忆共享机制

### 9.1 记忆命名空间设计

```
xb.*
├── game.*                          # 小白X写入 → 小手机读取
│   ├── event                       # 推演事件
│   ├── state                       # 游戏状态
│   ├── plot                        # 剧情进展
│   └── npc.*                       # NPC状态
│
├── quest.*                         # 小手机写入 → 小白X读取
│   ├── result.*                    # 操作结果
│   │   ├── task                    # 任务处理结果
│   │   ├── shop                    # 商城操作结果
│   │   ├── social                  # 社交操作结果
│   │   └── engine                  # 引擎处理结果
│   └── status.*                    # 模块状态
│
├── phone.*                         # 三方共享
│   ├── {name}.summary              # 角色记忆摘要
│   ├── {name}.mood                 # 角色心情
│   ├── {name}.relationship         # 关系状态
│   ├── msg.received                # 消息接收记录
│   ├── msg.sent                    # 消息发送记录
│   └── context.*                   # 上下文快照
│
└── memory.*                        # 长期记忆
    ├── episode.{id}                # 剧集记忆
    ├── summary                     # 全局摘要
    └── timeline                    # 时间线
```

### 9.2 记忆流转图

```
                    +-----------------------+
                    |     小白X (大脑)       |
                    |   推演 → 写入变量      |
                    +-----------+-----------+
                                |
                    写入 xb.game.*
                    写入 xb.game.event
                    写入 xb.game.npc.*
                                |
                                v
+-----------------------+   +-----------------------+   +-----------------------+
|                       |   |                       |   |                       |
|   PhoneEngine         |   |   全局记忆层           |   |   ST 主LLM            |
|   (小手机调度)         |   |                       |   |                       |
|                       |   |   读取 xb.game.*      |   |   读取世界书条目       |
|   读取 xb.game.*      |   |   写入 xb.quest.*     |   |   引用 xb.* 变量      |
|   写入 xb.quest.*     |   |   维护 xb.phone.*     |   |   感知上下文变化       |
|   维护 xb.phone.*     |   |   整理 xb.memory.*    |   |                       |
|                       |   |                       |   |                       |
+-----------------------+   +-----------------------+   +-----------------------+
                                |                           ^
                                |                           |
                    写入 xb.quest.result.*                  |
                    写入 xb.phone.*.summary                 |
                                |                           |
                                v                           |
                    +-----------------------+               |
                    |     小白X (大脑)       |               |
                    |   读取操作结果          |---------------+
                    |   调整推演策略          |
                    +-----------------------+
```

### 9.3 记忆摘要机制

```javascript
/**
 * 全局记忆共享层 - 记忆摘要
 */
const MemoryLayer = {
    _summaries: {},
    _maxSummaryLength: 500,

    /**
     * 更新角色记忆摘要
     * @param {string} name - 角色名
     * @param {string} event - 事件描述
     * @param {Object} metadata - 元数据
     */
    async updateSummary(name, event, metadata = {}) {
        const key = `xb.phone.${name}.summary`;
        const existing = Mvu.getLocalVariable(key) || '';

        // 使用AI生成摘要 (避免无限增长)
        const newSummary = await UnifiedAI.call(
            `请将以下旧摘要和新事件合并为一段简洁的记忆摘要（不超过${this._maxSummaryLength}字）：

旧摘要: ${existing}

新事件: ${event}

要求：
1. 保留重要信息
2. 压缩重复内容
3. 按时间倒序排列
4. 使用简洁的陈述句`,
            { maxTokens: 300, temperature: 0.3 }
        );

        await Mvu.setLocalVariable(key, newSummary);
        this._summaries[name] = newSummary;

        PhoneEngine.emit('memory:summary_updated', { name, summary: newSummary });
    },

    /**
     * 获取角色摘要
     */
    getSummary(name) {
        return this._summaries[name] || Mvu.getLocalVariable(`xb.phone.${name}.summary`) || '';
    },

    /**
     * 获取所有摘要 (供ST上下文注入)
     */
    getAllSummaries() {
        return { ...this._summaries };
    },

    /**
     * 记忆压缩 (定期调用)
     */
    async compact() {
        console.log('[MemoryLayer] 开始记忆压缩...');

        for (const [name, summary] of Object.entries(this._summaries)) {
            if (summary.length > this._maxSummaryLength * 1.5) {
                await this.updateSummary(name, '[系统] 执行定期记忆压缩');
            }
        }

        PhoneEngine.emit('memory:compacted', { timestamp: Date.now() });
    }
};
```

---

## 10. 与现有代码的集成策略

### 10.1 嵌入方案总览

由于不能创建新文件，PhoneEngine 的各层必须嵌入到现有文件中：

```
+=============================+============================================+
| PhoneEngine 层              | 嵌入目标文件                                |
+=============================+============================================+
| 核心调度 (PhoneEngine 入口)  | independent-ai.js (已是 Orchestrator 角色)  |
| UnifiedAI (统一AI接口)       | bridge-api.js (已有 _publishEvent)          |
| WorkflowEngine (工作流引擎)  | quest-planner-bridge.js (已有 _emitRemote)  |
| EventBus (事件总线)          | BridgeClient 事件系统 (复用扩展)            |
| VariableInterceptor         | bridge-api.js (Mvu 拦截点)                 |
| ModuleManager               | mobile-phone.js (已有模块注册机制)          |
| MemoryLayer                 | independent-ai.js (记忆管理归属)            |
| OutputLayer                 | bridge-api.js (输出通道归属)                |
+=============================+============================================+
```

### 10.2 嵌入位置详解

#### independent-ai.js — PhoneEngine 核心入口

```javascript
// ====== PhoneEngine 核心入口 (嵌入 independent-ai.js) ======

// 在文件顶部，class IndependentAI 定义之前添加:

/**
 * PhoneEngine - 小手机工作流引擎
 * 统一调度中心，嵌入于 independent-ai.js
 */
window.PhoneEngine = (() => {
    // 复用 BridgeClient 事件系统作为事件总线
    const _bus = window.BridgeClient || {
        _handlers: {},
        on(e, fn) { (this._handlers[e] = this._handlers[e] || []).push(fn); },
        emit(e, d) { (this._handlers[e] || []).forEach(fn => fn(d)); }
    };

    const _engine = {
        _initialized: false,
        _plugins: [],

        // 事件总线代理
        on: (event, callback) => _bus.on(event, callback),
        once: (event, callback) => {
            const wrapper = (...args) => { _bus.off(event, wrapper); callback(...args); };
            _bus.on(event, wrapper);
            return () => _bus.off(event, wrapper);
        },
        off: (event, callback) => _bus.off(event, callback),
        emit: (event, data) => {
            console.log(`[PhoneEngine] 事件: ${event}`, data);
            _bus.emit(event, data);
        },

        /**
         * 初始化引擎
         */
        async init() {
            if (this._initialized) return;

            console.log('[PhoneEngine] 初始化工作流引擎...');

            // 初始化各子系统
            if (typeof UnifiedAI !== 'undefined') UnifiedAI.init();
            if (typeof VariableInterceptor !== 'undefined') VariableInterceptor.init();
            if (typeof WorkflowEngine !== 'undefined') {
                // 注册内置工作流
                WorkflowEngine.register(MessageArrivalWorkflow);
                WorkflowEngine.register(ENAResponseWorkflow);
                WorkflowEngine.register(TaskStateWorkflow);
                WorkflowEngine.register(CharacterStageWorkflow);
                WorkflowEngine.register(TimerWorkflow);
            }

            this._initialized = true;
            this.emit('engine:ready', { timestamp: Date.now() });
            console.log('[PhoneEngine] 工作流引擎初始化完成');
        },

        /**
         * 获取引擎状态
         */
        getStatus() {
            return {
                initialized: this._initialized,
                workflows: WorkflowEngine?._workflows?.size || 0,
                aiStats: UnifiedAI?.getStats() || {},
                modules: ModuleManager?.getAllStates() || {}
            };
        }
    };

    return _engine;
})();
```

#### bridge-api.js — UnifiedAI + VariableInterceptor + OutputLayer

```javascript
// ====== UnifiedAI (嵌入 bridge-api.js) ======
// 在 BridgeAPI class 内部或文件末尾添加:

// [UnifiedAI 代码见第7.1节]
// [VariableInterceptor 代码见第5.2节]
// [OutputLayer 代码见第8.2节]

// 在 BridgeAPI 的 init() 方法中添加初始化调用:
// if (window.PhoneEngine) PhoneEngine.init();
```

#### quest-planner-bridge.js — WorkflowEngine

```javascript
// ====== WorkflowEngine (嵌入 quest-planner-bridge.js) ======
// 在文件中 _emitRemote 方法附近添加:

// [WorkflowEngine 代码见第6.3节]
// [内置工作流定义见第6.2节]
```

### 10.3 集成时序图

```
ST页面加载
    |
    v
mobile-phone.js 加载
    |-- 创建 window.mobilePhone
    |-- 注册各模块
    |
    v
bridge-api.js 加载
    |-- 创建 window.BridgeAPI
    |-- 初始化 UnifiedAI
    |-- 初始化 VariableInterceptor
    |-- 初始化 OutputLayer
    |
    v
independent-ai.js 加载
    |-- 创建 window.PhoneEngine
    |-- 初始化 WorkflowEngine
    |-- 注册内置工作流
    |-- PhoneEngine.init()
    |
    v
quest-planner-bridge.js 加载
    |-- 扩展 WorkflowEngine (如需额外工作流)
    |
    v
各 app 模块加载 (message-app, shop-app, task-app...)
    |-- 通过 ModuleManager 注册
    |-- 移除各自的 generateViaPhoneAI()，改用 UnifiedAI.call()
    |
    v
PhoneEngine 就绪
    |-- 监听变量变更
    |-- 等待工作流触发
    |-- 统一调度模块响应
```

---

## 11. 接口定义

### 11.1 PhoneEngine 全局接口

```typescript
interface PhoneEngine {
    // 生命周期
    init(): Promise<void>;
    getStatus(): EngineStatus;

    // 事件总线
    on(event: string, callback: Function): Function;   // 返回取消函数
    once(event: string, callback: Function): Function;
    off(event: string, callback: Function): void;
    emit(event: string, data: any): void;

    // 工作流管理
    registerWorkflow(workflow: Workflow): void;
    removeWorkflow(id: string): void;
    triggerWorkflow(id: string, event: EngineEvent): Promise<void>;

    // 模块管理
    registerModule(name: string, instance: Module, config?: ModuleConfig): void;
    getModuleState(name: string): string;
}

interface EngineStatus {
    initialized: boolean;
    workflows: number;
    aiStats: AIStats;
    modules: Record<string, ModuleState>;
}

interface AIStats {
    total: number;
    success: number;
    failed: number;
    byBackend: Record<string, { success: number; failed: number }>;
}
```

### 11.2 UnifiedAI 接口

```typescript
interface UnifiedAI {
    init(): void;
    call(prompt: string, options?: AIOptions): Promise<string>;
    getStats(): AIStats;
}

interface AIOptions {
    backend?: 'auto' | 'customAPI' | 'RoleAPI' | 'XBBridge';
    maxTokens?: number;       // 默认 500
    temperature?: number;     // 默认 0.7
    timeout?: number;         // 默认 30000ms
    fallback?: boolean;       // 默认 true
}
```

### 11.3 WorkflowEngine 接口

```typescript
interface WorkflowEngine {
    register(workflow: Workflow): void;
    remove(id: string): void;
    getWorkflow(id: string): Workflow | undefined;
    listWorkflows(): Workflow[];
    trigger(id: string, event: EngineEvent): Promise<void>;
}

interface Workflow {
    id: string;
    name: string;
    priority: number;           // 0-100
    trigger: WorkflowTrigger;
    condition?: WorkflowCondition;
    actions: WorkflowAction[];
    options?: WorkflowOptions;
}

interface WorkflowTrigger {
    type: 'variable_changed' | 'st_event' | 'timer' | 'bridge_ws' | 'manual';
    pattern: string | RegExp;
    filter?: Record<string, any>;
    interval?: number;          // 仅 timer 类型
}

interface WorkflowCondition {
    type: 'expr' | 'function';
    expr?: string;
    fn?: (context: ActionContext) => boolean;
}

interface WorkflowAction {
    type: 'ai_call' | 'module_call' | 'variable_set' | 'ui_update' | 'event_emit';
    target: string;
    params: Record<string, any>;
    resultKey?: string;         // ai_call 的结果存储键
    condition?: WorkflowCondition;
    parallel?: boolean;
    timeout?: number;
}

interface WorkflowOptions {
    debounce?: number;          // 防抖时间(ms)
    dedup?: boolean;            // 去重
    timeout?: number;           // 总超时(ms)
    retry?: number;             // 重试次数
}
```

### 11.4 EventBus 接口

```typescript
interface EventBus {
    on(event: string, callback: Function, options?: { priority?: number }): Function;
    once(event: string, callback: Function): Function;
    off(event: string, idOrCallback: string | Function): void;
    emit(event: string, data: any): void;
    getHistory(eventFilter?: string, limit?: number): EventRecord[];
}
```

### 11.5 MemoryLayer 接口

```typescript
interface MemoryLayer {
    updateSummary(name: string, event: string, metadata?: Record<string, any>): Promise<void>;
    getSummary(name: string): string;
    getAllSummaries(): Record<string, string>;
    compact(): Promise<void>;
}
```

### 11.6 ModuleManager 接口

```typescript
interface ModuleManager {
    register(name: string, instance: Module, config?: ModuleConfig): void;
    init(name: string): Promise<void>;
    deactivate(name: string): Promise<void>;
    destroy(name: string): Promise<void>;
    getState(name: string): string;
    getAllStates(): Record<string, { state: string; config: ModuleConfig }>;
}

interface ModuleConfig {
    dependencies?: string[];    // 依赖的其他模块名
    autoInit?: boolean;         // 是否自动初始化
    lazy?: boolean;             // 是否懒加载
}

interface Module {
    init?(): Promise<void>;
    activate?(): Promise<void>;
    deactivate?(): Promise<void>;
    destroy?(): Promise<void>;
}
```

---

## 12. 实施阶段

### Phase 1: 统一AI接口 + 事件总线 (预计 2-3 天)

**目标**: 消除重复代码，建立基础通信设施

```
+--------------------------------------------------+
| Phase 1 任务清单                                   |
+--------------------------------------------------+
| [ ] 1.1 在 bridge-api.js 中实现 UnifiedAI        |
| [ ] 1.2 扩展 BridgeClient 事件系统为 EventBus     |
| [ ] 1.3 在 independent-ai.js 中创建 PhoneEngine   |
|        入口，挂载到 window.PhoneEngine             |
| [ ] 1.4 重构 shop-app.js:                        |
|        generateViaPhoneAI() → UnifiedAI.call()    |
| [ ] 1.5 重构 friends-circle.js:                   |
|        generateViaPhoneAI() → UnifiedAI.call()    |
| [ ] 1.6 重构 task-app.js:                         |
|        generateViaPhoneAI() → UnifiedAI.call()    |
| [ ] 1.7 合并 pending-msg-event-patch.js 和        |
|        bridge-api.js 的重复变量监听器              |
| [ ] 1.8 编写单元测试验证 AI 降级逻辑              |
+--------------------------------------------------+
```

**验收标准**:
- `generateViaPhoneAI()` 仅保留一处实现 (UnifiedAI)
- 所有模块通过 `UnifiedAI.call()` 调用AI
- AI后端故障时自动降级到下一个可用后端
- 事件总线可正常发布/订阅事件

### Phase 2: 工作流规则引擎 (预计 3-4 天)

**目标**: 实现核心调度逻辑

```
+--------------------------------------------------+
| Phase 2 任务清单                                   |
+--------------------------------------------------+
| [ ] 2.1 在 quest-planner-bridge.js 中实现         |
|        WorkflowEngine                             |
| [ ] 2.2 实现变量拦截器 VariableInterceptor        |
| [ ] 2.3 注册内置工作流:                           |
|        - 消息到达处理工作流                        |
|        - ENA推演完成响应工作流                     |
|        - 任务状态变更工作流                        |
| [ ] 2.4 实现工作流防抖和去重机制                   |
| [ ] 2.5 实现模板变量解析 {{data.value}}           |
| [ ] 2.6 实现工作流条件判断和分支                   |
| [ ] 2.7 实现模块生命周期管理 ModuleManager         |
| [ ] 2.8 集成测试: 端到端工作流触发验证            |
+--------------------------------------------------+
```

**验收标准**:
- 变量变更能触发对应工作流
- 工作流按优先级和防抖规则执行
- 动作序列顺序执行，支持条件分支
- 工作流执行失败有错误上报

### Phase 3: 全局记忆共享 (预计 2-3 天)

**目标**: 实现三方信息互通

```
+--------------------------------------------------+
| Phase 3 任务清单                                   |
+--------------------------------------------------+
| [ ] 3.1 定义 xb.* 命名空间规范                    |
| [ ] 3.2 实现 MemoryLayer 记忆摘要机制             |
| [ ] 3.3 实现 OutputLayer 统一输出管理             |
| [ ] 3.4 配置世界书条目引用 xb.* 变量             |
| [ ] 3.5 实现记忆定期压缩 compact()                |
| [ ] 3.6 验证小白X → 小手机 → ST 信息流转         |
| [ ] 3.7 验证小手机 → 小白X 结果回传              |
+--------------------------------------------------+
```

**验收标准**:
- 小白X写入 `xb.game.*` 变量后小手机能感知并响应
- 小手机操作结果写入 `xb.quest.result.*` 后小白X能读取
- ST主LLM通过世界书能感知 `xb.*` 变量变化
- 记忆摘要不超过设定长度，定期自动压缩

### Phase 4: 智能调度 (预计 3-5 天)

**目标**: 根据推演结果自动编排模块响应

```
+--------------------------------------------------+
| Phase 4 任务清单                                   |
+--------------------------------------------------+
| [ ] 4.1 注册角色阶段变化工作流                     |
| [ ] 4.2 注册定时触发工作流                         |
| [ ] 4.3 实现动态工作流生成                         |
|        (AI根据推演结果生成响应计划)                |
| [ ] 4.4 实现工作流链 (一个工作流触发另一个)        |
| [ ] 4.5 实现调度优先级动态调整                     |
| [ ] 4.6 添加 PhoneEngine 调试面板                  |
|        (查看工作流状态、事件历史、AI统计)           |
| [ ] 4.7 全面集成测试                              |
| [ ] 4.8 性能优化和边界情况处理                    |
+--------------------------------------------------+
```

**验收标准**:
- ENA推演完成后自动触发相关模块响应
- 定时任务正常执行 (微博自动生成、朋友圈自动更新)
- 调试面板可实时查看引擎状态
- 无内存泄漏，长时间运行稳定

---

## 13. 现有问题修复清单

### 13.1 CSS文字截断问题

| 项目 | 详情 |
|------|------|
| **问题** | `message-app.css` 的 `white-space: nowrap` 覆盖了 `message-renderer.css` 的换行设置 |
| **影响** | 长消息无法正常换行显示 |
| **修复方案** | 在 `message-renderer.css` 中使用更高优先级选择器覆盖 |
| **修复文件** | `message-renderer.css` |
| **修复代码** | |

```css
/* message-renderer.css - 提高选择器优先级 */
#phone-screen .message-content,
#phone-screen .message-bubble {
    white-space: pre-wrap !important;
    word-wrap: break-word !important;
    overflow-wrap: break-word !important;
}
```

### 13.2 反引号报错问题

| 项目 | 详情 |
|------|------|
| **问题** | 循环任务中 `<<taskjs>>` 不支持模板字符串（反引号 `` ` ``） |
| **影响** | 使用模板字符串的任务脚本会报语法错误 |
| **修复方案** | 在 taskjs 解析器中将模板字符串转换为普通字符串拼接 |
| **修复文件** | `task-app.js` |
| **修复代码** | |

```javascript
// task-app.js - 在解析 <<taskjs>> 内容之前添加预处理

function preprocessTaskJS(code) {
    // 将模板字符串转换为普通字符串拼接
    // ${expr} → " + (expr) + "
    let processed = code.replace(/`([^`]*)`/g, (match, content) => {
        const converted = content.replace(/\$\{([^}]+)\}/g, '" + ($1) + "');
        return '"' + converted + '"';
    });
    return processed;
}

// 在执行 taskjs 代码前调用
// const code = preprocessTaskJS(rawTaskJSCode);
```

### 13.3 重复监听器问题

| 项目 | 详情 |
|------|------|
| **问题** | `pending-msg-event-patch.js` 和 `bridge-api.js` 的变量监听器功能重复 |
| **影响** | 同一变量变更被处理两次，可能导致重复响应 |
| **修复方案** | 统一为 VariableInterceptor，移除 pending-msg-event-patch.js 中的重复监听 |
| **修复文件** | `pending-msg-event-patch.js`, `bridge-api.js` |
| **修复代码** | |

```javascript
// pending-msg-event-patch.js - 移除重复的变量监听逻辑
// 保留事件兜底机制，但将变量监听委托给 VariableInterceptor

// 原代码 (移除):
// setInterval(() => {
//     const msg = Mvu.getLocalVariable('pending_message');
//     if (msg && msg !== lastMsg) { ... }
// }, 1000);

// 替换为:
if (window.PhoneEngine) {
    PhoneEngine.on('variable:changed:pending_message', (event) => {
        // 兜底处理逻辑 (仅在 VariableInterceptor 未触发时)
        handleMessageEvent(event.data);
    });
}
```

### 13.4 四选项第一次点击没反应

| 项目 | 详情 |
|------|------|
| **问题** | QuickReplyBridge 的 MutationObserver 时序问题导致第一次点击无响应 |
| **影响** | 用户需要点击两次才能选择选项 |
| **修复方案** | 在 MutationObserver 回调中添加 `requestAnimationFrame` 确保DOM就绪 |
| **修复文件** | 包含 QuickReplyBridge 的文件 |
| **修复代码** | |

```javascript
// QuickReplyBridge - 修复 MutationObserver 时序

// 原代码:
// observer.observe(target, { childList: true, subtree: true });

// 修复后:
observer.observe(target, { childList: true, subtree: true });

// 在回调中添加:
const callback = (mutations) => {
    // 使用 requestAnimationFrame 确保DOM已完成渲染
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // 绑定点击事件
            bindQuickReplyButtons();
        });
    });
};
```

### 13.5 generateViaPhoneAI() 重复实现

| 项目 | 详情 |
|------|------|
| **问题** | `generateViaPhoneAI()` 在 shop-app.js、friends-circle.js、task-app.js 中重复实现3次 |
| **影响** | 代码冗余，修改一处需要同步修改三处，后端切换逻辑不一致 |
| **修复方案** | 统一使用 UnifiedAI.call()，删除各模块中的重复实现 |
| **修复文件** | `shop-app.js`, `friends-circle.js`, `task-app.js` |
| **修复代码** | |

```javascript
// ====== 各模块中的替换方案 ======

// shop-app.js - 原代码:
// async function generateViaPhoneAI(prompt) { ... }
// 替换为:
async function shopAI(prompt, options) {
    return await UnifiedAI.call(prompt, {
        ...options,
        backend: 'auto'  // 自动选择最优后端
    });
}

// friends-circle.js - 同上替换
// task-app.js - 同上替换

// 统一调用方式:
// const response = await UnifiedAI.call(prompt, { maxTokens: 300 });
```

### 13.6 修复优先级

```
+----+------------------------+----------+------------------+
| #  | 问题                   | 优先级   | Phase            |
+----+------------------------+----------+------------------+
| 1  | generateViaPhoneAI重复 | P0 (高)  | Phase 1          |
| 2  | 重复监听器             | P0 (高)  | Phase 1          |
| 3  | 四选项点击无响应       | P1 (中)  | Phase 1          |
| 4  | CSS文字截断            | P1 (中)  | Phase 1          |
| 5  | 反引号报错             | P2 (低)  | Phase 2          |
+----+------------------------+----------+------------------+
```

---

## 14. 风险与注意事项

### 14.1 兼容性风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| MonkeyPatch 拦截 setLocalVariable 可能与其他插件冲突 | 变量写入异常 | 添加版本检测和冲突检测，提供开关 |
| UnifiedAI 降级链中所有后端不可用 | AI功能完全失效 | 保留原始 generateViaPhoneAI 作为最终兜底 |
| 工作流执行阻塞主线程 | 页面卡顿 | 所有工作流动作使用 async/await，避免同步阻塞 |
| 记忆摘要AI调用消耗资源 | 性能下降 | 摘要更新添加防抖(至少5分钟间隔)，压缩操作放在空闲时执行 |

### 14.2 性能注意事项

```
+------------------------+------------------------------------------+
| 关注点                 | 建议                                     |
+------------------------+------------------------------------------+
| 变量拦截频率           | 对高频变量(如时间戳)添加过滤，避免不必要  |
|                        | 的工作流触发                              |
| AI调用并发             | UnifiedAI 限制并发数为3，避免后端过载     |
| 事件监听器泄漏         | 模块销毁时必须移除所有事件监听器          |
| 记忆摘要长度           | 单个摘要不超过500字，总记忆不超过5000字   |
| 工作流历史             | 事件历史限制100条，避免内存增长           |
| 定时器管理             | 引擎销毁时清理所有 setInterval             |
+------------------------+------------------------------------------+
```

### 14.3 调试支持

```javascript
// 开发模式下启用详细日志
window.PhoneEngine_DEBUG = true;

// 查看引擎状态
console.table(PhoneEngine.getStatus());

// 查看工作流列表
console.table(WorkflowEngine.listWorkflows().map(w => ({
    id: w.id,
    name: w.name,
    priority: w.priority,
    trigger: w.trigger.type + ':' + w.trigger.pattern
})));

// 查看AI调用统计
console.table(UnifiedAI.getStats());

// 查看事件历史
console.table(PhoneEngine.getHistory(null, 20));

// 手动触发工作流 (测试用)
PhoneEngine.triggerWorkflow('msg-arrival', {
    type: 'variable:changed',
    key: 'xb.msg.test_npc',
    value: '测试消息内容',
    source: 'manual',
    timestamp: Date.now()
});
```

---

## 附录 A: 事件名称规范

```
# 输入事件
variable:changed                  # 变量变更 (通用)
variable:changed:{pattern}        # 特定模式变量变更
st:generate_after                 # ST生成完成
st:message_received               # ST收到消息
bridge:ws:{event}                 # PluginBridge WebSocket事件

# 工作流事件
workflow:started                  # 工作流开始执行
workflow:completed                # 工作流执行完成
workflow:error                    # 工作流执行失败

# 模块事件
module:activated                  # 模块激活
module:deactivated                # 模块停用
module:error                      # 模块错误

# 输出事件
output:variable                   # 变量已写入
output:ui                         # UI已更新
output:context                    # 上下文已注入

# 记忆事件
memory:summary_updated            # 记忆摘要已更新
memory:compacted                  # 记忆已压缩

# 引擎事件
engine:ready                      # 引擎就绪
engine:notification               # 引擎通知
```

## 附录 B: xb.* 变量速查表

```
# 小白X → 小手机 (只读)
xb.game.event                     # 推演事件
xb.game.state                     # 游戏状态
xb.game.plot                      # 剧情进展
xb.game.npc.{name}                # NPC状态

# 小手机 → 小白X (只写)
xb.quest.result.task              # 任务处理结果
xb.quest.result.shop              # 商城操作结果
xb.quest.result.social            # 社交操作结果
xb.quest.result.engine            # 引擎处理结果
xb.quest.status.{module}          # 模块状态

# 三方共享 (读写)
xb.phone.{name}.summary           # 角色记忆摘要
xb.phone.{name}.mood              # 角色心情
xb.phone.{name}.relationship      # 关系状态
xb.phone.msg.received             # 消息接收记录
xb.phone.msg.sent                 # 消息发送记录
xb.phone.context.{id}             # 上下文快照

# 长期记忆
xb.memory.episode.{id}            # 剧集记忆
xb.memory.summary                 # 全局摘要
xb.memory.timeline                # 时间线
```
