/**
 * Shop App - 购物应用
 * 为mobile-phone.js提供购物功能
 */

// @ts-nocheck
// 避免重复定义
if (typeof window.ShopApp === 'undefined') {
  class ShopApp {
    constructor() {
      this.currentView = 'productList'; // 'productList', 'cart', 'checkout'
      this.currentTab = 'productList'; // 'productList', 'cart'
      this.currentProductType = 'all'; // 'all', '数码', '服装', '家居', etc.
      this.showCategories = false; // 是否显示分类标签栏
      this.products = [];
      this.cart = [];
      this.contextMonitor = null;
      this.lastProductCount = 0;
      this.isAutoRenderEnabled = true;
      this.lastRenderTime = 0;
      this.renderCooldown = 1000;
      this.eventListenersSetup = false;
      this.contextCheckInterval = null;

      this.init();
    }

    init() {
      console.log('[Shop App] 购物应用初始化开始 - 版本 3.3 (事件驱动刷新)');

      // 立即从变量管理器读取一次商品信息
      this.parseProductsFromContext();

      // 异步初始化监控，避免阻塞界面渲染
      setTimeout(() => {
        this.setupContextMonitor();
      }, 100);

      console.log('[Shop App] 购物应用初始化完成 - 版本 3.3');
    }

    // 设置上下文监控
    setupContextMonitor() {
      console.log('[Shop App] 设置上下文监控...');

      // 不再使用定时检查，只通过事件监听
      // 监听SillyTavern的事件系统（MESSAGE_RECEIVED 和 CHAT_CHANGED）
      this.setupSillyTavernEventListeners();
    }

    // 手动刷新商品数据（在变量操作后调用）
    refreshProductsData() {
      console.log('[Shop App] 🔄 手动刷新商品数据...');
      this.parseProductsFromContext();
    }

    // 设置SillyTavern事件监听器
    setupSillyTavernEventListeners() {
      // 防止重复设置
      if (this.eventListenersSetup) {
        return;
      }

      try {
        // 监听SillyTavern的事件系统
        const eventSource = window['eventSource'];
        const event_types = window['event_types'];

        if (eventSource && event_types) {
          this.eventListenersSetup = true;

          // 创建延迟刷新函数（只在消息接收后刷新）
          const handleMessageReceived = () => {
            console.log('[Shop App] 📨 收到 MESSAGE_RECEIVED 事件，刷新商品数据...');
            setTimeout(() => {
              // 先解析数据
              this.parseProductsFromContext();

              // 如果应用当前处于活动状态，强制刷新UI
              const appContent = document.getElementById('app-content');
              if (appContent && (appContent.querySelector('.shop-product-list') ||
                                 appContent.querySelector('.shop-cart') ||
                                 appContent.querySelector('.shop-checkout'))) {
                console.log('[Shop App] 🔄 强制刷新购物应用UI...');
                appContent.innerHTML = this.getAppContent();
                this.bindEvents();
              }
            }, 500);
          };

          // 只监听消息接收事件（AI回复后）
          if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
            console.log('[Shop App] ✅ 已注册 MESSAGE_RECEIVED 事件监听');
          }

          // 监听聊天变化事件（切换对话时）
          if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
              console.log('[Shop App] 📨 聊天已切换，刷新商品数据...');
              setTimeout(() => {
                this.parseProductsFromContext();
              }, 500);
            });
            console.log('[Shop App] ✅ 已注册 CHAT_CHANGED 事件监听');
          }

          // 保存引用以便后续清理
          this.messageReceivedHandler = handleMessageReceived;
        } else {
          // 减少重试频率，从2秒改为5秒
          setTimeout(() => {
            this.setupSillyTavernEventListeners();
          }, 5000);
        }
      } catch (error) {
        console.warn('[Shop App] 设置SillyTavern事件监听器失败:', error);
      }
    }

    // 防抖函数
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    // 从上下文解析商品信息（学习论坛应用的解析逻辑）
    parseProductsFromContext() {
      try {
        // 获取当前商品数据
        const shopData = this.getCurrentShopData();

        // 更新商品列表
        if (shopData.products.length !== this.products.length || this.hasProductsChanged(shopData.products)) {
          this.products = shopData.products;
          console.log('[Shop App] 🛒 商品数据已更新，商品数:', this.products.length);

          // 检查应用是否处于活动状态
          if (this.isCurrentlyActive()) {
            console.log('[Shop App] 🎨 购物应用处于活动状态，立即更新UI...');
            this.updateProductList();
          } else {
            console.log('[Shop App] 💤 购物应用未激活，数据已更新但UI延迟渲染');
          }
        } else {
          console.log('[Shop App] 📊 商品数据无变化，跳过更新');
        }
      } catch (error) {
        console.error('[Shop App] 解析商品信息失败:', error);
      }
    }

    // 检查购物应用是否当前活动
    isCurrentlyActive() {
      const appContent = document.getElementById('app-content');
      if (!appContent) {
        console.log('[Shop App] ❌ app-content 元素不存在');
        return false;
      }

      // 检查是否包含购物应用的特征元素
      const hasProductList = appContent.querySelector('.shop-product-list') !== null;
      const hasCart = appContent.querySelector('.shop-cart') !== null;
      const hasCheckout = appContent.querySelector('.shop-checkout') !== null;
      const isActive = hasProductList || hasCart || hasCheckout;

      console.log('[Shop App] 活动状态检查:', {
        hasProductList,
        hasCart,
        hasCheckout,
        isActive,
        appContentHTML: appContent.innerHTML.substring(0, 100) + '...'
      });

      return isActive;
    }

    /**
     * 从变量管理器获取拍卖行数据（使用 Mvu 框架 + 向上楼层查找）
     */
    getCurrentShopData() {
      try {
        // 方法1: 使用 Mvu 框架获取变量（与卡片版一致：向上查找有变量的楼层）
        if (window.Mvu && typeof window.Mvu.getMvuData === 'function') {
          // 获取目标消息ID（向上查找最近有AI消息且有变量的楼层）
          let targetMessageId = 'latest';

          if (typeof window.getLastMessageId === 'function' && typeof window.getChatMessages === 'function') {
            let currentId = window.getLastMessageId();

            // 向上查找AI消息（跳过用户消息）
            while (currentId >= 0) {
              const message = window.getChatMessages(currentId).at(-1);
              if (message && message.role !== 'user') {
                targetMessageId = currentId;
                if (currentId !== window.getLastMessageId()) {
                  console.log(`[Shop App] 📝 向上查找到第 ${currentId} 层的AI消息`);
                }
                break;
              }
              currentId--;
            }

            if (currentId < 0) {
              targetMessageId = 'latest';
              console.warn('[Shop App] ⚠️ 没有找到AI消息，使用最后一层');
            }
          }

          console.log('[Shop App] 使用消息ID:', targetMessageId);

          // 获取变量
          const mvuData = window.Mvu.getMvuData({ type: 'message', message_id: targetMessageId });
          console.log('[Shop App] 从 Mvu 获取变量数据:', mvuData);
          console.log('[Shop App] stat_data 存在:', !!mvuData?.stat_data);
          if (mvuData?.stat_data) {
            console.log('[Shop App] stat_data 的键:', Object.keys(mvuData.stat_data));
            console.log('[Shop App] 商品是否存在:', !!mvuData.stat_data['商品']);
            if (mvuData.stat_data['商品']) {
              console.log('[Shop App] 商品数据:', mvuData.stat_data['商品']);
            }
          }

          // 尝试从 stat_data 读取
          if (mvuData && mvuData.stat_data && mvuData.stat_data['商品']) {
            const productData = mvuData.stat_data['商品'];
            console.log('[Shop App] ✅ 从 stat_data 获取到商品数据:', productData);
            return this.parseProductData(productData);
          }

          // 尝试从根级别读取（如果变量不在 stat_data 中）
          if (mvuData && mvuData['商品']) {
            const productData = mvuData['商品'];
            console.log('[Shop App] ✅ 从根级别获取到商品数据:', productData);
            return this.parseProductData(productData);
          }

          // 如果 stat_data 为空但 variables 存在，尝试从 variables 获取
          if (mvuData && !mvuData.stat_data && window.SillyTavern) {
            const context = window.SillyTavern.getContext ? window.SillyTavern.getContext() : window.SillyTavern;
            if (context && context.chatMetadata && context.chatMetadata.variables) {
              const stat_data = context.chatMetadata.variables['stat_data'];
              if (stat_data && stat_data['商品']) {
                console.log('[Shop App] ✅ 从 variables.stat_data 获取商品数据');
                return this.parseProductData(stat_data['商品']);
              }
            }
          }
        }

        // 方法2: 尝试从 SillyTavern 的上下文获取（备用）
        if (window.SillyTavern) {
          const context = window.SillyTavern.getContext ? window.SillyTavern.getContext() : window.SillyTavern;
          if (context && context.chatMetadata && context.chatMetadata.variables) {
            // 尝试从 variables.stat_data 获取
            const stat_data = context.chatMetadata.variables['stat_data'];
            if (stat_data && stat_data['商品']) {
              console.log('[Shop App] 从 context.chatMetadata.variables.stat_data 获取商品数据');
              return this.parseProductData(stat_data['商品']);
            }

            // 尝试直接从 variables 获取
            const productData = context.chatMetadata.variables['商品'];
            if (productData && typeof productData === 'object') {
              console.log('[Shop App] 从 context.chatMetadata.variables 获取商品数据');
              return this.parseProductData(productData);
            }
          }
        }

        console.log('[Shop App] 未找到商品数据');
      } catch (error) {
        console.warn('[Shop App] 获取商品数据失败:', error);
      }

      return { products: [] };
    }

    /**
     * 解析商品变量数据
     * 商品结构：{ s001: {商品名称: [值, ''], 价格: [值, ''], 库存: [值, ''], 分类: [值, ''], 描述: [值, ''], 品质: [值, '']}, ... }
     */
    parseProductData(productData) {
      const products = [];

      try {
        // 遍历所有商品
        Object.keys(productData).forEach(productKey => {
          // 跳过元数据
          if (productKey === '$meta') return;

          const product = productData[productKey];
          if (!product || typeof product !== 'object') return;

          // 提取商品数据（变量格式：[值, 描述]）
          const getName = (field) => product[field] && Array.isArray(product[field]) ? product[field][0] : '';
          const getNumber = (field) => {
            const val = product[field] && Array.isArray(product[field]) ? product[field][0] : 0;
            return typeof val === 'number' ? val : parseFloat(val) || 0;
          };

          const name = getName('商品名称') || productKey;
          const price = getNumber('价格');
          const stock = getNumber('库存');
          const category = getName('分类') || '其他';
          const description = getName('描述') || '暂无描述';
          const quality = getName('品质') || '普通';

          // 跳过无效商品（没有价格或库存为0）
          if (!name || price <= 0 || stock <= 0) return;

          const newProduct = {
            id: productKey,
            name: name,
            type: category,
            description: description,
            price: price,
            image: this.getProductImage(category),
            stock: stock,
            quality: quality, // 品质
            category: category,
            timestamp: new Date().toLocaleString(),
          };

          products.push(newProduct);
        });

        console.log('[Shop App] 从商品解析完成，商品数:', products.length);
      } catch (error) {
        console.error('[Shop App] 解析商品数据失败:', error);
      }

      return { products };
    }

    /**
     * 解析六维加成数据
     */
    parseSixDimensions(sixDimData) {
      if (!sixDimData || typeof sixDimData !== 'object') return null;

      const result = {};
      const dims = ['根骨', '悟性', '神识', '命数', '魅力', '潜力'];

      dims.forEach(dim => {
        if (sixDimData[dim] && Array.isArray(sixDimData[dim])) {
          const value = sixDimData[dim][0];
          if (typeof value === 'number' && value !== 0) {
            result[dim] = value;
          }
        }
      });

      return Object.keys(result).length > 0 ? result : null;
    }

    // 检查商品是否有变化（更高效的比较方法）
    hasProductsChanged(newProducts) {
      if (newProducts.length !== this.products.length) {
        return true;
      }

      for (let i = 0; i < newProducts.length; i++) {
        const newProduct = newProducts[i];
        const oldProduct = this.products[i];

        if (
          !oldProduct ||
          newProduct.name !== oldProduct.name ||
          newProduct.type !== oldProduct.type ||
          newProduct.description !== oldProduct.description ||
          newProduct.price !== oldProduct.price
        ) {
          return true;
        }
      }

      return false;
    }

    // 获取商品图片
    getProductImage(type) {
      const imageMap = {
        // 商品分类
        消耗品: '💊',
        装备: '⚔️',
        材料: '📦',
        道具: '✨',
        // 旧版兼容
        食品: '🍎',
        食物: '🍎',
        饮料: '🥤',
        服装: '👔',
        数码: '📱',
        家居: '🏠',
        美妆: '💄',
        运动: '⚽',
        图书: '📚',
        玩具: '🧸',
        音乐: '🎵',
        其他: '🛒',
        默认: '🛒',
      };
      return imageMap[type] || imageMap['默认'];
    }

    // 获取聊天数据
    getChatData() {
      try {
        // 优先使用mobileContextEditor获取数据
        const mobileContextEditor = window['mobileContextEditor'];
        if (mobileContextEditor) {
          const chatData = mobileContextEditor.getCurrentChatData();
          if (chatData && chatData.messages && chatData.messages.length > 0) {
            return chatData.messages;
          }
        }

        // 尝试从全局变量获取
        const chat = window['chat'];
        if (chat && Array.isArray(chat)) {
          return chat;
        }

        // 尝试从其他可能的位置获取
        const SillyTavern = window['SillyTavern'];
        if (SillyTavern && SillyTavern.chat) {
          return SillyTavern.chat;
        }

        return [];
      } catch (error) {
        console.error('[Shop App] 获取聊天数据失败:', error);
        return [];
      }
    }

    // 获取应用内容
    getAppContent() {
      // 每次打开应用时重新解析一次数据（确保显示最新内容）
      const shopData = this.getCurrentShopData();
      if (shopData.products.length !== this.products.length || this.hasProductsChanged(shopData.products)) {
        this.products = shopData.products;
        console.log('[Shop App] 🛒 打开应用时更新商品数据，商品数:', this.products.length);
      }

      switch (this.currentView) {
        case 'productList':
          return this.renderProductList();
        case 'cart':
          return this.renderCart();
        case 'checkout':
          return this.renderCheckout();
        default:
          return this.renderProductList();
      }
    }

    // 渲染购物页面标签页
    renderShopTabs() {
      const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
      const productCount = this.products.length;

      return `
          <div class="shop-tabs">
              <button class="shop-tab ${this.currentTab === 'productList' ? 'active' : ''}"
                      data-tab="productList">
                  商品列表 (${productCount})
              </button>
              <button class="shop-tab ${this.currentTab === 'cart' ? 'active' : ''}"
                      data-tab="cart">
                  购物车 (${totalItems})
              </button>
          </div>
      `;
    }

    // 渲染商品列表
    renderProductList() {
      console.log('[Shop App] 渲染商品列表...');

      // 获取所有产品类型
      const allTypes = ['all', ...new Set(this.products.map(p => p.type))];

      // 根据当前选择的类型过滤商品
      const filteredProducts =
        this.currentProductType === 'all'
          ? this.products
          : this.products.filter(p => p.type === this.currentProductType);

      if (!this.products.length) {
        return `
                <div class="shop-product-list">
                    ${this.renderShopTabs()}
                    <div class="shop-empty-state">
                        <div class="empty-icon">🛒</div>
                        <div class="empty-title">暂无商品</div>
                    </div>
                </div>
            `;
      }

      // 渲染产品类型标签栏（可折叠）
      const typeTabsHtml = this.showCategories
        ? `
          <div class="product-type-tabs">
              ${allTypes
                .map(
                  type => `
                  <button class="product-type-tab ${this.currentProductType === type ? 'active' : ''}"
                          data-type="${type}">
                      ${type === 'all' ? '全部' : type}
                  </button>
              `,
                )
                .join('')}
          </div>
      `
        : '';

      const productItems = filteredProducts
        .map(
          product => {
            // 构建商品详细信息
            const qualityText = product.quality ? `<span class="product-quality">品质: ${product.quality}</span>` : '';
            const stockText = `<span class="product-stock">库存: ${product.stock}</span>`;

            return `
            <div class="product-item" data-product-id="${product.id}">
                <div class="product-info">
                    <div class="product-header">
                        <div class="product-name">${product.image} ${product.name}</div>
                        <div class="product-type-badge">${product.type}</div>
                    </div>
                    <div class="product-meta">
                        ${qualityText}
                        ${stockText}
                    </div>
                    <div class="product-description">${product.description}</div>
                    <div class="product-footer">
                        <div class="product-price">💰 ${product.price} 货币</div>
                        <button class="add-to-cart-btn" data-product-id="${product.id}">
                            加入购物车
                        </button>
                    </div>
                </div>
            </div>
            `;
          }
        )
        .join('');

      return `
            <div class="shop-product-list">
                ${this.renderShopTabs()}
                ${typeTabsHtml}
                <div class="product-grid">
                    ${productItems}
                </div>
            </div>
        `;
    }

    // 渲染购物车
    renderCart() {
      console.log('[Shop App] 渲染购物车...');

      if (!this.cart.length) {
        return `
                <div class="shop-cart">
                    ${this.renderShopTabs()}
                    <div class="shop-empty-state">
                        <div class="empty-icon">🛒</div>
                        <div class="empty-title">购物车为空</div>
                        <div class="empty-subtitle">快去挑选你喜欢的商品吧</div>
                    </div>
                </div>
            `;
      }

      const cartItems = this.cart
        .map(
          item => {
            // 构建商品元信息
            const qualityText = item.quality ? `<span class="cart-quality">品质: ${item.quality}</span>` : '';

            return `
            <div class="cart-item" data-product-id="${item.id}">
                <div class="cart-item-info">
                    <div class="cart-item-header">
                        <div class="cart-item-name">${item.image} ${item.name}</div>
                        <div class="cart-item-type">${item.type}</div>
                    </div>
                    <div class="cart-item-meta">
                        ${qualityText}
                    </div>
                    <div class="cart-item-description">${item.description}</div>
                    <div class="cart-item-footer">
                        <div class="cart-item-price">💰 ${item.price} 货币</div>
                        <div class="cart-item-quantity">
                            <button class="quantity-btn minus" data-product-id="${item.id}">-</button>
                            <span class="quantity-value">${item.quantity}</span>
                            <button class="quantity-btn plus" data-product-id="${item.id}">+</button>
                        </div>
                        <button class="remove-item-btn" data-product-id="${item.id}">🗑️</button>
                    </div>
                </div>
            </div>
            `;
          }
        )
        .join('');

      const totalPrice = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);

      return `
            <div class="shop-cart">
                ${this.renderShopTabs()}
                <div class="cart-items">
                    ${cartItems}
                </div>
                <div class="cart-footer">
                    <div class="cart-summary">
                        <div class="cart-count">共${totalItems}件商品</div>
                        <div class="cart-total">
                            <span class="total-label">总计：</span>
                            <span class="total-price">💰 ${totalPrice} 货币</span>
                        </div>
                    </div>
                    <div class="cart-actions">
                        <button class="checkout-btn">结算</button>
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染结算页面
    renderCheckout() {
      console.log('[Shop App] 渲染结算页面...');

      const totalPrice = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);

      const orderItems = this.cart
        .map(
          item => `
            <div class="order-item">
                <span class="order-item-name">${item.image} ${item.name}</span>
                <span class="order-item-quantity">x${item.quantity}</span>
                <span class="order-item-price">💰 ${item.price * item.quantity} 货币</span>
            </div>
        `,
        )
        .join('');

      return `
            <div class="shop-checkout">
                <div class="checkout-header">
                    <div class="checkout-title">订单确认</div>
                </div>
                <div class="order-summary">
                    <div class="order-title">订单详情</div>
                    ${orderItems}
                    <div class="order-total">
                        <div class="total-items">共 ${totalItems} 件商品</div>
                        <div class="total-price">总计：💰 ${totalPrice} 货币</div>
                    </div>
                </div>
                <div class="checkout-actions">
                    <button class="back-to-cart-btn">返回购物车</button>
                    <button class="confirm-order-btn">确认订单</button>
                </div>
            </div>
        `;
    }

    // 更新商品列表显示
    updateProductList() {
      if (this.currentView === 'productList') {
        this.updateAppContent();
      }
    }

    // 更新应用内容
    updateAppContent(preserveScrollPosition = false) {
      const appContent = document.getElementById('app-content');
      if (appContent) {
        // 保存滚动位置
        let scrollTop = 0;
        if (preserveScrollPosition) {
          const scrollContainer = appContent.querySelector('.product-grid, .cart-items');
          if (scrollContainer) {
            scrollTop = scrollContainer.scrollTop;
          }
        }

        appContent.innerHTML = this.getAppContent();
        this.bindEvents();

        // 恢复滚动位置
        if (preserveScrollPosition && scrollTop > 0) {
          setTimeout(() => {
            const scrollContainer = appContent.querySelector('.product-grid, .cart-items');
            if (scrollContainer) {
              scrollContainer.scrollTop = scrollTop;
            }
          }, 0);
        }
      }
    }

    // 渲染应用（供测试页面使用）
    renderApp() {
      return this.getAppContent();
    }

    // 绑定事件
    bindEvents() {
      console.log('[Shop App] 绑定事件...');

      // 添加到购物车
      document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const productId = e.target?.getAttribute('data-product-id');
          this.addToCart(productId);
        });
      });

      // 购物车数量调整
      document.querySelectorAll('.quantity-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target;
          const productId = target?.getAttribute('data-product-id');
          const isPlus = target?.classList?.contains('plus');
          this.updateCartQuantity(productId, isPlus);
        });
      });

      // 删除购物车项目
      document.querySelectorAll('.remove-item-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const productId = e.target?.getAttribute('data-product-id');
          this.removeFromCart(productId);
        });
      });

      // 导航按钮
      document.querySelectorAll('.back-to-shop-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.showProductList();
        });
      });

      document.querySelectorAll('.checkout-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.showCheckout();
        });
      });

      document.querySelectorAll('.back-to-cart-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.showCart();
        });
      });

      document.querySelectorAll('.confirm-order-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.confirmOrder();
        });
      });

      // 购物页面标签页切换
      document.querySelectorAll('.shop-tab').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const tab = e.target?.getAttribute('data-tab');
          this.switchTab(tab);
        });
      });

      // 产品类型标签页切换
      document.querySelectorAll('.product-type-tab').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const type = e.target?.getAttribute('data-type');
          this.switchProductType(type);
        });
      });
    }

    // 切换购物页面标签页
    switchTab(tab) {
      console.log('[Shop App] 切换标签页:', tab);
      this.currentTab = tab;
      this.currentView = tab;
      this.updateAppContent();
    }

    // 切换产品类型
    switchProductType(type) {
      console.log('[Shop App] 切换产品类型:', type);
      this.currentProductType = type;
      this.updateAppContent();
    }

    // 切换分类显示
    toggleCategories() {
      console.log('[Shop App] 切换分类显示:', !this.showCategories);
      this.showCategories = !this.showCategories;
      this.updateAppContent();
    }

    // 添加到购物车
    addToCart(productId) {
      const product = this.products.find(p => p.id === productId);
      if (!product) return;

      const existingItem = this.cart.find(item => item.id === productId);
      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        this.cart.push({
          ...product,
          quantity: 1,
        });
      }

      this.showToast(`${product.name} 已添加到购物车`, 'success');
      this.updateCartBadge();
    }

    // 更新购物车数量
    updateCartQuantity(productId, isPlus) {
      const item = this.cart.find(item => item.id === productId);
      if (!item) return;

      if (isPlus) {
        item.quantity += 1;
      } else {
        item.quantity -= 1;
        if (item.quantity <= 0) {
          this.removeFromCart(productId);
          return;
        }
      }

      this.updateAppContent(true); // 保持滚动位置
      this.updateCartBadge();
    }

    // 从购物车移除
    removeFromCart(productId) {
      this.cart = this.cart.filter(item => item.id !== productId);
      this.updateAppContent(true); // 保持滚动位置
      this.updateCartBadge();
    }

    // 更新购物车徽章
    updateCartBadge() {
      const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);

      // 只更新购物车标签页的数量显示，不重新渲染整个页面
      const cartTab = document.querySelector('.shop-tab[data-tab="cart"]');
      if (cartTab) {
        cartTab.textContent = `购物车 (${totalItems})`;
      }
    }

    // 显示商品列表
    showProductList() {
      this.currentView = 'productList';
      this.currentTab = 'productList';
      this.updateAppContent();
      this.updateHeader();
    }

    // 显示购物车
    showCart() {
      this.currentView = 'cart';
      this.currentTab = 'cart';
      this.updateAppContent();
      this.updateHeader();
    }

    // 显示结算页面
    showCheckout() {
      if (this.cart.length === 0) {
        this.showToast('购物车为空', 'warning');
        return;
      }

      this.currentView = 'checkout';
      this.updateAppContent();
      this.updateHeader();
    }

    // 确认订单（直接操作变量，不发送消息）
    async confirmOrder() {
      if (this.cart.length === 0) {
        this.showToast('购物车为空', 'warning');
        return;
      }

      try {
        // 直接操作Mvu变量
        await this.updateVariablesDirectly();

      // 清空购物车
      this.cart = [];
      this.updateCartBadge();

        // 刷新商品列表（数量可能变化）
        this.refreshProductsData();

        // 通知背包刷新
        if (window.backpackApp && typeof window.backpackApp.refreshItemsData === 'function') {
          console.log('[Shop App] 通知背包应用刷新...');
          setTimeout(() => {
            window.backpackApp.refreshItemsData();
          }, 500);
        }

        // 显示成功消息
        this.showToast('订单已确认！', 'success');

        // 返回商品列表
        setTimeout(() => {
          this.showProductList();
        }, 1500);
      } catch (error) {
        console.error('[Shop App] 确认订单失败:', error);
        this.showToast('订单确认失败: ' + error.message, 'error');
      }
    }

    // 生成订单摘要
    generateOrderSummary() {
      const totalPrice = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);

      const itemsList = this.cart
        .map(item => `${item.name} x${item.quantity} = ${item.price * item.quantity} 货币`)
        .join('\n');

      return `订单确认：
