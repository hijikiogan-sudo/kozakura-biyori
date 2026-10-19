'use strict';
const APP = 'kozakura-biyori', DB = 'kozakura-biyori-local-v1';
const $ = id => document.getElementById(id);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const M=KozakuraModel;
const blank=M.blank;
let db, state = blank(), route = 'home', calendarDate = today(), recordPage = 0, toastTimer;
let timerMode = 'countup', timerMinutes = 15;
let timerAudioContext=null, alertedTimerKey=null;
let behaviorOrderDraft=null;
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
function toast(message) { $('toast').textContent=message; $('toast').style.display='block'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').style.display='none',4500); }
function errorMessage(error) { if(error?.message?.startsWith('上限：'))return error.message; return error?.name==='QuotaExceededError' ? '空き容量が足りず保存できませんでした。バックアップ後、不要な写真を削除してください。' : '保存・読み込みができませんでした。プライベートブラウズや端末の空き容量を確認してください。'; }
function openDB() { return new Promise((resolve,reject)=> { const req=indexedDB.open(DB,1); req.onupgradeneeded=()=>req.result.createObjectStore('data'); req.onerror=()=>reject(req.error); req.onsuccess=()=>resolve(req.result); }); }
function readState() { return new Promise((resolve,reject)=> { const tx=db.transaction('data','readonly'); const req=tx.objectStore('data').get('state'); req.onsuccess=()=>resolve(M.normalize(req.result)); req.onerror=()=>reject(req.error); }); }
// Transactional read-modify-write prevents two open tabs from overwriting each other's new records.
function mutate(fn) { return new Promise((resolve,reject)=> { const tx=db.transaction('data','readwrite'); const store=tx.objectStore('data'); const req=store.get('state'); let next; req.onsuccess=()=> { try {next=M.normalize(req.result); fn(next); if(next.records.length>50000 || JSON.stringify(next).length>38*1024*1024)throw new Error('上限：記録は50,000件、データ全体は約38MBまでです。バックアップ後、不要な記録・写真を削除してください。'); store.put(next,'state');} catch(e){tx.abort();reject(e);} }; tx.oncomplete=()=> {state=next; channel?.postMessage('changed'); resolve();}; tx.onabort=tx.onerror=()=>reject(tx.error || new Error('保存に失敗しました')); }); }
async function save(fn, message='保存しました') {try { await mutate(fn); if(message) toast(message); render(); return true; } catch(e) {toast(errorMessage(e));return false;} }
function card(...children) {return el('section',{class:'card'},children);}
function empty(text,symbol='❀') {return el('p',{class:'empty'},el('span',{class:'empty-symbol','aria-hidden':'true'},symbol),text);}
function title(heading, text) {return [el('p',{class:'eyebrow'},'LITTLE BIRD, LOVELY DAYS'),el('h1',{},heading),el('p',{class:'intro'},text)];}
function label(text, control) { const id=control.id || uid(); control.id=id; return el('div',{},el('label',{for:id},text),control); }
function input(name, type='text', value='', extra={}) { return el('input',{name,type,value,...extra}); }
function select(name, choices, value) { const s=el('select',{name},choices.map(v=>el('option',{value:v},v)));s.value=value;return s; }
function note() {return label('メモ（任意）',el('textarea',{name:'note',maxlength:1000,placeholder:'今日のようす、気づいたこと…'}));}
function dateField(value=today()) {return label('記録日',input('date','date',value,{required:true,min:'1900-01-01',max:'2100-12-31'}));}
function askConfirm(message){return new Promise(resolve=>{const dialog=$('confirm-dialog');$('confirm-message').textContent=message;const finish=value=>{dialog.close();resolve(value);};$('confirm-ok').onclick=()=>finish(true);$('confirm-cancel').onclick=()=>finish(false);dialog.oncancel=event=>{event.preventDefault();finish(false);};dialog.showModal();});}
function closeDialog(){ $('dialog').close(); }
function showDialog(...nodes){ $('dialog-content').replaceChildren(...nodes.flat(Infinity).filter(node=>node!==null&&node!==undefined));$('dialog').showModal(); }
function submitForm(form, handler){form.addEventListener('submit',async event=> {event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('[type=submit]');button.disabled=true;try {await handler(new FormData(form));} catch(e){toast(errorMessage(e));} finally {button.disabled=false;} });return form;}
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
function timerNotificationControls(){
  const countdown=state.timer?Boolean(state.timer.durationSeconds):timerMode==='countdown';
  if(!countdown)return null;
  const active=state.timer,ended=timerFinished();
  const calendar=active?[
    el('p',{class:'timer-deadline'},`終了予定：${new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(active.startedAt+active.durationSeconds*1000))}`),
    el('button',{id:'timer-calendar-button',class:'primary wide',disabled:ended?'':null,onclick:()=>{try{downloadFile(M.timerCalendarFile(state.timer),'text/calendar;charset=utf-8','kozakura-flight-timer.ics');toast('終了時刻の予定ファイルを作成しました。カレンダーへ追加し、予定の通知を確認してください。');}catch(e){toast(e.message);}}},icon('calendar'),'終了のお知らせ用ファイルを書き出す'),
    el('ol',{class:'help-list'},el('li',{},'書き出した .ics ファイルを標準カレンダーに読み込み、予定を追加します。iPhoneで追加できない場合はMacのカレンダーで読み込み、同じiCloudカレンダーに追加してください。'),el('li',{},'予定の通知と、iPhoneの設定 → 通知 → カレンダーを確認します。通知音はiPhoneの音量・消音・集中モードの設定に従います。'),el('li',{},'タイマーを取り消したり早めに終了した場合は、追加した予定もカレンダーで削除します。'))
  ]:el('p',{},'開始後に終了時刻の予定ファイルを書き出し、iPhone標準カレンダーへ追加できます。');
  return card(el('h2',{},'終了のお知らせ'),el('p',{class:'notice'},'画面を閉じている間の通知は、標準カレンダーへの追加が必要です。このアプリだけでは自動で予約できません。急ぐときは、iPhoneの「時計 → タイマー」に残り時間を設定してください。'),calendar,el('p',{class:'muted'},'ファイルの保存だけでは通知は有効になりません。カレンダーへの追加完了・通知許可・予定の削除をアプリから確認・操作することはできません。同じ予定の重複追加にもご注意ください。'),el('button',{class:'ghost wide',onclick:async()=>{const ready=await prepareTimerAudio();if(ready&&playTimerSound())toast('終了音を鳴らしました。聞こえる音量か確認してください。');else toast('音を再生できません。端末の音量とブラウザの設定を確認してください。');refreshTimerAudioStatus();}},'終了音を試す'),el('p',{id:'timer-audio-status',class:'muted',role:'status'},timerAudioStatus()),el('p',{class:'muted'},'アプリの終了音は画面を表示している間に鳴ります。画面ロック・別アプリへの切り替え・アプリ終了中の音は保証できません。'));
}
function updateTimerDisplay(){
  checkTimerAlert();
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
async function refresh(){try {state=await readState();render();}catch(e){toast(errorMessage(e));}}
async function offlineSetup(){const status=$('offline-status');if(!('serviceWorker' in navigator)){status.textContent='このブラウザはオフライン非対応';return;}try {const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});let finished=false;const ready=async()=>{const keys=await caches.keys();if(keys.includes('kozakura-biyori-shell-v1.3.0')){status.textContent='オフライン準備完了';finished=true;}};await ready();reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='activated')ready();if(worker.state==='redundant'&&!finished)status.textContent='オフライン準備失敗・オンラインで再度開いてください';});});navigator.serviceWorker.addEventListener('controllerchange',ready);setTimeout(()=>{if(!finished)status.textContent='オフライン準備未完了・オンラインで再度開いてください';},20000);}catch(e){status.textContent='オフライン準備失敗・オンラインで再度開いてください';}}
async function init(){try {db=await openDB();await mutate(()=>{});state=await readState();render();offlineSetup();}catch(e){$('main').replaceChildren(...title('保存領域を開けませんでした','記録を保存できる環境で開き直してください。'),el('div',{class:'notice'},errorMessage(e)));}}

