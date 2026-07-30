(function(){
  'use strict';
  var ID='cm-tool';

  function $(s){return doc.getElementById(s)}
  function tryParentDoc(){try{return window.parent.document}catch(e){return document}}
  var doc=tryParentDoc();
  if(!doc||!doc.body){setTimeout(arguments.callee,300);return}

  var old=$('cm-fab');if(old)old.remove();old=$('cm-panel');if(old)old.remove();

  var card={name:'',description:'',first_mes:'',personality:'',scenario:'',mes_example:'',system_prompt:'',post_history_instructions:'',character_book:{entries:[]}};

  var sFab='position:fixed;bottom:16px;right:16px;z-index:2147483647;';
  var sPanel='position:fixed;bottom:76px;right:16px;width:320px;max-height:480px;background:#161b22;border:1px solid #30363d;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);display:none;flex-direction:column;overflow:hidden;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#c9d1d9;font-size:13px;';
  var sTitle='display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:linear-gradient(90deg,#7c3aed,#db2777);color:#fff;font-weight:600;cursor:move;user-select:none;';
  var sBody='padding:12px;overflow-y:auto;flex:1;';
  var sChip='display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;background:#21262d;font-size:12px;';
  var sBtn='padding:8px;border:none;border-radius:6px;cursor:pointer;background:#21262d;color:#c9d1d9;font-size:12px;font-weight:600;';
  var sBtnP='padding:8px;border:none;border-radius:6px;cursor:pointer;background:linear-gradient(90deg,#7c3aed,#db2777);color:#fff;font-size:12px;font-weight:600;';
  var sSec='border:1px solid #30363d;border-radius:8px;margin-bottom:8px;overflow:hidden;';
  var sHd='padding:8px 12px;background:#1c2128;cursor:pointer;font-weight:600;font-size:12px;';
  var sBd='padding:8px 12px;display:none;';

  var fab=doc.createElement('div');fab.id='cm-fab';fab.style.cssText=sFab;
  fab.innerHTML='<button style="width:48px;height:48px;border:none;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff;font-size:20px;cursor:pointer;box-shadow:0 4px 16px rgba(124,58,237,.4);display:flex;align-items:center;justify-content:center;">⚡</button>';
  doc.body.appendChild(fab);

  var p=doc.createElement('div');p.id='cm-panel';p.style.cssText=sPanel;
  p.innerHTML='<div id="cm-title" style="'+sTitle+'"><span>⚡ 时之写卡器</span><span id="cm-close" style="cursor:pointer;">✕</span></div>'+
    '<div style="'+sBody+'">'+
    '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">'+
    '<span style="'+sChip+'">👤 <b id="cm-name">-</b></span>'+
    '<span style="'+sChip+'">📊 <b id="cm-pct">0%</b></span>'+
    '</div>'+
    '<div style="height:4px;background:#21262d;border-radius:2px;margin-bottom:10px;">'+
    '<div id="cm-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#db2777);border-radius:2px;transition:width .3s;"></div>'+
    '</div>'+
    '<div style="'+sSec+'"><div style="'+sHd+'" data-t="cm-fields">📋 角色卡</div><div id="cm-fields" style="'+sBd+'display:block;"></div></div>'+
    '<div style="'+sSec+'"><div style="'+sHd+'" data-t="cm-presets">⚙️ 预设</div><div id="cm-presets" style="'+sBd+'"></div></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">'+
    '<button id="cm-export" style="'+sBtnP+'">📥 导出</button>'+
    '<button id="cm-refresh" style="'+sBtn+'">🔄 刷新</button>'+
    '<button id="cm-import" style="'+sBtn+'">📤 导入</button>'+
    '<button id="cm-clear" style="'+sBtn+';background:#da3633;color:#fff;">🗑️ 清空</button>'+
    '</div></div>';
  doc.body.appendChild(p);

  var expanded=false;
  fab.querySelector('button').onclick=function(){expanded=!expanded;p.style.display=expanded?'flex':'none';if(expanded)render()};
  $('cm-close').onclick=function(){expanded=false;p.style.display='none'};

  p.querySelectorAll('[data-t]').forEach(function(h){
    h.onclick=function(){var t=$(h.getAttribute('data-t'));if(t)t.style.display=t.style.display==='none'?'block':'none'};
  });

  $('cm-export').onclick=function(){var data=JSON.stringify(card,null,2);var blob=new Blob([data],{type:'application/json'});var url=URL.createObjectURL(blob);var a=doc.createElement('a');a.href=url;a.download=(card.name||'char')+'.json';doc.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(url);a.remove()},500)};
  $('cm-refresh').onclick=function(){extract();render()};
  $('cm-import').onclick=function(){var i=doc.createElement('input');i.type='file';i.accept='.json';i.onchange=function(e){var f=e.target.files[0];if(!f)return;var r=new FileReader();r.onload=function(ev){try{var o=JSON.parse(ev.target.result);merge(o);render()}catch(e){alert('导入失败')}};r.readAsText(f)};i.click()};
  $('cm-clear').onclick=function(){if(confirm('清空所有数据？')){card={name:'',description:'',first_mes:'',personality:'',scenario:'',mes_example:'',system_prompt:'',post_history_instructions:'',character_book:{entries:[]}};render()}};

  var drag=false,sx,sy,ox,oy;
  $('cm-title').onmousedown=function(e){if(e.target.id==='cm-close')return;drag=true;sx=e.clientX;sy=e.clientY;ox=p.offsetLeft;oy=p.offsetTop;e.preventDefault()};
  doc.onmousemove=function(e){if(!drag)return;p.style.left=(ox+e.clientX-sx)+'px';p.style.top=(oy+e.clientY-sy)+'px';p.style.right='auto';p.style.bottom='auto'};
  doc.onmouseup=function(){drag=false};

  function fn(name){try{if(typeof window[name]==='function')return window[name]}catch(e){}try{if(window.parent&&typeof window.parent[name]==='function')return window.parent[name]}catch(e){}return null}

  function extract(){var gl=fn('getLastMessageId'),gm=fn('getChatMessages');if(!gl||!gm)return;var last=gl();if(last<0)return;var start=Math.max(0,last-49);var msgs=gm(start+'-'+last,{hide_state:'all'});if(!Array.isArray(msgs))return;msgs.forEach(function(m){if(!m||!m.mes)return;var text=String(m.mes);var match=text.match(/```json\s*([\s\S]*?)```/);if(!match)return;try{var obj=JSON.parse(match[1].trim());merge(obj)}catch(e){}})}

  function merge(src){if(!src||typeof src!=='object')return;var fields=['name','description','first_mes','personality','scenario','mes_example','system_prompt','post_history_instructions'];fields.forEach(function(f){if(src[f]&&typeof src[f]==='string'&&src[f].trim())card[f]=src[f]});if(src.character_book&&Array.isArray(src.character_book.entries))card.character_book.entries=card.character_book.entries.concat(src.character_book.entries)}

  function calc(){var fields=['name','description','first_mes','personality','scenario','mes_example','system_prompt','post_history_instructions'];var done=0;fields.forEach(function(f){if(card[f]&&String(card[f]).trim())done++});return Math.round(done/fields.length*100)}

  function render(){var pct=calc();$('cm-pct').textContent=pct+'%';$('cm-bar').style.width=pct+'%';$('cm-name').textContent=card.name||'-';
    var fields=[['name','名称'],['description','描述'],['first_mes','首条消息'],['personality','性格'],['scenario','场景'],['mes_example','示例对话'],['system_prompt','系统提示'],['post_history_instructions','后置指令']];
    $('cm-fields').innerHTML=fields.map(function(f){var ok=card[f[0]]&&String(card[f[0]]).trim();return'<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;"><span style="color:#c9d1d9;">'+f[1]+'</span><span style="color:'+(ok?'#3fb950':'#484f58')+';font-weight:700;">'+(ok?'✓':'○')+'</span></div>'}).join('');
    var presets=getPresets();
    $('cm-presets').innerHTML=presets.length?presets.map(function(p){return'<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;"><span style="color:#c9d1d9;">'+p.name+'</span><span class="cm-tg" data-name="'+p.name+'" style="color:'+(p.enabled?'#3fb950':'#484f58')+';cursor:pointer;font-weight:600;">'+(p.enabled?'ON':'OFF')+'</span></div>'}).join(''):'<div style="font-size:12px;color:#484f58;">无预设</div>';
    $('cm-presets').querySelectorAll('.cm-tg').forEach(function(el){el.onclick=function(){togg(el.getAttribute('data-name'))}})
  }

  function getPresets(){try{var gp=fn('getPresetManager');if(!gp)return[];var mgr=gp();if(!mgr)return[];var preset=typeof mgr.getPreset==='function'?mgr.getPreset('in_use'):null;if(!preset||!Array.isArray(preset.prompts))return[];return preset.prompts.filter(function(p){return p&&!p.marker})}catch(e){return[]}}

  function togg(name){try{var up=fn('updatePresetWith');if(!up)return;up('in_use',function(preset){preset.prompts.forEach(function(p){if(p.name===name)p.enabled=!p.enabled});return preset});render()}catch(e){}}

  extract();render();setInterval(function(){extract();if(expanded)render()},3000);
})();