${itemsList}
总计：${totalItems}件商品，${totalPrice} 货币`;
    }

    // 直接操作Mvu变量（不发送消息）
    async updateVariablesDirectly() {
      try {
        console.log('[Shop App] 开始直接更新变量...');

        // 获取目标消息ID
        let targetMessageId = 'latest';
        if (typeof window.getLastMessageId === 'function' && typeof window.getChatMessages === 'function') {
          let currentId = window.getLastMessageId();
          while (currentId >= 0) {
            const message = window.getChatMessages(currentId).at(-1);
            if (message && message.role !== 'user') {
              targetMessageId = currentId;
              break;
            }
            currentId--;
          }
        }

        // 获取Mvu数据
        const mvuData = window.Mvu.getMvuData({ type: 'message', message_id: targetMessageId });
        if (!mvuData || !mvuData.stat_data) {
          throw new Error('无法获取Mvu变量数据');
        }

        // 计算总价
        const totalPrice = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

        // 1. 扣除货币
        const currentMoney = mvuData.stat_data['用户']?.['货币']?.[0] || 0;
        if (currentMoney < totalPrice) {
          throw new Error(`货币不足，当前：${currentMoney}，需要：${totalPrice}`);
        }

        await window.Mvu.setMvuVariable(mvuData, '用户.货币[0]', currentMoney - totalPrice, {
          reason: '购买商品消耗货币',
          is_recursive: false
        });
        console.log(`[Shop App] ✅ 扣除货币: ${totalPrice}`);

        // 2. 处理每个购买的商品
        for (const item of this.cart) {
          const itemKey = item.id; // 商品ID就是键名
          console.log(`[Shop App] 处理商品: ${item.name}, itemKey: ${itemKey}, category: ${item.category}`);

          // 2.1 减少商品库存
          const productPath = `商品.${itemKey}`;
          const product = mvuData.stat_data['商品']?.[itemKey];
          if (product) {
            const currentStock = product['库存']?.[0] || 0;
            const newStock = currentStock - item.quantity;

            if (newStock <= 0) {
              // 库存为0，删除该商品
              await window.Mvu.setMvuVariable(mvuData, productPath, null, {
                reason: '商品售罄',
                is_recursive: false
              });
              console.log(`[Shop App] ✅ 商品售罄删除: ${productPath}`);
            } else {
              // 更新库存
              await window.Mvu.setMvuVariable(mvuData, `${productPath}.库存[0]`, newStock, {
                reason: '减少商品库存',
                is_recursive: false
              });
              console.log(`[Shop App] ✅ 减少库存: ${productPath}.库存[0] = ${newStock}`);
            }
          }

          // 2.2 添加到道具背包（使用卡片版的方法：替换整个分类对象）
          const targetCategory = this.mapCategoryToBackpack(item.category);
          const backpackPath = `道具.${targetCategory}`;
          const backpackCategory = mvuData.stat_data['道具']?.[targetCategory] || {};

          console.log(`[Shop App] 添加到道具: ${backpackPath}.${item.name}`);
          console.log(`[Shop App] 当前道具分类内容:`, backpackCategory);

          // 创建新的分类对象（复制现有物品）
          const newBackpackCategory = { ...backpackCategory };

          // 检查是否已有该物品
          const existingItem = newBackpackCategory[item.name];
          if (existingItem) {
            // 已有物品，增加数量
            const currentCount = existingItem['数量']?.[0] || 0;
            const newCount = currentCount + item.quantity;
            newBackpackCategory[item.name] = {
              ...existingItem,
              数量: [newCount, existingItem['数量']?.[1] || '']
            };
            console.log(`[Shop App] ✅ 已有物品增加数量: ${item.name} 数量 = ${newCount}`);
          } else {
            // 新物品，构建并添加
            const itemData = this.buildBackpackItemData(item);
            console.log(`[Shop App] 构建物品数据:`, itemData);
            newBackpackCategory[item.name] = itemData;
            console.log(`[Shop App] ✅ 新物品添加: ${item.name}`);
          }

          // 一次性设置整个分类（关键：这是卡片版的做法）
          await window.Mvu.setMvuVariable(mvuData, backpackPath, newBackpackCategory, {
            reason: `添加${item.name}到背包`,
            is_recursive: false
          });
          console.log(`[Shop App] ✅ 道具分类已更新: ${backpackPath}`);
        }

        // 3. 不再记录历史（由AI生成摘要代替）
        // 购买操作将在AI回复的摘要中体现

        // 保存更新
        await window.Mvu.replaceMvuData(mvuData, { type: 'message', message_id: targetMessageId });

        console.log('[Shop App] ✅ 变量更新完成');
      } catch (error) {
        console.error('[Shop App] 更新变量失败:', error);
        throw error;
      }
    }

    // 生成变量更新命令
    generateUpdateCommands() {
      const commands = [];

      // 1. 扣除灵石
      const totalPrice = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      commands.push(`_.add('家族信息.灵石[0]', -${totalPrice});//拍卖行购买消耗灵石`);

      // 2. 处理每个购买的商品
      this.cart.forEach(item => {
        // 从拍卖行减少商品数量
        const categoryPath = `拍卖行.${item.category}`;
        const itemKey = this.getItemKeyFromId(item.id, item.category);
        if (itemKey) {
          commands.push(`_.add('${categoryPath}.${itemKey}.数量[0]', -${item.quantity});//拍卖行减少商品数量`);
        }

        // 添加到道具背包
        const targetCategory = this.mapCategoryToBackpack(item.category);
        const backpackPath = `道具.${targetCategory}`;

        // 构建道具数据对象
        const itemData = this.buildBackpackItemData(item);

        commands.push(`_.insert('${backpackPath}', '${item.name}', ${JSON.stringify(itemData)});//添加到背包`);
      });

      // 3. 记录重大事件
      const itemsList = this.cart.map(item => `${item.name}x${item.quantity}`).join('、');
      const currentTime = this.getCurrentGameTime();
      commands.push(`_.assign('剧情系统.重大事件[0]', '${currentTime} - 在拍卖行购买${itemsList}');//记录交易事件`);

      return commands.join('\n');
    }

    // 从商品ID中提取物品键名
    getItemKeyFromId(id, category) {
      // ID格式: category_itemKey_timestamp
      const parts = id.split('_');
      if (parts.length >= 2 && parts[0] === category) {
        return parts[1];
      }
      return null;
    }

    // 映射商品分类到背包分类
    mapCategoryToBackpack(productCategory) {
      const mapping = {
        '消耗品': '消耗品',
        '装备': '装备',
        '材料': '材料',
        '道具': '材料',
        // 旧版兼容
        '食品': '消耗品',
        '食物': '消耗品',
        '饮料': '消耗品',
        '服装': '装备',
        '数码': '装备',
        '家居': '材料',
        '其他': '材料'
      };
      return mapping[productCategory] || '材料';
    }

    // 构建背包物品数据
    buildBackpackItemData(item) {
      const data = {
        名称: [item.name, ''],
        数量: [item.quantity, ''],
        效果: [item.description, ''],
        品质: [item.quality || '普通', '']
      };

      return data;
    }

    // 获取当前游戏时间（向上楼层查找AI消息）
    getCurrentGameTime() {
      try {
        // 使用 Mvu 框架获取变量（向上查找AI消息）
        if (window.Mvu && typeof window.Mvu.getMvuData === 'function') {
          // 获取目标消息ID（向上查找最近的AI消息）
          let targetMessageId = 'latest';

          if (typeof window.getLastMessageId === 'function' && typeof window.getChatMessages === 'function') {
            let currentId = window.getLastMessageId();

            // 向上查找AI消息（跳过用户消息）
            while (currentId >= 0) {
              const message = window.getChatMessages(currentId).at(-1);
              if (message && message.role !== 'user') {
                targetMessageId = currentId;
                break;
              }
              currentId--;
            }

            if (currentId < 0) {
              targetMessageId = 'latest';
            }
          }

          const mvuData = window.Mvu.getMvuData({ type: 'message', message_id: targetMessageId });
          if (mvuData && mvuData.stat_data && mvuData.stat_data['家族信息']) {
            const familyInfo = mvuData.stat_data['家族信息'];
            if (familyInfo.当前时间 && Array.isArray(familyInfo.当前时间)) {
              const timeValue = familyInfo.当前时间[0];
              if (timeValue) return timeValue;
            }
          }
        }

        // 备用方法：从 SillyTavern context 获取
        if (window.SillyTavern) {
          const context = window.SillyTavern.getContext ? window.SillyTavern.getContext() : window.SillyTavern;
          if (context && context.chatMetadata && context.chatMetadata.variables) {
            const familyInfo = context.chatMetadata.variables['家族信息'];
            if (familyInfo && familyInfo.当前时间 && Array.isArray(familyInfo.当前时间)) {
              const timeValue = familyInfo.当前时间[0];
              if (timeValue) return timeValue;
            }
          }
        }
      } catch (error) {
        console.warn('[Shop App] 获取游戏时间失败:', error);
      }
      return '未知时间';
    }

    // 通过手机内部独立AI生成内容（不操作ST的DOM）
    async generateViaPhoneAI(message) {
        // 方法1：使用自定义API配置
        if (window.mobileCustomAPIConfig && window.mobileCustomAPIConfig.isAPIAvailable && window.mobileCustomAPIConfig.isAPIAvailable()) {
            try {
                const messages = [{ role: 'user', content: message }];
                const result = await window.mobileCustomAPIConfig.callAPI(messages, { temperature: 0.8, maxTokens: 500 });
                if (typeof result === 'string') return result;
                if (result && result.choices && result.choices[0]) return result.choices[0].message.content;
            } catch (e) {
                console.warn('[ShopApp] customAPI failed:', e);
            }
        }
        // 方法2：使用RoleAPI
        if (window.RoleAPI && window.RoleAPI.isEnabled && window.RoleAPI.isEnabled()) {
            try {
                const result = await window.RoleAPI.sendMessage('system', 'system', message, { skipHistory: true });
                if (result) return result;
            } catch (e) {
                console.warn('[ShopApp] RoleAPI failed:', e);
            }
        }
        // 方法3：使用XBBridge（非流式）
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
                console.warn('[ShopApp] XBBridge failed:', e);
            }
        }
        console.warn('[ShopApp] 所有AI后端不可用');
        return null;
    }

    // 发送查看商品消息（通过手机内部AI生成，不发送到ST）
    async sendViewProductsMessage() {
      try {
        console.log('[ShopApp] 通过手机内部AI生成商品列表...');

        const message = '请按照当前剧情，生成至少10件商品的数据。请以JSON格式返回，格式为：[{"name":"商品名称","price":100,"stock":5,"category":"分类","description":"描述","quality":"品质"}]。只返回JSON，不要其他内容。';

        const result = await this.generateViaPhoneAI(message);
        if (!result) {
          this.showToast('AI不可用，无法生成商品列表', 'warning');
          return;
        }

        // 尝试解析AI返回的商品数据
        try {
          // 提取JSON部分（AI可能在JSON前后加了其他文字）
          const jsonMatch = result.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const productsData = JSON.parse(jsonMatch[0]);
            if (Array.isArray(productsData) && productsData.length > 0) {
              console.log('[ShopApp] AI生成了', productsData.length, '件商品');
              // 将AI生成的商品数据转换为内部格式并更新UI
              const newProducts = productsData.map((p, index) => ({
                id: `ai_${Date.now()}_${index}`,
                name: p.name || `商品${index + 1}`,
                type: p.category || '其他',
                description: p.description || '暂无描述',
                price: parseFloat(p.price) || 0,
                image: this.getProductImage(p.category || '其他'),
                stock: parseInt(p.stock) || 1,
                quality: p.quality || '普通',
                category: p.category || '其他',
                timestamp: new Date().toLocaleString(),
              }));

              // 更新商品列表并刷新UI
              this.products = newProducts;
              this.updateAppContent();
              this.showToast(`已生成 ${newProducts.length} 件商品`, 'success');
            } else {
              this.showToast('AI返回的商品数据格式不正确', 'warning');
            }
          } else {
            this.showToast('AI返回的数据无法解析', 'warning');
          }
        } catch (parseError) {
          console.error('[ShopApp] 解析AI返回的商品数据失败:', parseError);
          this.showToast('解析商品数据失败', 'error');
        }
      } catch (error) {
        console.error('[ShopApp] 生成商品列表失败:', error);
        this.showToast('生成商品列表失败: ' + error.message, 'error');
      }
    }

    // [已废弃] 统一的发送消息方法 - 不再主动调用，保留仅供兼容
    async _sendToSillyTavernDeprecated(message) {
      try {
        console.log('[Shop App] 🔄 使用新版发送方法 v2.0 - 发送消息到SillyTavern:', message);

        // 方法1: 直接使用DOM元素（与消息app相同的方式）
        const originalInput = document.getElementById('send_textarea');
        const sendButton = document.getElementById('send_but');

        if (!originalInput || !sendButton) {
          console.error('[Shop App] 找不到输入框或发送按钮元素');
          return this.sendToSillyTavernBackup(message);
        }

        // 检查输入框是否可用
        if (originalInput.disabled) {
          console.warn('[Shop App] 输入框被禁用');
          return false;
        }

        // 检查发送按钮是否可用
        if (sendButton.classList.contains('disabled')) {
          console.warn('[Shop App] 发送按钮被禁用');
          return false;
        }

        // 设置值
        originalInput.value = message;
        console.log('[Shop App] 已设置输入框值:', originalInput.value);

        // 触发输入事件
        originalInput.dispatchEvent(new Event('input', { bubbles: true }));
        originalInput.dispatchEvent(new Event('change', { bubbles: true }));

        // 延迟点击发送按钮
        await new Promise(resolve => setTimeout(resolve, 300));
        sendButton.click();
        console.log('[Shop App] 已点击发送按钮');

        return true;
      } catch (error) {
        console.error('[Shop App] 发送消息时出错:', error);
        return this.sendToSillyTavernBackup(message);
      }
    }

    // [已废弃] 备用发送方法 - 不再主动调用，保留仅供兼容
    async _sendToSillyTavernBackupDeprecated(message) {
      try {
        console.log('[Shop App] 尝试备用发送方法:', message);

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
        console.error('[Shop App] 备用发送方法失败:', error);
        return false;
      }
    }

    // 手动刷新商品列表
    refreshProductList() {
      console.log('[Shop App] 手动刷新商品列表');
      this.parseProductsFromContext();
      this.updateAppContent();
    }

    // 销毁应用，清理资源
    destroy() {
      console.log('[Shop App] 销毁应用，清理资源');

      // 清理事件监听
      if (this.eventListenersSetup && this.messageReceivedHandler) {
        const eventSource = window['eventSource'];
        if (eventSource && eventSource.removeListener) {
          eventSource.removeListener('MESSAGE_RECEIVED', this.messageReceivedHandler);
          console.log('[Shop App] 🗑️ 已移除 MESSAGE_RECEIVED 事件监听');
        }
      }

      // 重置状态
      this.eventListenersSetup = false;
      this.isAutoRenderEnabled = false;

      // 清空数据
      this.products = [];
      this.cart = [];
    }

    // 更新header
    updateHeader() {
      // 通知mobile-phone更新header
      if (window.mobilePhone && window.mobilePhone.updateAppHeader) {
        const state = {
          app: 'shop',
          title: this.getViewTitle(),
          view: this.currentView,
        };
        window.mobilePhone.updateAppHeader(state);
      }
    }

    // 获取视图标题
    getViewTitle() {
      return '购物';
    }

    // 显示提示消息
    showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `shop-toast ${type}`;
      toast.textContent = message;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('show');
      }, 100);

      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          toast.remove();
        }, 300);
      }, 3000);
    }
  }

  // 创建全局实例
  window.ShopApp = ShopApp;
  window.shopApp = new ShopApp();
} // 结束类定义检查

