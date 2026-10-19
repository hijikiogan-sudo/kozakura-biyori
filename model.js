'use strict';
// Pure data rules. Existing v1 records and the database name remain compatible.
const KozakuraModel = (() => {
  const TYPES = {health:['leaf','健康'],weight:['scale','体重'],flight:['bird','放鳥'],egg:['egg','産卵'],behavior:['heart','行動'],clean:['broom','掃除'],water:['drop','水替え'],food:['bowl','ご飯替え'],visit:['medical','通院'],estrus:['heart','発情'],note:['note','メモ']};
  const BEHAVIORS = ['甘える','噛む','鳴く','紙ちぎり','羽づくろい','水浴び','よく遊ぶ','落ち着かない','よく寝ている','ご飯を食べる','水を飲む','くちばしギョリギョリ'];
  const DEFAULT_BEHAVIOR_ORDER = ['ご飯を食べる','水を飲む','羽づくろい','鳴く','くちばしギョリギョリ','よく遊ぶ','よく寝ている','甘える','噛む','紙ちぎり','水浴び','落ち着かない'];
  const BIRD_APPEARANCES = [
  {
    "id": "lovebird-green",
    "species": "lovebird",
    "label": "コザクラインコ",
    "color": "グリーン",
    "body": "#8eb990",
    "wing": "#6d9e77",
    "tail": "#78a781",
    "face": "#f2cfb4",
    "beak": "#cf815f",
    "collar": "#e8cf77"
  },
  {
    "id": "lovebird-yellow",
    "species": "lovebird",
    "label": "コザクラインコ",
    "color": "イエロー",
    "body": "#e9d979",
    "wing": "#c6bb63",
    "tail": "#d6c86c",
    "face": "#f1b07f",
    "beak": "#d77d5d",
    "collar": "#e8cf77"
  },
  {
    "id": "lovebird-aqua",
    "species": "lovebird",
    "label": "コザクラインコ",
    "color": "アクア",
    "body": "#93c5b8",
    "wing": "#6aa897",
    "tail": "#76b3a5",
    "face": "#f1d4b7",
    "beak": "#d19a7c",
    "collar": "#edf0e9"
  },
  {
    "id": "lovebird-blue",
    "species": "lovebird",
    "label": "コザクラインコ",
    "color": "ブルー",
    "body": "#91b9d5",
    "wing": "#6c96bb",
    "tail": "#729dbf",
    "face": "#f1eadf",
    "beak": "#c7a18b",
    "collar": "#edf0e9"
  },
  {
    "id": "lovebird-white",
    "species": "lovebird",
    "label": "コザクラインコ",
    "color": "ホワイト",
    "body": "#e6e6df",
    "wing": "#bec9c5",
    "tail": "#cbd4cf",
    "face": "#f4e9df",
    "beak": "#d1a58d",
    "collar": "#edf0e9"
  },
  {
    "id": "lovebird-violet",
    "species": "lovebird",
    "label": "コザクラインコ",
    "color": "バイオレット",
    "body": "#b3a4cc",
    "wing": "#8c80b1",
    "tail": "#9c8ebb",
    "face": "#ece5ed",
    "beak": "#c69d90",
    "collar": "#edf0e9"
  },
  {
    "id": "button-green",
    "species": "button",
    "label": "ボタンインコ",
    "color": "グリーン",
    "body": "#9ab77c",
    "wing": "#7e9d68",
    "tail": "#79a57a",
    "face": "#4b4e4b",
    "beak": "#d88a68",
    "collar": "#e8cf77"
  },
  {
    "id": "button-yellow",
    "species": "button",
    "label": "ボタンインコ",
    "color": "イエロー",
    "body": "#e9d979",
    "wing": "#c6bb63",
    "tail": "#d6c86c",
    "face": "#4b4e4b",
    "beak": "#d88a68",
    "collar": "#e8cf77"
  },
  {
    "id": "button-aqua",
    "species": "button",
    "label": "ボタンインコ",
    "color": "アクア",
    "body": "#93c5b8",
    "wing": "#6aa897",
    "tail": "#76b3a5",
    "face": "#4b4e4b",
    "beak": "#d88a68",
    "collar": "#edf0e9"
  },
  {
    "id": "button-blue",
    "species": "button",
    "label": "ボタンインコ",
    "color": "ブルー",
    "body": "#91b9d5",
    "wing": "#6c96bb",
    "tail": "#729dbf",
    "face": "#4b4e4b",
    "beak": "#d88a68",
    "collar": "#edf0e9"
  },
  {
    "id": "button-white",
    "species": "button",
    "label": "ボタンインコ",
    "color": "ホワイト",
    "body": "#e6e6df",
    "wing": "#bec9c5",
    "tail": "#cbd4cf",
    "face": "#4b4e4b",
    "beak": "#d88a68",
    "collar": "#edf0e9"
  },
  {
    "id": "button-violet",
    "species": "button",
    "label": "ボタンインコ",
    "color": "バイオレット",
    "body": "#b3a4cc",
    "wing": "#8c80b1",
    "tail": "#9c8ebb",
    "face": "#4b4e4b",
    "beak": "#d88a68",
    "collar": "#edf0e9"
  }
];
  function behaviorOrder(order){
    const selected=Array.isArray(order)?[...new Set(order.filter(name=>BEHAVIORS.includes(name)))]:[];
    return [...selected,...DEFAULT_BEHAVIOR_ORDER.filter(name=>!selected.includes(name))];
  }
  const LEVEL = ['いつもどおり','少なめ','多め','気になる'];
  const CARE = ['clean','water','food'];
  function date(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function addDays(value,n){const d=new Date(`${value}T12:00:00`);d.setDate(d.getDate()+n);return date(d);}
  function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<'1900-01-01'||s>'2100-12-31')return false;const d=new Date(`${s}T12:00:00Z`);return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
  function validTime(s){return typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);}
  function blank(){return {profile:{name:'',sex:'不明',age:'',photo:null,joined:'',cover:{layout:'standard',x:50,y:42,zoom:1,comment:'今日も\nいっしょに。'}},records:[],photos:[],timer:null,lastBackup:null,settings:{behaviorOrder:[...DEFAULT_BEHAVIOR_ORDER],behaviorOrderVersion:2,birdAppearance:'lovebird-green',reminders:{clean:{enabled:false,interval:1,time:'09:00'},water:{enabled:false,interval:1,time:'08:00'},food:{enabled:false,interval:1,time:'08:00'}}}};}
  function normalize(raw){const d=structuredClone(raw||blank()),defaults=blank(),legacyOrder=d.settings?.behaviorOrderVersion===undefined&&Array.isArray(d.settings?.behaviorOrder)&&d.settings.behaviorOrder.length===BEHAVIORS.length&&d.settings.behaviorOrder.every((name,index)=>name===BEHAVIORS[index]);d.profile={...defaults.profile,...d.profile};d.profile.cover={...defaults.profile.cover,...d.profile.cover};d.records=d.records||[];d.photos=(d.photos||[]).map(p=>({kind:'image',favorite:false,...p}));d.settings={...defaults.settings,...d.settings};d.settings.behaviorOrder=behaviorOrder(legacyOrder?null:d.settings.behaviorOrder);d.settings.behaviorOrderVersion=2;if(!BIRD_APPEARANCES.some(bird=>bird.id===d.settings.birdAppearance))d.settings.birdAppearance='lovebird-green';d.settings.reminders={...defaults.settings.reminders,...d.settings.reminders};for(const type of CARE)d.settings.reminders[type]={...defaults.settings.reminders[type],...d.settings.reminders[type]};return d;}
  const text=(v,n=1000)=>typeof v==='string'&&v.length<=n;
  const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  const photo=v=>v===null||(text(v,2_000_000)&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v));
  function validateCover(cover){
    if(!cover||typeof cover!=='object'||Array.isArray(cover)||!['standard','wide','portrait'].includes(cover.layout)||!num(cover.x,0,100)||!num(cover.y,0,100)||!num(cover.zoom,1,3)||!text(cover.comment,40))throw Error('ホーム写真の設定が正しくありません');
    return {layout:cover.layout,x:cover.x,y:cover.y,zoom:cover.zoom,comment:cover.comment};
  }
  function validateRecord(r){if(!r||!Object.hasOwn(TYPES,r.type)||!text(r.id,100)||!validDate(r.date)||!text(r.note)||!text(r.createdAt,40)||!Number.isFinite(Date.parse(r.createdAt)))throw Error('記録の形式が正しくありません');const out={id:r.id,type:r.type,date:r.date,note:r.note,createdAt:r.createdAt};if(r.time!==undefined){if(!validTime(r.time))throw Error('記録時刻が正しくありません');out.time=r.time;}
    switch(r.type){
      case 'weight':if(!num(r.value,.1,2000))throw Error('体重の値が正しくありません');out.value=r.value;break;
      case 'flight':if(!num(r.minutes,.1,10080))throw Error('放鳥時間が正しくありません');out.minutes=r.minutes;for(const key of ['startedAt','endedAt'])if(r[key]!==undefined){if(!num(r[key],0,9e15))throw Error('放鳥時刻が正しくありません');out[key]=r[key];}break;
      case 'health':for(const key of ['appetite','droppings','activity']){if(!LEVEL.includes(r[key]))throw Error('健康記録が正しくありません');out[key]=r[key];}break;
      case 'egg':if(!Number.isInteger(r.count)||!num(r.count,1,100)||!['未確認','いつもどおり','気になる'].includes(r.condition))throw Error('産卵記録が正しくありません');Object.assign(out,{count:r.count,condition:r.condition});break;
      case 'behavior':if(!text(r.behavior,40))throw Error('行動記録が正しくありません');out.behavior=r.behavior;break;
      case 'visit':for(const key of ['clinic','reason']){if(!text(r[key],200))throw Error('通院記録が正しくありません');out[key]=r[key];}break;
      case 'estrus':if(!text(r.sign,100))throw Error('発情記録が正しくありません');out.sign=r.sign;break;
    }return out;
  }
  function validateBackup(raw){if(!raw||raw.app!=='kozakura-biyori'||![1,2].includes(raw.version)||!raw.data)throw Error('コザボタ日和のバックアップを選んでください');const incoming=raw.data.settings;if(incoming?.birdAppearance!==undefined&&!BIRD_APPEARANCES.some(bird=>bird.id===incoming.birdAppearance))throw Error('インコのイラスト設定が正しくありません');if(incoming?.behaviorOrder!==undefined&&(!Array.isArray(incoming.behaviorOrder)||incoming.behaviorOrder.some(name=>!BEHAVIORS.includes(name))||new Set(incoming.behaviorOrder).size!==incoming.behaviorOrder.length))throw Error('行動の並び順が正しくありません');const d=normalize(raw.data),p=d.profile;if(!text(p.name,40)||!['不明','オス','メス'].includes(p.sex)||!text(p.age,40)||!photo(p.photo)||!(p.joined===''||validDate(p.joined))||!Array.isArray(d.records)||d.records.length>50000||!Array.isArray(d.photos)||d.photos.length>100)throw Error('バックアップの内容が正しくありません');const ids=new Set();const records=d.records.map(r=>{const value=validateRecord(r);if(ids.has(r.id))throw Error('記録IDが重複しています');ids.add(r.id);return value;});const photoIds=new Set();const photos=d.photos.map(p=>{if(!p||!text(p.id,100)||photoIds.has(p.id)||!validDate(p.date)||!['image','video'].includes(p.kind)||typeof p.favorite!=='boolean'||!text(p.caption||'',200))throw Error('アルバムの内容が正しくありません');if(p.kind==='image'&&(!photo(p.data)||p.data===null))throw Error('画像の形式が正しくありません');if(p.kind==='video'&&(!text(p.data,12_000_000)||!/^data:video\/(mp4|webm|quicktime);base64,[A-Za-z0-9+/]+={0,2}$/.test(p.data)))throw Error('動画の形式が正しくありません');photoIds.add(p.id);const details={};if(p.category!==undefined||p.subject!==undefined){const category=p.category??'general',subject=p.subject??'';if(!['general','chewed'].includes(category)||!text(subject,80)||(category==='chewed'&&(p.kind!=='image'||!subject.trim())))throw Error('かじり跡アルバムの内容が正しくありません');Object.assign(details,{category,subject});}return {id:p.id,date:p.date,data:p.data,kind:p.kind,favorite:p.favorite,caption:p.caption||'',...details};});const settings=blank().settings;settings.behaviorOrder=[...d.settings.behaviorOrder];settings.birdAppearance=d.settings.birdAppearance;for(const type of CARE){const r=d.settings.reminders[type];if(typeof r.enabled!=='boolean'||!validTime(r.time))throw Error('お知らせ時刻が正しくありません');const interval=r.interval??1;if(!Number.isInteger(interval)||interval<1||interval>30)throw Error('繰り返し間隔が正しくありません');settings.reminders[type]={enabled:r.enabled,time:r.time,interval};}return {profile:{name:p.name,sex:p.sex,age:p.age,photo:p.photo,joined:p.joined,cover:validateCover(p.cover)},records,photos,timer:null,lastBackup:null,settings};}
  function localTime(r){return r.time||new Date(r.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}
  function sorted(records){return [...records].sort((a,b)=>b.date.localeCompare(a.date)||localTime(b).localeCompare(localTime(a))||b.createdAt.localeCompare(a.createdAt));}
  function summary(r){switch(r.type){case 'weight':return `${r.value} g`;case 'flight':return `${r.minutes} 分`;case 'egg':return `${r.count} 個 · ${r.condition}`;case 'behavior':return r.behavior;case 'health':return `食欲：${r.appetite} / フン：${r.droppings} / 活動量：${r.activity}`;case 'visit':return [r.clinic,r.reason].filter(Boolean).join(' · ')||'通院';case 'estrus':return r.sign;case 'note':return r.note||'メモ';default:return 'お世話をしました';}}
  function day(records,value=date()){return sorted(records.filter(r=>r.date===value));}
  function period(records,days,until=date()){const from=addDays(until,1-days);return records.filter(r=>r.date>=from&&r.date<=until);}
  function chartData(records,metric,days,until=date()){const source=period(records,days,until),groups=new Map();for(const r of source){let value;if(metric==='weight'&&r.type==='weight')value=r.value;else if(metric==='flight'&&r.type==='flight')value=r.minutes;else if(['appetite','droppings','activity'].includes(metric)&&r.type==='health')value={'少なめ':1,'いつもどおり':2,'多め':3,'気になる':null}[r[metric]];else continue;if(!groups.has(r.date))groups.set(r.date,[]);groups.get(r.date).push({value,createdAt:r.createdAt,time:localTime(r)});}return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>{items.sort((a,b)=>a.time.localeCompare(b.time)||a.createdAt.localeCompare(b.createdAt));return {date,value:metric==='flight'?Math.round(items.reduce((s,r)=>s+r.value,0)*10)/10:items.at(-1).value};});}

  function calendarFile(reminders,now=new Date()){const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kozakura Biyori//Care Reminders//JA','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:コザボタ日和のお世話'];for(const type of CARE){const r=reminders[type];if(!r?.enabled)continue;if(!validTime(r.time)||!Number.isInteger(r.interval)||r.interval<1||r.interval>30)throw Error('通知の時刻と間隔を確認してください');let start=date(now);if(r.time<=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`)start=addDays(start,1);lines.push('BEGIN:VEVENT',`UID:kozakura-${type}@kozakura-biyori.local`,`DTSTAMP:${now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART:${start.replace(/-/g,'')}T${r.time.replace(':','')}00`,'DURATION:PT5M',`RRULE:FREQ=DAILY;INTERVAL=${r.interval}`,`SUMMARY:コザボタ日和・${TYPES[type][1]}`, 'DESCRIPTION:愛鳥のお世話の時間です。実施後はコザボタ日和で記録してください。','BEGIN:VALARM','TRIGGER:PT0S','ACTION:DISPLAY',`DESCRIPTION:${TYPES[type][1]}の時間です`,'END:VALARM','END:VEVENT');}if(!lines.includes('BEGIN:VEVENT'))throw Error('通知したいお世話を1つ以上選んでください');lines.push('END:VCALENDAR');return calendarText(lines);}
  function calendarText(lines){return lines.map(line=>{const result=[];let chunk='',size=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(size+bytes>74){result.push(chunk);chunk=' ';size=1;}chunk+=char;size+=bytes;}result.push(chunk);return result.join('\r\n');}).join('\r\n')+'\r\n';}
  function timerCalendarFile(timer,now=new Date()){
    if(!timer||!num(timer.startedAt,0,8.64e15)||!Number.isInteger(timer.durationSeconds)||!num(timer.durationSeconds,1,86400))throw Error('実行中のカウントダウンを確認してください');
    const end=new Date(timer.startedAt+timer.durationSeconds*1000);
    if(!Number.isFinite(+end)||!Number.isFinite(+now)||+end<=+now)throw Error('設定時間を過ぎています。新しいタイマーで設定してください');
    const stamp=date=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    return calendarText(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kozakura Biyori//Flight Timer//JA','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:kozakura-flight-${timer.startedAt}@kozakura-biyori.local`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(end)}`,'DURATION:PT1M','SUMMARY:コザボタ日和・放鳥の設定時間です','DESCRIPTION:愛鳥を確認し、放鳥を終えたらアプリで終了を記録してください。タイマーを取り消した場合は、この予定もカレンダーから削除してください。','BEGIN:VALARM','TRIGGER:PT0S','ACTION:DISPLAY','DESCRIPTION:放鳥の設定時間になりました','END:VALARM','END:VEVENT','END:VCALENDAR']);
  }
  return Object.freeze({DEFAULT_BEHAVIOR_ORDER,BIRD_APPEARANCES,behaviorOrder,validateCover,timerCalendarFile,calendarFile,TYPES,BEHAVIORS,LEVEL,CARE,date,addDays,validDate,validTime,blank,normalize,validateRecord,validateBackup,photo,sorted,summary,day,period,chartData});
})();
if(typeof module!=='undefined')module.exports=KozakuraModel;
