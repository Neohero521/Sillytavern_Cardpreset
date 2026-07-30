/* ===========================================================
   时之写卡器 - 悬浮IDE前端 (Card_making_frontend_ide.js)
   -----------------------------------------------------------
   · 极简悬浮工具条（横向按钮条），点击中间的"⚡写卡"展开 / 收起
   · 简洁配色 + 细线边框，避免花哨渐变/阴影
   · 伪IDE式UI：按字段分组，每组独立 toggle（控制本轮是否让AI生成）
   · 自动监听聊天消息里的 ```json``` 段，一条条写进面板
   · 最后【导出】下载为 chara_card_v3.json，绝不写入 ST 原生字段
   · 数据/展开状态/字段开关 全部存在 localStorage
   =========================================================== */
(function () {
  if (window.__CM_IDE_LOADED__) return;
  window.__CM_IDE_LOADED__ = true;

  var SCRIPT_ID = 'cm-ide-toolbar';
  var LS_KEY = 'cm-ide-state-v1';
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
  function uuid() { return 'cm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function vp() {
    try { var v = (window.parent && window.parent.visualViewport); if (v) return { w: v.width, h: v.height }; } catch (_) {}
    var w = (window.parent && window.parent.innerWidth) || window.innerWidth || 390;
    var h = (window.parent && window.parent.innerHeight) || window.innerHeight || 700;
    return { w: w, h: h };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- 字段定义（匹配 preset.json _card_making_meta.output_fields） ----------
  var FIELDS = [
    // 基础字段
    { key: 'name',                      label: '名称',           group: '📋 基础字段', type: 'text',     placeholder: '角色 / 世界名（不要加前缀后缀）', required: true  },
    { key: 'description',               label: '世界观描述',     group: '📋 基础字段', type: 'textarea', placeholder: '≥400字，核心设定',            required: true,  rows: 8 },
    { key: 'personality',               label: '性格',           group: '📋 基础字段', type: 'textarea', placeholder: '世界模式留空；角色模式填角色性格',  required: false, rows: 4 },
    { key: 'scenario',                  label: '场景',           group: '📋 基础字段', type: 'textarea', placeholder: '世界模式留空；角色模式填场景',    required: false, rows: 3 },
    { key: 'first_mes',                 label: '开场白',         group: '📋 基础字段', type: 'textarea', placeholder: '≥500字；完整度≥80%才生成',    required: true,  rows: 10 },
    { key: 'system_prompt',             label: '系统指令',       group: '📋 基础字段', type: 'textarea', placeholder: '≤50字，仅AI身份定位',          required: true,  rows: 2 },
    { key: 'post_history_instructions', label: '核心铁则',       group: '📋 基础字段', type: 'textarea', placeholder: '≤100字（最高权重位）',        required: true,  rows: 2 },
    { key: 'tags',                      label: '标签',           group: '📋 基础字段', type: 'tags',     placeholder: '回车或逗号分隔，2-12个',        required: true  },
    // 高价值字段
    { key: 'mes_example',               label: '对话示例',       group: '💎 高价值字段', type: 'textarea', placeholder: '1-2组 Few-shot',                 required: false, rows: 10 },
    { key: 'alternate_greetings',       label: '备用开场白',     group: '💎 高价值字段', type: 'list',     placeholder: '每行一条，3个差异化开局',      required: false, rows: 5 },
    { key: 'depth_prompt',              label: '新手引导',       group: '💎 高价值字段', type: 'textarea', placeholder: 'depth=0，前10轮引导',       required: false, rows: 4 },
    { key: 'regex_scripts',             label: '正则脚本',       group: '💎 高价值字段', type: 'jsonlist', placeholder: 'JSON数组：[{scriptName, findRegex, replaceString, ...}]', required: false, rows: 8 },
    // 世界书
    { key: 'character_book',            label: '世界书条目',     group: '📚 世界书',    type: 'entries',  placeholder: '',                              required: false },
    // 其他
    { key: 'creator_notes',             label: '创作者备注',     group: '🧰 其他',      type: 'textarea', placeholder: '≤100字',                        required: false, rows: 2 },
  ];
  var FIELD_GROUPS = [];
  FIELDS.forEach(function (f) {
    if (FIELD_GROUPS.indexOf(f.group) < 0) FIELD_GROUPS.push(f.group);
  });

  // ---------- 状态 ----------
  var state = loadLS(LS_KEY, { expanded: false, left: null, top: null, switches: {}, toolbarX: null, toolbarY: null });
  var cardData = loadLS(STORAGE_KEY, blankCardData());
  function blankCardData() {
    var o = { name: '', description: '', personality: '', scenario: '',
      first_mes: '', system_prompt: '', post_history_instructions: '', tags: [],
      mes_example: '', alternate_greetings: [], depth_prompt: '', regex_scripts: [],
      character_book: { description: '', scan_depth: 50, entries: [] },
      creator_notes: '', data: { version: 'chara_card_v3' }, spec: 'chara_card_v3',
      character_version: '1.0', creator: '', creator_notes: '', alternate_greetings: [],
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

  // ---------- 样式注入（简洁，低饱和，细线） ----------
  function injectStyles() {
    var doc = pd(); if (!doc || !doc.head) return;
    var sid = SCRIPT_ID + '-styles';
    if (doc.getElementById(sid)) return;
    var R = '#' + SCRIPT_ID;
    var css = ''
      // === 调色板：低饱和细线风 ===
      + R + ' *, ' + R + ' *::before, ' + R + ' *::after{box-sizing:border-box;margin:0;padding:0}'
      + R + '{--cm-bg:#fafafa;--cm-bg2:#ffffff;--cm-border:#e5e7eb;--cm-border-soft:#f1f5f9;'
      + ' --cm-text:#111827;--cm-dim:#6b7280;--cm-dim2:#9ca3af;'
      + ' --cm-accent:#2563eb;--cm-accent-soft:#eff6ff;--cm-accent-border:#bfdbfe;'
      + ' --cm-green:#16a34a;--cm-green-soft:#f0fdf4;--cm-green-border:#bbf7d0;'
      + ' --cm-warn:#d97706;--cm-danger:#dc2626;'
      + ' --cm-radius:8px;--cm-input-bg:#fff;--cm-input-border:#d1d5db;'
      + ' --cm-chip:#f3f4f6;}'
      // === 悬浮工具条（真·横条） ===
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
      + R + ' .cm-btn.danger{border-color:#fecaca;color:var(--cm-danger)}'
      + R + ' .cm-btn.danger:hover{background:#fef2f2}'
      + R + ' .cm-sep{width:1px;height:18px;background:var(--cm-border)}'
      + R + ' .cm-completion{font-size:11px;color:var(--cm-dim);padding:0 6px;display:inline-flex;align-items:center;gap:4px}'
      + R + ' .cm-completion b{color:var(--cm-accent);font-weight:600}'
      // === 展开面板：伪IDE，卡片式 ===
      + R + '-panel{position:fixed;z-index:2147483646;display:none;flex-direction:column;'
      + ' width:720px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 40px);'
      + ' background:var(--cm-bg2);border:1px solid var(--cm-border);border-radius:12px;'
      + ' box-shadow:0 6px 24px rgba(15,23,42,.12);'
      + ' font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;'
      + ' color:var(--cm-text);font-size:13px;overflow:hidden;isolation:isolate}'
      + R + '-panel.show{display:flex;animation:cm-slide .18s ease-out}'
      + '@keyframes cm-slide{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}'
      // --- 顶部标题栏 ---
      + R + '-panel .cm-ph{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--cm-border);background:var(--cm-bg);cursor:move}'
      + R + '-panel .cm-ph strong{font-weight:600;color:var(--cm-text)}'
      + R + '-panel .cm-ph .cm-sub{font-size:11px;color:var(--cm-dim);margin-left:4px}'
      + R + '-panel .cm-ph .cm-right{margin-left:auto;display:flex;align-items:center;gap:6px}'
      + R + '-panel .cm-close{width:24px;height:24px;border:none;border-radius:6px;background:transparent;'
      + ' color:var(--cm-dim);font-size:18px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;}'
      + R + '-panel .cm-close:hover{background:var(--cm-accent-soft);color:var(--cm-accent)}'
      // --- Tab栏（分组） ---
      + R + '-panel .cm-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 14px 0;border-bottom:1px solid var(--cm-border-soft);background:var(--cm-bg);flex-shrink:0}'
      + R + '-panel .cm-tab{padding:6px 12px;border:1px solid transparent;border-radius:8px 8px 0 0;'
      + ' background:transparent;color:var(--cm-dim);cursor:pointer;font:inherit;font-size:12px;font-weight:500;margin-bottom:-1px;}'
      + R + '-panel .cm-tab:hover{color:var(--cm-text)}'
      + R + '-panel .cm-tab.active{background:var(--cm-bg2);border-color:var(--cm-border);border-bottom-color:var(--cm-bg2);color:var(--cm-accent)}'
      + R + '-panel .cm-tab .cm-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cm-dim2);margin-right:6px;vertical-align:middle}'
      + R + '-panel .cm-tab.done .cm-dot{background:var(--cm-green)}'
      + R + '-panel .cm-tab.partial .cm-dot{background:var(--cm-warn)}'
      // --- 主体滚动区 ---
      + R + '-panel .cm-body{flex:1;overflow-y:auto;padding:16px;background:var(--cm-bg2)}'
      + R + '-panel .cm-body::-webkit-scrollbar{width:8px}'
      + R + '-panel .cm-body::-webkit-scrollbar-track{background:transparent}'
      + R + '-panel .cm-body::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}'
      // --- 行：字段卡 ---
      + R + '-panel .cm-field{display:flex;flex-direction:column;gap:6px;padding:12px;margin-bottom:12px;'
      + ' border:1px solid var(--cm-border-soft);border-radius:var(--cm-radius);background:var(--cm-bg2);'
      + ' transition:border-color .2s}'
      + R + '-panel .cm-field:hover{border-color:var(--cm-border)}'
      + R + '-panel .cm-field-head{display:flex;align-items:center;gap:8px}'
      + R + '-panel .cm-field-head .cm-label{font-weight:500;color:var(--cm-text);font-size:13px}'
      + R + '-panel .cm-field-head .cm-label .cm-req{color:var(--cm-danger);margin-left:2px}'
      + R + '-panel .cm-field-head .cm-fhint{font-size:11px;color:var(--cm-dim2);margin-left:auto;}'
      + R + '-panel .cm-field-head .cm-flen{font-size:11px;color:var(--cm-dim);padding:1px 6px;border-radius:999px;background:var(--cm-chip)}'
      // --- toggle开关 ---
      + R + '-panel .cm-sw{position:relative;width:32px;height:18px;border-radius:999px;background:#d1d5db;cursor:pointer;flex-shrink:0;transition:background .2s}'
      + R + '-panel .cm-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}'
      + R + '-panel .cm-sw.on{background:var(--cm-green)}'
      + R + '-panel .cm-sw.on::after{transform:translateX(14px)}'
      // --- 输入控件 ---
      + R + '-panel .cm-input,' + R + '-panel .cm-textarea{width:100%;padding:7px 9px;border:1px solid var(--cm-input-border);'
      + ' background:var(--cm-input-bg);color:var(--cm-text);border-radius:6px;font:inherit;font-size:12px;'
      + ' transition:border-color .15s,box-shadow .15s;resize:vertical;line-height:1.5}'
      + R + '-panel .cm-input:focus,' + R + '-panel .cm-textarea:focus'
      + '{outline:none;border-color:var(--cm-accent);box-shadow:0 0 0 3px rgba(37,99,235,.1)}'
      + R + '-panel .cm-chips{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border:1px dashed var(--cm-input-border);border-radius:6px;min-height:32px;background:var(--cm-input-bg)}'
      + R + '-panel .cm-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--cm-chip);border-radius:999px;font-size:11px;color:var(--cm-text)}'
      + R + '-panel .cm-chip button{border:none;background:transparent;color:var(--cm-dim);cursor:pointer;font-size:14px;line-height:1;padding:0}'
      + R + '-panel .cm-chip-input{flex:1;min-width:80px;border:none;background:transparent;outline:none;font:inherit;font-size:12px;color:var(--cm-text)}'
      // --- entries 列表卡 ---
      + R + '-panel .cm-entry{border:1px solid var(--cm-border-soft);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--cm-bg)}'
      + R + '-panel .cm-entry-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}'
      + R + '-panel .cm-entry-head input{flex:1;min-width:140px;padding:4px 7px;border:1px solid var(--cm-input-border);border-radius:5px;font:inherit;font-size:12px;background:var(--cm-input-bg);color:var(--cm-text)}'
      + R + '-panel .cm-entry-head small{font-size:11px;color:var(--cm-dim2);padding:2px 6px;border-radius:999px;background:var(--cm-chip)}'
      + R + '-panel .cm-entry textarea{width:100%;min-height:60px;padding:5px 7px;border:1px solid var(--cm-input-border);border-radius:6px;font:inherit;font-size:12px;background:var(--cm-input-bg);color:var(--cm-text);resize:vertical;line-height:1.5}'
      + R + '-panel .cm-entry-keys{display:flex;flex-wrap:wrap;gap:3px;margin:6px 0}'
      + R + '-panel .cm-entry-key{padding:1px 6px;border:1px dashed var(--cm-input-border);border-radius:5px;font-size:11px;color:var(--cm-dim);background:var(--cm-bg2)}'
      // --- 动作条 ---
      + R + '-panel .cm-actions{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--cm-border);background:var(--cm-bg);flex-shrink:0}'
      + R + '-panel .cm-actions .spacer{flex:1}'
      // --- toast ---
      + R + '-toast{position:fixed;z-index:2147483648;left:50%;bottom:40px;transform:translateX(-50%);padding:8px 14px;background:#111827;color:#fff;'
      + ' border-radius:999px;font:inherit;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}'
      + R + '-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}'
      // --- 响应式 ---
      + '@media(max-width:520px){'
      + R + '{padding:4px 8px;gap:4px}' + R + ' .cm-btn{padding:4px 8px;font-size:11px}'
      + R + '-panel{width:calc(100vw - 16px);height:calc(100vh - 24px);border-radius:10px}'
      + R + '-panel .cm-body{padding:12px}'
      + '}'
      ;
    var s = doc.createElement('style');
    s.id = sid;
    s.textContent = css;
    doc.head.appendChild(s);
  }

  // ---------- UI构建 ----------
  var ui = null;   // { toolbar, panel, fields: {[key]:{row,input,len,sw}} }
  var activeTab = FIELD_GROUPS[0];

  function calcCompletion() {
    // 简单完成度：required字段非空 + 非必填按长度给比例
    var score = 0, total = 0;
    FIELDS.forEach(function (f) {
      total += 1;
      var v = getFieldValue(f.key);
      var done = false;
      if (f.required) {
        done = isFieldNonEmpty(f, v);
      } else {
        done = isFieldNonEmpty(f, v);
      }
      if (done) score += 1;
      else if (v !== null && v !== undefined && String(v).trim() !== '' && !(Array.isArray(v) && v.length === 0)) {
        score += 0.3;   // 非空但不足，给 0.3 分
      }
    });
    return { pct: total ? Math.round(100 * score / total) : 0, done: Math.round(score * 10) / 10, total: total };
  }
  function isFieldNonEmpty(f, v) {
    if (v == null) return false;
    switch (f.type) {
      case 'text': case 'textarea': return typeof v === 'string' && v.trim().length >= (f.key === 'system_prompt' ? 3 : (f.required ? 30 : 1));
      case 'tags': case 'list': return Array.isArray(v) && v.length >= (f.required ? 1 : 1);
      case 'jsonlist': return Array.isArray(v) && v.length > 0;
      case 'entries': return !!(v && Array.isArray(v.entries) && v.entries.length > 0);
    }
    return false;
  }
  function getFieldValue(key) {
    if (key === 'character_book') {
      return cardData.character_book || null;
    }
    return cardData[key];
  }
  function setFieldValue(key, val) {
    if (key === 'character_book') {
      cardData.character_book = val || { description:'', scan_depth:50, entries:[] };
      return;
    }
    cardData[key] = val;
  }

  function groupStatus(group) {
    // 'done' / 'partial' / ''
    var fields = FIELDS.filter(function (f) { return f.group === group; });
    var nonEmpty = 0, hasReq = false;
    fields.forEach(function (f) {
      if (isFieldNonEmpty(f, getFieldValue(f.key))) nonEmpty++;
      if (f.required) hasReq = true;
    });
    if (nonEmpty === 0) return '';
    if (nonEmpty === fields.length) return 'done';
    return 'partial';
  }

  function renderToolbar() {
    var doc = pd(); if (!doc || !doc.body) return;
    removeAll();
    injectStyles();

    var tb = doc.createElement('div');
    tb.id = SCRIPT_ID;
    tb.innerHTML = ''
      + '<span class="cm-handle" title="拖动移动">⋮⋮</span>'
      + '<button class="cm-btn primary" data-act="toggle">⚡ 写卡</button>'
      + '<span class="cm-sep"></span>'
      + '<button class="cm-btn" data-act="write" title="手动把当前输入框内容写入面板">✎ 写入</button>'
      + '<button class="cm-btn" data-act="scan"  title="扫描最近聊天，把```json```写进面板">🔍 扫消息</button>'
      + '<button class="cm-btn" data-act="export" title="导出 chara_card_v3.json（下载）">⬇ 导出</button>'
      + '<span class="cm-sep"></span>'
      + '<span class="cm-completion">完成度 <b data-cmp>0%</b></span>';
    doc.body.appendChild(tb);

    var pnl = doc.createElement('div');
    pnl.id = SCRIPT_ID + '-panel';
    pnl.innerHTML = ''
      + '<div class="cm-ph" id="cm-phead">'
      + '  <strong>⚡ 时之写卡器 · IDE面板</strong>'
      + '  <span class="cm-sub">逐段写入 · 完成后导出下载（不直接写 ST 角色卡）</span>'
      + '  <div class="cm-right">'
      + '    <span class="cm-completion">完成度 <b data-cmp>0%</b></span>'
      + '    <button class="cm-close" data-act="close" title="收起面板">×</button>'
      + '  </div>'
      + '</div>'
      + '<div class="cm-tabs" data-tabs></div>'
      + '<div class="cm-body" data-body></div>'
      + '<div class="cm-actions">'
      + '  <button class="cm-btn" data-act="scan">🔍 扫聊天消息</button>'
      + '  <button class="cm-btn danger" data-act="clear">🗑 清空面板</button>'
      + '  <div class="spacer"></div>'
      + '  <button class="cm-btn" data-act="import-panel">📤 导入JSON</button>'
      + '  <button class="cm-btn primary" data-act="export">⬇ 导出角色卡</button>'
      + '</div>'
      ;
    doc.body.appendChild(pnl);

    // 隐藏式导入file input
    var fi = doc.createElement('input');
    fi.type = 'file'; fi.accept = '.json,application/json';
    fi.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px';
    fi.id = SCRIPT_ID + '-file';
    doc.body.appendChild(fi);

    ui = { toolbar: tb, panel: pnl, fileInput: fi, fields: {} };

    // 位置：toolbar 初始贴右下；面板默认跟随右下角展开
    applyToolbarPosition(tb);
    tb.addEventListener('click', onToolbarClick);
    pnl.querySelector('.cm-close').addEventListener('click', function () { setExpanded(false); });
    pnl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { handleAction(b.getAttribute('data-act')); });
    });
    pnl.querySelector('#cm-phead').addEventListener('pointerdown', function (e) { onPanelDragStart(e, pnl); });
    tb.querySelector('.cm-handle').addEventListener('pointerdown', function (e) { onPanelDragStart(e, tb, true); });

    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(String(r.result || ''));
          mergeImportedCardData(data);
          saveAll();
          renderPanel();
          toast('已导入 ' + f.name);
        } catch (err) {
          toast('导入失败：JSON解析错误', true);
        } finally { fi.value = ''; }
      };
      r.readAsText(f, 'utf-8');
    });

    // 根据state恢复展开
    if (state.expanded) {
      setExpanded(true, true);
    }

    renderPanel();
    updateCompletion();
    bindChatObserver();
  }

  function mergeImportedCardData(data) {
    if (!data) return;
    FIELDS.forEach(function (f) {
      if (f.key === 'character_book') {
        if (data.character_book) cardData.character_book = data.character_book;
        return;
      }
      if (data[f.key] !== undefined) {
        // tags/alternate_greetings/regex_scripts 要数组化
        if (f.type === 'tags' || f.key === 'alternate_greetings' || f.key === 'regex_scripts') {
          cardData[f.key] = Array.isArray(data[f.key]) ? data[f.key].slice() : [];
        } else {
          cardData[f.key] = data[f.key];
        }
      }
    });
    // 兼容 data.*
    if (data.data && typeof data.data === 'object') {
      cardData.data = JSON.parse(JSON.stringify(data.data));
    }
    if (data.spec) cardData.spec = data.spec;
    if (data.character_version) cardData.character_version = data.character_version;
    if (data.creator) cardData.creator = data.creator;
    if (data.creator_notes && !cardData.creator_notes) cardData.creator_notes = data.creator_notes;
    ensureCardDataShape();
  }

  function removeAll() {
    var doc = pd(); if (!doc) return;
    ['-toolbar','-panel','-toast','-file','-styles'].forEach(function (s) {
      try { var e = doc.getElementById(SCRIPT_ID + s); if (e) e.remove(); } catch (_) {}
    });
    ui = null;
  }

  function onToolbarClick(e) {
    var act = (e.target.closest ? e.target.closest('[data-act]') : null);
    if (!act) {
      // 空白处：如果是点击 FAB，切换展开
      if (e.target.classList && e.target.classList.contains('cm-handle')) return;
      return;
    }
    handleAction(act.getAttribute('data-act'));
  }

  function handleAction(act) {
    switch (act) {
      case 'toggle': setExpanded(!state.expanded); break;
      case 'close':  setExpanded(false); break;
      case 'export': doExport(); break;
      case 'scan':   scanRecentMessages(); toast('已扫描最近消息'); break;
      case 'write':  scanInputsSync(); toast('已把输入框内容写入面板'); break;
      case 'clear':
        if (confirm('确认清空 IDE 面板全部数据？此操作不可恢复。')) {
          cardData = blankCardData(); ensureCardDataShape();
          saveAll(); renderPanel(); updateCompletion();
          toast('已清空');
        }
        break;
      case 'import-panel':
        if (ui && ui.fileInput) ui.fileInput.click();
        break;
    }
  }

  function setExpanded(v, skipSave) {
    state.expanded = !!v;
    if (!ui) return;
    if (state.expanded) ui.panel.classList.add('show'); else ui.panel.classList.remove('show');
    applyPanelPosition(ui.panel);
    if (!skipSave) { saveLS(LS_KEY, state); }
  }

  // ---- 位置 + 拖拽 (pointer events + boundary clamp + persist) ----
  function applyToolbarPosition(el) {
    var v = vp();
    var rect = el.getBoundingClientRect();
    var w = rect.width || 300, h = rect.height || 44;
    var x = state.toolbarX != null ? state.toolbarX : (v.w - w - 16);
    var y = state.toolbarY != null ? state.toolbarY : (v.h - h - 16);
    x = clamp(x, 8, v.w - w - 8); y = clamp(y, 8, v.h - h - 8);
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function applyPanelPosition(el) {
    if (!ui) return;
    // 面板显示在 toolbar 上方
    var v = vp();
    var tw = ui.toolbar.offsetWidth, th = ui.toolbar.offsetHeight;
    var tRect = ui.toolbar.getBoundingClientRect();
    var pw = Math.min(720, v.w - 24);
    var ph = Math.min(560, v.h - 40);
    var x = clamp(tRect.left + Math.round(tw / 2) - Math.round(pw / 2), 12, v.w - pw - 12);
    var y = clamp(tRect.top - ph - 12, 12, v.h - ph - 12);
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

  // ---- 面板内容渲染（分组Tab + 每行 = toggle/label/len/输入） ----
  function renderPanel() {
    if (!ui) return;
    var tabs = ui.panel.querySelector('[data-tabs]');
    var body = ui.panel.querySelector('[data-body]');
    tabs.innerHTML = '';
    FIELD_GROUPS.forEach(function (g) {
      var d = document.createElement('button');
      d.className = 'cm-tab ' + (activeTab === g ? 'active ' : '') + groupStatus(g);
      d.innerHTML = '<span class="cm-dot"></span>' + esc(g);
      d.addEventListener('click', function () { activeTab = g; renderPanel(); });
      tabs.appendChild(d);
    });
    body.innerHTML = '';
    var frag = document.createDocumentFragment();
    FIELDS.filter(function (f) { return f.group === activeTab; }).forEach(function (f) {
      frag.appendChild(renderFieldRow(f));
    });
    body.appendChild(frag);
    updateCompletion();
  }

  function renderFieldRow(f) {
    var doc = pd();
    var row = doc.createElement('div');
    row.className = 'cm-field';
    row.setAttribute('data-key', f.key);

    // head
    var head = doc.createElement('div');
    head.className = 'cm-field-head';
    var sw = doc.createElement('span');
    sw.className = 'cm-sw' + (getSwitch(f.key) ? ' on' : '');
    sw.title = getSwitch(f.key) ? '关闭：本轮不再让 AI 生成此字段' : '开启：引导 AI 专注生成此字段';
    sw.addEventListener('click', function () {
      setSwitch(f.key, !getSwitch(f.key));
      sw.classList.toggle('on');
      // 切换开关时：往聊天输入框注入一条"请专注生成 XXX 字段"的提示（可选 - 只是视觉开关即可）
    });
    var label = doc.createElement('span');
    label.className = 'cm-label';
    label.innerHTML = esc(f.label) + (f.required ? '<span class="cm-req">*</span>' : '');
    var flen = doc.createElement('span');
    flen.className = 'cm-flen';
    flen.textContent = lengthFor(f);
    var hint = doc.createElement('span');
    hint.className = 'cm-fhint';
    hint.textContent = f.placeholder || '';
    head.appendChild(sw); head.appendChild(label); head.appendChild(flen); head.appendChild(hint);
    row.appendChild(head);

    // body 输入控件
    var ctrl = buildFieldControl(f);
    row.appendChild(ctrl);

    ui.fields[f.key] = { row: row, ctrl: ctrl, sw: sw, len: flen };
    return row;
  }

  function buildFieldControl(f) {
    var doc = pd();
    var v = getFieldValue(f.key);
    var bind = function (el, onChange) {
      el.addEventListener('input', function () {
        onChange(el.value);
        updateLen(f); saveAll();
      });
    };
    switch (f.type) {
      case 'text': {
        var el = doc.createElement('input'); el.type = 'text'; el.className = 'cm-input';
        el.placeholder = f.placeholder || ''; el.value = v != null ? String(v) : '';
        bind(el, function (nv) { setFieldValue(f.key, nv); });
        return el;
      }
      case 'textarea': {
        var el = doc.createElement('textarea'); el.className = 'cm-textarea';
        el.placeholder = f.placeholder || ''; el.rows = f.rows || 4; el.value = v != null ? String(v) : '';
        bind(el, function (nv) { setFieldValue(f.key, nv); });
        return el;
      }
      case 'tags': {
        var wrap = doc.createElement('div'); wrap.className = 'cm-chips';
        var chips = Array.isArray(v) ? v.slice() : [];
        function render() {
          wrap.innerHTML = '';
          chips.forEach(function (c, i) {
            var chip = doc.createElement('span'); chip.className = 'cm-chip';
            chip.innerHTML = esc(c) + ' <button title="删除">×</button>';
            chip.querySelector('button').addEventListener('click', function () {
              chips.splice(i, 1); setFieldValue(f.key, chips); saveAll(); updateLen(f); render();
            });
            wrap.appendChild(chip);
          });
          var inp = doc.createElement('input'); inp.type = 'text'; inp.className = 'cm-chip-input';
          inp.placeholder = f.placeholder + ' (回车或逗号添加)';
          function addFromInput() {
            var t = (inp.value || '').trim();
            if (!t) return;
            t.split(/[,，\n]/).forEach(function (s) {
              s = s.trim(); if (s && chips.indexOf(s) < 0) chips.push(s);
            });
            inp.value = ''; setFieldValue(f.key, chips); saveAll(); updateLen(f); render();
          }
          inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ',' || ev.key === '，') {
              ev.preventDefault(); addFromInput();
            }
          });
          inp.addEventListener('blur', addFromInput);
          wrap.appendChild(inp);
        }
        render();
        return wrap;
      }
      case 'list': {
        var el = doc.createElement('textarea'); el.className = 'cm-textarea';
        el.placeholder = f.placeholder || ''; el.rows = f.rows || 4;
        el.value = Array.isArray(v) ? v.join('\n') : '';
        bind(el, function (nv) {
          setFieldValue(f.key, nv.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean));
        });
        return el;
      }
      case 'jsonlist': {
        var el = doc.createElement('textarea'); el.className = 'cm-textarea';
        el.placeholder = f.placeholder || ''; el.rows = f.rows || 8;
        try { el.value = (v && v.length) ? JSON.stringify(v, null, 2) : ''; } catch (_) { el.value = ''; }
        bind(el, function (nv) {
          var t = nv.trim();
          if (!t) { setFieldValue(f.key, []); return; }
          try { setFieldValue(f.key, JSON.parse(t)); el.classList.remove('err'); }
          catch (_) { el.style.borderColor = '#fca5a5'; }
        });
        return el;
      }
      case 'entries': {
        var container = doc.createElement('div'); container.className = 'cm-entries';
        var entries = (v && Array.isArray(v.entries)) ? v.entries : [];
        function reRender() {
          container.innerHTML = '';
          entries.forEach(function (entry, idx) {
            container.appendChild(renderEntry(entry, idx, function (ne) { entries[idx] = ne; saveCardEntries(); },
              function () { entries.splice(idx,1); saveCardEntries(); reRender(); }));
          });
          var addBtn = doc.createElement('button');
          addBtn.className = 'cm-btn'; addBtn.type = 'button'; addBtn.textContent = '+ 新增条目';
          addBtn.addEventListener('click', function () {
            entries.push({ keys:[], comment:'自定义条目' + (entries.length+1), content:'', extensions:{position:1,depth:3}, insertion_order:100, enabled:true, constant:false, selective:true });
            saveCardEntries(); reRender();
          });
          container.appendChild(addBtn);
        }
        function saveCardEntries() {
          if (!cardData.character_book) cardData.character_book = { description:'', scan_depth:50, entries:[] };
          cardData.character_book.entries = entries;
          setFieldValue('character_book', cardData.character_book);
          saveAll(); updateLen(f);
        }
        function renderEntry(entry, idx, onChange, onDelete) {
          var eRow = doc.createElement('div'); eRow.className = 'cm-entry';
          var head = doc.createElement('div'); head.className = 'cm-entry-head';
          var idxTag = doc.createElement('small'); idxTag.textContent = '#' + (idx+1);
          var cmInput = doc.createElement('input');
          cmInput.value = entry.comment || ''; cmInput.placeholder = 'comment（含<前缀>自动套模板）';
          cmInput.addEventListener('input', function () { entry.comment = cmInput.value; onChange(entry); });
          var enInput = doc.createElement('input'); enInput.type = 'checkbox';
          enInput.title = 'enabled'; enInput.checked = !!entry.enabled;
          enInput.addEventListener('change', function () { entry.enabled = enInput.checked; onChange(entry); });
          var enLabel = doc.createElement('small'); enLabel.textContent = '启用';
          var delBtn = doc.createElement('button'); delBtn.className = 'cm-btn'; delBtn.type = 'button';
          delBtn.textContent = '删'; delBtn.addEventListener('click', onDelete);
          head.appendChild(idxTag); head.appendChild(cmInput); head.appendChild(enInput); head.appendChild(enLabel); head.appendChild(delBtn);

          var keysBox = doc.createElement('div'); keysBox.className = 'cm-entry-keys';
          (entry.keys || []).forEach(function (k) {
            var ks = doc.createElement('span'); ks.className = 'cm-entry-key';
            ks.textContent = '🔑 ' + k; keysBox.appendChild(ks);
          });

          var cta = doc.createElement('textarea');
          cta.placeholder = 'content (≥250字建议)';
          cta.value = entry.content || '';
          cta.rows = Math.max(3, Math.min(10, 1 + Math.floor((entry.content || '').length / 60)));
          cta.addEventListener('input', function () {
            entry.content = cta.value; onChange(entry);
            cta.rows = Math.max(3, Math.min(16, 1 + Math.floor(cta.value.length / 60)));
          });
          eRow.appendChild(head); eRow.appendChild(keysBox); eRow.appendChild(cta);
          return eRow;
        }
        reRender();
        return container;
      }
    }
    return doc.createElement('div');
  }

  function getSwitch(key) {
    if (state.switches[key] !== undefined) return !!state.switches[key];
    // 默认：required字段开，非必填关
    var f = FIELDS.find(function (x) { return x.key === key; });
    return f ? !!f.required : false;
  }
  function setSwitch(key, val) {
    state.switches[key] = !!val;
    saveLS(LS_KEY, state);
  }

  function lengthFor(f) {
    var v = getFieldValue(f.key);
    switch (f.type) {
      case 'text': case 'textarea': return (v ? String(v).length : 0) + '字';
      case 'tags': return (v ? v.length : 0) + '项';
      case 'list': return (v ? v.length : 0) + '行';
      case 'jsonlist': return (v ? v.length : 0) + '条';
      case 'entries':
        var n = (v && v.entries) ? v.entries.length : 0;
        var totalChars = 0;
        if (v && v.entries) v.entries.forEach(function (e) { totalChars += (e.content || '').length; });
        return n + '条 / ' + totalChars + '字';
    }
    return '';
  }
  function updateLen(f) {
    var x = ui && ui.fields && ui.fields[f.key];
    if (x && x.len) x.len.textContent = lengthFor(f);
  }
  function updateCompletion() {
    var c = calcCompletion();
    if (ui) {
      ui.toolbar.querySelectorAll('[data-cmp]').forEach(function (e) { e.textContent = c.pct + '%'; });
      ui.panel.querySelectorAll('[data-cmp]').forEach(function (e) { e.textContent = c.pct + '%'; });
    }
    // tabs 状态点重绘
    if (ui) {
      var tabs = ui.panel.querySelectorAll('.cm-tab');
      FIELD_GROUPS.forEach(function (g, i) {
        var el = tabs[i]; if (!el) return;
        el.classList.remove('done','partial');
        var st = groupStatus(g);
        if (st) el.classList.add(st);
      });
    }
  }
  function scanInputsSync() {
    if (!ui) return;
    // 重新从 DOM 读 -> 目前是实时绑定的，所以这里只是 updateLen + save
    FIELDS.forEach(function (f) { updateLen(f); });
    saveAll(); updateCompletion();
  }

  // ---- 导入导出 ----
  function buildExportableCard() {
    ensureCardDataShape();
    // Deep copy & strip UI-only helpers
    var d = JSON.parse(JSON.stringify(cardData));
    // Build chara_card_v3 spec minimal wrapper (even if user didn't fill all)
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
        creator_notes: d.creator_notes || d.data && d.data.creator_notes || '',
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
    // Also keep depth_prompt if non-empty
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

  // ---- Toast ----
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

  // ---- 消息扫描：把最新 AI 回复中的 ```json``` 块合并入 cardData ----
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
    // 宽容：找第一个 { ... } 顶层
    var s = raw.indexOf('{'); var e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) { try { return JSON.parse(raw.slice(s, e+1)); } catch (_) {} }
    return null;
  }
  function mergeJsonIntoCardData(patch) {
    if (!patch || typeof patch !== 'object') return 0;
    // 忽略 _nochange
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
          // 走原 Card_making_tool.js 的 mergePartial 语义：按 comment / _action delete / 新增
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
    // 顶层字段直接应用
    FIELDS.forEach(function (f) {
      if (patch[f.key] !== undefined) {
        if (applyTop(f.key, patch[f.key], f.type)) changed++;
      }
    });
    // entries 直接作为顶层字段（AI 最常见的写法）
    if (Array.isArray(patch.entries) && patch.entries.length) {
      var cur = cardData.character_book || { description:'', scan_depth:50, entries:[] };
      var beforeN = (cur.entries || []).length;
      cur.entries = applyEntriesPatch(cur.entries || [], patch.entries);
      cardData.character_book = cur;
      if (cur.entries.length !== beforeN) changed++;
    }
    // _delete / delete / remove / deleted_entries
    var delPaths = [];
    ['_delete','delete','deletes','remove','removes','deleted_entries'].forEach(function (dk) {
      if (Array.isArray(patch[dk])) {
        patch[dk].forEach(function (p) { delPaths.push(String(p)); });
      }
    });
    if (delPaths.length) {
      var cb = cardData.character_book || { entries: [] };
      var arr = cb.entries || [];
      var toDel = [];
      delPaths.forEach(function (raw) {
        var key = raw.replace(/^character_book\.entries\./, '');
        var idx = parseInt(key, 10);
        if (!isNaN(idx) && String(idx) === key && idx >= 0 && idx < arr.length) { toDel.push(idx); return; }
        // comment 精确 / 包含匹配（≥6字且多条仅精确）
        var exact = []; var fuzzy = [];
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
    // character: {...} 平铺包装
    if (patch.character && typeof patch.character === 'object') {
      for (var k in patch.character) { if (FIELDS.some(function (f) { return f.key === k; })) {
        if (applyTop(k, patch.character[k], (FIELDS.find(function(f){return f.key===k})||{}).type)) changed++;
      }}
    }
    return changed;
  }
  function applyEntriesPatch(existing, incoming) {
    // 简化版 mergePartial：精确 comment 匹配更新；单条 <前缀> 匹配更新；内容相似 35% 更新；其他追加；_action 删除
    var arr = existing.slice();
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
        // 合并：新的覆盖旧的，旧的缺失字段保留
        arr[idx] = Object.assign({}, arr[idx], ne);
        // 应用前缀模板默认值
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
    // 精确
    for (var i=0;i<arr.length;i++) if ((arr[i].comment||'') === neC) return i;
    // 同前缀单条
    if (nePref) {
      var same = arr.map(function (e, i) { return { i:i, p: prefixOf(e.comment||''), c: e.content||'' }; })
        .filter(function (x) { return x.p === nePref; });
      if (same.length === 1) return same[0].i;
      // 同前缀下 Jaccard
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
    // 摘自 Card_making_tool.js ENTRY_TEMPLATES 核心项
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
    // [InitVar]xxx
    if (pref.charAt(0) === '[') {
      // 精确键匹配
      for (var k in PREFIX_DEFAULTS) {
        if (k.charAt(0) === '[' && pref.indexOf(k.replace(/[\[\]]/g,'')) >= 0) {
          fill(entry, PREFIX_DEFAULTS[k]); return;
        }
      }
      return;
    }
    if (PREFIX_DEFAULTS[pref]) { fill(entry, PREFIX_DEFAULTS[pref]); return; }
    // 最长子串
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
    // 用 defaults 填 entry 但不覆盖已有非 undefined 字段（除了 extensions 需要放进去）
    for (var k in defaults) {
      if (!defaults.hasOwnProperty(k)) continue;
      if (k === 'position' || k === 'depth' || k === 'role' || k === 'probability' || k === 'selectiveLogic'
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
    if (entry.selectiveLogic === undefined && defaults.selectiveLogic !== undefined) entry.selectiveLogic = defaults.selectiveLogic;
  }

  // ---- 从 ST 聊天 DOM 扫描最新 12 条消息 ----
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
    if (ui) renderPanel();
    updateCompletion();
    return applied;
  }

  // ---- 监听聊天消息更新（自动扫新消息）----
  var _lastSeen = 0;
  var _mutObs = null;
  function bindChatObserver() {
    if (_mutObs) return;
    var doc = pd(); if (!doc || !doc.body) return;
    try {
      _mutObs = new MutationObserver(function (muts) {
        // 节流：每 1.2s 最多一次
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

  // ---- 启动 ----
  function init() {
    try {
      renderToolbar();
      window.addEventListener('resize', function () {
        if (!ui) return;
        applyToolbarPosition(ui.toolbar);
        if (state.expanded) applyPanelPosition(ui.panel);
      });
    } catch (err) {
      console.error('[时之写卡器IDE] init error:', err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else setTimeout(init, 0);

  // 暴露到 window：方便调试
  window.CM_IDE = {
    get state() { return state; },
    get cardData() { return cardData; },
    setCardField: setFieldValue,
    getCardField: getFieldValue,
    export: doExport,
    scan: scanRecentMessages,
    reset: function () { cardData = blankCardData(); ensureCardDataShape(); saveAll(); if (ui) renderPanel(); updateCompletion(); },
    mergePatch: function (p) { mergeJsonIntoCardData(p); saveAll(); if (ui) renderPanel(); updateCompletion(); },
  };
})();
