const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');

test('old state and old v1/v2 backups get complete behavior order and the original bird',()=>{
  const old=M.blank();delete old.settings.behaviorOrder;delete old.settings.birdAppearance;
  for(const version of [1,2]){
    const restored=M.validateBackup({app:'kozakura-biyori',version,data:old});
    assert.deepEqual(restored.settings.behaviorOrder,M.BEHAVIORS);
    assert.equal(restored.settings.birdAppearance,'lovebird-green');
  }
});

test('an older partial order appends new actions without duplicate or missing tiles',()=>{
  const order=[...M.BEHAVIORS.slice(0,9)].reverse();
  const state=M.blank();state.settings.behaviorOrder=order;
  const normalized=M.normalize(state);
  assert.deepEqual(normalized.settings.behaviorOrder,[...order,...M.BEHAVIORS.slice(9)]);
  assert.equal(new Set(M.behaviorOrder(['水を飲む','水を飲む','unknown'])).size,12);
});

test('all selectable birds and a custom order round-trip without changing records',()=>{
  for(const bird of M.BIRD_APPEARANCES){
    const state=M.blank();
    state.settings.behaviorOrder=[...M.BEHAVIORS].reverse();state.settings.birdAppearance=bird.id;
    state.records=[{id:'old-behavior',type:'behavior',behavior:'大あくび',date:'2026-10-20',createdAt:'2026-10-20T00:00:00Z',note:'以前の記録'}];
    const restored=M.validateBackup({app:'kozakura-biyori',version:2,data:state});
    assert.deepEqual(restored.settings,state.settings);
    assert.deepEqual(restored.records,state.records);
  }
});

test('invalid appearance and ambiguous orders are rejected by backup import',()=>{
  for(const changes of [{birdAppearance:'../../remote.svg'},{behaviorOrder:['水を飲む','水を飲む']},{behaviorOrder:['unknown']},{behaviorOrder:'invalid'}]){
    const state=M.blank();Object.assign(state.settings,changes);
    assert.throws(()=>M.validateBackup({app:'kozakura-biyori',version:2,data:state}));
  }
});
