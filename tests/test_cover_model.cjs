const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');

test('legacy state receives independent home-photo defaults without changing data',()=>{
  const old={profile:{name:'こざくら',sex:'不明',age:'2歳',photo:null},records:[],photos:[]};
  const current=M.normalize(old);
  assert.deepEqual(current.profile.cover,{layout:'standard',x:50,y:42,zoom:1,comment:'今日も\nいっしょに。'});
  assert.equal(current.profile.name,'こざくら');
  current.profile.cover.x=10;
  assert.equal(M.blank().profile.cover.x,50);
  assert.equal(old.profile.cover,undefined);
});

test('v1 backup and previous v2 backups restore with default display settings',()=>{
  const old={profile:{name:'こざくら',sex:'不明',age:'',photo:null},records:[{id:'old-note',type:'note',date:'2026-10-19',createdAt:'2026-10-19T00:00:00Z',note:'以前の記録'}],photos:[]};
  for(const version of [1,2]){
    const restored=M.validateBackup({app:'kozakura-biyori',version,data:old});
    assert.equal(restored.profile.cover.layout,'standard');
    assert.equal(restored.records[0].note,'以前の記録');
  }
});

test('v2 backup preserves custom layout, framing, and free comment',()=>{
  const state=M.blank();
  state.profile.cover={layout:'portrait',x:0,y:100,zoom:3,comment:'ずっと一緒\n元気でね♡'};
  const restored=M.validateBackup({app:'kozakura-biyori',version:2,data:state});
  assert.deepEqual(restored.profile.cover,state.profile.cover);
});

test('reject invalid framing, layout, and comment in backups',()=>{
  for(const [key,value] of [['layout','injected'],['x',-1],['x',101],['y',NaN],['y',101],['zoom',0],['zoom',3.1],['comment','あ'.repeat(41)],['comment',{}]]){
    const state=M.blank();state.profile.cover[key]=value;
    assert.throws(()=>M.validateBackup({app:'kozakura-biyori',version:2,data:state}),/ホーム写真/);
  }
});
