const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../platform.js');
const now=1792500000000;
const timer={startedAt:now,durationSeconds:900};
function fixture(permission='granted'){
 const calls=[];
 const bridge={
  async getPermission(){return permission;},
  async requestPermission(){calls.push(['permission']);return permission;},
  async replaceTimerNotification(request){calls.push(['replace',request]);},
  async cancelTimerNotification(request){calls.push(['cancel',request]);}
 };
 return {calls,bridge,service:P.createTimerNotifications({bridge,now:()=>now})};
}
test('web adapter stays unavailable without requesting permission or claiming a reservation',async()=>{
 const service=P.createTimerNotifications();
 assert.equal(service.available,false);
 assert.deepEqual(await service.sync(timer),{state:'unavailable'});
 assert.equal(await service.requestPermission(),'unavailable');
 assert.equal(P.createTimerNotifications({bridge:{getPermission(){throw Error();}}}).available,false);
});
test('reservation has the original absolute deadline and excludes private state',()=>{
 const request=P.timerRequest({...timer,profile:{name:'private'},photos:['private'],note:'private'},now);
 assert.deepEqual(request,{id:104001,deadline:now+900000,title:'コザボタ日和',body:'放鳥の設定時間になりました。愛鳥を確認してください。',sound:'default'});
 for(const value of [null,{startedAt:now}, {...timer,durationSeconds:0},{...timer,durationSeconds:Infinity},{...timer,startedAt:NaN},{...timer,startedAt:now-900000}]) assert.equal(P.timerRequest(value,now),null);
});
test('schedule, duplicate sync, early finish and restart use one reserved ID',async()=>{
 const {service,calls}=fixture();
 await service.sync(timer);await service.sync(timer);
 await service.sync(null);await service.sync(null);
 await service.sync({...timer,startedAt:now+1});
 assert.deepEqual(calls.map(c=>c[0]),['replace','cancel','replace']);
 assert(calls.every(c=>c[1].id===104001));
 assert.equal(service.getStatus().state,'scheduled');
 assert.equal(calls[2][1].deadline,now+900001);
});
test('denial cancels a stale reservation without asking permission implicitly',async()=>{
 const {service,calls}=fixture('denied');
 assert.equal((await service.sync(timer)).state,'denied');
 assert.deepEqual(calls,[['cancel',{id:104001}]]);
 assert.equal(await service.requestPermission(),'denied');
 assert.equal(calls.at(-1)[0],'permission');
});
test('native errors become status, recover on retry, and never reject a data operation',async()=>{
 const {service,bridge,calls}=fixture();
 bridge.replaceTimerNotification=async()=>{throw Error('OS failure');};
 assert.equal((await service.sync(timer)).state,'error');
 bridge.replaceTimerNotification=async request=>calls.push(['replace',request]);
 assert.equal((await service.sync(timer)).state,'scheduled');
 bridge.cancelTimerNotification=async()=>{throw Error('OS failure');};
 assert.equal((await service.sync(null)).state,'error');
 bridge.requestPermission=async()=>{throw Error('OS failure');};
 assert.equal(await service.requestPermission(),'error');
});
test('queued cancellation follows an in-flight schedule; request snapshots cannot be mutated',async()=>{
 const {service,bridge,calls}=fixture();
 let release;
 bridge.replaceTimerNotification=async r=>{calls.push(['replace',r]);await new Promise(resolve=>release=resolve);};
 const mutable={...timer};
 const first=service.sync(mutable);mutable.durationSeconds=1;
 const second=service.sync(null);
 await new Promise(resolve=>setImmediate(resolve));
 release();await Promise.all([first,second]);
 assert.deepEqual(calls.map(c=>c[0]),['replace','cancel']);
 assert.equal(calls[0][1].deadline,now+900000);
 assert.equal(service.getStatus().state,'idle');
});
test('restored running timer schedules its original deadline and expired timer cancels',async()=>{
 const a=fixture();await a.service.sync(timer);
 const b=fixture();await b.service.sync(timer);
 assert.deepEqual(a.calls,b.calls);
 await b.service.sync({...timer,startedAt:now-900000});
 assert.equal(b.calls.at(-1)[0],'cancel');
});
test('deadline is rechecked after an asynchronous permission lookup',async()=>{
 const {bridge,calls}=fixture();let current=now;
 bridge.getPermission=async()=>{current+=900000;return 'granted';};
 const service=P.createTimerNotifications({bridge,now:()=>current});
 assert.equal((await service.sync(timer)).state,'idle');
 assert.deepEqual(calls,[['cancel',{id:104001}]]);
});
