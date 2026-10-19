const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
const timer={startedAt:Date.parse('2026-10-19T23:55:00Z'),durationSeconds:900};
const now=new Date('2026-10-19T23:56:00Z');
const unfold=s=>s.replace(/\r\n /g,'');

test('one-off timer alarm uses the original absolute deadline across midnight',()=>{
  const ics=unfold(M.timerCalendarFile(timer,now));
  assert.match(ics,/DTSTART:20261020T001000Z\r\n/);
  assert.match(ics,/DTSTAMP:20261019T235600Z\r\n/);
  assert.match(ics,/BEGIN:VALARM\r\nTRIGGER:PT0S\r\nACTION:DISPLAY/);
  assert.equal(ics.split('BEGIN:VEVENT').length-1,1);
  assert(!ics.includes('RRULE:'));
  assert(ics.endsWith('END:VCALENDAR\r\n'));
});

test('re-exporting keeps the timer UID and deadline; different timers have different UIDs',()=>{
  const fields=s=>s.match(/^(UID|DTSTART):.+$/gm);
  const first=fields(M.timerCalendarFile(timer,now));
  assert.deepEqual(first,fields(M.timerCalendarFile(timer,new Date('2026-10-19T23:58:00Z'))));
  assert.notDeepEqual(first,fields(M.timerCalendarFile({...timer,startedAt:timer.startedAt+1},now)));
});

test('folded ICS stays within byte limits and excludes private application data',()=>{
  const ics=M.timerCalendarFile({...timer,profile:{name:'private-bird'},records:[{note:'private-note'}],photos:['private-image']},now);
  for(const line of ics.split('\r\n'))assert(Buffer.byteLength(line,'utf8')<=75);
  assert(!ics.includes('private-'));
  assert.match(unfold(ics),/タイマーを取り消した場合は、この予定もカレンダーから削除してください/);
});

test('expired, countup, malformed and overflowing timers cannot export future alarms',()=>{
  const invalid=[null,{startedAt:timer.startedAt}, {...timer,durationSeconds:0}, {...timer,durationSeconds:Infinity}, {...timer,durationSeconds:86401}, {...timer,startedAt:NaN}, {...timer,startedAt:8.64e15}];
  for(const t of invalid)assert.throws(()=>M.timerCalendarFile(t,now));
  assert.throws(()=>M.timerCalendarFile(timer,new Date('2026-10-20T00:10:00Z')),/設定時間を過ぎ/);
});

test('existing recurring care alarms retain folding, recurrence and event alarms',()=>{
  const reminders=M.blank().settings.reminders;
  reminders.water={enabled:true,time:'08:00',interval:2};
  const ics=unfold(M.calendarFile(reminders,now));
  assert.match(ics,/RRULE:FREQ=DAILY;INTERVAL=2/);
  assert.match(ics,/BEGIN:VALARM\r\nTRIGGER:PT0S\r\nACTION:DISPLAY/);
  assert.equal(ics.split('BEGIN:VEVENT').length-1,1);
});