// v1.1 interface. Data stays in the v1 database; nothing is sent to a server.
let selectedDate=today(), chartDays=7, chartMetric='weight', weightTab='graph', albumTab='image', editingId=null, recordFilter='all';
const CARE=M.CARE, BEHAVIORS=M.BEHAVIORS;
function birdImage(appearance=state.settings.birdAppearance){return `./birds/${appearance}.svg`;}
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
function tabs(items,active,onChange,cls=''){return el('div',{class:`tabs ${cls}`,role:'group'},items.map(([value,text])=>el('button',{class:active===value?'active':'','aria-pressed':active===value,onclick:()=>{onChange(value);render();}},text)));}
function prettyDate(value,short=false){const d=new Date(`${value}T12:00:00`);return new Intl.DateTimeFormat('ja-JP',short?{month:'numeric',day:'numeric'}:{month:'long',day:'numeric',weekday:'short'}).format(d);}
function timeNow(){return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date());}
function recordTime(r){return r.time||new Date(r.createdAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
function sortedRecords(){return M.sorted(state.records);}
function describe(r){return M.summary(r);}
function validDate(s){return M.validDate(s);}
function validateBackup(raw){return M.validateBackup(raw);}
function dateSwitcher(value,onChange){const picker=input('selected-date','date',value,{required:true,min:'1900-01-01',max:'2100-12-31',onchange:e=>{if(validDate(e.target.value)){onChange(e.target.value);render();}}});picker.setAttribute('aria-label','表示する日');return el('div',{class:'date-switcher'},el('button',{class:'icon-button','aria-label':'前の日',onclick:()=>{const next=M.addDays(value,-1);if(validDate(next)){onChange(next);render();}}},icon('back')),el('strong',{},prettyDate(value)),el('button',{class:'icon-button','aria-label':'次の日',onclick:()=>{const next=M.addDays(value,1);if(validDate(next)){onChange(next);render();}}},icon('arrow')),el('label',{class:'date-picker-label'},icon('calendar'),picker));}
function recordList(records){if(!records.length)return empty('まだ記録がありません。小さな変化から残してみましょう。');return el('ul',{class:'record-list'},records.map(r=>el('li',{class:`record-item type-${r.type}`},el('span',{class:'record-icon'},icon(TYPES[r.type]?.[0]||'note')),el('div',{class:'record-body'},el('div',{class:'record-meta'},el('strong',{},TYPES[r.type]?.[1]||'記録'),el('time',{datetime:r.date},`${prettyDate(r.date,true)} ${recordTime(r)}`)),el('p',{},describe(r)),r.note&&r.type!=='note'?el('p',{class:'muted'},r.note):null),el('button',{class:'icon-button','aria-label':`${r.date}の${TYPES[r.type]?.[1]}記録を編集`,onclick:()=>recordForm(r.type,r)},icon('note')),el('button',{class:'delete','aria-label':`${r.date}の${TYPES[r.type]?.[1]}記録を削除`,onclick:async()=>{if(await askConfirm('この記録を削除しますか？'))await save(s=>s.records=s.records.filter(x=>x.id!==r.id),'記録を削除しました');}},'×'))));}
async function addRecord(type,data){try{const old=editingId?state.records.find(r=>r.id===editingId):null;const record=M.validateRecord({id:old?.id||uid(),type,date:data.date,createdAt:old?.createdAt||new Date().toISOString(),note:'',...data});if(await save(s=>{if(old){const index=s.records.findIndex(r=>r.id===old.id);if(index<0)throw Error('記録が見つかりません');s.records[index]=record;}else s.records.push(record);},old?'記録を更新しました':'記録しました')){editingId=null;closeDialog();return true;}}catch(e){toast(e.message);}return false;}
function recordForm(type,old=null){editingId=old?.id||null;const controls=[dateField(old?.date||selectedDate),label('時刻',input('time','time',old?recordTime(old):timeNow(),{required:true}))];
  if(type==='weight')controls.push(label('実測した体重（g）',input('value','number',old?.value??'',{required:true,min:.1,max:2000,step:.1,placeholder:'測った値を入力'})));
  if(type==='health')for(const [key,text]of [['appetite','食欲'],['droppings','フン'],['activity','活動量']])controls.push(label(text,select(key,LEVEL,old?.[key]||LEVEL[0])));
  if(type==='flight')controls.push(label('放鳥時間（分）',input('minutes','number',old?.minutes??'',{required:true,min:.1,max:10080,step:.1})));
  if(type==='egg')controls.push(label('産んだ卵の数',input('count','number',old?.count??1,{required:true,min:1,max:100,step:1})),label('卵のようす',select('condition',['未確認','いつもどおり','気になる'],old?.condition||'未確認')));
  if(type==='behavior')controls.push(label('行動',select('behavior',[...new Set([...BEHAVIORS,'ごきげん','発情のようす','その他',old?.behavior].filter(Boolean))],old?.behavior||BEHAVIORS[0])));
  if(type==='visit')controls.push(label('病院名（任意）',input('clinic','text',old?.clinic||'',{maxlength:200})),label('受診内容（任意）',input('reason','text',old?.reason||'',{maxlength:200})));
  if(type==='estrus')controls.push(label('見られたようす',select('sign',['吐き戻し','巣探し','紙を運ぶ','交尾のようす','その他'],old?.sign||'吐き戻し')));
  const memo=el('textarea',{name:'note',maxlength:1000,placeholder:'気づいたこと、今日のようす…'},old?.note||'');controls.push(label(type==='note'?'メモ':'メモ（任意）',memo));if(type==='note')memo.required=true;
  formDialog(`${TYPES[type][1]}${old?'を編集':'の記録'}`,controls,async f=>{const data={date:f.get('date'),time:f.get('time'),note:f.get('note')||''};for(const key of ['value','minutes','count'])if(f.has(key))data[key]=Number(f.get(key));for(const key of ['appetite','droppings','activity','condition','behavior','clinic','reason','sign'])if(f.has(key))data[key]=f.get(key);if(type==='flight'&&old)for(const key of ['startedAt','endedAt'])if(old[key]!==undefined)data[key]=old[key];await addRecord(type,data);});}
function actionTile(type,titleText,subtitle='',target=null){return el('button',{class:`action-tile type-${type}`,onclick:()=>target?go(target):recordForm(type)},el('span',{class:'tile-icon'},icon(TYPES[type]?.[0]||type)),el('strong',{},titleText),subtitle?el('small',{},subtitle):null);}
function todayHealth(){return M.day(state.records,today()).find(r=>r.type==='health');}
function healthStrip(){const health=todayHealth(),weight=sortedRecords().find(r=>r.type==='weight');return el('div',{class:'health-strip'},[['体重',weight?`${weight.value} g`:'—',weight?prettyDate(weight.date,true):'未記録','weight'],['食欲',health?.appetite||'—',health?'今日の記録':'未記録','health'],['フン',health?.droppings||'—',health?'今日の記録':'未記録','health'],['活動量',health?.activity||'—',health?'今日の記録':'未記録','health']].map(([name,value,caption,type])=>el('button',{class:'health-cell',onclick:()=>{selectedDate=today();recordForm(type);}},el('small',{},name),el('strong',{},value),el('span',{},caption))));}
function careChecklist(value=today()){const logs=M.day(state.records,value);return el('div',{class:'care-checks'},CARE.map(type=>{const records=logs.filter(r=>r.type===type),done=records.length>0;return el('button',{class:`care-check type-${type} ${done?'done':''}`,onclick:async()=>{editingId=null;const message=done?`${TYPES[type][1]}は${records.length}回記録済みです。もう一度お世話を記録しますか？`:`${TYPES[type][1]}を実施済みとして記録しますか？`;if(await askConfirm(message))await addRecord(type,{date:value,time:timeNow(),note:''});}},el('span',{class:'care-symbol'},icon(TYPES[type][0])),el('span',{},el('strong',{},TYPES[type][1]),el('small',{},done?`${recordTime(records[0])} 済${records.length>1?`・${records.length}回`:''}`:'タップして記録')),el('span',{class:'checkmark'},done?icon('check'):'○'));}));}
function homeCover(p,preview=false){
  const cover=p.cover,join=p.joined?Math.floor((new Date(`${today()}T12:00:00`)-new Date(`${p.joined}T12:00:00`))/86400000)+1:null;
  const photo=el('img',{src:p.photo||birdImage(),alt:p.photo?'この端末で選んだ愛鳥の写真':'オリジナルのコザクラインコイラスト',class:'cover-bird',draggable:'false'});
  photo.style.objectPosition=`${cover.x}% ${cover.y}%`;
  photo.style.transformOrigin=`${cover.x}% ${cover.y}%`;
  photo.style.transform=`scale(${cover.zoom})`;
  const speech=cover.comment.trim()?el('div',{class:'speech'},el('span',{class:'cover-comment'},cover.comment),el('span',{'aria-hidden':'true'},'♡')):null;
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
function home(){const p=state.profile;const tasks=dueReminders();return [el('div',{class:'home-date'},prettyDate(today())),homeCover(p),el('section',{class:'health-section'},sectionTitle('今日の健康チェック',el('button',{class:'text-button',onclick:()=>{selectedDate=today();recordForm('health');}},'記録する')),healthStrip()),el('button',{class:'flight-start',onclick:()=>go('timer')},icon('bird'),state.timer?'放鳥タイマーへ':'放鳥スタート'),el('div',{class:'quick-grid'},actionTile('weight','体重記録','','weight'),actionTile('behavior','行動記録','','behavior'),actionTile('camera','写真アルバム','','album'),actionTile('calendar','カレンダー','お世話の記録','calendar')),card(sectionTitle('今日のお世話',el('button',{class:'text-button',onclick:()=>go('care')},'詳しく →')),careChecklist(today())),tasks.length?el('button',{class:'reminder-banner',onclick:()=>go('reminders')},icon('bell'),`お世話の確認：${tasks.map(t=>TYPES[t][1]).join('・')}`,icon('arrow')):null,card(sectionTitle('最近の記録',el('a',{href:'#records'},'すべて →')),recordList(sortedRecords().slice(0,4)))];}
async function toggleTimer(){if(state.timer){if(!await askConfirm(`放鳥を終了して、経過時間を記録しますか？${state.timer?.durationSeconds&&!timerFinished()?' カレンダーに追加した終了予定も、カレンダー側で削除してください。':''}`))return;await save(s=>{if(!s.timer)throw Error('終了済み');const start=s.timer,endedAt=Date.now(),minutes=Math.max(.1,Math.round((endedAt-start.startedAt)/6000)/10);if(minutes>10080)throw Error('上限：7日を超える放鳥は取り消して手入力してください。');s.records.push({id:uid(),type:'flight',date:start.date,time:new Date(start.startedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),createdAt:new Date().toISOString(),startedAt:start.startedAt,endedAt,minutes,note:'放鳥タイマーから記録'});s.timer=null;},'放鳥を記録しました');}else {
  const minutes=$('timer-minutes');
  if(timerMode==='countdown'&&(!minutes||!minutes.reportValidity()))return;
  const durationSeconds=timerMode==='countdown'?Number(minutes.value)*60:null;
  if(durationSeconds)prepareTimerAudio().then(refreshTimerAudioStatus);
  await save(s=>{if(!s.timer)s.timer={startedAt:Date.now(),date:today(),...(durationSeconds?{durationSeconds}:{})};},'放鳥をはじめました');
}}
function timerPage(){const records=M.day(state.records,today()).filter(r=>r.type==='flight'),sum=Math.round(records.reduce((s,r)=>s+r.minutes,0)*10)/10;return [heading('放鳥タイマー',el('button',{class:'icon-button','aria-label':'放鳥の履歴',onclick:()=>{recordFilter='flight';go('records');}},icon('clock'))),state.timer?null:timerControls(),el('section',{id:'timer-scene',class:`timer-scene ${state.timer?'running':''} ${timerFinished()?'finished':''}`},el('div',{class:'timer-ring'},el('span',{class:'timer-status',id:'timer-status'},timerStatus()),el('div',{class:'timer-display',id:'timer-display'},timerText()),el('small',{},state.timer?`開始 ${new Date(state.timer.startedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`:'準備ができたらスタート'),el('img',{src:state.profile.photo||birdImage(),alt:'愛鳥',class:'timer-bird'}))),el('p',{class:'notice',id:'timer-complete',role:'status',hidden:timerFinished()?null:''},'設定時間になりました。愛鳥を確認し、放鳥を終えたら「放鳥を終了」を押してください。実際に終了した時点までの時間を記録します。'),el('button',{class:'flight-start',onclick:toggleTimer},icon('bird'),state.timer?'放鳥を終了':'放鳥をはじめる'),state.timer?el('button',{class:'ghost wide',onclick:async()=>{if(await askConfirm(`タイマーを取り消しますか？ 記録には残りません。${state.timer?.durationSeconds?' カレンダーに追加した終了予定も、カレンダー側で削除してください。':''}`))await save(s=>s.timer=null,'取り消しました');}},'記録せず取り消す'):el('button',{class:'text-button wide',onclick:()=>{selectedDate=today();recordForm('flight');}},'時間を手入力する'),timerNotificationControls(),card(el('h2',{},'今日の放鳥記録'),records.length?el('div',{class:'flight-history'},records.slice().reverse().map((r,i)=>el('div',{},el('span',{},`${i+1}回目`),el('span',{},r.startedAt?`${recordTime(r)} – ${new Date(r.endedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`:recordTime(r)),el('strong',{},`${r.minutes}分`))),el('div',{class:'flight-total'},el('strong',{},'合計'),el('strong',{},`${sum}分`))):empty('今日の放鳥記録はまだありません。')),card(sectionTitle('メモ',el('button',{class:'icon-button','aria-label':'放鳥メモを記録',onclick:()=>{selectedDate=today();recordForm('note');}},icon('note'))),el('p',{class:'muted'},'アプリを閉じていた時間も含めて計測し、開き直すと残り時間を更新します。カウントダウンが0になっても自動では記録を終了しません。画面を閉じる場合のお知らせは、上のカレンダー追加かiPhone標準のタイマーを使ってください。時刻を変更した場合や終了忘れは手入力で修正してください。'))];}
function rangeTabs(){return tabs([[7,'7日'],[30,'30日'],[90,'3か月'],[365,'1年']],chartDays,v=>chartDays=v,'period-tabs');}
function lineChart(metric=chartMetric){const data=M.chartData(state.records,metric,chartDays);if(!data.length)return empty('この期間の記録がありません。実際のようすを記録すると表示されます。', '❀');const isHealth=['appetite','droppings','activity'].includes(metric),numeric=data.filter(x=>x.value!==null),vals=numeric.map(r=>r.value);const low=isHealth?1:Math.min(...vals)-Math.max(1,(Math.max(...vals)-Math.min(...vals))*.2),high=isHealth?3:Math.max(...vals)+Math.max(1,(Math.max(...vals)-Math.min(...vals))*.2),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 430 210');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${metric==='weight'?'体重':metric==='flight'?'放鳥時間':{appetite:'食欲',droppings:'フン',activity:'活動量'}[metric]}のグラフ ${data.length}日分`);svg.classList.add('chart');const from=M.addDays(today(),1-chartDays),span=Math.max(1,chartDays-1),x=d=>42+(new Date(`${d}T12:00:00`)-new Date(`${from}T12:00:00`))/86400000/span*370,y=v=>175-(v-low)/Math.max(.1,high-low)*150;function shape(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;}for(let i=0;i<(isHealth?3:5);i++){const v=low+(high-low)*i/(isHealth?2:4);shape('line',{x1:42,y1:y(v),x2:412,y2:y(v),stroke:'#e7e8db'});shape('text',{x:2,y:y(v)+4,fill:'#7c8574','font-size':isHealth?9:11},isHealth?['少なめ','いつも通り','多め'][i]:v.toFixed(1));}let segment=[];const flush=()=>{if(segment.length)shape('polyline',{points:segment.join(' '),fill:'none',stroke:metric==='flight'?'#86a57b':'#df8e8f','stroke-width':3});segment=[];};for(const d of data){if(d.value===null){flush();shape('text',{x:x(d.date),y:201,fill:'#bf856d','font-size':12,'text-anchor':'middle'},'!');continue;}segment.push(`${x(d.date)},${y(d.value)}`);}flush();for(const d of numeric){const circle=shape('circle',{cx:x(d.date),cy:y(d.value),r:4,fill:'#fff9ed',stroke:metric==='flight'?'#86a57b':'#df8e8f','stroke-width':2});const tip=document.createElementNS(ns,'title');tip.textContent=`${d.date} ${d.value}${metric==='weight'?'g':metric==='flight'?'分':''}`;circle.append(tip);}return [svg,el('div',{class:'chart-labels'},el('span',{},prettyDate(from,true)),el('span',{},prettyDate(today(),true))),el('p',{class:'muted'},isHealth?'少なめ・いつもどおり・多めを表示。「気になる」は ! で示します。空白の日を補完せず、記録点を結んでいます。':'同じ日の体重は最後の記録、放鳥は合計時間を表示します。空白の日を補完せず記録点を結びます。')];}
function weightPage(){const all=sortedRecords().filter(r=>r.type==='weight'),last=all[0];return [heading('体重の記録',el('button',{class:'icon-button','aria-label':'体重を追加',onclick:()=>recordForm('weight')},'+')),el('section',{class:'latest-weight'},icon('scale'),el('div',{},el('small',{},'最新の体重'),el('strong',{},last?last.value:'—',el('small',{},' g')),el('span',{},last?`${prettyDate(last.date,true)} ${recordTime(last)}`:'測った値を記録しましょう')),el('img',{src:state.profile.photo||birdImage(),alt:'愛鳥'})),tabs([['graph','グラフ'],['list','一覧'],['memo','メモ']],weightTab,v=>weightTab=v),rangeTabs(),weightTab==='graph'?card(lineChart('weight')):null,card(el('h2',{},weightTab==='memo'?'体重のメモ':'体重の記録'),recordList(M.period(all,chartDays).filter(r=>weightTab!=='memo'||r.note).slice(0,40))),el('button',{class:'primary wide',onclick:()=>recordForm('weight')},'体重を記録する')];}
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
  return [heading('行動の記録',el('button',{class:'text-button',onclick:()=>{behaviorOrderDraft=[...state.settings.behaviorOrder];render();}},'並べ替え')),dateSwitcher(selectedDate,v=>selectedDate=v),el('button',{class:'text-button wide',onclick:()=>go('appearance')},icon('bird'),'インコのイラストを選ぶ'),el('div',{class:'behavior-grid'},state.settings.behaviorOrder.map(name=>{
    const i=BEHAVIORS.indexOf(name);
    return el('button',{class:`behavior-tile behavior-${i}`,'aria-label':`${name}を記録`,onclick:async()=>{editingId=null;await addRecord('behavior',{date:selectedDate,time:timeNow(),note:'',behavior:name});}},icon(`pose-${i}`),el('strong',{},name==='くちばしギョリギョリ'?['くちばし',el('br'),'ギョリギョリ']:name),el('span',{class:'mood-mark'},['♡','ϟ','♪','▤','❀','♧','☆','…','zᶻ','◌','◦','♡'][i]));
  })),chewedAlbumEntry(),card(sectionTitle('今日のメモ',el('button',{class:'icon-button','aria-label':'行動のメモを追加',onclick:()=>recordForm('note')},icon('note'))),recordList(M.day(state.records,selectedDate).filter(r=>r.type==='note').slice(0,3))),card(el('h2',{},'最近の記録'),recordList(history.slice(0,20)))];
}
function appearancePage(){
  let draft=state.settings.birdAppearance;
  const preview=el('div',{class:'appearance-preview'},icon('pose-0','',draft));
  const form=el('form',{},el('p',{class:'intro'},'うちの子に近い種類や、お気に入りの色を選んでください。'),preview,['lovebird','button'].map(species=>el('fieldset',{class:'appearance-group'},el('legend',{},species==='lovebird'?'コザクラインコ':'ボタンインコ'),el('div',{class:'appearance-grid'},M.BIRD_APPEARANCES.filter(bird=>bird.species===species).map(bird=>{
    const radio=input('bird-appearance','radio',bird.id,{onchange:()=>{draft=bird.id;preview.replaceChildren(icon('pose-0','',draft));},'aria-label':`${bird.label}・${bird.color}`});radio.checked=draft===bird.id;
    return el('label',{class:'bird-choice'},radio,icon('pose-0','',bird.id),el('span',{},bird.color));
  })))),el('p',{class:'muted'},'行動のイラストと、写真未設定時の表紙・タイマーに反映します。設定済みの写真は引き継ぎます。色はイラストの配色です。'),el('button',{type:'submit',class:'primary wide'},'イラストを保存'));
  submitForm(form,async()=>{await save(s=>s.settings.birdAppearance=draft,'インコのイラストを保存しました');});
  return [heading('インコのイラスト'),form];
}
function carePage(){return [heading('お世話チェックリスト'),dateSwitcher(selectedDate,v=>selectedDate=v),card(el('h2',{},'お世話をしたらタップ'),careChecklist(selectedDate),el('p',{class:'muted'},'実施時刻と回数を記録します。詳しいメモや過去の日付は下のボタンから。')),el('div',{class:'quick-grid three'},CARE.map(type=>actionTile(type,TYPES[type][1],'メモを付けて記録'))),card(el('h2',{},'この日のお世話'),recordList(M.day(state.records,selectedDate).filter(r=>CARE.includes(r.type)))),el('button',{class:'ghost wide',onclick:()=>go('reminders')},icon('bell'),'お世話の通知を設定')];}
function records(){const all=sortedRecords().filter(r=>recordFilter==='all'||r.type===recordFilter);const filter=select('record-type',['all',...Object.keys(TYPES)],recordFilter);filter.replaceChildren(el('option',{value:'all'},'すべての記録'),...Object.entries(TYPES).map(([value,[,name]])=>el('option',{value},name)));filter.value=recordFilter;filter.addEventListener('change',e=>{recordFilter=e.target.value;recordPage=0;render();});return [heading('記録'),el('div',{class:'record-menu'},Object.entries(TYPES).map(([type,[symbol,name]])=>el('button',{class:`record-menu-item type-${type}`,onclick:()=>type==='behavior'?go('behavior'):recordForm(type)},icon(symbol),el('span',{},name),icon('arrow')))),card(label('表示する記録',filter),recordList(all.slice(recordPage*30,(recordPage+1)*30)),el('div',{class:'pagination'},recordPage>0?el('button',{class:'ghost',onclick:()=>{recordPage--;render();}},'前へ'):null,(recordPage+1)*30<all.length?el('button',{class:'ghost',onclick:()=>{recordPage++;render();}},'次へ'):null))];}
function calendar(){const [year,month]=calendarDate.split('-').map(Number),first=new Date(year,month-1,1).getDay(),days=new Date(year,month,0).getDate(),grid=el('div',{class:'calendar-grid'},['日','月','火','水','木','金','土'].map((day,i)=>el('span',{class:`weekday day-${i}`},day)));for(let i=0;i<first;i++)grid.append(el('span'));for(let d=1;d<=days;d++){const date=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,logs=M.day(state.records,date),kinds=[...new Set(logs.map(r=>r.type))].slice(0,4);grid.append(el('button',{class:`calendar-day ${date===calendarDate?'selected ':''}${date===today()?'today':''}`,'aria-label':`${date}${logs.length?` 記録${logs.length}件`:''}`,'aria-pressed':date===calendarDate,onclick:()=>{calendarDate=date;selectedDate=date;render();}},el('span',{},d),el('span',{class:'date-dots'},kinds.map(type=>el('i',{class:`dot type-${type}`})))));}const move=n=>{const date=new Date(year,month-1+n,1);const next=M.date(date);if(validDate(next)){calendarDate=next;selectedDate=next;render();}};return [heading('カレンダー'),el('div',{class:'month-switch'},el('button',{class:'icon-button','aria-label':'前の月',onclick:()=>move(-1)},icon('back')),el('strong',{},`${year}年${month}月`),el('button',{class:'icon-button','aria-label':'次の月',onclick:()=>move(1)},icon('arrow'))),grid,el('div',{class:'calendar-legend'},[['flight','放鳥'],['weight','体重'],['egg','産卵'],['clean','掃除'],['water','水替え'],['food','ご飯替え'],['visit','通院']].map(([type,name])=>el('span',{},el('i',{class:`dot type-${type}`}),name))),card(sectionTitle(prettyDate(calendarDate),el('button',{class:'text-button',onclick:()=>{selectedDate=calendarDate;recordForm('note');}},'＋ メモ')),recordList(M.day(state.records,calendarDate))),card(el('h2',{},'この日のお世話'),careChecklist(calendarDate))];}
function healthPage(){const metricNames={weight:'体重',flight:'放鳥',appetite:'食欲',droppings:'フン',activity:'活動量'};const data=M.chartData(state.records,chartMetric,chartDays),numeric=data.filter(p=>p.value!==null),last=numeric.at(-1),first=numeric[0];let caption='この期間の記録がまだありません。';if(last&&['weight','flight'].includes(chartMetric)){const difference=Math.round((last.value-first.value)*10)/10;caption=`${numeric.length}日分の記録。最新は ${last.value}${chartMetric==='weight'?'g':'分'}。${numeric.length>1?`期間内の最初の値から ${difference>0?'+':''}${difference}${chartMetric==='weight'?'g':'分'}です。`:''}`;}else if(data.length)caption=`${data.length}日分の観察記録。「気になる」の記録が ${data.filter(p=>p.value===null).length}日あります。`;return [heading('健康グラフ'),tabs(Object.entries(metricNames),chartMetric,v=>chartMetric=v,'metric-tabs'),rangeTabs(),card(lineChart()),card(el('h2',{},'記録の振り返り'),el('p',{},caption),el('p',{class:'muted'},'入力した記録の要約です。健康状態や適正体重を判定するものではありません。')),el('div',{class:'row'},el('button',{class:'ghost',onclick:()=>recordForm('health')},'健康を記録'),el('button',{class:'ghost',onclick:()=>go('weight')},'体重の記録へ'))];}
async function addMedia(data,kind){if(state.photos.length>=100){toast('アルバムは100件までです。');return;}await save(s=>{if(s.photos.length>=100)throw Error('上限：アルバムは100件までです。');s.photos.push({id:uid(),date:today(),data,kind,favorite:false,caption:''});},kind==='video'?'動画を端末に保存しました':'写真を端末に保存しました');}
function mediaChooser(){const chooser=input('media','file','',{accept:'image/*,video/mp4,video/webm,video/quicktime',onchange:async e=>{const file=e.target.files[0];if(!file)return;e.target.disabled=true;try{if(file.type.startsWith('image/'))await addMedia(await normalizePhoto(file),'image');else if(['video/mp4','video/webm','video/quicktime'].includes(file.type)){if(file.size>8*1024*1024)throw Error('動画は8MB以下の短い動画を選んでください。写真アプリで短く切り出せます。');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('動画を読み込めません'));reader.readAsDataURL(file);});await addMedia(data,'video');}else throw Error('対応する写真またはMP4・MOV・WebM動画を選んでください。');}catch(error){toast(error.message);}finally{e.target.disabled=false;e.target.value='';}}});chooser.removeAttribute('value');return chooser;}
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
  showDialog(el('h2',{},chewed?'かじり跡の記録':p.kind==='video'?'動画の思い出':'写真の思い出'),media,p.kind==='image'&&!chewed?el('button',{class:'ghost wide',onclick:async()=>{if(await save(s=>s.profile.photo=p.data,'ホームの写真に設定しました'))closeDialog();}},'ホームの写真にする'):null,form,el('button',{class:'danger wide',onclick:async()=>{if(await askConfirm('この写真・動画をアルバムから削除しますか？ ホームの写真は残ります。'))if(await save(s=>s.photos=s.photos.filter(x=>x.id!==p.id),'削除しました'))closeDialog();}},'アルバムから削除'));
}
function album(){
  const chewed=albumTab==='chewed';
  const media=[...state.photos].filter(p=>chewed?p.category==='chewed':albumTab==='favorite'?p.favorite:p.kind===albumTab).sort((a,b)=>b.date.localeCompare(a.date)),groups=new Map();
  for(const p of media){const month=p.date.slice(0,7);if(!groups.has(month))groups.set(month,[]);groups.get(month).push(p);}
  return [heading(chewed?'かじり跡アルバム':'アルバム'),tabs([['image','写真'],['video','動画'],['favorite','お気に入り'],['chewed','かじり跡']],albumTab,v=>albumTab=v),chewed?card(el('p',{},'教科書、紙、大切な物についたかじり跡を、写真とメモで残しましょう。'),el('button',{class:'primary wide',onclick:chewedRecordDialog},icon('camera'),'かじった物を写真で残す'),el('p',{class:'muted'},'日付・かじった物・メモを写真と一緒に保存します。すでにある写真も、開いて「かじり跡アルバムに入れる」で追加できます。')):card(label('写真・動画を追加',mediaChooser()),el('p',{class:'muted'},'写真は縮小保存。動画は8MB以下・MP4/MOV/WebM。すべて端末内に保存します。')),media.length?[...groups].map(([month,items])=>el('section',{class:'album-month'},el('h2',{},`${Number(month.slice(0,4))}年${Number(month.slice(5))}月`),el('div',{class:'album-grid'},items.map(p=>el('figure',{class:'photo-card'},el('button',{class:'photo-open','aria-label':p.category==='chewed'?`${p.date}のかじり跡「${p.subject}」を開く`:`${p.date}の${p.kind==='video'?'動画':'写真'}を開く`,onclick:()=>photoDetails(p)},p.kind==='video'?el('video',{src:p.data,preload:'metadata',playsinline:true,'aria-label':'動画のプレビュー'}):el('img',{src:p.data,alt:p.subject||p.caption||'愛鳥の写真',loading:'lazy'}),p.kind==='video'?el('span',{class:'video-mark'},icon('play')):null),el('button',{class:`favorite-button ${p.favorite?'active':''}`,'aria-label':p.favorite?'お気に入りを解除':'お気に入りにする','aria-pressed':p.favorite,onclick:()=>save(s=>{const target=s.photos.find(x=>x.id===p.id);if(target)target.favorite=!target.favorite;},p.favorite?'お気に入りを解除しました':'お気に入りにしました')},'♡'),el('figcaption',{},p.category==='chewed'?[el('strong',{},p.subject),el('small',{},prettyDate(p.date,true))]:p.caption||prettyDate(p.date,true))))))):card(empty(chewed?'まだかじり跡の写真がありません。「かじった物を写真で残す」から記録できます。':albumTab==='favorite'?'♡を押した写真・動画がここに並びます。':'お気に入りの一枚から、思い出を残しましょう。'))];
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
function dueReminders(){const logs=M.day(state.records,today()),now=timeNow();return CARE.filter(type=>{const r=state.settings.reminders[type];return r.enabled&&r.time<=now&&!logs.some(log=>log.type===type);});}
function downloadFile(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function remindersPage(){const controls=CARE.map(type=>{const value=state.settings.reminders[type],check=input(`${type}-enabled`,'checkbox','yes');check.checked=value.enabled;const time=input(`${type}-time`,'time',value.time,{required:true}),interval=select(`${type}-interval`,['1','2','3','7','14','30'].concat([String(value.interval??1)]).filter((v,i,a)=>a.indexOf(v)===i),String(value.interval??1));return el('fieldset',{class:`reminder-setting type-${type}`},el('legend',{},icon(TYPES[type][0]),TYPES[type][1]),label('お知らせを設定する',check),el('div',{class:'row'},label('通知時刻',time),label('何日おき',interval)));});const form=el('form',{},controls,el('button',{type:'submit'},'お知らせ設定を保存'));submitForm(form,async f=>{await save(s=>{for(const type of CARE)s.settings.reminders[type]={enabled:f.has(`${type}-enabled`),time:f.get(`${type}-time`),interval:Number(f.get(`${type}-interval`))};},'設定を保存しました。iPhone通知には下のカレンダー追加も必要です。');});return [heading('お知らせ設定'),el('div',{class:'notice'},'アプリを閉じていても届く通知は、iPhone標準カレンダーを使います。外部の配信サーバーは使いません。'),card(form),card(el('h2',{},'iPhoneに通知を登録'),el('button',{class:'primary wide',onclick:()=>{try{downloadFile(M.calendarFile(state.settings.reminders),'text/calendar;charset=utf-8','kozakura-care-reminders.ics');toast('カレンダー用ファイルを書き出しました。予定を追加し、通知が有効か確認してください。');}catch(e){toast(e.message);}}},icon('calendar'),'カレンダー用ファイルを書き出す'),el('ol',{class:'help-list'},el('li',{},'上の時刻と間隔を保存し、カレンダー用ファイルを書き出します。'),el('li',{},'書き出した .ics をカレンダーで開き、予定を追加します。iPhoneで追加できない場合は、Macのカレンダーに読み込み、iPhoneと同じiCloudカレンダーへ追加します。'),el('li',{},'予定の「通知」と、iPhoneの設定 → 通知 → カレンダーが有効か確認します。'),el('li',{},'時刻を変えるときは、以前追加した繰り返し予定をカレンダーで削除・変更し、二重通知を防いでください。'))),card(el('h2',{},'通知について'),el('p',{class:'muted'},'このアプリではカレンダーへの追加完了やiPhoneの通知許可を確認できません。ファイルの書き出しだけでは通知は始まりません。カレンダーの通知はお世話を記録しても自動では取り消されません。'),el('p',{class:'muted'},'アプリ内では、設定した時刻以降で今日の記録がないお世話を表示します。カレンダーの繰り返し間隔とは別に、今日の実施状況を確認する表示です。'))];}
function menuItem(name,sub,symbol,action,cls=''){return el('button',{class:`menu-item ${cls}`,onclick:action},el('span',{class:'menu-icon'},icon(symbol)),el('span',{},el('strong',{},name),sub?el('small',{},sub):null),icon('arrow'));}
function settings(){return [heading('メニュー'),el('section',{class:'menu-list'},menuItem('インコのイラスト','種類と色を選ぶ','bird',()=>go('appearance'),'type-behavior'),menuItem('プロフィール','うちの子の名前・写真・お迎え日','bird',profileDialog,'type-food'),menuItem('お世話チェックリスト','掃除・水替え・ご飯替え','check',()=>go('care'),'type-clean'),menuItem('産卵・発情の記録','回数や気づいたようすを残す','egg',()=>go('breeding'),'type-egg'),menuItem('通院記録','病院名と受診内容・メモ','medical',()=>go('visits'),'type-visit'),menuItem('健康グラフ','体重・放鳥・食欲・フン・活動量','chart',()=>go('health'),'type-water'),menuItem('データのバックアップ','写真・動画・記録をファイル保存','cloud',()=>go('backup'),'type-water'),menuItem('お知らせ設定','iPhoneカレンダーでお世話を通知','bell',()=>go('reminders'),'type-behavior'),menuItem('アプリについて','使い方・保存とプライバシー','leaf',()=>go('about'),'type-clean'))];}
function backupPage(){const restore=input('backup','file','',{accept:'.json,application/json',onchange:async e=>{await importBackup(e.target.files[0]);e.target.value='';}});restore.removeAttribute('value');return [heading('バックアップ'),card(el('h2',{},'大切な思い出を保存'),el('p',{},`記録 ${state.records.length}件 / 写真・動画 ${state.photos.length}件`),el('button',{class:'primary wide',onclick:exportBackup},icon('download'),'バックアップを書き出す'),el('p',{class:'muted'},'写真・動画を含むJSONファイルです。「ファイル」アプリやiCloud Driveなど、保存先への保存完了を確認してください。'),el('p',{class:'muted'},state.lastBackup?`最終書き出し操作：${new Date(state.lastBackup).toLocaleString('ja-JP')}`:'まだ書き出していません。'),label('バックアップから復元',restore),el('p',{class:'muted'},'復元は現在のデータを置き換えます。旧版v1のバックアップも読み込めます。実行中のタイマーは復元しません。'))];}
function aboutPage(){return [heading('アプリについて'),card(el('h2',{},'コザボタ日和'),el('p',{},'小さな変化も、大切な思い出も。愛鳥と過ごす毎日をやさしく記録します。')),card(el('h2',{},'iPhoneで使う'),el('ol',{class:'help-list'},el('li',{},'Safariで公開URLを開き、共有 → ホーム画面に追加。'),el('li',{},'ホーム画面から起動し「オフライン準備完了」を確認。'),el('li',{},'プロフィールに愛鳥の名前と好きな写真を設定。'),el('li',{},'機内モードでも起動・保存できるか実機で確認。'))),card(el('h2',{},'保存とプライバシー'),el('p',{},'写真・動画・プロフィール・飼育記録はこの端末のIndexedDBに保存し、サーバーやGitHubに送信しません。別の人とは共有・同期されません。同じ端末・同じブラウザを共用するとデータも共用されます。'),el('p',{},'写真と動画は合計100件、記録50,000件、データ全体約38MBまで。動画は1本8MB以下です。容量不足時は保存エラーを表示します。'),el('p',{},'ホーム画面アプリとSafari、別ブラウザでは保存場所が異なる場合があります。使う場所を統一し、週1回や大切な記録の後にバックアップしてください。Webサイトデータの削除、故障・機種変更、OSの整理で記録が失われる場合があります。'),el('p',{},'初期イラストはこのアプリのオリジナルです。自分が利用する権利のある写真・動画を選んでください。動画は元ファイルを端末内に保存するため、位置情報等のメタデータが含まれる場合があります。バックアップを共有する前に内容を確認してください。'),el('p',{},'広告・解析・課金APIはありません。公開サーバーにはアクセス時の通信情報が残る場合があります。カレンダー用ファイルの追加・同期はカレンダーアプリの設定に従います。')),el('div',{class:'notice'},'このアプリは観察の記録用です。診断や適正体重の判定はしません。気になる変化は記録を持って、鳥を診られる獣医師に相談してください。')];}
function breedingPage(){return [heading('産卵・発情の記録'),el('div',{class:'row'},el('button',{class:'primary',onclick:()=>recordForm('egg')},icon('egg'),'産卵を記録'),el('button',{class:'ghost',onclick:()=>recordForm('estrus')},icon('heart'),'発情のようす')),card(recordList(sortedRecords().filter(r=>['egg','estrus'].includes(r.type)).slice(0,40)))];}
function visitsPage(){return [heading('通院記録'),el('button',{class:'primary wide',onclick:()=>recordForm('visit')},icon('medical'),'通院を記録する'),card(recordList(sortedRecords().filter(r=>r.type==='visit').slice(0,40)))];}
function render(){setupHeader();route=location.hash.slice(1)||'home';const pages={home,records,calendar,album,settings,appearance:appearancePage,timer:timerPage,weight:weightPage,behavior:behaviorPage,care:carePage,health:healthPage,reminders:remindersPage,backup:backupPage,about:aboutPage,breeding:breedingPage,visits:visitsPage};if(!pages[route])route='home';$('main').replaceChildren(...pages[route]().flat(Infinity).filter(node=>node!==null&&node!==undefined));const nav=document.querySelector('.bottom-nav');nav.replaceChildren(navLink('home','ホーム','home'),navLink('records','記録','note'),navLink('calendar','カレンダー','calendar'),navLink('album','アルバム','camera'),navLink('settings','メニュー','menu'));const active=['timer'].includes(route)?'home':['weight','behavior','care','health','breeding','visits'].includes(route)?'records':['reminders','backup','about','appearance'].includes(route)?'settings':route;for(const a of nav.querySelectorAll('a'))if(a.hash===`#${active}`)a.setAttribute('aria-current','page');connection();}
function setupHeader(){const header=document.querySelector('.site-header');header.replaceChildren(el('a',{href:'#home',class:'brand'},icon('bird'),el('span',{},'コザボタ日和',el('small',{},'愛鳥と暮らす日々'))),el('div',{class:'header-tools'},el('span',{id:'connection',class:'connection-dot','aria-label':'接続状態'}),el('button',{class:'icon-button','aria-label':'お知らせ設定',onclick:()=>go('reminders')},icon('bell')),el('button',{class:'icon-button','aria-label':'メニュー',onclick:()=>go('settings')},icon('menu'))));}
function connection(){const node=$('connection');if(node){node.title=navigator.onLine?'端末内に保存':'オフライン';node.setAttribute('aria-label',node.title);node.classList.toggle('offline',!navigator.onLine);}}
setupHeader();

$('close-dialog').addEventListener('click',closeDialog);
window.addEventListener('hashchange',()=>{behaviorOrderDraft=null;recordPage=0;render();window.scrollTo(0,0);});
window.addEventListener('online',connection);window.addEventListener('offline',connection);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&db)refresh().then(updateTimerDisplay);});
if(channel)channel.onmessage=()=>refresh();
setInterval(updateTimerDisplay,1000);
init();
