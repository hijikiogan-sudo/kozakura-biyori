const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
const photo={id:'chewed-book',date:'2026-10-20',kind:'image',favorite:true,data:'data:image/jpeg;base64,YQ==',caption:'表紙の角をかじった',category:'chewed',subject:'教科書'};

test('chewed album metadata, favorites and photo data round-trip through v2 backups',()=>{
  const state=M.blank();state.photos=[photo];
  assert.deepEqual(M.validateBackup({app:'kozakura-biyori',version:2,data:state}).photos,[{...photo,birdId:'bird-1'}]);
});

test('old photos remain ordinary photos and can retain notes after reclassification',()=>{
  const state=M.blank();const old={...photo};delete old.category;delete old.subject;
  state.photos=[old];assert.deepEqual(M.validateBackup({app:'kozakura-biyori',version:1,data:state}).photos,[{...old,birdId:'bird-1'}]);
  state.photos=[{...photo,category:'general'}];
  assert.equal(M.validateBackup({app:'kozakura-biyori',version:2,data:state}).photos[0].subject,'教科書');
});

test('invalid chewed tags, overlong objects, missing object names, and videos are rejected',()=>{
  for(const changes of [{category:'unknown'},{subject:' '},{subject:'あ'.repeat(81)},{kind:'video',data:'data:video/mp4;base64,YQ=='}]){
    const state=M.blank();state.photos=[{...photo,...changes}];
    assert.throws(()=>M.validateBackup({app:'kozakura-biyori',version:2,data:state}),/かじり跡/);
  }
});
