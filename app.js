'use strict';
const APP = 'kozakura-biyori', DB = 'kozakura-biyori-local-v1';
const $ = id => document.getElementById(id);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const M=KozakuraModel;
const timerNotifications=KozabotaPlatform.createTimerNotifications({bridge:window.KozabotaNativeNotifications});
const blank=M.blank;
let db, state = blank(), route = 'home', calendarDate = today(), recordPage = 0, toastTimer;
let timerMode = 'countup', timerMinutes = 15;
let timerAudioContext=null, alertedTimerKey=null;
let behaviorOrderDraft=null;
let pendingWrites=0, recordWritePending=false, timerActionPending=false, undoEntry=null, undoTimer;
const quickCareLocks=new Set(), submittingForms=new WeakSet(), favoriteLocks=new Set();
class UserMessageError extends Error {}
const TYPES=M.TYPES;
const SEX = ['不明','オス','メス'], LEVEL = ['いつもどおり','少なめ','多め','気になる'];
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(APP) : null;
function el(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if(k.startsWith('on')) node.addEventListener(k.slice(2),v);
    else if(k==='class') node.className=v;
    else if(v!==null && v!==undefined) node.setAttribute(k,String(v));
  }
  for(const child of children.flat(Infinity)) if(child!==null && child!==undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function clearRecordUndo(){clearTimeout(undoTimer);undoEntry=null;if($('undo-action'))$('undo-action').hidden=true;}
function toast(message) {clearRecordUndo();$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',4500);}
function offerRecordUndo(record){
  clearRecordUndo();undoEntry={id:record.id,fingerprint:JSON.stringify(record),expires:Date.now()+15000};
  $('undo-action').hidden=false;$('undo-record').disabled=false;
  undoTimer=setTimeout(clearRecordUndo,15000);
}
async function undoLastRecord(){
  const entry=undoEntry;if(!entry)return;
  if(Date.now()>entry.expires){toast('取り消せる時間を過ぎました。記録画面から編集・削除できます。');return;}
  if(pendingWrites)return;
  $('undo-record').disabled=true;
  await save(d=>{
    const index=d.records.findIndex(r=>r.id===entry.id);
    if(index<0)throw new UserMessageError('対象の記録は既に削除されています。');
    if(JSON.stringify(d.records[index])!==entry.fingerprint)throw new UserMessageError('この記録は編集されています。記録画面から内容を確認してください。');
    d.records.splice(index,1);
  },'直前の記録を取り消しました');
}

function errorMessage(error) { if(error instanceof UserMessageError)return error.message;if(error?.message?.startsWith('上限：'))return error.message; return error?.name==='QuotaExceededError' ? '空き容量が足りず保存できませんでした。バックアップ後、不要な写真を削除してください。' : '保存・読み込みができませんでした。プライベートブラウズや端末の空き容量を確認してください。'; }
function openDB() { return new Promise((resolve,reject)=> { const req=indexedDB.open(DB,1); req.onupgradeneeded=()=>req.result.createObjectStore('data'); req.onerror=()=>reject(req.error); req.onsuccess=()=>resolve(req.result); }); }
function readState() { return new Promise((resolve,reject)=> { const tx=db.transaction('data','readonly'); const req=tx.objectStore('data').get('state'); req.onsuccess=()=>resolve(M.normalize(req.result)); req.onerror=()=>reject(req.error); }); }
// Transactional read-modify-write prevents two open tabs from overwriting each other's new records.
function mutateTransaction(fn) { return new Promise((resolve,reject)=> { const tx=db.transaction('data','readwrite'); const store=tx.objectStore('data'); const req=store.get('state'); let next; req.onsuccess=()=> { try {next=M.normalize(req.result); fn(next); if(next.records.length>50000 || JSON.stringify(next).length>38*1024*1024)throw new Error('上限：記録は50,000件、データ全体は約38MBまでです。バックアップ後、不要な記録・写真を削除してください。'); store.put(next,'state');} catch(e){tx.abort();reject(e);} }; tx.oncomplete=()=> {state=next; void timerNotifications.sync(next.timer).then(refreshNativeTimerStatus); channel?.postMessage('changed'); resolve();}; tx.onabort=tx.onerror=()=>reject(tx.error || new Error('保存に失敗しました')); }); }
async function mutate(fn){pendingWrites++;try{return await mutateTransaction(fn);}finally{pendingWrites--;}}
async function save(fn, message='保存しました') {try { await mutate(fn); if(message) toast(message); render(); return true; } catch(e) {toast(errorMessage(e));return false;} }
function card(...children) {return el('section',{class:'card'},children);}
function empty(text) {return el('p',{class:'empty'},el('span',{class:'empty-symbol','aria-hidden':'true'},icon('leaf')),text);}
function title(heading, text) {return [el('p',{class:'eyebrow'},'LITTLE BIRD, LOVELY DAYS'),el('h1',{},heading),el('p',{class:'intro'},text)];}
function label(text, control) { const id=control.id || uid(); control.id=id; return el('div',{},el('label',{for:id},text),control); }
function input(name, type='text', value='', extra={}) { return el('input',{name,type,value,...extra}); }
function select(name, choices, value) { const s=el('select',{name},choices.map(v=>el('option',{value:v},v)));s.value=value;return s; }
function note() {return label('メモ（任意）',el('textarea',{name:'note',maxlength:1000,placeholder:'今日のようす、気づいたこと…'}));}
function dateField(value=today()) {return label('記録日',input('date','date',value,{required:true,min:'1900-01-01',max:'2100-12-31'}));}
function askConfirm(message){return new Promise(resolve=>{const dialog=$('confirm-dialog');$('confirm-message').textContent=message;const finish=value=>{dialog.close();resolve(value);};$('confirm-ok').onclick=()=>finish(true);$('confirm-cancel').onclick=()=>finish(false);dialog.oncancel=event=>{event.preventDefault();finish(false);};dialog.showModal();});}
function closeDialog(){ $('dialog').close(); }
function showDialog(...nodes){ $('dialog-content').replaceChildren(...nodes.flat(Infinity).filter(node=>node!==null&&node!==undefined));$('dialog').showModal(); }
function submitForm(form,handler){
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submittingForms.has(form)||!form.reportValidity())return;
    submittingForms.add(form);form.setAttribute('aria-busy','true');
    const button=form.querySelector('[type=submit]'),text=button.textContent,modal=form.closest('#dialog');
    button.disabled=true;button.textContent='保存中…';if(modal)$('close-dialog').disabled=true;
    try{await handler(new FormData(form));}catch(e){toast(errorMessage(e));}
    finally{submittingForms.delete(form);form.removeAttribute('aria-busy');button.disabled=false;button.textContent=text;if(modal)$('close-dialog').disabled=false;}
  });return form;
}
function formDialog(name, controls, handler){const form=el('form',{},controls,el('button',{type:'submit'},'記録を保存'));submitForm(form,handler);showDialog(el('h2',{},name),form);}
async function addRecord(type, data){if(!validDate(data.date)){toast('記録日を確認してください');return;}const record={id:uid(),type,date:data.date,createdAt:new Date().toISOString(),...data};if(await save(s=>s.records.push(record),'記録を保存しました'))closeDialog();}
function recordForm(type){
  const handler = async f => {const data={date:f.get('date'),note:f.get('note') || ''};
    if(type==='weight')data.value=Number(f.get('value'));
    if(type==='health'){data.appetite=f.get('appetite');data.droppings=f.get('droppings');data.activity=f.get('activity');}
    if(type==='flight')data.minutes=Number(f.get('minutes'));
    if(type==='egg'){data.count=Number(f.get('count'));data.condition=f.get('condition');}
    if(type==='behavior')data.behavior=f.get('behavior');
    await addRecord(type,data);
  };
  const controls=[dateField()];
  if(type==='weight')controls.push(label('実測した体重（g）',input('value','number','',{required:true,min:.1,max:2000,step:.1,placeholder:'測った値を入力'})));
  if(type==='health')controls.push(label('食欲',select('appetite',LEVEL,LEVEL[0])),label('フン',select('droppings',LEVEL,LEVEL[0])),label('活動量',select('activity',LEVEL,LEVEL[0])));
  if(type==='flight')controls.push(label('放鳥時間（分）',input('minutes','number','',{required:true,min:.1,max:10080,step:.1,placeholder:'実際の時間を入力'})));
  if(type==='egg')controls.push(label('産んだ卵の数',input('count','number','1',{required:true,min:1,max:100,step:1})),label('卵のようす',select('condition',['未確認','いつもどおり','気になる'],'未確認')));
  if(type==='behavior')controls.push(label('行動',select('behavior',['ごきげん','甘えた','よく鳴いた','水浴び','羽づくろい','発情のようす','その他'],'ごきげん')));
  controls.push(note());formDialog(`${TYPES[type][0]} ${TYPES[type][1]}の記録`,controls,handler);
}
function sortedRecords(){return [...state.records].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));}
function describe(r){if(r.type==='weight')return `${r.value} g`;if(r.type==='flight')return `${r.minutes} 分`;if(r.type==='egg')return `${r.count} 個 · ${r.condition}`;if(r.type==='behavior')return r.behavior;return `食欲：${r.appetite} / フン：${r.droppings} / 活動量：${r.activity}`;}
function recordList(records){if(!records.length)return empty('まだ記録がありません。今日のようすを残してみましょう。');return el('ul',{class:'record-list'},records.map(r=>el('li',{class:'record-item'},el('span',{class:'record-icon','aria-hidden':'true'},TYPES[r.type][0]),el('div',{class:'record-body'},el('strong',{},TYPES[r.type][1]),el('time',{datetime:r.date},`  ${r.date}`),el('p',{},describe(r)),r.note?el('p',{class:'muted'},r.note):null),el('button',{class:'delete','aria-label':`${r.date}の${TYPES[r.type][1]}記録を削除`,onclick:async()=>{if(await askConfirm('この記録を削除しますか？'))await save(s=>s.records=s.records.filter(x=>x.id!==r.id),'記録を削除しました');}},'×'))));}
function timerSeconds(){
  if(!state.timer)return timerMode==='countdown'?timerMinutes*60:0;
  const elapsed=Math.max(0,Date.now()-state.timer.startedAt);
  return state.timer.durationSeconds?Math.max(0,Math.ceil(state.timer.durationSeconds-elapsed/1000)):Math.floor(elapsed/1000);
}
function timerText(){const seconds=timerSeconds();return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function timerFinished(){return Boolean(state.timer?.durationSeconds)&&timerSeconds()===0;}
function timerStatus(){return timerFinished()?'設定時間になりました':state.timer?(state.timer.durationSeconds?'残り時間':'放鳥中'):timerMode==='countdown'?'設定した時間':'放鳥の時間';}
async function prepareTimerAudio(){
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return false;
    if(!timerAudioContext||timerAudioContext.state==='closed'){timerAudioContext=new Audio();timerAudioContext.onstatechange=refreshTimerAudioStatus;}
    await timerAudioContext.resume();
    return timerAudioContext.state==='running';
  }catch{return false;}
}
function playTimerSound(){
  if(!timerAudioContext||timerAudioContext.state!=='running')return false;
  try{
    const start=timerAudioContext.currentTime;
    for(let i=0;i<3;i++){
      const oscillator=timerAudioContext.createOscillator(),gain=timerAudioContext.createGain(),at=start+i*.4;
      oscillator.frequency.value=i===1?1046.5:880;
      gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.15,at+.02);gain.gain.exponentialRampToValueAtTime(.001,at+.28);
      oscillator.connect(gain);gain.connect(timerAudioContext.destination);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      oscillator.start(at);oscillator.stop(at+.3);
    }
    return true;
  }catch{return false;}
}
function timerAudioStatus(){return timerAudioContext?.state==='running'?'画面表示中の終了音：準備できました。音量は「終了音を試す」で確認してください。':'再読み込み後や音が出ない場合は「終了音を試す」を押してください。';}
function refreshTimerAudioStatus(){if($('timer-audio-status'))$('timer-audio-status').textContent=timerAudioStatus();}
function checkTimerAlert(){
  if(!timerFinished()||document.visibilityState!=='visible')return;
  const key=`${state.timer.startedAt}:${state.timer.durationSeconds}`;
  if(alertedTimerKey===key)return;
  alertedTimerKey=key;
  playTimerSound();
  toast('放鳥の設定時間になりました。愛鳥を確認してください。');
}
function nativeTimerStatus(){
  const result=timerNotifications.getStatus();
  if(result.state==='scheduled')return '終了時刻のお知らせを端末に予約しました。通知許可・音量・消音・集中モードの設定に従います。';
  if(result.state==='denied')return '通知が許可されていません。端末の通知設定を確認するか、標準タイマーをご利用ください。';
  if(result.state==='error')return '終了のお知らせを予約・取り消しできませんでした。標準タイマーも確認してください。';
  return 'カウントダウン開始時に、端末内へ終了のお知らせを予約します。';
}
function refreshNativeTimerStatus(){const status=$('native-timer-status');if(status)status.textContent=nativeTimerStatus();}
function timerNotificationControls(){
  const countdown=state.timer?Boolean(state.timer.durationSeconds):timerMode==='countdown';
  if(!countdown)return null;
  const active=state.timer,ended=timerFinished();
  const calendar=active?[
    el('p',{class:'timer-deadline'},`終了予定：${new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(active.startedAt+active.durationSeconds*1000))}`),
    el('button',{id:'timer-calendar-button',class:'primary wide',disabled:ended?'':null,onclick:()=>{try{downloadFile(M.timerCalendarFile(state.timer),'text/calendar;charset=utf-8','kozakura-flight-timer.ics');toast('終了時刻の予定ファイルを作成しました。カレンダーへ追加し、予定の通知を確認してください。');}catch(e){toast(e.message);}}},icon('calendar'),'終了のお知らせ用ファイルを書き出す'),
    el('ol',{class:'help-list'},el('li',{},'書き出した .ics ファイルを標準カレンダーに読み込み、予定を追加します。iPhoneで追加できない場合はMacのカレンダーで読み込み、同じiCloudカレンダーに追加してください。'),el('li',{},'予定の通知と、iPhoneの設定 → 通知 → カレンダーを確認します。通知音はiPhoneの音量・消音・集中モードの設定に従います。'),el('li',{},'タイマーを取り消したり早めに終了した場合は、追加した予定もカレンダーで削除します。'))
  ]:el('p',{},'開始後に終了時刻の予定ファイルを書き出し、iPhone標準カレンダーへ追加できます。');
  return card(el('h2',{},'終了のお知らせ'),timerNotifications.available?el('div',{},el('p',{class:'notice',id:'native-timer-status',role:'status'},nativeTimerStatus()),el('button',{class:'ghost wide',onclick:async()=>{await timerNotifications.requestPermission();await timerNotifications.sync(state.timer);refreshNativeTimerStatus();}},'端末の通知を確認')):el('p',{class:'notice'},'画面を閉じている間の通知は、標準カレンダーへの追加が必要です。このアプリだけでは自動で予約できません。急ぐときは、iPhoneの「時計 → タイマー」に残り時間を設定してください。'),calendar,el('p',{class:'muted'},'ファイルの保存だけでは通知は有効になりません。カレンダーへの追加完了・通知許可・予定の削除をアプリから確認・操作することはできません。同じ予定の重複追加にもご注意ください。'),el('button',{class:'ghost wide',onclick:async()=>{const ready=await prepareTimerAudio();if(ready&&playTimerSound())toast('終了音を鳴らしました。聞こえる音量か確認してください。');else toast('音を再生できません。端末の音量とブラウザの設定を確認してください。');refreshTimerAudioStatus();}},'終了音を試す'),el('p',{id:'timer-audio-status',class:'muted',role:'status'},timerAudioStatus()),el('p',{class:'muted'},'アプリの終了音は画面を表示している間に鳴ります。画面ロック・別アプリへの切り替え・アプリ終了中の音は保証できません。'));
}
function timerElapsedText(){const n=state.timer?Math.max(0,Math.floor((Date.now()-state.timer.startedAt)/1000)):0;return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
// Decorative flight illustration uses the same local palette as the selected bird.
function activeTimerBird(){
  const palette=M.BIRD_APPEARANCES.find(b=>b.id===state.settings.birdAppearance)||M.BIRD_APPEARANCES[0];
  const svgNode=(tag,attrs={},...children)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);node.append(...children);return node;};
  const button=palette.species==='button';
  const head=(action='perch')=>svgNode('g',{class:`bird-gesture bird-head bird-${action}-head`},
    button?svgNode('ellipse',{cx:68,cy:50,rx:23,ry:13,fill:palette.collar}):svgNode('g'),
    svgNode('ellipse',{cx:73,cy:37,rx:23,ry:24,fill:palette.face}),
    button?svgNode('circle',{cx:82,cy:34,r:7,fill:'#fffef7'}):svgNode('g'),
    ['preen','sleep'].includes(action)?svgNode('path',{d:'M78 34Q82 39 86 34',fill:'none',stroke:'#344e46','stroke-width':2.5,'stroke-linecap':'round'}):svgNode('g',{},
      svgNode('circle',{cx:82,cy:34,r:3.6,fill:'#344e46'}),
      svgNode('circle',{cx:83,cy:33,r:1.1,fill:'#fffef7'})),
    svgNode('path',{d:'M94 38 107 44 95 51Z',fill:palette.beak}),
    action==='paper'?svgNode('g',{class:'bird-gesture bird-paper-strip'},
      svgNode('path',{d:'M100 46 114 50 108 78 103 74 98 78 96 68Z',fill:'#fff9e7',stroke:'#c6b58c','stroke-width':1.5}),
      svgNode('path',{d:'M102 55 109 57M101 61 108 63',stroke:'#d9cba9','stroke-width':1.5})):svgNode('g'));
  const resting=(action='perch')=>svgNode('g',{class:`bird-action bird-action-${action}`},
    svgNode('path',{d:'M17 96Q60 90 106 96',fill:'none',stroke:'#b39772','stroke-width':6,'stroke-linecap':'round'}),
    svgNode('path',{d:'M24 95Q15 80 32 83Q38 87 24 95Z',fill:'#a4bc8b'}),
    svgNode('g',{class:`bird-gesture bird-${action}-body`},
      svgNode('path',{d:'M44 70 31 93 55 83Z',fill:palette.tail}),
      svgNode('ellipse',{cx:60,cy:64,rx:25,ry:25,fill:palette.body}),
      action==='stretch'?svgNode('path',{class:'bird-gesture bird-stretch-wing',d:'M58 56C39 57 15 77 13 91C32 101 59 82 68 64Z',fill:palette.wing}):svgNode('ellipse',{cx:55,cy:68,rx:16,ry:20,fill:palette.wing}),
      svgNode('path',{d:action==='stretch'?'M54 86 54 94M67 84 89 88 95 85':'M54 86 54 94M67 86 67 94',fill:'none',stroke:palette.beak,'stroke-width':3,'stroke-linecap':'round'}),
      head(action)),
    action==='paper'?svgNode('g',{class:'bird-gesture bird-paper-crumbs',fill:'#eee0b9'},
      svgNode('path',{d:'M103 79 108 81 104 85Z'}),svgNode('path',{d:'M110 86 114 84 115 89Z'})):svgNode('g'));
  return svgNode('svg',{viewBox:'0 0 120 110',class:'active-timer-bird','aria-hidden':'true','data-appearance':palette.id},
    svgNode('g',{class:'bird-action bird-action-fly'},svgNode('g',{class:'flight-bob'},
      svgNode('path',{d:'M45 68 17 89 43 87 56 75Z',fill:palette.tail}),
      svgNode('ellipse',{cx:58,cy:64,rx:28,ry:24,fill:palette.body}),
      svgNode('path',{class:'flight-wing',d:'M57 64C34 66 15 43 23 25C29 17 53 35 65 56Z',fill:palette.wing}),
      head('fly'))),...['perch','preen','curious','stretch','puff','hop','sleep','paper'].map(resting));
}
function updateActiveTimer(){
  const banner=$('active-timer');if(!banner)return;banner.hidden=!state.timer||route==='timer';
  if(state.timer){
    // Keep the illustration mounted between ticks so its motion stays gentle.
    if(banner.dataset.appearance!==state.settings.birdAppearance||!$('active-timer-value')){
      banner.replaceChildren(
        el('span',{class:'active-timer-heading'},'放鳥は計測中'),
        el('span',{class:'active-timer-reading'},el('span',{id:'active-timer-label',class:'active-timer-label'}),el('strong',{id:'active-timer-value',class:'active-timer-value'})),
        el('span',{id:'active-timer-detail',class:'active-timer-detail'}),
        el('span',{id:'active-timer-start',class:'active-timer-start'}),
        el('span',{class:'active-timer-art'},activeTimerBird()),
        el('span',{class:'active-timer-link'},'タイマーを開く →'));
      banner.dataset.appearance=state.settings.birdAppearance;
    }
    // Use the persisted start time instead of the browser's SVG animation clock.
    // This also restores the right pose after returning from the background.
    const actions=['fly','perch','preen','curious','stretch','puff','hop','sleep','paper'];
    const action=actions[Math.floor(Math.max(0,Date.now()-state.timer.startedAt)/30000)%actions.length];
    const bird=banner.querySelector('.active-timer-bird');
    if(bird.dataset.action!==action){
      for(const pose of bird.querySelectorAll('.bird-action'))pose.classList.toggle('is-current',pose.classList.contains(`bird-action-${action}`));
      bird.dataset.action=action;
    }
    $('active-timer-start').textContent=`開始 ${new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(state.timer.startedAt))}`;
    const finished=timerFinished();
    banner.classList.toggle('finished',finished);
    $('active-timer-label').textContent=state.timer.durationSeconds?'残り':'経過';
    $('active-timer-value').textContent=timerText();
    $('active-timer-detail').textContent=finished?`設定時間に到達 · 経過 ${timerElapsedText()}`:state.timer.durationSeconds?`経過 ${timerElapsedText()}`:'のびのび、放鳥タイム';
  }
  if($('timer-elapsed'))$('timer-elapsed').textContent=state.timer?`開始 ${new Date(state.timer.startedAt).toLocaleString('ja-JP')} ／ 経過 ${timerElapsedText()}`:'終了すると実際の放鳥時間を記録します。';
}
function updateTimerDisplay(){
  updateActiveTimer();checkTimerAlert();
  if($('timer-calendar-button'))$('timer-calendar-button').disabled=timerFinished();
  if(!$('timer-display'))return;
  $('timer-display').textContent=timerText();
  $('timer-status').textContent=timerStatus();
  $('timer-complete').hidden=!timerFinished();
  $('timer-scene').classList.toggle('finished',timerFinished());
}
function timerControls(){
  const choices=tabs([['countup','時間を計る'],['countdown','カウントダウン']],timerMode,v=>timerMode=v);
  choices.setAttribute('aria-label','タイマーの種類');
  if(timerMode!=='countdown')return choices;
  const minutes=input('timer-minutes','number',timerMinutes,{id:'timer-minutes',required:true,min:1,max:1440,step:1});
  minutes.addEventListener('input',()=>{if(minutes.validity.valid){timerMinutes=Number(minutes.value);updateTimerDisplay();}});
  const presets=el('div',{class:'timer-presets',role:'group','aria-label':'放鳥時間を選ぶ'},[15,30,60].map(value=>el('button',{class:'ghost',onclick:()=>{timerMinutes=value;render();}},`${value}分`)));
  return [choices,presets,label('放鳥時間（分）',minutes),el('p',{class:'muted'},'1〜1,440分で自由に設定できます。'),el('p',{class:'notice'},'画面を閉じると、このアプリの終了音は鳴らせません。開始後、下の「終了のお知らせ」でカレンダーに予定を追加するか、iPhone標準のタイマーを設定してください。')];
}
function timerCard(){return card(el('div',{class:'section-title'},el('h2',{},'🪽 いっしょに、ひとやすみ'),el('span',{class:'muted'},'放鳥タイマー')),el('div',{class:'timer-display',id:'timer-display','aria-label':'放鳥の経過時間'},timerText()),el('button',{class:'wide',onclick:async()=>{if(state.timer){if(!await askConfirm('放鳥を終了し、経過時間を記録しますか？'))return;await save(s=>{if(!s.timer)throw new Error('終了済み');if(Date.now()-s.timer.startedAt>10080*60000)throw new Error('上限：7日を超えたタイマーは記録できません。取り消して、実際の放鳥時間を手入力してください。');const start=s.timer;s.records.push({id:uid(),type:'flight',date:start.date,createdAt:new Date().toISOString(),minutes:Math.max(.1,Math.round((Date.now()-start.startedAt)/6000)/10),note:'放鳥タイマーから記録'});s.timer=null;},'放鳥を記録しました');}else await save(s=>{if(!s.timer)s.timer={startedAt:Date.now(),date:today()};},'タイマーを開始しました');}},state.timer?'終了して記録する':'放鳥をはじめる'),state.timer?el('button',{class:'ghost wide',onclick:async()=>{if(await askConfirm(`タイマーを取り消しますか？ 記録には残りません。${state.timer?.durationSeconds?' カレンダーに追加した終了予定も、カレンダー側で削除してください。':''}`))await save(s=>s.timer=null,'タイマーを取り消しました');}},'記録せず取り消す'):null,el('p',{class:'muted',style:null},'アプリを閉じても経過時間に含みます。終了操作を忘れた場合は手入力で記録してください。通知・アラームは鳴りません。'));}
function actionButtons(){return el('div',{class:'actions'},Object.entries(TYPES).map(([type,[icon,name]])=>el('button',{onclick:()=>recordForm(type)},el('span',{'aria-hidden':'true'},icon),name)),el('button',{onclick:()=>location.hash='album'},el('span',{'aria-hidden':'true'},'▧'),'写真'));}
function home(){const weights=sortedRecords().filter(r=>r.type==='weight');const flights=state.records.filter(r=>r.type==='flight'&&r.date===today());return [...title(new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'long'}).format(new Date()),'小さな変化も、たいせつな思い出も。'),el('section',{class:'hero'},el('img',{class:'hero-photo',src:state.profile.photo||birdImage(),alt:state.profile.photo?'この端末で選んだ愛鳥の写真':'オリジナルのインコイラスト'}),el('div',{class:'hero-copy'},el('p',{class:'eyebrow'},'MY LITTLE FRIEND'),el('h2',{},state.profile.name||'うちの子'),el('p',{},state.profile.name?`${state.profile.sex} · ${state.profile.age||'年齢未設定'}`:'まずは愛鳥の名前と写真を。'),el('button',{class:'ghost',onclick:profileDialog},'プロフィールを編集'))),el('div',{class:'stats'},el('section',{class:'stat'},el('small',{},'最新の体重'),el('strong',{},weights[0]?weights[0].value:'—',el('small',{},'g')),el('small',{},weights[0]?weights[0].date:'測った値を記録しましょう')),el('section',{class:'stat'},el('small',{},'今日の放鳥'),el('strong',{},Math.round(flights.reduce((sum,r)=>sum+r.minutes,0)*10)/10,el('small',{},'分')),el('small',{},flights.length?`${flights.length} 回の記録`:'まだ記録がありません'))),card(el('h2',{},'今日のようすを記録'),actionButtons()),timerCard(),card(el('div',{class:'section-title'},el('h2',{},'最近の記録'),el('a',{href:'#records'},'すべて見る →')),recordList(sortedRecords().slice(0,5))),el('div',{class:'notice'},'写真と記録はこのブラウザ・ホーム画面アプリ内に保存されます。定期的に「設定」からバックアップしてください。')];}
function chart(){const values=state.records.filter(r=>r.type==='weight').sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt)).slice(-30);if(!values.length)return empty('実測した体重を入力すると、ここにグラフが表示されます。','⚖');const min=Math.min(...values.map(r=>r.value)),max=Math.max(...values.map(r=>r.value)),pad=Math.max(1,(max-min)*.2),low=min-pad,high=max+pad;const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 500 190');svg.setAttribute('role','img');svg.setAttribute('aria-label',`直近${values.length}件の体重。最小${min}グラム、最大${max}グラム`);svg.classList.add('chart');const coords=values.map((r,i)=>[45+(values.length===1?.5:i/(values.length-1))*435,160-(r.value-low)/(high-low)*140]);function shape(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);}for(let i=0;i<3;i++){const v=low+(high-low)*i/2,y=160-i*70;shape('line',{x1:45,y1:y,x2:480,y2:y,stroke:'#e2e8db'});shape('text',{x:1,y:y+4,fill:'#718175','font-size':11},v.toFixed(1));}shape('polyline',{points:coords.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#719973','stroke-width':3});coords.forEach(([cx,cy])=>shape('circle',{cx,cy,r:4,fill:'#c98b6f'}));return [svg,el('div',{class:'chart-labels'},el('span',{},values[0].date),el('span',{},values.at(-1).date)),el('p',{class:'muted'},'直近30件・記録順。線は入力値を結んだもので、診断や目標値ではありません。')];}
function records(){const all=sortedRecords();return [...title('日々の記録','今日の「いつもどおり」を、少しずつ。'),card(actionButtons()),card(el('h2',{},'体重のうつりかわり'),chart()),card(el('h2',{},`記録一覧 · ${all.length} 件`),recordList(all.slice(recordPage*30,(recordPage+1)*30)),el('div',{class:'pagination'},recordPage>0?el('button',{class:'ghost',onclick:()=>{recordPage--;render();}},'前へ'):null,(recordPage+1)*30<all.length?el('button',{class:'ghost',onclick:()=>{recordPage++;render();}},'次へ'):null))];}
function calendar(){const [year,month]=calendarDate.split('-').map(Number);const first=new Date(year,month-1,1).getDay(),days=new Date(year,month,0).getDate();const grid=el('div',{class:'calendar-grid'},['日','月','火','水','木','金','土'].map(day=>el('span',{class:'weekday'},day)));for(let i=0;i<first;i++)grid.append(el('span'));for(let d=1;d<=days;d++){const date=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const has=state.records.some(r=>r.date===date);grid.append(el('button',{class:`${date===calendarDate?'selected ':''}${has?'has-record':''}`,'aria-label':`${date}${has?' 記録あり':''}`,'aria-pressed':date===calendarDate,onclick:()=>{calendarDate=date;render();}},d));}const control=input('calendar-date','date',calendarDate,{min:'1900-01-01',max:'2100-12-31',required:true,onchange:e=>{if(validDate(e.target.value)){calendarDate=e.target.value;render();}}});return [...title('思い出カレンダー','記録のある日に、小さなしるし。'),card(label('表示する日',control),grid),card(el('h2',{},`${calendarDate} の記録`),recordList(sortedRecords().filter(r=>r.date===calendarDate)))];}
async function normalizePhoto(file){if(!file || !file.type.startsWith('image/') || file.size>25*1024*1024)throw new Error('25MB以下の画像を選んでください');const url=URL.createObjectURL(file);try {const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('画像を読み込めません。写真アプリでJPEGまたはPNGとして保存してから選び直してください。'));image.src=url;});const scale=Math.min(1,1024/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.8);if(data.length>2_000_000)throw new Error('画像が大きすぎます。小さい写真を選んでください');return data;}finally{URL.revokeObjectURL(url);}}
function photoChooser(onPhoto){const chooser=input('photo','file','',{accept:'image/*',onchange:async e=>{const file=e.target.files[0];if(!file)return;e.target.disabled=true;try {await onPhoto(await normalizePhoto(file));}catch(error){toast(error.message);}finally{e.target.disabled=false;e.target.value='';}}});chooser.removeAttribute('value');return chooser;}
function profileDialog(){const photo=el('img',{class:'hero-photo',src:state.profile.photo||birdImage(),alt:'現在のプロフィール画像'});const form=el('form',{},label('名前',input('name','text',state.profile.name,{maxlength:40,placeholder:'愛鳥の名前'})),label('性別',select('sex',SEX,state.profile.sex)),label('推定年齢（任意）',input('age','text',state.profile.age,{maxlength:40,placeholder:'例：推定2歳 / 2024年春生まれ'})),el('button',{type:'submit'},'プロフィールを保存'));submitForm(form,async f=>{if(await save(s=>Object.assign(s.profile,{name:f.get('name').trim(),sex:f.get('sex'),age:f.get('age').trim()}),'プロフィールを保存しました'))closeDialog();});showDialog(el('h2',{},'うちの子のプロフィール'),photo,label('写真を選ぶ・変更する',photoChooser(async data=>{if(await save(s=>s.profile.photo=data,'写真をこの端末に保存しました'))photo.src=data;})),el('p',{class:'muted'},'写真は端末内で縮小して保存します。位置情報などのメタデータは引き継がず、サーバーへ送信しません。'),el('button',{class:'danger wide',onclick:async()=>{if(await askConfirm('プロフィール写真を削除しますか？ アルバムの写真は残ります。'))if(await save(s=>s.profile.photo=null,'プロフィール写真を削除しました'))photo.src=birdImage();}},'プロフィール写真を削除'),form);}
function album(){return [...title('ちいさな写真帖','お気に入りの一枚を、この端末に。'),card(label('写真ライブラリから追加',photoChooser(async data=>{if(state.photos.length>=100){toast('写真は100枚までです。バックアップ後、不要な写真を削除してください。');return;}await save(s=>{if(s.photos.length>=100)throw new Error('上限');s.photos.push({id:uid(),date:today(),data});},'アルバムに保存しました');})),el('p',{class:'muted'},'最大100枚・データ全体約38MBまで。画像は長辺1024pxに縮小して保存します。元の写真は変更しません。')),state.photos.length?el('div',{class:'album-grid'},[...state.photos].reverse().map(p=>el('figure',{class:'photo-card'},el('img',{src:p.data,alt:`${p.date}に追加した愛鳥の写真`,loading:'lazy'}),el('figcaption',{},p.date,el('div',{class:'row'},el('button',{class:'ghost',onclick:async()=>{await save(s=>s.profile.photo=p.data,'プロフィール写真に設定しました');}},'表紙にする'),el('button',{class:'danger',onclick:async()=>{if(await askConfirm('この写真をアルバムから削除しますか？ プロフィール写真は残ります。'))await save(s=>s.photos=s.photos.filter(x=>x.id!==p.id),'写真を削除しました');}},'削除')))))):card(empty('まだ写真がありません。お気に入りの一枚を選んでください。','▧'))];}
function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<'1900-01-01'||s>'2100-12-31')return false;const d=new Date(`${s}T12:00:00Z`);return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
function validPhoto(data){return data===null || (typeof data==='string' && data.length<=2_000_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data));}
function textOK(value,max=1000){return typeof value==='string'&&value.length<=max;}
function validateBackup(raw){
  const bad=()=>{throw new Error('このアプリの有効なバックアップではありません。元のファイルを確認してください。');};
  if(!raw||raw.app!==APP||raw.version!==1||!raw.data)bad();const d=raw.data,p=d.profile;
  if(!p||!textOK(p.name,40)||!SEX.includes(p.sex)||!textOK(p.age,40)||!validPhoto(p.photo)||!Array.isArray(d.records)||d.records.length>50000||!Array.isArray(d.photos)||d.photos.length>100)bad();
  const ids=new Set();const records=d.records.map(r=>{if(!r||!Object.hasOwn(TYPES,r.type)||!textOK(r.id,100)||ids.has(r.id)||!validDate(r.date)||!textOK(r.note)||!textOK(r.createdAt,40)||!Number.isFinite(Date.parse(r.createdAt)))bad();ids.add(r.id);const out={id:r.id,type:r.type,date:r.date,note:r.note,createdAt:r.createdAt};const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
    if(r.type==='weight'){if(!num(r.value,.1,2000))bad();out.value=r.value;}
    if(r.type==='flight'){if(!num(r.minutes,.1,10080))bad();out.minutes=r.minutes;}
    if(r.type==='health'){if(![r.appetite,r.droppings,r.activity].every(x=>LEVEL.includes(x)))bad();Object.assign(out,{appetite:r.appetite,droppings:r.droppings,activity:r.activity});}
    if(r.type==='egg'){if(!Number.isInteger(r.count)||!num(r.count,1,100)||!['未確認','いつもどおり','気になる'].includes(r.condition))bad();Object.assign(out,{count:r.count,condition:r.condition});}
    if(r.type==='behavior'){if(!textOK(r.behavior,40))bad();out.behavior=r.behavior;}
    return out;
  });const photoIds=new Set();const photos=d.photos.map(p=>{if(!p||!textOK(p.id,100)||photoIds.has(p.id)||!validDate(p.date)||!validPhoto(p.data)||p.data===null)bad();photoIds.add(p.id);return {id:p.id,date:p.date,data:p.data};});
  // An in-progress timer is deliberately not resumed when moving between devices.
  return {profile:{name:p.name,sex:p.sex,age:p.age,photo:p.photo},records,photos,timer:null,lastBackup:null};
}
async function exportBackup(){try {const current=await readState();const json=JSON.stringify({app:APP,version:2,exportedAt:new Date().toISOString(),data:current});const blob=new Blob([json],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a',{href:url,download:`kozakura-biyori-${today()}.json`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);await save(s=>s.lastBackup=new Date().toISOString(),'バックアップファイルを作成しました。「ファイル」アプリへの保存を確認してください。');}catch(e){toast(errorMessage(e));}}
async function importBackup(file){if(!file)return;if(file.size>40*1024*1024){toast('40MB以下のバックアップを選んでください。');return;}try {const data=validateBackup(JSON.parse(await file.text()));if(JSON.stringify(data).length>38*1024*1024)throw new Error('上限：復元できるデータは約38MBまでです。');if(!await askConfirm(`プロフィール、記録${data.records.length}件、写真${data.photos.length}枚で、この端末の現在のデータを置き換えます。先にバックアップを保存しましたか？ 実行中のタイマーも終了します。`))return;await save(s=>{for(const key of Object.keys(s))delete s[key];Object.assign(s,data);},'バックアップを復元しました');recordPage=0;}catch(e){toast(e instanceof SyntaxError?'JSONファイルを読み込めませんでした。':e.message);}}
function settings(){const restore=input('backup','file','',{accept:'.json,application/json',onchange:async e=>{await importBackup(e.target.files[0]);e.target.value='';}});restore.removeAttribute('value');return [...title('設定とバックアップ','たいせつな記録を、長く残すために。'),card(el('h2',{},'愛鳥のプロフィール'),el('p',{class:'muted'},'名前・性別・推定年齢・表紙の写真を変更できます。'),el('button',{class:'ghost wide',onclick:profileDialog},'プロフィールを編集')),card(el('h2',{},'データを持ち出す・戻す'),el('p',{class:'backup-info'},`記録 ${state.records.length} 件 / アルバム ${state.photos.length} 枚`),el('button',{class:'wide',onclick:exportBackup},'バックアップを書き出す'),el('p',{class:'muted'},'写真を含むJSONファイルを保存します。iPhoneでは保存先を「ファイル」アプリで確認してください。'),el('p',{class:'muted'},state.lastBackup?`最終書き出し操作：${new Date(state.lastBackup).toLocaleString('ja-JP')}（ファイルの保存完了は保存先で確認）`:'まだバックアップを書き出していません。'),label('バックアップから復元',restore),el('p',{class:'muted'},'復元すると現在のデータを置き換えます。実行前に確認します。移行時、実行中の放鳥タイマーは引き継ぎません。')),card(el('h2',{},'iPhoneでアプリとして使う'),el('ol',{class:'help-list'},el('li',{},'Safariで公開URLを開きます。'),el('li',{},'共有メニューから「ホーム画面に追加」を選びます。「Webアプリとして開く」があればオンにします。'),el('li',{},'ホーム画面のアイコンから起動し、下のオフライン状態が「オフライン準備完了」になるまでオンラインで開きます。'),el('li',{},'その後、機内モードで起動し記録・再起動後の保存を確認してください。'))),card(el('h2',{},'保存とプライバシー'),el('ul',{class:'help-list'},el('li',{},'写真・プロフィール・健康・放鳥・体重・産卵などはこの端末のブラウザ内（IndexedDB）に保存します。アプリからサーバーやGitHubへ送信する機能はありません。'),el('li',{},'同じURLを別の人が開いても、それぞれ空のデータから始まります。同じ端末・同じブラウザを共用するとデータも共用されます。'),el('li',{},'Safariの閲覧画面とホーム画面アプリ、別のブラウザでは保存領域が異なる場合があります。継続利用はホーム画面アプリに統一してください。'),el('li',{},'Webサイトデータの削除、端末の故障・交換、容量不足やOSの整理で記録が失われる場合があります。プライベートブラウズを避け、週1回や大切な記録の後にバックアップしてください。'),el('li',{},'バックアップには愛鳥の写真と記録が含まれます。共有する場合は内容と保存先を確認してください。'),el('li',{},'公開サーバーにはアクセス時の通信情報が残る場合があります。広告・解析ツール・課金APIは使用しません。'),el('li',{},'初期イラストは本アプリ用のオリジナルです。実測でない体重やサンプル記録は入れていません。自分が利用する権利のある写真を選んでください。'))),el('div',{class:'notice'},'このアプリは日々の観察用です。健康状態の診断はしません。気になる変化は記録を持って、鳥を診られる獣医師に相談してください。')];}
function render(){route=location.hash.slice(1)||'home';const pages={home,records,calendar,album,settings};if(!pages[route])route='home';$('main').replaceChildren(...pages[route]().flat(Infinity).filter(node=>node!==null&&node!==undefined));for(const a of document.querySelectorAll('.bottom-nav a')){if(a.hash===`#${route}`)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}connection();}
function connection(){$('connection').textContent=navigator.onLine?'端末内に保存':'オフライン';}
async function refresh(){try {state=await readState();render();if($('detail-favorite'))updateDetailFavorite($('detail-favorite').dataset.photoId);void timerNotifications.sync(state.timer).then(refreshNativeTimerStatus);}catch(e){toast(errorMessage(e));}}
async function offlineSetup(){const status=$('offline-status');if(!('serviceWorker' in navigator)){status.textContent='このブラウザはオフライン非対応';return;}try {const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});let finished=false;const ready=async()=>{const keys=await caches.keys();if(keys.includes('kozakura-biyori-shell-v1.6.4')){status.textContent='オフライン準備完了';finished=true;}};await ready();reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='activated')ready();if(worker.state==='redundant'&&!finished)status.textContent='オフライン準備失敗・オンラインで再度開いてください';});});navigator.serviceWorker.addEventListener('controllerchange',ready);setTimeout(()=>{if(!finished)status.textContent='オフライン準備未完了・オンラインで再度開いてください';},20000);}catch(e){status.textContent='オフライン準備失敗・オンラインで再度開いてください';}}
async function init(){try {db=await openDB();await mutate(()=>{});state=await readState();render();offlineSetup();}catch(e){$('main').replaceChildren(...title('保存領域を開けませんでした','記録を保存できる環境で開き直してください。'),el('div',{class:'notice'},errorMessage(e)));}}

