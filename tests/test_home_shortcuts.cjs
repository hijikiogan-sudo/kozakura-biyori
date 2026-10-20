const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
test('old states and both backup versions retain default home operations',()=>{
  const old=M.blank();delete old.settings.homeShortcuts;
  for(const version of [1,2])assert.deepEqual(M.validateBackup({app:'kozakura-biyori',version,data:old}).settings.homeShortcuts,['weight','behavior','album','calendar']);
  assert.deepEqual(M.normalize(old).settings.homeShortcuts,['weight','behavior','album','calendar']);
});
test('custom operations survive backup without changing records or media',()=>{
  const data=M.blank();data.settings.homeShortcuts=['care','reminders','health','chewed'];
  for(const version of [1,2])assert.deepEqual(M.validateBackup({app:'kozakura-biyori',version,data}),data);
  data.settings.homeShortcuts=['timer'];assert.deepEqual(M.normalize(data).settings.homeShortcuts,['timer']);
});
test('invalid operations fail import and fall back locally',()=>{
  for(const value of [[],['weight','weight'],['unknown'],'weight',null,['weight','behavior','album','calendar','care']]){
    const data=M.blank();data.settings.homeShortcuts=value;
    assert.throws(()=>M.validateBackup({app:'kozakura-biyori',version:2,data}));
    assert.deepEqual(M.normalize(data).settings.homeShortcuts,M.DEFAULT_HOME_SHORTCUTS);
  }
});
