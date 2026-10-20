const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
const backup=data=>({app:'kozakura-biyori',version:2,data});

test('older local state and backups default to all actions at 30 seconds',()=>{
  const data=M.blank();delete data.settings.timerActions;
  assert.deepEqual(M.normalize(data).settings.timerActions,M.defaultTimerActions());
  for(const version of [1,2])assert.deepEqual(M.validateBackup({...backup(data),version}).settings.timerActions,M.defaultTimerActions());
});

test('custom and disabled action preferences round-trip without changing records',()=>{
  for(const enabled of [true,false]){
    const data=M.blank();data.settings.timerActions={enabled,intervalSeconds:15,actions:['curious','paper']};
    data.records=[{id:'water-before-settings',type:'water',date:'2026-10-20',time:'08:00',note:'変更前の記録',createdAt:'2026-10-19T23:00:00Z'}];
    const restored=M.validateBackup(backup(data));
    assert.deepEqual(restored.settings,data.settings);assert.deepEqual(restored.records,data.records);
  }
});

test('invalid imported preferences cannot erase or inject action selections',()=>{
  const valid=M.defaultTimerActions();
  for(const changes of [{enabled:'yes'},{intervalSeconds:0},{intervalSeconds:301},{intervalSeconds:10.5},{actions:[]},{actions:['fly','fly']},{actions:['unknown']},{actions:'fly'}]){
    const data=M.blank();data.settings.timerActions={...valid,...changes};
    assert.throws(()=>M.validateBackup(backup(data)),/放鳥アクション/);
    assert.deepEqual(M.normalize(data).settings.timerActions,valid);
  }
});