// v1.1 interface. Data stays in the v1 database; nothing is sent to a server.
let selectedDate=today(), chartDays=7, chartMetric='weight', weightTab='graph', albumTab='image', editingId=null, recordFilter='all';
const CARE=M.CARE, BEHAVIORS=M.BEHAVIORS;
function birdImage(appearance=state.settings.birdAppearance){return `./covers/${appearance}.svg`;}
function icon(name,cls='',appearance=state.settings.birdAppearance){
  const bird=name==='bird'||name.startsWith('pose-'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',bird?'0 0 120 110':'0 0 24 24');svg.setAttribute('class',`icon ${cls}`);svg.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');
  use.setAttribute('href',`./art.svg#${bird?`${appearance}-${name==='bird'?'pose-0':name}`:name}`);svg.append(use);return svg;
}
function go(page){location.hash=page;}
function heading(text,action=null){return el('div',{class:'page-title'},el('button',{class:'icon-button','aria-label':'ホームへ戻る',onclick:()=>go('home')},icon('back')),el('h1',{},icon('bird'),text),action||el('span',{class:'title-spacer'}));}
function sectionTitle(text,action){return el('div',{class:'section-title'},el('h2',{},text),action);}
function navLink(page,name,symbol){return el('a',{href:`#${page}`},icon(symbol),el('span',{},name));}
function tabs(items,active,onChange,cls='',name=''){return el('div',{class:`tabs ${cls}`,role:'group','aria-label':name||null},items.map(([value,text])=>el('button',{class:active===value?'active':'','aria-pressed':active===value,onclick:()=>{onChange(value);render();}},text)));}
function prettyDate(value,short=false){const d=new Date(`${value}T12:00:00`);return new Intl.DateTimeFormat('ja-JP',short?{month:'numeric',day:'numeric'}:{month:'long',day:'numeric',weekday:'short'}).format(d);}
function timeNow(){return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date());}
function recordTime(r){return r.time||new Date(r.createdAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
function sortedRecords(){return M.sorted(state.records);}
function describe(r){return M.summary(r);}
function validDate(s){return M.validDate(s);}
function validateBackup(raw){return M.validateBackup(raw);}
function dateSwitcher(value,onChange){const picker=input('selected-date','date',value,{required:true,min:'1900-01-01',max:'2100-12-31',onchange:e=>{if(validDate(e.target.value)){onChange(e.target.value);render();}}});picker.setAttribute('aria-label','表示する日');return el('div',{class:'date-switcher'},el('button',{class:'icon-button','aria-label':'前の日',onclick:()=>{const next=M.addDays(value,-1);if(validDate(next)){onChange(next);render();}}},icon('back')),el('strong',{},prettyDate(value)),el('button',{class:'icon-button','aria-label':'次の日',onclick:()=>{const next=M.addDays(value,1);if(validDate(next)){onChange(next);render();}}},icon('arrow')),el('label',{class:'date-picker-label'},icon('calendar'),picker));}
function recordList(records){if(!records.length)return empty('まだ記録がありません。小さな変化から残してみましょう。');return el('ul',{class:'record-list'},records.map(r=>el('li',{class:`record-item type-${r.type}`},el('span',{class:'record-icon'},icon(TYPES[r.type]?.[0]||'note')),el('div',{class:'record-body'},el('div',{class:'record-meta'},el('strong',{},TYPES[r.type]?.[1]||'記録'),el('time',{datetime:r.date},`${prettyDate(r.date,true)} ${recordTime(r)}`)),el('p',{},describe(r)),r.note&&r.type!=='note'?el('p',{class:'muted'},r.note):null),el('button',{class:'icon-button','aria-label':`${r.date}の${TYPES[r.type]?.[1]}記録を編集`,onclick:()=>recordForm(r.type,r)},icon('note')),el('button',{class:'delete','aria-label':`${r.date}の${TYPES[r.type]?.[1]}記録を削除`,onclick:async()=>{if(await askConfirm('この記録を削除しますか？'))await save(s=>s.records=s.records.filter(x=>x.id!==r.id),'記録を削除しました');}},'×'))));}
async function addRecord(type,data){if(recordWritePending)return false;recordWritePending=true;try{const old=editingId?state.records.find(r=>r.id===editingId):null;const record=M.validateRecord({id:old?.id||uid(),type,date:data.date,createdAt:old?.createdAt||new Date().toISOString(),...(old?.careSlot?{careSlot:old.careSlot}:{}),note:'',...data});if(await save(s=>{if(old){const index=s.records.findIndex(r=>r.id===old.id);if(index<0)throw Error('記録が見つかりません');s.records[index]=record;}else s.records.push(record);},old?'記録を更新しました':'記録しました')){editingId=null;closeDialog();if(!old&&(CARE.includes(type)||type==='behavior'))offerRecordUndo(record);return true;}}catch(e){toast(e.message);}finally{recordWritePending=false;}return false;}
function recordForm(type,old=null){editingId=old?.id||null;const controls=[dateField(old?.date||selectedDate),label('時刻',input('time','time',old?recordTime(old):timeNow(),{required:true}))];
  if(type==='weight'){
    const previous=el('p',{class:'weight-previous',id:'weight-previous'}),dateInput=controls[0].querySelector('input'),timeInput=controls[1].querySelector('input');
    const update=()=>{const boundary=dateInput.value+'T'+timeInput.value;const last=M.sorted(state.records.filter(r=>r.type==='weight'&&r.id!==old?.id&&(r.date+'T'+recordTime(r))<=boundary))[0];previous.textContent=last?`前回：${last.value} g ／ ${last.date.replaceAll('-','/')} ${recordTime(last)}`:'この日時より前の体重記録はありません。';};
    dateInput.addEventListener('change',update);timeInput.addEventListener('change',update);update();
    controls.push(previous,label('実測した体重（g）',input('value','number',old?.value??'',{required:true,min:.1,max:2000,step:.1,inputmode:'decimal',placeholder:'今回測った値を入力'})));
  }
  if(type==='health'){
    controls.push(el('p',{class:'notice'},'確認した項目を選んでください。未選択のまま正常として保存されません。3項目を確認してから保存します。'));
    for(const [key,text]of [['appetite','食欲'],['droppings','フン'],['activity','活動量']]){
      const choice=select(key,LEVEL,old?.[key]||'');
      choice.prepend(el('option',{value:'',disabled:true},'選んでください（未選択）'));choice.value=old?.[key]||'';choice.required=true;
      controls.push(label(text,choice));
    }
  }
  if(type==='flight')controls.push(label('放鳥時間（分）',input('minutes','number',old?.minutes??'',{required:true,min:.1,max:10080,step:.1})));
  if(type==='egg')controls.push(label('産んだ卵の数',input('count','number',old?.count??1,{required:true,min:1,max:100,step:1})),label('卵のようす',select('condition',['未確認','いつもどおり','気になる'],old?.condition||'未確認')));
  if(type==='behavior')controls.push(label('行動',select('behavior',[...new Set([...BEHAVIORS,'ごきげん','発情のようす','その他',old?.behavior].filter(Boolean))],old?.behavior||BEHAVIORS[0])));
  if(type==='visit')controls.push(label('病院名（任意）',input('clinic','text',old?.clinic||'',{maxlength:200})),label('受診内容（任意）',input('reason','text',old?.reason||'',{maxlength:200})));
  if(type==='estrus')controls.push(label('見られたようす',select('sign',['吐き戻し','巣探し','紙を運ぶ','交尾のようす','その他'],old?.sign||'吐き戻し')));
  const memo=el('textarea',{name:'note',maxlength:1000,placeholder:'気づいたこと、今日のようす…'},old?.note||'');controls.push(label(type==='note'?'メモ':'メモ（任意）',memo));if(type==='note')memo.required=true;
  formDialog(`${TYPES[type][1]}${old?'を編集':'の記録'}`,controls,async f=>{const data={date:f.get('date'),time:f.get('time'),note:f.get('note')||''};for(const key of ['value','minutes','count'])if(f.has(key))data[key]=Number(f.get(key));for(const key of ['appetite','droppings','activity','condition','behavior','clinic','reason','sign'])if(f.has(key))data[key]=f.get(key);if(type==='flight'&&old)for(const key of ['startedAt','endedAt'])if(old[key]!==undefined)data[key]=old[key];await addRecord(type,data);});}
function actionTile(type,titleText,subtitle='',target=null){return el('button',{class:`action-tile type-${type}`,'aria-label':titleText,onclick:()=>target?go(target):recordForm(type)},el('span',{class:'tile-icon'},icon(TYPES[type]?.[0]||type)),el('strong',{},titleText==='写真アルバム'?['写真',el('span',{},'アルバム')]:titleText),subtitle?el('small',{},subtitle):null);}
function todayHealth(){return M.day(state.records,today()).find(r=>r.type==='health');}
function healthStrip(){const health=todayHealth(),weight=sortedRecords().find(r=>r.type==='weight');return el('div',{class:'health-strip'},[['体重',weight?`${weight.value} g`:'—',weight?prettyDate(weight.date,true):'未記録','weight'],['食欲',health?.appetite||'—',health?'今日の記録・編集':'未記録','health'],['フン',health?.droppings||'—',health?'今日の記録・編集':'未記録','health'],['活動量',health?.activity||'—',health?'今日の記録・編集':'未記録','health']].map(([name,value,caption,type])=>el('button',{class:'health-cell',onclick:()=>{selectedDate=today();recordForm(type,type==='health'?todayHealth():null);}},el('small',{},name),el('strong',{},value),el('span',{},caption))));}
async function quickCareRecord(type,value,slot=null,button=null){
  const key=`${type}:${value}`;
  if(quickCareLocks.has(key)||value>today())return;
  quickCareLocks.add(key);if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  let added=null;
  try{
    const ok=await save(d=>{
      if(slot){const task=M.careTasks(d.settings.reminders,d.records,value).find(t=>t.type===type&&t.time===slot);if(!task||task.done)return;}
      else if(d.records.some(r=>r.type===type&&r.date===value))return;
      added=M.validateRecord({id:uid(),type,date:value,time:value===today()?timeNow():slot||timeNow(),note:slot?'お世話の予定から記録':'',createdAt:new Date().toISOString(),...(slot?{careSlot:slot}:{})});
      d.records.push(added);
    },null);
    if(ok){toast(added?'記録しました':'すでに記録済みです');if(added)offerRecordUndo(added);}
  }finally{quickCareLocks.delete(key);if(button&&button.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}}
}
function careChecklist(value=today(),types=CARE){
  const logs=M.day(state.records,value);
  return el('div',{class:'care-checks'},types.map(type=>{
    const records=logs.filter(r=>r.type===type),done=records.length>0;
    return el('div',{class:'care-row'},el('button',{class:`care-check type-${type} ${done?'done':''}`,disabled:done||value>today()?'':null,'aria-label':TYPES[type][1]+(done?'は実施済み':'を記録'),onclick:event=>quickCareRecord(type,value,null,event.currentTarget)},el('span',{class:'care-symbol'},icon(TYPES[type][0])),el('span',{},el('strong',{},TYPES[type][1]),el('small',{},done?`${recordTime(records[0])} 実施済み・${records.length}回`:'タップして記録')),el('span',{class:'checkmark'},done?icon('check'):'○')),done?el('button',{class:'text-button care-additional','aria-label':TYPES[type][1]+'をもう1回記録',onclick:()=>{selectedDate=value;recordForm(type);}},'＋ もう1回記録'):null);
  }));
}
function homeCover(p,preview=false){
  const cover=p.cover,join=p.joined?Math.floor((new Date(`${today()}T12:00:00`)-new Date(`${p.joined}T12:00:00`))/86400000)+1:null;
  const photo=el('img',{src:p.photo||birdImage(),alt:p.photo?'この端末で選んだ愛鳥の写真':'選んだインコのイラスト',class:'cover-bird',draggable:'false'});
  photo.style.objectPosition=`${cover.x}% ${cover.y}%`;
  photo.style.transformOrigin=`${cover.x}% ${cover.y}%`;
  photo.style.transform=`scale(${cover.zoom})`;
  const speech=cover.comment.trim()?el('div',{class:'speech'},el('span',{class:'cover-comment'},cover.comment),el('span',{'aria-hidden':'true'},icon('leaf'))):null;
  const hero=el('section',{class:`photo-hero cover-${cover.layout} ${p.photo?'has-photo':'illustrated'} ${preview?'cover-preview':''} ${cover.comment.length>10?'has-long-comment':''}`},photo,speech,el('div',{class:'profile-wave'},el('div',{},el(preview?'h2':'h1',{},p.name||'うちの子',el('span',{class:'sex'},p.sex==='メス'?' ♀':p.sex==='オス'?' ♂':'')),el('p',{},p.age||'プロフィールを設定しましょう'),join&&join>0?el('small',{},`一緒に過ごして ${join.toLocaleString()} 日`):null),preview?null:el('button',{class:'icon-button','aria-label':'プロフィールを編集',onclick:profileDialog},icon('note'))));

  if(preview){
    const shell=document.querySelector('.app-shell'),padding=getComputedStyle(shell);
    const width=shell.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight)+4;
    const height=cover.layout==='wide'?220:cover.layout==='portrait'?380:matchMedia('(min-width:600px)').matches?320:matchMedia('(max-width:360px)').matches?250:280;
    hero.style.aspectRatio=`${width} / ${height}`;
    hero.style.height='auto';
  }
  return hero;
}
function home(){const p=state.profile;return [el('div',{class:'section-title home-appearance'},el('div',{class:'home-date'},prettyDate(today())),el('button',{class:'text-button',onclick:()=>go('appearance')},icon('bird'),'イラスト変更')),homeCover(p),el('section',{class:'health-section'},sectionTitle('今日の健康チェック',el('button',{class:'text-button',onclick:()=>{selectedDate=today();recordForm('health',todayHealth());}},todayHealth()?'今日の記録を編集':'記録する')),healthStrip()),el('button',{class:'flight-start',onclick:()=>go('timer')},icon('bird'),state.timer?'放鳥タイマーへ':'放鳥スタート'),el('div',{class:'quick-grid'},actionTile('weight','体重記録','','weight'),actionTile('behavior','行動記録','','behavior'),actionTile('camera','写真アルバム','','album'),actionTile('calendar','カレンダー','お世話の記録','calendar')),careScheduleCard(),card(sectionTitle('最近の記録',el('a',{href:'#records'},'すべて →')),recordList(sortedRecords().slice(0,4)))];}
async function timerAction(action){if(timerActionPending)return;timerActionPending=true;try{await action();}finally{timerActionPending=false;}}
async function toggleTimer(){await timerAction(performTimerToggle);}
async function cancelTimer(){await timerAction(async()=>{
  const timer=state.timer;if(!timer)return;
  if(!await askConfirm(`タイマーを取り消しますか？ 記録には残りません。${timer.durationSeconds?' カレンダーに追加した終了予定も、カレンダー側で削除してください。':''}`))return;
  await save(d=>{if(d.timer?.startedAt!==timer.startedAt)throw new UserMessageError('タイマーが別の画面で変更されました。');d.timer=null;},'取り消しました');
});}
async function performTimerToggle(){if(state.timer){const target=state.timer.startedAt;if(!await askConfirm(`放鳥を終了して、経過時間を記録しますか？${state.timer?.durationSeconds&&!timerFinished()?' カレンダーに追加した終了予定も、カレンダー側で削除してください。':''}`))return;await save(s=>{if(!s.timer||s.timer.startedAt!==target)throw new UserMessageError('タイマーが別の画面で変更されました。現在の状態を確認してください。');const start=s.timer,endedAt=Date.now(),minutes=Math.max(.1,Math.round((endedAt-start.startedAt)/6000)/10);if(minutes>10080)throw Error('上限：7日を超える放鳥は取り消して手入力してください。');s.records.push({id:uid(),type:'flight',date:start.date,time:new Date(start.startedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),startedAt:start.startedAt,endedAt,minutes,note:'放鳥タイマーから記録'});s.timer=null;},'放鳥を記録しました');}else {
  const minutes=$('timer-minutes');
  if(timerMode==='countdown'&&(!minutes||!minutes.reportValidity()))return;
  const durationSeconds=timerMode==='countdown'?Number(minutes.value)*60:null;
  if(durationSeconds)prepareTimerAudio().then(refreshTimerAudioStatus);
  if(durationSeconds&&timerNotifications.available)await timerNotifications.requestPermission();
  await save(s=>{if(s.timer)throw new UserMessageError('別の画面でタイマーが開始されています。');s.timer={startedAt:Date.now(),date:today(),...(durationSeconds?{durationSeconds}:{})};},'放鳥をはじめました');
}}
function timerPage(){const records=M.day(state.records,today()).filter(r=>r.type==='flight'),sum=Math.round(records.reduce((s,r)=>s+r.minutes,0)*10)/10;return [heading('放鳥タイマー',el('button',{class:'icon-button','aria-label':'放鳥の履歴',onclick:()=>{recordFilter='flight';go('records');}},icon('clock'))),state.timer?null:timerControls(),el('section',{id:'timer-scene',class:`timer-scene ${state.timer?'running':''} ${timerFinished()?'finished':''}`},el('div',{class:'timer-ring'},el('span',{class:'timer-status',id:'timer-status'},timerStatus()),el('div',{class:'timer-display',id:'timer-display'},timerText()),el('small',{},state.timer?`開始 ${new Date(state.timer.startedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`:'準備ができたらスタート'),el('img',{src:state.profile.photo||birdImage(),alt:'愛鳥',class:'timer-bird'}))),el('p',{class:'timer-timing',id:'timer-elapsed'},''),el('p',{class:'notice',id:'timer-complete',role:'status',hidden:timerFinished()?null:''},'設定時間になりました。愛鳥を確認し、放鳥を終えたら「放鳥を終了」を押してください。実際に終了した時点までの時間を記録します。'),el('button',{class:'flight-start',onclick:toggleTimer},icon('bird'),state.timer?'放鳥を終了':'放鳥をはじめる'),state.timer?el('button',{class:'ghost wide',onclick:cancelTimer},'記録せず取り消す'):el('button',{class:'text-button wide',onclick:()=>{selectedDate=today();recordForm('flight');}},'時間を手入力する'),timerNotificationControls(),card(el('h2',{},'今日の放鳥記録'),records.length?el('div',{class:'flight-history'},records.slice().reverse().map((r,i)=>el('div',{},el('span',{},`${i+1}回目`),el('span',{},r.startedAt?`${recordTime(r)} – ${new Date(r.endedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`:recordTime(r)),el('strong',{},`${r.minutes}分`))),el('div',{class:'flight-total'},el('strong',{},'合計'),el('strong',{},`${sum}分`))):empty('今日の放鳥記録はまだありません。')),card(sectionTitle('メモ',el('button',{class:'icon-button','aria-label':'放鳥メモを記録',onclick:()=>{selectedDate=today();recordForm('note');}},icon('note'))),el('p',{class:'muted'},'アプリを閉じていた時間も含めて計測し、開き直すと残り時間を更新します。カウントダウンが0になっても自動では記録を終了しません。画面を閉じる場合のお知らせは、上のカレンダー追加かiPhone標準のタイマーを使ってください。時刻を変更した場合や終了忘れは手入力で修正してください。'))];}
function rangeTabs(){return tabs([[7,'7日'],[30,'30日'],[90,'3か月'],[365,'1年']],chartDays,v=>chartDays=v,'period-tabs');}
function lineChart(metric=chartMetric){const data=M.chartData(state.records,metric,chartDays);if(!data.length)return empty('この期間の記録がありません。実際のようすを記録すると表示されます。', '❀');const isHealth=['appetite','droppings','activity'].includes(metric),numeric=data.filter(x=>x.value!==null),vals=numeric.map(r=>r.value);const low=isHealth?1:Math.min(...vals)-Math.max(1,(Math.max(...vals)-Math.min(...vals))*.2),high=isHealth?3:Math.max(...vals)+Math.max(1,(Math.max(...vals)-Math.min(...vals))*.2),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 430 210');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${metric==='weight'?'体重':metric==='flight'?'放鳥時間':{appetite:'食欲',droppings:'フン',activity:'活動量'}[metric]}のグラフ ${data.length}日分`);svg.classList.add('chart');const from=M.addDays(today(),1-chartDays),span=Math.max(1,chartDays-1),x=d=>42+(new Date(`${d}T12:00:00`)-new Date(`${from}T12:00:00`))/86400000/span*370,y=v=>175-(v-low)/Math.max(.1,high-low)*150;function shape(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;}for(let i=0;i<(isHealth?3:5);i++){const v=low+(high-low)*i/(isHealth?2:4);shape('line',{x1:42,y1:y(v),x2:412,y2:y(v),stroke:'#e7e8db'});shape('text',{x:2,y:y(v)+4,fill:'#7c8574','font-size':isHealth?9:11},isHealth?['少なめ','いつも通り','多め'][i]:v.toFixed(1));}let segment=[];const flush=()=>{if(segment.length)shape('polyline',{points:segment.join(' '),fill:'none',stroke:metric==='flight'?'#86a57b':'#df8e8f','stroke-width':3});segment=[];};for(const d of data){if(d.value===null){flush();shape('text',{x:x(d.date),y:201,fill:'#bf856d','font-size':12,'text-anchor':'middle'},'!');continue;}segment.push(`${x(d.date)},${y(d.value)}`);}flush();for(const d of numeric){const circle=shape('circle',{cx:x(d.date),cy:y(d.value),r:4,fill:'#fff9ed',stroke:metric==='flight'?'#86a57b':'#df8e8f','stroke-width':2});const tip=document.createElementNS(ns,'title');tip.textContent=`${d.date} ${d.value}${metric==='weight'?'g':metric==='flight'?'分':''}`;circle.append(tip);}return [svg,el('div',{class:'chart-labels'},el('span',{},prettyDate(from,true)),el('span',{},prettyDate(today(),true))),el('p',{class:'muted'},isHealth?'少なめ・いつもどおり・多めを表示。「気になる」は ! で示します。空白の日を補完せず、記録点を結んでいます。':'同じ日の体重は最後の記録、放鳥は合計時間を表示します。空白の日を補完せず記録点を結びます。')];}
function openWeightForm(){selectedDate=today();recordForm('weight');}
function weightPage(){const all=sortedRecords().filter(r=>r.type==='weight'),last=all[0];return [heading('体重の記録',el('button',{class:'icon-button','aria-label':'体重を追加',onclick:openWeightForm},'+')),el('section',{class:'latest-weight'},icon('scale'),el('div',{},el('small',{},'最新の体重'),el('strong',{},last?last.value:'—',el('small',{},' g')),el('span',{},last?`${last.date.replaceAll('-','/')} ${recordTime(last)}`:'測った値を記録しましょう')),el('img',{src:state.profile.photo||birdImage(),alt:'愛鳥'})),el('button',{class:'primary wide',onclick:openWeightForm},'体重を記録する'),tabs([['graph','グラフ'],['list','一覧'],['memo','メモ']],weightTab,v=>weightTab=v,'weight-tabs','体重の表示方法'),rangeTabs(),weightTab==='graph'?card(lineChart('weight')):null,card(el('h2',{},weightTab==='memo'?'体重のメモ':'体重の記録'),recordList(M.period(all,chartDays).filter(r=>weightTab!=='memo'||r.note).slice(0,40)))];}

function moveBehavior(index,direction){
  const target=index+direction;
  if(!behaviorOrderDraft||target<0||target>=behaviorOrderDraft.length)return;
  [behaviorOrderDraft[index],behaviorOrderDraft[target]]=[behaviorOrderDraft[target],behaviorOrderDraft[index]];
  render();
  const button=document.querySelector(`[data-order-index="${target}"][data-direction="${direction}"]:not(:disabled)`)||document.querySelector(`[data-order-index="${target}"]:not(:disabled)`);
  if(button){button.focus({preventScroll:true});button.scrollIntoView({block:'nearest'});}
}
function behaviorOrderPage(){
  return [heading('行動の並べ替え'),el('p',{class:'intro'},'よく使う行動を上に移動できます。「順番を保存」で確定します。'),el('ol',{class:'behavior-order-list'},behaviorOrderDraft.map((name,index)=>el('li',{},el('span',{class:'order-number'},index+1),icon(`pose-${BEHAVIORS.indexOf(name)}`),el('strong',{},name),el('div',{class:'order-buttons'},[-1,1].map(direction=>el('button',{class:'ghost','aria-label':`${name}を${direction<0?'上':'下'}へ`,'data-order-index':index,'data-direction':direction,disabled:(index+direction<0||index+direction>=behaviorOrderDraft.length)?'':null,onclick:()=>moveBehavior(index,direction)},direction<0?'↑':'↓')))))),el('div',{class:'order-actions'},el('button',{class:'primary wide',onclick:async()=>{const order=[...behaviorOrderDraft];if(await save(s=>s.settings.behaviorOrder=order,'並び順を保存しました')){behaviorOrderDraft=null;render();}}},'順番を保存'),el('button',{class:'ghost wide',onclick:()=>{behaviorOrderDraft=null;render();}},'変更を取り消す'),el('button',{class:'text-button wide',onclick:()=>{behaviorOrderDraft=[...M.DEFAULT_BEHAVIOR_ORDER];render();}},'元の順番に戻す'))];
}
function openChewedAlbum(){albumTab='chewed';go('album');}
function chewedAlbumEntry(){
  const count=state.photos.filter(photo=>photo.category==='chewed').length;
  return card(sectionTitle('かじり跡アルバム',el('button',{class:'text-button',onclick:openChewedAlbum},'アルバムを見る')),el('p',{class:'muted'},`教科書や紙、思いがけないかじり跡も写真で残せます。保存した写真 ${count}枚。`),el('button',{class:'ghost wide',onclick:chewedRecordDialog},icon('camera'),'かじった物を写真で残す'));
}
function chewedRecordDialog(){
  let photoData=null;
  const preview=el('img',{class:'chewed-preview',alt:'選択したかじり跡の写真',hidden:''});
  const chooser=photoChooser(async data=>{photoData=data;preview.src=data;preview.hidden=false;});
  const memo=el('textarea',{name:'caption',maxlength:200,rows:3,placeholder:'どこをかじった？ そのときのようすなど…'});
  const form=el('form',{},dateField(selectedDate),label('かじった物',input('subject','text','',{required:true,maxlength:80,placeholder:'例：教科書、紙、ティッシュ箱'})),label('かじり跡の写真',chooser),preview,label('メモ（任意）',memo),el('p',{class:'muted'},'写真はこの端末内で縮小して保存します。通常のアルバムと同じ保存枠を使い、外部送信しません。'),el('button',{type:'submit',class:'primary wide'},'かじり跡を保存'));
  submitForm(form,async f=>{
    if(chooser.disabled){toast('写真の読み込みが終わるまでお待ちください');return;}
    if(!photoData){toast('かじり跡の写真を1枚選んでください');return;}
    const subject=f.get('subject').trim();if(!subject){toast('かじった物を入力してください');return;}
    const photo={id:uid(),date:f.get('date'),data:photoData,kind:'image',favorite:false,caption:f.get('caption')||'',category:'chewed',subject};
    if(await save(s=>{if(s.photos.length>=100)throw Error('上限：アルバムは100件までです。');s.photos.push(photo);},'かじり跡を保存しました'))closeDialog();
  });
  showDialog(el('h2',{},'かじり跡を写真で記録'),form);
}
function behaviorPage(){
  if(behaviorOrderDraft)return behaviorOrderPage();
  const history=M.day(state.records,selectedDate).filter(r=>r.type==='behavior');
  return [heading('行動の記録',el('button',{class:'text-button',onclick:()=>{behaviorOrderDraft=[...state.settings.behaviorOrder];render();}},'並べ替え')),dateSwitcher(selectedDate,v=>selectedDate=v),el('button',{class:'text-button wide',onclick:()=>go('appearance')},icon('bird'),'イラスト変更'),el('div',{class:'behavior-grid'},state.settings.behaviorOrder.map(name=>{
    const i=BEHAVIORS.indexOf(name),count=history.filter(r=>r.behavior===name).length;
    return el('button',{class:`behavior-tile behavior-${i} ${count?'recorded':''}`,'aria-label':`${name}を記録`,onclick:async()=>{editingId=null;await addRecord('behavior',{date:selectedDate,time:timeNow(),note:'',behavior:name});}},icon(`pose-${i}`),el('strong',{},name==='くちばしギョリギョリ'?['くちばし',el('br'),'ギョリギョリ']:name),el('span',{class:'behavior-count'},count?`記録済み ${count}回`:'未記録'));
  })),chewedAlbumEntry(),card(sectionTitle('今日のメモ',el('button',{class:'icon-button','aria-label':'行動のメモを追加',onclick:()=>recordForm('note')},icon('note'))),recordList(M.day(state.records,selectedDate).filter(r=>r.type==='note').slice(0,3))),card(el('h2',{},'最近の記録'),recordList(history.slice(0,20)))];
}
function appearancePage(){
  let draft=state.settings.birdAppearance;
  const preview=el('div',{class:'appearance-preview'},icon('pose-0','',draft));
  const form=el('form',{},el('p',{class:'intro'},'うちの子に近い種類や、お気に入りの色を選んでください。変更するのはイラストの見た目です。愛鳥を切り替える操作ではありません。'),preview,['lovebird','button'].map(species=>el('fieldset',{class:'appearance-group'},el('legend',{},species==='lovebird'?'コザクラインコ':'ボタンインコ'),el('div',{class:'appearance-grid'},M.BIRD_APPEARANCES.filter(bird=>bird.species===species).map(bird=>{
    const radio=input('bird-appearance','radio',bird.id,{onchange:()=>{draft=bird.id;preview.replaceChildren(icon('pose-0','',draft));},'aria-label':`${bird.label}・${bird.color}`});radio.checked=draft===bird.id;
    return el('label',{class:'bird-choice'},radio,icon('pose-0','',bird.id),el('span',{},bird.color));
  })))),el('p',{class:'muted'},'ホーム画面の鳥アイコン、行動のイラスト、写真未設定時の表紙・タイマーに反映します。設定済みの写真は引き継ぎます。色はイラストの配色です。'),el('button',{type:'submit',class:'primary wide'},'イラストを保存'),el('p',{class:'muted'},'iPhoneなどのホーム画面に追加するアプリアイコンは、コザクラとボタンの2羽が並ぶ共通デザインです。ここで選ぶイラストとは別になります。'));
  submitForm(form,async()=>{await save(s=>s.settings.birdAppearance=draft,'インコのイラストを保存しました');});
  return [heading('イラスト変更'),form];
}
function carePage(){return [heading('お世話チェックリスト'),dateSwitcher(selectedDate,v=>selectedDate=v),card(el('h2',{},'お世話をしたらタップ'),careChecklist(selectedDate),el('p',{class:'muted'},'実施時刻と回数を記録します。詳しいメモや過去の日付は下のボタンから。')),el('div',{class:'quick-grid three'},CARE.map(type=>actionTile(type,TYPES[type][1],'メモを付けて記録'))),card(el('h2',{},'この日のお世話'),recordList(M.day(state.records,selectedDate).filter(r=>CARE.includes(r.type)))),el('button',{class:'ghost wide',onclick:()=>go('reminders')},icon('bell'),'お世話の通知を設定')];}
function records(){const all=sortedRecords().filter(r=>recordFilter==='all'||r.type===recordFilter);const filter=select('record-type',['all',...Object.keys(TYPES)],recordFilter);filter.replaceChildren(el('option',{value:'all'},'すべての記録'),...Object.entries(TYPES).map(([value,[,name]])=>el('option',{value},name)));filter.value=recordFilter;filter.addEventListener('change',e=>{recordFilter=e.target.value;recordPage=0;render();});return [heading('記録'),el('div',{class:'record-menu'},Object.entries(TYPES).map(([type,[symbol,name]])=>el('button',{class:`record-menu-item type-${type}`,onclick:()=>type==='behavior'?go('behavior'):recordForm(type)},icon(symbol),el('span',{},name),icon('arrow')))),card(label('表示する記録',filter),recordList(all.slice(recordPage*30,(recordPage+1)*30)),el('div',{class:'pagination'},recordPage>0?el('button',{class:'ghost',onclick:()=>{recordPage--;render();}},'前へ'):null,(recordPage+1)*30<all.length?el('button',{class:'ghost',onclick:()=>{recordPage++;render();}},'次へ'):null))];}
function calendarRecordMenu(value){
  showDialog(el('h2',{},prettyDate(value)+'の記録を追加'),el('div',{class:'record-menu'},Object.entries(TYPES).map(([type,[symbol,name]])=>el('button',{class:`record-menu-item type-${type}`,onclick:()=>{closeDialog();selectedDate=value;if(type==='behavior')go('behavior');else recordForm(type);}},icon(symbol),name))));
}
function calendar(){
  const [year,month]=calendarDate.split('-').map(Number),first=new Date(year,month-1,1).getDay(),days=new Date(year,month,0).getDate();
  const monthTypes=new Set(),grid=el('div',{class:'calendar-grid'},['日','月','火','水','木','金','土'].map((day,i)=>el('span',{class:`weekday day-${i}`},day)));
  for(let i=0;i<first;i++)grid.append(el('span'));
  for(let d=1;d<=days;d++){
    const value=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,logs=M.day(state.records,value),kinds=[...new Set(logs.map(r=>r.type))];
    kinds.forEach(type=>monthTypes.add(type));
    grid.append(el('button',{class:`calendar-day ${value===calendarDate?'selected ':''}${value===today()?'today ':''}${logs.length?'has-record':''}`,'aria-label':`${value}${value===today()?' 今日':''}${logs.length?` 記録${logs.length}件`:''}`,'aria-pressed':value===calendarDate,'aria-current':value===today()?'date':null,onclick:()=>{calendarDate=value;selectedDate=value;render();}},el('span',{class:'day-number'},d),value===calendarDate?el('span',{class:'selected-date-mark','aria-hidden':'true'},'✓'):null,el('span',{class:'date-dots','aria-hidden':'true'},kinds.slice(0,4).map(type=>el('i',{class:`dot type-${type}`}))),el('span',{class:'day-record-count','aria-hidden':'true'},logs.length?(logs.length>99?'99+件':`${logs.length}件`):'')));
  }
  const move=n=>{const next=M.date(new Date(year,month-1+n,1));if(validDate(next)){calendarDate=next;selectedDate=next;render();}};
  const logs=M.day(state.records,calendarDate);
  return [heading('カレンダー'),el('div',{class:'month-switch'},el('button',{class:'icon-button','aria-label':'前の月',onclick:()=>move(-1)},icon('back')),el('strong',{},`${year}年${month}月`),el('button',{class:'icon-button','aria-label':'次の月',onclick:()=>move(1)},icon('arrow'))),el('div',{class:'calendar-key'},el('span',{},'今日：囲み ／ 選択中：✓'),el('button',{class:'text-button',onclick:()=>{calendarDate=today();selectedDate=today();render();}},'今日へ戻る')),grid,el('p',{class:'muted calendar-count-help'},'件数がある日をタップすると記録を確認できます。'),monthTypes.size?el('div',{class:'calendar-legend'},Object.entries(TYPES).filter(([type])=>monthTypes.has(type)).map(([type,[,name]])=>el('span',{},el('i',{class:`dot type-${type}`}),name))):null,card(sectionTitle(prettyDate(calendarDate),el('button',{class:'text-button',onclick:()=>calendarRecordMenu(calendarDate)},'記録を追加')),el('p',{class:'muted'},`${logs.length}件の記録`),recordList(logs)),card(el('h2',{},'この日のお世話'),careChecklist(calendarDate))];
}

function healthPage(){const metricNames={weight:'体重',flight:'放鳥',appetite:'食欲',droppings:'フン',activity:'活動量'};const data=M.chartData(state.records,chartMetric,chartDays),numeric=data.filter(p=>p.value!==null),last=numeric.at(-1),first=numeric[0];let caption='この期間の記録がまだありません。';if(last&&['weight','flight'].includes(chartMetric)){const difference=Math.round((last.value-first.value)*10)/10;caption=`${numeric.length}日分の記録。最新は ${last.value}${chartMetric==='weight'?'g':'分'}。${numeric.length>1?`期間内の最初の値から ${difference>0?'+':''}${difference}${chartMetric==='weight'?'g':'分'}です。`:''}`;}else if(data.length)caption=`${data.length}日分の観察記録。「気になる」の記録が ${data.filter(p=>p.value===null).length}日あります。`;return [heading('健康グラフ'),tabs(Object.entries(metricNames),chartMetric,v=>chartMetric=v,'metric-tabs'),rangeTabs(),card(lineChart()),card(el('h2',{},'記録の振り返り'),el('p',{},caption),el('p',{class:'muted'},'入力した記録の要約です。健康状態や適正体重を判定するものではありません。')),el('div',{class:'row'},el('button',{class:'ghost',onclick:()=>recordForm('health')},'健康を記録'),el('button',{class:'ghost',onclick:()=>go('weight')},'体重の記録へ'))];}
async function addMedia(data,kind){if(state.photos.length>=100){toast('アルバムは100件までです。');return false;}return await save(d=>{if(d.photos.length>=100)throw Error('上限：アルバムは100件までです。');d.photos.push({id:uid(),date:today(),data,kind,favorite:false,caption:''});},kind==='video'?'動画を端末に保存しました':'写真を端末に保存しました');}
function mediaChooser(){
  const chooser=input('media','file','',{accept:'image/*,video/mp4,video/webm,video/quicktime',onchange:async event=>{
    const file=event.target.files[0];if(!file)return;event.target.disabled=true;
    try{
      let data,kind;
      if(file.type.startsWith('image/')){data=await normalizePhoto(file);kind='image';}
      else if(['video/mp4','video/webm','video/quicktime'].includes(file.type)){
        if(file.size>8*1024*1024)throw Error('動画は8MB以下の短い動画を選んでください。写真アプリで短く切り出せます。');
        data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('動画を読み込めません'));reader.readAsDataURL(file);});kind='video';
      }else throw Error('対応する写真またはMP4・MOV・WebM動画を選んでください。');
      if(await addMedia(data,kind)){if(route==='album'){albumTab=kind;render();}}
    }catch(error){toast(error.message);}finally{event.target.disabled=false;event.target.value='';}
  }});chooser.removeAttribute('value');return chooser;
}