// 全局函数供mobile-phone.js调用
window.getShopAppContent = function () {
  console.log('[Shop App] 获取购物应用内容');

  if (!window.shopApp) {
    console.error('[Shop App] shopApp实例不存在');
    return '<div class="error-message">购物应用加载失败</div>';
  }

  try {
    return window.shopApp.getAppContent();
  } catch (error) {
    console.error('[Shop App] 获取应用内容失败:', error);
    return '<div class="error-message">获取内容失败</div>';
  }
};

window.bindShopAppEvents = function () {
  console.log('[Shop App] 绑定购物应用事件');

  if (!window.shopApp) {
    console.error('[Shop App] shopApp实例不存在');
    return;
  }

  try {
    window.shopApp.bindEvents();
  } catch (error) {
    console.error('[Shop App] 绑定事件失败:', error);
  }
};

// 供mobile-phone.js调用的额外功能
window.shopAppShowCart = function () {
  if (window.shopApp) {
    window.shopApp.showCart();
  }
};

window.shopAppSendViewMessage = function () {
  if (window.shopApp) {
    window.shopApp.sendViewProductsMessage();
  }
};

window.shopAppToggleCategories = function () {
  if (window.shopApp) {
    window.shopApp.toggleCategories();
  }
};

// 调试和测试功能
window.shopAppRefresh = function () {
  if (window.shopApp) {
    window.shopApp.refreshProductList();
  }
};

