/* ===========================================================
   时之写卡器 - 悬浮仪表盘版 (Card_making_dashboard.js)
   -----------------------------------------------------------
   · 极简悬浮工具条（横向按钮条），点击"📊 仪表盘"展开/收起
   · 时之写卡器风格：低饱和、细线、圆角胶囊
   · 10模块双行5列环形进度仪表盘（进度圆圈 + 不使用进度条）
   · 模块详情：完成质量、内容预览、建议提示
   · 质量检查：字数合规、必填完成、条目规范
   · 世界书概览：分组统计、前缀模板识别
   · 保留：扫消息、导入、导出、自动监听聊天
   · 数据/展开状态 全部存在 localStorage
   =========================================================== */
(function () {
  if (window.__CM_IDE_LOADED__) return;
  window.__CM_IDE_LOADED__ = true;

  var SCRIPT_ID = 'cm-ide-toolbar';
  var LS_KEY = 'cm-ide-state-v2';
  var STORAGE_KEY = 'cm-ide-carddata-v1';

  // ---------- 工具函数 ----------
  function pd() {
    try { if (window.parent && window.parent.document) return window.parent.document; } catch (_) {}
    try { return document; } catch (_) { return null; }
  }
  function _ls() {
    try { if (window.parent && window.parent.localStorage) return window.parent.localStorage; } catch (_) {}
    try { return window.localStorage; } catch (_) { return null; }
  }
  function saveLS(k, v) { try { var l = _ls(); if (l) l.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function loadLS(k, d) {
    try { var l = _ls(); if (l) { var r = l.getItem(k); if (r) return JSON.parse(r); } } catch (_) {}
    return d;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function vp() {
    try { var v = (window.parent && window.parent.visualViewport); if (v) return { w: v.width, h: v.height }; } catch (_) {}
    var w = (window.parent && window.parent.innerWidth) || window.innerWidth || 390;
    var h = (window.parent && window.parent.innerHeight) || window.innerHeight || 700;
    return { w: w, h: h };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ===== Token估算（中文=1字1token，英文按词估算）=====
  function countTokens(text) {
    if (!text) return 0;
    var t = String(text);
    var cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var enWords = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
    return cn + Math.ceil(enWords * 0.75);
  }

  // ===== 权重等级映射（用于世界书权重可视化）=====
  var WEIGHT_LEVELS = {
    '基础公理':     { level: '极低', color: '#6b7280', desc: 'position=0 常驻，世界元数据锚定' },
    '世界元数据':   { level: '极低', color: '#6b7280', desc: 'position=0 常驻，底层背景' },
    '交互软规则':   { level: '低',   color: '#64748b', desc: 'position=1 常驻，角色卡之后注入' },
    '近场强约束':   { level: '极高', color: '#dc2626', desc: 'position=2 触发，用户输入之前' },
    '当前局势':     { level: '极高', color: '#dc2626', desc: 'position=2 触发，sticky粘性' },
    '场景机制':     { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发' },
    '核心玩法':     { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发' },
    '世界规则':     { level: '中高', color: '#d97706', desc: 'position=1 depth=4 触发' },
    '实体交互':     { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发，防递归' },
    '重要角色':     { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发，防递归' },
    '势力与组织':   { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发，防递归' },
    '物品':         { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发，防递归' },
    '地点场景':     { level: '中高', color: '#d97706', desc: 'position=1 depth=3 触发，防递归' },
    '叙事背景':     { level: '中',   color: '#16a34a', desc: 'position=4 depth=5 概率触发' },
    '故事发展':     { level: '中',   color: '#16a34a', desc: 'position=4 depth=5 概率触发' },
    '文化与习俗':   { level: '中',   color: '#16a34a', desc: 'position=4 depth=5 概率触发' },
    '历史事件':     { level: '中',   color: '#16a34a', desc: 'position=4 depth=6 概率触发' },
    '动态适配':     { level: '中',   color: '#16a34a', desc: 'position=1 depth=4 动态系统' },
    '引导机制':     { level: '中',   color: '#16a34a', desc: 'position=1 depth=4 动态系统' },
    '互动选项':     { level: '中',   color: '#16a34a', desc: 'position=1 depth=4 动态系统' },
    '状态栏':       { level: '极高', color: '#dc2626', desc: 'position=2 depth=2 sticky粘性' },
    '统一输出格式': { level: '极低', color: '#6b7280', desc: 'position=0 常驻' },
    '角色边界':     { level: '极低', color: '#6b7280', desc: 'position=0 常驻' },
    '禁止项':       { level: '极低', color: '#6b7280', desc: 'position=0 常驻，禁止规则' },
    '自定义条目':   { level: '中',   color: '#16a34a', desc: '用户自定义' },
  };
  function getWeightLevel(comment) {
    if (!comment) return null;
    var m = /^<([^>]+)>/.exec(comment) || /^\[([^\]]+)\]/.exec(comment);
    var key = m ? m[1] : comment;
    if (WEIGHT_LEVELS[key]) return WEIGHT_LEVELS[key];
    for (var k in WEIGHT_LEVELS) {
      if (key.indexOf(k) >= 0) return WEIGHT_LEVELS[k];
    }
    return null;
  }

  // ===== 常用条目快捷模板（一键插入空骨架）=====
  var QUICK_ENTRY_TEMPLATES = [
    { prefix: '基础公理',   name: '世界元数据',     sample: '世界名称、力量体系底层设定、时间线锚点等永不改变的元数据。\n· 世界名：xxx\n· 核心力量体系：xxx', hint: 'constant=true, position=0 常驻永不截断' },
    { prefix: '核心铁则',   name: '角色边界',       sample: 'AI扮演的绝对边界、禁止行为清单、必须遵守的输出规范。\n· 绝对禁止：xxx\n· 必须遵守：xxx', hint: '放post_history_instructions字段，权重最高！' },
    { prefix: '交互软规则', name: '叙事风格',       sample: '互动选项生成逻辑、叙事描写风格、剧情引导原则。\n· 描写风格：细腻/写实/写意\n· 互动选项：每回合2-3个', hint: 'constant=true, position=1 常驻' },
    { prefix: '近场强约束', name: '当前局势',       sample: '当前场景即时规则、临时任务、状态栏触发条件。\n· 当前地点：xxx\n· 即时任务：xxx', hint: 'position=2 粘性触发，权重极高' },
    { prefix: '场景机制',   name: '核心玩法',       sample: '战斗、探索、修炼、谈判等场景规则。\n· 战斗机制：回合制/即时制\n· 胜负判定：xxx', hint: 'position=1 depth=3 进入场景触发' },
    { prefix: '实体交互',   name: '重要角色',       sample: '角色外形、性格、背景、与主角关系、关键台词。\n· 身份：xxx\n· 关系：xxx', hint: 'prevent_recursion=true 防链式触发' },
    { prefix: '实体交互',   name: '势力与组织',     sample: '组织架构、立场、重要成员、势力范围。\n· 组织名：xxx\n· 立场：中立/敌对/友好', hint: '防递归，精准触发' },
    { prefix: '实体交互',   name: '物品',           sample: '道具外观、功能描述、使用效果、获取条件。\n· 名称：xxx\n· 效果：xxx', hint: '防递归' },
    { prefix: '实体交互',   name: '地点场景',       sample: '地点外观、氛围、可交互元素、隐藏内容。\n· 场景：xxx\n· 要素：xxx', hint: '防递归' },
    { prefix: '叙事背景',   name: '故事发展',       sample: '主线/支线剧情阶段、触发条件、叙事组互斥。\n· 剧情阶段：xxx\n· 触发：xxx关键词', hint: 'group=叙事 同组互斥仅注入1条' },
    { prefix: '叙事背景',   name: '文化与习俗',     sample: '世界的节日、礼仪、迷信、社会制度背景。\n· 节日：xxx\n· 习俗：xxx', hint: 'probability=60% 概率点缀' },
    { prefix: '叙事背景',   name: '历史事件',       sample: '影响当前世界的历史大事件、年代纪。\n· 事件：xxx\n· 影响：xxx', hint: 'position=4 深度叙事点缀' },
    { prefix: '动态适配',   name: '引导机制',       sample: '前N回合新手引导、剧情分支触发逻辑、难度自适应。\n· 新手引导：前10轮\n· 分支触发：xxx', hint: 'position=1 depth=4 动态系统' },
    { prefix: '动态适配',   name: '互动选项',       sample: '特殊场景下的互动选项生成规则、选项类型模板。\n· 类型：战斗/对话/探索\n· 生成规则：xxx', hint: '动态系统，按需加载' },
    { prefix: '状态栏',     name: '主状态栏',       sample: '变量输出触发条件、显示位置、与场景联动。\n· 触发关键词：xxx\n· 显示：顶部/底部', hint: 'position=2 sticky粘性极高权重' },
    { prefix: '变量列表',   name: 'MVU变量列表',    sample: '---\n<status_current_variable>\n{{format_message_variable::stat_data}}\n</status_current_variable>', hint: 'MVU系统，注入当前所有变量值给LLM' },
  ];

  // ===== MVU状态栏 / 变量美化 HTML 模板（一键复制）=====
  // 注意：字符串内严格避免出现字面量 "</script>"，拆分拼接以防HTML环境下脚本提前结束
  var MVU_TEMPLATES = {
    'statusBarHtml': {
      name: '🎨 MVU状态栏HTML（正则6用）',
      desc: 'findRegex="/<StatusPlaceHolderImpl\\\\/>/g"，markdownOnly=true，将占位符替换为可视化状态栏。低饱和柔灰蓝+毛玻璃风格，监听MVU事件递归渲染变量树',
      code: (function(){
        var SCRIPT_END = '</' + 'script>';
        var html = '<!doctype html>\n'
          + '<html lang="zh-CN">\n'
          + '<head>\n<meta charset="UTF-8">\n<style>\n'
          + '*{margin:0;padding:0;box-sizing:border-box}\n'
          + ':root{--card-bg:rgba(30,35,45,0.82);--card-border:rgba(100,116,139,0.28);--text-main:#e2e8f0;--text-sub:#94a3b8;--accent-blue:#93c5fd;--accent-green:#86efac;--accent-red:#fca5a5;--line-divider:rgba(148,163,184,0.15);--hover-bg:rgba(148,163,184,0.08)}\n'
          + '.mvu-status-card{border:1px solid var(--card-border);border-radius:8px;background:var(--card-bg);backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.12);margin-bottom:8px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12px;color:var(--text-main);overflow:hidden}\n'
          + '.card-body{padding:10px 12px;line-height:1.45}\n'
          + '.category-title{font-size:12px;font-weight:600;color:var(--accent-blue);margin:10px 0 6px;display:flex;align-items:center;gap:4px;padding-bottom:3px;border-bottom:1px solid var(--line-divider)}\n'
          + '.category-title:first-child{margin-top:0}\n'
          + '.category-title::before{content:"▸";font-size:10px;opacity:.8}\n'
          + '.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:4px 16px}\n'
          + '.stat-item{display:flex;align-items:flex-start;justify-content:space-between;padding:4px 6px;border-radius:4px;transition:background .2s ease;gap:8px}\n'
          + '.stat-item:hover{background:var(--hover-bg)}\n'
          + '.indent-1{padding-left:8px}.indent-2{padding-left:20px}.indent-3{padding-left:32px}.indent-4{padding-left:44px}\n'
          + '.stat-label{color:var(--text-sub);flex:1;word-break:break-word;overflow-wrap:break-word}\n'
          + '.stat-value{font-weight:500;text-align:right;flex-shrink:0;max-width:58%;word-break:break-word;overflow-wrap:break-word}\n'
          + '.value-number{color:var(--accent-blue);white-space:nowrap}\n'
          + '.value-true{color:var(--accent-green);white-space:nowrap}\n'
          + '.value-false{color:var(--accent-red);white-space:nowrap}\n'
          + '.value-text{color:var(--text-main)}\n'
          + '.loading-state{text-align:center;padding:16px 0;color:var(--text-sub);animation:breathe 2s ease-in-out infinite}\n'
          + '@keyframes breathe{0%,100%{opacity:.5}50%{opacity:.9}}\n'
          + '.flash-update{animation:fadeIn .3s ease-out}\n'
          + '@keyframes fadeIn{from{opacity:.6}to{opacity:1}}\n'
          + '</style>\n'
          + '<script type="module">\n'
          + 'async function init(){\n'
          + '  await waitGlobalInitialized("Mvu");\n'
          + '  var rootDom=document.getElementById("render-root");\n'
          + '  function refreshStatus(){\n'
          + '    var allVars=getAllVariables();\n'
          + '    var sourceData=_.get(allVars,"stat_data",{});\n'
          + '    var htmlStr="";\n'
          + '    function renderTree(obj,level){\n'
          + '      level=level||0;\n'
          + '      var indentClass="indent-"+Math.min(level,4);\n'
          + '      var itemsHtml="";\n'
          + '      var keys=Object.keys(obj||{});\n'
          + '      for(var i=0;i<keys.length;i++){\n'
          + '        var key=keys[i],value=obj[key];\n'
          + '        if(key.charAt(0)==="_"||key.charAt(0)==="$") continue;\n'
          + '        if(typeof value==="object"&&value!==null&&!Array.isArray(value)){\n'
          + '          if(itemsHtml){htmlStr+=\'<div class="stat-grid \'+indentClass+\'">\'+itemsHtml+"</div>";itemsHtml="";}\n'
          + '          if(level>0){htmlStr+=\'<div class="category-title \'+indentClass+\'">\'+key+"</div>";}\n'
          + '          renderTree(value,level+1);continue;\n'
          + '        }\n'
          + '        itemsHtml+=\'<div class="stat-item">\';\n'
          + '        itemsHtml+=\'<span class="stat-label">\'+key+"</span>";\n'
          + '        itemsHtml+=\'<span class="stat-value">\';\n'
          + '        if(typeof value==="number") itemsHtml+=\'<span class="value-number">\'+value+"</span>";\n'
          + '        else if(typeof value==="boolean") itemsHtml+=value?\'<span class="value-true">✓</span>\':\'<span class="value-false">✕</span>\';\n'
          + '        else if(Array.isArray(value)) itemsHtml+=\'<span class="value-text">[\'+value.join(", ")+"]</span>";\n'
          + '        else itemsHtml+=\'<span class="value-text">\'+String(value==null?"":value)+"</span>";\n'
          + '        itemsHtml+="</span></div>";\n'
          + '      }\n'
          + '      if(itemsHtml){htmlStr+=\'<div class="stat-grid \'+indentClass+\'">\'+itemsHtml+"</div>";}\n'
          + '    }\n'
          + '    renderTree(sourceData,0);\n'
          + '    rootDom.innerHTML=htmlStr;\n'
          + '    rootDom.classList.add("flash-update");\n'
          + '    setTimeout(function(){rootDom.classList.remove("flash-update");},300);\n'
          + '  }\n'
          + '  refreshStatus();\n'
          + '  eventOn(Mvu.events.VARIABLE_INITIALIZED,refreshStatus);\n'
          + '  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,refreshStatus);\n'
          + '}\n'
          + '$(errorCatched(init));\n'
          + SCRIPT_END + '\n'
          + '</head>\n<body>\n'
          + '<div class="mvu-status-card"><div class="card-body" id="render-root"><div class="loading-state">正在加载状态数据...</div></div></div>\n'
          + '</body>\n</html>';
        return html;
      })()
    },
    'regex5_removePlaceholder': {
      name: '📝 正则5：移除状态栏占位符（发给AI前）',
      desc: 'findRegex="/<StatusPlaceHolderImpl\\\\/>/g"，promptOnly=true，从提示词移除占位符，AI不需要看到它',
      code: (function(){
        var arr = [{
          id: 'regex_remove_placeholder',
          scriptName: '[不发送]隐藏状态栏标记',
          findRegex: '/<StatusPlaceHolderImpl\\/>/g',
          replaceString: '',
          placement: [2],
          markdownOnly: false,
          promptOnly: true,
          runOnEdit: true,
          substituteRegex: 0
        }];
        return JSON.stringify(arr, null, 2);
      })()
    },
    'regex3_4_beautifyUpdate': {
      name: '✨ 正则3+4：美化变量更新显示',
      desc: '正则3美化已完成<UpdateVariable>（折叠样式），正则4美化输出中（流式动画）',
      code: (function(){
        var DONE_HTML = '<div style="text-align:center;margin:8px 0"><div style="display:inline-block;text-align:left"><details style="border:none;background:none"><summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center"><span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:2px solid rgba(76,175,80,0.5);background:linear-gradient(135deg,#e8f5e9,#c8e6c9);font-size:18px">✓</span><span style="display:flex;align-items:center;height:26px;margin-left:-8px;padding:0 16px 0 14px;background:linear-gradient(135deg,#e8f5e9,#e8f5e9);border:1.5px solid rgba(76,175,80,0.35);border-radius:0 13px 13px 0"><span style="font-weight:600;color:#2e7d32">变量已更新</span></span></summary><div style="max-height:240px;overflow-y:auto;margin-left:18px;margin-top:4px;padding:8px 14px;color:#33691e;line-height:1.7;white-space:pre-wrap;background:rgba(232,245,233,0.7);border:1.5px solid rgba(76,175,80,0.25);border-radius:10px;font-size:12px">$1</div></details></div></div>';
        var THINK_HTML = '<div style="text-align:center;margin:8px 0"><div style="display:inline-flex;align-items:center;gap:6px;padding:4px 14px;background:linear-gradient(135deg,#e3f2fd,#e3f2fd);border:1.5px solid rgba(33,150,243,0.35);border-radius:999px"><span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(33,150,243,0.5);border-top-color:#1976d2;border-radius:50%;animation:mvu-spin 1.2s linear infinite"></span><span style="font-size:12px;font-weight:600;color:#1565c0">变量更新中...</span></div></div><style>@keyframes mvu-spin{to{transform:rotate(360deg)}}</style>$1';
        var arr = [
          {
            id: 'regex_mvu_done',
            scriptName: '[美化]变量完成',
            findRegex: '/(<UpdateVariable>[\\\\s\\\\S]*?<\\\\/UpdateVariable>)/g',
            replaceString: DONE_HTML,
            placement: [2],
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0
          },
          {
            id: 'regex_mvu_thinking',
            scriptName: '[美化]变量更新中',
            findRegex: '/(<UpdateVariable>(?!([\\\\s\\\\S]*?)<\\\\/UpdateVariable>)[\\\\s\\\\S]{0,200})/g',
            replaceString: THINK_HTML,
            placement: [2],
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0
          }
        ];
        return JSON.stringify(arr, null, 2);
      })()
    },
  };

  // ---------- 字段定义（用于仪表盘数据计算，不再用于UI） ----------
  var FIELDS = [
    { key: 'name',                      label: '名称',           group: '基础字段', type: 'text',     required: true  },
    { key: 'description',               label: '世界观描述',     group: '基础字段', type: 'textarea', required: true,  minLen: 400 },
    { key: 'personality',               label: '性格',           group: '基础字段', type: 'textarea', required: false },
    { key: 'scenario',                  label: '场景',           group: '基础字段', type: 'textarea', required: false },
    { key: 'first_mes',                 label: '开场白',         group: '基础字段', type: 'textarea', required: true,  minLen: 500 },
    { key: 'system_prompt',             label: '系统指令',       group: '核心铁则', type: 'textarea', required: true,  maxLen: 50  },
    { key: 'post_history_instructions', label: '核心铁则',       group: '核心铁则', type: 'textarea', required: true,  maxLen: 100 },
    { key: 'tags',                      label: '标签',           group: '核心铁则', type: 'tags',     required: true  },
    { key: 'mes_example',               label: '对话示例',       group: '高价值字段', type: 'textarea', required: false },
    { key: 'alternate_greetings',       label: '备用开场白',     group: '高价值字段', type: 'list',     required: false },
    { key: 'depth_prompt',              label: '新手引导',       group: '高价值字段', type: 'textarea', required: false },
    { key: 'regex_scripts',             label: '正则脚本',       group: '动态适配', type: 'jsonlist', required: false },
    { key: 'character_book',            label: '世界书',         group: '世界书',    type: 'entries',  required: false },
    { key: 'creator_notes',             label: '创作者备注',     group: '其他',      type: 'textarea', required: false },
  ];

  // ---------- 仪表盘10模块定义（双行5列布局） ----------
  var DASH_MODULES = [
    // 第一行：核心5模块
    { id: 'basic',     name: '基础字段',   group: '核心',   desc: '名称、世界观、性格、场景' },
    { id: 'core',      name: '核心铁则',   group: '核心',   desc: '系统指令、核心铁则、标签' },
    { id: 'opening',   name: '开场白',     group: '核心',   desc: 'first_mes 开篇质量' },
    { id: 'highval',   name: '高价值字段', group: '核心',   desc: '对话示例、备用开局、引导' },
    { id: 'worldbook', name: '世界书',     group: '核心',   desc: '世界观条目数量与质量' },
    // 第二行：扩展5模块
    { id: 'axiom',     name: '基础公理',   group: '扩展',   desc: 'constant position=0 常驻' },
    { id: 'scene',     name: '场景机制',   group: '扩展',   desc: '场景、玩法、世界规则' },
    { id: 'entity',    name: '实体交互',   group: '扩展',   desc: '角色、势力、物品、地点' },
    { id: 'story',     name: '叙事背景',   group: '扩展',   desc: '故事、文化、历史事件' },
    { id: 'dynamic',   name: '动态适配',   group: '扩展',   desc: '引导、互动、状态栏、正则' },
  ];

  // ---------- 世界书前缀映射（用于统计模块） ----------
  var ENTRY_PREFIX_MAP = {
    '基础公理':     'axiom',
    '世界元数据':   'axiom',
    '交互软规则':   'axiom',
    '核心铁则':     'core',
    '角色边界':     'core',
    '禁止项':       'core',
    '统一输出格式': 'core',
    '近场强约束':   'opening',
    '当前局势':     'opening',
    '场景机制':     'scene',
    '核心玩法':     'scene',
    '世界规则':     'scene',
    '重要角色':     'entity',
    '势力与组织':   'entity',
    '物品':         'entity',
    '地点场景':     'entity',
    '实体交互':     'entity',
    '叙事背景':     'story',
    '故事发展':     'story',
    '文化与习俗':   'story',
    '历史事件':     'story',
    '动态适配':     'dynamic',
    '引导机制':     'dynamic',
    '互动选项':     'dynamic',
    '状态栏':       'dynamic',
    '状态变量输出': 'dynamic',
  };

  // ---------- 状态 ----------
  var state = loadLS(LS_KEY, { expanded: false, dashOpen: false, left: null, top: null, toolbarX: null, toolbarY: null, activeModule: null });
  var cardData = loadLS(STORAGE_KEY, blankCardData());
  function blankCardData() {
    var o = { name: '', description: '', personality: '', scenario: '',
      first_mes: '', system_prompt: '', post_history_instructions: '', tags: [],
      mes_example: '', alternate_greetings: [], depth_prompt: '', regex_scripts: [],
      character_book: { description: '', scan_depth: 50, entries: [] },
      creator_notes: '', data: { version: 'chara_card_v3' }, spec: 'chara_card_v3',
      character_version: '1.0', creator: '', alternate_greetings: [],
      extensions: {} };
    return o;
  }
  function ensureCardDataShape() {
    if (!cardData || typeof cardData !== 'object') cardData = blankCardData();
    ['name','description','personality','scenario','first_mes','system_prompt','post_history_instructions',
     'mes_example','depth_prompt','creator_notes'].forEach(function(k){ if (typeof cardData[k] !== 'string') cardData[k] = ''; });
    if (!Array.isArray(cardData.tags)) cardData.tags = [];
    if (!Array.isArray(cardData.alternate_greetings)) cardData.alternate_greetings = [];
    if (!Array.isArray(cardData.regex_scripts)) cardData.regex_scripts = [];
    if (!cardData.character_book || typeof cardData.character_book !== 'object') {
      cardData.character_book = { description:'', scan_depth:50, entries: [] };
    }
    if (!Array.isArray(cardData.character_book.entries)) cardData.character_book.entries = [];
    if (!cardData.data || typeof cardData.data !== 'object') cardData.data = { version: 'chara_card_v3' };
  }
  ensureCardDataShape();
  function saveAll() { saveLS(LS_KEY, state); saveLS(STORAGE_KEY, cardData); }

  // ---------- 样式注入（时之写卡器细线风 + 仪表盘环形进度） ----------
  function injectStyles() {
    var doc = pd(); if (!doc || !doc.head) return;
    var sid = SCRIPT_ID + '-styles';
    if (doc.getElementById(sid)) return;
    var R = '#' + SCRIPT_ID;
    var css = ''
      // === 调色板：时之写卡器低饱和细线风 ===
      + R + ', ' + R + '-dash{--cm-bg:#f8fafc;--cm-bg2:#ffffff;--cm-border:#e2e8f0;--cm-border-soft:#f1f5f9;'
      + ' --cm-text:#1e293b;--cm-dim:#64748b;--cm-dim2:#94a3b8;'
      + ' --cm-accent:#3b82f6;--cm-accent-soft:#eff6ff;--cm-accent-border:#bfdbfe;'
      + ' --cm-green:#22c55e;--cm-green-soft:#f0fdf4;--cm-green-border:#bbf7d0;'
      + ' --cm-warn:#f59e0b;--cm-warn-soft:#fffbeb;--cm-warn-border:#fde68a;'
      + ' --cm-danger:#ef4444;--cm-danger-soft:#fef2f2;--cm-danger-border:#fecaca;'
      + ' --cm-purple:#8b5cf6;--cm-purple-soft:#f5f3ff;--cm-purple-border:#ddd6fe;'
      + ' --cm-radius:8px;--cm-radius-lg:12px;}'
      + R + ' *, ' + R + ' *::before, ' + R + ' *::after,'
      + R + '-dash *, ' + R + '-dash *::before, ' + R + '-dash *::after{box-sizing:border-box;margin:0;padding:0}'
      // === 悬浮工具条（真·横条，圆角胶囊） ===
      + R + '{position:fixed;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:6px 10px;'
      + ' background:var(--cm-bg2);border:1px solid var(--cm-border);border-radius:999px;'
      + ' box-shadow:0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(15,23,42,.08);'
      + ' font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;'
      + ' color:var(--cm-text);font-size:13px;user-select:none;touch-action:none;isolation:isolate;}'
      + R + '.hidden{display:none!important}'
      + R + ' .cm-handle{cursor:grab;color:var(--cm-dim2);padding:0 4px;display:flex;align-items:center;}'
      + R + '.cm-dragging{cursor:grabbing!important;transition:none!important}'
      + R + ' .cm-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid var(--cm-border);'
      + ' background:var(--cm-bg2);color:var(--cm-text);border-radius:999px;cursor:pointer;'
      + ' font:inherit;font-size:12px;transition:background .15s,border-color .15s,color .15s;white-space:nowrap;}'
      + R + ' .cm-btn:hover{background:var(--cm-accent-soft);border-color:var(--cm-accent-border);color:var(--cm-accent);}'
      + R + ' .cm-btn.primary{background:var(--cm-accent);border-color:var(--cm-accent);color:#fff;font-weight:500}'
      + R + ' .cm-btn.primary:hover{filter:brightness(1.05);background:var(--cm-accent);color:#fff}'
      + R + ' .cm-btn.success{border-color:var(--cm-green-border);color:var(--cm-green)}'
      + R + ' .cm-btn.success:hover{background:var(--cm-green-soft);}'
      + R + ' .cm-btn.danger{border-color:var(--cm-danger-border);color:var(--cm-danger)}'
      + R + ' .cm-btn.danger:hover{background:var(--cm-danger-soft)}'
      + R + ' .cm-sep{width:1px;height:18px;background:var(--cm-border)}'
      + R + ' .cm-completion{font-size:11px;color:var(--cm-dim);padding:0 6px;display:inline-flex;align-items:center;gap:4px}'
      + R + ' .cm-completion b{color:var(--cm-accent);font-weight:600}'
      // === 仪表盘面板（从工具栏下拉展开，紧凑浮层） ===
      + R + '-dash{position:fixed;z-index:2147483646;display:none;flex-direction:column;'
      + ' width:520px;max-width:calc(100vw - 24px);'
      + ' background:var(--cm-bg2);border:1px solid var(--cm-border);border-radius:var(--cm-radius-lg);'
      + ' box-shadow:0 12px 40px rgba(15,23,42,.15), 0 2px 8px rgba(15,23,42,.06);'
      + ' font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;'
      + ' color:var(--cm-text);font-size:13px;overflow:hidden;isolation:isolate}'
      + R + '-dash.show{display:flex;animation:cm-drop .18s ease-out}'
      + '@keyframes cm-drop{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}'
      // --- 仪表盘头部 ---
      + R + '-dash .cm-dh{display:flex;align-items:center;gap:8px;padding:10px 14px;'
      + ' border-bottom:1px solid var(--cm-border);background:var(--cm-bg);cursor:move}'
      + R + '-dash .cm-dh strong{font-weight:600;color:var(--cm-text);font-size:13px}'
      + R + '-dash .cm-dh .cm-dsub{font-size:11px;color:var(--cm-dim);margin-left:4px}'
      + R + '-dash .cm-dh .cm-dright{margin-left:auto;display:flex;align-items:center;gap:8px}'
      + R + '-dash .cm-dclose{width:24px;height:24px;border:none;border-radius:6px;background:transparent;'
      + ' color:var(--cm-dim);font-size:18px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;}'
      + R + '-dash .cm-dclose:hover{background:var(--cm-danger-soft);color:var(--cm-danger)}'
      + R + '-dash .cm-dash-tabs{display:flex;gap:2px;padding:0 14px;border-bottom:1px solid var(--cm-border);background:var(--cm-bg);flex-shrink:0}'
      + R + '-dash .cm-dtab{padding:7px 12px;border:none;border-bottom:2px solid transparent;'
      + ' background:transparent;color:var(--cm-dim);cursor:pointer;font:inherit;font-size:12px;font-weight:500;transition:color .15s,border-color .15s}'
      + R + '-dash .cm-dtab:hover{color:var(--cm-text)}'
      + R + '-dash .cm-dtab.active{color:var(--cm-accent);border-bottom-color:var(--cm-accent)}'
      // --- 仪表盘主体滚动区 ---
      + R + '-dash .cm-dbody{flex:1;overflow-y:auto;padding:12px 14px;background:var(--cm-bg2);max-height:440px}'
      + R + '-dash .cm-dbody::-webkit-scrollbar{width:5px}'
      + R + '-dash .cm-dbody::-webkit-scrollbar-track{background:transparent}'
      + R + '-dash .cm-dbody::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}'
      + R + '-dash .cm-dbody::-webkit-scrollbar-thumb:hover{background:#94a3b8}'
      // --- 10格环形进度网格：双行5列 ---
      + R + '-dash .cm-ring-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}'
      + R + '-dash .cm-ring-card{display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px;'
      + ' border:1px solid var(--cm-border-soft);border-radius:var(--cm-radius);background:var(--cm-bg2);'
      + ' cursor:pointer;transition:all .15s;position:relative}'
      + R + '-dash .cm-ring-card:hover{border-color:var(--cm-accent-border);background:var(--cm-accent-soft);transform:translateY(-1px)}'
      + R + '-dash .cm-ring-card.active{border-color:var(--cm-accent);background:var(--cm-accent-soft);box-shadow:0 0 0 2px rgba(59,130,246,.1)}'
      + R + '-dash .cm-ring-card .cm-rc-name{font-size:11px;color:var(--cm-text);font-weight:500;text-align:center;line-height:1.2}'
      + R + '-dash .cm-ring-wrap{position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center}'
      + R + '-dash .cm-ring-wrap svg{transform:rotate(-90deg)}'
      + R + '-dash .cm-ring-wrap .cm-ring-bg{fill:none;stroke:var(--cm-border-soft);stroke-width:4}'
      + R + '-dash .cm-ring-wrap .cm-ring-fg{fill:none;stroke-width:4;stroke-linecap:round;transition:stroke-dashoffset .4s ease}'
      + R + '-dash .cm-ring-wrap.done .cm-ring-fg{stroke:var(--cm-green)}'
      + R + '-dash .cm-ring-wrap.partial .cm-ring-fg{stroke:var(--cm-accent)}'
      + R + '-dash .cm-ring-wrap.warn .cm-ring-fg{stroke:var(--cm-warn)}'
      + R + '-dash .cm-ring-wrap.low .cm-ring-fg{stroke:var(--cm-dim2)}'
      + R + '-dash .cm-ring-pct{position:absolute;font-size:10px;font-weight:600;color:var(--cm-text)}'
      + R + '-dash .cm-rc-badge{position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%}'
      + R + '-dash .cm-rc-badge.done{background:var(--cm-green)}'
      + R + '-dash .cm-rc-badge.partial{background:var(--cm-accent)}'
      + R + '-dash .cm-rc-badge.warn{background:var(--cm-warn)}'
      + R + '-dash .cm-rc-badge.empty{background:var(--cm-dim2)}'
      // --- 模块详情面板 ---
      + R + '-dash .cm-mod-detail{background:var(--cm-bg);border:1px solid var(--cm-border-soft);border-radius:var(--cm-radius);padding:10px 12px}'
      + R + '-dash .cm-md-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--cm-border-soft)}'
      + R + '-dash .cm-md-name{font-weight:600;color:var(--cm-text);font-size:13px}'
      + R + '-dash .cm-md-desc{font-size:11px;color:var(--cm-dim);margin-left:auto}'
      + R + '-dash .cm-md-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}'
      + R + '-dash .cm-md-stat{background:var(--cm-bg2);border:1px solid var(--cm-border-soft);border-radius:6px;padding:5px 6px;text-align:center}'
      + R + '-dash .cm-md-stat b{display:block;font-size:13px;color:var(--cm-accent);font-weight:600}'
      + R + '-dash .cm-md-stat span{display:block;font-size:9px;color:var(--cm-dim);margin-top:1px}'
      + R + '-dash .cm-md-section{margin-bottom:8px}'
      + R + '-dash .cm-md-section h4{font-size:10px;color:var(--cm-dim);font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}'
      + R + '-dash .cm-md-list{display:flex;flex-direction:column;gap:3px}'
      + R + '-dash .cm-md-item{display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--cm-bg2);'
      + ' border:1px solid var(--cm-border-soft);border-radius:6px;font-size:11px}'
      + R + '-dash .cm-md-item .cm-mi-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}'
      + R + '-dash .cm-md-item .cm-mi-dot.ok{background:var(--cm-green)}'
      + R + '-dash .cm-md-item .cm-mi-dot.part{background:var(--cm-warn)}'
      + R + '-dash .cm-md-item .cm-mi-dot.bad{background:var(--cm-danger)}'
      + R + '-dash .cm-md-item .cm-mi-dot.empty{background:var(--cm-dim2)}'
      + R + '-dash .cm-md-item .cm-mi-name{color:var(--cm-text);font-weight:500;flex-shrink:0}'
      + R + '-dash .cm-md-item .cm-mi-val{color:var(--cm-dim);margin-left:auto;font-size:10px}'
      + R + '-dash .cm-md-suggest{background:var(--cm-warn-soft);border:1px solid var(--cm-warn-border);'
      + ' border-radius:6px;padding:6px 10px;font-size:11px;color:var(--cm-warn);line-height:1.5}'
      + R + '-dash .cm-md-ok{background:var(--cm-green-soft);border:1px solid var(--cm-green-border);'
      + ' border-radius:6px;padding:6px 10px;font-size:11px;color:var(--cm-green);line-height:1.5}'
      + R + '-dash .cm-md-preview{background:#1e293b;color:#e2e8f0;border-radius:6px;padding:8px 10px;font-size:10px;'
      + ' font-family:"SF Mono",Consolas,monospace;white-space:pre-wrap;max-height:100px;overflow-y:auto;line-height:1.5}'
      + R + '-dash .cm-md-preview::-webkit-scrollbar{width:4px}'
      + R + '-dash .cm-md-preview::-webkit-scrollbar-thumb{background:#475569;border-radius:2px}'
      // --- 质量检查面板 ---
      + R + '-dash .cm-qc-item{background:var(--cm-bg2);border:1px solid var(--cm-border-soft);border-radius:6px;padding:8px 10px;margin-bottom:6px;display:flex;gap:8px;align-items:flex-start}'
      + R + '-dash .cm-qc-item.pass{border-color:var(--cm-green-border)}'
      + R + '-dash .cm-qc-item.fail{border-color:var(--cm-danger-border);background:var(--cm-danger-soft)}'
      + R + '-dash .cm-qc-item.warn{border-color:var(--cm-warn-border);background:var(--cm-warn-soft)}'
      + R + '-dash .cm-qc-icon{font-size:16px;flex-shrink:0;margin-top:1px}'
      + R + '-dash .cm-qc-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:3px}'
      + R + '-dash .cm-qc-dot.pass{background:var(--cm-green)}'
      + R + '-dash .cm-qc-dot.warn{background:var(--cm-warn)}'
      + R + '-dash .cm-qc-dot.fail{background:var(--cm-danger)}'
      + R + '-dash .cm-qc-content{flex:1;min-width:0}'
      + R + '-dash .cm-qc-title{font-size:12px;font-weight:600;color:var(--cm-text);margin-bottom:2px}'
      + R + '-dash .cm-qc-item.pass .cm-qc-title{color:var(--cm-green)}'
      + R + '-dash .cm-qc-item.fail .cm-qc-title{color:var(--cm-danger)}'
      + R + '-dash .cm-qc-item.warn .cm-qc-title{color:var(--cm-warn)}'
      + R + '-dash .cm-qc-desc{font-size:11px;color:var(--cm-dim);line-height:1.4}'
      + R + '-dash .cm-qc-score{text-align:center;margin-bottom:10px;padding:12px;background:var(--cm-bg);'
      + ' border:1px solid var(--cm-border-soft);border-radius:var(--cm-radius)}'
      + R + '-dash .cm-qc-score b{font-size:28px;font-weight:700;background:linear-gradient(135deg,var(--cm-accent),var(--cm-purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent}'
      + R + '-dash .cm-qc-score span{display:block;font-size:11px;color:var(--cm-dim);margin-top:2px}'
      // --- 世界书概览面板 ---
      + R + '-dash .cm-wv-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}'
      + R + '-dash .cm-wv-stat{background:var(--cm-bg2);border:1px solid var(--cm-border-soft);border-radius:8px;padding:8px;text-align:center}'
      + R + '-dash .cm-wv-stat b{display:block;font-size:16px;font-weight:700;color:var(--cm-accent)}'
      + R + '-dash .cm-wv-stat span{display:block;font-size:10px;color:var(--cm-dim);margin-top:2px}'
      + R + '-dash .cm-wv-group{margin-bottom:10px}'
      + R + '-dash .cm-wv-group-head{font-size:11px;font-weight:600;color:var(--cm-dim);'
      + ' padding:4px 0;margin-bottom:6px;border-bottom:1px solid var(--cm-border-soft);display:flex;justify-content:space-between;align-items:center}'
      + R + '-dash .cm-wv-group-head .cm-gh-count{font-size:10px;color:var(--cm-dim2);font-weight:400;background:var(--cm-bg);padding:1px 6px;border-radius:999px}'
      + R + '-dash .cm-wv-entry{background:var(--cm-bg2);border:1px solid var(--cm-border-soft);border-radius:6px;padding:6px 8px;margin-bottom:5px;'
      + ' border-left:3px solid var(--cm-dim2)}'
      + R + '-dash .cm-wv-entry.lvl-1{border-left-color:var(--cm-green)}'
      + R + '-dash .cm-wv-entry.lvl-2{border-left-color:var(--cm-accent)}'
      + R + '-dash .cm-wv-entry.lvl-3{border-left-color:var(--cm-purple)}'
      + R + '-dash .cm-wv-entry.lvl-4{border-left-color:var(--cm-warn)}'
      + R + '-dash .cm-wv-entry-header{display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap}'
      + R + '-dash .cm-wv-entry-name{font-size:11px;font-weight:600;color:var(--cm-text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + R + '-dash .cm-wv-entry-level{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;background:var(--cm-bg);color:var(--cm-dim)}'
      + R + '-dash .cm-wv-entry-level.lvl-1{background:var(--cm-green-soft);color:var(--cm-green)}'
      + R + '-dash .cm-wv-entry-level.lvl-2{background:var(--cm-accent-soft);color:var(--cm-accent)}'
      + R + '-dash .cm-wv-entry-level.lvl-3{background:var(--cm-purple-soft);color:var(--cm-purple)}'
      + R + '-dash .cm-wv-entry-level.lvl-4{background:var(--cm-warn-soft);color:var(--cm-warn)}'
      + R + '-dash .cm-wv-entry-token{font-size:10px;color:var(--cm-dim2);flex-shrink:0}'
      + R + '-dash .cm-wv-entry-meta{display:flex;flex-wrap:wrap;gap:4px;font-size:9px;color:var(--cm-dim)}'
      + R + '-dash .cm-wv-entry-meta .cm-wtag{background:var(--cm-bg);border:1px solid var(--cm-border-soft);border-radius:3px;padding:1px 4px}'
      + R + '-dash .cm-wv-entry-meta .cm-wtag.const{background:var(--cm-green-soft);border-color:var(--cm-green-border);color:var(--cm-green)}'
      + R + '-dash .cm-wv-entry-meta .cm-wtag.trig{background:var(--cm-accent-soft);border-color:var(--cm-accent-border);color:var(--cm-accent)}'
      + R + '-dash .cm-wv-entry-meta .cm-wtag.warn{background:var(--cm-warn-soft);border-color:var(--cm-warn-border);color:var(--cm-warn)}'
      // --- 世界书权重图例 ---
      + R + '-dash .cm-wv-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:10px;padding:6px 10px;background:var(--cm-bg);border:1px solid var(--cm-border-soft);border-radius:8px;font-size:11px}'
      + R + '-dash .cm-wv-legend-item{display:flex;align-items:center;gap:4px;color:var(--cm-dim)}'
      + R + '-dash .cm-wv-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block}'
      // --- 快捷模板网格 ---
      + R + '-dash .cm-template-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:6px}'
      + R + '-dash .cm-tpl-card{padding:8px 10px;background:var(--cm-bg2);border:1px solid var(--cm-border-soft);border-radius:8px;cursor:pointer;transition:all .15s}'
      + R + '-dash .cm-tpl-card:hover{border-color:var(--cm-accent-border);background:var(--cm-accent-soft);transform:translateY(-1px)}'
      + R + '-dash .cm-tpl-head{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}'
      + R + '-dash .cm-tpl-prefix{padding:1px 6px;background:var(--cm-purple-soft);border:1px solid var(--cm-purple-border);color:var(--cm-purple);border-radius:4px;font-size:10px;font-weight:600}'
      + R + '-dash .cm-tpl-name{font-size:11px;font-weight:600;color:var(--cm-text)}'
      + R + '-dash .cm-tpl-hint{font-size:10px;color:var(--cm-dim);margin-bottom:3px;line-height:1.4}'
      + R + '-dash .cm-tpl-preview{font-size:10px;color:var(--cm-dim2);font-family:"SF Mono",Consolas,monospace;background:var(--cm-bg);padding:3px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + R + '-dash .cm-empty{text-align:center;padding:20px 10px;color:var(--cm-dim2);font-size:12px}'
      + R + '-dash .cm-empty .cm-eicon{font-size:28px;margin-bottom:6px;opacity:.4}'
      // --- toast ---
      + R + '-toast{position:fixed;z-index:2147483648;left:50%;bottom:40px;transform:translateX(-50%);padding:8px 14px;background:#111827;color:#fff;'
      + ' border-radius:999px;font:inherit;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}'
      + R + '-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}'
      // --- 隐藏文件输入 ---
      + R + '-file{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}'
      // --- 响应式 ---
      + '@media(max-width:620px){'
      + R + '-dash{width:calc(100vw - 16px)}'
      + R + '-dash .cm-ring-grid{grid-template-columns:repeat(5,1fr);gap:6px}'
      + R + '-dash .cm-ring-card{padding:8px 2px}'
      + R + '-dash .cm-ring-wrap{width:40px;height:40px}'
      + R + '-dash .cm-rc-name{font-size:9px}'
      + R + '-dash .cm-md-stats{grid-template-columns:repeat(2,1fr)}'
      + R + '-dash .cm-wv-summary{grid-template-columns:repeat(2,1fr)}'
      + R + '-dash .cm-template-grid{grid-template-columns:repeat(2,1fr)}'
      + R + '{padding:4px 8px;gap:4px}' + R + ' .cm-btn{padding:4px 8px;font-size:11px}'
      + '}';
    var s = doc.createElement('style');
    s.id = sid;
    s.textContent = css;
    doc.head.appendChild(s);
  }

  // ---------- UI构建 ----------
  var ui = null;   // { toolbar, dash, fileInput }

  // ===== 仪表盘数据计算 =====
  function getFieldValue(key) {
    if (key === 'character_book') {
      return cardData.character_book || null;
    }
    return cardData[key];
  }
  function isFieldNonEmpty(f, v) {
    if (v == null) return false;
    switch (f.type) {
      case 'text': case 'textarea': return typeof v === 'string' && v.trim().length >= (f.minLen ? Math.min(30, f.minLen / 2) : 30);
      case 'tags': case 'list': return Array.isArray(v) && v.length >= 1;
      case 'jsonlist': return Array.isArray(v) && v.length > 0;
      case 'entries': return !!(v && Array.isArray(v.entries) && v.entries.length > 0);
    }
    return false;
  }
  function fieldLenText(f) {
    var v = getFieldValue(f.key);
    switch (f.type) {
      case 'text': case 'textarea': return (v ? String(v).length : 0) + '字';
      case 'tags': return (v ? v.length : 0) + '项';
      case 'list': return (v ? v.length : 0) + '行';
      case 'jsonlist': return (v ? v.length : 0) + '条';
      case 'entries':
        var n = (v && v.entries) ? v.entries.length : 0;
        var tc = 0; if (v && v.entries) v.entries.forEach(function(e) { tc += (e.content || '').length; });
        return n + '条 / ' + tc + '字';
    }
    return '';
  }

  // 世界书条目按前缀统计
  function classifyEntries() {
    var entries = (cardData.character_book && cardData.character_book.entries) || [];
    var stats = {};
    DASH_MODULES.forEach(function(m) { stats[m.id] = { count: 0, chars: 0, items: [] }; });
    entries.forEach(function(e) {
      var comment = e.comment || '';
      var matched = null;
      // 1. 精确前缀 <xxx> 或 [xxx]
      var m1 = /^<([^>]+)>/.exec(comment) || /^\[([^\]]+)\]/.exec(comment);
      if (m1 && ENTRY_PREFIX_MAP[m1[1]]) {
        matched = ENTRY_PREFIX_MAP[m1[1]];
      }
      if (!matched) {
        // 2. 子串包含匹配
        for (var k in ENTRY_PREFIX_MAP) {
          if (comment.indexOf(k) >= 0) { matched = ENTRY_PREFIX_MAP[k]; break; }
        }
      }
      if (!matched) {
        // 3. 根据 constant/selective + position 推断
        if (e.constant === true) {
          if ((e.extensions && e.extensions.position === 0) || e.position === 0) matched = 'axiom';
          else matched = 'core';
        } else {
          var pos = (e.extensions && e.extensions.position != null) ? e.extensions.position : e.position;
          if (pos === 2) matched = 'opening';
          else if (pos === 4) matched = 'story';
          else matched = 'scene';
        }
      }
      if (!matched) matched = 'worldbook';
      if (!stats[matched]) matched = 'worldbook';
      stats[matched].count++;
      stats[matched].chars += (e.content || '').length;
      stats[matched].items.push(e);
    });
    return stats;
  }

  // 计算单个模块的完成度 0~100
  function calcModulePct(modId) {
    var f = FIELDS;
    var entries = classifyEntries();
    var cb = cardData.character_book || { entries: [] };

    switch (modId) {
      case 'basic': {
        var items = [
          { v: getFieldValue('name'), min: 2, ok: 1 },
          { v: getFieldValue('description'), min: 400, ok: 2 },
          { v: getFieldValue('personality'), min: 50, ok: 1, req: false },
          { v: getFieldValue('scenario'), min: 50, ok: 1, req: false },
        ];
        return calcItemsPct(items);
      }
      case 'core': {
        var items = [
          { v: getFieldValue('system_prompt'), min: 3, max: 50, ok: 1 },
          { v: getFieldValue('post_history_instructions'), min: 10, max: 100, ok: 2 },
          { v: getFieldValue('tags'), min: 2, arr: true, ok: 1 },
        ];
        var eCore = entries['core'] || { count: 0 };
        items.push({ v: '', arr: true, fakeCount: Math.min(eCore.count, 3), min: 3, ok: 1, req: false });
        return calcItemsPct(items);
      }
      case 'opening': {
        var items = [
          { v: getFieldValue('first_mes'), min: 500, ok: 3 },
        ];
        var eOp = entries['opening'] || { count: 0 };
        items.push({ v: '', fakeCount: eOp.count, min: 1, ok: 1, req: false });
        return calcItemsPct(items);
      }
      case 'highval': {
        var items = [
          { v: getFieldValue('mes_example'), min: 200, ok: 1, req: false },
          { v: getFieldValue('alternate_greetings'), min: 2, arr: true, ok: 1, req: false },
          { v: getFieldValue('depth_prompt'), min: 50, ok: 1, req: false },
        ];
        return calcItemsPct(items);
      }
      case 'worldbook': {
        var eWb = entries['worldbook'] || { count: 0, chars: 0 };
        var total = (cb.entries || []).length;
        var totalChars = 0; (cb.entries || []).forEach(function(e){ totalChars += (e.content||'').length; });
        var pctCount = Math.min(100, Math.round(100 * total / 15));  // 15条目标
        var pctChars = Math.min(100, Math.round(100 * totalChars / 4000));  // 4000字目标
        return Math.max(pctCount, pctChars);
      }
      case 'axiom': {
        var eA = entries['axiom'] || { count: 0, chars: 0 };
        var pctCount = Math.min(100, Math.round(100 * eA.count / 3));
        var pctChars = Math.min(100, Math.round(100 * eA.chars / 500));
        return Math.max(pctCount, pctChars);
      }
      case 'scene': {
        var eS = entries['scene'] || { count: 0, chars: 0 };
        var pctCount = Math.min(100, Math.round(100 * eS.count / 3));
        var pctChars = Math.min(100, Math.round(100 * eS.chars / 800));
        return Math.max(pctCount, pctChars);
      }
      case 'entity': {
        var eE = entries['entity'] || { count: 0, chars: 0 };
        var pctCount = Math.min(100, Math.round(100 * eE.count / 4));
        var pctChars = Math.min(100, Math.round(100 * eE.chars / 1000));
        return Math.max(pctCount, pctChars);
      }
      case 'story': {
        var eSt = entries['story'] || { count: 0, chars: 0 };
        var pctCount = Math.min(100, Math.round(100 * eSt.count / 3));
        var pctChars = Math.min(100, Math.round(100 * eSt.chars / 600));
        return Math.max(pctCount, pctChars);
      }
      case 'dynamic': {
        var items = [
          { v: getFieldValue('regex_scripts'), min: 1, arr: true, ok: 1, req: false },
        ];
        var eD = entries['dynamic'] || { count: 0 };
        items.push({ v: '', fakeCount: eD.count, min: 2, ok: 2, req: false });
        var pctScripts = calcItemsPct(items);
        // 变量系统检查
        var initCount = 0;
        (cb.entries || []).forEach(function(e) {
          var c = e.comment || '';
          if (c.indexOf('InitVar') >= 0 || c.indexOf('变量列表') >= 0 || c.indexOf('变量更新规则') >= 0) initCount++;
        });
        var pctVars = Math.min(100, Math.round(100 * initCount / 4));
        return Math.round((pctScripts + pctVars) / 2);
      }
    }
    return 0;
  }
  function calcItemsPct(items) {
    var score = 0, total = 0;
    items.forEach(function(it) {
      total += it.ok;
      var ok = false;
      if (it.arr) {
        var n = it.fakeCount != null ? it.fakeCount : (Array.isArray(it.v) ? it.v.length : 0);
        ok = n >= it.min;
      } else if (typeof it.v === 'string') {
        var l = it.v.trim().length;
        ok = l >= it.min;
        // 超长度不减分，但不超标加分
        if (it.max && l > it.max * 1.5) ok = false;  // 超标太多（如system_prompt>75字）减分
      } else if (it.v && typeof it.v === 'object') {
        ok = true;
      }
      if (ok) score += it.ok;
      else if (it.req === false && !ok) { /* 不填不加不减 */ }
      else if (typeof it.v === 'string' && it.v.trim().length > 0) score += it.ok * 0.3;
    });
    return total ? Math.round(100 * score / total) : 0;
  }
  // 模块详情字段列表
  function getModuleFields(modId) {
    var entryStats = classifyEntries();
    switch (modId) {
      case 'basic':
        return [
          { key: 'name', label: '名称' },
          { key: 'description', label: '世界观描述', min: 400 },
          { key: 'personality', label: '性格', req: false },
          { key: 'scenario', label: '场景', req: false },
        ];
      case 'core':
        return [
          { key: 'system_prompt', label: '系统指令', max: 50 },
          { key: 'post_history_instructions', label: '核心铁则', max: 100 },
          { key: 'tags', label: '标签' },
        ];
      case 'opening':
        return [
          { key: 'first_mes', label: '开场白', min: 500 },
        ];
      case 'highval':
        return [
          { key: 'mes_example', label: '对话示例', req: false },
          { key: 'alternate_greetings', label: '备用开场白', req: false },
          { key: 'depth_prompt', label: '新手引导', req: false },
        ];
      default:
        return [];
    }
  }
  function getModuleEntryCount(modId) {
    var e = classifyEntries();
    return (e[modId] && e[modId].count) || 0;
  }
  function getModuleEntries(modId) {
    var e = classifyEntries();
    return (e[modId] && e[modId].items) || [];
  }
  function getModuleSuggestions(modId, pct) {
    if (pct >= 90) return null;
    var s = [];
    switch (modId) {
      case 'basic':
        if (!getFieldValue('name')) s.push('请先填写角色/世界【名称】');
        var desc = (getFieldValue('description') || '').trim().length;
        if (desc < 400) s.push('【世界观描述】建议≥400字，当前仅' + desc + '字');
        break;
      case 'core':
        var sp = (getFieldValue('system_prompt') || '').trim();
        if (!sp) s.push('【系统指令】必须填写，≤50字的AI身份定位');
        else if (sp.length > 60) s.push('【系统指令】过长(' + sp.length + '字)，建议≤50字');
        var phi = (getFieldValue('post_history_instructions') || '').trim();
        if (!phi) s.push('【核心铁则】建议填写，≤100字（权重最高位）');
        else if (phi.length > 120) s.push('【核心铁则】过长(' + phi.length + '字)，建议精简到≤100字');
        var tg = getFieldValue('tags') || [];
        if (tg.length < 2) s.push('【标签】建议填写2-12个，便于检索');
        break;
      case 'opening':
        var fm = (getFieldValue('first_mes') || '').trim().length;
        if (fm < 500) s.push('【开场白】强烈建议≥500字，充分铺垫场景与氛围（当前' + fm + '字）');
        break;
      case 'highval':
        var me = (getFieldValue('mes_example') || '').trim().length;
        if (me < 200) s.push('【对话示例】建议填写1-2组Few-shot，提升角色语气一致性');
        var ag = (getFieldValue('alternate_greetings') || []).length;
        if (ag < 2) s.push('【备用开场白】建议填写2-3个差异化开局（不同身份/难度）');
        break;
      case 'worldbook':
        var total = ((cardData.character_book && cardData.character_book.entries) || []).length;
        if (total < 5) s.push('世界书条目偏少(' + total + '条)，建议≥10条承载完整世界观');
        break;
      case 'axiom':
        if (getModuleEntryCount('axiom') < 2) s.push('建议添加<基础公理>/<世界元数据>/<核心铁则>常驻条目（position=0）');
        break;
      case 'scene':
        if (getModuleEntryCount('scene') < 2) s.push('建议添加<场景机制>/<核心玩法>/<世界规则>触发类条目');
        break;
      case 'entity':
        if (getModuleEntryCount('entity') < 3) s.push('建议添加<重要角色>/<势力与组织>/<物品>/<地点场景>等实体条目');
        break;
      case 'story':
        if (getModuleEntryCount('story') < 2) s.push('建议添加<叙事背景>/<故事发展>/<文化与习俗>/<历史事件>叙事组条目');
        break;
      case 'dynamic':
        var rs = (getFieldValue('regex_scripts') || []).length;
        if (rs < 1) s.push('建议添加正则脚本或<动态适配>/<引导机制>/<状态栏>等动态适配条目');
        break;
    }
    return s;
  }

  // 总完成度
  function calcOverallCompletion() {
    var total = 0;
    DASH_MODULES.forEach(function(m) { total += calcModulePct(m.id); });
    return Math.round(total / DASH_MODULES.length);
  }

  // 质量检查（增强版：含触发词、自包含性、递归安全、MVU等）
  function runQualityChecks() {
    var r = [];
    var overall = 0, passed = 0;
    function add(pass, level, title, desc) {
      r.push({ pass: pass, level: level, title: title, desc: desc });
      if (pass) passed++;
      overall++;
    }
    // 1. 必填字段
    FIELDS.filter(function(f){ return f.required; }).forEach(function(f) {
      var v = getFieldValue(f.key);
      var ok = isFieldNonEmpty(f, v);
      add(ok, ok ? 'pass' : 'fail',
        f.label + ' 填写',
        ok ? '已填写 (' + fieldLenText(f) + ')' : '该字段为必填项，请补充内容');
    });
    // 2. 字数规范
    var d = (getFieldValue('description') || '').trim().length;
    add(d >= 400, d >= 400 ? 'pass' : (d > 100 ? 'warn' : 'fail'),
      '世界观描述 ≥400字',
      '当前 ' + d + '字，' + (d >= 400 ? '符合建议长度' : (d > 100 ? '继续完善细节即可' : '过于简略，建议扩充')));
    var fm = (getFieldValue('first_mes') || '').trim().length;
    add(fm >= 500, fm >= 500 ? 'pass' : (fm > 150 ? 'warn' : 'fail'),
      '开场白 ≥500字',
      '当前 ' + fm + '字，' + (fm >= 500 ? '符合建议长度' : (fm > 150 ? '可进一步丰富场景描写和互动引导' : '内容不足，建议充实')));
    var sp = (getFieldValue('system_prompt') || '').trim().length;
    add(sp > 0 && sp <= 50, sp > 0 && sp <= 50 ? 'pass' : (sp > 0 ? 'warn' : 'fail'),
      '系统指令 ≤50字',
      '当前 ' + sp + '字，' + (sp === 0 ? '未填写' : (sp <= 50 ? '精简恰当' : '过长，建议精简为纯身份定位')));
    var phi = (getFieldValue('post_history_instructions') || '').trim().length;
    add(phi > 0 && phi <= 100, phi > 0 && phi <= 100 ? 'pass' : (phi > 0 ? 'warn' : 'fail'),
      '核心铁则 ≤100字',
      '当前 ' + phi + '字，' + (phi === 0 ? '未填写（权重最高位，强烈建议填写）' : (phi <= 100 ? '合适' : '过长，建议精简')));
    // 3. 标签规范
    var tg = getFieldValue('tags') || [];
    add(tg.length >= 2 && tg.length <= 12, tg.length >= 2 ? 'pass' : 'fail',
      '标签数量 2~12个',
      '当前 ' + tg.length + ' 个，' + (tg.length >= 2 && tg.length <= 12 ? '合理' : (tg.length < 2 ? '过少，建议补充便于检索的关键词' : '过多，精选核心标签即可')));
    // 4. 世界书
    var entries = (cardData.character_book && cardData.character_book.entries) || [];
    if (entries.length > 0) {
      var shortEntries = entries.filter(function(e) { return (e.content || '').trim().length < 100; });
      add(shortEntries.length === 0, shortEntries.length === 0 ? 'pass' : 'warn',
        '世界书条目充实度',
        shortEntries.length === 0 ? entries.length + '条条目均≥100字' : shortEntries.length + '条条目<100字，建议补充');
      // 前缀规范
      var noPrefix = entries.filter(function(e) { return !/^[<\[【]/.test(e.comment || ''); });
      add(noPrefix.length === 0, noPrefix.length < entries.length * 0.5 ? 'pass' : 'warn',
        '条目前缀模板规范',
        noPrefix.length === 0 ? '全部使用<前缀>模板命名' : noPrefix.length + '条未加前缀（如<基础公理>/<角色名>），智能匹配精度下降');
      // 触发词覆盖率
      var entriesWithKeys = entries.filter(function(e) { return Array.isArray(e.keys) && e.keys.length > 0; }).length;
      add(entriesWithKeys >= entries.length * 0.5, entriesWithKeys >= entries.length * 0.5 ? 'pass' : (entriesWithKeys > 0 ? 'warn' : 'fail'),
        '触发词覆盖率 ≥50%',
        entriesWithKeys + '/' + entries.length + ' 条有触发词' + (entriesWithKeys < entries.length * 0.5 ? '，建议为更多条目设置精准keys' : '，覆盖良好'));
      // 触发词精准度（避免泛用词）
      var fuzzyWords = ['的','是','了','在','和','有','我','你','他','她','它','这','那','不','也','就','都','而','及','与','或','一个','什么','怎么','为'];
      var riskyEntries = 0;
      entries.forEach(function(e) {
        if (!Array.isArray(e.keys) || e.keys.length === 0) return;
        for (var i = 0; i < e.keys.length; i++) {
          var k = String(e.keys[i]).trim();
          if (k.length <= 1 && fuzzyWords.indexOf(k) >= 0) { riskyEntries++; break; }
        }
      });
      add(riskyEntries === 0, riskyEntries === 0 ? 'pass' : 'warn',
        '触发词精准度',
        riskyEntries === 0 ? '未发现泛用触发词' : riskyEntries + '条使用了"的/是/了"等泛用词，改用领域专属词汇');
      // content自包含性（禁止上下文依赖词）
      var ctxDependentWords = ['如上所述','见上文','前文提到','如前所述','参见上文','上文中','以上所述','前面提到'];
      var ctxBadEntries = entries.filter(function(e) {
        var c = e.content || '';
        for (var i = 0; i < ctxDependentWords.length; i++) {
          if (c.indexOf(ctxDependentWords[i]) >= 0) return true;
        }
        return false;
      }).length;
      add(ctxBadEntries === 0, ctxBadEntries === 0 ? 'pass' : 'warn',
        '条目自包含性（无上下文依赖）',
        ctxBadEntries === 0 ? '所有条目内容完整独立' : ctxBadEntries + '条含"如上所述/见上文"等词，需改为完整自描述');
      // 递归安全：实体交互类条目应有 prevent_recursion
      var entityPrefix = ['实体交互','重要角色','势力与组织','物品','地点场景'];
      var unsafeEntityCount = 0;
      entries.forEach(function(e) {
        var c = e.comment || '';
        var isEntity = false;
        for (var i = 0; i < entityPrefix.length; i++) {
          if (c.indexOf(entityPrefix[i]) >= 0) { isEntity = true; break; }
        }
        if (!isEntity) return;
        var ext = e.extensions || {};
        if (e.prevent_recursion !== true && ext.prevent_recursion !== true) unsafeEntityCount++;
      });
      add(unsafeEntityCount === 0, unsafeEntityCount === 0 ? 'pass' : 'warn',
        '递归安全：实体类 prevent_recursion',
        unsafeEntityCount === 0 ? '实体类条目已防递归' : unsafeEntityCount + '条实体类未开启，链式触发可能导致Token爆炸');
      // 冷却防抖：场景类条目应有 cooldown
      var scenePrefix = ['场景机制','核心玩法','世界规则'];
      var noCooldownSceneCount = 0;
      entries.forEach(function(e) {
        var c = e.comment || '';
        var isScene = false;
        for (var i = 0; i < scenePrefix.length; i++) {
          if (c.indexOf(scenePrefix[i]) >= 0) { isScene = true; break; }
        }
        if (!isScene) return;
        var ext = e.extensions || {};
        var cd = (ext.cooldown != null) ? ext.cooldown : e.cooldown;
        if (cd == null || cd < 1) noCooldownSceneCount++;
      });
      add(noCooldownSceneCount === 0, noCooldownSceneCount === 0 ? 'pass' : 'warn',
        '冷却防抖：场景类 cooldown≥3',
        noCooldownSceneCount === 0 ? '场景类条目已设冷却' : noCooldownSceneCount + '条场景类无cooldown，触发后可能连续刷屏');
      // position合理性：constant应为position≤1
      var badConstPos = 0;
      entries.forEach(function(e) {
        if (e.constant !== true) return;
        var ext = e.extensions || {};
        var pos = (ext.position != null) ? ext.position : e.position;
        if (pos != null && pos > 1) badConstPos++;
      });
      add(badConstPos === 0, badConstPos === 0 ? 'pass' : 'warn',
        'position配置：constant条目≤1',
        badConstPos === 0 ? 'position配置合理' : badConstPos + '条constant条目position>1，常驻条目应放在0或1位');
      // MVU核心条目完整性
      var mvuInit = entries.filter(function(e) { return /\[InitVar\]|初始变量/.test(e.comment || ''); }).length;
      var mvuVarList = entries.filter(function(e) { return /变量列表/.test(e.comment || ''); }).length;
      var mvuUpdate = entries.filter(function(e) { return /变量更新规则/.test(e.comment || ''); }).length;
      var mvuHasAny = (mvuInit + mvuVarList + mvuUpdate) > 0;
      if (mvuHasAny) {
        var mvuMissing = [];
        if (mvuInit === 0) mvuMissing.push('[InitVar]初始变量');
        if (mvuVarList === 0) mvuMissing.push('变量列表');
        if (mvuUpdate === 0) mvuMissing.push('变量更新规则');
        add(mvuMissing.length === 0, mvuMissing.length === 0 ? 'pass' : 'warn',
          'MVU核心条目完整',
          mvuMissing.length === 0 ? 'MVU四件套已齐备' : '缺少：' + mvuMissing.join('、') + '（启用了变量系统时必备）');
        // [InitVar]条目必须enabled=false
        var enabledInitVar = entries.filter(function(e) {
          return /\[InitVar\]|初始变量/.test(e.comment || '') && e.enabled !== false;
        }).length;
        add(enabledInitVar === 0, enabledInitVar === 0 ? 'pass' : 'fail',
          '[InitVar]条目必须禁用',
          enabledInitVar === 0 ? '正确（MVU仅读取禁用的InitVar条目进行初始化）' : enabledInitVar + '条[InitVar]已启用，请改为disabled=false');
        // 变量列表应含format宏
        var varListWithoutMacro = entries.filter(function(e) {
          if (!/变量列表/.test(e.comment || '')) return false;
          return (e.content || '').indexOf('format_message_variable::stat_data') < 0;
        }).length;
        add(varListWithoutMacro === 0, varListWithoutMacro === 0 ? 'pass' : 'fail',
          '变量列表含format_message_variable宏',
          varListWithoutMacro === 0 ? '正确' : varListWithoutMacro + '条变量列表缺少{{format_message_variable::stat_data}}宏，LLM无法读取当前变量');
      }
      // 世界书条目重复检测（按comment精确匹配）
      var dupMap = {};
      entries.forEach(function(e) {
        var k = (e.comment || '').trim() || '__unnamed__';
        if (!dupMap[k]) dupMap[k] = 0;
        dupMap[k]++;
      });
      var dupNames = [];
      for (var dk in dupMap) { if (dupMap[dk] > 1) dupNames.push(dk + '×' + dupMap[dk]); }
      add(dupNames.length === 0, dupNames.length === 0 ? 'pass' : 'warn',
        '世界书条目无重复命名',
        dupNames.length === 0 ? '条目命名唯一' : '发现重复：' + dupNames.slice(0, 3).join('、') + (dupNames.length > 3 ? ' 等' : ''));
    }
    // 5. 高价值字段
    var hvCount = 0;
    if ((getFieldValue('mes_example') || '').length > 100) hvCount++;
    if ((getFieldValue('alternate_greetings') || []).length >= 2) hvCount++;
    if ((getFieldValue('depth_prompt') || '').length > 20) hvCount++;
    add(hvCount >= 1, hvCount >= 2 ? 'pass' : (hvCount === 1 ? 'warn' : 'fail'),
      '高价值字段覆盖',
      '已启用 ' + hvCount + '/3 项：对话示例/备用开局/新手引导' + (hvCount < 2 ? '（建议≥2项）' : ''));
    return { items: r, pct: overall ? Math.round(100 * passed / overall) : 0 };
  }

  // ===== 工具：世界书条目去重 =====
  function dedupEntries() {
    var cb = cardData.character_book || { entries: [] };
    var arr = cb.entries || [];
    var seen = {};
    var result = [];
    var removed = 0;
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      var k = (e.comment || '').trim();
      if (!k) { result.push(e); continue; }
      if (seen[k]) {
        // 保留内容更长的那条
        var oldIdx = seen[k];
        if ((e.content || '').length > (result[oldIdx].content || '').length) {
          result[oldIdx] = e;
        }
        removed++;
      } else {
        seen[k] = result.length;
        result.push(e);
      }
    }
    cb.entries = result;
    cardData.character_book = cb;
    ensureCardDataShape();
    saveAll();
    return removed;
  }

  // ===== 工具：一键修正条目配置（按前缀补全缺失配置）=====
  function fixEntryConfigs() {
    var cb = cardData.character_book || { entries: [] };
    var arr = cb.entries || [];
    var fixed = 0;
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      var before = JSON.stringify(e);
      applyPrefixDefaults(e);
      if (JSON.stringify(e) !== before) fixed++;
    }
    cb.entries = arr;
    cardData.character_book = cb;
    ensureCardDataShape();
    saveAll();
    return fixed;
  }

  // ===== 工具：生成优化建议清单（可复制给AI用）=====
  function buildOptimizeChecklist() {
    var qc = runQualityChecks();
    var failed = qc.items.filter(function(x) { return !x.pass; });
    if (failed.length === 0) return '当前所有质量检查项均已达标，无需优化。';
    // 指令映射（问题→影响→修复）
    var instrMap = {
      '名称': '设置一个简洁有力的世界名称，不超过15字',
      '世界观描述': '补充世界观描述到≥400字，覆盖核心设定、地理、历史、文化、社会结构，语言生动具体',
      '开场白': '扩展开场白到500-800字，结构：场景描写→动作驱动→内心独白→自然对话→结尾留钩',
      '系统指令': '精简system_prompt到≤50字，仅保留AI身份定位一句话；核心规则迁移到post_history_instructions',
      '核心铁则': '设置≤100字的post_history_instructions核心铁则，分号分隔短句（权重最高位）',
      '标签': '设置2-12个简短精准的标签，便于检索',
      '条目充实度': '将世界书<100字的条目扩充到≥100字，提供完整自包含的信息',
      '前缀模板规范': '为世界书条目使用规范前缀命名：<基础公理>、<核心铁则>、<场景机制>、<实体交互>、<叙事背景>、<动态系统>等',
      '触发词覆盖率': '为≥50%的世界书条目设置精准keys触发词，每条目3-8个同义词/变体，避免泛用词',
      '触发词精准度': '移除"的/是/了/在"等泛用触发词，改用领域专属词汇',
      '自包含性': '移除条目中"如上所述/见上文/前文提到"等上下文依赖词，确保每条content完整独立',
      '递归安全': '为<实体交互>/<重要角色>/<势力与组织>/<物品>/<地点场景>等条目开启 extensions.prevent_recursion=true，防链式触发',
      '冷却防抖': '为<场景机制>/<核心玩法>/<世界规则>等条目设置 extensions.cooldown=3，触发后冷却防抖',
      'position配置': 'constant=true的常驻条目，extensions.position必须≤1（0或1位）',
      'MVU核心条目': '补全MVU四件套：[InitVar]初始变量(enabled=false)、变量列表（含{{format_message_variable::stat_data}}宏）、变量更新规则、变量输出格式',
      '[InitVar]条目必须禁用': '将[InitVar]初始变量条目的enabled改为false（MVU仅读取禁用条目初始化）',
      '变量列表含format': '在变量列表条目内容中添加宏：---\\n<status_current_variable>\\n{{format_message_variable::stat_data}}\\n</status_current_variable>',
      '条目无重复命名': '合并或重命名重复命名的世界书条目',
      '高价值字段覆盖': '补充对话示例(1-2组Few-shot)、备用开场白(≥3个差异化开局)、新手引导depth_prompt',
    };
    var lines = [];
    lines.push('# 角色卡优化清单（共' + failed.length + '项未达标）');
    lines.push('');
    lines.push('## 当前质量评分：' + qc.pct + '/100（' + (qc.items.length - failed.length) + '/' + qc.items.length + ' 通过）');
    lines.push('');
    lines.push('## 待优化项详情（问题→修复建议）');
    lines.push('');
    failed.forEach(function(it, idx) {
      lines.push('### ' + (idx + 1) + '. ' + it.title.replace(/^[✅❌⚠️📐🏷️📚🔑📦🛡️⏱️📍🔧🗂️💎 ]+/, '').trim());
      lines.push('- **当前状态**：' + it.desc);
      // 匹配关键词找修复建议
      var fixAdvice = '请根据当前状态手动修复，或提供更详细的要求';
      for (var kw in instrMap) {
        if (it.title.indexOf(kw) >= 0 || it.desc.indexOf(kw) >= 0) {
          fixAdvice = instrMap[kw];
          break;
        }
      }
      lines.push('- **修复建议**：' + fixAdvice);
      lines.push('');
    });
    lines.push('## 输出要求');
    lines.push('- 输出一个```json```代码块，仅包含需要修改/新增的字段');
    lines.push('- 世界书条目顶层写在 `entries` 数组中（不嵌套在character_book）');
    lines.push('- 优化已有条目时，使用完全相同的comment来精准覆盖');
    lines.push('- 仅输出JSON代码块，不要额外文字说明');
    return lines.join('\n');
  }

  // ===== SVG环形进度生成 =====
  function ringSvg(pct, size) {
    size = size || 48;
    var cx = size / 2, cy = size / 2, r = (size - 5) / 2;
    var c = 2 * Math.PI * r;
    var offset = c - (pct / 100) * c;
    var cls = 'low';
    if (pct >= 90) cls = 'done';
    else if (pct >= 50) cls = 'partial';
    else if (pct >= 20) cls = 'warn';
    return '<svg width="' + size + '" height="' + size + '"><circle class="cm-ring-bg" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>'
      + '<circle class="cm-ring-fg" cx="' + cx + '" cy="' + cy + '" r="' + r + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '"/></svg>';
  }

  // ========== 渲染 ==========
  function renderToolbar() {
    var doc = pd(); if (!doc || !doc.body) return;
    removeAll();
    injectStyles();

    var tb = doc.createElement('div');
    tb.id = SCRIPT_ID;
    tb.innerHTML = ''
      + '<span class="cm-handle" title="拖动移动">⋮⋮</span>'
      + '<button class="cm-btn primary" data-act="toggle-dash">仪表盘</button>'
      + '<span class="cm-sep"></span>'
      + '<button class="cm-btn" data-act="write" title="重新扫描本地数据并刷新仪表盘">刷新</button>'
      + '<button class="cm-btn" data-act="scan"  title="扫描最近聊天，把```json```写进面板">扫消息</button>'
      + '<button class="cm-btn" data-act="import" title="导入角色卡JSON">导入</button>'
      + '<button class="cm-btn success" data-act="export" title="导出 chara_card_v3.json（下载）">导出</button>'
      + '<span class="cm-sep"></span>'
      + '<span class="cm-completion">完成度 <b data-cmp>0%</b></span>';
    doc.body.appendChild(tb);

    var dash = doc.createElement('div');
    dash.id = SCRIPT_ID + '-dash';
    dash.innerHTML = ''
      + '<div class="cm-dh" id="cm-dhead">'
      + '  <strong>时之写卡器</strong>'
      + '  <span class="cm-dsub">10模块进度 · 点击查看详情</span>'
      + '  <div class="cm-dright">'
      + '    <span class="cm-completion">完成度 <b data-cmp2>0%</b></span>'
      + '    <button class="cm-dclose" data-act="close-dash" title="收起">×</button>'
      + '  </div>'
      + '</div>'
      + '<div class="cm-dash-tabs" id="cm-dtabs">'
      + '  <button class="cm-dtab active" data-view="dashboard">进度仪表盘</button>'
      + '  <button class="cm-dtab" data-view="qc">质量检查</button>'
      + '  <button class="cm-dtab" data-view="worldbook">世界书概览</button>'
      + '  <button class="cm-dtab" data-view="tools">快捷工具</button>'
      + '</div>'
      + '<div class="cm-dbody" id="cm-dbody"></div>';
    doc.body.appendChild(dash);

    var fi = doc.createElement('input');
    fi.type = 'file'; fi.accept = '.json,application/json';
    fi.id = SCRIPT_ID + '-file';
    fi.className = SCRIPT_ID + '-file';
    doc.body.appendChild(fi);

    ui = { toolbar: tb, dash: dash, fileInput: fi, view: 'dashboard' };

    applyToolbarPosition(tb);
    tb.addEventListener('click', onToolbarClick);
    dash.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { handleAction(b.getAttribute('data-act')); });
    });
    dash.querySelectorAll('[data-view]').forEach(function(b) {
      b.addEventListener('click', function() { switchView(b.getAttribute('data-view')); });
    });
    dash.querySelector('#cm-dhead').addEventListener('pointerdown', function (e) { onPanelDragStart(e, dash); });
    tb.querySelector('.cm-handle').addEventListener('pointerdown', function (e) { onPanelDragStart(e, tb, true); });

    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(String(r.result || ''));
          mergeImportedCardData(data);
          saveAll();
          renderDashboardView();
          toast('已导入 ' + f.name);
        } catch (err) {
          toast('导入失败：JSON解析错误', true);
        } finally { fi.value = ''; }
      };
      r.readAsText(f, 'utf-8');
    });

    if (state.dashOpen) setDashOpen(true, true);
    renderDashboardView();
    updateCompletion();
    bindChatObserver();
  }

  function switchView(v) {
    if (!ui) return;
    ui.view = v;
    ui.dash.querySelectorAll('.cm-dtab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-view') === v);
    });
    if (v === 'dashboard') renderDashboardView();
    else if (v === 'qc') renderQCView();
    else if (v === 'worldbook') renderWBView();
    else if (v === 'tools') renderToolsView();
  }

  // --- 仪表盘视图：10个环形进度卡 + 详情 ---
  function renderDashboardView() {
    if (!ui) return;
    var body = ui.dash.querySelector('#cm-dbody');
    var html = '';
    // 环形网格
    html += '<div class="cm-ring-grid">';
    DASH_MODULES.forEach(function(m) {
      var pct = calcModulePct(m.id);
      var badgeCls = 'empty';
      if (pct >= 90) badgeCls = 'done';
      else if (pct >= 50) badgeCls = 'partial';
      else if (pct >= 20) badgeCls = 'warn';
      var ringCls = 'low';
      if (pct >= 90) ringCls = 'done';
      else if (pct >= 50) ringCls = 'partial';
      else if (pct >= 20) ringCls = 'warn';
      var active = (state.activeModule === m.id) ? 'active' : '';
      html += '<div class="cm-ring-card ' + active + '" data-mod="' + m.id + '" title="' + esc(m.desc) + '">'
        + '<span class="cm-rc-badge ' + badgeCls + '"></span>'
        + '<div class="cm-ring-wrap ' + ringCls + '">'
        + ringSvg(pct, 44)
        + '<span class="cm-ring-pct">' + pct + '%</span>'
        + '</div>'
        + '<span class="cm-rc-name">' + m.name + '</span>'
        + '</div>';
    });
    html += '</div>';

    // 模块详情
    var modId = state.activeModule || 'basic';
    var mod = DASH_MODULES.find(function(m) { return m.id === modId; }) || DASH_MODULES[0];
    var pct = calcModulePct(modId);
    var sug = getModuleSuggestions(modId, pct);
    html += '<div class="cm-mod-detail">';
    html += '<div class="cm-md-head">'
      + '<span class="cm-md-name">' + mod.name + '</span>'
      + '<span class="cm-md-desc">' + mod.desc + '</span></div>';
    // 统计4格
    var mFields = getModuleFields(modId);
    var mEntries = getModuleEntries(modId);
    var entryStats = classifyEntries();
    var mStat = entryStats[modId] || { count: 0, chars: 0 };
    var avgChars = mStat.count > 0 ? Math.round(mStat.chars / mStat.count) : 0;
    var fieldTokens = 0;
    if (mFields.length > 0) {
      mFields.forEach(function(f) {
        var val = getFieldValue(f.key);
        if (typeof val === 'string') fieldTokens += countTokens(val);
        else if (Array.isArray(val)) val.forEach(function(v){fieldTokens += countTokens(typeof v === 'string' ? v : JSON.stringify(v));});
      });
    }
    var entryTokens = 0;
    mEntries.forEach(function(e) { entryTokens += countTokens(e.content || ''); });
    var totalTok = fieldTokens + entryTokens;
    html += '<div class="cm-md-stats">'
      + '<div class="cm-md-stat"><b>' + pct + '%</b><span>完成度</span></div>'
      + '<div class="cm-md-stat"><b>' + mStat.count + '</b><span>条目数</span></div>'
      + '<div class="cm-md-stat"><b>' + mStat.chars + '</b><span style="font-size:9px;line-height:1.2">字 / ' + totalTok + ' tok</span></div>'
      + '<div class="cm-md-stat"><b>' + avgChars + '</b><span>条均字数</span></div>'
      + '</div>';
    // 字段列表
    if (mFields.length > 0) {
      html += '<div class="cm-md-section"><h4>字段状态</h4><div class="cm-md-list">';
      mFields.forEach(function(f) {
        var val = getFieldValue(f.key);
        var l = 0, isArr = Array.isArray(val);
        if (isArr) l = val.length;
        else if (typeof val === 'string') l = val.trim().length;
        var dot = 'empty';
        if (f.req === false && l === 0) dot = 'empty';
        else if (f.min && l < f.min) dot = l > 0 ? 'part' : 'bad';
        else if (f.max && l > f.max * 1.5) dot = 'bad';
        else if (l > 0) dot = f.min && l >= f.min ? 'ok' : 'part';
        else dot = f.req === false ? 'empty' : 'bad';
        var valText = fieldLenText(f);
        if (f.min && l < f.min && l > 0) valText += ' / 建议≥' + f.min;
        if (f.max && l > f.max) valText += ' / 超标(≤' + f.max + ')';
        html += '<div class="cm-md-item">'
          + '<span class="cm-mi-dot ' + dot + '"></span>'
          + '<span class="cm-mi-name">' + f.label + (f.req === false ? ' (选填)' : '') + '</span>'
          + '<span class="cm-mi-val">' + valText + '</span>'
          + '</div>';
      });
      html += '</div></div>';
    }
    // 条目预览
    if (mEntries.length > 0) {
      html += '<div class="cm-md-section"><h4>条目预览（最近3条）</h4><div class="cm-md-list">';
      mEntries.slice(-3).reverse().forEach(function(e) {
        var cl = (e.content || '').trim().length;
        var dot = cl >= 250 ? 'ok' : (cl >= 100 ? 'part' : (cl > 0 ? 'bad' : 'empty'));
        var name = (e.comment || '未命名').replace(/^[<\[【]([^>\]】]+)[>\]】]/, '').trim() || (e.comment || '未命名');
        html += '<div class="cm-md-item">'
          + '<span class="cm-mi-dot ' + dot + '"></span>'
          + '<span class="cm-mi-name" style="max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + '</span>'
          + '<span class="cm-mi-val">' + cl + '字' + (e.enabled === false ? ' · 已禁用' : '') + '</span>'
          + '</div>';
      });
      html += '</div></div>';
      // 内容预览
      var last = mEntries[mEntries.length - 1];
      if (last && last.content) {
        html += '<div class="cm-md-section"><h4>最新条目内容</h4>'
          + '<div class="cm-md-preview">' + esc(last.content.slice(0, 400) + (last.content.length > 400 ? '...' : '')) + '</div>'
          + '</div>';
      }
    }
    // 建议
    if (sug && sug.length > 0) {
      html += '<div class="cm-md-suggest"><b>改进建议</b><br>• ' + sug.join('<br>• ') + '</div>';
    } else if (pct >= 90) {
      html += '<div class="cm-md-ok"><b>模块状态优秀</b> 所有核心项均已达标</div>';
    }
    html += '</div>';

    body.innerHTML = html;
    // 点击卡片切换激活模块
    body.querySelectorAll('.cm-ring-card').forEach(function(c) {
      c.addEventListener('click', function() {
        state.activeModule = c.getAttribute('data-mod');
        saveLS(LS_KEY, state);
        renderDashboardView();
      });
    });
    updateCompletion();
  }

  // --- 质量检查视图 ---
  function renderQCView() {
    if (!ui) return;
    var body = ui.dash.querySelector('#cm-dbody');
    var qc = runQualityChecks();
    var html = '<div class="cm-qc-score"><b>' + qc.pct + '</b><span>整体质量评分 / 100（' + qc.items.filter(function(x){return x.pass}).length + '/' + qc.items.length + ' 通过）</span></div>';
    qc.items.forEach(function(it) {
      html += '<div class="cm-qc-item ' + it.level + '">'
        + '<span class="cm-qc-dot ' + it.level + '"></span>'
        + '<div class="cm-qc-content">'
        + '<div class="cm-qc-title">' + it.title + '</div>'
        + '<div class="cm-qc-desc">' + it.desc + '</div>'
        + '</div></div>';
    });
    body.innerHTML = html;
  }

  // --- 世界书概览视图 ---
  function renderWBView() {
    if (!ui) return;
    var body = ui.dash.querySelector('#cm-dbody');
    var entries = (cardData.character_book && cardData.character_book.entries) || [];
    var eStats = classifyEntries();
    if (entries.length === 0) {
      body.innerHTML = '<div class="cm-empty">暂无世界书条目<br>开始创作后，这里会显示条目分组与详情</div>';
      return;
    }
    var totalChars = 0; entries.forEach(function(e){ totalChars += (e.content||'').length; });
    var totalTok = 0; entries.forEach(function(e){ totalTok += countTokens(e.content || ''); });
    var constCount = entries.filter(function(e){ return e.constant === true; }).length;
    var trigCount = entries.length - constCount;
    var avgChars = Math.round(totalChars / entries.length);
    var avgTok = Math.round(totalTok / entries.length);
    // 触发词覆盖率
    var withKeys = entries.filter(function(e){ return Array.isArray(e.keys) && e.keys.length > 0; }).length;
    var keyRate = Math.round(100 * withKeys / entries.length);
    // 条目配置完整度（有extensions且至少2项配置）
    var wellConfigured = entries.filter(function(e){
      var ext = e.extensions || {};
      var extCount = 0;
      for (var k in ext) { if (ext[k] != null && ext[k] !== '') extCount++; }
      return (e.constant != null) && (e.selective != null) && extCount >= 2;
    }).length;
    var cfgRate = Math.round(100 * wellConfigured / entries.length);

    var html = '<div class="cm-wv-summary">'
      + '<div class="cm-wv-stat"><b>' + entries.length + '</b><span>总条目</span></div>'
      + '<div class="cm-wv-stat"><b>' + totalChars + '</b><span style="font-size:9px;line-height:1.2">字 / ' + totalTok + ' tok</span></div>'
      + '<div class="cm-wv-stat"><b>' + avgChars + '</b><span style="font-size:9px;line-height:1.2">条均字 / ' + avgTok + ' tok</span></div>'
      + '<div class="cm-wv-stat"><b>' + constCount + '/' + trigCount + '</b><span>常驻 / 触发</span></div>'
      + '</div>';

    // 健康指标（触发词覆盖率 + 配置完整度）
    html += '<div class="cm-md-stats" style="margin-bottom:12px">'
      + '<div class="cm-md-stat"><b style="color:' + (keyRate >= 50 ? 'var(--cm-green)' : (keyRate >= 20 ? 'var(--cm-warn)' : 'var(--cm-danger)')) + '">' + keyRate + '%</b><span>触发词覆盖率</span></div>'
      + '<div class="cm-md-stat"><b>' + withKeys + '</b><span>有keys条目</span></div>'
      + '<div class="cm-md-stat"><b style="color:' + (cfgRate >= 60 ? 'var(--cm-green)' : (cfgRate >= 30 ? 'var(--cm-warn)' : 'var(--cm-danger)')) + '">' + cfgRate + '%</b><span>配置完整度</span></div>'
      + '<div class="cm-md-stat"><b>' + wellConfigured + '</b><span>配置齐全条目</span></div>'
      + '</div>';

    // 权重等级图例
    var usedW = {};
    entries.forEach(function(e) { var w = getWeightLevel(e.comment || ''); if(w) usedW[w.level] = w; });
    html += '<div class="cm-wv-legend">';
    for (var lk in usedW) {
      html += '<span class="cm-wv-legend-item"><span class="cm-wv-legend-dot" style="background:' + usedW[lk].color + '"></span>' + lk + '</span>';
    }
    html += '</div>';

    // 按模块分组展示
    var modulesWithEntries = DASH_MODULES.filter(function(m) {
      return (eStats[m.id] && eStats[m.id].count > 0) || m.id === 'worldbook';
    });
    modulesWithEntries.forEach(function(m) {
      var list = [];
      if (m.id === 'worldbook') {
        // 显示未分类的 + 汇总
        var shownIds = {};
        modulesWithEntries.forEach(function(mm) { if (mm.id !== 'worldbook') eStats[mm.id].items.forEach(function(e) { shownIds[e] = true; }); });
        list = entries.filter(function(e) {
          for (var mid in eStats) {
            if (mid !== 'worldbook' && eStats[mid].items.indexOf(e) >= 0) return false;
          }
          return true;
        });
        if (list.length === 0) return;
      } else {
        list = eStats[m.id].items;
      }
      if (list.length === 0) return;
      html += '<div class="cm-wv-group"><div class="cm-wv-group-head">'
        + '<span>' + m.icon + ' ' + m.name + '</span>'
        + '<span class="cm-gh-count">' + list.length + '条</span>'
        + '</div>';
      list.forEach(function(e) {
        var len = (e.content || '').trim().length;
        var tok = countTokens(e.content || '');
        var lvl = 1;
        var pos = (e.extensions && e.extensions.position != null) ? e.extensions.position : e.position;
        if (pos === 0) lvl = 1;
        else if (pos === 1) lvl = 2;
        else if (pos === 2) lvl = 3;
        else if (pos === 4) lvl = 4;
        else if (pos === 2) lvl = 3;
        var constant = e.constant === true;
        var tags = [];
        if (constant) tags.push({ t: '常驻', cls: 'const' });
        else tags.push({ t: '触发', cls: 'trig' });
        if (len < 100 && len > 0) tags.push({ t: '偏短', cls: 'warn' });
        if (e.enabled === false) tags.push({ t: '禁用', cls: 'warn' });
        // 权重等级标签
        var wl = getWeightLevel(e.comment || '');
        if (wl) tags.push({ t: '权重:' + wl.level, cls: 'trig', customColor: wl.color });
        var name = e.comment || '未命名条目';
        name = name.replace(/^[<\[【]([^>\]】]+)[>\]】]/, function(_, p1) {
          return '[' + p1 + '] ';
        });
        html += '<div class="cm-wv-entry lvl-' + lvl + '" title="' + esc(wl ? wl.desc : '') + '">'
          + '<div class="cm-wv-entry-header">'
          + '<span class="cm-wv-entry-name">' + esc(name) + '</span>'
          + '<span class="cm-wv-entry-level lvl-' + lvl + '">P' + (pos != null ? pos : '-') + '</span>'
          + '<span class="cm-wv-entry-token">' + len + '字 / ' + tok + 't</span>'
          + '</div>'
          + '<div class="cm-wv-entry-meta">'
          + tags.map(function(tg) {
              var col = tg.customColor ? ' style="border-color:' + tg.customColor + '33;color:' + tg.customColor + ';background:' + tg.customColor + '11"' : '';
              return '<span class="cm-wtag ' + tg.cls + '"' + col + '>' + tg.t + '</span>';
            }).join('')
          + '</div></div>';
      });
      html += '</div>';
    });

    body.innerHTML = html;
  }

  // --- 快捷工具视图：Token概览 + 条目模板生成 + MVU模板复制 + 增强工具 ---
  function renderToolsView() {
    if (!ui) return;
    var body = ui.dash.querySelector('#cm-dbody');
    ensureCardDataShape();
    // Token全景统计
    var desc = getFieldValue('description') || '';
    var first = getFieldValue('first_mes') || '';
    var sp = getFieldValue('system_prompt') || '';
    var phi = getFieldValue('post_history_instructions') || '';
    var me = getFieldValue('mes_example') || '';
    var entries = (cardData.character_book && cardData.character_book.entries) || [];
    var entriesTok = 0; entries.forEach(function(e){ entriesTok += countTokens(e.content || ''); });
    var fieldsTok = countTokens(desc) + countTokens(first) + countTokens(sp) + countTokens(phi) + countTokens(me);
    var constTok = 0; entries.forEach(function(e){ if (e.constant===true) constTok += countTokens(e.content || ''); });
    constTok += countTokens(phi);
    var totalTok = fieldsTok + entriesTok;
    var html = '';

    // ===== 快速工具条（一键操作）=====
    html += '<div class="cm-mod-detail">'
      + '<div class="cm-md-head">'
      + '<span class="cm-md-name">快速工具条</span>'
      + '<span class="cm-md-desc">一键执行常用操作</span></div>'
      + '<div class="cm-md-section">'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    var quickBtns = [
      { id: 'copyJson',    icon: '', name: '复制完整JSON',    desc: '复制chara_card_v3格式到剪贴板', cls: '' },
      { id: 'copyOpt',     icon: '', name: '生成优化清单',    desc: '一键生成AI可用的优化建议清单', cls: '' },
      { id: 'dedup',       icon: '', name: '条目去重',       desc: '合并重复命名的世界书条目', cls: '' },
      { id: 'fixCfg',      icon: '', name: '修正条目配置',   desc: '按前缀补全缺失的position/depth等配置', cls: '' },
    ];
    quickBtns.forEach(function(b) {
      html += '<button class="cm-btn ' + b.cls + '" style="padding:6px 10px" data-quick="' + b.id + '" title="' + esc(b.desc) + '">'
        + b.name + '</button>';
    });
    html += '</div></div></div>';

    // Token概览
    html += '<div class="cm-mod-detail">'
      + '<div class="cm-md-head">'
      + '<span class="cm-md-name">Token 全景概览</span>'
      + '<span class="cm-md-desc">估算发送给模型的Token预算（中文=1字≈1tok）</span></div>'
      + '<div class="cm-md-stats">'
      + '<div class="cm-md-stat"><b>' + totalTok + '</b><span>总估算 Token</span></div>'
      + '<div class="cm-md-stat"><b>' + constTok + '</b><span style="font-size:9px;line-height:1.2">常驻 ≤500<br>建议</span></div>'
      + '<div class="cm-md-stat"><b>' + (totalTok - constTok) + '</b><span>动态部分</span></div>'
      + '<div class="cm-md-stat"><b>' + entries.length + '</b><span>世界书条目</span></div>'
      + '</div>'
      + '<div class="cm-md-section"><h4>各字段 Token 明细</h4><div class="cm-md-list">';
    var fieldRows = [
      { name: '世界观描述', val: desc, min: 400, tok: countTokens(desc) },
      { name: '开场白',     val: first, min: 500, tok: countTokens(first) },
      { name: '系统指令',   val: sp,    max: 50,  tok: countTokens(sp) },
      { name: '核心铁则(PHI)', val: phi, max: 100, tok: countTokens(phi) },
      { name: '对话示例',   val: me,    req: false, tok: countTokens(me) },
      { name: '世界书条目', val: (entriesTok ? String(entriesTok) : ''), note: entries.length + '条合计', tok: entriesTok },
    ];
    fieldRows.forEach(function(r) {
      var l = r.tok;
      var dot = 'ok';
      if (r.min && l < r.min) dot = (l > 0 ? 'part' : 'bad');
      else if (r.max && l > r.max * 1.5) dot = 'bad';
      else if (r.max && l > r.max) dot = 'part';
      else if (l === 0 && r.req !== false) dot = 'bad';
      else if (l === 0 && r.req === false) dot = 'empty';
      var valText = l + ' tok' + (r.min ? ' / 建议≥' + r.min : '') + (r.max ? ' / ≤' + r.max : '');
      if (r.note) valText += ' · ' + r.note;
      html += '<div class="cm-md-item">'
        + '<span class="cm-mi-dot ' + dot + '"></span>'
        + '<span class="cm-mi-name">' + r.name + '</span>'
        + '<span class="cm-mi-val">' + valText + '</span>'
        + '</div>';
    });
    if (constTok > 550) {
      html += '</div></div><div class="cm-md-suggest"><b style="color:#92400e">常驻Token预算超标</b>当前常驻 ' + constTok + ' tok（建议≤500），超出部分可能会被截断或挤占上下文。<br>建议精简：核心铁则(PHI)、基础公理、常驻条目。</div>';
    } else if (constTok > 0 && constTok <= 500) {
      html += '</div></div><div class="cm-md-ok"><b>常驻预算健康</b> 常驻 ' + constTok + ' tok 控制在建议范围内（≤500）。</div>';
    } else {
      html += '</div></div>';
    }
    html += '</div>';

    // 一键条目模板生成
    html += '<div class="cm-mod-detail">'
      + '<div class="cm-md-head">'
      + '<span class="cm-md-name">一键生成世界书条目骨架</span>'
      + '<span class="cm-md-desc">点击直接带默认参数插入到角色卡数据</span></div>'
      + '<div class="cm-md-section"><h4>常用模板（点击即插入）</h4>'
      + '<div class="cm-template-grid">';
    QUICK_ENTRY_TEMPLATES.forEach(function(tpl, i) {
      html += '<div class="cm-tpl-card" data-tplidx="' + i + '">'
        + '<div class="cm-tpl-head"><span class="cm-tpl-prefix">' + tpl.prefix + '</span>'
        + '<span class="cm-tpl-name">' + tpl.name + '</span></div>'
        + '<div class="cm-tpl-hint">' + tpl.hint + '</div>'
        + '<div class="cm-tpl-preview">' + esc(tpl.sample.split('\n')[0]) + (tpl.sample.indexOf('\n') > 0 ? '…' : '') + '</div>'
        + '</div>';
    });
    html += '</div></div></div>';

    // MVU模板一键复制
    html += '<div class="cm-mod-detail">'
      + '<div class="cm-md-head">'
      + '<span class="cm-md-name">MVU 状态栏 & 正则模板</span>'
      + '<span class="cm-md-desc">配置状态栏美化、变量更新显示</span></div>'
      + '<div class="cm-md-section"><h4>点击复制模板</h4><div class="cm-md-list">';
    Object.keys(MVU_TEMPLATES).forEach(function(k) {
      var tpl = MVU_TEMPLATES[k];
      html += '<div class="cm-md-item" style="cursor:pointer" data-copytpl="' + k + '">'
        + '<span class="cm-mi-dot ok" style="flex-shrink:0"></span>'
        + '<div style="flex:1;min-width:0">'
        + '<div class="cm-mi-name" style="display:block">' + tpl.name + '</div>'
        + '<div style="font-size:10px;color:var(--cm-dim2);margin-top:2px;line-height:1.4">' + tpl.desc + '</div>'
        + '</div>'
        + '<span class="cm-mi-val">复制</span>'
        + '</div>';
    });
    html += '</div></div>';

    // 快捷小贴士
    html += '<div class="cm-md-section"><h4>小贴士</h4>'
      + '<div class="cm-md-ok" style="margin:0">· 扫聊天消息：自动解析最近消息中的 ```json``` 块合并进卡片数据<br>'
      + '· 悬浮工具条可拖动，仪表盘会从工具条的上方/下方展开（选空间大的一侧）<br>'
      + '· 所有数据自动保存在 localStorage，关闭浏览器再打开数据仍在<br>'
      + '· 【复制完整JSON】→ 粘贴到酒馆导入，或发给AI让它在此基础上修改<br>'
      + '· 【生成优化清单】→ 发给AI，它会按清单输出优化后的JSON代码块</div>'
      + '</div></div>';

    body.innerHTML = html;

    // ===== 绑定快速工具条 =====
    body.querySelectorAll('[data-quick]').forEach(function(el) {
      el.addEventListener('click', function() {
        var q = el.getAttribute('data-quick');
        if (q === 'copyJson') {
          try {
            var data = buildExportableCard();
            var txt = JSON.stringify(data, null, 2);
            var ta = document.createElement('textarea');
            ta.value = txt; ta.style.position='fixed'; ta.style.left='-9999px';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
            toast('角色卡JSON已复制到剪贴板 (' + Math.round(txt.length/1024) + 'KB)');
          } catch(e) {
            toast('复制失败：' + (e.message || '未知错误'), true);
          }
        } else if (q === 'copyOpt') {
          var checklist = buildOptimizeChecklist();
          try {
            var ta = document.createElement('textarea');
            ta.value = checklist; ta.style.position='fixed'; ta.style.left='-9999px';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
            toast('优化清单已复制（发给AI用）');
          } catch(e) {
            try { window.prompt('复制以下内容发给AI：', checklist); } catch(_) {}
          }
        } else if (q === 'dedup') {
          var n = dedupEntries();
          if (ui.view === 'dashboard') renderDashboardView();
          else if (ui.view === 'qc') renderQCView();
          else if (ui.view === 'worldbook') renderWBView();
          else renderToolsView();
          updateCompletion();
          toast(n > 0 ? '去重完成：移除 ' + n + ' 条重复' : '没有发现重复条目');
        } else if (q === 'fixCfg') {
          var f = fixEntryConfigs();
          if (ui.view === 'dashboard') renderDashboardView();
          else if (ui.view === 'qc') renderQCView();
          else if (ui.view === 'worldbook') renderWBView();
          else renderToolsView();
          updateCompletion();
          toast(f > 0 ? '配置修正：补全 ' + f + ' 条条目' : '所有条目配置已齐全');
        }
      });
    });

    // 绑定模板卡片点击 → 插入条目
    body.querySelectorAll('.cm-tpl-card').forEach(function(el) {
      el.addEventListener('click', function() {
        var idx = parseInt(el.getAttribute('data-tplidx'), 10);
        var tpl = QUICK_ENTRY_TEMPLATES[idx];
        if (!tpl) return;
        var comment = '<' + tpl.prefix + '>' + tpl.name;
        var newEntry = {
          keys: [],
          content: tpl.sample,
          comment: comment,
          enabled: true,
        };
        applyPrefixDefaults(newEntry);
        if (!cardData.character_book) cardData.character_book = { description:'', scan_depth:50, entries:[] };
        if (!Array.isArray(cardData.character_book.entries)) cardData.character_book.entries = [];
        cardData.character_book.entries.push(newEntry);
        ensureCardDataShape();
        saveAll();
        toast('已插入：<' + tpl.prefix + '>' + tpl.name);
        updateCompletion();
      });
    });
    // 绑定模板复制点击
    body.querySelectorAll('[data-copytpl]').forEach(function(el) {
      el.addEventListener('click', function() {
        var k = el.getAttribute('data-copytpl');
        var tpl = MVU_TEMPLATES[k];
        if (!tpl) return;
        var txt = tpl.code;
        try {
          var ta = document.createElement('textarea');
          ta.value = txt; ta.style.position='fixed'; ta.style.left='-9999px';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
          toast('已复制：' + tpl.name);
        } catch(_) {
          navigator && navigator.clipboard && navigator.clipboard.writeText(txt)
            .then(function(){ toast('已复制：' + tpl.name); })
            .catch(function(){
              try { window.prompt('Ctrl+C复制以下内容：', txt); } catch(_2){}
            });
        }
      });
    });
    updateCompletion();
  }
  function updateCompletion() {
    var c = calcOverallCompletion();
    if (ui) {
      ui.toolbar.querySelectorAll('[data-cmp]').forEach(function(e) { e.textContent = c + '%'; });
      ui.dash.querySelectorAll('[data-cmp2]').forEach(function(e) { e.textContent = c + '%'; });
    }
  }

  function removeAll() {
    var doc = pd(); if (!doc) return;
    ['','-dash','-toast','-file','-styles'].forEach(function (s) {
      try { var e = doc.getElementById(SCRIPT_ID + s); if (e) e.remove(); } catch (_) {}
    });
    ui = null;
  }

  function onToolbarClick(e) {
    var act = (e.target.closest ? e.target.closest('[data-act]') : null);
    if (!act) return;
    handleAction(act.getAttribute('data-act'));
  }

  function handleAction(act) {
    switch (act) {
      case 'toggle-dash': setDashOpen(!state.dashOpen); break;
      case 'close-dash':  setDashOpen(false); break;
      case 'export': doExport(); break;
      case 'import': if (ui && ui.fileInput) ui.fileInput.click(); break;
      case 'scan':   scanRecentMessages(); toast('已扫描最近消息'); break;
      case 'write':
        ensureCardDataShape();
        saveAll();
        if (ui.view === 'dashboard') renderDashboardView();
        else if (ui.view === 'qc') renderQCView();
        else if (ui.view === 'worldbook') renderWBView();
        else if (ui.view === 'tools') renderToolsView();
        toast('仪表盘已刷新');
        break;
      case 'clear':
        if (confirm('确认清空全部写卡数据？此操作不可恢复。')) {
          cardData = blankCardData(); ensureCardDataShape();
          saveAll();
          if (ui.view === 'dashboard') renderDashboardView();
          else if (ui.view === 'qc') renderQCView();
          else if (ui.view === 'worldbook') renderWBView();
          else if (ui.view === 'tools') renderToolsView();
          toast('已清空');
        }
        break;
    }
  }

  function setDashOpen(v, skipSave) {
    state.dashOpen = !!v;
    if (!ui) return;
    if (state.dashOpen) ui.dash.classList.add('show'); else ui.dash.classList.remove('show');
    applyDashPosition(ui.dash);
    if (!skipSave) { saveLS(LS_KEY, state); }
  }

  // ---- 位置 + 拖拽 ----
  function applyToolbarPosition(el) {
    var v = vp();
    var rect = el.getBoundingClientRect();
    var w = rect.width || 300, h = rect.height || 44;
    var x = state.toolbarX != null ? state.toolbarX : (v.w - w - 16);
    var y = state.toolbarY != null ? state.toolbarY : (v.h - h - 16);
    x = clamp(x, 8, v.w - w - 8); y = clamp(y, 8, v.h - h - 8);
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function applyDashPosition(el) {
    if (!ui) return;
    // 仪表盘面板：从工具栏下方或上方展开（选空间大的一侧）
    var v = vp();
    var tw = ui.toolbar.offsetWidth, th = ui.toolbar.offsetHeight;
    var tRect = ui.toolbar.getBoundingClientRect();
    var dw = Math.min(560, v.w - 24);
    var maxH = Math.max(v.h - 80, 300);
    el.style.maxHeight = maxH + 'px';
    var x = clamp(tRect.left + Math.round(tw / 2) - Math.round(dw / 2), 12, v.w - dw - 12);
    var y;
    if (tRect.top > v.h / 2) {
      // 工具栏在下方 → 面板显示在上方
      y = clamp(tRect.top - maxH - 12, 12, v.h - 100);
    } else {
      // 工具栏在上方 → 面板显示在下方
      y = clamp(tRect.bottom + 8, 12, v.h - 100);
    }
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function onPanelDragStart(e, el, isToolbar) {
    if (e.button !== undefined && e.button !== 0) return;
    var rect = el.getBoundingClientRect();
    var drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false, tb: !!isToolbar };
    el.classList.add('cm-dragging');
    try { if (el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (_) {}
    var doc = pd();
    function onMove(ev) {
      if (ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      var v = vp();
      var w = el.offsetWidth, h = el.offsetHeight;
      var nx = clamp(drag.left + dx, 8, v.w - w - 8);
      var ny = clamp(drag.top + dy, 8, v.h - h - 8);
      el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
      ev.preventDefault && ev.preventDefault();
    }
    function onUp(ev) {
      if (ev.pointerId !== drag.id) return;
      try { if (el.releasePointerCapture) el.releasePointerCapture(drag.id); } catch (_) {}
      el.classList.remove('cm-dragging');
      if (drag.tb) {
        try {
          state.toolbarX = parseFloat(el.style.left); state.toolbarY = parseFloat(el.style.top);
          saveLS(LS_KEY, state);
          if (state.dashOpen && ui) applyDashPosition(ui.dash);
        } catch (_) {}
      }
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  }

  // ===== 导入导出 =====
  function mergeImportedCardData(data) {
    if (!data) return;
    FIELDS.forEach(function (f) {
      if (f.key === 'character_book') {
        if (data.character_book) cardData.character_book = data.character_book;
        return;
      }
      if (data[f.key] !== undefined) {
        if (f.type === 'tags' || f.key === 'alternate_greetings' || f.key === 'regex_scripts') {
          cardData[f.key] = Array.isArray(data[f.key]) ? data[f.key].slice() : [];
        } else {
          cardData[f.key] = data[f.key];
        }
      }
    });
    if (data.data && typeof data.data === 'object') {
      cardData.data = JSON.parse(JSON.stringify(data.data));
    }
    if (data.spec) cardData.spec = data.spec;
    if (data.character_version) cardData.character_version = data.character_version;
    if (data.creator) cardData.creator = data.creator;
    if (data.creator_notes && !cardData.creator_notes) cardData.creator_notes = data.creator_notes;
    ensureCardDataShape();
  }

  function buildExportableCard() {
    ensureCardDataShape();
    var d = JSON.parse(JSON.stringify(cardData));
    var out = {
      spec: d.spec || 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: d.name || '',
        description: d.description || '',
        personality: d.personality || '',
        scenario: d.scenario || '',
        first_mes: d.first_mes || '',
        mes_example: d.mes_example || '',
        creator_notes: (d.creator_notes || (d.data && d.data.creator_notes)) || '',
        system_prompt: d.system_prompt || '',
        post_history_instructions: d.post_history_instructions || '',
        alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.slice() : [],
        tags: Array.isArray(d.tags) ? d.tags.slice() : [],
        creator: d.creator || '时之写卡器',
        character_version: d.character_version || '1.0',
        extensions: d.extensions || {},
      }
    };
    if (!out.data.extensions.tavern_helper) out.data.extensions.tavern_helper = { scripts: [], variables: {} };
    if (Array.isArray(d.regex_scripts) && d.regex_scripts.length) {
      if (!out.data.extensions.regex_scripts) out.data.extensions.regex_scripts = d.regex_scripts.slice();
    }
    if (d.character_book) out.data.character_book = d.character_book;
    if (d.depth_prompt) out.data.__depth_prompt = d.depth_prompt;
    return out;
  }
  function doExport() {
    var data = buildExportableCard();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var fn = (data.data.name || 'character').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    a.download = fn;
    try {
      var pdoc = pd();
      pdoc.body.appendChild(a); a.click(); a.remove();
    } catch (_) { a.click(); }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_) {} }, 3000);
    toast('已导出：' + fn);
  }

  // ===== Toast =====
  function toast(msg, err) {
    var doc = pd(); if (!doc) return;
    var t = doc.getElementById(SCRIPT_ID + '-toast');
    if (!t) { t = doc.createElement('div'); t.id = SCRIPT_ID + '-toast'; doc.body.appendChild(t); }
    if (err) t.style.background = '#7f1d1d'; else t.style.background = '';
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ===== 扫描消息：JSON 块合并 =====
  function findJsonBlocks(text) {
    if (!text) return [];
    var out = [];
    var re = /```(?:json)?\s*([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var raw = m[1].trim();
      if (raw) out.push(raw);
    }
    return out;
  }
  function tryParseJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    var s = raw.indexOf('{'); var e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) { try { return JSON.parse(raw.slice(s, e+1)); } catch (_) {} }
    return null;
  }
  function mergeJsonIntoCardData(patch) {
    if (!patch || typeof patch !== 'object') return 0;
    if (patch._nochange) return 0;
    var changed = 0;
    function applyTop(key, val, fieldType) {
      if (val === undefined || val === null) return false;
      if (fieldType === 'tags') {
        if (!Array.isArray(val)) return false;
        var cur = cardData.tags || [];
        var before = cur.length;
        val.forEach(function (t) { if (cur.indexOf(t) < 0) cur.push(t); });
        cardData.tags = cur;
        return cur.length !== before;
      }
      if (key === 'alternate_greetings') {
        if (!Array.isArray(val)) return false;
        cardData.alternate_greetings = val.slice(); return true;
      }
      if (key === 'regex_scripts') {
        if (!Array.isArray(val)) return false;
        cardData.regex_scripts = val.slice(); return true;
      }
      if (key === 'character_book') {
        if (!val || typeof val !== 'object') return false;
        var cur = cardData.character_book || { description:'', scan_depth:50, entries:[] };
        if (val.description !== undefined) cur.description = val.description;
        if (typeof val.scan_depth === 'number') cur.scan_depth = val.scan_depth;
        if (Array.isArray(val.entries)) {
          cur.entries = applyEntriesPatch(cur.entries || [], val.entries);
        }
        cardData.character_book = cur;
        return true;
      }
      if (typeof val === 'string') {
        if (cardData[key] !== val) { cardData[key] = val; return true; }
      } else {
        cardData[key] = val; return true;
      }
      return false;
    }
    FIELDS.forEach(function (f) {
      if (patch[f.key] !== undefined) {
        if (applyTop(f.key, patch[f.key], f.type)) changed++;
      }
    });
    if (Array.isArray(patch.entries) && patch.entries.length) {
      var cur = cardData.character_book || { description:'', scan_depth:50, entries:[] };
      var beforeN = (cur.entries || []).length;
      cur.entries = applyEntriesPatch(cur.entries || [], patch.entries);
      cardData.character_book = cur;
      if (cur.entries.length !== beforeN) changed++;
    }
    // _delete 支持
    var delPaths = [];
    ['_delete','delete','deletes','remove','removes','deleted_entries'].forEach(function (dk) {
      if (Array.isArray(patch[dk])) patch[dk].forEach(function (p) { delPaths.push(String(p)); });
    });
    if (delPaths.length) {
      var cb = cardData.character_book || { entries: [] };
      var arr = cb.entries || [];
      var toDel = [];
      delPaths.forEach(function (raw) {
        var key = raw.replace(/^character_book\.entries\./, '');
        var idx = parseInt(key, 10);
        if (!isNaN(idx) && String(idx) === key && idx >= 0 && idx < arr.length) { toDel.push(idx); return; }
        var exact = [], fuzzy = [];
        arr.forEach(function (e, i) {
          var ec = e.comment || '';
          if (ec === key) exact.push(i);
          else if (key.length >= 6 && ec.length >= 6 && ec.indexOf(key) >= 0) fuzzy.push(i);
        });
        if (exact.length) exact.forEach(function (i) { if (toDel.indexOf(i)<0) toDel.push(i); });
        else if (fuzzy.length === 1) toDel.push(fuzzy[0]);
      });
      toDel.sort(function (a,b) { return b - a; });
      var uniq = [];
      toDel.forEach(function (i) { if (uniq.indexOf(i) < 0) uniq.push(i); });
      if (uniq.length) {
        uniq.forEach(function (i) { arr.splice(i, 1); });
        cb.entries = arr; cardData.character_book = cb; changed++;
      }
    }
    if (patch.character && typeof patch.character === 'object') {
      for (var k in patch.character) { if (FIELDS.some(function (f) { return f.key === k; })) {
        if (applyTop(k, patch.character[k], (FIELDS.find(function(f){return f.key===k})||{}).type)) changed++;
      }}
    }
    return changed;
  }
  function applyEntriesPatch(existing, incoming) {
    var arr = existing.slice();
    ensurePrefixDefaults();
    incoming.forEach(function (ne) {
      if (!ne || typeof ne !== 'object') return;
      if (ne._action === 'delete' || ne._action === 'remove' || ne.delete === true) {
        if (ne.comment) {
          var di = -1;
          arr.forEach(function (e, i) { if ((e.comment||'') === ne.comment) di = i; });
          if (di >= 0) arr.splice(di, 1);
        }
        return;
      }
      if (!ne.content && !ne.keys && !ne.comment) return;
      var idx = findEntryMatch(ne, arr);
      if (idx >= 0) {
        arr[idx] = Object.assign({}, arr[idx], ne);
        applyPrefixDefaults(arr[idx]);
      } else {
        var e2 = Object.assign({}, ne);
        applyPrefixDefaults(e2);
        arr.push(e2);
      }
    });
    return arr;
  }
  function findEntryMatch(ne, arr) {
    var neC = ne.comment || ''; var neCont = (ne.content || '').trim();
    var nePref = prefixOf(neC);
    for (var i=0;i<arr.length;i++) if ((arr[i].comment||'') === neC) return i;
    if (nePref) {
      var same = arr.map(function (e, i) { return { i:i, p: prefixOf(e.comment||''), c: e.content||'' }; })
        .filter(function (x) { return x.p === nePref; });
      if (same.length === 1) return same[0].i;
      if (same.length > 1 && neCont.length > 20) {
        var setN = charSet(neCont);
        var best = -1; var bestSim = 0;
        same.forEach(function (s) {
          var sim = jacc(setN, charSet(s.c));
          if (sim > bestSim && sim > 0.35) { bestSim = sim; best = s.i; }
        });
        if (best >= 0) return best;
      }
    }
    return -1;
  }
  function prefixOf(c) {
    var m = /^<([^>]+)>/.exec(c || ''); if (m) return m[1];
    var m2 = /^\[([^\]]+)\]/.exec(c || ''); if (m2) return '[' + m2[1] + ']';
    return '';
  }
  function charSet(s) { var o={}; for (var i=0;i<s.length;i++) o[s[i]]=true; return o; }
  function jacc(a,b){var i=0,u=0; for (var k in a) {if (a.hasOwnProperty(k)){if(b[k]) i++; u++;}} for (var k in b) {if(b.hasOwnProperty(k) && !a[k]) u++;} return u? i/u:0; }

  var PREFIX_DEFAULTS = null;
  function ensurePrefixDefaults() {
    if (PREFIX_DEFAULTS) return;
    PREFIX_DEFAULTS = {
      '基础公理':   { constant:true,  selective:false, insertion_order:250, position:0, depth:0, prevent_recursion:true,  probability:100, useProbability:false },
      '核心铁则':   { constant:true,  selective:false, insertion_order:250, position:0, depth:0, prevent_recursion:true,  probability:100, useProbability:false },
      '世界元数据': { constant:true,  selective:false, insertion_order:240, position:0, depth:0, prevent_recursion:true,  probability:100, useProbability:false },
      '交互软规则': { constant:true,  selective:false, insertion_order:150, position:1, depth:0, prevent_recursion:true,  probability:100, useProbability:false },
      '近场强约束': { constant:false, selective:true,  insertion_order:180, position:2, depth:2, prevent_recursion:false, probability:100, useProbability:true  },
      '当前局势':   { constant:false, selective:true,  insertion_order:170, position:2, depth:3, prevent_recursion:false, probability:100, useProbability:true  },
      '场景机制':   { constant:false, selective:true,  insertion_order:140, position:1, depth:3, prevent_recursion:false, probability:100, useProbability:true, cooldown:3 },
      '核心玩法':   { constant:false, selective:true,  insertion_order:130, position:1, depth:3, prevent_recursion:false, probability:100, useProbability:true, cooldown:3 },
      '世界规则':   { constant:false, selective:true,  insertion_order:120, position:1, depth:4, prevent_recursion:false, probability:100, useProbability:true, cooldown:3 },
      '实体交互':   { constant:false, selective:true,  insertion_order:110, position:1, depth:3, prevent_recursion:true,  probability:100, useProbability:true  },
      '重要角色':   { constant:false, selective:true,  insertion_order:105, position:1, depth:3, prevent_recursion:true,  probability:100, useProbability:true  },
      '势力与组织': { constant:false, selective:true,  insertion_order:100, position:1, depth:3, prevent_recursion:true,  probability:100, useProbability:true  },
      '物品':       { constant:false, selective:true,  insertion_order:95,  position:1, depth:3, prevent_recursion:true,  probability:100, useProbability:true  },
      '地点场景':   { constant:false, selective:true,  insertion_order:90,  position:1, depth:3, prevent_recursion:true,  probability:100, useProbability:true  },
      '叙事背景':   { constant:false, selective:true,  insertion_order:80,  position:4, depth:5, prevent_recursion:false, probability:60,  useProbability:true,  group:'叙事' },
      '故事发展':   { constant:false, selective:true,  insertion_order:75,  position:4, depth:5, prevent_recursion:false, probability:60,  useProbability:true,  group:'叙事' },
      '文化与习俗': { constant:false, selective:true,  insertion_order:70,  position:4, depth:5, prevent_recursion:false, probability:60,  useProbability:true,  group:'叙事' },
      '历史事件':   { constant:false, selective:true,  insertion_order:65,  position:4, depth:6, prevent_recursion:false, probability:50,  useProbability:true,  group:'叙事' },
      '动态适配':   { constant:false, selective:true,  insertion_order:50,  position:1, depth:4, prevent_recursion:false, probability:100, useProbability:true  },
      '引导机制':   { constant:false, selective:true,  insertion_order:45,  position:1, depth:4, prevent_recursion:false, probability:100, useProbability:true  },
      '互动选项':   { constant:false, selective:true,  insertion_order:40,  position:1, depth:4, prevent_recursion:false, probability:100, useProbability:true  },
      '状态栏':     { constant:false, selective:true,  insertion_order:35,  position:2, depth:2, prevent_recursion:false, probability:100, useProbability:true  },
      '统一输出格式':{ constant:true, selective:false, insertion_order:85,  position:0, depth:1, prevent_recursion:true,  probability:100, useProbability:false },
      '角色边界':   { constant:true,  selective:false, insertion_order:80,  position:0, depth:2, prevent_recursion:true,  probability:100, useProbability:false },
      '禁止项':     { constant:true,  selective:false, insertion_order:70,  position:0, depth:3, prevent_recursion:true,  probability:100, useProbability:false, exclude_recursion:true },
      '[InitVar]初始变量': { constant:true, selective:false, insertion_order:200, position:4, depth:4, prevent_recursion:true, probability:100, useProbability:false, enabled:false },
      '变量列表':     { constant:true, selective:false, insertion_order:200, position:4, depth:0, prevent_recursion:true, probability:100, useProbability:false },
      '变量更新规则': { constant:true, selective:false, insertion_order:200, position:4, depth:0, prevent_recursion:true, probability:100, useProbability:false },
      '变量输出格式': { constant:true, selective:false, insertion_order:200, position:4, depth:0, prevent_recursion:true, probability:100, useProbability:false },
    };
  }
  function applyPrefixDefaults(entry) {
    ensurePrefixDefaults();
    var pref = prefixOf(entry.comment || '');
    if (!pref) return;
    if (pref.charAt(0) === '[') {
      for (var k in PREFIX_DEFAULTS) {
        if (k.charAt(0) === '[' && pref.indexOf(k.replace(/[\[\]]/g,'')) >= 0) {
          fill(entry, PREFIX_DEFAULTS[k]); return;
        }
      }
      return;
    }
    if (PREFIX_DEFAULTS[pref]) { fill(entry, PREFIX_DEFAULTS[pref]); return; }
    var bestK = null, bestL = 0;
    for (var k in PREFIX_DEFAULTS) {
      if (pref.indexOf(k) >= 0 || k.indexOf(pref) >= 0) {
        var l = Math.min(pref.length, k.length);
        if (l > bestL) { bestL = l; bestK = k; }
      }
    }
    if (bestK) fill(entry, PREFIX_DEFAULTS[bestK]);
  }
  function fill(entry, defaults) {
    for (var k in defaults) {
      if (!defaults.hasOwnProperty(k)) continue;
      if (k === 'position' || k === 'depth' || k === 'probability' || k === 'selectiveLogic'
          || k === 'prevent_recursion' || k === 'exclude_recursion' || k === 'delay_until_recursion'
          || k === 'sticky' || k === 'cooldown' || k === 'delay' || k === 'match_whole_words'
          || k === 'scan_depth' || k === 'group' || k === 'group_weight' || k === 'useProbability'
          || k === 'secondary_keys') {
        if (!entry.extensions) entry.extensions = {};
        if (entry.extensions[k] === undefined) entry.extensions[k] = defaults[k];
      } else {
        if (entry[k] === undefined) entry[k] = defaults[k];
      }
    }
    if (entry.enabled === undefined) entry.enabled = (defaults.enabled !== undefined) ? defaults.enabled : true;
    if (entry.selective === undefined) entry.selective = defaults.selective;
    if (entry.constant === undefined) entry.constant = defaults.constant;
    if (entry.insertion_order === undefined && defaults.insertion_order !== undefined) entry.insertion_order = defaults.insertion_order;
    if (entry.use_regex === undefined) entry.use_regex = true;
    if (!entry.keys) entry.keys = [];
    if (!entry.secondary_keys && defaults.secondary_keys) entry.secondary_keys = defaults.secondary_keys.slice ? defaults.secondary_keys.slice() : [];
  }

  // ===== 扫描最近消息 =====
  function scanRecentMessages() {
    var doc = pd(); if (!doc) return;
    var nodes = doc.querySelectorAll('.mes, .chat-message, .message, [data-mid]');
    if (!nodes.length) nodes = doc.querySelectorAll('.chat_msg, .msg, div[id^="chat_message"]');
    var texts = [];
    Array.prototype.slice.call(nodes, Math.max(0, nodes.length - 24)).forEach(function (n) {
      var t = n.innerText || n.textContent || '';
      if (t.trim().length > 40) texts.push(t);
    });
    var applied = 0;
    texts.forEach(function (tx) {
      var blocks = findJsonBlocks(tx);
      blocks.forEach(function (raw) {
        var j = tryParseJson(raw);
        if (j) { applied += mergeJsonIntoCardData(j); }
      });
    });
    ensureCardDataShape();
    saveAll();
    if (ui) {
      if (ui.view === 'dashboard') renderDashboardView();
      else if (ui.view === 'qc') renderQCView();
      else if (ui.view === 'worldbook') renderWBView();
      else if (ui.view === 'tools') renderToolsView();
    }
    updateCompletion();
    return applied;
  }

  var _mutObs = null;
  function bindChatObserver() {
    if (_mutObs) return;
    var doc = pd(); if (!doc || !doc.body) return;
    try {
      _mutObs = new MutationObserver(function () {
        if (bindChatObserver._t) return;
        bindChatObserver._t = setTimeout(function () {
          bindChatObserver._t = null;
          var c = scanRecentMessages();
          if (c > 0) toast('写入 ' + c + ' 项更新到面板');
        }, 1200);
      });
      _mutObs.observe(doc.body, { childList: true, subtree: true, characterData: true });
    } catch (_) { _mutObs = null; }
  }

  // ===== 启动 =====
  function init() {
    try {
      renderToolbar();
      window.addEventListener('resize', function () {
        if (!ui) return;
        applyToolbarPosition(ui.toolbar);
        if (state.dashOpen) applyDashPosition(ui.dash);
      });
    } catch (err) {
      console.error('[时之写卡器仪表盘] init error:', err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else setTimeout(init, 0);

  window.CM_IDE = {
    get state() { return state; },
    get cardData() { return cardData; },
    setCardField: function(k, v) {
      cardData[k] = v;
      ensureCardDataShape(); saveAll();
      if (ui) {
        if (ui.view === 'dashboard') renderDashboardView();
        else if (ui.view === 'qc') renderQCView();
        else if (ui.view === 'worldbook') renderWBView();
        else if (ui.view === 'tools') renderToolsView();
      }
      updateCompletion();
    },
    getCardField: getFieldValue,
    countTokens: countTokens,
    getWeightLevel: getWeightLevel,
    export: doExport,
    scan: scanRecentMessages,
    reset: function () {
      cardData = blankCardData(); ensureCardDataShape(); saveAll();
      if (ui) {
        if (ui.view === 'dashboard') renderDashboardView();
        else if (ui.view === 'qc') renderQCView();
        else if (ui.view === 'worldbook') renderWBView();
        else if (ui.view === 'tools') renderToolsView();
      }
      updateCompletion();
    },
    mergePatch: function (p) {
      mergeJsonIntoCardData(p); saveAll();
      if (ui) {
        if (ui.view === 'dashboard') renderDashboardView();
        else if (ui.view === 'qc') renderQCView();
        else if (ui.view === 'worldbook') renderWBView();
        else if (ui.view === 'tools') renderToolsView();
      }
      updateCompletion();
    },
    calcModule: calcModulePct,
    qualityCheck: runQualityChecks,
    classifyEntries: classifyEntries,
    quickTemplates: QUICK_ENTRY_TEMPLATES,
    mvuTemplates: MVU_TEMPLATES,
    // ===== 新增增强工具 =====
    dedupEntries: dedupEntries,
    fixEntryConfigs: fixEntryConfigs,
    buildOptimizeChecklist: buildOptimizeChecklist,
    buildExportableCard: buildExportableCard,
    getCompletion: calcOverallCompletion,
  };
})();
