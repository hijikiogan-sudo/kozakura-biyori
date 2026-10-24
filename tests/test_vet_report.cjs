const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../model.js');
const at='2026-10-01T00:00:00Z';
const records=[
 {id:'w1',type:'weight',date:'2026-09-01',value:51,note:'',createdAt:at},
 {id:'w2',type:'weight',date:'2026-10-01',value:50,note:'',createdAt:at},
 {id:'w3',type:'weight',date:'2026-10-10',time:'08:00',value:47.5,note:'',createdAt:at},
 {id:'h1',type:'health',date:'2026-10-05',appetite:'少なめ',droppings:'いつもどおり',activity:'いつもどおり',note:'',createdAt:at},
 {id:'h2',type:'health',date:'2026-10-06',appetite:'いつもどおり',droppings:'いつもどおり',activity:'いつもどおり',note:'',createdAt:at},
 {id:'f1',type:'flight',date:'2026-10-05',minutes:30,note:'',createdAt:at},
 {id:'f2',type:'flight',date:'2026-10-05',minutes:20,note:'',createdAt:at},
 {id:'f3',type:'flight',date:'2026-10-06',minutes:40,note:'',createdAt:at},
 {id:'v1',type:'visit',date:'2026-10-09',clinic:'合成どうぶつ病院',reason:'健康診断',note:'',createdAt:at},
 {id:'c1',type:'water',date:'2026-10-09',note:'',createdAt:at}
];
test('vet report summarizes only the selected period',()=>{
 const r=M.vetReport(records,'2026-10-01','2026-10-31');
 assert.deepEqual(r.weights.map(x=>x.id),['w3','w2']);
 assert.deepEqual({latest:r.weight.latest.value,earliest:r.weight.earliest.value,min:r.weight.min,max:r.weight.max},{latest:47.5,earliest:50,min:47.5,max:50});
 assert.deepEqual(r.flight,{days:2,averageMinutes:45});
 assert.equal(r.healthDays,2);
 assert.deepEqual(r.concerns.map(x=>x.id),['h1']);
 assert.deepEqual(r.visits.map(x=>x.id),['v1']);
 assert.equal(r.count,9);
});
test('vet report without weights has no weight summary',()=>{
 assert.equal(M.vetReport(records,'2026-11-01','2026-11-30').weight,null);
});
test('CSV is chronological, escaped and safe to open in spreadsheets',()=>{
 const csv=M.recordsCsv([
  {id:'a',type:'note',date:'2026-10-02',note:'元気, "少し"',createdAt:at},
  {id:'b',type:'weight',date:'2026-10-01',time:'07:30',value:48,note:'=HYPERLINK("x")',createdAt:at}
 ]);
 assert.ok(csv.startsWith('﻿日付,時刻,種類,内容,メモ\r\n'));
 const lines=csv.slice(1).trim().split('\r\n');
 assert.equal(lines[1],'2026-10-01,07:30,体重,48 g,"\'=HYPERLINK(""x"")"');
 assert.equal(lines[2],'2026-10-02,,メモ,,"元気, ""少し"""');
});
test('background choices default, survive normalize and reject unknown colors in backups',()=>{
 assert.deepEqual(M.blank().settings.background,{light:'default',dark:'default'});
 assert.deepEqual(M.normalize({settings:{background:{light:'aqua',dark:'nope'}}}).settings.background,{light:'aqua',dark:'default'});
 assert.deepEqual(M.normalize({settings:{}}).settings.background,{light:'default',dark:'default'});
 const backup=background=>({app:'kozakura-biyori',version:2,data:{...M.blank(),settings:{...M.blank().settings,background}}});
 assert.doesNotThrow(()=>M.validateBackup(backup({light:'violet',dark:'white'})));
 assert.throws(()=>M.validateBackup(backup({light:'red'})),/背景の色/);
});
