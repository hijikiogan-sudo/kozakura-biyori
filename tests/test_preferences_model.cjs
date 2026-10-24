const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');

test('old state and old v1/v2 backups get complete behavior order and the original bird',()=>{
  const old=M.persistable(M.blank());delete old.birds;delete old.activeBirdId;old.profile={name:'旧形式の子'};delete old.settings.behaviorOrder;
  for(const version of [1,2]){
    const restored=M.validateBackup({app:'kozakura-biyori',version,data:old});
    assert.deepEqual(restored.settings.behaviorOrder,M.DEFAULT_BEHAVIOR_ORDER);
    assert.equal(restored.birds[0].appearance,'lovebird-green');
    assert.equal(restored.birds[0].name,'旧形式の子');
  }
});

test('a legacy settings.birdAppearance becomes the first bird\'s illustration',()=>{
  const restored=M.validateBackup({app:'kozakura-biyori',version:2,data:{profile:{name:''},records:[],photos:[],settings:{birdAppearance:'button-violet'}}});
  assert.equal(restored.birds[0].appearance,'button-violet');
  assert.equal('birdAppearance' in restored.settings,false);
});

test('an older partial order appends new actions without duplicate or missing tiles',()=>{
  const order=[...M.BEHAVIORS.slice(0,9)].reverse();
  const state=M.blank();state.settings.behaviorOrder=order;
  const normalized=M.normalize(state);
  assert.deepEqual(normalized.settings.behaviorOrder,[...order,...M.DEFAULT_BEHAVIOR_ORDER.filter(name=>!order.includes(name))]);
  assert.equal(new Set(M.behaviorOrder(['水を飲む','水を飲む','unknown'])).size,12);
});

test('all selectable birds and a custom order round-trip without changing records',()=>{
  for(const bird of M.BIRD_APPEARANCES){
    const state=M.blank();
    state.settings.behaviorOrder=[...M.BEHAVIORS].reverse();state.birds[0].appearance=bird.id;
    state.records=[{id:'old-behavior',type:'behavior',behavior:'大あくび',date:'2026-10-20',createdAt:'2026-10-20T00:00:00Z',note:'以前の記録',birdId:'bird-1'}];
    const restored=M.validateBackup({app:'kozakura-biyori',version:3,data:M.persistable(state)});
    assert.deepEqual(restored.settings,state.settings);
    assert.deepEqual(restored.records,state.records);
    assert.equal(restored.birds[0].appearance,bird.id);
  }
});

test('invalid appearance and ambiguous orders are rejected by backup import',()=>{
  for(const changes of [{birdAppearance:'../../remote.svg'},{behaviorOrder:['水を飲む','水を飲む']},{behaviorOrder:['unknown']},{behaviorOrder:'invalid'}]){
    const state=M.blank();Object.assign(state.settings,changes);
    assert.throws(()=>M.validateBackup({app:'kozakura-biyori',version:2,data:state}));
  }
});

test('legacy untouched order migrates once, while custom and newly saved orders remain',()=>{
  const old=M.blank();delete old.settings.behaviorOrderVersion;old.settings.behaviorOrder=[...M.BEHAVIORS];
  assert.deepEqual(M.normalize(old).settings.behaviorOrder,M.DEFAULT_BEHAVIOR_ORDER);
  old.settings.behaviorOrder=[...M.BEHAVIORS].reverse();
  assert.deepEqual(M.normalize(old).settings.behaviorOrder,old.settings.behaviorOrder);
  old.settings.behaviorOrder=[...M.BEHAVIORS];old.settings.behaviorOrderVersion=2;
  assert.deepEqual(M.normalize(old).settings.behaviorOrder,M.BEHAVIORS);
});
