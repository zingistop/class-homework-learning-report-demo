/* Editable product notes + local review records. Pair with product-review.css. */
(() => {
  if (window.PinMarkReview) return;
  const cfg = window.PinMarkReviewConfig || {};
  const key = `pinmark:${encodeURIComponent(cfg.pageKey || location.pathname)}:v2`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalise = (rows, kind) => (rows || []).map((r, i) => ({
    ...r, id: r.id || `${kind}-${i + 1}`, number: String(r.number ?? i + 1),
    title: r.title || '', text: r.text ?? r.points?.join('\n') ?? r.description ?? '',
    selector: r.selector || r.anchorPath || '', frames: r.frames || [],
    x: Number.isFinite(r.x) && r.x >= 0 && r.x <= 1 ? r.x : .95,
    y: Number.isFinite(r.y) && r.y >= 0 && r.y <= 1 ? r.y : .12
  }));
  let data = {products:normalise(cfg.annotations,'product'),reviews:normalise(cfg.reviews,'review')};
  let mode='', draft=null, active=null, hidden=false, focusToken=0, loadError='', productEditing=false, embeddedSnapshot='';
  const embeddedNode=document.getElementById('pinmarkEmbeddedData');
  try {
    const encoded=embeddedNode?.textContent.trim();
    if(encoded){
      const saved=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))));
      if(!Array.isArray(saved.products)||!Array.isArray(saved.reviews))throw Error('invalid embedded data');
      data={products:normalise(saved.products,'product'),reviews:normalise(saved.reviews,'review')};
      embeddedSnapshot=JSON.stringify(data);
    }
  } catch(_){loadError='Demo 内嵌标注读取失败，请先备份当前文件。';}
  try {
    const raw=localStorage.getItem(key);
    if(raw!==null){const saved=JSON.parse(raw);if(!Array.isArray(saved.products)||!Array.isArray(saved.reviews))throw Error('invalid data');data={products:normalise(saved.products,'product'),reviews:normalise(saved.reviews,'review')};}
  } catch(_){loadError='本地记录读取失败，请先备份原有浏览器数据。';}
  try {
    if(typeof cfg.migrateData==='function'){
      const migrated=cfg.migrateData(clone(data));
      if(migrated&&Array.isArray(migrated.products)&&Array.isArray(migrated.reviews))data={products:normalise(migrated.products,'product'),reviews:normalise(migrated.reviews,'review')};
    }
  } catch(_){loadError='产品说明更新失败，请先备份当前文件。';}
  const $=(s,d=document)=>{try{return d.querySelector(s)}catch(_){return null}};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const n=el('button',text);n.type='button';n.onclick=fn;return n;};
  const ui=n=>n.setAttribute('data-pinmark-ui','');
  const toolbar=$(cfg.toolbarSelector||'header')||document.body;
  const controls=el('span','','pm-controls');ui(controls);
  const existing=$(cfg.annotationToggleSelector||'');
  const toggle=existing||button('隐藏标注',()=>setHidden(!hidden));ui(toggle);toggle.type='button';toggle.onclick=()=>setHidden(!hidden);
  if(!existing)controls.append(toggle);
  const reviewButton=button('评审记录',()=>setMode(mode==='review'?'':'review'));
  const addButton=button('新增产品标注',()=>{setHidden(false);setMode(mode==='product'||mode==='reanchor'?'':'product')});
  const saveFileButton=button('保存到 Demo',saveToDemo);
  controls.append(reviewButton,addButton,saveFileButton);
  const after=$(cfg.insertAfterSelector||'')||existing;if(after)after.after(controls);else toolbar.append(controls);
  let idleStatus=embeddedSnapshot&&embeddedSnapshot===JSON.stringify(data)?'已写入当前 Demo':'已保存到当前浏览器';
  const status=el('span',loadError||idleStatus,'pm-status');status.setAttribute('role','status');controls.append(status);
  let notes=$(cfg.notesSelector||'');
  if(!notes){notes=el('aside','','pm-panel pm-floating');document.body.append(notes)}
  notes.classList.add('pm-panel');ui(notes);
  const editor=el('section');editor.id='pm-editor';editor.hidden=true;ui(editor);editor.setAttribute('role','dialog');editor.setAttribute('aria-label','编辑标注');
  editor.innerHTML='<strong></strong><label>标号<input name="number" maxlength="20"></label><label>标题<input name="title" maxlength="120"></label><label>内容（每行一条）<textarea name="text" maxlength="10000"></textarea></label><div class="pm-error" role="status"></div><div class="pm-actions"></div>';
  const field=name=>editor.querySelector(`[name="${name}"]`),error=editor.querySelector('.pm-error');
  const remove=button('删除',()=>{if(draft&&deleteRecord(draft.kind,draft.record.id))close()});
  editor.querySelector('.pm-actions').append(remove,button('取消',close),button('保存',saveDraft));document.body.append(editor);
  const listKey=kind=>kind==='product'?'products':'reviews',list=kind=>data[listKey(kind)];
  function commit(next){
    if(loadError){error.textContent=loadError;status.textContent=loadError;return false;}
    try{localStorage.setItem(key,JSON.stringify(next))}catch(_){error.textContent='保存失败，请复制内容备份；当前更改尚未保存。';status.textContent=error.textContent;return false;}
    data=next;idleStatus='已保存到当前浏览器';status.textContent=idleStatus;renderNotes();refresh();return true;
  }
  function encodeData(value){
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  function openHandleDb(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('pinmark-demo-file-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('handles');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  async function storedHandle(){
    try{const db=await openHandleDb();return await new Promise((resolve,reject)=>{const request=db.transaction('handles').objectStore('handles').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}catch(_){return null}
  }
  async function storeHandle(handle){
    try{const db=await openHandleDb();await new Promise((resolve,reject)=>{const request=db.transaction('handles','readwrite').objectStore('handles').put(handle,key);request.onsuccess=resolve;request.onerror=()=>reject(request.error);});}catch(_){}
  }
  async function writableHandle(){
    let handle=await storedHandle();
    if(handle){
      const options={mode:'readwrite'};
      if(await handle.queryPermission(options)!=='granted'&&await handle.requestPermission(options)!=='granted')handle=null;
    }
    if(!handle){
      if(!window.showOpenFilePicker)throw Error('当前浏览器不支持写回本地文件，请使用最新版 Chrome 打开此产品稿。');
      [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'当前产品稿 HTML',accept:{'text/html':['.html']}}]});
      await storeHandle(handle);
    }
    return handle;
  }
  async function saveToDemo(){
    if(loadError){status.textContent=loadError;return}
    const priorText=saveFileButton.textContent;saveFileButton.disabled=true;saveFileButton.textContent='正在写入…';status.textContent='请选择当前产品稿的 index.html';
    try{
      const handle=await writableHandle(),file=await handle.getFile(),source=await file.text();
      const start='<!-- PINMARK_DATA_START -->',end='<!-- PINMARK_DATA_END -->';
      const startIndex=source.indexOf(start),endIndex=source.indexOf(end,startIndex+start.length);
      if(startIndex<0||endIndex<0||!source.includes(`pageKey:"${cfg.pageKey}"`))throw Error('请选择当前“班级作业学情-产品稿”目录中的 index.html。');
      const encoded=encodeData(data);
      const block=`${start}\n<script id="pinmarkEmbeddedData" type="application/json" data-encoding="base64">${encoded}</script>\n${end}`;
      const updated=source.slice(0,startIndex)+block+source.slice(endIndex+end.length);
      const writable=await handle.createWritable();await writable.write(updated);await writable.close();
      if(embeddedNode)embeddedNode.textContent=encoded;embeddedSnapshot=JSON.stringify(data);idleStatus='已写入当前 Demo';status.textContent=idleStatus;
    }catch(error){
      if(error?.name==='AbortError')status.textContent=idleStatus;
      else status.textContent=error?.message||'写入失败，请重试。';
    }finally{saveFileButton.disabled=false;saveFileButton.textContent=priorText;}
  }
  function upsert(kind,record){
    const rows=list(kind);
    if(!String(record.number).trim()||rows.some(r=>r.id!==record.id&&r.number===String(record.number).trim())){error.textContent='请填写未被本类标注占用的标号';return false;}
    if(!record.text.trim()){error.textContent='请输入内容';return false;}
    const next=clone(data),now=new Date().toISOString();
    const item={...record,number:String(record.number).trim(),createdAt:record.createdAt||now,updatedAt:now};
    next[listKey(kind)]=rows.some(r=>r.id===item.id)?rows.map(r=>r.id===item.id?item:r):[...rows,item];return commit(next);
  }
  function deleteRecord(kind,id){const next=clone(data);next[listKey(kind)]=list(kind).filter(r=>r.id!==id);if(!commit(next))return false;if(active?.id===id&&active.kind===kind)active=null;return true;}
  function saveDraft(){if(draft&&upsert(draft.kind,{...draft.record,number:field('number').value,title:draft.kind==='product'?field('title').value.trim():(draft.record.title||''),text:field('text').value.trim()}))close();}
  function close(){editor.hidden=true;draft=null;}
  function edit(kind,record,point={x:innerWidth-365,y:80}){
    draft={kind,record:clone(record)};editor.querySelector('strong').textContent=kind==='product'?'编辑产品说明':'编辑评审记录';
    for(const name of ['number','title','text'])field(name).value=record[name]||'';
    field('title').closest('label').hidden=kind==='review';
    field('text').closest('label').firstChild.textContent=kind==='review'?'评审内容':'内容（每行一条）';
    error.textContent='';remove.hidden=!list(kind).some(r=>r.id===record.id);editor.hidden=false;
    editor.style.left=`${Math.max(8,Math.min(point.x+12,innerWidth-editor.offsetWidth-8))}px`;
    editor.style.top=`${Math.max(8,Math.min(point.y+12,innerHeight-editor.offsetHeight-8))}px`;field('text').focus();
  }
  function cssPath(node){const parts=[];while(node&&node.nodeType===1){if(node.id){parts.unshift('#'+CSS.escape(node.id));break}const peers=[...(node.parentElement?.children||[])].filter(n=>n.tagName===node.tagName);parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node)+1})`);node=node.parentElement}return parts.join('>');}
  function context(win){
    if(cfg.getContext)return String(cfg.getContext(win));
    return JSON.stringify([win.location.pathname,win.location.search,win.location.hash,win.document.body?.dataset.view||'',...[...win.document.querySelectorAll('[aria-selected="true"],[aria-current="page"],dialog[open]')].map(n=>n.id||n.textContent.trim())]);
  }
  function walk(fn,win=window,frames=[],contexts=[]){
    let doc;try{doc=win.document;if(!doc?.body)return}catch(_){return}
    const chain=[...contexts,context(win)];fn(win,doc,frames,chain);
    for(const frame of doc.querySelectorAll('iframe'))walk(fn,frame.contentWindow,[...frames,cssPath(frame)],chain);
  }
  function locate(record){let result;walk((win,doc,frames,contexts)=>{
    if(JSON.stringify(frames)!==JSON.stringify(record.frames)||record.contexts&&JSON.stringify(record.contexts)!==JSON.stringify(contexts))return;
    if(cfg.isVisible&&!cfg.isVisible(record,win))return;
    const target=$(record.selector,doc);if(!target||!target.getClientRects().length||win.getComputedStyle(target).visibility==='hidden')return;result={win,target};
  });return result;}
  function topPoint(win,x,y){while(win!==window){const frame=win.frameElement,b=frame.getBoundingClientRect(),sx=b.width/(frame.offsetWidth||b.width),sy=b.height/(frame.offsetHeight||b.height);x=b.left+(x+frame.clientLeft)*sx;y=b.top+(y+frame.clientTop)*sy;win=win.parent}return{x,y};}
  function setMode(value){mode=value;reviewButton.textContent=mode==='review'?'结束评审':'评审记录';reviewButton.setAttribute('aria-pressed',String(mode==='review'));addButton.textContent=mode==='product'?'取消新增':mode==='reanchor'?'取消定位':'新增产品标注';addButton.setAttribute('aria-pressed',String(mode==='product'||mode==='reanchor'));status.textContent=mode?'点击页面选择标注位置；按 Esc 取消':idleStatus;if(!mode)close();refresh();}
  function setHidden(value){hidden=value;toggle.textContent=hidden?'显示标注':'隐藏标注';toggle.setAttribute('aria-pressed',String(hidden));notes.hidden=hidden;notes.closest('.pm-layout')?.classList.toggle('pm-notes-hidden',hidden);cfg.onVisibilityChange?.(!hidden);renderNotes();refresh();}
  function select(kind,record){active={kind,id:record.id};renderNotes();refresh();[...notes.querySelectorAll('.pm-note')].find(n=>n.dataset.id===record.id&&n.dataset.kind===kind)?.scrollIntoView({block:'nearest',behavior:'smooth'});}
  async function focus(kind,record){
    const token=++focusToken;select(kind,record);
    try{await cfg.navigate?.(record,kind)}catch(_){status.textContent='无法切换到标注所在页面';return}
    for(let attempt=0;attempt<40&&token===focusToken;attempt++){
      const found=locate(record);if(found){let win=found.win;while(win!==window){win.frameElement.scrollIntoView({block:'nearest',inline:'nearest'});win=win.parent}
        found.target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});
        found.target.animate([{outline:'3px solid #ed9a36',outlineOffset:'3px'},{outline:'3px solid transparent',outlineOffset:'5px'}],{duration:1600});refresh();return;}
      await new Promise(resolve=>setTimeout(resolve,75));
    }
    if(token===focusToken)status.textContent='当前位置不可见，请切换对应页面或重新定位此标注';
  }
  function renderNotes(){
    notes.replaceChildren();
    for(const kind of ['product','review']){
      const section=el('section');section.hidden=kind==='product'&&hidden;if(kind==='review')section.className='pm-review-list';
      if(kind==='product'){
        const heading=el('div');heading.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px';
        const editToggle=button(productEditing?'退出编辑':'编辑',()=>{
          productEditing=!productEditing;
          if(!productEditing){
            if(mode==='product'||(mode==='reanchor'&&draft?.kind==='product'))setMode('');
            else if(draft?.kind==='product')close();
          }
          renderNotes();
        });
        editToggle.setAttribute('aria-pressed',String(productEditing));
        heading.append(el('h2','产品逻辑说明'),editToggle);section.append(heading);
      }else section.append(el('h2','评审记录'));
      if(kind==='product')section.append(el('p','点击页面数字查看对应说明；点击说明编号定位页面内容。','pm-intro'));
      if(!list(kind).length)section.append(el('p','暂无记录'));
      for(const record of list(kind)){
        const card=el('article','','pm-note');card.dataset.id=record.id;card.dataset.kind=kind;card.dataset.active=String(active?.kind===kind&&active.id===record.id);
        const head=el('h3'),number=button(record.number,()=>focus(kind,record));number.className='pm-number';number.setAttribute('aria-label',`定位${kind==='product'?'产品标注':'评审记录'} ${record.number}`);
        head.append(number,el('span',kind==='product'?(record.title||'产品说明'):'评审记录'));
        const ul=el('ul');record.text.split('\n').filter(t=>t.trim()).forEach(t=>ul.append(el('li',t)));
        const actions=el('div','','pm-actions');actions.append(button('编辑',()=>edit(kind,record)),button('重新定位',()=>{setMode('reanchor');draft={kind,record}}),button('删除',()=>deleteRecord(kind,record.id)));
        card.append(head,ul);if(kind==='review'||productEditing)card.append(actions);section.append(card);
      }notes.append(section);
    }
  }
  const hooked=new WeakSet(),nodes=new WeakMap();
  function refresh(){walk((win,doc,frames,contexts)=>{
    if(!hooked.has(doc)){
      hooked.add(doc);const css=doc.createElement('style');css.textContent=`
        .pm-pin{all:initial!important;box-sizing:border-box!important;position:absolute!important;display:grid!important;place-items:center!important;min-width:28px!important;height:28px!important;padding:0 5px!important;border:2px solid white!important;border-radius:30px!important;background:#ed9a36!important;color:white!important;font:700 12px sans-serif!important;box-shadow:0 0 0 1px #302b24!important;cursor:pointer!important;pointer-events:auto!important;transform:translate(-50%,-50%)!important}
        .pm-pin:hover,.pm-pin:focus,.pm-pin[data-active=true]{background:#ed9a36!important;box-shadow:0 0 0 3px #604320,0 3px 10px #0003!important}
        .pm-pin[data-kind="product"],.pm-pin[data-kind="product"]:hover,.pm-pin[data-kind="product"]:focus,.pm-pin[data-kind="product"][data-active=true]{box-shadow:none!important;outline:none!important}
        .pm-pin[data-kind="product"]:focus-visible,.pm-pin[data-kind="product"][data-active=true]{transform:translate(-50%,-50%) scale(1.12)!important}
        .pm-pin[hidden]{display:none!important}html[data-pm-capture] *{cursor:crosshair!important}
      `;doc.head.append(css);
      doc.addEventListener('click',event=>{
        if(!mode||!(event.target instanceof win.Element)||event.target.closest('[data-pinmark-ui]')||cfg.excludeSelector&&event.target.closest(cfg.excludeSelector))return;
        event.preventDefault();event.stopImmediatePropagation();const b=event.target.getBoundingClientRect();
        const anchor={selector:cssPath(event.target),frames,contexts:clone(getContexts(win)),x:b.width?(event.clientX-b.left)/b.width:.5,y:b.height?(event.clientY-b.top)/b.height:.5,stage:cfg.getStage?.(win)};
        const prior=draft,kind=mode==='reanchor'?prior.kind:mode;
        if(mode==='reanchor'){if(upsert(kind,{...prior.record,...anchor}))setMode('');return}
        let number=1;while(list(kind).some(r=>r.number===String(number)))number++;
        setMode('');edit(kind,{...anchor,id:`pm-${Date.now()}-${Math.random().toString(36).slice(2)}`,number:String(number),title:'',text:''},topPoint(win,event.clientX,event.clientY));
      },true);
      doc.addEventListener('keydown',event=>{if(event.key==='Escape')setMode('')});
    }
    doc.documentElement.toggleAttribute('data-pm-capture',!!mode);
    let layer=doc.getElementById('pm-pin-layer');
    if(!layer){layer=doc.createElement('div');layer.id='pm-pin-layer';ui(layer);layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646';doc.body.append(layer);nodes.set(layer,new Map())}
    const map=nodes.get(layer),live=new Set();
    for(const kind of ['product','review'])for(const record of list(kind)){
      if(kind==='product'&&hidden)continue;
      if(JSON.stringify(frames)!==JSON.stringify(record.frames)||record.contexts&&JSON.stringify(contexts)!==JSON.stringify(record.contexts))continue;
      if(cfg.isVisible&&!cfg.isVisible(record,win))continue;
      const target=$(record.selector,doc);if(!target||!target.getClientRects().length||win.getComputedStyle(target).visibility==='hidden')continue;
      const b=target.getBoundingClientRect(),x=b.left+b.width*record.x,y=b.top+b.height*record.y;if(x<0||y<0||x>win.innerWidth||y>win.innerHeight)continue;
      const hits=doc.elementsFromPoint(x,y).filter(n=>!n.closest('[data-pinmark-ui]'));if(hits[0]&&!target.contains(hits[0])&&!hits[0].contains(target))continue;
      const id=`${kind}:${record.id}`;live.add(id);let pin=map.get(id);
      if(!pin){pin=doc.createElement('button');pin.type='button';pin.className='pm-pin';pin.dataset.id=record.id;pin.dataset.kind=kind;layer.append(pin);map.set(id,pin)}
      pin.textContent=record.number;pin.title=kind==='product'?(record.title||record.text):record.text;pin.setAttribute('aria-label',`${kind==='product'?'产品标注':'评审记录'} ${record.number}`);
      pin.style.setProperty('left',`${x}px`,'important');pin.style.setProperty('top',`${y}px`,'important');pin.dataset.active=String(active?.id===record.id&&active.kind===kind);
      pin.onclick=event=>{event.preventDefault();event.stopPropagation();select(kind,record);if(kind==='review')edit(kind,record,topPoint(win,x,y))};
    }
    for(const[id,pin]of map)if(!live.has(id)){pin.remove();map.delete(id)}
  });}
  function getContexts(win){const values=[];while(true){values.unshift(context(win));if(win===window)return values;win=win.parent}}
  window.PinMarkReview={getSnapshot:()=>clone(data),saveToDemo,refresh,focus:(id,kind='product')=>{const r=list(kind).find(r=>r.id===id);if(r)return focus(kind,r)}};
  renderNotes();refresh();setInterval(refresh,150);
})();