window.shopAppDebugInfo = function () {
  if (window.shopApp) {
    console.log('[Shop App Debug] 当前商品数量:', window.shopApp.products.length);
    console.log('[Shop App Debug] 商品列表:', window.shopApp.products);
    console.log('[Shop App Debug] 购物车:', window.shopApp.cart);
    console.log('[Shop App Debug] 当前视图:', window.shopApp.currentView);
    console.log('[Shop App Debug] 事件监听器设置:', window.shopApp.eventListenersSetup);
    console.log('[Shop App Debug] 自动渲染启用:', window.shopApp.isAutoRenderEnabled);

    // 测试变量获取（向上楼层查找AI消息）
    console.log('[Shop App Debug] ===== 测试变量获取 =====');
    console.log('[Shop App Debug] Mvu 框架存在:', !!window.Mvu);
    console.log('[Shop App Debug] Mvu.getMvuData 函数存在:', typeof window.Mvu?.getMvuData === 'function');
    console.log('[Shop App Debug] getLastMessageId 函数存在:', typeof window.getLastMessageId === 'function');
    console.log('[Shop App Debug] getChatMessages 函数存在:', typeof window.getChatMessages === 'function');

    if (window.Mvu && typeof window.Mvu.getMvuData === 'function') {
      try {
        // 获取目标消息ID（向上查找AI消息）
        let targetMessageId = 'latest';

        if (typeof window.getLastMessageId === 'function' && typeof window.getChatMessages === 'function') {
          let currentId = window.getLastMessageId();
          console.log('[Shop App Debug] 最新消息索引:', currentId);

          // 向上查找AI消息
          let searchCount = 0;
          while (currentId >= 0 && searchCount < 20) {
            const message = window.getChatMessages(currentId).at(-1);
            console.log(`[Shop App Debug] 检查第 ${currentId} 层:`, message ? `role=${message.role}` : '无消息');

            if (message && message.role !== 'user') {
              targetMessageId = currentId;
              console.log(`[Shop App Debug] ✅ 找到AI消息楼层: ${currentId} (向上查找 ${searchCount} 层)`);
              break;
            }

            currentId--;
            searchCount++;
          }

          if (currentId < 0) {
            console.warn('[Shop App Debug] ⚠️ 向上查找所有楼层都是用户消息，使用 latest');
          }
        }

        console.log('[Shop App Debug] 使用消息ID:', targetMessageId);

        // 测试获取 Mvu 变量
        const mvuData = window.Mvu.getMvuData({ type: 'message', message_id: targetMessageId });
        console.log('[Shop App Debug] Mvu 变量数据:', mvuData);

        if (mvuData && mvuData.stat_data) {
          console.log('[Shop App Debug] stat_data 变量列表:', Object.keys(mvuData.stat_data));

          if (mvuData.stat_data['拍卖行']) {
            const auctionData = mvuData.stat_data['拍卖行'];
            console.log('[Shop App Debug] 拍卖行数据:', auctionData);

            Object.keys(auctionData).forEach(category => {
              if (category !== '$meta') {
                const items = auctionData[category];
                if (items && typeof items === 'object') {
                  const itemKeys = Object.keys(items).filter(k => k !== '$meta');
                  console.log(`[Shop App Debug] - 分类 ${category}: ${itemKeys.length} 件`, itemKeys);
                }
              }
            });
          } else {
            console.warn('[Shop App Debug] 未找到拍卖行数据');
          }
        } else {
          console.error('[Shop App Debug] ❌ stat_data 为空或不存在');
        }
      } catch (error) {
        console.error('[Shop App Debug] 获取 Mvu 变量失败:', error);
      }
    } else {
      console.warn('[Shop App Debug] Mvu 框架未加载，需要先等待 Mvu 初始化');
      console.log('[Shop App Debug] 提示：如果使用 Mvu 变量框架，请确保已加载并初始化');
    }

    // 测试 SillyTavern context（备用方法）
    if (window.SillyTavern) {
      const context = window.SillyTavern.getContext ? window.SillyTavern.getContext() : window.SillyTavern;
      console.log('[Shop App Debug] SillyTavern context 存在:', !!context);
      if (context && context.chatMetadata) {
        console.log('[Shop App Debug] chatMetadata 存在:', !!context.chatMetadata);
        console.log('[Shop App Debug] variables 存在:', !!context.chatMetadata.variables);
        if (context.chatMetadata.variables) {
          console.log('[Shop App Debug] 变量列表:', Object.keys(context.chatMetadata.variables));
        }
      }
    }
  }
};

