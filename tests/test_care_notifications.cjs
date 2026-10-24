const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
const P=require('../platform.js');

function reminders(overrides={}){
 const r=structuredClone(M.blank().settings.reminders);
 r.food={enabled:true,interval:1,time:'08:00',extraTimes:['18:00'],startDate:'2026-10-20'};
 return Object.assign(r,overrides);
}
const now=new Date('2026-10-24T08:30:00');

test('plan skips past and already-done slots and uses stable ids',()=>{
 const done=[{id:'d',type:'food',date:'2026-10-24',time:'07:50',note:'',createdAt:'2026-10-24T07:50:00Z'}];
 const plan=M.careNotificationPlan(reminders(),done,new Date('2026-10-24T07:55:00'),{days:2});
 assert.deepEqual(plan.map(p=>new Date(p.at).getHours()),[18,8,18]);
 assert.equal(new Set(plan.map(p=>p.id)).size,plan.length);
 assert.ok(plan.every(p=>p.id>=200000&&p.id<210000));
 assert.deepEqual(M.careNotificationPlan(reminders(),[],new Date('2026-10-24T07:55:00'),{days:2}).map(p=>p.id).slice(1),plan.map(p=>p.id));
 assert.equal(plan[0].body,'ご飯替えの時間です（18:00）');
});
test('plan follows the day interval and is capped for the iOS pending limit',()=>{
 const every3=reminders({food:{enabled:true,interval:3,time:'09:00',extraTimes:[],startDate:'2026-10-24'}});
 assert.deepEqual(M.careNotificationPlan(every3,[],now,{days:10}).map(p=>new Date(p.at).getDate()),[24,27,30,2]);
 const busy=reminders({water:{enabled:true,interval:1,time:'07:00',extraTimes:['12:00','20:00'],startDate:'2026-10-01'},clean:{enabled:true,interval:1,time:'10:00',extraTimes:['15:00','21:00'],startDate:'2026-10-01'}});
 assert.equal(M.careNotificationPlan(busy,[],now).length,60);
 assert.deepEqual(M.careNotificationPlan(M.blank().settings.reminders,[],now),[]);
});

function bridge(permission='granted'){
 const calls=[];
 return {calls,bridge:{
  async getPermission(){return permission;},
  async requestPermission(){calls.push('permission');return permission;},
  async replaceCareNotifications(plan){calls.push(['replace',plan]);}
 }};
}
test('care service is unavailable on the web',async()=>{
 const service=P.createCareNotifications();
 assert.equal(service.available,false);
 assert.deepEqual(await service.sync([]),{state:'unavailable'});
 assert.equal(await service.requestPermission(),'unavailable');
});
test('care service waits for permission and never asks by itself',async()=>{
 const {calls,bridge:b}=bridge('prompt');
 const service=P.createCareNotifications({bridge:b});
 assert.deepEqual(await service.sync(M.careNotificationPlan(reminders(),[],now)),{state:'prompt'});
 assert.deepEqual(calls,[]);
});
test('care service sends only whitelisted fields and skips unchanged plans',async()=>{
 const {calls,bridge:b}=bridge('granted');
 const service=P.createCareNotifications({bridge:b});
 const plan=M.careNotificationPlan(reminders(),[],now,{days:1}).map(p=>({...p,note:'秘密のメモ',name:'ぴぴ'}));
 const status=await service.sync(plan);
 assert.equal(status.state,'scheduled');
 assert.equal(status.count,1);
 assert.deepEqual(Object.keys(calls[0][1][0]).sort(),['at','body','id','title']);
 await service.sync(plan);
 assert.equal(calls.length,1);
 assert.deepEqual(await service.sync([]),{state:'idle'});
 assert.deepEqual(calls[1],['replace',[]]);
});
test('care service reports bridge failures',async()=>{
 const service=P.createCareNotifications({bridge:{async getPermission(){return 'granted';},async requestPermission(){return 'granted';},async replaceCareNotifications(){throw Error('boom');}}});
 assert.deepEqual(await service.sync(M.careNotificationPlan(reminders(),[],now)),{state:'error'});
});
