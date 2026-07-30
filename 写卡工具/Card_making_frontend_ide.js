/* ===========================================================
   时之写卡器 - 悬浮仪表盘 (Card_making_frontend_ide.js)
   -----------------------------------------------------------
   · 极简悬浮横条，点击「⚡写卡」展开仪表盘
   · 仪表盘显示：质检结果 / 快捷按钮 / 统计 / 导出
   · 快捷按钮往 ST 聊天输入框注入提示词并自动发送
   · 自动监听聊天消息里的 ```json``` 块，合并入 cardData
   · 最后【导出】下载 chara_card_v3.json，不直接写 ST
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
    return document;
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
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function vp() {
    try { var v = (window.parent && window.parent.visualViewport); if (v) return { w: v.width, h: v.height }; } catch (_) {}
    return { w: (window.parent && window.parent.innerWidth) || window.innerWidth || 390, h: (window.parent && window.parent.innerHeight) || window.innerHeight || 700 };
  }
  function countTokens(text) {
    if (!text) return 0;
    var t = String(text);
    var cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var enWords = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
    return cn + Math.ceil(enWords * 0.75);
  }
  function isMVUEntry(comment) {
    var c = (comment || '').toLowerCase();
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
           c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
           c.indexOf('updatevariable') >= 0 || c.indexOf('变量分段') >= 0;
  }

  // ---------- 空白卡数据 ----------
  function blankCardData() {
    return {
      name: '', description: '', personality: '', scenario: '',
      first_mes: '', system_prompt: '', post_history_instructions: '',
      tags: [], mes_example: '', alternate_greetings: [], depth_prompt: '',
      regex_scripts: [], creator_notes: '',
      character_book: { description: '', scan_depth: 50, entries: [] },
      data: { version: 'chara_card_v3' }, spec: 'chara_card_v3',
      character_version: '1.0', creator: '', extensions: {}
    };
  }
  function ensureCardDataShape() {
    if (!cardData || typeof cardData !== 'object') cardData = blankCardData();
    ['name','description','personality','scenario','first_mes','system_prompt',
     'post_history_instructions','mes_example','depth_prompt','creator_notes']
      .forEach(function(k){ if (typeof cardData[k] !== 'string') cardData[k] = ''; });
    if (!Array.isArray(cardData.tags)) cardData.tags = [];
    if (!Array.isArray(cardData.alternate_greetings)) cardData.alternate_greetings = [];
    if (!Array.isArray(cardData.regex_scripts)) cardData.regex_scripts = [];
    if (!cardData.character_book || typeof cardData.character_book !== 'object')
      cardData.character_book = { description:'', scan_depth:50, entries: [] };
    if (!Array.isArray(cardData.character_book.entries)) cardData.character_book.entries = [];
    if (!cardData.data || typeof cardData.data !== 'object') cardData.data = { version: 'chara_card_v3' };
  }

  // ---------- 状态 ----------
  var state = loadLS(LS_KEY, { expanded: false, toolbarX: null, toolbarY: null });
  var cardData = loadLS(STORAGE_KEY, blankCardData());
  ensureCardDataShape();
  function saveAll() { saveLS(LS_KEY, state); saveLS(STORAGE_KEY, cardData); }

  // ================================================================
  //  质检（从 Card_making_tool.js 移植，32项核心 + 6项附加 + 6项MVU）
  // ================================================================
  function runQualityCheck(cd) {
    var results = [];
    var desc = cd.description || '', first = cd.first_mes || '', sys = cd.system_prompt || '';
    var notes = cd.creator_notes || '', personality = cd.personality || '', scenario = cd.scenario || '';
    var name = cd.name || '', phi = cd.post_history_instructions || '', mesEx = cd.mes_example || '';
    var altG = cd.alternate_greetings || [];
    var entries = (cd.character_book || {}).entries || [];
    var hasEntries = entries.length > 0;
    var tags = cd.tags || [];
    var ext = cd.extensions || {};
    var dp = ext.depth_prompt || {};
    var rx = cd.regex_scripts || [];

    // === 基础字段（8项） ===
    results.push({ pass: name.length >= 1, category: '基础字段', name: '世界/角色名称', desc: '当前：' + (name || '(空)'), fix: name.length < 1 ? '请设置一个简洁有力的名称' : '名称已设置' });
    results.push({ pass: desc.length >= 400, category: '基础字段', name: '世界观描述 ≥400字', desc: '当前 ' + desc.length + ' 字', fix: desc.length < 400 ? '建议≥400字' : '字数充足' });
    results.push({ pass: personality.length === 0, category: '基础字段', name: '性格（世界模式留空）', desc: '当前 ' + personality.length + ' 字', fix: personality.length > 0 ? '世界模式下应留空' : '已留空' });
    results.push({ pass: scenario.length === 0, category: '基础字段', name: '场景（世界模式留空）', desc: '当前 ' + scenario.length + ' 字', fix: scenario.length > 0 ? '世界模式下应留空' : '已留空' });
    results.push({ pass: first.length >= 500, category: '基础字段', name: '开场白 ≥500字', desc: '当前 ' + first.length + ' 字', fix: first.length < 500 ? '建议500-800字' : '开场充足' });
    results.push({ pass: sys.length > 0 && sys.length <= 50, category: '基础字段', name: '系统指令 ≤50字', desc: sys.length ? (sys.length + ' 字') : '未设置', fix: sys.length > 50 ? '应精简至≤50字' : (sys.length === 0 ? '建议设置AI身份定位' : '适中') });
    results.push({ pass: phi.length > 0 && phi.length <= 100, category: '基础字段', name: '核心铁则 ≤100字', desc: phi.length ? (phi.length + ' 字') : '未设置', fix: phi.length === 0 ? '必须设置post_history_instructions' : (phi.length > 100 ? '应精简至≤100字' : '已在最高权重位') });
    results.push({ pass: tags.length >= 2 && tags.length <= 12, category: '基础字段', name: '标签 2-12个', desc: '当前 ' + tags.length + ' 个', fix: tags.length < 2 ? '建议2-12个' : (tags.length > 12 ? '过多' : '适中') });

    // === 高价值字段（4项） ===
    results.push({ pass: mesEx.length >= 50, category: '高价值字段', name: '对话示例 Few-shot', desc: mesEx.length ? (mesEx.length + ' 字') : '未设置', fix: mesEx.length < 50 ? '建议1-2组对话示例' : '已设置' });
    results.push({ pass: altG.length >= 3, category: '高价值字段', name: '备用开场白 3个', desc: '当前 ' + altG.length + ' 个', fix: altG.length < 3 ? '建议3个差异化开局' : '完整' });
    results.push({ pass: dp.prompt && dp.prompt.length > 0, category: '高价值字段', name: '新手引导 depth_prompt', desc: dp.prompt ? (dp.prompt.length + ' 字') : '未设置', fix: !dp.prompt ? '建议生成新手引导' : '已设置' });
    results.push({ pass: rx.length > 0, category: '高价值字段', name: '正则脚本 状态同步', desc: '当前 ' + rx.length + ' 条', fix: rx.length === 0 ? '建议生成状态同步正则' : '已配置' });

    // === 世界书（6项） ===
    results.push({ pass: entries.length >= 12 && entries.length <= 30, category: '世界书', name: '条目数 12-30条', desc: '当前 ' + entries.length + ' 条', fix: entries.length < 12 ? '建议补充至12条以上' : (entries.length > 30 ? '过多' : '达标') });
    var entriesWithKeys = entries.filter(function(e) { return e.keys && e.keys.length > 0; }).length;
    results.push({ pass: hasEntries && entriesWithKeys >= entries.length * 0.5, category: '世界书', name: '触发词覆盖率 ≥50%', desc: entriesWithKeys + '/' + entries.length + ' 条', fix: !hasEntries ? '无条目' : (entriesWithKeys < entries.length * 0.5 ? '建议设更多触发词' : '良好') });
    var entriesWithContent = entries.filter(function(e) { return (e.content || '').length >= 250; }).length;
    results.push({ pass: hasEntries && entriesWithContent >= Math.max(1, entries.length * 0.5), category: '世界书', name: '条目内容 ≥250字', desc: entriesWithContent + '/' + entries.length + ' 条达标', fix: !hasEntries ? '无条目' : (entriesWithContent < entries.length * 0.5 ? '建议扩充至250字' : '充实') });
    var entriesWithPrefix = entries.filter(function(e) { return /^<[^>]+>/.test(e.comment || '') || /^\[InitVar\]/.test(e.comment || '') || isMVUEntry(e.comment || ''); }).length;
    results.push({ pass: hasEntries && entriesWithPrefix >= Math.max(1, entries.length * 0.5), category: '世界书', name: '命名规范 ≥50%', desc: entriesWithPrefix + '/' + entries.length + ' 条', fix: !hasEntries ? '无条目' : (entriesWithPrefix < entries.length * 0.5 ? '建议用<前缀>' : '良好') });
    var coreIronRuleCount = entries.filter(function(e) { return (e.comment||'').indexOf('<核心铁则>') >= 0 || (e.comment||'').indexOf('<禁止项>') >= 0; }).length;
    results.push({ pass: phi.length > 0 || coreIronRuleCount >= 1, category: '世界书', name: '权重合理性', desc: 'post_history: ' + (phi.length > 0 ? '✓' : '✗') + ' | 铁则: ' + coreIronRuleCount, fix: phi.length === 0 && coreIronRuleCount === 0 ? '核心规则须在高权重位' : '合理' });
    var selfContainedBadPatterns = ['如上所述', '见上文', '前文提到', '之前说过', '上述内容', '上面提到'];
    var nonSelfContained = entries.filter(function(e) { return selfContainedBadPatterns.some(function(p) { return (e.content||'').indexOf(p) >= 0; }); }).length;
    results.push({ pass: !hasEntries || nonSelfContained === 0, category: '世界书', name: 'content自包含性', desc: nonSelfContained + ' 条有上下文依赖', fix: nonSelfContained > 0 ? '禁止"如上所述"等' : '良好' });

    // === 世界书高级（8项） ===
    var hasRecursion = entries.some(function(e) { var x=e.extensions||{}; return x.delay_until_recursion === true || x.delay_until_recursion === 1; });
    results.push({ pass: !hasEntries || hasRecursion, category: '世界书高级', name: '递归链条 delay_until_recursion', desc: hasRecursion ? '已配置' : '未发现', fix: !hasEntries ? '无条目' : (!hasRecursion ? '建议开启delay_until_recursion' : '已配置') });
    var hasGroup = entries.some(function(e) { return (e.extensions||{}).group; });
    results.push({ pass: !hasEntries || hasGroup, category: '世界书高级', name: '分组机制 group', desc: hasGroup ? '已使用' : '未使用', fix: !hasEntries ? '无条目' : (!hasGroup ? '建议用group分组' : '已配置') });
    var hasSecKeys = entries.some(function(e) { return e.secondary_keys && e.secondary_keys.length > 0; });
    results.push({ pass: !hasEntries || hasSecKeys, category: '世界书高级', name: '次级键 secondary_keys', desc: hasSecKeys ? '已使用' : '未使用', fix: !hasEntries ? '无条目' : (!hasSecKeys ? '建议设secondary_keys' : '已配置') });
    var hasProb = entries.some(function(e) { var x=e.extensions||{}; return x.useProbability === true && x.probability < 100; });
    results.push({ pass: !hasEntries || hasProb, category: '世界书高级', name: '概率事件 probability<100', desc: hasProb ? '已使用' : '未使用', fix: !hasEntries ? '无条目' : (!hasProb ? '建议概率触发' : '已配置') });
    var hasRegexKey = entries.some(function(e) { return (e.keys||[]).some(function(k) { return typeof k === 'string' && k.indexOf('/') === 0; }); });
    results.push({ pass: !hasEntries || hasRegexKey, category: '世界书高级', name: '正则触发键', desc: hasRegexKey ? '已使用' : '未使用', fix: !hasEntries ? '无条目' : (!hasRegexKey ? '可用正则键' : '已配置') });
    var hasGroupScoring = entries.some(function(e) { return (e.extensions||{}).use_group_scoring === true; });
    results.push({ pass: !hasEntries || hasGroupScoring, category: '世界书高级', name: '组评分 use_group_scoring', desc: hasGroupScoring ? '已配置' : '未使用', fix: !hasEntries ? '无条目' : (!hasGroupScoring ? '建议开启' : '已配置') });
    var stickyCdConflict = entries.filter(function(e) { var x=e.extensions||{}; var s = x.sticky, c = x.cooldown; return s && c && s !== 0 && c !== 0; }).length;
    results.push({ pass: !hasEntries || stickyCdConflict === 0, category: '世界书高级', name: 'sticky/cooldown冲突', desc: stickyCdConflict + ' 条冲突', fix: stickyCdConflict > 0 ? '不应同时使用' : '无冲突' });
    var posErrors = entries.filter(function(e) { var p=e.position, x=e.extensions||{}; if (e.constant === true && p > 1) return true; if (p === 6 && (x.depth === undefined || x.role === undefined)) return true; if (p === 7 && !x.outlet_name) return true; return false; }).length;
    results.push({ pass: !hasEntries || posErrors === 0, category: '世界书高级', name: 'position配置合理性', desc: posErrors + ' 条有误', fix: posErrors > 0 ? '检查position配置' : '正确' });

    // === 正则脚本（6项） ===
    var multiFn = rx.filter(function(s) { var n=s.scriptName||''; var f=['状态','格式','标签','高亮','过滤','替换','清理']; return f.filter(function(x){return n.indexOf(x)>=0;}).length > 1; }).length;
    results.push({ pass: rx.length === 0 || multiFn === 0, category: '正则脚本', name: '脚本功能单一', desc: rx.length + ' 条，' + multiFn + ' 条混合', fix: multiFn > 0 ? '建议拆分' : '清晰' });
    var missingG = rx.filter(function(s) { var p=s.findRegex||''; var m=p.match(/\/([gimsu]*)$/); return !m || m[1].indexOf('g') < 0; }).length;
    results.push({ pass: rx.length === 0 || missingG === 0, category: '正则脚本', name: '正则标志 g全局', desc: missingG + ' 条缺g', fix: missingG > 0 ? '需加g标志' : '正确' });
    var greedy = rx.filter(function(s) { var p=s.findRegex||''; return p.indexOf('.*?') < 0 && p.indexOf('.+?') < 0 && (p.indexOf('.*') >= 0 || p.indexOf('.+') >= 0); }).length;
    results.push({ pass: rx.length === 0 || greedy === 0, category: '正则脚本', name: '非贪婪匹配 .*?', desc: greedy + ' 条贪婪', fix: greedy > 0 ? '用.*?' : '安全' });
    var missingPlace = rx.filter(function(s) { return !s.placement || !Array.isArray(s.placement) || s.placement.length === 0; }).length;
    results.push({ pass: rx.length === 0 || missingPlace === 0, category: '正则脚本', name: 'placement配置', desc: missingPlace + ' 条未设', fix: missingPlace > 0 ? '需设placement' : '正确' });
    var badSub = rx.filter(function(s) { var sr=s.substituteRegex; return sr !== undefined && sr !== null && (sr < 0 || sr > 2); }).length;
    results.push({ pass: rx.length === 0 || badSub === 0, category: '正则脚本', name: 'substituteRegex 0-2', desc: badSub + ' 条超范围', fix: badSub > 0 ? '须0-2' : '正确' });
    var noRunOnEdit = rx.filter(function(s) { var n=(s.scriptName||'').toLowerCase(); return (n.indexOf('状态')>=0||n.indexOf('status')>=0) && s.runOnEdit !== true; }).length;
    results.push({ pass: rx.length === 0 || noRunOnEdit === 0, category: '正则脚本', name: '状态栏脚本runOnEdit', desc: noRunOnEdit + ' 条未开', fix: noRunOnEdit > 0 ? '建议开启' : '正确' });

    // === 运行效果（3项） ===
    var permTok = entries.filter(function(e){return e.constant===true;}).reduce(function(s,e){return s+countTokens(e.content||'');},0) + countTokens(phi);
    results.push({ pass: permTok <= 500, category: '运行效果', name: '常驻Token ≤500', desc: '当前 ' + permTok + ' T', fix: permTok > 500 ? '常驻过多' : '合理' });
    var entityEntries = entries.filter(function(e) { var c=e.comment||''; return c.indexOf('<实体交互>')>=0||c.indexOf('<重要角色>')>=0||c.indexOf('<势力与组织>')>=0||c.indexOf('<物品>')>=0||c.indexOf('<地点场景>')>=0; });
    var noPrevent = entityEntries.filter(function(e) { return !(e.extensions && e.extensions.prevent_recursion); }).length;
    results.push({ pass: entityEntries.length === 0 || noPrevent === 0, category: '运行效果', name: '递归安全 prevent_recursion', desc: entityEntries.length + ' 实体，' + noPrevent + ' 未防护', fix: noPrevent > 0 ? '须开prevent_recursion' : '安全' });
    var sceneEntries = entries.filter(function(e) { var c=e.comment||''; return c.indexOf('<场景机制>')>=0||c.indexOf('<核心玩法>')>=0||c.indexOf('<世界规则>')>=0; });
    var noCd = sceneEntries.filter(function(e) { return !(e.extensions && e.extensions.cooldown && e.extensions.cooldown > 0); }).length;
    results.push({ pass: sceneEntries.length === 0 || noCd === 0, category: '运行效果', name: '冷却防抖 cooldown', desc: sceneEntries.length + ' 场景，' + noCd + ' 未设', fix: noCd > 0 ? '建议cooldown=3' : '已配置' });

    // === 附加检查（6项） ===
    var highRisk = ['的','是','在','有','了','和','就','都','而','及','与','一个','一些','什么','如何','怎么'];
    var risky = entries.filter(function(e) { return (e.keys||[]).some(function(k){return highRisk.indexOf(k)>=0;}); }).length;
    results.push({ pass: risky === 0, category: '附加检查', name: '触发词精准度', desc: risky + ' 条泛用', fix: risky > 0 ? '避免泛用词' : '精准' });
    var totalTok = countTokens(desc)+countTokens(first)+countTokens(sys)+countTokens(phi)+countTokens(mesEx)+entries.reduce(function(s,e){return s+countTokens(e.content||'');},0);
    var w8k = Math.round(totalTok/8192*100);
    results.push({ pass: w8k <= 60, category: '附加检查', name: '上下文占用', desc: '8k: ' + w8k + '%', fix: w8k > 60 ? '偏多' : '合理' });
    var cnWhole = entries.filter(function(e) { return e.match_whole_words === true || (e.extensions&&e.extensions.match_whole_words===true); }).length;
    results.push({ pass: cnWhole === 0, category: '附加检查', name: '中文适配 match_whole_words', desc: cnWhole + ' 条误开', fix: cnWhole > 0 ? '中文应关闭' : '正确' });
    results.push({ pass: notes.length <= 100, category: '附加检查', name: '创作者备注 ≤100字', desc: notes.length + ' 字', fix: notes.length > 100 ? '精简' : '适中' });
    var groupConflicts = {};
    entries.forEach(function(e) { var g=(e.extensions||{}).group; if (g && e.constant) { if (!groupConflicts[g]) groupConflicts[g]=[]; groupConflicts[g].push(e); } });
    var conflictGrps = Object.keys(groupConflicts).filter(function(g){return groupConflicts[g].length>1;});
    results.push({ pass: conflictGrps.length === 0, category: '附加检查', name: '常驻group冲突', desc: conflictGrps.length === 0 ? '无冲突' : (conflictGrps.length + '组冲突'), fix: conflictGrps.length > 0 ? '常驻不应设group' : '正确' });
    results.push({ pass: name.length > 0 && name.length <= 30, category: '附加检查', name: '名称长度 ≤30字', desc: name.length + ' 字', fix: name.length > 30 ? '精简' : '适中' });

    // === MVU变量系统（6项） ===
    var mvuEntries = entries.filter(function(e) { return isMVUEntry(e.comment || ''); });
    var hasInitVar = mvuEntries.some(function(e) { return (e.comment||'').indexOf('[InitVar]') >= 0; });
    var hasVarList = mvuEntries.some(function(e) { return (e.comment||'').indexOf('变量列表') >= 0; });
    var hasVarRule = mvuEntries.some(function(e) { return (e.comment||'').indexOf('变量更新规则') >= 0; });
    var hasVarFmt = mvuEntries.some(function(e) { return (e.comment||'').indexOf('变量输出格式') >= 0; });
    var hasAnyMVU = mvuEntries.length > 0;
    var initVarEnabledWrong = mvuEntries.some(function(e) { return (e.comment||'').indexOf('[InitVar]') >= 0 && e.enabled === true; });
    var varListEntry = mvuEntries.find(function(e) { return (e.comment||'').indexOf('变量列表') >= 0; });
    var hasVarMacro = varListEntry ? /\{\{format_message_variable::stat_data\}\}/.test(varListEntry.content || '') : false;
    results.push({ pass: !hasAnyMVU || (hasInitVar && hasVarList && hasVarRule && hasVarFmt), category: 'MVU变量系统', name: 'MVU四大核心完整', desc: hasAnyMVU ? ('InitVar:'+(hasInitVar?'✓':'✗')+' 列表:'+(hasVarList?'✓':'✗')+' 规则:'+(hasVarRule?'✓':'✗')+' 格式:'+(hasVarFmt?'✓':'✗')) : '未使用', fix: !hasAnyMVU ? '如需变量系统请生成4条目' : (!hasInitVar ? '缺InitVar' : (!hasVarList ? '缺变量列表' : (!hasVarRule ? '缺更新规则' : '缺输出格式'))) });
    results.push({ pass: !hasInitVar || !initVarEnabledWrong, category: 'MVU变量系统', name: 'InitVar enabled=false', desc: !hasInitVar ? '无' : (initVarEnabledWrong ? '误开' : '正确'), fix: initVarEnabledWrong ? '须禁用' : '正确' });
    results.push({ pass: !hasVarList || hasVarMacro, category: 'MVU变量系统', name: '变量列表含宏', desc: !hasVarList ? '无' : (hasVarMacro ? '已含' : '缺失'), fix: hasVarList && !hasVarMacro ? '须含{{format_message_variable::stat_data}}' : '正确' });
    results.push({ pass: !hasAnyMVU || true, category: 'MVU变量系统', name: 'MVU脚本自动注入', desc: hasAnyMVU ? '导出时注入' : '未使用', fix: '正确' });
    results.push({ pass: !hasAnyMVU || true, category: 'MVU变量系统', name: 'MVU正则自动注入', desc: hasAnyMVU ? '导出时注入' : '未使用', fix: '正确' });
    results.push({ pass: !hasAnyMVU || true, category: 'MVU变量系统', name: 'StatusPlaceHolder自动追加', desc: hasAnyMVU ? '导出时追加' : '未使用', fix: '正确' });

    return results;
  }

  // ---------- 快捷按钮提示词（从 handleQuickAction 移植） ----------
  var QUICK_PROMPTS = {
    next: '下一步我该做什么？请根据当前完成度和未达标项，给出2-3条具体可执行的建议，并说明每条建议会改善哪个体系。',
    summary: '帮我梳理一下当前已收集的信息和进度：1) 已完成的核心设定 2) 各体系完成情况 3) 还缺什么 4) 推荐的下一步。用简洁列表呈现。',
    opening: '请根据现有世界观设定生成一段500-800字的开场白（first_mes）。要求：场景描写→主角出场→冲突/悬念→结尾留钩。必须是完整文本，禁止占位符。',
    axiom: '请帮我完善【基础公理】体系：世界元数据、世界观公理、力量体系骨架。输出到```json代码块的 entries 字段，使用<基础公理>前缀，constant=true，position=0，每条content≥250字。',
    soft_rules: '请帮我设计【交互软规则】体系：互动选项规则、叙事风格引导、剧情节奏控制。输出到```json代码块，使用<交互软规则>前缀。',
    core_rules: '请帮我完善【核心铁则】体系：绝对禁止项、输出格式要求、AI身份定位。核心规则放post_history_instructions（≤100字分号分隔），详细规则放<核心铁则>条目。',
    near_constraint: '请帮我设计【近场强约束】体系：当前局势、即时状态、临时任务。输出到```json代码块，使用<近场强约束>前缀，触发式条目depth=2。',
    scene_mechanics: '请帮我完善【场景机制】体系：核心玩法、世界规则、战斗/修炼/谈判等机制。输出到```json代码块，使用<场景机制>前缀。',
    entity_interact: '请帮我设计【实体交互】体系：重要角色（NPC）、势力与组织、关键物品、地点场景。输出到```json代码块，使用<实体交互>前缀，prevent_recursion=true。',
    narrative_bg: '请帮我完善【叙事背景】体系：故事发展、文化与习俗、历史事件、主线剧情。输出到```json代码块，使用<叙事背景>前缀，delay_until_recursion=true。',
    dynamic_adapt: '请帮我设计【动态适配】体系：引导机制、互动选项、状态栏、depth_prompt新手引导、alternate_greetings备用开局。输出到```json代码块。',
    init_var: '请帮我设计MVU变量系统：1) [InitVar]初始变量（enabled=false，YAML格式） 2) 变量列表（含{{format_message_variable::stat_data}}宏） 3) 变量更新规则 4) 变量输出格式（[mvu_update]前缀）。输出到```json代码块的 entries 字段。',
    generate: '生成完整角色卡',
    optimize: '请根据质检报告优化所有未达标项，逐项修复后输出完整的```json代码块。',
    qc: '__QC__',
    weight: '__WEIGHT__',
    group: '__GROUP__',
  };

  // 快捷按钮定义（按进度阶段高亮）
  function getQuickActions() {
    var p = calcProgress();
    var hasEntries = cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0;
    var hasFirst = cardData.first_mes && cardData.first_mes.length > 50;
    var actions = [];
    if (p < 20) {
      actions.push({ action: 'core_rules', label: '🔐 定核心铁则', hl: true });
      actions.push({ action: 'axiom', label: '🏛️ 搭世界基底' });
    } else if (p < 40) {
      actions.push({ action: 'axiom', label: '🏛️ 搭世界基底', hl: true });
      actions.push({ action: 'soft_rules', label: '🤝 交互软规则' });
    } else if (p < 60) {
      actions.push({ action: 'entity_interact', label: '👥 做实体内容', hl: true });
      actions.push({ action: 'scene_mechanics', label: '⚔️ 加场景规则' });
    } else if (p < 80) {
      actions.push({ action: 'narrative_bg', label: '📖 补叙事背景' });
      actions.push({ action: 'dynamic_adapt', label: '🔄 做动态适配', hl: true });
    } else if (p < 95) {
      actions.push({ action: 'init_var', label: '📊 配变量系统', hl: true });
      actions.push({ action: 'generate', label: '✨ 生成角色卡' });
    } else {
      actions.push({ action: 'generate', label: '✨ 生成角色卡', hl: true });
      actions.push({ action: 'optimize', label: '🔧 优化' });
    }
    actions.push({ action: 'next', label: '💡 下一步' });
    actions.push({ action: 'summary', label: '📊 当前进度' });
    if (!hasFirst && p >= 20) actions.push({ action: 'opening', label: '🎬 生成开场白' });
    actions.push({ action: 'qc', label: '✅ 质检' });
    actions.push({ action: 'optimize', label: '🔧 优化' });
    if (hasEntries) {
      actions.push({ action: 'weight', label: '📊 权重可视化' });
      actions.push({ action: 'group', label: '🗂️ 分组管理' });
    }
    actions.push({ action: 'generate', label: '✨ 生成角色卡' });
    return actions;
  }

  // ---------- 进度计算 ----------
  function calcProgress() {
    var qc = runQualityCheck(cardData);
    var core = qc.filter(function(r) { return r.category !== '附加检查' && r.category !== 'MVU变量系统'; });
    var pass = core.filter(function(r) { return r.pass; }).length;
    return core.length ? Math.round(100 * pass / core.length) : 0;
  }

  // ---------- ST 聊天注入 ----------
  function injectIntoSTChat(text) {
    var doc = pd();
    var ta = doc.querySelector('#send_textarea');
    if (!ta) { toast('找不到 ST 聊天输入框 #send_textarea', true); return false; }
    try {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setTimeout(function () {
      var btn = doc.querySelector('#send_send') || doc.querySelector('#send_but') || doc.querySelector('#option_regenerate');
      if (btn) { try { btn.click(); } catch (_) {} }
      else { toast('找不到发送按钮，请手动按回车', true); }
    }, 80);
    return true;
  }

  // ================================================================
  //  样式（简洁横条 + 仪表盘面板）
  // ================================================================
  function injectStyles() {
    var doc = pd(); if (!doc || !doc.head) return;
    var sid = SCRIPT_ID + '-styles';
    if (doc.getElementById(sid)) return;
    var R = '#' + SCRIPT_ID;
    var css = ''
      + R + ' *, ' + R + ' *::before, ' + R + ' *::after{box-sizing:border-box;margin:0;padding:0}'
      + R + '{--cm-bg:#fafafa;--cm-bg2:#fff;--cm-border:#e5e7eb;--cm-border-soft:#f1f5f9;'
      + ' --cm-text:#111827;--cm-dim:#6b7280;--cm-dim2:#9ca3af;'
      + ' --cm-accent:#2563eb;--cm-accent-soft:#eff6ff;--cm-accent-border:#bfdbfe;'
      + ' --cm-green:#16a34a;--cm-green-soft:#f0fdf4;--cm-green-border:#bbf7d0;'
      + ' --cm-warn:#d97706;--cm-warn-soft:#fffbeb;--cm-warn-border:#fde68a;'
      + ' --cm-danger:#dc2626;--cm-danger-soft:#fef2f2;--cm-danger-border:#fecaca;'
      + ' --cm-radius:8px;--cm-chip:#f3f4f6;'
      + ' font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;}'
      // === 悬浮横条 ===
      + R + '{position:fixed;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:6px 10px;'
      + ' background:var(--cm-bg2);border:1px solid var(--cm-border);border-radius:999px;'
      + ' box-shadow:0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(15,23,42,.08);'
      + ' color:var(--cm-text);font-size:13px;user-select:none;touch-action:none;isolation:isolate;}'
      + R + ' .cm-handle{cursor:grab;color:var(--cm-dim2);padding:0 4px;}'
      + R + '.cm-dragging{cursor:grabbing!important}'
      + R + ' .cm-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid var(--cm-border);'
      + ' background:var(--cm-bg2);color:var(--cm-text);border-radius:999px;cursor:pointer;'
      + ' font:inherit;font-size:12px;transition:background .15s,border-color .15s,color .15s;white-space:nowrap;}'
      + R + ' .cm-btn:hover{background:var(--cm-accent-soft);border-color:var(--cm-accent-border);color:var(--cm-accent);}'
      + R + ' .cm-btn.primary{background:var(--cm-accent);border-color:var(--cm-accent);color:#fff;font-weight:500}'
      + R + ' .cm-btn.primary:hover{filter:brightness(1.05)}'
      + R + ' .cm-btn.danger{border-color:#fecaca;color:var(--cm-danger)}'
      + R + ' .cm-btn.danger:hover{background:#fef2f2}'
      + R + ' .cm-sep{width:1px;height:18px;background:var(--cm-border)}'
      + R + ' .cm-completion{font-size:11px;color:var(--cm-dim);padding:0 6px;display:inline-flex;align-items:center;gap:4px}'
      + R + ' .cm-completion b{color:var(--cm-accent);font-weight:600}'
      // === 仪表盘面板 ===
      + R + '-panel{position:fixed;z-index:2147483646;display:none;flex-direction:column;'
      + ' width:680px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 40px);'
      + ' background:var(--cm-bg2);border:1px solid var(--cm-border);border-radius:12px;'
      + ' box-shadow:0 6px 24px rgba(15,23,42,.12);color:var(--cm-text);font-size:13px;overflow:hidden;isolation:isolate}'
      + R + '-panel.show{display:flex;animation:cm-slide .18s ease-out}'
      + '@keyframes cm-slide{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}'
      // 头部
      + R + '-panel .cm-ph{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--cm-border);background:var(--cm-bg);cursor:move;flex-shrink:0}'
      + R + '-panel .cm-ph strong{font-weight:600}'
      + R + '-panel .cm-ph .cm-sub{font-size:11px;color:var(--cm-dim)}'
      + R + '-panel .cm-ph .cm-right{margin-left:auto;display:flex;align-items:center;gap:6px}'
      + R + '-panel .cm-close{width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--cm-dim);font-size:18px;cursor:pointer;line-height:1}'
      + R + '-panel .cm-close:hover{background:var(--cm-accent-soft);color:var(--cm-accent)}'
      // 主体滚动
      + R + '-panel .cm-body{flex:1;overflow-y:auto;padding:14px;background:var(--cm-bg2)}'
      + R + '-panel .cm-body::-webkit-scrollbar{width:8px}'
      + R + '-panel .cm-body::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}'
      // 统计卡片行
      + R + '-panel .cm-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}'
      + R + '-panel .cm-stat{padding:10px 12px;border:1px solid var(--cm-border-soft);border-radius:var(--cm-radius);background:var(--cm-bg2);text-align:center}'
      + R + '-panel .cm-stat-val{font-size:22px;font-weight:700;line-height:1.2}'
      + R + '-panel .cm-stat-lbl{font-size:11px;color:var(--cm-dim);margin-top:2px}'
      // 进度条
      + R + '-panel .cm-progress{height:6px;background:var(--cm-border-soft);border-radius:999px;overflow:hidden;margin:4px 0 10px}'
      + R + '-panel .cm-progress-fill{height:100%;border-radius:999px;transition:width .4s ease}'
      // 快捷按钮区
      + R + '-panel .cm-section-title{font-size:12px;font-weight:600;color:var(--cm-dim);margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--cm-border-soft)}'
      + R + '-panel .cm-quick{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}'
      + R + '-panel .cm-qa{padding:6px 12px;border:1px solid var(--cm-border);border-radius:999px;background:var(--cm-bg2);'
      + ' color:var(--cm-text);font:inherit;font-size:12px;cursor:pointer;transition:all .15s;white-space:nowrap}'
      + R + '-panel .cm-qa:hover{background:var(--cm-accent-soft);border-color:var(--cm-accent-border);color:var(--cm-accent)}'
      + R + '-panel .cm-qa.hl{border-color:#c4b5fd;color:#7c3aed;background:#f5f3ff}'
      + R + '-panel .cm-qa.hl:hover{background:#ede9fe;border-color:#a78bfa}'
      // 质检分类
      + R + '-panel .cm-qc-cat{margin-bottom:8px;border:1px solid var(--cm-border-soft);border-radius:var(--cm-radius);overflow:hidden}'
      + R + '-panel .cm-qc-cat-head{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;background:var(--cm-bg);transition:background .15s}'
      + R + '-panel .cm-qc-cat-head:hover{background:var(--cm-border-soft)}'
      + R + '-panel .cm-qc-cat-head .cm-qc-cat-name{font-weight:500;font-size:12px}'
      + R + '-panel .cm-qc-cat-head .cm-qc-cat-count{margin-left:auto;font-size:11px;color:var(--cm-dim);padding:1px 8px;border-radius:999px;background:var(--cm-chip)}'
      + R + '-panel .cm-qc-cat-head .cm-qc-bar{width:60px;height:4px;border-radius:999px;background:var(--cm-border-soft);overflow:hidden}'
      + R + '-panel .cm-qc-cat-head .cm-qc-bar-fill{height:100%;border-radius:999px}'
      + R + '-panel .cm-qc-cat-head .cm-qc-arrow{color:var(--cm-dim2);font-size:10px;transition:transform .2s}'
      + R + '-panel .cm-qc-cat.open .cm-qc-arrow{transform:rotate(90deg)}'
      + R + '-panel .cm-qc-items{display:none;padding:4px 0}'
      + R + '-panel .cm-qc-cat.open .cm-qc-items{display:block}'
      + R + '-panel .cm-qc-item{display:flex;align-items:flex-start;gap:6px;padding:5px 10px;font-size:11px;line-height:1.4}'
      + R + '-panel .cm-qc-item .cm-qc-icon{flex-shrink:0;width:16px;text-align:center}'
      + R + '-panel .cm-qc-item .cm-qc-name{font-weight:500;color:var(--cm-text)}'
      + R + '-panel .cm-qc-item .cm-qc-desc{color:var(--cm-dim);margin-left:4px}'
      + R + '-panel .cm-qc-item .cm-qc-fix{color:var(--cm-dim2);font-size:10px;margin-top:1px}'
      + R + '-panel .cm-qc-item.fail{background:var(--cm-danger-soft)}'
      + R + '-panel .cm-qc-item.pass .cm-qc-icon{color:var(--cm-green)}'
      + R + '-panel .cm-qc-item.fail .cm-qc-icon{color:var(--cm-danger)}'
      // 底部操作栏
      + R + '-panel .cm-actions{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--cm-border);background:var(--cm-bg);flex-shrink:0}'
      + R + '-panel .cm-actions .spacer{flex:1}'
      // toast
      + R + '-toast{position:fixed;z-index:2147483648;left:50%;bottom:40px;transform:translateX(-50%);padding:8px 14px;background:#111827;color:#fff;'
      + ' border-radius:999px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}'
      + R + '-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}'
      // 响应式
      + '@media(max-width:520px){'
      + R + '{padding:4px 8px;gap:4px}' + R + ' .cm-btn{padding:4px 8px;font-size:11px}'
      + R + '-panel{width:calc(100vw - 16px);height:calc(100vh - 24px);border-radius:10px}'
      + R + '-panel .cm-stats{grid-template-columns:repeat(2,1fr)}'
      + R + '-panel .cm-body{padding:10px}'
      + '}';
    var s = doc.createElement('style'); s.id = sid; s.textContent = css; doc.head.appendChild(s);
  }

  // ================================================================
  //  UI 渲染
  // ================================================================
  var ui = null;

  function renderToolbar() {
    var doc = pd(); if (!doc || !doc.body) return;
    removeAll(); injectStyles();

    var tb = doc.createElement('div');
    tb.id = SCRIPT_ID;
    tb.innerHTML = ''
      + '<span class="cm-handle" title="拖动">⋮⋮</span>'
      + '<button class="cm-btn primary" data-act="toggle">⚡ 写卡</button>'
      + '<span class="cm-sep"></span>'
      + '<button class="cm-btn" data-act="scan">🔍 扫消息</button>'
      + '<button class="cm-btn" data-act="export">⬇ 导出</button>'
      + '<span class="cm-sep"></span>'
      + '<span class="cm-completion">完成度 <b data-cmp>0%</b></span>';
    doc.body.appendChild(tb);

    var pnl = doc.createElement('div');
    pnl.id = SCRIPT_ID + '-panel';
    pnl.innerHTML = ''
      + '<div class="cm-ph" id="cm-phead">'
      + '  <strong>⚡ 时之写卡器 · 仪表盘</strong>'
      + '  <span class="cm-sub">质检 · 快捷指令 · 导出</span>'
      + '  <div class="cm-right">'
      + '    <span class="cm-completion">完成度 <b data-cmp>0%</b></span>'
      + '    <button class="cm-close" data-act="close">×</button>'
      + '  </div>'
      + '</div>'
      + '<div class="cm-body" data-body></div>'
      + '<div class="cm-actions">'
      + '  <button class="cm-btn" data-act="scan">🔍 扫聊天消息</button>'
      + '  <button class="cm-btn danger" data-act="clear">🗑 清空</button>'
      + '  <div class="spacer"></div>'
      + '  <button class="cm-btn" data-act="import-panel">📤 导入</button>'
      + '  <button class="cm-btn primary" data-act="export">⬇ 导出角色卡</button>'
      + '</div>';
    doc.body.appendChild(pnl);

    var fi = doc.createElement('input');
    fi.type = 'file'; fi.accept = '.json,application/json';
    fi.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px';
    fi.id = SCRIPT_ID + '-file';
    doc.body.appendChild(fi);

    ui = { toolbar: tb, panel: pnl, fileInput: fi };
    applyToolbarPosition(tb);
    tb.addEventListener('click', onToolbarClick);
    pnl.querySelector('.cm-close').addEventListener('click', function () { setExpanded(false); });
    pnl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { handleAction(b.getAttribute('data-act')); });
    });
    pnl.querySelector('#cm-phead').addEventListener('pointerdown', function (e) { onDragStart(e, pnl); });
    tb.querySelector('.cm-handle').addEventListener('pointerdown', function (e) { onDragStart(e, tb, true); });
    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { mergeImported(JSON.parse(String(r.result || ''))); saveAll(); renderDashboard(); toast('已导入 ' + f.name); }
        catch (_) { toast('导入失败：JSON错误', true); }
        finally { fi.value = ''; }
      };
      r.readAsText(f, 'utf-8');
    });

    if (state.expanded) setExpanded(true, true);
    renderDashboard();
    bindChatObserver();
  }

  function removeAll() {
    var doc = pd(); if (!doc) return;
    ['-toolbar','-panel','-toast','-file','-styles'].forEach(function (s) {
      var e = doc.getElementById(SCRIPT_ID + s); if (e) e.remove();
    });
    ui = null;
  }

  function onToolbarClick(e) {
    var act = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!act) return;
    handleAction(act.getAttribute('data-act'));
  }

  function handleAction(act) {
    switch (act) {
      case 'toggle': setExpanded(!state.expanded); break;
      case 'close': setExpanded(false); break;
      case 'export': doExport(); break;
      case 'scan': scanRecentMessages(); toast('已扫描最近消息'); break;
      case 'clear':
        if (confirm('确认清空全部数据？')) { cardData = blankCardData(); ensureCardDataShape(); saveAll(); renderDashboard(); toast('已清空'); }
        break;
      case 'import-panel': if (ui && ui.fileInput) ui.fileInput.click(); break;
    }
  }

  function setExpanded(v, skipSave) {
    state.expanded = !!v;
    if (!ui) return;
    if (state.expanded) { ui.panel.classList.add('show'); applyPanelPosition(ui.panel); }
    else ui.panel.classList.remove('show');
    if (!skipSave) saveLS(LS_KEY, state);
  }

  // ---- 仪表盘内容 ----
  function renderDashboard() {
    if (!ui) return;
    var body = ui.panel.querySelector('[data-body]');
    var qc = runQualityCheck(cardData);
    var p = calcProgress();
    var entries = (cardData.character_book || {}).entries || [];
    var totalTok = countTokens(cardData.description) + countTokens(cardData.first_mes) + countTokens(cardData.system_prompt) +
      countTokens(cardData.post_history_instructions) + countTokens(cardData.mes_example) +
      entries.reduce(function(s,e){return s+countTokens(e.content||'');},0);
    var permTok = entries.filter(function(e){return e.constant===true;}).reduce(function(s,e){return s+countTokens(e.content||'');},0) + countTokens(cardData.post_history_instructions||'');

    var passCount = qc.filter(function(r){return r.pass;}).length;
    var h = '';

    // === 统计卡片 ===
    var pColor = p >= 80 ? 'var(--cm-green)' : p >= 50 ? 'var(--cm-warn)' : 'var(--cm-danger)';
    h += '<div class="cm-stats">'
      + '<div class="cm-stat"><div class="cm-stat-val" style="color:' + pColor + '">' + p + '%</div><div class="cm-stat-lbl">完成度</div></div>'
      + '<div class="cm-stat"><div class="cm-stat-val" style="color:var(--cm-accent)">' + entries.length + '</div><div class="cm-stat-lbl">世界书条目</div></div>'
      + '<div class="cm-stat"><div class="cm-stat-val" style="color:var(--cm-warn)">' + totalTok + '</div><div class="cm-stat-lbl">总Token</div></div>'
      + '<div class="cm-stat"><div class="cm-stat-val" style="color:' + (passCount === qc.length ? 'var(--cm-green)' : 'var(--cm-danger)') + '">' + passCount + '/' + qc.length + '</div><div class="cm-stat-lbl">质检通过</div></div>'
      + '</div>';

    // 总进度条
    h += '<div class="cm-progress"><div class="cm-progress-fill" style="width:' + p + '%;background:' + pColor + '"></div></div>';

    // === 快捷按钮 ===
    h += '<div class="cm-section-title">🚀 快捷指令（点击注入到聊天框）</div>';
    h += '<div class="cm-quick">';
    getQuickActions().forEach(function (a) {
      h += '<button class="cm-qa' + (a.hl ? ' hl' : '') + '" data-qa="' + a.action + '">' + esc(a.label) + '</button>';
    });
    h += '</div>';

    // === 质检分类 ===
    h += '<div class="cm-section-title">✅ 质检报告（' + passCount + '/' + qc.length + ' 通过）</div>';
    var cats = ['基础字段','高价值字段','世界书','世界书高级','正则脚本','运行效果','MVU变量系统','附加检查'];
    var catColors = { '基础字段':'#8b5cf6','高价值字段':'#f97316','世界书':'#22c55e','世界书高级':'#a855f7','正则脚本':'#f59e0b','运行效果':'#eab308','MVU变量系统':'#3b82f6','附加检查':'#6b7280' };
    cats.forEach(function (cat) {
      var catResults = qc.filter(function(r){return r.category === cat;});
      if (!catResults.length) return;
      var catPass = catResults.filter(function(r){return r.pass;}).length;
      var pct = Math.round(100 * catPass / catResults.length);
      var barColor = pct === 100 ? 'var(--cm-green)' : pct >= 50 ? 'var(--cm-warn)' : 'var(--cm-danger)';
      h += '<div class="cm-qc-cat" data-cat="' + esc(cat) + '">';
      h += '<div class="cm-qc-cat-head">'
        + '<span class="cm-qc-arrow">▶</span>'
        + '<span class="cm-qc-cat-name" style="color:' + (catColors[cat]||'#6b7280') + '">' + esc(cat) + '</span>'
        + '<span class="cm-qc-bar"><span class="cm-qc-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></span></span>'
        + '<span class="cm-qc-cat-count">' + catPass + '/' + catResults.length + '</span>'
        + '</div>';
      h += '<div class="cm-qc-items">';
      catResults.forEach(function (r) {
        h += '<div class="cm-qc-item ' + (r.pass ? 'pass' : 'fail') + '">'
          + '<span class="cm-qc-icon">' + (r.pass ? '✅' : '❌') + '</span>'
          + '<div>'
          + '<span class="cm-qc-name">' + esc(r.name) + '</span>'
          + '<span class="cm-qc-desc">' + esc(r.desc) + '</span>'
          + '<div class="cm-qc-fix">💡 ' + esc(r.fix) + '</div>'
          + '</div></div>';
      });
      h += '</div></div>';
    });

    body.innerHTML = h;

    // 绑定快捷按钮
    body.querySelectorAll('[data-qa]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-qa');
        if (act === 'qc') { toggleAllQCCategories(); return; }
        if (act === 'weight') { toast('权重可视化：' + entries.length + '条 | 常驻' + permTok + 'T | 总' + totalTok + 'T'); return; }
        if (act === 'group') { toast('分组管理：' + countGroups() + '组'); return; }
        var prompt = QUICK_PROMPTS[act];
        if (prompt) {
          if (injectIntoSTChat(prompt)) {
            toast('已注入：' + btn.textContent.trim());
            setExpanded(false);
          }
        }
      });
    });

    // 绑定质检分类折叠
    body.querySelectorAll('.cm-qc-cat-head').forEach(function (head) {
      head.addEventListener('click', function () {
        head.parentElement.classList.toggle('open');
      });
    });

    // 展开未通过的分类
    body.querySelectorAll('.cm-qc-cat').forEach(function (cat) {
      var failCount = cat.querySelectorAll('.cm-qc-item.fail').length;
      if (failCount > 0 && failCount <= 3) cat.classList.add('open');
    });

    updateCompletion();
  }

  function toggleAllQCCategories() {
    if (!ui) return;
    var cats = ui.panel.querySelectorAll('.cm-qc-cat');
    var allOpen = true;
    cats.forEach(function(c){ if (!c.classList.contains('open')) allOpen = false; });
    cats.forEach(function(c){ if (allOpen) c.classList.remove('open'); else c.classList.add('open'); });
  }

  function countGroups() {
    var entries = (cardData.character_book || {}).entries || [];
    var groups = {};
    entries.forEach(function(e){ var g=(e.extensions||{}).group; if (g) groups[g]=true; });
    return Object.keys(groups).length;
  }

  function updateCompletion() {
    var p = calcProgress();
    if (ui) {
      ui.toolbar.querySelectorAll('[data-cmp]').forEach(function(e){ e.textContent = p + '%';});
      ui.panel.querySelectorAll('[data-cmp]').forEach(function(e){ e.textContent = p + '%';});
    }
  }

  // ---- 位置 + 拖拽 ----
  function applyToolbarPosition(el) {
    var v = vp(); var w = el.offsetWidth || 300, h = el.offsetHeight || 44;
    var x = state.toolbarX != null ? state.toolbarX : (v.w - w - 16);
    var y = state.toolbarY != null ? state.toolbarY : (v.h - h - 16);
    x = clamp(x, 8, v.w - w - 8); y = clamp(y, 8, v.h - h - 8);
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function applyPanelPosition(el) {
    if (!ui) return;
    var v = vp(); var tRect = ui.toolbar.getBoundingClientRect();
    var pw = Math.min(680, v.w - 24), ph = Math.min(540, v.h - 40);
    var x = clamp(tRect.left + Math.round(ui.toolbar.offsetWidth/2) - Math.round(pw/2), 12, v.w - pw - 12);
    var y = clamp(tRect.top - ph - 12, 12, v.h - ph - 12);
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function onDragStart(e, el, isToolbar) {
    if (e.button !== undefined && e.button !== 0) return;
    var rect = el.getBoundingClientRect();
    var drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, tb: !!isToolbar };
    el.classList.add('cm-dragging');
    try { if (el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (_) {}
    var doc = pd();
    function onMove(ev) {
      if (ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      var v = vp(); var w = el.offsetWidth, h = el.offsetHeight;
      var nx = clamp(drag.left + dx, 8, v.w - w - 8);
      var ny = clamp(drag.top + dy, 8, v.h - h - 8);
      el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
      ev.preventDefault && ev.preventDefault();
    }
    function onUp(ev) {
      if (ev.pointerId !== drag.id) return;
      try { if (el.releasePointerCapture) el.releasePointerCapture(drag.id); } catch (_) {}
      el.classList.remove('cm-dragging');
      if (drag.tb) { state.toolbarX = parseFloat(el.style.left); state.toolbarY = parseFloat(el.style.top); saveLS(LS_KEY, state); }
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  }

  // ---- 导入合并 ----
  function mergeImported(data) {
    if (!data) return;
    ['name','description','personality','scenario','first_mes','system_prompt',
     'post_history_instructions','mes_example','depth_prompt','creator_notes']
      .forEach(function(k){ if (typeof data[k] === 'string') cardData[k] = data[k]; });
    if (Array.isArray(data.tags)) cardData.tags = data.tags.slice();
    if (Array.isArray(data.alternate_greetings)) cardData.alternate_greetings = data.alternate_greetings.slice();
    if (Array.isArray(data.regex_scripts)) cardData.regex_scripts = data.regex_scripts.slice();
    if (data.character_book) cardData.character_book = data.character_book;
    if (data.extensions && data.extensions.depth_prompt) {
      if (!cardData.extensions) cardData.extensions = {};
      cardData.extensions.depth_prompt = data.extensions.depth_prompt;
    }
    ensureCardDataShape();
  }

  // ================================================================
  //  消息扫描 + JSON 合并（从 AI 聊天里提取 ```json``` 块）
  // ================================================================
  function findJsonBlocks(text) {
    if (!text) return [];
    var out = [], re = /```(?:json)?\s*([\s\S]*?)```/g, m;
    while ((m = re.exec(text)) !== null) { var raw = m[1].trim(); if (raw) out.push(raw); }
    return out;
  }
  function tryParseJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    var s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) { try { return JSON.parse(raw.slice(s, e+1)); } catch (_) {} }
    return null;
  }
  function mergeJsonIntoCardData(patch) {
    if (!patch || typeof patch !== 'object' || patch._nochange) return 0;
    var changed = 0;
    function applyTop(key, val) {
      if (val === undefined || val === null) return false;
      if (key === 'tags') { if (!Array.isArray(val)) return false; var cur = cardData.tags||[]; var b = cur.length; val.forEach(function(t){if(cur.indexOf(t)<0)cur.push(t);}); cardData.tags = cur; return cur.length !== b; }
      if (key === 'alternate_greetings') { if (!Array.isArray(val)) return false; cardData.alternate_greetings = val.slice(); return true; }
      if (key === 'regex_scripts') { if (!Array.isArray(val)) return false; cardData.regex_scripts = val.slice(); return true; }
      if (key === 'character_book') {
        if (!val || typeof val !== 'object') return false;
        var cur = cardData.character_book || {description:'',scan_depth:50,entries:[]};
        if (val.description !== undefined) cur.description = val.description;
        if (typeof val.scan_depth === 'number') cur.scan_depth = val.scan_depth;
        if (Array.isArray(val.entries)) cur.entries = applyEntriesPatch(cur.entries||[], val.entries);
        cardData.character_book = cur; return true;
      }
      if (typeof val === 'string') { if (cardData[key] !== val) { cardData[key] = val; return true; } return false; }
      cardData[key] = val; return true;
    }
    ['name','description','personality','scenario','first_mes','system_prompt',
     'post_history_instructions','mes_example','depth_prompt','creator_notes']
      .forEach(function(k){ if (patch[k] !== undefined) { if (applyTop(k, patch[k])) changed++; } });
    if (Array.isArray(patch.tags)) { if (applyTop('tags', patch.tags)) changed++; }
    if (Array.isArray(patch.alternate_greetings)) { if (applyTop('alternate_greetings', patch.alternate_greetings)) changed++; }
    if (Array.isArray(patch.regex_scripts)) { if (applyTop('regex_scripts', patch.regex_scripts)) changed++; }
    if (patch.character_book) { if (applyTop('character_book', patch.character_book)) changed++; }
    if (patch.extensions && patch.extensions.depth_prompt) {
      if (!cardData.extensions) cardData.extensions = {};
      if (JSON.stringify(cardData.extensions.depth_prompt) !== JSON.stringify(patch.extensions.depth_prompt)) {
        cardData.extensions.depth_prompt = patch.extensions.depth_prompt; changed++;
      }
    }
    if (Array.isArray(patch.entries) && patch.entries.length) {
      var cur = cardData.character_book || {description:'',scan_depth:50,entries:[]};
      var before = (cur.entries||[]).length;
      cur.entries = applyEntriesPatch(cur.entries||[], patch.entries);
      cardData.character_book = cur;
      if (cur.entries.length !== before) changed++;
    }
    var delPaths = [];
    ['_delete','delete','deletes','remove','removes','deleted_entries'].forEach(function(dk) {
      if (Array.isArray(patch[dk])) patch[dk].forEach(function(p){ delPaths.push(String(p)); });
    });
    if (delPaths.length) {
      var cb = cardData.character_book || {entries:[]};
      var arr = cb.entries||[];
      var toDel = [];
      delPaths.forEach(function(raw) {
        var key = raw.replace(/^character_book\.entries\./, '');
        var idx = parseInt(key, 10);
        if (!isNaN(idx) && String(idx) === key && idx >= 0 && idx < arr.length) { toDel.push(idx); return; }
        var exact = [], fuzzy = [];
        arr.forEach(function(e, i) { var ec = e.comment||''; if (ec === key) exact.push(i); else if (key.length >= 6 && ec.indexOf(key) >= 0) fuzzy.push(i); });
        if (exact.length) exact.forEach(function(i){if(toDel.indexOf(i)<0)toDel.push(i);});
        else if (fuzzy.length === 1) toDel.push(fuzzy[0]);
      });
      toDel.sort(function(a,b){return b-a;}).forEach(function(i){ arr.splice(i,1); });
      if (toDel.length) { cb.entries = arr; cardData.character_book = cb; changed++; }
    }
    return changed;
  }

  function applyEntriesPatch(existing, incoming) {
    var arr = existing.slice();
    incoming.forEach(function(ne) {
      if (!ne || typeof ne !== 'object') return;
      if (ne._action === 'delete' || ne._action === 'remove' || ne.delete === true) {
        if (ne.comment) { for (var i=0;i<arr.length;i++) { if ((arr[i].comment||'') === ne.comment) { arr.splice(i,1); break; } } }
        return;
      }
      if (!ne.content && !ne.keys && !ne.comment) return;
      var idx = findEntryMatch(ne, arr);
      if (idx >= 0) { arr[idx] = Object.assign({}, arr[idx], ne); applyPrefixDefaults(arr[idx]); }
      else { var e2 = Object.assign({}, ne); applyPrefixDefaults(e2); arr.push(e2); }
    });
    return arr;
  }
  function findEntryMatch(ne, arr) {
    var neC = ne.comment||'', neCont = (ne.content||'').trim(), nePref = prefixOf(neC);
    for (var i=0;i<arr.length;i++) if ((arr[i].comment||'') === neC) return i;
    if (nePref) {
      var same = arr.map(function(e,i){return {i:i,p:prefixOf(e.comment||''),c:e.content||''};}).filter(function(x){return x.p===nePref;});
      if (same.length === 1) return same[0].i;
      if (same.length > 1 && neCont.length > 20) {
        var setN = charSet(neCont), best = -1, bestSim = 0;
        same.forEach(function(s){ var sim = jacc(setN, charSet(s.c)); if (sim > bestSim && sim > 0.35) { bestSim = sim; best = s.i; } });
        if (best >= 0) return best;
      }
    }
    return -1;
  }
  function prefixOf(c) { var m = /^<([^>]+)>/.exec(c||''); if (m) return m[1]; var m2 = /^\[([^\]]+)\]/.exec(c||''); if (m2) return '[' + m2[1] + ']'; return ''; }
  function charSet(s) { var o={}; for (var i=0;i<s.length;i++) o[s[i]]=true; return o; }
  function jacc(a,b) { var i=0,u=0; for (var k in a) { if (a.hasOwnProperty(k)){if(b[k])i++;u++;}} for (var k in b) {if(b.hasOwnProperty(k)&&!a[k])u++;} return u?i/u:0; }

  // ---- 前缀模板默认值 ----
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
      '[InitVar]': { constant:true, selective:false, insertion_order:200, position:4, depth:4, prevent_recursion:true, probability:100, useProbability:false, enabled:false },
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
        if (k.charAt(0) === '[' && pref.indexOf(k.replace(/[\[\]]/g,'')) >= 0) { fill(entry, PREFIX_DEFAULTS[k]); return; }
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
      if (k === 'position' || k === 'depth' || k === 'role' || k === 'probability' || k === 'selectiveLogic'
          || k === 'prevent_recursion' || k === 'exclude_recursion' || k === 'delay_until_recursion'
          || k === 'sticky' || k === 'cooldown' || k === 'delay' || k === 'match_whole_words'
          || k === 'scan_depth' || k === 'group' || k === 'group_weight' || k === 'useProbability'
          || k === 'secondary_keys' || k === 'use_group_scoring') {
        if (!entry.extensions) entry.extensions = {};
        if (entry.extensions[k] === undefined) entry.extensions[k] = defaults[k];
      } else {
        if (entry[k] === undefined) entry[k] = defaults[k];
      }
    }
    if (entry.enabled === undefined) entry.enabled = defaults.enabled !== undefined ? defaults.enabled : true;
    if (entry.selective === undefined) entry.selective = defaults.selective;
    if (entry.constant === undefined) entry.constant = defaults.constant;
    if (entry.insertion_order === undefined && defaults.insertion_order !== undefined) entry.insertion_order = defaults.insertion_order;
    if (entry.use_regex === undefined) entry.use_regex = true;
    if (!entry.keys) entry.keys = [];
  }

  // ---- 扫描聊天消息 ----
  function scanRecentMessages() {
    var doc = pd(); if (!doc) return 0;
    var nodes = doc.querySelectorAll('.mes, .chat-message, .message, [data-mid]');
    if (!nodes.length) nodes = doc.querySelectorAll('.chat_msg, .msg, div[id^="chat_message"]');
    var texts = [];
    Array.prototype.slice.call(nodes, Math.max(0, nodes.length - 24)).forEach(function(n) {
      var t = n.innerText || n.textContent || '';
      if (t.trim().length > 40) texts.push(t);
    });
    var applied = 0;
    texts.forEach(function(tx) {
      findJsonBlocks(tx).forEach(function(raw) {
        var j = tryParseJson(raw);
        if (j) applied += mergeJsonIntoCardData(j);
      });
    });
    ensureCardDataShape(); saveAll();
    if (ui) renderDashboard();
    return applied;
  }

  // ---- 监听聊天 ----
  var _mutObs = null;
  function bindChatObserver() {
    if (_mutObs) return;
    var doc = pd(); if (!doc || !doc.body) return;
    try {
      _mutObs = new MutationObserver(function() {
        if (bindChatObserver._t) return;
        bindChatObserver._t = setTimeout(function() {
          bindChatObserver._t = null;
          var c = scanRecentMessages();
          if (c > 0) toast('写入 ' + c + ' 项更新');
        }, 1500);
      });
      _mutObs.observe(doc.body, { childList: true, subtree: true, characterData: true });
    } catch (_) { _mutObs = null; }
  }

  // ---- 导出 ----
  function doExport() {
    ensureCardDataShape();
    var d = JSON.parse(JSON.stringify(cardData));
    var out = {
      spec: d.spec || 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: d.name || '', description: d.description || '', personality: d.personality || '',
        scenario: d.scenario || '', first_mes: d.first_mes || '', mes_example: d.mes_example || '',
        creator_notes: d.creator_notes || '', system_prompt: d.system_prompt || '',
        post_history_instructions: d.post_history_instructions || '',
        alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.slice() : [],
        tags: Array.isArray(d.tags) ? d.tags.slice() : [],
        creator: d.creator || '时之写卡器', character_version: d.character_version || '1.0',
        extensions: d.extensions || {}
      }
    };
    if (Array.isArray(d.regex_scripts) && d.regex_scripts.length) out.data.extensions.regex_scripts = d.regex_scripts.slice();
    if (d.character_book) out.data.character_book = d.character_book;
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = ((out.data.name || 'character').replace(/[\\/:*?"<>|]/g, '_')) + '.json';
    try { pd().body.appendChild(a); a.click(); a.remove(); } catch (_) { a.click(); }
    setTimeout(function(){ try { URL.revokeObjectURL(url); } catch(_){} }, 3000);
    toast('已导出：' + a.download);
  }

  // ---- Toast ----
  function toast(msg, err) {
    var doc = pd(); if (!doc) return;
    var t = doc.getElementById(SCRIPT_ID + '-toast');
    if (!t) { t = doc.createElement('div'); t.id = SCRIPT_ID + '-toast'; doc.body.appendChild(t); }
    if (err) t.style.background = '#7f1d1d'; else t.style.background = '';
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function(){ t.classList.remove('show'); }, 1800);
  }

  // ---- 启动 ----
  function init() {
    try {
      renderToolbar();
      window.addEventListener('resize', function() {
        if (!ui) return;
        applyToolbarPosition(ui.toolbar);
        if (state.expanded) applyPanelPosition(ui.panel);
      });
    } catch (err) { console.error('[时之写卡器IDE] init error:', err); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else setTimeout(init, 0);

  window.CM_IDE = {
    get cardData() { return cardData; },
    scan: scanRecentMessages,
    export: doExport,
    reset: function() { cardData = blankCardData(); ensureCardDataShape(); saveAll(); if (ui) renderDashboard(); },
    mergePatch: function(p) { mergeJsonIntoCardData(p); saveAll(); if (ui) renderDashboard(); },
  };
})();