function photoDetails(p){
  const chewed=p.category==='chewed',media=p.kind==='video'?el('video',{src:p.data,controls:true,playsinline:true,preload:'metadata',class:'detail-media'}):el('img',{src:p.data,alt:p.subject||p.caption||'愛鳥の写真',class:'detail-media'});
  const category=input('chewed','checkbox','yes');category.checked=chewed;
  const subject=input('subject','text',p.subject||'',{maxlength:80,required:chewed?'':null,placeholder:'例：教科書、紙、ティッシュ箱'}),subjectBlock=label('かじった物',subject);subjectBlock.hidden=!chewed;
  category.addEventListener('change',()=>{subjectBlock.hidden=!category.checked;subject.required=category.checked;});
  const caption=el('textarea',{name:'caption',maxlength:200,rows:3},p.caption||'');
  const form=el('form',{},dateField(p.date),p.kind==='image'?label('かじり跡アルバムに入れる',category):null,subjectBlock,label('ひとこと・メモ（任意）',caption),el('button',{type:'submit'},'アルバムの情報を保存'));
  submitForm(form,async f=>{
    const name=f.get('subject')?.trim()||'';
    if(category.checked&&!name){toast('かじった物を入力してください');return;}
    if(await save(s=>{const target=s.photos.find(x=>x.id===p.id);if(!target)throw Error('写真が見つかりません');target.date=f.get('date');target.caption=f.get('caption');if(p.kind==='image')Object.assign(target,{category:category.checked?'chewed':'general',subject:name});}))closeDialog();
  });
  showDialog(el('h2',{},chewed?'かじり跡の記録':p.kind==='video'?'動画の思い出':'写真の思い出'),media,el('p',{class:'muted'},`${p.kind==='video'?'動画':'写真'} · ${prettyDate(p.date)}${chewed?' · かじり跡':''}`),el('button',{id:'detail-favorite','data-photo-id':p.id,class:'ghost wide','aria-pressed':p.favorite,onclick:event=>togglePhotoFavorite(p.id,event.currentTarget)},icon('heart'),p.favorite?'お気に入りを解除':'お気に入りにする'),p.kind==='image'&&!chewed?el('button',{class:'ghost wide',onclick:async()=>{if(await save(s=>s.profile.photo=p.data,'ホームの写真に設定しました'))closeDialog();}},'ホームの写真にする'):null,form,el('button',{class:'danger wide',onclick:async()=>{if(await askConfirm('この写真・動画をアルバムから削除しますか？ ホームの写真は残ります。'))if(await save(s=>s.photos=s.photos.filter(x=>x.id!==p.id),'削除しました'))closeDialog();}},'アルバムから削除'));
}
function mediaAddControl(){
  const chooser=mediaChooser();
  return el('div',{},el('label',{class:'media-add-control'},icon('camera'),'写真・動画を追加',chooser),el('p',{class:'muted'},`写真・動画 ${state.photos.length}/100件。写真は縮小保存、動画は8MB以下。端末内に保存します。`));
}
function updateDetailFavorite(id){
  const button=$('detail-favorite'),photo=state.photos.find(p=>p.id===id);
  if(button?.dataset.photoId!==id||!photo)return;
  button.setAttribute('aria-pressed',String(photo.favorite));button.replaceChildren(icon('heart'),photo.favorite?'お気に入りを解除':'お気に入りにする');
}
async function togglePhotoFavorite(id,button){
  if(favoriteLocks.has(id))return;favoriteLocks.add(id);if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  let favorite;
  try{if(await save(d=>{const photo=d.photos.find(p=>p.id===id);if(!photo)throw new UserMessageError('写真・動画が見つかりません。');favorite=photo.favorite=!photo.favorite;},null)){toast(favorite?'お気に入りにしました':'お気に入りを解除しました');updateDetailFavorite(id);}}
  finally{favoriteLocks.delete(id);if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}}
}
function album(){
  const chewed=albumTab==='chewed';
  const media=[...state.photos].filter(p=>chewed?p.category==='chewed':albumTab==='favorite'?p.favorite:albumTab==='image'?p.kind==='image'&&p.category!=='chewed':p.kind==='video').sort((a,b)=>b.date.localeCompare(a.date)),groups=new Map();
  for(const p of media){const month=p.date.slice(0,7);if(!groups.has(month))groups.set(month,[]);groups.get(month).push(p);}
  const chewedCount=state.photos.filter(p=>p.category==='chewed').length;
  return [heading(chewed?'かじり跡アルバム':'アルバム'),tabs([['image','写真'],['video','動画'],['favorite','お気に入り'],['chewed','かじり跡']],albumTab,v=>albumTab=v,'','アルバムの種類'),chewed?card(el('p',{},'かじった物の写真とメモを、ひとつのアルバムに。'),el('button',{class:'primary wide',onclick:chewedRecordDialog},icon('camera'),'かじった物を写真で残す'),el('p',{class:'muted'},'通常の写真も詳細画面から分類できます。写真を複製せずにまとめます。')):card(mediaAddControl(),albumTab==='image'?el('p',{class:'muted'},'かじり跡の写真は「かじり跡」にまとめています。'):null,albumTab==='image'&&chewedCount?el('button',{class:'text-button',onclick:()=>{albumTab='chewed';render();}},`かじり跡 ${chewedCount}件を見る →`):null),el('p',{class:'album-result-count',role:'status'},`${{image:'写真',video:'動画',favorite:'お気に入り',chewed:'かじり跡'}[albumTab]} ${media.length}件`),media.length?[...groups].map(([month,items])=>el('section',{class:'album-month'},el('h2',{},`${Number(month.slice(0,4))}年${Number(month.slice(5))}月`),el('div',{class:'album-grid'},items.map(p=>el('figure',{class:'photo-card'},el('button',{class:'photo-open','aria-label':p.category==='chewed'?`${p.date}のかじり跡「${p.subject}」を開く`:`${p.date}の${p.kind==='video'?'動画':'写真'}を開く`,onclick:()=>photoDetails(p)},p.kind==='video'?el('video',{src:p.data,preload:'metadata',playsinline:true,'aria-label':'動画のプレビュー'}):el('img',{src:p.data,alt:p.subject||p.caption||'愛鳥の写真',loading:'lazy'}),p.kind==='video'?el('span',{class:'video-mark'},icon('play'),'動画'):null),el('button',{class:`favorite-button ${p.favorite?'active':''}`,'aria-label':p.favorite?'お気に入りを解除':'お気に入りにする','aria-pressed':p.favorite,onclick:event=>togglePhotoFavorite(p.id,event.currentTarget)},icon('heart'),p.favorite?el('span',{class:'favorite-check','aria-hidden':'true'},'✓'):null),el('figcaption',{},p.category==='chewed'?[el('strong',{},p.subject),el('small',{},'かじり跡 · '+prettyDate(p.date,true))]:p.caption||prettyDate(p.date,true))))))):card(empty(chewed?'まだかじり跡の写真がありません。「かじった物を写真で残す」から記録できます。':albumTab==='favorite'?'お気に入りにした写真・動画がここに並びます。':'上の「写真・動画を追加」から、思い出を残しましょう。'))];
}