// 性能优化：销毁应用实例
window.shopAppDestroy = function () {
  if (window.shopApp) {
    window.shopApp.destroy();
    console.log('[Shop App] 应用已销毁');
  }
};

// 强制重新加载应用（清除缓存）
window.shopAppForceReload = function () {
  console.log('[Shop App] 🔄 强制重新加载应用...');

  // 销毁现有实例
  if (window.shopApp) {
    window.shopApp.destroy();
  }

  // 重新创建实例
  window.shopApp = new ShopApp();
  console.log('[Shop App] ✅ 应用已重新加载 - 版本 3.3');
};

// 检查发送方法版本
window.shopAppCheckVersion = function () {
  console.log('[Shop App] 📋 版本检查:');
  console.log('- generateViaPhoneAI 方法:', typeof window.shopApp?.generateViaPhoneAI);
  console.log('- _sendToSillyTavernDeprecated 方法:', typeof window.shopApp?._sendToSillyTavernDeprecated);
  console.log('- sendViewProductsMessage 方法:', typeof window.shopApp?.sendViewProductsMessage);

  if (window.shopApp?.generateViaPhoneAI) {
    console.log('✅ 新版generateViaPhoneAI方法已加载');
  } else {
    console.log('❌ 新版generateViaPhoneAI方法未找到，请重新加载页面');
  }
};

// 初始化
console.log('[Shop App] 购物应用模块加载完成 - 版本 3.3 (事件驱动刷新 + 直接操作变量)');
