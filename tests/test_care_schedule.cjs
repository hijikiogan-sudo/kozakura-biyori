const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
const plan={enabled:true,time:'08:00',extraTimes:['18:00'],interval:2,startDate:'2026-10-20'};
const reminders=()=>({...M.blank().settings.reminders,water:{...plan}});
const log=(time,extra={})=>({id:'log-'+time,type:'water',date:'2026-10-20',time,note:'',createdAt:'2026-10-20T00:00:00Z',...extra});
test('anchor controls alternate days and dates before start have no tasks',()=>{
 assert.equal(M.nextCareDate(plan,'2026-10-19'),'2026-10-20');
 assert.equal(M.nextCareDate(plan,'2026-10-21'),'2026-10-22');
 assert.equal(M.careTasks(reminders(),[],'2026-10-19').length,0);
 assert.equal(M.careTasks(reminders(),[],'2026-10-21').length,0);
 assert.equal(M.careTasks(reminders(),[],'2026-10-22').length,2);
});
test('morning record never completes evening; explicit early completion belongs to its own slot',()=>{
 let tasks=M.careTasks(reminders(),[log('08:30'),log('09:00')],'2026-10-20','19:00');
 assert.deepEqual(tasks.map(t=>[t.time,t.done,t.due]),[['08:00',true,true],['18:00',false,true]]);
 tasks=M.careTasks(reminders(),[log('07:00'),log('09:00',{careSlot:'18:00'})],'2026-10-20','09:00');
 assert(tasks.every(t=>t.done));
});
test('old untimed records are interpreted in local time and daily schedule is preserved',()=>{
 const r=reminders();r.water.interval=1;
 const old=log('08:30');delete old.time;
 old.createdAt=new Date('2026-10-20T08:30:00').toISOString();
 assert.deepEqual(M.careTasks(r,[old],'2026-10-20','09:00').map(t=>t.done),[true,false]);
 assert.equal(M.careTasks(r,[],'2026-10-21').length,2);
});
test('ICS emits one stable private-data-free recurring event per time and preserves interval phase',()=>{
 const data=reminders();data.water.profile='private-bird';
 const now=new Date('2026-10-20T09:00:00');
 const text=M.calendarFile(data,now).replace(/\r\n /g,'');
 assert.equal(text.split('BEGIN:VEVENT').length-1,2);
 assert.match(text,/UID:kozakura-water@kozakura-biyori.local/);
 assert.match(text,/UID:kozakura-water-1800@kozakura-biyori.local/);
 assert.match(text,/DTSTART:20261022T080000/);
 assert.match(text,/DTSTART:20261020T180000/);
 assert.equal(text.split('RRULE:FREQ=DAILY;INTERVAL=2').length-1,2);
 assert(!text.includes('private-bird'));
 for(const line of M.calendarFile(data,now).split('\r\n'))assert(Buffer.byteLength(line)<=75);
});
test('backup round trip preserves schedule and per-slot completion; v1 gets missing defaults',()=>{
 const state=M.blank();state.settings.reminders=reminders();state.records=[log('07:50',{careSlot:'08:00'})];
 const restored=M.validateBackup({app:'kozakura-biyori',version:2,data:state});
 assert.deepEqual(restored.settings.reminders.water,plan);
 assert.equal(restored.records[0].careSlot,'08:00');
 const old=M.blank();old.settings.reminders.water={enabled:true,time:'07:00',interval:3};
 const legacy=M.validateBackup({app:'kozakura-biyori',version:1,data:old});
 assert.equal(legacy.settings.reminders.water.time,'07:00');
 assert.equal(legacy.settings.reminders.water.interval,3);
 assert.deepEqual(legacy.settings.reminders.water.extraTimes,[]);
 assert(M.validDate(legacy.settings.reminders.water.startDate));
});
test('invalid extra times, dates, intervals and non-care completion fields are rejected',()=>{
 for(const patch of [{extraTimes:['08:00']},{extraTimes:['18:00','18:00']},{extraTimes:['09:00','12:00','18:00']},{extraTimes:['25:00']},{extraTimes:'18:00'},{startDate:'2026-02-30'},{interval:0},{interval:31}]){
  assert.throws(()=>M.validateReminder({...plan,...patch}));
  const state=M.blank();state.settings.reminders.water={...plan,...patch};
  assert.throws(()=>M.validateBackup({app:'kozakura-biyori',version:2,data:state}));
 }
 assert.throws(()=>M.validateRecord({...log('09:00'),type:'note',careSlot:'08:00'}));
});