function profileDialog(){
  const draft=structuredClone(state.profile);
  const preview=homeCover(draft,true);
  const refreshPreview=()=>{const next=homeCover(draft,true);preview.className=next.className;preview.style.aspectRatio=next.style.aspectRatio;preview.style.height=next.style.height;preview.replaceChildren(...next.childNodes);};
  let dragging=null;
  preview.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    dragging={id:event.pointerId,x:event.clientX,y:event.clientY,startX:draft.cover.x,startY:draft.cover.y};
    preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener('pointermove',event=>{
    if(!dragging||dragging.id!==event.pointerId)return;
    const box=preview.getBoundingClientRect();
    for(const [key,delta,size] of [['x',event.clientX-dragging.x,box.width],['y',event.clientY-dragging.y,box.height]]){
      const range=form.elements.namedItem(`cover-${key}`);
      range.value=Math.round(Math.max(0,Math.min(100,dragging[key==='x'?'startX':'startY']-delta/size*100)));
      range.dispatchEvent(new Event('input'));
    }
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])preview.addEventListener(type,()=>dragging=null);
  const layout=el('fieldset',{class:'cover-layout'},el('legend',{},'写真のレイアウト'),[['standard','いつもの形'],['wide','横長・コンパクト'],['portrait','縦長・大きめ']].map(([value,text])=>{
    const radio=input('cover-layout','radio',value,{onchange:()=>{draft.cover.layout=value;refreshPreview();}});
    radio.checked=draft.cover.layout===value;
    return el('label',{},radio,text);
  }));
  const sliders=[['zoom','拡大率',1,3,.05],['x','写真の左右の位置',0,100,1],['y','写真の上下の位置',0,100,1]].map(([key,text,min,max,step])=>{
    const output=el('output',{},key==='zoom'?`${draft.cover[key].toFixed(2)}倍`:`${draft.cover[key]}%`);
    const range=input(`cover-${key}`,'range',draft.cover[key],{min,max,step,oninput:e=>{draft.cover[key]=Number(e.target.value);output.textContent=key==='zoom'?`${draft.cover[key].toFixed(2)}倍`:`${draft.cover[key]}%`;refreshPreview();}});
    return el('div',{class:'cover-slider'},label(text,range),output);
  });
  const comment=el('textarea',{name:'cover-comment',maxlength:40,rows:2,placeholder:'例：今日も元気にあそぼうね',oninput:e=>{draft.cover.comment=e.target.value;refreshPreview();}},draft.cover.comment);
  const chooser=photoChooser(async data=>{draft.photo=data;draft.cover.x=50;draft.cover.y=42;draft.cover.zoom=1;for(const key of ['zoom','x','y']){const range=form.elements.namedItem(`cover-${key}`);range.value=draft.cover[key];range.dispatchEvent(new Event('input'));}refreshPreview();});
  const remove=el('button',{type:'button',class:'danger wide',onclick:async()=>{if(await askConfirm('ホームの写真を削除しますか？ アルバムの写真は残ります。保存するまでは変更を取り消せます。')){draft.photo=null;refreshPreview();}}},'ホームの写真を削除');
  const form=el('form',{},el('p',{class:'muted'},'写真の範囲や言葉を調整し、最後に「プロフィールを保存」を押してください。閉じると変更を取り消します。'),preview,el('p',{class:'muted'},'プレビューの写真をドラッグして、使う範囲を動かせます。下のスライダーでも調整できます。'),label('ホームの写真を選ぶ・変更する',chooser),layout,el('fieldset',{class:'cover-adjustments'},el('legend',{},'写真の使う範囲'),sliders),label('吹き出しのフリーコメント',comment),el('p',{class:'muted'},'40文字まで・改行できます。空欄にすると吹き出しを隠します。'),remove,label('名前',input('name','text',draft.name,{maxlength:40})),label('性別',select('sex',SEX,draft.sex)),label('推定年齢（任意）',input('age','text',draft.age,{maxlength:40,placeholder:'例：推定2歳 / 2024年春生まれ'})),label('お迎えした日（任意）',input('joined','date',draft.joined||'',{min:'1900-01-01',max:today()})),el('p',{class:'muted'},'写真は端末内で縮小保存します。範囲を調整しても元画像やアルバムの写真は変更せず、外部送信しません。'),el('button',{type:'submit',class:'wide'},'プロフィールを保存'));
  submitForm(form,async f=>{
    if(chooser.disabled){toast('写真の読み込みが終わるまでお待ちください');return;}
    const joined=f.get('joined');if(joined&&!validDate(joined)){toast('お迎えした日を確認してください');return;}
    const cover=M.validateCover({...draft.cover,comment:f.get('cover-comment')});
    if(await save(s=>Object.assign(s.profile,{name:f.get('name').trim(),sex:f.get('sex'),age:f.get('age').trim(),joined,photo:draft.photo,cover}),'プロフィールを保存しました'))closeDialog();
  });
  showDialog(el('h2',{},'うちの子のプロフィール'),form);
  window.addEventListener('resize',refreshPreview);
  $('dialog').addEventListener('close',()=>window.removeEventListener('resize',refreshPreview),{once:true});
}
function dueReminders(){return [...new Set(M.careTasks(state.settings.reminders,state.records,today(),timeNow()).filter(task=>task.due&&!task.done).map(task=>task.type))];}
function careScheduleList(value=today()){
  const tasks=M.careTasks(state.settings.reminders,state.records,value,value<today()?'23:59':value===today()?timeNow():'');
  if(!tasks.length)return el('p',{class:'muted'},'この日のお世話の予定はありません。');
  return el('ul',{class:'care-schedule'},tasks.map(task=>el('li',{class:task.done?'done':task.due?'due':''},el('span',{class:'care-symbol'},icon(TYPES[task.type][0])),el('div',{},el('strong',{},task.time+' '+TYPES[task.type][1]),el('small',{},task.done?'実施済み':task.due?'時間になりました・未実施':'これからの予定')),el('button',{class:'ghost',disabled:task.done||value>today()?'':null,'aria-label':task.time+'の'+TYPES[task.type][1]+(task.done?'は実施済み':'を記録'),onclick:event=>quickCareRecord(task.type,value,task.time,event.currentTarget)},task.done?'済':'できた'))));
}
function homeCareContent(){
  const tasks=M.careTasks(state.settings.reminders,state.records,today(),timeNow()),remaining=CARE.filter(type=>!tasks.some(task=>task.type===type));
  const done=tasks.filter(t=>t.done).length,due=tasks.filter(t=>t.due&&!t.done).length;
  return [tasks.length?el('p',{class:'care-summary'},`予定 ${tasks.length}件 ／ 実施済み ${done}件・未実施 ${due}件・これから ${tasks.length-done-due}件`):null,tasks.length?el('div',{id:'care-schedule-list','data-today':'yes'},careScheduleList()):null,remaining.length?el('div',{class:'unscheduled-care'},tasks.length?el('h3',{},'ほかのお世話'):null,careChecklist(today(),remaining)):null];
}
function careScheduleCard(){
  return card(sectionTitle('今日のお世話',el('button',{class:'text-button',onclick:()=>{selectedDate=today();go('reminders');}},'予定・お知らせ')),el('div',{id:'home-care-content'},homeCareContent()),el('div',{class:'care-card-actions'},el('button',{class:'text-button',onclick:()=>{selectedDate=today();go('care');}},'追加・過去の記録 →')));
}
function downloadFile(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function remindersPage(){
  const controls=['food','water','clean'].map(type=>{
    const value=state.settings.reminders[type],check=input(`${type}-enabled`,'checkbox','yes');check.checked=value.enabled;
    const times=[0,1,2].map((_,i)=>input(`${type}-time-${i}`,'time',i===0?value.time:value.extraTimes?.[i-1]||'',{required:i===0?'':null}));
    const start=input(`${type}-start`,'date',value.startDate||today(),{required:true,min:'1900-01-01',max:'2100-12-31'});
    const interval=select(`${type}-interval`,Array.from({length:30},(_,i)=>String(i+1)),String(value.interval??1));
    return el('fieldset',{class:`reminder-setting type-${type}`},el('legend',{},icon(TYPES[type][0]),TYPES[type][1]),label('予定を有効にする',check),el('div',{class:'row'},label('開始日',start),label('何日おき（1＝毎日）',interval)),el('div',{class:'schedule-times'},times.map((time,i)=>label(i===0?'時刻1':`時刻${i+1}（任意）`,time))),el('button',{type:'button',class:'ghost',onclick:()=>{check.checked=true;times[0].value='08:00';times[1].value='18:00';times[2].value='';interval.value='1';}},'朝夕（8時・18時）にする'));
  });
  const form=el('form',{},el('p',{class:'muted'},'1日3回まで設定できます。不要な時刻は空欄にしてください。変更後は保存し、カレンダーにも登録し直してください。'),controls,el('button',{type:'submit',class:'primary wide'},'予定を保存'));
  submitForm(form,async f=>{
    const reminders={};
    try{for(const type of CARE){const times=[0,1,2].map(i=>f.get(`${type}-time-${i}`)).filter(Boolean).sort();reminders[type]=M.validateReminder({enabled:f.has(`${type}-enabled`),time:times[0],extraTimes:times.slice(1),interval:Number(f.get(`${type}-interval`)),startDate:f.get(`${type}-start`)});}}catch(e){toast(e.message);return;}
    await save(s=>s.settings.reminders=reminders,'予定を保存しました。閉じている間のお知らせにはカレンダー登録が必要です。');
  });
  const next=['food','water','clean'].filter(type=>state.settings.reminders[type].enabled).map(type=>{const r=state.settings.reminders[type];let next=M.nextCareDate(r,today());if(next===today()&&M.reminderTimes(r).every(t=>t<=timeNow()))next=M.addDays(next,r.interval);return el('p',{class:'muted'},TYPES[type][1]+'：'+(r.interval===1?'毎日':r.interval+'日おき')+' '+M.reminderTimes(r).join('・')+' ／ 次の予定日 '+prettyDate(next,true));});
  return [heading('お世話の予定・お知らせ'),el('div',{class:'notice'},'予定を保存するとアプリ内に表示します。閉じている間も知らせるには、下のファイルをiPhone標準カレンダーへ追加してください。'),card(el('h2',{},'予定を確認'),dateSwitcher(selectedDate,v=>selectedDate=v),el('div',{id:'care-schedule-list','data-date':selectedDate},careScheduleList(selectedDate)),next),card(el('h2',{},'繰り返す予定を設定'),form),card(el('h2',{},'iPhoneにお知らせを登録'),el('button',{class:'primary wide',onclick:()=>{try{downloadFile(M.calendarFile(state.settings.reminders),'text/calendar;charset=utf-8','kozakura-care-reminders.ics');toast('予定ファイルを作成しました。カレンダーへの追加が必要です。');}catch(e){toast(e.message);}}},icon('calendar'),'カレンダー用ファイルを書き出す'),el('ol',{class:'help-list'},el('li',{},'上の予定を保存してから、ファイルを書き出します。'),el('li',{},'ファイルを標準カレンダーで開き、予定を追加します。iPhoneで追加できない場合はMacから同じiCloudカレンダーへ追加してください。'),el('li',{},'iPhoneの通知設定・カレンダーの予定の通知・音量を確認してください。'),el('li',{},'時刻・回数の変更や停止時は、以前の繰り返し予定をカレンダーで削除してから登録し直してください。'))),card(el('h2',{},'お知らせについて'),el('p',{class:'muted'},'ファイルの保存だけでは通知は始まりません。登録の完了や通知許可をアプリから確認することはできません。音は消音・集中モード等の設定に従います。'),el('p',{class:'muted'},'実施の記録は予定ごとです。通常のお世話記録は、実施時刻直前の予定（最初の予定より前なら最初の予定）に対応します。カレンダーの通知は実施済みにしても自動では取り消されません。'),el('p',{class:'muted'},'写真や飼育記録を外部へ送信せず、アプリから外部の通知配信サーバーは使いません。予定の同期はカレンダーの設定に従います。'))];
}
function menuItem(name,sub,symbol,action,cls=''){return el('button',{class:`menu-item ${cls}`,onclick:action},el('span',{class:'menu-icon'},icon(symbol)),el('span',{},el('strong',{},name),sub?el('small',{},sub):null),icon('arrow'));}
function settings(){return [heading('メニュー'),el('section',{class:'menu-list'},menuItem('イラスト変更','見た目の種類と色を選ぶ','bird',()=>go('appearance'),'type-behavior'),menuItem('プロフィール','うちの子の名前・写真・お迎え日','bird',profileDialog,'type-food'),menuItem('お世話チェックリスト','掃除・水替え・ご飯替え','check',()=>go('care'),'type-clean'),menuItem('産卵・発情の記録','回数や気づいたようすを残す','egg',()=>go('breeding'),'type-egg'),menuItem('通院記録','病院名と受診内容・メモ','medical',()=>go('visits'),'type-visit'),menuItem('健康グラフ','体重・放鳥・食欲・フン・活動量','chart',()=>go('health'),'type-water'),menuItem('データのバックアップ','写真・動画・記録をファイル保存','cloud',()=>go('backup'),'type-water'),menuItem('お世話の予定・お知らせ','ご飯・水替え・掃除を忘れずに','bell',()=>go('reminders'),'type-behavior'),menuItem('アプリについて','使い方・保存とプライバシー','leaf',()=>go('about'),'type-clean'))];}
function backupPage(){const restore=input('backup','file','',{accept:'.json,application/json',onchange:async e=>{await importBackup(e.target.files[0]);e.target.value='';}});restore.removeAttribute('value');return [heading('バックアップ'),card(el('h2',{},'大切な思い出を保存'),el('p',{},`記録 ${state.records.length}件 / 写真・動画 ${state.photos.length}件`),el('button',{class:'primary wide',onclick:exportBackup},icon('download'),'バックアップを書き出す'),el('p',{class:'muted'},'写真・動画を含むJSONファイルです。「ファイル」アプリやiCloud Driveなど、保存先への保存完了を確認してください。'),el('p',{class:'muted'},state.lastBackup?`最終書き出し操作：${new Date(state.lastBackup).toLocaleString('ja-JP')}`:'まだ書き出していません。'),label('バックアップから復元',restore),el('p',{class:'muted'},'復元は現在のデータを置き換えます。旧版v1のバックアップも読み込めます。実行中のタイマーは復元しません。'))];}
function aboutPage(){return [heading('アプリについて'),card(el('h2',{},'コザボタ日和'),el('p',{},'小さな変化も、大切な思い出も。愛鳥と過ごす毎日をやさしく記録します。')),card(el('h2',{},'iPhoneで使う'),el('ol',{class:'help-list'},el('li',{},'Safariで公開URLを開き、共有 → ホーム画面に追加。'),el('li',{},'ホーム画面から起動し「オフライン準備完了」を確認。'),el('li',{},'プロフィールに愛鳥の名前と好きな写真を設定。'),el('li',{},'機内モードでも起動・保存できるか実機で確認。'))),card(el('h2',{},'保存とプライバシー'),el('p',{},'写真・動画・プロフィール・飼育記録はこの端末のIndexedDBに保存し、サーバーやGitHubに送信しません。別の人とは共有・同期されません。同じ端末・同じブラウザを共用するとデータも共用されます。'),el('p',{},'写真と動画は合計100件、記録50,000件、データ全体約38MBまで。動画は1本8MB以下です。容量不足時は保存エラーを表示します。'),el('p',{},'ホーム画面アプリとSafari、別ブラウザでは保存場所が異なる場合があります。使う場所を統一し、週1回や大切な記録の後にバックアップしてください。Webサイトデータの削除、故障・機種変更、OSの整理で記録が失われる場合があります。'),el('p',{},'初期イラストはこのアプリのオリジナルです。自分が利用する権利のある写真・動画を選んでください。動画は元ファイルを端末内に保存するため、位置情報等のメタデータが含まれる場合があります。バックアップを共有する前に内容を確認してください。'),el('p',{},'広告・解析・課金APIはありません。公開サーバーにはアクセス時の通信情報が残る場合があります。カレンダー用ファイルの追加・同期はカレンダーアプリの設定に従います。')),el('div',{class:'notice'},'このアプリは観察の記録用です。診断や適正体重の判定はしません。気になる変化は記録を持って、鳥を診られる獣医師に相談してください。')];}
function breedingPage(){return [heading('産卵・発情の記録'),el('div',{class:'row'},el('button',{class:'primary',onclick:()=>recordForm('egg')},icon('egg'),'産卵を記録'),el('button',{class:'ghost',onclick:()=>recordForm('estrus')},icon('heart'),'発情のようす')),card(recordList(sortedRecords().filter(r=>['egg','estrus'].includes(r.type)).slice(0,40)))];}
function visitsPage(){return [heading('通院記録'),el('button',{class:'primary wide',onclick:()=>recordForm('visit')},icon('medical'),'通院を記録する'),card(recordList(sortedRecords().filter(r=>r.type==='visit').slice(0,40)))];}
function render(){setupHeader();route=location.hash.slice(1)||'home';const pages={home,records,calendar,album,settings,appearance:appearancePage,timer:timerPage,weight:weightPage,behavior:behaviorPage,care:carePage,health:healthPage,reminders:remindersPage,backup:backupPage,about:aboutPage,breeding:breedingPage,visits:visitsPage};if(!pages[route])route='home';$('main').replaceChildren(...pages[route]().flat(Infinity).filter(node=>node!==null&&node!==undefined));updateActiveTimer();const nav=document.querySelector('.bottom-nav');nav.replaceChildren(navLink('home','ホーム','home'),navLink('records','記録','note'),navLink('calendar','カレンダー','calendar'),navLink('album','アルバム','camera'),navLink('settings','メニュー','menu'));const active=['timer'].includes(route)?'home':['weight','behavior','care','health','breeding','visits'].includes(route)?'records':['reminders','backup','about','appearance'].includes(route)?'settings':route;for(const a of nav.querySelectorAll('a'))if(a.hash===`#${active}`)a.setAttribute('aria-current','page');connection();}
function setupHeader(){const header=document.querySelector('.site-header');header.replaceChildren(el('a',{href:'#home',class:'brand'},icon('bird'),el('span',{},'コザボタ日和',el('small',{},'愛鳥と暮らす日々'))),el('div',{class:'header-tools'},el('span',{id:'connection',class:'connection-dot','aria-label':'接続状態'}),el('button',{class:'icon-button','aria-label':'お知らせ設定',onclick:()=>go('reminders')},icon('bell')),el('button',{class:'icon-button','aria-label':'メニュー',onclick:()=>go('settings')},icon('menu'))));}
function connection(){const node=$('connection');if(node){node.title=navigator.onLine?'端末内に保存':'オフライン';node.setAttribute('aria-label',node.title);node.classList.toggle('offline',!navigator.onLine);}}
setupHeader();

$('close-dialog').addEventListener('click',()=>{if(!dialogSaving())closeDialog();});
function dialogSaving(){const form=$('dialog').querySelector('form');return form&&submittingForms.has(form);}
$('dialog').addEventListener('cancel',event=>{if(dialogSaving())event.preventDefault();});
$('undo-record').addEventListener('click',undoLastRecord);
window.addEventListener('beforeunload',event=>{if(pendingWrites){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{behaviorOrderDraft=null;recordPage=0;render();window.scrollTo(0,0);});
window.addEventListener('online',connection);window.addEventListener('offline',connection);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&db)refresh().then(updateTimerDisplay);});
if(channel)channel.onmessage=()=>refresh();
setInterval(updateTimerDisplay,1000);
init();

setInterval(()=>{const home=$('home-care-content');if(home)home.replaceChildren(...homeCareContent().filter(Boolean));else {const list=$('care-schedule-list');if(list)list.replaceChildren(careScheduleList(list.dataset.date));}},30000);
