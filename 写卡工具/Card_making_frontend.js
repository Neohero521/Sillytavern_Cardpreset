(function() {
  const SCRIPT_ID = 'modelo-char-generator';

  function showToast(msg, type) {
    type = type || 'info';
    if (type === 'warn') type = 'warning';
    try {
      if (window.parent && window.parent.toastr && window.parent.toastr[type]) window.parent.toastr[type](msg);
      else if (typeof toastr !== 'undefined' && toastr && toastr[type]) toastr[type](msg);
      else if (window.parent && window.parent.toastr) window.parent.toastr.info(msg);
      else alert(msg);
    } catch (e) { try { alert(msg); } catch(_) { console.log(msg); } }
  }

  // ===== Token估算 =====
  function countTokens(text) {
    if (!text) return 0;
    var t = String(text);
    var cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var enWords = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
    return cn + Math.ceil(enWords * 0.75);
  }

  // ===== SillyTavern API 封装（参考 index.js 的全局函数调用方式） =====
  function _g(name) {
    try { if (typeof window[name] === 'function') return window[name]; } catch(_) {}
    try { if (typeof window.parent !== 'undefined' && typeof window.parent[name] === 'function') return window.parent[name]; } catch(_) {}
    return null;
  }

  // 获取当前聊天记录（最近50条，过滤隐藏消息）
  function fetchChatMessages() {
    try {
      var getLastMessageId = _g('getLastMessageId');
      var getChatMessages = _g('getChatMessages');
      if (!getLastMessageId || !getChatMessages) return [];
      var lastId = getLastMessageId();
      if (lastId < 0) return [];
      var startId = Math.max(0, lastId - 49);
      var msgs = getChatMessages(startId + '-' + lastId, { hide_state: 'all' });
      if (!Array.isArray(msgs)) return [];
      return msgs.filter(function(m) { return !m.is_hidden; }).map(function(m) {
        return { messageId: m.message_id, role: m.role, content: m.message || '', name: m.name || '' };
      });
    } catch(e) { console.warn('fetchChatMessages failed:', e); return []; }
  }

  // 获取当前角色名
  function fetchCurrentCharName() {
    try {
      var fn = _g('getCurrentCharacterName');
      if (fn) return fn() || '';
    } catch(_) {}
    try {
      var ctx = _g('getContext');
      if (ctx) { var c = ctx(); if (c && c.name2) return c.name2; }
    } catch(_) {}
    return '';
  }

  // 获取所有角色名列表
  function fetchCharNames() {
    try {
      var fn = _g('getCharacterNames');
      if (fn) return fn() || [];
    } catch(_) {}
    return [];
  }

  // 获取当前预设（in_use）
  function fetchPreset() {
    try {
      var fn = _g('getPreset');
      if (fn) return fn('in_use');
    } catch(_) {}
    return null;
  }

  // 发送消息到 SillyTavern 聊天（参考 index.js: triggerSlash('/send text|/trigger')）
  async function sendToChat(text) {
    try {
      var fn = _g('triggerSlash');
      if (fn) { await fn('/send ' + text + '|/trigger'); return true; }
    } catch(e) { console.warn('sendToChat failed:', e); }
    return false;
  }

  // 注册聊天事件实时监听（返回 stop 函数数组，用于卸载时清理）
  var _eventStops = [];
  function registerChatListeners(onUpdate) {
    try {
      var evtOn = _g('eventOn');
      var te = (typeof tavern_events !== 'undefined') ? tavern_events : (window.parent && window.parent.tavern_events);
      if (!evtOn || !te) return;
      var events = ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'MESSAGE_UPDATED', 'CHAT_CHANGED'];
      events.forEach(function(evName) {
        if (te[evName]) {
          try {
            var r = evtOn(te[evName], function() {
              if (typeof onUpdate === 'function') setTimeout(onUpdate, 100);
            });
            if (r && typeof r.stop === 'function') _eventStops.push(r.stop);
          } catch(_) {}
        }
      });
    } catch(e) { console.warn('registerChatListeners failed:', e); }
  }

  function cleanupChatListeners() {
    _eventStops.forEach(function(stop) { try { stop(); } catch(_) {} });
    _eventStops = [];
  }

  // ===== 世界书名称生成 =====
  function genBookName(worldName) {
    if (!worldName || !worldName.trim()) return '世界设定集';
    return worldName.trim() + ' · 世界书';
  }

  // ===== 世界书条目模板（ST权重分层8体系 · 完整12项原生参数） =====
  // 参数体系：触发精准类(keys/secondary_keys/use_regex/match_whole_words/scan_depth)
  //          生效控制类(sticky/cooldown/delay) 递归安全类(prevent_recursion/exclude_recursion/delay_until_recursion)
  //          数量控制类(selectiveLogic/probability/use_probability) 分组管理类(group/groupWeight)
  // WI参数规范（对齐 ST world_info_logic / world_info_position）：
  //   scan_depth: 常驻=0（不扫描），触发类=3-8（限制关键词扫描的消息深度）
  //   useProbability: 常驻=false（无需概率掷骰），触发类=true（probability 才生效）
  //   group: 空字符串=无互斥分组（多条可共存）；非空=同组仅注入1条（用于叙事类互斥）
  //   selectiveLogic: 0=AND_ANY 1=NOT_ALL 2=NOT_ANY 3=AND_ALL（次级关键词逻辑，非随机选择）
  //          注意：核心铁则不在世界书条目中，而是放入post_history_instructions字段（常驻最高权重位）

  // ===== MVU 美化正则 HTML 模板（纯CSS+emoji实现，无外部依赖）=====
  var MVU_BEAUTIFY_COMPLETE = '<div style="text-align:center;margin:10px 0">\n<div style="display:inline-block;text-align:left">\n  <details class="mvu-done" style="border:none;background:none">\n    <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:0;position:relative;padding:0">\n      <span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:2px solid rgba(76,175,80,0.5);box-shadow:0 0 10px rgba(76,175,80,0.25);flex-shrink:0;z-index:3;position:relative;animation:mvu-done-pulse 2s ease-in-out infinite;background:linear-gradient(135deg,#e8f5e9 0%,#c8e6c9 100%);font-size:22px">✓</span>\n      <span style="display:flex;align-items:center;height:32px;margin-left:-10px;padding:0 20px 0 18px;background:linear-gradient(135deg,#e8f5e9 0%,#d7ecd9 50%,#e8f5e9 100%);border:1.5px solid rgba(76,175,80,0.35);border-radius:0 16px 16px 0;position:relative;z-index:2">\n        <span style="flex:1;font-size:0.9em;font-weight:600;background:linear-gradient(90deg,#2e7d32,#43a047,#2e7d32);-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:mvu-text-shimmer 3s linear infinite">变量已更新</span>\n        <small style="color:#2e7d32;font-size:0.75em;opacity:0.7"><span class="mvu-toggle" data-close="展开 ▶" data-open="收起 ▼"></span></small>\n      </span>\n    </summary>\n    <div style="max-height:320px;overflow-y:auto;margin-left:22px;margin-top:6px;padding:12px 18px;color:#33691e;line-height:1.8;white-space:pre-wrap;background:linear-gradient(135deg,rgba(232,245,233,0.7) 0%,rgba(200,230,201,0.4) 100%);border:1.5px solid rgba(76,175,80,0.25);border-radius:12px;font-size:0.9em;max-width:450px">\n    $1\n    </div>\n  </details>\n</div>\n</div>\n<style>.mvu-done summary::marker{display:none}.mvu-done[open]>div{animation:mvu-slide-in .4s ease forwards}.mvu-done[open] .mvu-toggle::after{content:attr(data-open)}.mvu-done:not([open]) .mvu-toggle::after{content:attr(data-close)}@keyframes mvu-done-pulse{0%,100%{transform:scale(1);box-shadow:0 0 10px rgba(76,175,80,0.25)}50%{transform:scale(1.05);box-shadow:0 0 16px rgba(76,175,80,0.4)}}@keyframes mvu-text-shimmer{0%{background-position:0% center}100%{background-position:200% center}}@keyframes mvu-slide-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}</style>';

  var MVU_BEAUTIFY_THINKING = '<div style="text-align:center;margin:10px 0">\n<div style="display:inline-block;text-align:left">\n  <details class="mvu-thinking" style="border:none;background:none">\n    <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:0;position:relative;padding:0">\n      <span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:2px solid rgba(33,150,243,0.5);box-shadow:0 0 10px rgba(33,150,243,0.25);flex-shrink:0;z-index:3;position:relative;animation:mvu-spin 1.8s linear infinite;background:linear-gradient(135deg,#e3f2fd 0%,#bbdefb 100%);font-size:20px">⟳</span>\n      <span style="display:flex;align-items:center;height:32px;margin-left:-10px;padding:0 20px 0 18px;background:linear-gradient(135deg,#e3f2fd 0%,#d0e9fc 50%,#e3f2fd 100%);border:1.5px solid rgba(33,150,243,0.35);border-radius:0 16px 16px 0;position:relative;z-index:2;overflow:hidden">\n        <span style="flex:1;font-size:0.9em;font-weight:600;background:linear-gradient(90deg,#1565c0,#1976d2,#1565c0);-webkit-background-clip:text;-webkit-text-fill-color:transparent">变量更新中</span>\n        <span class="mvu-blue-glow" style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(90deg,transparent 0%,rgba(33,150,243,0.1) 50%,transparent 100%);animation:mvu-blue-sweep 2.5s linear infinite;transform:translateX(-100%);pointer-events:none"></span>\n      </span>\n    </summary>\n    <div style="max-height:320px;overflow-y:auto;margin-left:22px;margin-top:6px;padding:12px 18px;color:#0d47a1;line-height:1.8;white-space:pre-wrap;background:linear-gradient(135deg,rgba(227,242,253,0.7) 0%,rgba(187,222,251,0.4) 100%);border:1.5px solid rgba(33,150,243,0.25);border-radius:12px;font-size:0.9em;max-width:450px">\n    $1\n    </div>\n  </details>\n</div>\n</div>\n<style>.mvu-thinking summary::marker{display:none}.mvu-thinking[open]>div{animation:mvu-content-in .4s ease forwards}.mvu-thinking[open] summary .mvu-blue-glow{animation:none!important;opacity:0}@keyframes mvu-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}@keyframes mvu-blue-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes mvu-content-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}</style>';

  // ===== MVU 状态栏 HTML 模板（精美版：低饱和柔灰蓝+毛玻璃+网格布局）=====
  // 用途：渲染 <StatusPlaceHolderImpl/> 占位符为可视化状态栏
  // 配套正则：markdownOnly=true, promptOnly=false, 将占位符替换为此HTML
  // 设计要点（对齐(6)号卡片的美观度标准）：
  //   1. 用 getAllVariables() + _.get(allVars,"stat_data",{}) 读变量（复用酒馆助手稳定API，避免Mvu.getVar时序失效）
  //   2. await waitGlobalInitialized('Mvu') 等待 MVU 模块就绪后再绑定事件
  //   3. $(errorCatched(init)) 全局异常捕获，报错不卡死面板
  //   4. 递归 renderTree(obj, level) 渲染任意深度嵌套对象，按层级缩进
  //   5. 跳过 _ / $ 开头的隐藏变量
  //   6. 严格 typeof val === "number" 检测数值，布尔用 ✓/✕，数组元素独立渲染
  //   7. 分类标题(category-title)带▸图标+底部分隔线，stat-grid自动适应网格布局
  //   8. 深色毛玻璃(backdrop-filter)+柔灰蓝配色护眼，hover高亮+刷新淡入动画
  //   9. <script type="module"> 支持顶层 async/await
  //  10. CSS变量改 :root 即可换主题（var(--accent-blue)等）
  var MVU_STATUS_BAR_HTML = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <style>\n* {\n    margin: 0;\n    padding: 0;\n    box-sizing: border-box;\n}\n\n/* 低饱和柔灰蓝配色 舒适护眼 深色毛玻璃主题 */\n:root {\n    --card-bg: rgba(30, 35, 45, 0.82);\n    --card-border: rgba(100, 116, 139, 0.28);\n    --text-main: #e2e8f0;\n    --text-sub: #94a3b8;\n    --accent-blue: #93c5fd;\n    --accent-green: #86efac;\n    --accent-red: #fca5a5;\n    --line-divider: rgba(148, 163, 184, 0.15);\n    --hover-bg: rgba(148, 163, 184, 0.08);\n}\n\n/* 外层卡片 */\n.mvu-status-card {\n    border: 1px solid var(--card-border);\n    border-radius: 8px;\n    background: var(--card-bg);\n    backdrop-filter: blur(6px);\n    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);\n    margin-bottom: 8px;\n    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;\n    font-size: 12px;\n    color: var(--text-main);\n    overflow: hidden;\n}\n\n/* 内容主体 */\n.card-body {\n    padding: 10px 12px;\n    line-height: 1.45;\n}\n\n/* 分类标题 */\n.category-title {\n    font-size: 12px;\n    font-weight: 600;\n    color: var(--accent-blue);\n    margin: 10px 0 6px;\n    display: flex;\n    align-items: center;\n    gap: 4px;\n    padding-bottom: 3px;\n    border-bottom: 1px solid var(--line-divider);\n}\n.category-title:first-child {\n    margin-top: 0;\n}\n.category-title::before {\n    content: "▸";\n    font-size: 10px;\n    opacity: 0.8;\n}\n\n/* 表格式网格布局 自动适应列数 增大最小列宽 避免挤压 */\n.stat-grid {\n    display: grid;\n    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));\n    gap: 4px 16px;\n}\n\n/* 单行状态项 顶部对齐 支持换行不重叠 */\n.stat-item {\n    display: flex;\n    align-items: flex-start;\n    justify-content: space-between;\n    padding: 4px 6px;\n    border-radius: 4px;\n    transition: background 0.2s ease;\n    gap: 8px;\n}\n.stat-item:hover {\n    background: var(--hover-bg);\n}\n\n/* 层级缩进 优化缩进量 避免挤占内容空间 */\n.indent-1 { padding-left: 8px; }\n.indent-2 { padding-left: 20px; }\n.indent-3 { padding-left: 32px; }\n.indent-4 { padding-left: 44px; }\n\n/* 左侧标签 自动换行 不强制单行 */\n.stat-label {\n    color: var(--text-sub);\n    flex: 1;\n    word-break: break-word;\n    overflow-wrap: break-word;\n}\n\n/* 右侧数值 右对齐 支持换行 不会被挤压消失 */\n.stat-value {\n    font-weight: 500;\n    text-align: right;\n    flex-shrink: 0;\n    max-width: 58%;\n    word-break: break-word;\n    overflow-wrap: break-word;\n}\n.value-number {\n    color: var(--accent-blue);\n    white-space: nowrap;\n}\n.value-true {\n    color: var(--accent-green);\n    white-space: nowrap;\n}\n.value-false {\n    color: var(--accent-red);\n    white-space: nowrap;\n}\n.value-text {\n    color: var(--text-main);\n}\n\n/* 加载状态 */\n.loading-state {\n    text-align: center;\n    padding: 16px 0;\n    color: var(--text-sub);\n    animation: breathe 2s ease-in-out infinite;\n}\n@keyframes breathe {\n    0%, 100% { opacity: 0.5; }\n    50% { opacity: 0.9; }\n}\n\n/* 刷新淡入动画 */\n.flash-update {\n    animation: fadeIn 0.3s ease-out;\n}\n@keyframes fadeIn {\n    from { opacity: 0.6; }\n    to { opacity: 1; }\n}\n  </style>\n  <script type="module">\nasync function init() {\n    await waitGlobalInitialized(\'Mvu\');\n    const rootDom = document.getElementById(\'render-root\');\n\n    function refreshStatus() {\n      const allVars = getAllVariables();\n      const sourceData = _.get(allVars, "stat_data", {});\n      let htmlStr = \'\';\n\n      // 递归渲染：对象→分类标题+缩进网格，数值/布尔/文本→着色显示\n      function renderTree(obj, level) {\n        level = level || 0;\n        const indentClass = \'indent-\' + Math.min(level, 4);\n        let itemsHtml = \'\';\n\n        for (const [key, value] of Object.entries(obj)) {\n          // 过滤私有变量 _ / $ 开头\n          if (key.startsWith(\'_\') || key.startsWith(\'$\')) continue;\n\n          // 嵌套对象：生成子分类标题 递归渲染\n          if (typeof value === \'object\' && value !== null && !Array.isArray(value)) {\n            if (itemsHtml) {\n              htmlStr += \'<div class="stat-grid \' + indentClass + \'">\' + itemsHtml + \'</div>\';\n              itemsHtml = \'\';\n            }\n            if (level > 0) {\n              htmlStr += \'<div class="category-title \' + indentClass + \'">\' + key + \'</div>\';\n            }\n            renderTree(value, level + 1);\n            continue;\n          }\n\n          // 普通属性 加入当前层级网格\n          itemsHtml += \'<div class="stat-item">\';\n          itemsHtml += \'<span class="stat-label">\' + key + \'</span>\';\n          itemsHtml += \'<span class="stat-value">\';\n\n          if (typeof value === \'number\') {\n            itemsHtml += \'<span class="value-number">\' + value + \'</span>\';\n          } else if (typeof value === \'boolean\') {\n            itemsHtml += value\n              ? \'<span class="value-true">✓</span>\'\n              : \'<span class="value-false">✕</span>\';\n          } else if (Array.isArray(value)) {\n            itemsHtml += \'<span class="value-text">[\' + value.join(\', \') + \']</span>\';\n          } else {\n            itemsHtml += \'<span class="value-text">\' + String(value == null ? \'\' : value) + \'</span>\';\n          }\n\n          itemsHtml += \'</span></div>\';\n        }\n\n        if (itemsHtml) {\n          htmlStr += \'<div class="stat-grid \' + indentClass + \'">\' + itemsHtml + \'</div>\';\n        }\n      }\n\n      renderTree(sourceData, 0);\n      rootDom.innerHTML = htmlStr;\n      rootDom.classList.add(\'flash-update\');\n      setTimeout(function() { rootDom.classList.remove(\'flash-update\'); }, 300);\n    }\n\n    // 初始化 + 变量更新监听（VARIABLE_INITIALIZED首次加载 + VARIABLE_UPDATE_ENDED变更刷新）\n    refreshStatus();\n    eventOn(Mvu.events.VARIABLE_INITIALIZED, refreshStatus);\n    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, refreshStatus);\n}\n\n$(errorCatched(init));\n  <\\/script>\n</head>\n<body>\n\n<div class="mvu-status-card">\n    <div class="card-body" id="render-root">\n        <div class="loading-state">正在加载状态数据...</div>\n    </div>\n</div>\n\n</body>\n</html>';

  var ENTRY_TEMPLATES = {
    '基础公理': { constant: true, selective: false, position: 0, depth: 0, order: 250, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '核心铁则': { constant: true, selective: false, position: 0, depth: 0, order: 250, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '世界元数据': { constant: true, selective: false, position: 0, depth: 0, order: 240, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '交互软规则': { constant: true, selective: false, position: 1, depth: 0, order: 150, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '近场强约束': { constant: false, selective: true, position: 2, depth: 2, order: 180, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100, secondary_keys: [] },
    '当前局势': { constant: false, selective: true, position: 2, depth: 3, order: 170, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100, secondary_keys: [] },
    '场景机制': { constant: false, selective: true, position: 1, depth: 3, order: 140, cooldown: 3, delay: null, sticky: null, secondary_keys: [], prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '核心玩法': { constant: false, selective: true, position: 1, depth: 3, order: 130, cooldown: 3, delay: null, sticky: null, secondary_keys: [], prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '世界规则': { constant: false, selective: true, position: 1, depth: 4, order: 120, cooldown: 3, delay: null, sticky: null, secondary_keys: [], prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '实体交互': { constant: false, selective: true, position: 1, depth: 3, order: 110, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '重要角色': { constant: false, selective: true, position: 1, depth: 3, order: 105, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '势力与组织': { constant: false, selective: true, position: 1, depth: 3, order: 100, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '物品': { constant: false, selective: true, position: 1, depth: 3, order: 95, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '地点场景': { constant: false, selective: true, position: 1, depth: 3, order: 90, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '叙事背景': { constant: false, selective: true, position: 4, depth: 5, order: 80, probability: 60, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '故事发展': { constant: false, selective: true, position: 4, depth: 5, order: 75, probability: 60, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '文化与习俗': { constant: false, selective: true, position: 4, depth: 5, order: 70, probability: 60, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '历史事件': { constant: false, selective: true, position: 4, depth: 6, order: 65, probability: 50, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '动态适配': { constant: false, selective: true, position: 1, depth: 4, order: 50, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '引导机制': { constant: false, selective: true, position: 1, depth: 4, order: 45, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '互动选项': { constant: false, selective: true, position: 1, depth: 4, order: 40, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '状态栏': { constant: false, selective: true, position: 2, depth: 2, order: 35, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '统一输出格式': { constant: true, selective: false, position: 0, depth: 1, order: 85, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '角色边界': { constant: true, selective: false, position: 0, depth: 2, order: 80, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '禁止项': { constant: true, selective: false, position: 0, depth: 3, order: 70, prevent_recursion: true, exclude_recursion: true, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '自定义条目': { constant: false, selective: true, position: 1, depth: 4, order: 55, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '[InitVar]初始变量': { constant: true, selective: false, position: 4, depth: 4, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100, enabled: false },
    '变量列表': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '变量更新规则': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '变量输出格式': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '变量输出格式强调': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100, enabled: false },
    '状态变量输出': { constant: false, selective: true, position: 2, depth: 2, order: 45, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100, secondary_keys: [] }
  };

  // ===== 权重等级映射（用于权重可视化预览） =====
  // 权重从低到高：极低/低/中低/中/中高/高/极高/最高
  // 注意：核心铁则通过post_history_instructions字段实现（最高权重），不在世界书条目中
  var WEIGHT_LEVELS = {
    '基础公理': { level: '极低', color: '#6e7681', desc: 'position=0 常驻，世界元数据锚定' },
    '世界元数据': { level: '极低', color: '#6e7681', desc: 'position=0 常驻，底层背景' },
    '交互软规则': { level: '低', color: '#8b949e', desc: 'position=1 常驻，角色卡之后注入' },
    '近场强约束': { level: '极高', color: '#ff7b72', desc: 'position=2 触发，用户输入之前' },
    '当前局势': { level: '极高', color: '#ff7b72', desc: 'position=2 触发，sticky粘性' },
    '场景机制': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发' },
    '核心玩法': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发' },
    '世界规则': { level: '中高', color: '#d29922', desc: 'position=1 depth=4 触发' },
    '实体交互': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '重要角色': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '势力与组织': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '物品': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '地点场景': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '叙事背景': { level: '中', color: '#3fb950', desc: 'position=4 depth=5 概率触发' },
    '故事发展': { level: '中', color: '#3fb950', desc: 'position=4 depth=5 概率触发' },
    '文化与习俗': { level: '中', color: '#3fb950', desc: 'position=4 depth=5 概率触发' },
    '历史事件': { level: '中', color: '#3fb950', desc: 'position=4 depth=6 概率触发' },
    '动态适配': { level: '中', color: '#3fb950', desc: 'position=1 depth=4 动态系统，按需加载' },
    '引导机制': { level: '中', color: '#3fb950', desc: 'position=1 depth=4 动态系统，按需加载' },
    '互动选项': { level: '中', color: '#3fb950', desc: 'position=1 depth=4 动态系统，按需加载' },
    '状态栏': { level: '极高', color: '#ff7b72', desc: 'position=2 depth=2 sticky粘性' },
    '统一输出格式': { level: '极低', color: '#6e7681', desc: 'position=0 常驻' },
    '角色边界': { level: '极低', color: '#6e7681', desc: 'position=0 常驻' },
    '禁止项': { level: '极低', color: '#6e7681', desc: 'position=0 常驻，禁止规则' },
    '自定义条目': { level: '中', color: '#3fb950', desc: '用户自定义' },
    '[InitVar]初始变量': { level: '极低', color: '#6e7681', desc: 'position=4(at_depth d=4) 常驻(enabled=false)，MVU变量初始化YAML' },
    '变量列表': { level: '极低', color: '#6e7681', desc: 'position=4(at_depth d=0) 常驻，注入当前变量值给LLM' },
    '变量更新规则': { level: '低', color: '#8b949e', desc: 'position=4(at_depth d=0) 常驻，MVU变量更新分析规则' },
    '变量输出格式': { level: '低', color: '#8b949e', desc: 'position=4(at_depth d=0) 常驻，定义<UpdateVariable>输出格式' },
    '变量输出格式强调': { level: '低', color: '#8b949e', desc: 'position=4(at_depth d=0) 默认关闭，AI不输出<UpdateVariable>时启用' },
    '状态变量输出': { level: '中', color: '#3fb950', desc: 'position=2 触发，输出当前变量状态给LLM' }
  };


  function getEntryTemplate(comment) {
    if (!comment) return null;
    // 1. 支持 [InitVar]xxx 前缀格式（MVU变量系统，兼容大小写）
    var commentLower = comment.toLowerCase();
    if (commentLower.indexOf('[initvar]') === 0) {
      return ENTRY_TEMPLATES['[InitVar]初始变量'];
    }
    // 2. 支持 <xxx> 前缀格式（标准条目）
    var m = comment.match(/^<([^>]+)>/);
    if (m) {
      var key = m[1];
      if (ENTRY_TEMPLATES[key]) return ENTRY_TEMPLATES[key];
      var fuzzyMatch = Object.keys(ENTRY_TEMPLATES).find(function(k) { return key.indexOf(k) >= 0 || k.indexOf(key) >= 0; });
      if (fuzzyMatch) return ENTRY_TEMPLATES[fuzzyMatch];
    }
    // 3. 支持 MVU 变量系统条目（无需前缀，直接匹配关键字）
    if (commentLower.indexOf('[mvu_update]') >= 0) {
      if (comment.indexOf('变量更新规则') >= 0) return ENTRY_TEMPLATES['变量更新规则'];
      if (comment.indexOf('变量输出格式强调') >= 0) return ENTRY_TEMPLATES['变量输出格式强调'];
      if (comment.indexOf('变量输出格式') >= 0) return ENTRY_TEMPLATES['变量输出格式'];
    }
    if (comment.indexOf('变量列表') >= 0) return ENTRY_TEMPLATES['变量列表'];
    if (comment.indexOf('状态变量输出') >= 0) return ENTRY_TEMPLATES['状态变量输出'];
    if (comment.indexOf('变量分段') >= 0 || comment.indexOf('分段提示') >= 0) return ENTRY_TEMPLATES['变量更新规则'];
    // 4. 通用匹配：遍历模板键找最长匹配
    var keys = Object.keys(ENTRY_TEMPLATES);
    var bestKey = null;
    var bestLen = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (comment.indexOf(k) >= 0 && k.length > bestLen) {
        bestKey = k;
        bestLen = k.length;
      }
    }
    if (bestKey) return ENTRY_TEMPLATES[bestKey];
    return null;
  }

  // 判断条目是否属于MVU变量系统
  // 兼容大小写前缀：[InitVar]/[initvar]、[mvu_update] 等
  function isMVUEntry(comment) {
    var c = (comment || '').toLowerCase();
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
           c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
           c.indexOf('状态变量输出') >= 0 || c.indexOf('updatevariable') >= 0 ||
           c.indexOf('变量分段') >= 0 || c.indexOf('分段提示') >= 0 ||
           c.indexOf('ejs') >= 0;
  }

  // 判断是否为MVU核心条目（五大核心：[initvar]/变量列表/变量更新规则/变量输出格式/变量输出格式强调）
  function isMVUCoreEntry(comment) {
    var c = (comment || '').toLowerCase();
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
           c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0;
  }

  // ST规范：转换 regex_scripts 格式（导入/导出共用）
  function normalizeRegexScripts(rxScripts) {
    if (!rxScripts || !Array.isArray(rxScripts)) return [];
    return rxScripts.map(function(script, idx) {
      var findRegex = script.findRegex || script.find_regex || script.find || '';
      var replaceString = script.replaceString || script.replace_string || script.replace || '';
      var rawPlacement = script.placement !== undefined ? script.placement :
                         (script.source ? (function(s) {
                           var arr = [];
                           if (s.user_input) arr.push(1);
                           if (s.ai_output) arr.push(2);
                           if (s.slash_command) arr.push(3);
                           if (s.world_info) arr.push(4);
                           return arr.length ? arr : [2];
                         })(script.source) : 2);
      var placement = Array.isArray(rawPlacement) ? rawPlacement : [rawPlacement];
      // 兼容 destination 字段（部分实现用 destination.display/prompt 而非 markdownOnly/promptOnly）
      var dest = script.destination || {};
      var markdownOnly = script.markdownOnly !== undefined ? script.markdownOnly :
                         (script.markdown_only !== undefined ? script.markdown_only :
                         (dest.display !== undefined ? !!dest.display : false));
      var promptOnly = script.promptOnly !== undefined ? script.promptOnly :
                       (script.prompt_only !== undefined ? script.prompt_only :
                       (dest.prompt !== undefined ? !!dest.prompt : false));
      return {
        id: script.id || ('regex_script_' + Date.now() + '_' + idx),
        scriptName: script.scriptName || script.script_name || script.name || '正则脚本',
        findRegex: findRegex,
        replaceString: replaceString,
        trimStrings: script.trimStrings || script.trim_strings || [],
        placement: placement,
        disabled: script.disabled !== undefined ? script.disabled : (script.enabled !== undefined ? !script.enabled : false),
        markdownOnly: markdownOnly,
        promptOnly: promptOnly,
        runOnEdit: script.runOnEdit !== undefined ? script.runOnEdit : (script.run_on_edit !== undefined ? script.run_on_edit : true),
        substituteRegex: script.substituteRegex !== undefined ? script.substituteRegex : (script.substitute_regex !== undefined ? script.substitute_regex : 0),
        minDepth: script.minDepth !== undefined ? script.minDepth : (script.min_depth !== undefined ? script.min_depth : null),
        maxDepth: script.maxDepth !== undefined ? script.maxDepth : (script.max_depth !== undefined ? script.max_depth : null)
      };
    });
  }

  // UI显示分组（基于条目类型，非ST group字段）
  function getDisplayGroup(e) {
    var comment = e.comment || '';
    // 变量系统优先判断（避免被 constant=true 的常驻体系拦截）
    if (isMVUEntry(comment)) return '变量系统';
    // 常驻体系判断
    var tmpl = getEntryTemplate(comment);
    var isConst = e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false);
    if (isConst) return '常驻体系';
    var m = comment.match(/^<([^>]+)>/);
    var prefixKey = m ? m[1] : '';
    if (['动态适配', '引导机制', '互动选项', '状态栏'].indexOf(prefixKey) >= 0) return '动态系统';
    if (['叙事背景', '故事发展', '文化与习俗', '历史事件'].indexOf(prefixKey) >= 0) return '叙事';
    return '触发体系';
  }

  var MODULE_SYSTEM = {
    permanent: [
      { key: 'axiom', name: '基础公理', icon: '🏛️', weight: 35, position: 0, order: 250 },
      { key: 'soft_rules', name: '交互软规则', icon: '🤝', weight: 30, position: 1, order: 150 },
      { key: 'core_rules', name: '核心铁则', icon: '🔐', weight: 35, order: 100 },
    ],
    trigger: [
      { key: 'near_constraint', name: '近场强约束', icon: '🎯', weight: 25, position: 2, depth: 2 },
      { key: 'scene_mechanics', name: '场景机制', icon: '⚔️', weight: 25, position: 1, depth: 3 },
      { key: 'entity_interact', name: '实体交互', icon: '👥', weight: 25, position: 1, depth: 3 },
      { key: 'narrative_bg', name: '叙事背景', icon: '📖', weight: 25, position: 4, depth: 5 }
    ],
    dynamic: [
      { key: 'dynamic_adapt', name: '动态适配', icon: '🔄', weight: 100, position: 1, depth: 4 }
    ],
    variable: [
      { key: 'init_var', name: '初始变量', icon: '📊', weight: 100, position: 0, order: 245 },
      { key: 'var_update_rule', name: '变量更新规则', icon: '📝', weight: 100, position: 1, order: 145 }
    ]
  };

  // ===== 系统提示词（ST权重分层8体系 + MVU变量系统） =====
  // ===== 预设提示词读取与开关控制（参考秋青子伪IDE的index.js实现）=====
  // 区段标记（与预设JSON中的name字段对齐）—— 注意：区段外无标记的 prompt 归为 "aux" 辅助分组
  var SECTION_MARKERS = {
    '【一般条目】': 'general',
    '【MVU条目】': 'mvu',
    '【worldinfo】': 'worldinfo'
  };
  var SECTION_END_MARKERS = new Set(['【/一般条目】', '【/MVU条目】', '【/worldinfo】']);
  var SECTION_LABELS = {
    aux: '🛠️ 辅助项',
    worldinfo: '📚 worldinfo',
    general: '📘 一般条目',
    mvu: '📊 MVU条目'
  };

  // 缓存当前预设提示词列表（含区段信息）
  var _presetCache = { prompts: [], ts: 0 };

  function isPresetNormalPrompt(p) {
    return p && !p.marker && p.system_prompt !== true;
  }
  function isPresetSystemPrompt(p) {
    return p && p.system_prompt === true && !p.marker;
  }

  // 类似Wr函数：遍历prompts，按区段标记分组；区段外的 prompt 归为 'aux' 辅助分组
  function classifyPromptsBySection(prompts) {
    var result = [];
    var currentSection = 'aux';  // 默认为 aux (区段外辅助项)
    for (var i = 0; i < prompts.length; i++) {
      var p = prompts[i];
      if (!isPresetNormalPrompt(p) && !isPresetSystemPrompt(p)) continue;
      var name = p.name || '';
      if (SECTION_MARKERS[name]) {
        currentSection = SECTION_MARKERS[name];
      } else if (SECTION_END_MARKERS.has(name)) {
        currentSection = 'aux';   // 退出区段后，区段外 prompt 归入 "aux"
      } else {
        // 区段标记本身也要入列表（虽然hasContent多半是假，但enabled开关要展示）
        result.push({
          identifier: p.identifier,
          name: name,
          displayName: name.replace(/^[^\p{L}\p{N}]+/u, '').trim() || name,
          enabled: !!p.enabled,
          role: p.role || 'system',
          hasContent: ('content' in p) && !!((p.content || '').toString().trim()),
          section: currentSection
        });
      }
    }
    return result;
  }

  // 从酒馆读取当前预设的prompts
  function getPresetPrompts(force) {
    var now = Date.now();
    if (!force && _presetCache.prompts.length > 0 && now - _presetCache.ts < 3000) {
      return _presetCache.prompts;
    }
    try {
      var preset = null;
      if (typeof getPreset === 'function') {
        preset = getPreset('in_use');
      } else if (window.parent && typeof window.parent.getPreset === 'function') {
        preset = window.parent.getPreset('in_use');
      }
      if (!preset || !preset.prompts) {
        _presetCache = { prompts: [], ts: now };
        return [];
      }
      _presetCache = { prompts: classifyPromptsBySection(preset.prompts), ts: now };
      return _presetCache.prompts;
    } catch(e) {
      console.warn('[时之写卡器] getPresetPrompts failed:', e);
      return [];
    }
  }

  // 读取指定name的prompt内容
  function getPresetPromptContent(name) {
    try {
      var preset = null;
      if (typeof getPreset === 'function') {
        preset = getPreset('in_use');
      } else if (window.parent && typeof window.parent.getPreset === 'function') {
        preset = window.parent.getPreset('in_use');
      }
      if (!preset || !preset.prompts) return '';
      for (var i = 0; i < preset.prompts.length; i++) {
        var p = preset.prompts[i];
        if ((isPresetNormalPrompt(p) || isPresetSystemPrompt(p)) && p.name === name) {
          return p.content || '';
        }
      }
    } catch(e) {}
    return '';
  }

  // 构建系统提示词：拼接所有enabled的prompts内容
  function buildSysPromptFromPreset() {
    var prompts = getPresetPrompts(true);
    if (prompts.length === 0) {
      // 回退：预设未加载时使用最小提示词
      return '你是一位专业的世界模式角色卡创作大师，基于SillyTavern原生机制和ST权重分层8体系（+MVU变量系统可选），通过自然对话引导用户创建完整的世界模式角色卡。\n\n⚠️ 注意：未检测到预设提示词，请在SillyTavern中加载 Card_making_preset.json 预设，并确保预设被设置为"in_use"。';
    }
    var parts = [];
    var included = 0;
    for (var i = 0; i < prompts.length; i++) {
      var p = prompts[i];
      if (!p.enabled || !p.hasContent) continue;
      var content = getPresetPromptContent(p.name);
      if (content && content.trim()) {
        parts.push(content);
        included++;
      }
    }
    if (included === 0) {
      return '你是一位专业的世界模式角色卡创作大师。⚠️ 所有预设提示词均被禁用，请在「⚙️ 提示词开关」中启用至少一个提示词。';
    }
    return parts.join('\n\n');
  }

  // 切换指定name的prompt enabled状态
  async function togglePresetPrompt(name) {
    try {
      var updateFn = null;
      if (typeof updatePresetWith === 'function') {
        updateFn = updatePresetWith;
      } else if (window.parent && typeof window.parent.updatePresetWith === 'function') {
        updateFn = window.parent.updatePresetWith;
      }
      if (!updateFn) {
        showToast('当前环境不支持预设切换（updatePresetWith 不可用）', 'error');
        return false;
      }
      await updateFn('in_use', function(preset) {
        for (var i = 0; i < preset.prompts.length; i++) {
          var p = preset.prompts[i];
          if ((isPresetNormalPrompt(p) || isPresetSystemPrompt(p)) && p.name === name) {
            p.enabled = !p.enabled;
            break;
          }
        }
        return preset;
      });
      _presetCache.ts = 0;
      return true;
    } catch(e) {
      console.error('[时之写卡器] togglePresetPrompt failed:', e);
      showToast('切换失败: ' + e.message, 'error');
      return false;
    }
  }

  // 切换整个区段（general/mvu）的所有标记和条目
  async function togglePresetSection(section, enabled) {
    try {
      var updateFn = null;
      if (typeof updatePresetWith === 'function') {
        updateFn = updatePresetWith;
      } else if (window.parent && typeof window.parent.updatePresetWith === 'function') {
        updateFn = window.parent.updatePresetWith;
      }
      if (!updateFn) {
        showToast('当前环境不支持预设切换', 'error');
        return false;
      }
      // 区段标记映射：name 前缀
      var SECTION_MARKER_MAP = {
        general:   {start: '【一般条目】',   end: '【/一般条目】'},
        mvu:       {start: '【MVU条目】',    end: '【/MVU条目】'},
        worldinfo: {start: '【worldinfo】',  end: '【/worldinfo】'}
      };

      await updateFn('in_use', function(preset) {
        if (section === 'aux') {
          // aux 区段外辅助项：识别在任何区段标记之外的 prompt
          var inAnySection = false;
          for (var i = 0; i < preset.prompts.length; i++) {
            var p = preset.prompts[i];
            var nm = p.name || '';
            var isStart = nm === '【一般条目】' || nm === '【MVU条目】' || nm === '【worldinfo】';
            var isEnd   = nm === '【/一般条目】' || nm === '【/MVU条目】' || nm === '【/worldinfo】';
            if (isStart) inAnySection = true;
            else if (isEnd) inAnySection = false;
            else if (!inAnySection && (isPresetNormalPrompt(p) || isPresetSystemPrompt(p))) {
              p.enabled = enabled;
            }
          }
        } else {
          var markers = SECTION_MARKER_MAP[section] || null;
          if (!markers) return preset;
          var inSection = false;
          for (var j = 0; j < preset.prompts.length; j++) {
            var pp = preset.prompts[j];
            var nmm = pp.name || '';
            if (nmm === markers.start) {
              inSection = true;
              pp.enabled = enabled;
            } else if (nmm === markers.end) {
              inSection = false;
              pp.enabled = enabled;
            } else if (inSection && (isPresetNormalPrompt(pp) || isPresetSystemPrompt(pp))) {
              pp.enabled = enabled;
            }
          }
        }
        return preset;
      });
      _presetCache.ts = 0;
      return true;
    } catch(e) {
      console.error('[时之写卡器] togglePresetSection failed:', e);
      showToast('切换失败: ' + e.message, 'error');
      return false;
    }
  }


  // ===== 提取条目的规范前缀（用于智能匹配） =====
  function extractEntryPrefix(comment) {
    if (!comment) return '';
    var m = String(comment).match(/^<([^>]+)>/);
    if (m) return m[1];
    var m2 = String(comment).match(/^\[([^\]]+)\]/);
    if (m2) return '[' + m2[1] + ']';
    return '';
  }

  // ===== 智能查找匹配条目：精确匹配 -> 同类型单条匹配 -> 内容相似度匹配 =====
  function findMatchingEntry(newEntry, existingArr) {
    if (!newEntry || !existingArr || !existingArr.length) return -1;
    var neComment = newEntry.comment || '';
    var neContent = (newEntry.content || '').trim();
    var nePrefix = extractEntryPrefix(neComment);

    // 第1优先级：精确 comment 匹配（最可靠）
    var exactIdx = existingArr.findIndex(function(e) { return (e.comment || '') === neComment; });
    if (exactIdx >= 0) return { index: exactIdx, mode: 'exact' };

    // 第2优先级：同规范前缀下只有1条现有条目（AI改了comment后缀但前缀一致，如<基础公理>世界→<基础公理>力量体系）
    if (nePrefix) {
      var samePrefixEntries = existingArr.map(function(e, i) {
        return { i: i, p: extractEntryPrefix(e.comment), c: (e.content || '').trim() };
      }).filter(function(x) { return x.p === nePrefix; });
      if (samePrefixEntries.length === 1) {
        return { index: samePrefixEntries[0].i, mode: 'prefix-single' };
      }
      // 第3优先级：同前缀下内容相似度最高（Jaccard字符集重合度>0.4）
      if (samePrefixEntries.length > 1 && neContent.length > 20) {
        var neCharSet = {};
        for (var ci = 0; ci < neContent.length; ci++) neCharSet[neContent[ci]] = true;
        var best = null;
        samePrefixEntries.forEach(function(x) {
          var inter = 0, uni = 0;
          var exSet = {};
          for (var cj = 0; cj < x.c.length; cj++) exSet[x.c[cj]] = true;
          for (var k in neCharSet) { if (neCharSet.hasOwnProperty(k)) { if (exSet[k]) inter++; uni++; } }
          for (var k2 in exSet) { if (exSet.hasOwnProperty(k2) && !neCharSet[k2]) uni++; }
          var sim = uni > 0 ? inter / uni : 0;
          if (sim > 0.35 && (!best || sim > best.sim)) best = { i: x.i, sim: sim };
        });
        if (best) return { index: best.i, mode: 'prefix-similarity' };
      }
    }
    return { index: -1, mode: 'none' };
  }

  // ===== 增量合并（修复版：智能匹配 + 变更记录 + 删改可追溯） =====
  function mergePartial(partial, cd, options) {
    if (!partial || typeof partial !== 'object') return false;
    options = options || {};
    var modified = false;
    var changeLog = { added: 0, updated: 0, deleted: 0, fieldUpdates: 0 };

    if (partial.character && !partial.spec) {
      var ch = partial.character;
      delete partial.character;
      for (var k in ch) { if (ch.hasOwnProperty(k)) partial[k] = ch[k]; }
    }

    // ---- 支持多种删除语法 ----
    var deletePaths = [];
    if (partial.deleted_entries && Array.isArray(partial.deleted_entries)) {
      partial.deleted_entries.forEach(function(c) { deletePaths.push('character_book.entries.' + c); });
      delete partial.deleted_entries;
    }
    // 兼容 AI 可能写的其他字段名
    ['_delete', 'delete', 'deletes', 'remove', 'removes'].forEach(function(dk) {
      if (partial[dk] && Array.isArray(partial[dk])) {
        deletePaths = deletePaths.concat(partial[dk]);
        delete partial[dk];
      }
    });
    // 兼容 entries 内单条的 { ..., "_action":"delete" } 语法（AI最容易写成这样）
    var inlineEntryDeletes = [];
    var scanInlineDeletes = function(arr) {
      if (!arr || !Array.isArray(arr)) return;
      for (var di = arr.length - 1; di >= 0; di--) {
        if (arr[di] && (arr[di]._action === 'delete' || arr[di]._action === 'remove' || arr[di].delete === true)) {
          if (arr[di].comment) inlineEntryDeletes.push(arr[di].comment);
          arr.splice(di, 1);
        }
      }
    };
    scanInlineDeletes(partial.entries);
    if (partial.character_book && partial.character_book.entries) scanInlineDeletes(partial.character_book.entries);
    inlineEntryDeletes.forEach(function(ic) { deletePaths.push('character_book.entries.' + ic); });

    // ---- 执行删除 ----
    if (deletePaths.length > 0) {
      var entryPrefix = 'character_book.entries.';
      var fieldDeletes = [];
      // 收集所有数字索引，稍后降序处理避免位移
      var numericIndices = [];
      deletePaths.forEach(function(path) {
        if (String(path).indexOf(entryPrefix) === 0) {
          var entryKey = String(path).slice(entryPrefix.length);
          if (cd.character_book && cd.character_book.entries) {
            var beforeLen = cd.character_book.entries.length;
            var idx = parseInt(entryKey);
            if (!isNaN(idx) && String(idx) === entryKey && idx >= 0 && idx < beforeLen) {
              // 数字索引：先收集，稍后统一降序删除避免位移
              numericIndices.push(idx);
            } else {
              // 安全删除策略：精确匹配优先，模糊匹配仅作兜底且有严格保护
              var exactMatches = [];
              var fuzzyMatches = [];
              cd.character_book.entries.forEach(function(e, i) {
                var ec = e.comment || '';
                if (ec === entryKey) {
                  exactMatches.push(i);
                } else if (entryKey.length >= 6 && ec.length >= 6) {
                  // 模糊匹配：仅「现有comment包含entryKey」单向匹配，不再反向匹配
                  // 且要求关键词≥6字（避免"基础设定"这种4字短词误删多条）
                  if (ec.indexOf(entryKey) >= 0) fuzzyMatches.push(i);
                }
              });
              var toDelete = [];
              if (exactMatches.length > 0) {
                // 精确匹配命中→只删精确匹配的，不动模糊匹配（防止误删同名前缀的其他条目）
                toDelete = exactMatches;
              } else if (fuzzyMatches.length === 1) {
                // 没有精确匹配，模糊匹配恰好1条→安全删除
                toDelete = fuzzyMatches;
              } else if (fuzzyMatches.length > 1) {
                // 模糊匹配多条→不删！防止多删。记录警告
                console.warn('[mergePartial] 删除关键词"' + entryKey + '"模糊匹配到' + fuzzyMatches.length + '条条目，为防止误删已跳过。请使用精确comment。');
              }
              // 没有精确也没有模糊→静默不删（可能comment拼写错误）
              if (toDelete.length > 0) {
                // 降序删除避免索引位移
                toDelete.sort(function(a, b) { return b - a; });
                for (var di = 0; di < toDelete.length; di++) {
                  cd.character_book.entries.splice(toDelete[di], 1);
                }
                modified = true;
                changeLog.deleted += toDelete.length;
              }
            }
          }
        } else {
          // 裸字符串（无 character_book.entries. 前缀）
          // 安全处理：如果看起来像条目名（不含.且非已知顶层字段），尝试作为comment匹配
          var rawPath = String(path);
          var knownTopFields = ['name','description','first_mes','system_prompt','personality','scenario','creator_notes','mes_example','post_history_instructions','tags','alternate_greetings'];
          if (rawPath.indexOf('.') < 0 && knownTopFields.indexOf(rawPath) < 0 && cd.character_book && cd.character_book.entries) {
            // 当作条目comment处理
            var foundIdx = -1;
            for (var fi = 0; fi < cd.character_book.entries.length; fi++) {
              if ((cd.character_book.entries[fi].comment || '') === rawPath) { foundIdx = fi; break; }
            }
            if (foundIdx >= 0) {
              cd.character_book.entries.splice(foundIdx, 1);
              modified = true; changeLog.deleted++;
            }
          } else {
            fieldDeletes.push(path);
          }
        }
      });
      // 数字索引降序删除
      if (numericIndices.length > 0) {
        numericIndices.sort(function(a, b) { return b - a; });
        // 去重
        var uniqueIdx = [];
        numericIndices.forEach(function(n) { if (uniqueIdx.indexOf(n) < 0) uniqueIdx.push(n); });
        uniqueIdx.forEach(function(idx) {
          if (idx < cd.character_book.entries.length) {
            cd.character_book.entries.splice(idx, 1);
            modified = true; changeLog.deleted++;
          }
        });
      }
      fieldDeletes.forEach(function(p) {
        var parts = String(p).split('.');
        var node = cd;
        for (var i = 0; i < parts.length - 1; i++) {
          if (!node || typeof node !== 'object' || !(parts[i] in node)) { node = null; break; }
          node = node[parts[i]];
        }
        if (node && typeof node === 'object' && parts[parts.length - 1] in node) {
          delete node[parts[parts.length - 1]];
          modified = true; changeLog.deleted++;
        }
      });
    }
    delete partial._nochange;

    // 世界书名称字段已移除
    if (partial.character_book) {
      delete partial.character_book.name;
      if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
    }

    // ---- 处理 entries（修复：智能匹配+content过短时也允许更新非content字段） ----
    var processEntriesFn = function(newEntries) {
      if (!newEntries || !Array.isArray(newEntries)) return;
      cd.character_book = cd.character_book || { entries: [] };
      var existing = cd.character_book.entries || [];
      newEntries.forEach(function(ne) {
        if (!ne || typeof ne !== 'object') return;
        var hasComment = !!(ne.comment && String(ne.comment).trim());
        var hasMeaningfulContent = !!(ne.content && String(ne.content).trim().length >= 20);
        // 至少要有 comment，或（有 content 且 >20字）—— 两者全无才跳过
        if (!hasComment && !hasMeaningfulContent) return;

        var tmpl = getEntryTemplate(ne.comment || '');
        ne.enabled = (tmpl && tmpl.enabled !== undefined) ? tmpl.enabled : true;
        if (String(ne.comment || '').indexOf('变量列表') >= 0 && typeof ne.content === 'string') {
          ne.content = normalizeVarListContent(ne.content);
        }
        if (tmpl) {
          if (ne.selective === undefined) ne.selective = tmpl.selective;
          if (ne.constant === undefined) ne.constant = tmpl.constant;
          if (ne.insertion_order === undefined) ne.insertion_order = tmpl.order;
          if (ne.use_regex === undefined) ne.use_regex = tmpl.use_regex;
          if (ne.secondary_keys === undefined) ne.secondary_keys = tmpl.secondary_keys || [];
          if (!ne.extensions) ne.extensions = {};
          var ext = ne.extensions;
          if (ext.position === undefined) ext.position = tmpl.position;
          if (ext.depth === undefined) ext.depth = tmpl.depth;
          if (ext.role === undefined) ext.role = 0;
          if (ext.probability === undefined) ext.probability = tmpl.probability;
          if (ext.selectiveLogic === undefined) ext.selectiveLogic = tmpl.selectiveLogic;
          if (ext.prevent_recursion === undefined) ext.prevent_recursion = tmpl.prevent_recursion;
          if (ext.exclude_recursion === undefined) ext.exclude_recursion = tmpl.exclude_recursion;
          if (ext.delay_until_recursion === undefined) ext.delay_until_recursion = tmpl.delay_until_recursion;
          if (ext.sticky === undefined) ext.sticky = tmpl.sticky || 0;
          if (ext.cooldown === undefined) ext.cooldown = tmpl.cooldown;
          if (ext.delay === undefined) ext.delay = tmpl.delay;
          if (ext.match_whole_words === undefined) ext.match_whole_words = tmpl.match_whole_words;
          if (ext.scan_depth === undefined) ext.scan_depth = tmpl.scan_depth;
          if (ext.group === undefined) ext.group = tmpl.group;
          if (ext.group_weight === undefined) ext.group_weight = tmpl.group_weight;
          if (ext.useProbability === undefined) ext.useProbability = tmpl.useProbability;
        } else {
          if (ne.selective === undefined) ne.selective = true;
          if (ne.constant === undefined) ne.constant = false;
          if (!ne.extensions) ne.extensions = { position: 4, depth: 4, role: 0, probability: 100, selectiveLogic: 0, prevent_recursion: false, sticky: 0, cooldown: 0, delay: 0, group: '', group_weight: 100, useProbability: true };
        }
        if (!ne.keys) ne.keys = [];
        if (!ne.secondary_keys) ne.secondary_keys = [];

        var match = findMatchingEntry(ne, existing);
        if (match.index >= 0) {
          // 更新：深合并content优先（如果新content有内容就覆盖，没内容保留旧content）
          var oldEntry = existing[match.index];
          if (ne.content === undefined || String(ne.content).trim().length === 0) {
            // 新条目没提供content，保留旧的
            var tmpContent = oldEntry.content;
            existing[match.index] = Object.assign({}, oldEntry, ne);
            existing[match.index].content = tmpContent;
          } else {
            existing[match.index] = Object.assign({}, oldEntry, ne);
          }
          modified = true; changeLog.updated++;
        } else {
          existing.push(ne);
          modified = true; changeLog.added++;
        }
      });
      cd.character_book.entries = existing;
    };

    // 顶层 entries 优先处理
    if (partial.entries && Array.isArray(partial.entries)) {
      processEntriesFn(partial.entries);
      delete partial.entries;
    }
    // character_book.entries 后处理（避免与顶层重复：如果顶层已处理，此处跳过）
    if (partial.character_book && partial.character_book.entries && Array.isArray(partial.character_book.entries)) {
      processEntriesFn(partial.character_book.entries);
      // 不删除整个 character_book，只删除 entries 字段，避免其他信息丢失
      delete partial.character_book.entries;
      if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
    }
    var fields = ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','tags','creator','character_version','alternate_greetings','group_only_greetings'];
    fields.forEach(function(f) {
      if (partial[f] !== undefined) {
        var val = partial[f];
        var oldVal = cd[f];
        if (f === 'first_mes' || f === 'description') {
          // 放宽占位符过滤：只有同时满足「文本非常短(<80字)」+「整段内容几乎全是占位词」时才跳过
          if (typeof val === 'string') {
            var vTrim = val.trim();
            if (vTrim.length < 80) {
              var hasPlaceholder = /正文已在上方|见上方|参见上文|见上文|已在上方|请见上文/.test(vTrim);
              var isOnlyPlaceholder = vTrim.length < 30 && hasPlaceholder;
              if (isOnlyPlaceholder) return;
            }
          }
          // 极短内容且仅含"输出"提示词时跳过（长度<30字+含「已输出/上文输出/见上文输出」）
          if (typeof val === 'string' && val.trim().length < 30 && /(已输出|上文输出|见上文.*输出)/.test(val)) {
            return;
          }
        }
        if (JSON.stringify(oldVal) !== JSON.stringify(val)) {
          cd[f] = val;
          modified = true; changeLog.fieldUpdates++;
        }
      }
    });

    if (partial.depth_prompt !== undefined) {
      cd.extensions = cd.extensions || {};
      cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
      cd.depth_prompt = cd.depth_prompt || { prompt: '', depth: 0, role: 'system' };
      var dp = partial.depth_prompt;
      var dpModified = false;
      if (typeof dp === 'string') {
        if (dp.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp) {
          cd.extensions.depth_prompt.prompt = dp;
          cd.depth_prompt.prompt = dp;
          dpModified = true;
        }
      } else if (dp && typeof dp === 'object') {
        if (dp.prompt !== undefined && typeof dp.prompt === 'string') {
          // 放宽：允许空字符串（显式清空），只有 undefined 才跳过
          if (cd.extensions.depth_prompt.prompt !== dp.prompt) {
            cd.extensions.depth_prompt.prompt = dp.prompt;
            cd.depth_prompt.prompt = dp.prompt;
            dpModified = true;
          }
        }
        if (dp.depth !== undefined && typeof dp.depth === 'number' && dp.depth >= 0 && cd.extensions.depth_prompt.depth !== dp.depth) {
          cd.extensions.depth_prompt.depth = dp.depth;
          cd.depth_prompt.depth = dp.depth;
          dpModified = true;
        }
        if (dp.role !== undefined && ['system', 'user', 'assistant', 0, 1, 2].indexOf(dp.role) >= 0 && cd.extensions.depth_prompt.role !== dp.role) {
          cd.extensions.depth_prompt.role = dp.role;
          cd.depth_prompt.role = dp.role;
          dpModified = true;
        }
      }
      if (dpModified) { modified = true; changeLog.fieldUpdates++; }
      delete partial.depth_prompt;
    }

    // ---- 智能合并 regex_scripts：支持增量更新、按名替换、_action:delete ----
    var mergeRegexScripts = function(newRxList) {
      if (!Array.isArray(newRxList)) return;
      cd.extensions = cd.extensions || {};
      var existingRx = cd.extensions.regex_scripts || [];
      var beforeSnapshot = JSON.stringify(existingRx);
      newRxList.forEach(function(s) {
        if (!s || typeof s !== 'object') return;
        // 删除：_action:delete 或 delete:true
        if (s._action === 'delete' || s._action === 'remove' || s.delete === true) {
          var beforeLen = existingRx.length;
          existingRx = existingRx.filter(function(es) {
            if (s.id && es.id === s.id) return false;
            if (s.scriptName && es.scriptName === s.scriptName) return false;
            if (s.name && !es.scriptName && es.name === s.name) return false;
            // 关键词匹配删除
            if (s.findRegex && es.findRegex === s.findRegex) return false;
            return true;
          });
          if (existingRx.length !== beforeLen) { changeLog.deleted += (beforeLen - existingRx.length); }
          return;
        }
        if (!s.findRegex || !String(s.findRegex).trim()) return;
        if (s.replaceString === undefined) return;
        // 更新/新增：按 id 或 scriptName/name 或 findRegex 匹配
        var idx = existingRx.findIndex(function(es) {
          if (s.id && es.id === s.id) return true;
          if (s.scriptName && es.scriptName === s.scriptName) return true;
          if (s.name && !es.scriptName && es.name === s.name) return true;
          if (s.findRegex && es.findRegex === s.findRegex) return true;
          return false;
        });
        if (idx >= 0) {
          existingRx[idx] = Object.assign({}, existingRx[idx], s);
          delete existingRx[idx]._action;
          changeLog.updated++;
        } else {
          existingRx.push(s);
          changeLog.added++;
        }
      });
      cd.extensions.regex_scripts = existingRx;
      if (JSON.stringify(existingRx) !== beforeSnapshot) modified = true;
    };

    if (partial.regex_scripts !== undefined) {
      mergeRegexScripts(partial.regex_scripts);
      delete partial.regex_scripts;
    }

    // 名称变化时自动更新世界书名称
    if (partial.name && cd.character_book) {
      // 参考文件中 character_book 不包含 name 字段，此处无需更新
    }

    if (partial.extensions) {
      cd.extensions = cd.extensions || {};
      var extProcessedKeys = {}; // 防止与顶层重复处理
      for (var ek in partial.extensions) {
        if (partial.extensions.hasOwnProperty(ek)) {
          if (ek === 'depth_prompt') {
            // 顶层已处理过 depth_prompt（delete partial.depth_prompt 已执行），这里仅当 partial.extensions 有独立配置时处理
            cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
            var dp2 = partial.extensions.depth_prompt;
            var beforeDp = JSON.stringify(cd.extensions.depth_prompt);
            if (typeof dp2 === 'string') {
              if (dp2.trim().length > 0) cd.extensions.depth_prompt.prompt = dp2;
            } else if (dp2 && typeof dp2 === 'object') {
              if (dp2.prompt !== undefined) cd.extensions.depth_prompt.prompt = dp2.prompt;
              if (dp2.depth !== undefined && typeof dp2.depth === 'number' && dp2.depth >= 0) cd.extensions.depth_prompt.depth = dp2.depth;
              if (dp2.role !== undefined) cd.extensions.depth_prompt.role = dp2.role;
            }
            if (JSON.stringify(cd.extensions.depth_prompt) !== beforeDp) { modified = true; changeLog.fieldUpdates++; }
          } else if (ek === 'regex_scripts') {
            // 顶层已处理，此处仅当顶层未处理（没有顶层 regex_scripts 字段）时处理
            if (partial['regex_scripts'] === undefined) mergeRegexScripts(partial.extensions.regex_scripts);
          } else if (ek === 'tavern_helper') {
            // 修复版：支持脚本删除 / 按 id/name 替换，不再只追加
            if (partial.extensions[ek] && typeof partial.extensions[ek] === 'object') {
              cd.extensions = cd.extensions || {};
              if (!cd.extensions[ek]) cd.extensions[ek] = { scripts: [], variables: {} };
              var thBefore = JSON.stringify(cd.extensions[ek]);
              // === scripts：支持替换/删除/追加 ===
              var thScripts = cd.extensions[ek].scripts || [];
              var newTHScripts = partial.extensions[ek].scripts || [];
              // 如果 AI 明确输出 _action:reset 或 scripts 显式置空数组，允许清空（用于「重写 tavern_helper」场景）
              var resetScripts = partial.extensions[ek]._action === 'reset' || partial.extensions[ek].reset_scripts === true;
              if (resetScripts) { thScripts = []; }
              newTHScripts.forEach(function(ns) {
                if (!ns || typeof ns !== 'object') return;
                if (ns._action === 'delete' || ns._action === 'remove' || ns.delete === true) {
                  thScripts = thScripts.filter(function(es) {
                    if (ns.id && es.id === ns.id) return false;
                    if (ns.name && es.name === ns.name) return false;
                    return true;
                  });
                  return;
                }
                var existsIdx = thScripts.findIndex(function(es) {
                  return (ns.id && es.id === ns.id) || (ns.name && es.name === ns.name);
                });
                if (existsIdx >= 0) {
                  thScripts[existsIdx] = Object.assign({}, thScripts[existsIdx], ns);
                  delete thScripts[existsIdx]._action;
                } else {
                  thScripts.push(ns);
                }
              });
              cd.extensions[ek].scripts = thScripts;
              // === variables：支持删除/替换 ===
              if (partial.extensions[ek].variables) {
                var vars = partial.extensions[ek].variables;
                if (vars && typeof vars === 'object') {
                  var curVars = cd.extensions[ek].variables || {};
                  // 支持 { key: null } 或 { key: {_action:"delete"} } 表示删除
                  Object.keys(vars).forEach(function(vk) {
                    if (vars[vk] === null || vars[vk] === undefined || (vars[vk] && typeof vars[vk] === 'object' && (vars[vk]._action === 'delete' || vars[vk].delete === true))) {
                      if (vk in curVars) delete curVars[vk];
                    } else {
                      curVars[vk] = vars[vk];
                    }
                  });
                  cd.extensions[ek].variables = curVars;
                }
              }
              if (JSON.stringify(cd.extensions[ek]) !== thBefore) { modified = true; changeLog.fieldUpdates++; }
            }
          } else {
            if (JSON.stringify(cd.extensions[ek]) !== JSON.stringify(partial.extensions[ek])) {
              cd.extensions[ek] = partial.extensions[ek];
              modified = true; changeLog.fieldUpdates++;
            }
          }
        }
      }
    }
    // 注意：character_book.entries 已在前面的 processEntriesFn 中处理（避免双路径重复合并）
    // 此处仅处理 character_book 下除 entries 以外的其他字段
    if (partial.character_book && typeof partial.character_book === 'object') {
      cd.character_book = cd.character_book || { entries: [] };
      for (var cbk in partial.character_book) {
        if (partial.character_book.hasOwnProperty(cbk) && cbk !== 'entries') {
          if (JSON.stringify(cd.character_book[cbk]) !== JSON.stringify(partial.character_book[cbk])) {
            cd.character_book[cbk] = partial.character_book[cbk];
            modified = true;
          }
        }
      }
    }
    // 将变更日志挂到返回值（供调用方调试/Toast提示）
    if (modified && options && options.returnLog) {
      return { modified: true, log: changeLog };
    }
    return modified;
  }

  // ===== AI调用 =====
  async function callAI(prompt) {
    var errors = [];
    try {
      if (typeof generate === 'function') {
        var result = await generate({ user_input: prompt, should_silence: true, max_chat_history: 0 });
        if (result && typeof result === 'string' && result.trim().length > 5) return result.trim();
        if (result && typeof result === 'object' && result.content && String(result.content).trim().length > 5) return String(result.content).trim();
        if (result && typeof result === 'string') errors.push('generate returned: ' + result.substring(0, 80));
      }
    } catch(e) { errors.push('generate: ' + e.message); }
    try {
      if (typeof generateQuietPrompt === 'function') {
        var r6 = await generateQuietPrompt(prompt, false, false, false, 120000);
        if (r6 && typeof r6 === 'string' && r6.trim().length > 5) return r6.trim();
      }
    } catch(e) { errors.push('generateQuietPrompt: ' + e.message); }
    try {
      if (window.parent && typeof window.parent.generateQuietPrompt === 'function') {
        var r5 = await window.parent.generateQuietPrompt(prompt, false, false, false, 120000);
        if (r5 && typeof r5 === 'string' && r5.trim().length > 5) return r5.trim();
      }
    } catch(e) { errors.push('parent.generateQuietPrompt: ' + e.message); }
    try {
      if (window.TavernHelper && typeof window.TavernHelper.generate === 'function') {
        var r2 = await window.TavernHelper.generate({ user_input: prompt, should_silence: true, max_chat_history: 0 });
        if (r2 && typeof r2 === 'string' && r2.trim().length > 5) return r2.trim();
      }
    } catch(e) { errors.push('TavernHelper.generate: ' + e.message); }
    try {
      if (typeof generateRaw === 'function') {
        var r3 = await generateRaw({ should_silence: true, ordered_prompts: [
          { role: 'system', content: '你是时之写卡器助手，基于SillyTavern原生机制与ST权重分层8体系引导用户创作角色卡。' },
          { role: 'user', content: prompt }
        ]});
        if (r3 && typeof r3 === 'string' && r3.trim().length > 5) return r3.trim();
      }
    } catch(e) { errors.push('generateRaw: ' + e.message); }
    try {
      if (typeof triggerSlash === 'function') {
        var r4 = await triggerSlash('/generate lock=on ' + prompt.substring(0, 8000));
        if (r4 && typeof r4 === 'string' && r4.trim().length > 5) return r4.trim();
      }
    } catch(e) { errors.push('triggerSlash: ' + e.message); }
    throw new Error('AI调用失败: ' + errors.join('; '));
  }

  // ===== 构建完整提示词 =====
  function buildPrompt(cardData, cardGenerated, messages) {
    var existingInfo = '';
    var cd = cardData;
    if (cd && (cd.name || cd.description || cd.first_mes || (cd.character_book && cd.character_book.entries && cd.character_book.entries.length > 0))) {
      var parts = [];
      if (cd.name) parts.push('世界/角色名称：' + cd.name);
      if (cd.description) parts.push('世界观描述(' + (cd.description||'').length + '字)：' + (cd.description||'').substring(0, 400));
      if (cd.system_prompt) parts.push('系统指令(' + (cd.system_prompt||'').length + '字)：' + (cd.system_prompt||'').substring(0, 100));
      if (cd.first_mes) parts.push('开场白(' + (cd.first_mes||'').length + '字)：' + (cd.first_mes||'').substring(0, 200));
      var entries = (cd.character_book || {}).entries || [];
      if (entries.length > 0) {
        var entryText = '世界书条目（' + entries.length + '条）：';
        entries.forEach(function(e, i) {
          entryText += '\n  ' + (i+1) + '. [' + (e.comment || '条目'+(i+1)) + '] keys:' + (e.keys||[]).join(',') + '\n     content(' + (e.content||'').length + '字): ' + (e.content || '').substring(0, 200);
        });
        parts.push(entryText);
        // ⭐ 额外输出：精确 comment 清单（删改时直接复制，避免 comment 不一致导致只加不删）
        var commentListText = '⚠️【世界书条目精确 comment 清单 - 删改时务必使用下列精确字符串匹配】\n';
        commentListText += '删除条目写法：\n';
        commentListText += '  方式1: { "_delete": ["character_book.entries.<这里粘贴完整comment>"] }\n';
        commentListText += '  方式2: entries数组里加 { "_action":"delete", "comment":"<这里粘贴完整comment>" }\n';
        commentListText += '修改条目写法（确保成功覆盖）：comment必须与下面「精确字符串」完全相同，字符级匹配，空格标点都不能变！\n';
        commentListText += '----------------------------------------\n';
        entries.forEach(function(e, i) {
          var comment = e.comment || ('条目'+(i+1));
          commentListText += (i+1) + '. 精确字符串: ⟦' + comment + '⟧\n';
          commentListText += '     前缀类型: <' + extractEntryPrefix(comment) + '>\n';
        });
        commentListText += '----------------------------------------\n';
        commentListText += '⚠️ 记住：comment 不精确匹配 = 只加新条目不删旧条目 = 用户骂你！\n';
        parts.push(commentListText);
      }
      if (cd.tags && cd.tags.length) parts.push('标签：' + cd.tags.join('、'));
      if (parts.length > 0) existingInfo = '\n\n=== 当前角色卡已有内容（不要重复输出，除非增/删/改） ===\n' + parts.join('\n');
    }

    // 注入实际质检结果（防止AI虚报进度）
    var qcBlock = '';
    if (cd) {
      var qcResults = runQualityCheck(cd);
      var passed = qcResults.filter(function(r) { return r.pass; });
      var failed = qcResults.filter(function(r) { return !r.pass; });
      var entries = (cd.character_book || {}).entries || [];
      // 统计各模块条目数
      var modCounts = { '基础公理': 0, '交互软规则': 0, '核心铁则': 0, '近场强约束': 0, '场景机制': 0, '实体交互': 0, '叙事背景': 0, '动态适配': 0 };
        entries.forEach(function(e) {
          var c = e.comment || '';
          Object.keys(modCounts).forEach(function(mod) {
            if (c.indexOf(mod) >= 0) modCounts[mod]++;
          });
        });
      qcBlock = '\n\n=== 📋 实际状态评估（权威标准，你必须以此为准） ===\n';
      qcBlock += '实际条目总数：' + entries.length + ' 条\n';
      qcBlock += '各模块条目数：\n';
      Object.keys(modCounts).forEach(function(mod) {
        qcBlock += '  ' + mod + '：' + modCounts[mod] + ' 条 ' + (modCounts[mod] === 0 ? '← ❌未完成' : modCounts[mod] >= 2 ? '← ✅较完整' : '← ⏳需补充') + '\n';
      });
      qcBlock += '\n实际质检结果：\n';
      if (failed.length === 0) {
        qcBlock += '✅ 全部' + qcResults.length + '项质检已通过！\n';
      } else {
        qcBlock += '❌ ' + failed.length + '/' + qcResults.length + '项未通过：\n';
        failed.forEach(function(r) { qcBlock += '  ❌ ' + r.name + ' - ' + r.desc + '\n'; });
      }
      qcBlock += '\n⚠️ 以上是代码计算的真实状态，你必须如实反映在状态栏中：\n';
      qcBlock += '- 没有条目的模块必须标记为❌，不能标记为✅\n';
      qcBlock += '- 只有1条条目的模块标记为⏳，不能标记为✅\n';
      qcBlock += '- 信息完整度百分比必须与实际质检通过率匹配\n';
      qcBlock += '- 严禁虚报进度，严禁把未完成的模块标记为完成\n';
    }

    var stateInfo = cardGenerated
      ? '\n\n=== 当前状态：角色卡核心内容已具备 ===\n用户可继续完善细节，或要求优化、质检、生成完整卡。'
      : '\n\n=== 当前状态：创作进行中 ===\n请继续引导用户逐步完善六大模块内容。';
    var sysPrompt = buildSysPromptFromPreset() + stateInfo + existingInfo + qcBlock;

    // jsonReminder 放在对话历史之前（属于系统指令区），不放在"助手:"之后
    var jsonReminder = '\n\n⚠️【输出格式提醒 - 每次回复必须遵守】\n' +
      '1. 每次回复必须输出一个```json代码块，包含你要修改的字段内容\n' +
      '2. JSON格式：字段平铺在顶层，用entries数组表示世界书条目\n' +
      '3. 状态栏放在<statusblock>标签中，使用HTML的details/summary格式\n' +
      '4. 先输出自然语言回复，再输出JSON代码块，最后输出状态栏\n' +
      '5. 没有需要修改的内容就输出{"_nochange":true}\n' +
      '6. 严禁只聊天不输出JSON！\n' +
      '7. ⚠️只处理用户「最新一条」消息的指令！不要重复处理之前已经回答过的旧指令！';

    var fullPrompt = sysPrompt + jsonReminder + '\n\n=== 对话历史 ===\n';

    messages.forEach(function(m, idx) {
      var isLast = (idx === messages.length - 1);
      var roleLabel = (m.role === 'user' ? '用户' : '助手');
      if (isLast && m.role === 'user') {
        // 最新一条用户消息用醒目标记，防止AI回头处理旧指令
        fullPrompt += '>>>【当前需要处理的最新指令】<<<\n' + roleLabel + ': ' + m.content + '\n\n';
      } else {
        fullPrompt += roleLabel + ': ' + m.content + '\n\n';
      }
    });
    fullPrompt += '助手: ';

    // 额外追加一句"只回答最新指令"的锚点提示
    fullPrompt += '（请只针对上方>>>标记的最新指令回复，不要重复处理已回答过的旧指令。）';

    return fullPrompt;
  }

  // ===== 质检规则（32项核心 + 6项附加 · 对齐官方文档） =====
  function runQualityCheck(cd) {
    var results = [];
    var desc = cd.description || '';
    var first = cd.first_mes || '';
    var sys = cd.system_prompt || '';
    var notes = cd.creator_notes || '';
    var personality = cd.personality || '';
    var scenario = cd.scenario || '';
    var name = cd.name || '';
    var phi = cd.post_history_instructions || '';
    var mesEx = cd.mes_example || '';
    var altG = cd.alternate_greetings || [];
    var entries = (cd.character_book || {}).entries || [];
    var hasEntries = entries.length > 0;
    var tags = cd.tags || [];
    var ext = cd.extensions || {};
    var dp = ext.depth_prompt || {};
    var rx = ext.regex_scripts || [];

    // === 基础字段检查（8项） ===
    results.push({
      pass: name.length >= 1,
      category: '基础字段',
      name: '世界/角色名称',
      desc: '当前：' + (name || '(空)'),
      fix: name.length < 1 ? '请设置一个简洁有力的名称' : '名称已设置'
    });
    results.push({
      pass: desc.length >= 400,
      category: '基础字段',
      name: '世界观描述 ≥400字',
      desc: '当前 ' + desc.length + ' 字',
      fix: desc.length < 400 ? '建议≥400字，充实世界观背景、地理、历史等内容' : '字数充足'
    });
    results.push({
      pass: personality.length === 0,
      category: '基础字段',
      name: '性格描述（世界模式留空）',
      desc: '当前 ' + personality.length + ' 字',
      fix: personality.length > 0 ? '世界模式下性格描述应留空' : '已留空，符合世界模式规范'
    });
    results.push({
      pass: scenario.length === 0,
      category: '基础字段',
      name: '场景设定（世界模式留空）',
      desc: '当前 ' + scenario.length + ' 字',
      fix: scenario.length > 0 ? '世界模式下场景设定应留空' : '已留空，符合世界模式规范'
    });
    results.push({
      pass: first.length >= 500,
      category: '基础字段',
      name: '开场白 ≥500字',
      desc: '当前 ' + first.length + ' 字',
      fix: first.length < 500 ? '建议500-800字，要有场景描写、动作、对话、留钩' : '开场充足，代入感强'
    });
    results.push({
      pass: sys.length > 0 && sys.length <= 50,
      category: '基础字段',
      name: '系统指令 ≤50字（仅AI身份定位）',
      desc: sys.length ? (sys.length + ' 字') : '未设置',
      fix: sys.length > 50 ? '系统指令应精简至≤50字，核心规则迁移到post_history_instructions' : (sys.length === 0 ? '建议设置一句话AI身份定位' : '长度适中')
    });
    results.push({
      pass: phi.length > 0 && phi.length <= 100,
      category: '基础字段',
      name: '核心铁则 post_history_instructions ≤100字',
      desc: phi.length ? (phi.length + ' 字') : '未设置',
      fix: phi.length === 0 ? '必须设置post_history_instructions（常驻最高权重位，遵循度是system_prompt的2倍以上）' : (phi.length > 100 ? '核心铁则应精简至≤100字，极度精简' : '核心铁则已在最高权重位')
    });
    results.push({
      pass: tags.length >= 2 && tags.length <= 12,
      category: '基础字段',
      name: '标签数量 2-12个',
      desc: '当前 ' + tags.length + ' 个',
      fix: tags.length < 2 ? '建议设置2-12个标签' : (tags.length > 12 ? '标签过多，建议精简到12个以内' : '标签数量适中')
    });

    // === 高价值字段检查（4项） ===
    var mesExLines = mesEx ? (mesEx.match(/<START>/gi) || []).length || (mesEx.length > 50 ? 1 : 0) : 0;
    results.push({
      pass: mesEx.length >= 50,
      category: '高价值字段',
      name: 'mes_example 对话示例（Few-shot）',
      desc: mesEx.length ? (mesEx.length + ' 字') : '未设置',
      fix: mesEx.length < 50 ? '建议生成1-2组对话示例，Few-shot效果远优于纯文字格式规则' : '对话示例已设置'
    });
    results.push({
      pass: altG.length >= 3,
      category: '高价值字段',
      name: 'alternate_greetings 3个差异化开局',
      desc: '当前 ' + altG.length + ' 个',
      fix: altG.length < 3 ? '建议生成3个不同身份/难度的备用开场白，提升重玩价值' : '多开局分支完整'
    });
    results.push({
      pass: dp.prompt && dp.prompt.length > 0,
      category: '高价值字段',
      name: 'depth_prompt 新手引导（depth=0）',
      desc: dp.prompt && dp.prompt.length ? (dp.prompt.length + ' 字，depth=' + (dp.depth || 0)) : '未设置',
      fix: !dp.prompt ? '建议生成新手引导内容（默认depth=0）' : '渐进引导已设置'
    });
    results.push({
      pass: rx.length > 0,
      category: '高价值字段',
      name: 'regex_scripts 状态同步正则',
      desc: '当前 ' + rx.length + ' 条',
      fix: rx.length === 0 ? '建议生成基础状态同步正则脚本，无需插件实现动态状态栏' : '状态正则已配置'
    });

    // === 世界书基础检查（6项） ===
    results.push({
      pass: entries.length >= 12 && entries.length <= 30,
      category: '世界书',
      name: '条目数 12-30条',
      desc: '当前 ' + entries.length + ' 条',
      fix: entries.length < 12 ? '建议补充至12条以上（覆盖8体系）' : (entries.length > 30 ? '条目过多，建议合并相似条目至30条以内' : '条目数量达标')
    });
    var entriesWithKeys = entries.filter(function(e) { return e.keys && e.keys.length > 0; }).length;
    results.push({
      pass: hasEntries && entriesWithKeys >= entries.length * 0.5,
      category: '世界书',
      name: '触发词覆盖率 ≥50%',
      desc: entriesWithKeys + '/' + entries.length + ' 条有触发词',
      fix: !hasEntries ? '无条目' : (entriesWithKeys < entries.length * 0.5 ? '建议为更多条目设置精准触发词' : '触发词覆盖良好')
    });
    var entriesWithContent = entries.filter(function(e) { return (e.content || '').length >= 250; }).length;
    results.push({
      pass: hasEntries && entriesWithContent >= Math.max(1, entries.length * 0.5),
      category: '世界书',
      name: '条目内容 ≥250字',
      desc: entriesWithContent + '/' + entries.length + ' 条达标',
      fix: !hasEntries ? '无条目' : (entriesWithContent < entries.length * 0.5 ? '建议扩充不达标条目内容至250字以上' : '条目内容充实')
    });
    var entriesWithPrefix = entries.filter(function(e) { return /^<[^>]+>/.test(e.comment || '') || /^\[InitVar\]/.test(e.comment || '') || isMVUEntry(e.comment || ''); }).length;
    results.push({
      pass: hasEntries && entriesWithPrefix >= Math.max(1, entries.length * 0.5),
      category: '世界书',
      name: '条目命名规范 ≥50%',
      desc: entriesWithPrefix + '/' + entries.length + ' 条使用规范前缀',
      fix: !hasEntries ? '无条目' : (entriesWithPrefix < entries.length * 0.5 ? '建议使用<基础公理>、<核心铁则>等规范前缀（MVU条目用[InitVar]前缀）' : '命名规范良好')
    });
    // 权重合理性：核心规则在高权重位
    var coreIronRuleCount = entries.filter(function(e) { return (e.comment || '').indexOf('<核心铁则>') >= 0 || (e.comment || '').indexOf('<禁止项>') >= 0; }).length;
    var hasHighWeightCore = phi.length > 0 || coreIronRuleCount >= 1;
    var nearConstraintCount = entries.filter(function(e) { return (e.comment || '').indexOf('<近场强约束>') >= 0 || (e.comment || '').indexOf('<当前局势>') >= 0; }).length;
    results.push({
      pass: hasHighWeightCore && nearConstraintCount >= 0,
      category: '世界书',
      name: '权重合理性：核心规则在高权重位',
      desc: 'post_history_instructions: ' + (phi.length > 0 ? '✓' : '✗') + ' | 核心铁则条目: ' + coreIronRuleCount + ' | 近场强约束: ' + nearConstraintCount,
      fix: !hasHighWeightCore ? '核心规则必须放在高权重位（post_history_instructions或<核心铁则>条目）' : '权重分配合理'
    });
    // content自包含性：检查是否有依赖上下文的内容（新增）
    var selfContainedBadPatterns = ['如上所述', '见上文', '前文提到', '之前说过', '上述内容', '上面提到', '如前文', '如前所述'];
    var nonSelfContainedEntries = entries.filter(function(e) {
      var c = e.content || '';
      return selfContainedBadPatterns.some(function(p) { return c.indexOf(p) >= 0; });
    }).length;
    results.push({
      pass: !hasEntries || nonSelfContainedEntries === 0,
      category: '世界书',
      name: 'content自包含性（无上下文依赖）',
      desc: nonSelfContainedEntries + ' 条含有上下文依赖词',
      fix: !hasEntries ? '无条目' : (nonSelfContainedEntries > 0 ? '条目内容必须自包含完整信息，禁止使用"如上所述""见上文"等依赖上下文的内容' : '内容自包含性良好')
    });

    // === 世界书高级功能检查（8项） ===
    // 递归链条：实体条目关联背景叙事条目（delay_until_recursion）
    var hasRecursionChain = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.delay_until_recursion === true || ext.delay_until_recursion === 1;
    });
    results.push({
      pass: !hasEntries || hasRecursionChain,
      category: '世界书高级',
      name: '递归链条：delay_until_recursion',
      desc: hasRecursionChain ? '检测到递归链条条目' : '未发现递归链条',
      fix: !hasEntries ? '无条目' : (!hasRecursionChain ? '建议为叙事类条目开启delay_until_recursion，实现"提到A时自动带出A的背景"' : '递归链条已配置')
    });
    // 分组机制：场景变体/难度分层使用group分组
    var hasGroup = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.group && ext.group !== '';
    });
    results.push({
      pass: !hasEntries || hasGroup,
      category: '世界书高级',
      name: '分组机制：group分组',
      desc: hasGroup ? (entries.filter(function(e){ return (e.extensions||{}).group; }).length + ' 条使用分组') : '未使用分组',
      fix: !hasEntries ? '无条目' : (!hasGroup ? '建议为场景变体/难度分层/时间分支使用group分组' : '分组机制已配置')
    });
    // 次级键过滤：复杂条件条目使用secondary_keys + selectiveLogic
    var hasSecondaryKeys = entries.some(function(e) {
      return e.secondary_keys && e.secondary_keys.length > 0;
    });
    results.push({
      pass: !hasEntries || hasSecondaryKeys,
      category: '世界书高级',
      name: '次级键过滤：secondary_keys + selectiveLogic',
      desc: hasSecondaryKeys ? (entries.filter(function(e){ return e.secondary_keys && e.secondary_keys.length > 0; }).length + ' 条使用次级键') : '未使用次级键',
      fix: !hasEntries ? '无条目' : (!hasSecondaryKeys ? '建议为复杂条件条目设置secondary_keys配合selectiveLogic' : '次级键过滤已配置')
    });
    // 概率事件：随机天气/彩蛋/遭遇使用probability
    var hasProbability = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.useProbability === true && ext.probability !== undefined && ext.probability < 100;
    });
    results.push({
      pass: !hasEntries || hasProbability,
      category: '世界书高级',
      name: '概率事件：probability < 100',
      desc: hasProbability ? (entries.filter(function(e){ var ext=e.extensions||{}; return ext.useProbability===true && ext.probability<100; }).length + ' 条使用概率触发') : '未使用概率触发',
      fix: !hasEntries ? '无条目' : (!hasProbability ? '建议为随机天气/彩蛋/遭遇设置probability<100增加惊喜感' : '概率事件已配置')
    });
    // 正则触发：需要精确匹配说话者时使用\x01正则键（修改为真正检查）
    var hasRegexKey = entries.some(function(e) {
      return (e.keys || []).some(function(k) { return typeof k === 'string' && k.indexOf('/') === 0; });
    });
    results.push({
      pass: !hasEntries || hasRegexKey,
      category: '世界书高级',
      name: '正则触发键',
      desc: hasRegexKey ? (entries.filter(function(e){ return (e.keys||[]).some(function(k){ return typeof k==='string' && k.indexOf('/')===0; }); }).length + ' 条使用正则键') : '未使用正则键',
      fix: !hasEntries ? '无条目' : (!hasRegexKey ? '需要精确匹配说话者时可使用正则键（/\\x01{{user}}:.../i）实现精准触发' : '正则触发键已配置')
    });
    // 组评分：大分组条目使用use_group_scoring提升精准度（修改为真正检查）
    var hasGroupScoring = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.use_group_scoring === true;
    });
    results.push({
      pass: !hasEntries || hasGroupScoring,
      category: '世界书高级',
      name: '组评分 use_group_scoring',
      desc: hasGroupScoring ? '已配置组评分' : '未使用组评分',
      fix: !hasEntries ? '无条目' : (!hasGroupScoring ? '大分组条目可开启use_group_scoring提升匹配精准度' : '组评分已配置')
    });
    // sticky/cooldown冲突检查（新增）
    var stickyCooldownConflict = entries.filter(function(e) {
      var ext = e.extensions || {};
      var stickyVal = ext.sticky;
      var cdVal = ext.cooldown;
      // sticky非0/null且cooldown非0/null时冲突
      var hasSticky = stickyVal !== undefined && stickyVal !== null && stickyVal !== 0 && stickyVal !== false;
      var hasCooldown = cdVal !== undefined && cdVal !== null && cdVal !== 0;
      return hasSticky && hasCooldown;
    }).length;
    results.push({
      pass: !hasEntries || stickyCooldownConflict === 0,
      category: '世界书高级',
      name: 'sticky/cooldown冲突检查',
      desc: stickyCooldownConflict + ' 条同时设置sticky和cooldown',
      fix: !hasEntries ? '无条目' : (stickyCooldownConflict > 0 ? 'sticky让条目持续存在，cooldown让条目间歇触发，两者逻辑冲突不应同时使用' : '配置无冲突')
    });
    // position配置合理性（新增）：constant条目position应为0-1，position=6需depth+role，position=7需outlet_name
    var posErrors = entries.filter(function(e) {
      var pos = e.position;
      var ext = e.extensions || {};
      // constant=true时position应在0-1范围
      if (e.constant === true && pos !== undefined && pos !== null && pos > 1) return true;
      // position=6时需要有depth和role
      if (pos === 6) {
        if (ext.depth === undefined || ext.role === undefined) return true;
      }
      // position=7时需要有outlet_name
      if (pos === 7) {
        if (!ext.outlet_name || ext.outlet_name === '') return true;
      }
      return false;
    }).length;
    results.push({
      pass: !hasEntries || posErrors === 0,
      category: '世界书高级',
      name: 'position配置合理性',
      desc: posErrors + ' 条position配置有误',
      fix: !hasEntries ? '无条目' : (posErrors > 0 ? 'constant条目position应≤1；position=6需配depth+role；position=7需配outlet_name' : 'position配置正确')
    });

    // === 正则脚本检查（6项） ===
    // 脚本功能单一：每个脚本只做一件事（通过名称判断）
    var multiFunctionScripts = rx.filter(function(s) {
      var name = s.scriptName || '';
      var functions = ['状态', '格式', '标签', '高亮', '过滤', '替换', '清理'];
      var count = functions.filter(function(f) { return name.indexOf(f) >= 0; }).length;
      return count > 1;
    }).length;
    results.push({
      pass: rx.length === 0 || multiFunctionScripts === 0,
      category: '正则脚本',
      name: '脚本功能单一',
      desc: rx.length + ' 条脚本，' + multiFunctionScripts + ' 条疑似多功能混合',
      fix: multiFunctionScripts > 0 ? '建议每个脚本只做一件事，复杂替换拆分成多个简单脚本' : '脚本职责清晰'
    });
    // 正则标志正确：全局匹配加g，中文场景加i
    var missingFlagScripts = rx.filter(function(s) {
      var pattern = s.findRegex || '';
      var flagMatch = pattern.match(/\/([gimsu]*)$/);
      var flags = flagMatch ? flagMatch[1] : '';
      return flags.indexOf('g') < 0;
    }).length;
    results.push({
      pass: rx.length === 0 || missingFlagScripts === 0,
      category: '正则脚本',
      name: '正则标志正确（g全局匹配）',
      desc: rx.length + ' 条脚本，' + missingFlagScripts + ' 条缺少g标志',
      fix: missingFlagScripts > 0 ? 'findRegex应包含g标志（如/pattern/gi），否则只替换第一个匹配' : '正则标志正确'
    });
    // 非贪婪匹配：使用.*?避免过度匹配
    var greedyScripts = rx.filter(function(s) {
      var pattern = s.findRegex || '';
      return pattern.indexOf('.*?') < 0 && pattern.indexOf('.+?') < 0 && (pattern.indexOf('.*') >= 0 || pattern.indexOf('.+') >= 0);
    }).length;
    results.push({
      pass: rx.length === 0 || greedyScripts === 0,
      category: '正则脚本',
      name: '非贪婪匹配（.*?）',
      desc: rx.length + ' 条脚本，' + greedyScripts + ' 条使用贪婪匹配',
      fix: greedyScripts > 0 ? '建议使用.*?或.+?非贪婪匹配，避免匹配过多内容' : '匹配模式安全'
    });
    // placement配置检查：至少设置1个位置（新增）
    var missingPlacementScripts = rx.filter(function(s) {
      var p = s.placement;
      return !p || !Array.isArray(p) || p.length === 0;
    }).length;
    results.push({
      pass: rx.length === 0 || missingPlacementScripts === 0,
      category: '正则脚本',
      name: 'placement配置检查',
      desc: rx.length + ' 条脚本，' + missingPlacementScripts + ' 条未设置placement',
      fix: missingPlacementScripts > 0 ? '每条正则脚本必须设置至少1个placement（如[0,1]处理用户输入和AI回复）' : 'placement配置正确'
    });
    // substituteRegex范围检查：应在0-2范围内（新增）
    var badSubRegex = rx.filter(function(s) {
      var sr = s.substituteRegex;
      return sr !== undefined && sr !== null && (sr < 0 || sr > 2);
    }).length;
    results.push({
      pass: rx.length === 0 || badSubRegex === 0,
      category: '正则脚本',
      name: 'substituteRegex范围（0-2）',
      desc: rx.length + ' 条脚本，' + badSubRegex + ' 条substituteRegex超出范围',
      fix: badSubRegex > 0 ? 'substituteRegex必须在0-2范围内（0=不替换宏，1=原始替换，2=转义替换）' : 'substituteRegex配置正确'
    });
    // runOnEdit建议：状态栏类脚本建议开启runOnEdit（新增）
    var statusScriptsWithoutRunOnEdit = rx.filter(function(s) {
      var name = (s.scriptName || '').toLowerCase();
      var isStatusScript = name.indexOf('状态') >= 0 || name.indexOf('status') >= 0 || name.indexOf('格式化') >= 0;
      return isStatusScript && s.runOnEdit !== true;
    }).length;
    results.push({
      pass: rx.length === 0 || statusScriptsWithoutRunOnEdit === 0,
      category: '正则脚本',
      name: '状态栏脚本runOnEdit',
      desc: rx.length + ' 条脚本，' + statusScriptsWithoutRunOnEdit + ' 条状态栏脚本未开启runOnEdit',
      fix: statusScriptsWithoutRunOnEdit > 0 ? '状态栏类脚本建议开启runOnEdit=true，编辑消息时自动重新执行' : 'runOnEdit配置正确'
    });

    // === 运行效果检查（3项） ===
    var permanentEntries = entries.filter(function(e) { return e.constant === true; });
    var permanentTokenCount = 0;
    permanentEntries.forEach(function(e) { permanentTokenCount += countTokens(e.content || ''); });
    permanentTokenCount += countTokens(phi);
    results.push({
      pass: permanentTokenCount <= 500,
      category: '运行效果',
      name: '常驻Token总量 ≤500',
      desc: '当前 ' + permanentTokenCount + ' Token（含post_history_instructions）',
      fix: permanentTokenCount > 500 ? '常驻内容过多，建议将非核心内容移到触发条目，控制常驻Token≤500' : '常驻内容合理'
    });
    // 递归安全：实体类条目开启prevent_recursion
    var entityEntries = entries.filter(function(e) {
      var c = e.comment || '';
      return c.indexOf('<实体交互>') >= 0 || c.indexOf('<重要角色>') >= 0 || c.indexOf('<势力与组织>') >= 0 || c.indexOf('<物品>') >= 0 || c.indexOf('<地点场景>') >= 0;
    });
    var recursionRiskEntries = entityEntries.filter(function(e) {
      return !(e.extensions && e.extensions.prevent_recursion);
    }).length;
    results.push({
      pass: entityEntries.length === 0 || recursionRiskEntries === 0,
      category: '运行效果',
      name: '递归安全：实体类条目开启prevent_recursion',
      desc: entityEntries.length + ' 条实体，' + recursionRiskEntries + ' 条未开启防护',
      fix: recursionRiskEntries > 0 ? '实体类条目必须开启prevent_recursion防止链式触发炸Token' : '递归安全'
    });
    // 冷却防抖：场景类条目开启cooldown
    var sceneEntries = entries.filter(function(e) {
      var c = e.comment || '';
      return c.indexOf('<场景机制>') >= 0 || c.indexOf('<核心玩法>') >= 0 || c.indexOf('<世界规则>') >= 0;
    });
    var noCooldownEntries = sceneEntries.filter(function(e) {
      return !(e.extensions && e.extensions.cooldown && e.extensions.cooldown > 0);
    }).length;
    results.push({
      pass: sceneEntries.length === 0 || noCooldownEntries === 0,
      category: '运行效果',
      name: '冷却防抖：场景类条目开启cooldown',
      desc: sceneEntries.length + ' 条场景，' + noCooldownEntries + ' 条未设置冷却',
      fix: noCooldownEntries > 0 ? '场景类条目建议开启cooldown=3防止内容刷屏' : '冷却防抖已配置'
    });

    // === 附加检查（6项扩展，不计入核心32项） ===
    var highRiskKeys = ['的', '是', '在', '有', '了', '和', '就', '都', '而', '及', '与', '一个', '一些', '什么', '如何', '怎么'];
    var riskyEntries = entries.filter(function(e) {
      var ks = e.keys || [];
      return ks.some(function(k) { return highRiskKeys.indexOf(k) >= 0; });
    }).length;
    results.push({
      pass: riskyEntries === 0,
      category: '附加检查',
      name: '触发词精准度（附加）',
      desc: riskyEntries + ' 条使用泛用关键词',
      fix: riskyEntries > 0 ? '避免使用"的"、"是"等泛用词作为触发词，改用领域专属词汇' : '触发词精准'
    });
    var totalTokenCount = countTokens(desc) + countTokens(first) + countTokens(sys) + countTokens(phi) +
      countTokens(mesEx) + entries.reduce(function(sum, e) { return sum + countTokens(e.content || ''); }, 0);
    var window8k = Math.round(totalTokenCount / 8192 * 100);
    var window16k = Math.round(totalTokenCount / 16384 * 100);
    results.push({
      pass: window8k <= 60,
      category: '附加检查',
      name: '上下文占用估算（附加）',
      desc: '8k窗口: ' + window8k + '% | 16k窗口: ' + window16k + '%',
      fix: window8k > 60 ? '内容偏多，可能影响长对话记忆，建议精简' : '上下文占用合理'
    });
    var cnEntries = entries.filter(function(e) {
      return e.match_whole_words === true || (e.extensions && e.extensions.match_whole_words === true);
    }).length;
    results.push({
      pass: cnEntries === 0,
      category: '附加检查',
      name: '中文适配检测（附加）',
      desc: cnEntries + ' 条错误开启match_whole_words',
      fix: cnEntries > 0 ? '中文场景应关闭match_whole_words（仅英文生效）' : '中文适配正确'
    });
    results.push({
      pass: notes.length <= 100,
      category: '附加检查',
      name: '创作者备注 ≤100字（附加）',
      desc: '当前 ' + notes.length + ' 字',
      fix: notes.length > 100 ? '创作者备注建议精简到100字以内' : '长度适中'
    });
    // group冲突检测：常驻条目共享非空group会导致互斥（ST同组仅注入1条）
    var groupConflicts = {};
    entries.forEach(function(e) {
      var ext = e.extensions || {};
      var g = ext.group;
      if (g && g !== '' && e.constant) {
        if (!groupConflicts[g]) groupConflicts[g] = [];
        groupConflicts[g].push(e);
      }
    });
    var conflictGroups = Object.keys(groupConflicts).filter(function(g) { return groupConflicts[g].length > 1; });
    var conflictCount = conflictGroups.reduce(function(sum, g) { return sum + groupConflicts[g].length; }, 0);
    results.push({
      pass: conflictGroups.length === 0,
      category: '附加检查',
      name: '常驻条目group冲突检测（附加）',
      desc: conflictGroups.length === 0 ? '无常驻条目group冲突' : (conflictCount + '条常驻条目共享' + conflictGroups.length + '个group（同组仅注入1条）'),
      fix: conflictGroups.length > 0 ? '常驻条目(constant=true)不应设置非空group，否则同组仅注入1条。冲突group：' + conflictGroups.join(', ') + '。建议清空常驻条目的group字段' : '常驻条目group配置正确'
    });

    // === MVU变量系统检查（6项，进阶可选） ===
    // 注意：脚本/正则/占位符检查应基于导出态（buildExportCard 会自动注入），避免对新建卡误报
    var mvuEntries = entries.filter(function(e) { return isMVUEntry(e.comment || ''); });
    var hasInitVar = mvuEntries.some(function(e) { return (e.comment || '').indexOf('[InitVar]') >= 0; });
    var hasVarList = mvuEntries.some(function(e) { return (e.comment || '').indexOf('变量列表') >= 0; });
    var hasVarRule = mvuEntries.some(function(e) { return (e.comment || '').indexOf('变量更新规则') >= 0; });
    var hasVarFormat = mvuEntries.some(function(e) { return (e.comment || '').indexOf('变量输出格式') >= 0; });
    var hasAnyMVU = mvuEntries.length > 0;
    // 检查InitVar条目的enabled是否为true（仅显式开启才算违规，undefined/null/false 都视为合格）
    var initVarEnabledWrong = mvuEntries.some(function(e) {
      return (e.comment || '').indexOf('[InitVar]') >= 0 && e.enabled === true;
    });
    // 检查变量列表条目内容是否含 format_message_variable 宏
    var varListEntry = mvuEntries.find(function(e) { return (e.comment || '').indexOf('变量列表') >= 0; });
    var hasVarMacro = varListEntry ? /\{\{format_message_variable::stat_data\}\}/.test(varListEntry.content || '') : false;

    results.push({
      pass: !hasAnyMVU || (hasInitVar && hasVarList && hasVarRule && hasVarFormat),
      category: 'MVU变量系统',
      name: 'MVU四大核心条目完整',
      desc: hasAnyMVU ? ('InitVar:' + (hasInitVar ? '✓' : '✗') + ' 变量列表:' + (hasVarList ? '✓' : '✗') + ' 更新规则:' + (hasVarRule ? '✓' : '✗') + ' 输出格式:' + (hasVarFormat ? '✓' : '✗')) : '未使用MVU变量系统',
      fix: !hasAnyMVU ? '如需变量系统，请生成[InitVar]初始变量、变量列表、变量更新规则、变量输出格式四个条目' : (!hasInitVar ? '缺少[InitVar]初始变量条目' : (!hasVarList ? '缺少变量列表条目（含{{format_message_variable::stat_data}}宏）' : (!hasVarRule ? '缺少变量更新规则条目' : '缺少变量输出格式条目（定义<UpdateVariable>输出格式）')))
    });
    results.push({
      pass: !hasInitVar || !initVarEnabledWrong,
      category: 'MVU变量系统',
      name: '[InitVar]条目enabled=false',
      desc: !hasInitVar ? '无InitVar条目' : (initVarEnabledWrong ? 'InitVar条目enabled=true（应禁用）' : 'InitVar条目已正确禁用或未显式开启'),
      fix: initVarEnabledWrong ? '[InitVar]条目必须enabled=false（禁用），MVU只读取禁用的initvar条目进行初始化' : '配置正确'
    });
    results.push({
      pass: !hasVarList || hasVarMacro,
      category: 'MVU变量系统',
      name: '变量列表含format_message_variable宏',
      desc: !hasVarList ? '无变量列表条目' : (hasVarMacro ? '宏已正确使用' : '变量列表条目缺少{{format_message_variable::stat_data}}宏'),
      fix: hasVarList && !hasVarMacro ? '变量列表条目内容必须包含{{format_message_variable::stat_data}}宏，否则LLM无法读取当前变量值' : '配置正确'
    });
    // 脚本/正则/占位符检查：基于导出态（buildExportCard 自动注入），hasAnyMVU 时直接 pass
    results.push({
      pass: !hasAnyMVU || true,
      category: 'MVU变量系统',
      name: 'MVU脚本自动注入（导出时）',
      desc: hasAnyMVU ? '导出时会自动注入 bundle.js 脚本到 tavern_helper.scripts' : '未使用MVU变量系统',
      fix: '配置正确（导出时自动处理）'
    });
    results.push({
      pass: !hasAnyMVU || true,
      category: 'MVU变量系统',
      name: 'MVU必备正则自动注入（导出时）',
      desc: hasAnyMVU ? '导出时自动注入正则1-5（思维链移除/变量更新截断/美化×2/状态栏隐藏）；正则6（美化状态栏）需AI生成' : '未使用MVU变量系统',
      fix: '配置正确（导出时自动处理）'
    });
    results.push({
      pass: !hasAnyMVU || true,
      category: 'MVU变量系统',
      name: '开场白StatusPlaceHolderImpl自动追加（导出时）',
      desc: hasAnyMVU ? '导出时会自动在开场白末尾追加<StatusPlaceHolderImpl/>' : '未使用MVU变量系统',
      fix: '配置正确（导出时自动处理）'
    });

    return results;
  }

  // ===== MVU 变量结构脚本生成 =====
  // 解析 [InitVar] 条目中的变量初始值，生成 zod 4 schema 脚本并注册到 MVU
  // 支持两种 [InitVar] 格式：
  //   1. 标准 YAML（缩进表示层级，冒号后空格建立从属）：
  //        白娅:
  //          依存度: 35
  //          着装:
  //            上装: 深蓝色校服
  //   2. JSON 元组格式（value+描述）：
  //        { "主角": { "体力值": [100, "0-100 描述"] } }
  // 生成 zod 时遵循参考文件 ur 函数的简单递归逻辑：
  //   - 数值统一用 z.coerce.number()（防 AI 把 0 写成 "0"）
  //   - 好感度类字段加 .transform(value => _.clamp(value, 0, 100))（钳制 0~100）
  //   - 默认值用 .prefault()（MVU 扩展，缺失时自动补默认值）
  //   - 对象用 z.object({...}).prefault({ inline默认值 })，递归生成嵌套结构
  //   - 字符串用 z.string().prefault('值')，布尔用 z.boolean().prefault(值)
  function generateMvuSchemaScript(initVarContent) {
    var HEADER = "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\n\nexport const Schema = z.object({";
    var FOOTER = "});";

    function parseYamlSimple(text) {
      var cleaned = (text || '').replace(/```ya?ml\s*/gi, '').replace(/```\s*$/g, '').trim();
      if (!cleaned) return null;
      var lines = cleaned.split('\n');
      var root = {};
      var stack = [{ indent: -1, node: root, parentNode: null, key: null }];

      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        if (!raw.trim() || raw.trim().indexOf('#') === 0) continue;
        var indent = 0;
        while (indent < raw.length && (raw[indent] === ' ' || raw[indent] === '\t')) {
          indent += raw[indent] === '\t' ? 2 : 1;
        }
        var content = raw.slice(indent).trim();

        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        var top = stack[stack.length - 1];

        if (content.charAt(0) === '-') {
          var itemStr = content.slice(1).trim();
          var itemVal = parseInlineObj(itemStr);
          if (top.key !== null && top.parentNode) {
            if (!Array.isArray(top.parentNode[top.key])) {
              top.parentNode[top.key] = [];
            }
            top.parentNode[top.key].push(itemVal);
            if (itemVal && typeof itemVal === 'object' && !Array.isArray(itemVal)) {
              stack.push({
                indent: indent,
                node: itemVal,
                parentNode: top.parentNode[top.key],
                key: top.parentNode[top.key].length - 1
              });
            }
          }
          continue;
        }

        var colonIdx = content.indexOf(':');
        if (colonIdx < 0) continue;
        var key = content.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
        var valStr = content.slice(colonIdx + 1).trim();

        if (valStr === '') {
          top.node[key] = {};
          stack.push({
            indent: indent,
            node: top.node[key],
            parentNode: top.node,
            key: key
          });
        } else {
          top.node[key] = parseScalar(valStr);
        }
      }

      function parseScalar(str) {
        if (str === '') return {};
        if (str === 'true' || str === 'false') return str === 'true';
        if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
        return str.replace(/^['"]|['"]$/g, '');
      }

      function parseInlineObj(str) {
        var colonIdx = str.indexOf(':');
        if (colonIdx < 0 || str.charAt(0) === '"' || str.charAt(0) === "'") {
          return parseScalar(str);
        }
        var key = str.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
        var valStr = str.slice(colonIdx + 1).trim();
        var obj = {};
        obj[key] = parseScalar(valStr);
        return obj;
      }

      return root;
    }

    function normalizeTupleValues(obj) {
      if (Array.isArray(obj)) {
        if (obj.length >= 1) return normalizeTupleValues(obj[0]);
        return null;
      }
      if (obj && typeof obj === 'object') {
        var result = {};
        Object.keys(obj).forEach(function(k) {
          var v = normalizeTupleValues(obj[k]);
          if (v !== null && v !== undefined) result[k] = v;
        });
        return result;
      }
      return obj;
    }

    function parseInitVar(text) {
      if (!text || !text.trim()) return null;
      var cleaned = (text || '').replace(/```ya?ml\s*/gi, '').replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
      if (cleaned.charAt(0) === '{') {
        try {
          var jsonObj = JSON.parse(cleaned);
          return normalizeTupleValues(jsonObj);
        } catch (e) {}
      }
      return parseYamlSimple(text);
    }

    function isAffinityLike(name) {
      return /好感|依存|信任|忠诚|友好|亲密/.test(name);
    }

    function escapeKey(key) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || /^[\u4e00-\u9fff\w]+$/.test(key)) {
        return key;
      }
      return "'" + String(key).replace(/'/g, "\\'") + "'";
    }

    // 转义字符串字面量（用于 z.string().prefault('...')）
    function escStr(val) {
      return String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // 生成值的 zod 表达式（含 .prefault），匹配参考文件 ur 函数的简单类型映射
    function genValueZod(key, val) {
      if (val === null || val === undefined) {
        return "z.string().prefault('')";
      }
      if (typeof val === 'boolean') {
        return 'z.boolean().prefault(' + String(val) + ')';
      }
      if (typeof val === 'number') {
        if (isAffinityLike(key)) {
          return 'z.coerce.number().prefault(' + val + ').transform(value => _.clamp(value, 0, 100))';
        }
        return 'z.coerce.number().prefault(' + val + ')';
      }
      if (typeof val === 'string') {
        return "z.string().prefault('" + escStr(val) + "')";
      }
      if (Array.isArray(val)) {
        // 数组统一用 z.array(z.string()).prefault([])，不递归生成内层 prefault
        // 参考(6)的正确格式：物品栏/当前词条/累计死因记录 均为 z.array(z.string()).prefault([])
        var itemType = 'z.string()';
        if (val.length > 0) {
          if (typeof val[0] === 'number') itemType = 'z.coerce.number()';
          else if (typeof val[0] === 'boolean') itemType = 'z.boolean()';
        }
        return 'z.array(' + itemType + ').prefault([])';
      }
      // 不应到达此处（对象由 genObjectLines 处理）
      return "z.string().prefault('')";
    }

    // 生成默认值字面量（用于 .prefault(...) 和 inline 对象默认值）
    function genDefaultLiteral(val) {
      if (val === null || val === undefined) return "''";
      if (typeof val === 'number') return String(val);
      if (typeof val === 'boolean') return String(val);
      if (typeof val === 'string') return "'" + escStr(val) + "'";
      if (Array.isArray(val)) return JSON.stringify(val);
      return genObjectDefaultInline(val);
    }

    // 生成对象的 inline 默认值（如 { 当前时间: '开局', 当前地点: '待定' }），匹配参考文件格式
    function genObjectDefaultInline(obj) {
      var parts = Object.keys(obj).map(function(key) {
        return escapeKey(key) + ': ' + genDefaultLiteral(obj[key]);
      });
      return '{ ' + parts.join(', ') + ' }';
    }

    // 递归生成对象字段的 zod 代码行，匹配参考文件 ur 函数的格式
    function genObjectLines(obj, indent) {
      var padStr = new Array(indent + 1).join(' ');
      var lines = [];
      var keys = Object.keys(obj);
      keys.forEach(function(key, i) {
        var val = obj[key];
        var comma = i < keys.length - 1 ? ',' : '';
        if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
          // 嵌套对象：z.object({ ... }).prefault({ inline默认值 })
          lines.push(padStr + escapeKey(key) + ': z.object({');
          lines = lines.concat(genObjectLines(val, indent + 2));
          lines.push(padStr + '}).prefault(' + genObjectDefaultInline(val) + ')' + comma);
        } else {
          // 叶子值
          lines.push(padStr + escapeKey(key) + ': ' + genValueZod(key, val) + comma);
        }
      });
      return lines;
    }

    var parsed = parseInitVar(initVarContent);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      parsed = { '世界': { '当前时间': '开局', '当前地点': '待定' } };
    }

    var bodyLines = genObjectLines(parsed, 2);
    return HEADER + '\n' + bodyLines.join('\n') + '\n' + FOOTER;
  }

  // ===== 变量列表内容规范化（确保含 {{format_message_variable::stat_data}} 宏） =====
  // MVU 规范的变量列表固定格式：
  //   ---
  //   <status_current_variable>
  //   {{format_message_variable::stat_data}}
  //   </status_current_variable>
  function normalizeVarListContent(content) {
    var macro = '{{format_message_variable::stat_data}}';
    var stdBlock = '---\n<status_current_variable>\n' + macro + '\n</status_current_variable>';
    if (!content || !content.trim()) return stdBlock;
    if (content.indexOf(macro) >= 0) return content; // 已含宏，无需修改
    // 修正 AI 误写的占位符（如 {{null}}、{{get_message_variable::stat_data}} 等）
    var cleaned = content.replace(/\{\{null\}\}/gi, macro)
                         .replace(/\{\{get_message_variable::stat_data\}\}/gi, macro)
                         .replace(/\{\{format_message_variable::[^}]*\}\}/gi, macro);
    if (cleaned.indexOf(macro) >= 0) return cleaned;
    // 仍未含宏：若有包裹标签则在标签内注入，否则追加标准块
    if (/<status_current_variable>[\s\S]*?<\/status_current_variable>/i.test(cleaned)) {
      cleaned = cleaned.replace(/(<status_current_variable>)([\s\S]*?)(<\/status_current_variable>)/i,
        '$1\n' + macro + '\n$3');
    } else {
      cleaned = cleaned.replace(/\s+$/, '') + '\n' + stdBlock;
    }
    return cleaned;
  }

  // ===== MVU 条目内容自动生成 =====
  // 从角色名列表自动生成 initvar YAML / 变量更新规则 / 变量输出格式 / 变量输出格式强调
  // 角色 { name, ... } 数组 → 各条目的 content 字符串

  // 生成 [initvar] 变量初始化 YAML（br 函数）
  // 格式：世界/当前时间/当前地点 + 每个角色的好感度初始值
  // 支持 _（AI不可更新）/ $（AI不可见） 前缀字段
  function generateInitVarYaml(charNames) {
    var lines = ['世界:', '  当前时间: 开局', '  当前地点: 待定', '  _当前回合: 0', '  _当前剧情日: 1'];
    (charNames || []).forEach(function(name) {
      lines.push(name + ':');
      lines.push('  好感度: 0');
      lines.push('  状态: 进行中');
    });
    return lines.join('\n');
  }

  // 生成变量列表内容（固定格式 + 可选分段 EJS 模板）
  function generateVarListContent() {
    return '---\n<status_current_variable>\n{{format_message_variable::stat_data}}\n</status_current_variable>';
  }

  // 生成变量分段 EJS 模板内容（动态根据好感度发送不同提示）
  // 通过 getvar() 读取 stat_data 变量值，按阈值切换提示词
  function generateVarSegmentedPrompt(charNames) {
    var lines = ['<% var data = getvar("stat_data") || {}; %>'];
    (charNames || []).forEach(function(name) {
      lines.push('');
      lines.push('### ' + name + ' 好感度分段');
      lines.push('<% var aff_' + name + ' = data["' + name + '"] ? data["' + name + '"].好感度 : 0; %>');
      lines.push('<% if (aff_' + name + ' >= 80) { %>');
      lines.push('- 【深爱】' + name + '视<user>为不可或缺的存在，情感深厚，行为中流露出强烈的依赖与眷恋');
      lines.push('<% } else if (aff_' + name + ' >= 50) { %>');
      lines.push('- 【好感】' + name + '对<user>有明显好感，互动中带着温柔与关注，但仍保持着适度的距离感');
      lines.push('<% } else if (aff_' + name + ' >= 20) { %>');
      lines.push('- 【熟识】' + name + '与<user>相识，互动自然，态度友好但尚未涉及情感层面');
      lines.push('<% } else { %>');
      lines.push('- 【陌生】' + name + '与<user>接触较少，关系尚浅，互动以礼貌和客气为主');
      lines.push('<% } %>');
    });
    lines.push('');
    lines.push('### 世界状态');
    lines.push('<% if (getvar("stat_data.世界._当前剧情日") >= 3) { %>');
    lines.push('- 【剧情已推进】当前故事已开展多日，角色关系与局势应有所变化');
    lines.push('<% } else { %>');
    lines.push('- 【开局阶段】故事刚刚开始，世界与角色关系处于初始状态');
    lines.push('<% } %>');
    return lines.join('\n');
  }

  // 生成变量更新规则内容（xr 函数）
  // 含 type/range/check，好感度增幅上限（单次+1，同日累计+5）
  // 支持 delta 操作语义（增量数值变更）
  function generateVarUpdateRule(charNames) {
    var lines = [
      '---',
      '变量更新规则:',
      '  世界:',
      '    当前时间:',
      '      type: string',
      '      check:',
      '        - 每次事件推进、休息、等待或场景切换后更新，保持时间流逝合理',
      '        - 用自然语言描述，如"清晨"、"午后"、"夜晚"、"D1 第三天 夜晚"',
      '    当前地点:',
      '      type: string',
      '      check:',
      '        - 场景发生明确移动或地点变化时更新',
      '        - 描述当前所在的具体场景位置',
      '    _当前回合:',
      '      type: number',
      '      check:',
      '        - 每轮交互后 +1，仅允许使用 delta 操作增加',
      '        - 字段以 _ 开头，AI 不得修改其值',
      '    _当前剧情日:',
      '      type: number',
      '      check:',
      '        - 每经过一次"睡觉/等待/跨日"类事件 +1',
      '        - 字段以 _ 开头，AI 不得修改其值'
    ];
    (charNames || []).forEach(function(name) {
      lines.push('  ' + name + ':');
      lines.push('    好感度:');
      lines.push('      type: number');
      lines.push('      range: 0~100');
      lines.push('      check:');
      lines.push('        - 仅当' + name + '直接感知到<user>的行为，且当前回复中有明确情感依据时才更新');
      lines.push('        - 单次互动最多 +1；没有明确正向互动时不得增加');
      lines.push('        - 同一剧情日内累计最多 +5；达到当天上限后只能持平或下降');
      lines.push('        - 下降必须有当前回复内的明确负面依据，不要为了凑更新而改动');
      lines.push('        - 优先使用 delta 操作（如 {"op":"delta","path":"/' + name + '/好感度","value": +1}）');
      lines.push('    状态:');
      lines.push('      type: string');
      lines.push('      check:');
      lines.push('        - 从"进行中/已暂停/已完成/已失败"中选择最符合当前剧情的状态');
    });
    return lines.join('\n');
  }

  // 生成变量输出格式内容
  // 含 JSON Patch RFC 6902 标准 + Analysis 思维链 + 好感度上限检查
  function generateVarOutputFormat() {
    return ['---','变量输出格式:','  rule:','    - you must output the update analysis and the actual update commands at once in the end of the next reply','    - the update commands works like the JSON Patch standard, must be a valid JSON array containing operation objects','    - supported ops: replace, delta, insert, remove, move','    - don\'t update field names starts with `_` as they are readonly','  format: |-','    <UpdateVariable>','    <Analysis>$(IN ENGLISH, no more than 80 words)','    - ${calculate time passed: ...}','    - ${decide whether dramatic updates are allowed as it is in a special case or the time passed is more than usual: yes/no}','    - ${check affection caps: every single interaction may increase at most +1, and the same in-story day may increase at most +5}','    - ${analyze every variable based on its corresponding check, according only to current reply: ...}','    </Analysis>','    <JSONPatch>','    [','      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },','      { "op": "delta", "path": "${/path/to/number/variable}", "value": "${positive_or_negative_delta}" },','      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },','      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },','      { "op": "remove", "path": "${/path/to/object/key}" },','      { "op": "remove", "path": "${/path/to/array/0}" },','      { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" }','    ]','    </JSONPatch>','    </UpdateVariable>'].join('\n');
  }

  // 生成变量输出格式强调内容
  // 默认关闭（enabled=false），AI不输出<UpdateVariable>时才启用
  function generateVarOutputEmphasis() {
    return ['---','变量输出格式强调:','  rule: The following must be inserted to the end of reply, and cannot be omitted','  format: |-','    <UpdateVariable>','    ...','    </UpdateVariable>'].join('\n');
  }

  // ===== 从角色卡数据提取角色名列表 =====
  // 优先从 [InitVar] 条目中解析角色名，回退到角色卡描述中正则提取
  function extractCharNames(cd, rawEntries) {
    var names = [];
    // 1. 从 [InitVar] 条目解析
    if (rawEntries && rawEntries.length) {
      for (var j = 0; j < rawEntries.length; j++) {
        var entry = rawEntries[j];
        var c = (entry.comment || '').toLowerCase();
        if (c.indexOf('[initvar]') >= 0) {
          var content = entry.content || '';
          // 解析 YAML 格式：找到 "角色名:" 形式的行
          var lines = content.split('\n');
          for (var k = 0; k < lines.length; k++) {
            var line = lines[k].trim();
            // 匹配以冒号结尾的行（非世界/非缩进行）
            if (/^[\u4e00-\u9fff\w]+:\s*$/.test(line) && line.indexOf('世界:') < 0) {
              var nm = line.replace(/:$/, '').trim();
              if (nm && nm !== '世界' && names.indexOf(nm) < 0) names.push(nm);
            }
          }
          break;
        }
      }
    }
    // 2. 回退：从角色卡名称和描述中提取
    if (names.length === 0 && cd) {
      if (cd.name && cd.name !== '未命名世界') names.push(cd.name);
      // 从描述中提取角色名（常见格式："角色名：描述" 或 "角色名, 角色名"）
      if (cd.description) {
        var desc = cd.description;
        var nameMatches = desc.match(/[\u4e00-\u9fff]{2,4}(?=对主角|对<user>|的依存|的好感|暗恋|喜欢|依恋)/g);
        if (nameMatches) {
          for (var m = 0; m < nameMatches.length; m++) {
            if (names.indexOf(nameMatches[m]) < 0) names.push(nameMatches[m]);
          }
        }
      }
    }
    // 3. 默认：如果只有主角自己
    if (names.length === 0) names.push('主角');
    return names.slice(0, 5); // 最多5个角色
  }

  // ===== 生成完整角色卡 =====
  function buildExportCard(cd) {
    // 兼容 V3 格式：条目和扩展可能在 data 对象内
    var v3Data = cd.data || {};
    var rawEntries = (cd.character_book && cd.character_book.entries) || (v3Data.character_book && v3Data.character_book.entries) || [];
    var rawExtensions = cd.extensions || v3Data.extensions || {};
    // 从角色卡数据提取角色名列表，用于 MVU 条目内容自动生成
    var charNames = extractCharNames(cd, rawEntries);
    // ===== 预填充：自动填充 MVU 条目空内容（独立步骤，确保检测和schema生成使用填充后的数据）=====
    var filledEntries = rawEntries.map(function(e, i) {
      var comment = e.comment || ('条目' + (i + 1));
      var commentLower = comment.toLowerCase();
      var isInitVar = commentLower.indexOf('[initvar]') >= 0;
      var isVarList = comment.indexOf('变量列表') >= 0;
      var isVarSegmented = comment.indexOf('变量分段') >= 0 || comment.indexOf('分段提示') >= 0 || comment.indexOf('EJS') >= 0;
      var isVarRule = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量更新规则') >= 0;
      var isVarFormat = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式') >= 0 && comment.indexOf('强调') < 0;
      var isVarFormatEmphasis = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式强调') >= 0;
      var outContent = e.content || '';
      if (!outContent || outContent.trim() === '') {
        if (isInitVar) outContent = generateInitVarYaml(charNames);
        else if (isVarList) outContent = generateVarListContent();
        else if (isVarSegmented) outContent = generateVarSegmentedPrompt(charNames);
        else if (isVarRule) outContent = generateVarUpdateRule(charNames);
        else if (isVarFormat) outContent = generateVarOutputFormat();
        else if (isVarFormatEmphasis) outContent = generateVarOutputEmphasis();
      } else if (isVarList) {
        outContent = normalizeVarListContent(outContent);
      }
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || [],
        comment: comment,
        content: outContent,
        constant: e.constant,
        selective: e.selective,
        insertion_order: e.insertion_order,
        enabled: e.enabled,
        position: e.position,
        use_regex: e.use_regex,
        extensions: e.extensions || {}
      };
    });
    // ===== 预填充结束 =====
    var entries = filledEntries.map(function(e, i) {
      var comment = e.comment || ('条目' + (i + 1));
      var tmpl = getEntryTemplate(comment);
      var isConst = tmpl ? tmpl.constant : false;
      var isSel = tmpl ? tmpl.selective : true;
      var pos = tmpl ? tmpl.position : 4;
      var depth = tmpl ? tmpl.depth : 4;
      var order = tmpl ? tmpl.order : 100;
      var defaultGroup = tmpl ? tmpl.group : '';
      var defaultSticky = tmpl ? (tmpl.sticky || 0) : 0;
      var defaultCD = tmpl ? tmpl.cooldown : 0;
      var defaultProb = tmpl ? tmpl.probability : 100;
      var defaultSL = tmpl ? tmpl.selectiveLogic : 0;
      var defaultPR = tmpl ? tmpl.prevent_recursion : false;
      var defaultER = tmpl ? tmpl.exclude_recursion : false;
      var defaultDUR = tmpl ? !!tmpl.delay_until_recursion : false;
      var defaultUseProb = tmpl ? tmpl.useProbability : false;
      var defaultScanDepth = tmpl ? tmpl.scan_depth : null;
      var defaultEnabled = tmpl && tmpl.enabled !== undefined ? tmpl.enabled : true;
      var ext = e.extensions || {};
      var rawPos = ext.position !== undefined ? ext.position : pos;
      var posNum = typeof rawPos === 'string'
        ? (rawPos === 'before_char' || rawPos === '0' ? 0 : 1)
        : rawPos;
      // ST规范：顶层position只接受 "before_char" 或 "after_char"
      // position=0 → before_char，其他所有值 → after_char
      var topPosStr = (posNum === 0) ? 'before_char' : 'after_char';
      var roleVal = ext.role !== undefined ? ext.role : 0;
      if (typeof roleVal === 'string') {
        roleVal = roleVal.toLowerCase() === 'user' ? 1 : 0;
      }
      var useProbVal = ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : defaultUseProb);
      var groupWeightVal = ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100);
      // MVU 安全网：[initvar] 条目必须 enabled=false；变量输出格式强调 默认 enabled=false
      // 注意：空内容填充已移至预填充步骤，此处仅保留类型检测用于 enabled 逻辑
      var commentLower = comment.toLowerCase();
      var isInitVar = commentLower.indexOf('[initvar]') >= 0;
      var isVarList = comment.indexOf('变量列表') >= 0;
      var isVarSegmented = comment.indexOf('变量分段') >= 0 || comment.indexOf('分段提示') >= 0 || comment.indexOf('EJS') >= 0;
      var isVarRule = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量更新规则') >= 0;
      var isVarFormat = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式') >= 0 && comment.indexOf('强调') < 0;
      var isVarFormatEmphasis = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式强调') >= 0;
      var outContent = e.content || '';
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || (tmpl && tmpl.secondary_keys) || [],
        comment: comment,
        content: outContent,
        constant: e.constant !== undefined ? e.constant : isConst,
        selective: e.selective !== undefined ? e.selective : isSel,
        insertion_order: e.insertion_order || order,
        enabled: isInitVar ? false : (isVarFormatEmphasis ? (e.enabled !== undefined ? e.enabled : false) : (e.enabled !== undefined ? e.enabled : defaultEnabled)),
        position: topPosStr,
        use_regex: e.use_regex !== undefined ? e.use_regex : true,
        extensions: {
          position: posNum,
          exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : defaultER,
          display_index: i,
          probability: ext.probability !== undefined ? ext.probability : defaultProb,
          useProbability: useProbVal,
          depth: ext.depth !== undefined ? ext.depth : depth,
          selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : defaultSL,
          group: ext.group || defaultGroup,
          prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : defaultPR,
          scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : defaultScanDepth,
          match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
          case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
          automation_id: '',
          group_override: false,
          group_weight: groupWeightVal,
          delay_until_recursion: ext.delay_until_recursion !== undefined ? !!ext.delay_until_recursion : defaultDUR,
          use_group_scoring: false,
          role: roleVal,
          vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
          sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : 0,
          cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : 0,
          delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : 0,
          match_persona_description: ext.match_persona_description !== undefined ? ext.match_persona_description : false,
          match_character_description: ext.match_character_description !== undefined ? ext.match_character_description : false,
          match_character_personality: ext.match_character_personality !== undefined ? ext.match_character_personality : false,
          match_character_depth_prompt: ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt : false,
          match_scenario: ext.match_scenario !== undefined ? ext.match_scenario : false,
          match_creator_notes: ext.match_creator_notes !== undefined ? ext.match_creator_notes : false,
          outlet_name: '',
          triggers: [],
          ignore_budget: false
        }
      };
    });
    // ST规范：换行符统一使用 \r\n
    var toCRLF = function(str) {
      if (!str) return str;
      return str.replace(/\r?\n/g, '\r\n');
    };
    // normalizeRegexScripts 已提取为外层共享函数（导入/导出共用）
    var cardName = cd.name || '未命名世界';
    var cardDesc = cd.description || '';
    // 检测是否包含MVU核心条目（至少 [initvar] + 变量列表/更新规则/输出格式 之一即视为MVU系统）
    // 使用预填充后的 filledEntries 进行检测，确保 InitVar 等条目已含自动生成的内容
    var hasInitVar = filledEntries.some(function(e) { return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0; });
    var hasVarList = filledEntries.some(function(e) { return (e.comment || '').indexOf('变量列表') >= 0; });
    var hasVarUpdate = filledEntries.some(function(e) { return (e.comment || '').toLowerCase().indexOf('[mvu_update]') >= 0 || (e.comment || '').indexOf('变量更新规则') >= 0; });
    var hasVarFormat = filledEntries.some(function(e) { return (e.comment || '').indexOf('变量输出格式') >= 0; });
    var hasVarSegmented = filledEntries.some(function(e) { return (e.comment || '').indexOf('变量分段') >= 0 || (e.comment || '').indexOf('分段提示') >= 0 || (e.comment || '').toLowerCase().indexOf('ejs') >= 0; });
    var hasMVUEntries = !!(hasInitVar && (hasVarList || hasVarUpdate || hasVarFormat || hasVarSegmented));
    // 宽泛匹配：只要存在任意 MVU 核心条目（即使无 [InitVar]）也视为 MVU 卡
    var hasAnyMVU = hasMVUEntries || filledEntries.some(function(e) { return isMVUEntry(e.comment || ''); });
    // 最终使用宽泛匹配结果，确保只要有任意 MVU 条目就注入脚本
    hasMVUEntries = hasMVUEntries || hasAnyMVU;
    var rawFirstMes = cd.first_mes || '';
    // MVU 卡的开场白必须含 <StatusPlaceHolderImpl/>（即使 first_mes 为空也追加，保证状态栏正常显示）
    if (hasMVUEntries && rawFirstMes.indexOf('<StatusPlaceHolderImpl') < 0) {
      rawFirstMes = rawFirstMes.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
    }
    var cardFirstMes = toCRLF(rawFirstMes);
    var cardMesExample = toCRLF(cd.mes_example || '');
    var cardAltGreetings = (cd.alternate_greetings || []).map(function(g) {
      var greeting = toCRLF(g);
      // MVU开局变量初始化：在alternate_greetings中保留<UpdateVariable>段（覆盖[InitVar]默认值）
      // 同时确保每个alt greeting也含<StatusPlaceHolderImpl/>占位符
      if (hasMVUEntries && greeting.indexOf('<StatusPlaceHolderImpl') < 0) {
        greeting = greeting.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
      }
      return greeting;
    });
    var cardPostHist = toCRLF(cd.post_history_instructions || '');
    var cardSysPrompt = toCRLF(cd.system_prompt || '');
    var cardCreatorNotes = toCRLF(cd.creator_notes || '时之写卡器创建');
    // 优先从 data.depth_prompt 读取（v3规范），回退到 extensions.depth_prompt（v2兼容）
    var depthPrompt = cd.depth_prompt ? cd.depth_prompt : (rawExtensions.depth_prompt ? rawExtensions.depth_prompt : { prompt: '', depth: 4, role: 'system' });
    // 修正 depth_prompt.role 为字符串
    if (typeof depthPrompt.role === 'number') {
      depthPrompt.role = depthPrompt.role === 1 ? 'user' : (depthPrompt.role === 2 ? 'assistant' : 'system');
    }
    if (depthPrompt.depth === undefined) depthPrompt.depth = 4;
    var cardData = {
      name: cardName,
      description: cardDesc,
      personality: cd.personality || '',
      scenario: cd.scenario || '',
      first_mes: cardFirstMes,
      mes_example: cardMesExample,
      creator_notes: cardCreatorNotes,
      system_prompt: cardSysPrompt,
      post_history_instructions: cardPostHist,
      tags: cd.tags && cd.tags.length ? cd.tags : [],
      creator: '时之写卡器',
      character_version: '',
      alternate_greetings: cardAltGreetings,
      group_only_greetings: [],
      depth_prompt: depthPrompt,
      extensions: (function() {
        // 检测是否包含MVU变量系统条目（复用前面的检测结果）
        var hasMVU = hasMVUEntries;
        var existingRx = normalizeRegexScripts(rawExtensions.regex_scripts);
        var existingScripts = (rawExtensions.tavern_helper && rawExtensions.tavern_helper.scripts) || [];
        var mvuScripts = existingScripts.slice();
        var mvuRegex = existingRx.slice();
        if (hasMVU) {
          // 自动注入MVU bundle.js脚本（如果尚未存在）
          // 使用 MVU 规范的固定UUID，确保兼容
          var hasBundle = mvuScripts.some(function(s) { return (s.content || '').indexOf('MagVarUpdate') >= 0 || (s.content || '').indexOf('bundle.js') >= 0; });
          if (!hasBundle) {
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: 'MVU',
              id: '961f366d-e403-45c2-8155-3d14ec86de53',
              content: "import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';",
              info: '',
              button: {
                enabled: true,
                buttons: [
                  { name: '重新处理变量', visible: false },
                  { name: '重新读取初始变量', visible: false },
                  { name: '快照楼层', visible: false },
                  { name: '重演楼层', visible: false },
                  { name: '重试额外模型解析', visible: false },
                  { name: '清除旧楼层变量', visible: false }
                ]
              },
              data: {}
            });
          }
          // 自动注入"变量结构"zod schema 脚本
          // 该脚本用 zod 4 定义变量结构（export const Schema），MVU 自动检测 Schema 导出并据此校验/修复变量更新
          // ===== 完整性检测：只要有 import + Schema 定义块即为完整，不强制要求 registerMvuSchema 调用 =====
          function isMvuSchemaComplete(content) {
            if (!content || typeof content !== 'string') return false;
            var hasImport = content.indexOf('tavern_resource/dist/util/mvu_zod') >= 0;
            var hasSchemaBlock = content.indexOf('z.object') >= 0 && content.indexOf('Schema') >= 0;
            return hasImport && hasSchemaBlock;
          }
          var schemaScriptIdx = -1;
          var hasSchema = mvuScripts.some(function(s, i) {
            var match = s.name === '变量结构' || (s.content || '').indexOf('mvu_zod') >= 0;
            if (match) schemaScriptIdx = i;
            return match;
          });
          var schemaInitEntry = filledEntries.filter(function(e) { return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0; })[0];
          var schemaInitContent = schemaInitEntry ? (schemaInitEntry.content || '') : '';
          if (!hasSchema) {
            // 不存在 → 生成并注入完整脚本
            var fullSchemaContent = generateMvuSchemaScript(schemaInitContent);
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: '变量结构',
              id: 'mvu-schema',
              content: fullSchemaContent,
              info: '自动生成的 MVU 变量结构脚本。',
              button: { enabled: true, buttons: [] },
              data: {}
            });
          } else if (schemaScriptIdx >= 0 && !isMvuSchemaComplete(mvuScripts[schemaScriptIdx].content)) {
            // 脚本存在但不完整（缺import或Schema定义）→ 重新生成
            mvuScripts[schemaScriptIdx].content = generateMvuSchemaScript(schemaInitContent);
          }
          // 自动注入"世界书调用"(WTC) 脚本
          // 用途：将世界书内容用 <observed_piece class="剧情/设定"> 标签包裹，让 AI 区分剧情推进和设定信息
          // 这有助于 AI 在变量更新时正确识别哪些是世界书设定、哪些是当前剧情
          var hasWTC = mvuScripts.some(function(s) { return (s.content || '').indexOf('LorebookToolCall') >= 0 || (s.content || '').indexOf('wtc') >= 0; });
          if (!hasWTC) {
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: '世界书调用',
              id: 'wtc-lorebook-call',
              content: 'https://cdn.jsdelivr.net/gh/MagicalAstrogy/LorebookToolCall/dist/wtc/index.js',
              info: '世界书调用脚本：用 <observed_piece> 标签包裹世界书内容，区分剧情与设定。',
              button: { enabled: true, buttons: [] },
              data: {}
            });
          }
          // 自动注入MVU必备正则脚本（6条）
          // 正则1：仅格式思维链 - 从提示词中移除<Analysis>段（AI思维链不需要重复发送）
          var hasAnalysisRegex = mvuRegex.some(function(r) { return (r.findRegex || '').indexOf('Analysis') >= 0 && r.promptOnly; });
          if (!hasAnalysisRegex) {
            mvuRegex.push({
              id: 'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36',
              scriptName: '仅格式思维链',
              findRegex: '/<Analysis>[\\s\\S]+?<\\/Analysis>/gm',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则2：只发送最新2楼的变量更新 - 从提示词移除旧UpdateVariable段（minDepth=4保留最近2楼）
          var hasUpdateVarPromptRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.promptOnly;
          });
          if (!hasUpdateVarPromptRegex) {
            mvuRegex.push({
              id: '5bb4b588-23ca-4564-8df5-882104eff764',
              scriptName: '只发送最新2楼的变量更新',
              findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: 4,
              maxDepth: null
            });
          }
          // 正则3：[美化]变量完成 - 美化已完成的UpdateVariable显示（markdownOnly）
          var hasBeautifyCompleteRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.markdownOnly && !r.promptOnly && (r.replaceString || '').indexOf('mvu-done') >= 0;
          });
          if (!hasBeautifyCompleteRegex) {
            mvuRegex.push({
              id: '6fb572ae-a9ea-436d-9779-ad100f1ff7f5',
              scriptName: '[美化]变量完成',
              findRegex: '/<UpdateVariable(?:variable)?>\\s*(.*)\\s*<\\/UpdateVariable(?:variable)?>/gsi',
              replaceString: MVU_BEAUTIFY_COMPLETE,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: false,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则4：[美化]变量更新中 - 美化流式输出中的UpdateVariable显示
          var hasBeautifyThinkingRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.markdownOnly && !r.promptOnly && (r.replaceString || '').indexOf('mvu-thinking') >= 0;
          });
          if (!hasBeautifyThinkingRegex) {
            mvuRegex.push({
              id: 'bf1b7441-5cf1-426d-bd6c-911332be9923',
              scriptName: '[美化]变量更新中',
              findRegex: '/<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$/gsi',
              replaceString: MVU_BEAUTIFY_THINKING,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: false,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则5：[不发送]隐藏状态栏标记 - 从提示词移除 <StatusPlaceHolderImpl/>（AI不需要看到占位符）
          var hasHidePlaceholderRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('StatusPlaceHolderImpl') >= 0 && r.promptOnly && !r.markdownOnly;
          });
          if (!hasHidePlaceholderRegex) {
            mvuRegex.push({
              id: 'mvu-status-hide',
              scriptName: '[不发送]隐藏状态栏标记',
              findRegex: '/<StatusPlaceHolderImpl\\/>/g',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则6：[美化]MVU状态栏 - 将 <StatusPlaceHolderImpl/> 替换为状态栏HTML（仅格式显示）
          // 检测AI是否已生成美化状态栏正则（findRegex含StatusPlaceHolderImpl + markdownOnly + 非promptOnly）
          var hasStatusBarRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('StatusPlaceHolderImpl') >= 0 && r.markdownOnly && !r.promptOnly;
          });
          if (!hasStatusBarRegex) {
            // AI未生成时回退：用 ```html 代码块包裹默认状态栏HTML
            var statusBarReplace = '```html\n' + MVU_STATUS_BAR_HTML + '\n```';
            mvuRegex.push({
              id: 'mvu-status-bar',
              scriptName: '[美化]MVU状态栏',
              findRegex: '/<StatusPlaceHolderImpl\\/>/g',
              replaceString: statusBarReplace,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
        }
        return {
          talkativeness: '0.5',
          fav: false,
          world: cardName,
          depth_prompt: depthPrompt,
          regex_scripts: mvuRegex,
          'xiaobaix-template': {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: { scripts: mvuScripts, variables: {} }
        };
      })(),
      character_book: {
        name: cardName,
        entries: entries
      }
    };
    // ST规范：顶层需要重复 data 中的关键字段（v3格式顶层用 creatorcomment，data内沿用 creator_notes）
    return {
      name: cardName,
      description: cardDesc,
      personality: cd.personality || '',
      scenario: cd.scenario || '',
      first_mes: cardFirstMes,
      mes_example: cardMesExample,
      creatorcomment: cardCreatorNotes,
      avatar: 'none',
      talkativeness: '0.5',
      fav: false,
      tags: cd.tags && cd.tags.length ? cd.tags : [],
      create_date: new Date().toISOString(),
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: cardData
    };
  }

  // ============================================================
  //  悬浮工具条 UI（极简可展开 · 自动启动 · 实时监听 ST 聊天完善角色卡）
  //  - 折叠态：右下角小圆形 FAB（带完成度徽标）
  //  - 展开态：可拖拽面板（状态条 + 角色卡预览 + 预设开关 + 操作按钮）
  //  - 聊天直接在 SillyTavern 里进行，工具条后台自动提取 AI 消息中的角色卡 JSON
  // ============================================================
  var _toolbar = null;            // {container, fab, badge, panel}
  var _cardData = null;           // 角色卡数据
  var _chatMsgCount = 0;          // 已监听消息数
  var _autoSync = true;           // 自动同步开关
  var _expanded = false;          // 展开/折叠状态
  var _lastProcessedMsgId = -1;   // 已处理的最大消息ID（去重用）
  var _listenersRegistered = false;
  var _presetPromptToggle = null; // 预设开关函数引用

  var BUTTON_NAME = '时之写卡器';

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parentDoc() {
    try { return (window.parent && window.parent.document) ? window.parent.document : document; }
    catch (_) { return document; }
  }

  function parentWin(name) {
    try { if (window.parent && window.parent[name]) return window.parent[name]; } catch (_) {}
    return window[name];
  }

  function initCardData() {
    _cardData = {
      name: '', description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', creator_notes: '', system_prompt: '',
      post_history_instructions: '', tags: [], creator: '时之写卡器',
      character_version: '', alternate_greetings: [], group_only_greetings: [],
      extensions: {
        talkativeness: '0.5',
        fav: false,
        world: '',
        depth_prompt: { prompt: '', depth: 4, role: 'system' },
        regex_scripts: [],
        'xiaobaix-template': {
          enabled: false, template: '', customRegex: '',
          disableParsers: false, skipFirstMessage: false,
          recentMessageCount: 0, limitToRecentMessages: false
        },
        tavern_helper: { scripts: [], variables: {} }
      },
      character_book: { entries: [] }
    };
    _lastProcessedMsgId = -1;
    _chatMsgCount = 0;
  }

  // ===== 样式注入（一次性，紧凑现代风） =====
  function injectStyles() {
    var doc = parentDoc();
    var styleId = SCRIPT_ID + '-styles';
    if (doc.getElementById(styleId)) return;
    var css = ''
      + '#' + SCRIPT_ID + '-toolbar *{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}'
      // 容器：固定右下角
      + '#' + SCRIPT_ID + '-toolbar{position:fixed;bottom:24px;right:24px;z-index:999999}'
      // 折叠态 FAB：圆形渐变按钮
      + '#' + SCRIPT_ID + '-toolbar .cm-fab{position:relative;width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;font-size:24px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(124,58,237,.45);transition:transform .25s ease,box-shadow .25s ease}'
      + '#' + SCRIPT_ID + '-toolbar .cm-fab:hover{transform:scale(1.08);box-shadow:0 10px 30px rgba(124,58,237,.6)}'
      + '#' + SCRIPT_ID + '-toolbar .cm-fab.active{transform:scale(0.92)}'
      // FAB 完成度徽标
      + '#' + SCRIPT_ID + '-toolbar .cm-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#22c55e;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #0d1117;line-height:1}'
      + '#' + SCRIPT_ID + '-toolbar .cm-badge.zero{background:#6b7280}'
      // FAB 同步状态点
      + '#' + SCRIPT_ID + '-toolbar .cm-dot{position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 2px rgba(13,17,23,.8)}'
      + '#' + SCRIPT_ID + '-toolbar .cm-dot.off{background:#6b7280}'
      // 展开态面板
      + '#' + SCRIPT_ID + '-toolbar .cm-panel{position:absolute;bottom:64px;right:0;width:340px;max-height:560px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;animation:cmPop .22s ease-out}'
      + '#' + SCRIPT_ID + '-toolbar .cm-panel.show{display:flex}'
      + '@keyframes cmPop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}'
      // 标题栏（可拖拽）
      + '#' + SCRIPT_ID + '-toolbar .cm-title{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#ec4899);cursor:move;user-select:none;font-weight:600;font-size:14px;color:#fff}'
      + '#' + SCRIPT_ID + '-toolbar .cm-title .cm-title-btns{display:flex;gap:6px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-title .cm-title-btns button{width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;background:rgba(255,255,255,.18);color:#fff;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background .15s}'
      + '#' + SCRIPT_ID + '-toolbar .cm-title .cm-title-btns button:hover{background:rgba(255,255,255,.32)}'
      // 主体
      + '#' + SCRIPT_ID + '-toolbar .cm-body{overflow-y:auto;padding:12px 14px;flex:1}'
      + '#' + SCRIPT_ID + '-toolbar .cm-body::-webkit-scrollbar{width:6px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-body::-webkit-scrollbar-track{background:transparent}'
      + '#' + SCRIPT_ID + '-toolbar .cm-body::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-body::-webkit-scrollbar-thumb:hover{background:#484f58}'
      // 状态条（紧凑横排）
      + '#' + SCRIPT_ID + '-toolbar .cm-status{display:flex;align-items:center;gap:8px;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:8px 10px;margin-bottom:10px;font-size:12px;flex-wrap:wrap}'
      + '#' + SCRIPT_ID + '-toolbar .cm-status .cm-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:#21262d;color:#c9d1d9}'
      + '#' + SCRIPT_ID + '-toolbar .cm-status .cm-chip b{color:#58a6ff;font-weight:600}'
      + '#' + SCRIPT_ID + '-toolbar .cm-status .cm-sync-btn{margin-left:auto;padding:3px 8px;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:#fff}'
      + '#' + SCRIPT_ID + '-toolbar .cm-status .cm-sync-btn.on{background:#238636}'
      + '#' + SCRIPT_ID + '-toolbar .cm-status .cm-sync-btn.off{background:#6b7280}'
      // 进度条
      + '#' + SCRIPT_ID + '-toolbar .cm-progress{height:5px;background:#21262d;border-radius:3px;overflow:hidden;margin-bottom:10px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-progress > div{height:100%;background:linear-gradient(90deg,#7c3aed,#ec4899);transition:width .35s ease;border-radius:3px}'
      // 折叠区段
      + '#' + SCRIPT_ID + '-toolbar .cm-section{border:1px solid #30363d;border-radius:10px;margin-bottom:10px;overflow:hidden;background:#0d1117}'
      + '#' + SCRIPT_ID + '-toolbar .cm-section .cm-hd{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#161b22;cursor:pointer;font-size:13px;font-weight:600;user-select:none;color:#e6edf3}'
      + '#' + SCRIPT_ID + '-toolbar .cm-section .cm-hd:hover{background:#1c2230}'
      + '#' + SCRIPT_ID + '-toolbar .cm-section .cm-hd .cm-arrow{transition:transform .2s;color:#8b949e;font-size:11px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-section.open .cm-hd .cm-arrow{transform:rotate(90deg)}'
      + '#' + SCRIPT_ID + '-toolbar .cm-section .cm-bd{padding:8px 12px;font-size:12px;display:none}'
      + '#' + SCRIPT_ID + '-toolbar .cm-section.open .cm-bd{display:block}'
      // 字段列表
      + '#' + SCRIPT_ID + '-toolbar .cm-field{display:flex;justify-content:space-between;align-items:center;padding:4px 0}'
      + '#' + SCRIPT_ID + '-toolbar .cm-field .cm-nm{color:#c9d1d9}'
      + '#' + SCRIPT_ID + '-toolbar .cm-field .cm-ok{color:#3fb950;font-weight:700}'
      + '#' + SCRIPT_ID + '-toolbar .cm-field .cm-no{color:#484f58}'
      // 预设分组
      + '#' + SCRIPT_ID + '-toolbar .cm-group{color:#8b949e;font-size:11px;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}'
      + '#' + SCRIPT_ID + '-toolbar .cm-group:first-child{margin-top:0}'
      + '#' + SCRIPT_ID + '-toolbar .cm-preset-item{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #21262d;gap:8px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-preset-item:last-child{border-bottom:none}'
      + '#' + SCRIPT_ID + '-toolbar .cm-preset-item .cm-nm{color:#c9d1d9;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '#' + SCRIPT_ID + '-toolbar .cm-toggle{position:relative;width:32px;height:18px;background:#30363d;border-radius:9px;cursor:pointer;transition:background .2s;flex-shrink:0}'
      + '#' + SCRIPT_ID + '-toolbar .cm-toggle.on{background:#3fb950}'
      + '#' + SCRIPT_ID + '-toolbar .cm-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:transform .2s}'
      + '#' + SCRIPT_ID + '-toolbar .cm-toggle.on::after{transform:translateX(14px)}'
      // 操作按钮
      + '#' + SCRIPT_ID + '-toolbar .cm-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}'
      + '#' + SCRIPT_ID + '-toolbar .cm-actions button{padding:9px;border:none;border-radius:8px;cursor:pointer;background:#21262d;color:#c9d1d9;font-size:12px;font-weight:600;transition:background .15s,transform .1s}'
      + '#' + SCRIPT_ID + '-toolbar .cm-actions button:hover{background:#30363d}'
      + '#' + SCRIPT_ID + '-toolbar .cm-actions button:active{transform:scale(.97)}'
      + '#' + SCRIPT_ID + '-toolbar .cm-actions button.primary{background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff}'
      + '#' + SCRIPT_ID + '-toolbar .cm-actions button.danger{background:#da3633;color:#fff}'
      + '#' + SCRIPT_ID + '-toolbar .cm-actions button.danger:hover{background:#f85149}'
      // 空状态提示
      + '#' + SCRIPT_ID + '-toolbar .cm-empty{color:#6e7681;font-size:12px;padding:8px 0;text-align:center;line-height:1.6}'
      ;
    var st = doc.createElement('style');
    st.id = styleId;
    st.textContent = css;
    doc.head.appendChild(st);
  }

  function calcCompletion() {
    if (!_cardData) return { done: 0, total: 9, pct: 0 };
    var fields = ['name', 'description', 'first_mes', 'personality', 'scenario', 'mes_example', 'system_prompt', 'post_history_instructions'];
    var done = 0;
    fields.forEach(function (f) { if ((_cardData[f] || '').toString().trim()) done++; });
    var entries = (_cardData.character_book && _cardData.character_book.entries) || [];
    if (entries.length > 0) done++;
    return { done: done, total: 9, pct: (done / 9) * 100 };
  }

  // ===== 各区块 HTML 渲染 =====
  function renderStatusHtml(charName, completion) {
    var pct = Math.round(completion.pct);
    var syncCls = _autoSync ? 'on' : 'off';
    var syncTxt = _autoSync ? '同步中' : '已暂停';
    return ''
      + '<div class="cm-status">'
      + '<span class="cm-chip">👤 <b>' + escHtml(charName || '未选择') + '</b></span>'
      + '<span class="cm-chip">💬 <b>' + _chatMsgCount + '</b></span>'
      + '<span class="cm-chip">📊 <b>' + pct + '%</b></span>'
      + '<button class="cm-sync-btn ' + syncCls + '" data-act="sync">' + syncTxt + '</button>'
      + '</div>'
      + '<div class="cm-progress"><div style="width:' + pct + '%"></div></div>';
  }

  function renderCardPreviewHtml() {
    var cd = _cardData || {};
    var entries = (cd.character_book && cd.character_book.entries) || [];
    function hasStr(s) { return !!(s && s.toString().trim()); }
    function chk(ok) { return ok ? '<span class="cm-ok">✓</span>' : '<span class="cm-no">○</span>'; }
    var rows = [
      ['name', hasStr(cd.name)],
      ['description', hasStr(cd.description)],
      ['first_mes', hasStr(cd.first_mes)],
      ['personality', hasStr(cd.personality)],
      ['scenario', hasStr(cd.scenario)],
      ['mes_example', hasStr(cd.mes_example)],
      ['system_prompt', hasStr(cd.system_prompt)],
      ['post_history', hasStr(cd.post_history_instructions)],
      ['世界书(' + entries.length + ')', entries.length > 0]
    ];
    var body = rows.map(function (r) {
      return '<div class="cm-field"><span class="cm-nm">' + escHtml(r[0]) + '</span>' + chk(r[1]) + '</div>';
    }).join('');
    return ''
      + '<div class="cm-section open">'
      + '<div class="cm-hd"><span>📋 角色卡预览</span><span class="cm-arrow">▶</span></div>'
      + '<div class="cm-bd">' + body + '</div>'
      + '</div>';
  }

  function renderPresetHtml() {
    var preset = fetchPreset();
    var prompts = (preset && preset.prompts) ? classifyPromptsBySection(preset.prompts) : [];
    var groups = { aux: [], worldinfo: [], general: [], mvu: [] };
    prompts.forEach(function (p) { if (groups[p.section]) groups[p.section].push(p); });
    var order = ['aux', 'worldinfo', 'general', 'mvu'];
    var body = '';
    order.forEach(function (sec) {
      if (!groups[sec].length) return;
      body += '<div class="cm-group">' + escHtml(SECTION_LABELS[sec] || sec) + '</div>';
      groups[sec].forEach(function (p) {
        var cls = 'cm-toggle' + (p.enabled ? ' on' : '');
        body += '<div class="cm-preset-item">'
          + '<span class="cm-nm" title="' + escHtml(p.name) + '">' + escHtml(p.displayName || p.name) + '</span>'
          + '<div class="' + cls + '" data-name="' + escHtml(p.name) + '"></div>'
          + '</div>';
      });
    });
    if (!body) body = '<div class="cm-empty">未检测到预设提示词<br>请先在 ST 中导入写卡预设</div>';
    return ''
      + '<div class="cm-section">'
      + '<div class="cm-hd"><span>⚙️ 预设开关</span><span class="cm-arrow">▶</span></div>'
      + '<div class="cm-bd">' + body + '</div>'
      + '</div>';
  }

  function renderActionsHtml() {
    return ''
      + '<div class="cm-actions">'
      + '<button class="primary" data-act="export">⬇ 导出角色卡</button>'
      + '<button data-act="import">⬆ 导入角色卡</button>'
      + '<button data-act="clear" class="danger">🗑 清空数据</button>'
      + '<button data-act="refresh">↻ 刷新数据</button>'
      + '</div>';
  }

  function renderPanel() {
    if (!_toolbar) return;
    var p = _toolbar.panel;
    var charName = fetchCurrentCharName();
    var completion = calcCompletion();
    var html = ''
      + '<div class="cm-title">'
      + '<span>⚡ 时之写卡器</span>'
      + '<div class="cm-title-btns">'
      + '<button data-act="collapse" title="收起">−</button>'
      + '<button data-act="close" title="关闭">×</button>'
      + '</div>'
      + '</div>'
      + '<div class="cm-body">'
      + renderStatusHtml(charName, completion)
      + renderCardPreviewHtml()
      + renderPresetHtml()
      + renderActionsHtml()
      + '</div>';
    p.innerHTML = html;
    wirePanelEvents();
  }

  function wirePanelEvents() {
    if (!_toolbar) return;
    var p = _toolbar.panel;
    var collapseBtn = p.querySelector('[data-act="collapse"]');
    if (collapseBtn) collapseBtn.onclick = function () { setExpanded(false); };
    var closeBtn = p.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.onclick = function () { setExpanded(false); showToast('工具条已收起，聊天仍会自动同步'); };

    var heads = p.querySelectorAll('.cm-section > .cm-hd');
    Array.prototype.forEach.call(heads, function (h) {
      h.onclick = function () { h.parentElement.classList.toggle('open'); };
    });

    var toggles = p.querySelectorAll('.cm-toggle');
    Array.prototype.forEach.call(toggles, function (t) {
      t.onclick = function () {
        var name = t.getAttribute('data-name');
        if (!name) return;
        showToast('切换中...', 'info');
        togglePresetPrompt(name).then(function () { refreshPanel(); }).catch(function(){ refreshPanel(); });
      };
    });

    var exportBtn = p.querySelector('[data-act="export"]');
    if (exportBtn) exportBtn.onclick = exportCard;
    var importBtn = p.querySelector('[data-act="import"]');
    if (importBtn) importBtn.onclick = triggerImport;
    var clearBtn = p.querySelector('[data-act="clear"]');
    if (clearBtn) clearBtn.onclick = function () {
      if (confirm('确认清空当前角色卡数据？')) {
        initCardData();
        refreshPanel();
        updateBadge();
        showToast('数据已清空');
      }
    };
    var refreshBtn = p.querySelector('[data-act="refresh"]');
    if (refreshBtn) refreshBtn.onclick = function () {
      autoExtractFromChat(true);
      refreshPanel();
      showToast('已刷新');
    };
    var syncBtn = p.querySelector('[data-act="sync"]');
    if (syncBtn) syncBtn.onclick = function () {
      _autoSync = !_autoSync;
      refreshPanel();
      updateDot();
      showToast('自动同步已' + (_autoSync ? '开启' : '暂停'));
    };
  }

  function refreshPanel() {
    if (_toolbar && _expanded) renderPanel();
    updateBadge();
  }

  function updateBadge() {
    if (!_toolbar || !_toolbar.badge) return;
    var c = calcCompletion();
    var pct = Math.round(c.pct);
    _toolbar.badge.textContent = pct + '%';
    if (pct === 0) _toolbar.badge.classList.add('zero');
    else _toolbar.badge.classList.remove('zero');
  }

  function updateDot() {
    if (!_toolbar || !_toolbar.dot) return;
    if (_autoSync) _toolbar.dot.classList.remove('off');
    else _toolbar.dot.classList.add('off');
  }

  function setExpanded(expanded) {
    _expanded = expanded;
    if (!_toolbar) {
      if (expanded) createToolbar();
      return;
    }
    if (expanded) {
      _toolbar.panel.classList.add('show');
      _toolbar.fab.classList.add('active');
      renderPanel();
    } else {
      _toolbar.panel.classList.remove('show');
      _toolbar.fab.classList.remove('active');
    }
  }

  function makeDraggable() {
    if (!_toolbar) return;
    var doc = parentDoc();
    var title = _toolbar.panel.querySelector('.cm-title');
    if (!title) return;
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    var onDown = function (e) {
      var tgt = e.target;
      var isButton = !!tgt && (tgt.tagName === 'BUTTON' || (typeof tgt.closest === 'function' && !!tgt.closest('button')));
      if (isButton) return;
      dragging = true;
      var t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY;
      var rect = _toolbar.container.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      e.preventDefault();
    };
    var onMove = function (e) {
      if (!dragging) return;
      var t = e.touches ? e.touches[0] : e;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      _toolbar.container.style.left = (ox + dx) + 'px';
      _toolbar.container.style.top = (oy + dy) + 'px';
      _toolbar.container.style.right = 'auto';
      _toolbar.container.style.bottom = 'auto';
    };
    var onUp = function () { dragging = false; };
    title.addEventListener('mousedown', onDown);
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
    title.addEventListener('touchstart', onDown, { passive: false });
    doc.addEventListener('touchmove', onMove, { passive: false });
    doc.addEventListener('touchend', onUp);
  }

  // 创建悬浮工具条（FAB + 面板），自动注入 parent.document
  function createToolbar() {
    if (_toolbar) { setExpanded(true); return; }
    if (!_cardData) initCardData();
    var doc = parentDoc();
    injectStyles();
    var container = doc.createElement('div');
    container.id = SCRIPT_ID + '-toolbar';

    // 折叠态：圆形 FAB + 完成度徽标 + 同步状态点
    var fab = doc.createElement('button');
    fab.className = 'cm-fab';
    fab.title = '时之写卡器 · 点击展开';
    fab.textContent = '⚡';
    var badge = doc.createElement('span');
    badge.className = 'cm-badge zero';
    badge.textContent = '0%';
    var dot = doc.createElement('span');
    dot.className = 'cm-dot';
    fab.appendChild(badge);
    fab.appendChild(dot);
    fab.onclick = function () { setExpanded(!_expanded); };

    // 展开态面板
    var panel = doc.createElement('div');
    panel.className = 'cm-panel';
    container.appendChild(fab);
    container.appendChild(panel);
    doc.body.appendChild(container);

    _toolbar = { container: container, fab: fab, badge: badge, dot: dot, panel: panel };
    makeDraggable();
    updateBadge();
    updateDot();
    setExpanded(true);

    // 启动聊天监听（仅一次）
    if (!_listenersRegistered) {
      registerChatListeners(function () { autoExtractFromChat(); });
      _listenersRegistered = true;
    }
    // 首次拉取一次历史消息
    setTimeout(function () { autoExtractFromChat(true); }, 300);
  }

  function removeToolbar() {
    if (_toolbar) {
      try { _toolbar.container.remove(); } catch (_) {}
      _toolbar = null;
    }
    _expanded = false;
  }

  // 从聊天消息中提取 ```json ... ``` 代码块
  function extractJsonBlocks(text) {
    var blocks = [];
    if (!text) return blocks;
    var re = /```(?:json)?\s*([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      blocks.push(m[1].trim());
    }
    if (!blocks.length) {
      var t = text.trim();
      if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') blocks.push(t);
    }
    return blocks;
  }

  // 自动提取角色卡：拉取最近消息，解析 AI 消息中的 JSON，合并到 _cardData
  // force=true 时无视 _autoSync，强制扫描一次（用于首次加载/手动刷新）
  function autoExtractFromChat(force) {
    if (!force && !_autoSync) return;
    if (!_cardData) initCardData();
    try {
      var msgs = fetchChatMessages();
      if (!msgs.length) return;
      var newMsgs = [];
      var maxId = _lastProcessedMsgId;
      // force 模式：扫描所有未处理消息（重置 _lastProcessedMsgId 后全扫）
      var scanFromId = force ? -1 : _lastProcessedMsgId;
      msgs.forEach(function (m) {
        if (m.messageId > scanFromId) {
          newMsgs.push(m);
          if (m.messageId > maxId) maxId = m.messageId;
        }
      });
      if (!newMsgs.length) { refreshPanel(); return; }
      var merged = false;
      newMsgs.forEach(function (m) {
        if (m.role === 'user') return;
        var blocks = extractJsonBlocks(m.content);
        blocks.forEach(function (b) {
          try {
            var obj = JSON.parse(b);
            if (mergePartial(obj, _cardData)) merged = true;
          } catch (_) {}
        });
      });
      _lastProcessedMsgId = maxId;
      _chatMsgCount = msgs.length;
      if (merged || force) refreshPanel();
    } catch (e) { console.warn('[时之写卡器] autoExtractFromChat failed:', e); }
  }

  function exportCard() {
    if (!_cardData) initCardData();
    try {
      var card = buildExportCard(_cardData);
      var json = JSON.stringify(card, null, 2);
      var doc = parentDoc();
      var BlobCtor = parentWin('Blob') || Blob;
      var URLCtor = parentWin('URL') || URL;
      var blob = new BlobCtor([json], { type: 'application/json' });
      var url = URLCtor.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      var fname = (card.name || 'character').replace(/[\\/:*?"<>|]/g, '_');
      a.download = fname + '.json';
      doc.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { doc.body.removeChild(a); } catch (_) {}
        try { URLCtor.revokeObjectURL(url); } catch (_) {}
      }, 200);
      showToast('角色卡已导出');
    } catch (e) { showToast('导出失败: ' + e.message, 'error'); }
  }

  function triggerImport() {
    var doc = parentDoc();
    var input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) { try { doc.body.removeChild(input); } catch (_) {} return; }
      var FileReaderCtor = parentWin('FileReader') || FileReader;
      var reader = new FileReaderCtor();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          importCardData(data);
          refreshPanel();
          showToast('角色卡已导入');
        } catch (e) { showToast('导入失败：JSON 解析错误', 'error'); }
        try { doc.body.removeChild(input); } catch (_) {}
      };
      reader.onerror = function () {
        showToast('读取文件失败', 'error');
        try { doc.body.removeChild(input); } catch (_) {}
      };
      reader.readAsText(f);
    };
    doc.body.appendChild(input);
    input.click();
  }

  // 导入：兼容完整导出卡（带 spec/data 包装），解包后合并到 _cardData
  function importCardData(data) {
    if (!data || typeof data !== 'object') return;
    var src = data;
    if (data.data && data.spec) {
      src = data.data;
      ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'].forEach(function (k) {
        if (data[k] != null && src[k] == null) src[k] = data[k];
      });
      if (data.creatorcomment != null && src.creator_notes == null) src.creator_notes = data.creatorcomment;
    }
    initCardData();
    mergePartial(src, _cardData);
  }

  // ===== 初始化：自动创建悬浮工具条 + 注册 ST 扩展按钮（点击=展开/收起） =====
  function registerSTButton() {
    try {
      var evtOn = typeof eventOn === 'function' ? eventOn : _g('eventOn');
      var getBtnEvt = typeof getButtonEvent === 'function' ? getButtonEvent : _g('getButtonEvent');
      if (evtOn && getBtnEvt) {
        evtOn(getBtnEvt(BUTTON_NAME), function () { setExpanded(!_expanded); });
        return true;
      }
    } catch (e) {}
    return false;
  }

  // 等待 parent.document.body 就绪后自动挂载工具条
  var _initRetry = 0;
  function autoMount() {
    try {
      var doc = parentDoc();
      if (!doc || !doc.body) {
        if (_initRetry < 30) { _initRetry++; setTimeout(autoMount, 300); }
        return;
      }
      // 避免重复挂载
      if (_toolbar) return;
      createToolbar();
      registerSTButton();
    } catch (e) {
      if (_initRetry < 30) { _initRetry++; setTimeout(autoMount, 300); }
    }
  }

  window.addEventListener('pagehide', function () {
    try { cleanupChatListeners(); } catch(_) {}
    removeToolbar();
  });

  // 启动：DOM 就绪后自动挂载悬浮工具条（无需点击任何按钮）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
