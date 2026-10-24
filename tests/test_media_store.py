"""Photos/videos live in a separate IndexedDB store. Synthetic data only."""
import unittest
from playwright.sync_api import expect
import test_timer

JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDAoMDBQNDAsLDBkSEw8UHR8eHRwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9k='

DUMP = '''async()=>{const db=await new Promise((ok,ng)=>{const r=indexedDB.open('kozakura-biyori-local-v1');r.onsuccess=()=>ok(r.result);r.onerror=()=>ng(r.error);});
const all=(name)=>new Promise(ok=>{const tx=db.transaction(name);const store=tx.objectStore(name);const keys=store.getAllKeys();const values=store.getAll();tx.oncomplete=()=>ok(Object.fromEntries(keys.result.map((k,i)=>[k,values.result[i]])));});
const result={version:db.version,stores:[...db.objectStoreNames],data:await all('data'),media:db.objectStoreNames.contains('media')?await all('media'):null};db.close();return result;}'''


class MediaStoreTests(unittest.TestCase):
    setUpClass = classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass = classmethod(test_timer.TimerTests.tearDownClass.__func__)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Tokyo')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def dump(self):
        return self.page.evaluate(DUMP)

    def test_v1_database_migrates_without_losing_photos(self):
        # A same-origin page that does not run the app creates the old v1 layout.
        self.page.goto(self.base + 'bird.svg')
        self.page.evaluate('''jpeg=>new Promise((ok,ng)=>{const r=indexedDB.open('kozakura-biyori-local-v1',1);
            r.onupgradeneeded=()=>r.result.createObjectStore('data');
            r.onsuccess=()=>{const db=r.result;const tx=db.transaction('data','readwrite');
              tx.objectStore('data').put({profile:{name:'旧形式の合成プロフィール',photo:jpeg},records:[{id:'old-note',type:'note',date:'2026-10-01',note:'旧形式の記録',createdAt:'2026-10-01T00:00:00Z'}],
                photos:[{id:'old-photo',date:'2026-10-01',data:jpeg,favorite:true,caption:'旧形式の写真'}],timer:null,lastBackup:null,settings:{}},'state');
              tx.oncomplete=()=>{db.close();ok();};tx.onerror=()=>ng(tx.error);};})''', JPEG)
        self.page.goto(self.base + '#album')
        expect(self.page.locator('main')).to_contain_text('アルバム')
        state = self.page.evaluate('async()=>{const s=await readState();return {name:s.profile.name,profile:s.profile.photo,photos:s.photos.map(p=>[p.id,p.data,p.favorite]),records:s.records.length};}')
        self.assertEqual(state, {'name': '旧形式の合成プロフィール', 'profile': JPEG, 'photos': [['old-photo', JPEG, True]], 'records': 1})
        self.page.close()
        self.page = self.context.new_page()
        self.page.goto(self.base + 'bird.svg')
        raw = self.dump()
        self.assertEqual(raw['version'], 2)
        self.assertEqual(raw['media'], {'bird:bird-1': JPEG, 'photo:old-photo': JPEG})
        self.assertEqual(raw['data']['state']['photos'][0]['data'], 'media:photo:old-photo')
        self.assertEqual(raw['data']['state']['birds'][0]['photo'], 'media:bird:bird-1')
        self.assertNotIn('profile', raw['data']['state'])

    def test_v2_single_profile_becomes_first_bird_and_keeps_its_photo(self):
        # v1.11/v1.12 stored one profile with its photo under the "profile" media key.
        self.page.goto(self.base + 'bird.svg')
        self.page.evaluate('''jpeg=>new Promise((ok,ng)=>{const r=indexedDB.open('kozakura-biyori-local-v1',2);
            r.onupgradeneeded=()=>{r.result.createObjectStore('data');r.result.createObjectStore('media');};
            r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['data','media'],'readwrite');
              tx.objectStore('media').put(jpeg,'profile');
              tx.objectStore('data').put({profile:{name:'v2の合成プロフィール',photo:'media:profile'},records:[{id:'v2-weight',type:'weight',date:'2026-10-01',value:50,note:'',createdAt:'2026-10-01T00:00:00Z'}],
                photos:[],timer:null,lastBackup:null,settings:{birdAppearance:'button-yellow'}},'state');
              tx.oncomplete=()=>{db.close();ok();};tx.onerror=()=>ng(tx.error);};})''', JPEG)
        self.page.goto(self.base + '#home')
        expect(self.page.locator('main')).to_contain_text('v2の合成プロフィール')
        state = self.page.evaluate('async()=>{const s=await readState();return [s.birds.length,s.profile.name,s.profile.photo,s.profile.appearance,s.records[0].birdId];}')
        self.assertEqual(state, [1, 'v2の合成プロフィール', JPEG, 'button-yellow', 'bird-1'])
        # The first save moves the photo to the per-bird key and drops the old one.
        self.page.evaluate("async()=>{await mutate(s=>{s.records.push({id:'after',type:'note',date:today(),note:'合成',createdAt:new Date().toISOString()});});}")
        self.page.close()
        self.page = self.context.new_page()
        self.page.goto(self.base + 'bird.svg')
        raw = self.dump()
        self.assertEqual(raw['media'], {'bird:bird-1': JPEG})
        self.assertEqual(raw['data']['state']['birds'][0]['photo'], 'media:bird:bird-1')

    def test_records_do_not_rewrite_media_and_deleted_media_is_removed(self):
        self.page.goto(self.base + '#home')
        expect(self.page.locator('main')).not_to_contain_text('記録をひらいています')
        self.page.evaluate('async jpeg=>{await mutate(s=>{s.photos=[{id:"a",kind:"image",date:today(),data:jpeg,favorite:false,caption:""},{id:"b",kind:"image",date:today(),data:jpeg,favorite:false,caption:""}];});}', JPEG)
        # Count media writes made by adding a plain record.
        writes = self.page.evaluate('''async()=>{let puts=0;const original=IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put=function(...args){if(this.name==='media')puts++;return original.apply(this,args);};
            await mutate(s=>{s.records.push({id:'n1',type:'note',date:today(),note:'合成メモ',createdAt:new Date().toISOString()});});
            IDBObjectStore.prototype.put=original;return puts;}''')
        self.assertEqual(writes, 0)
        self.page.evaluate('async()=>{await mutate(s=>{s.photos=s.photos.filter(p=>p.id!=="a");});}')
        self.assertEqual(sorted(self.dump()['media']), ['photo:b'])
        self.assertEqual(self.page.evaluate('async()=>(await readState()).photos.map(p=>p.id)'), ['b'])

    def test_second_tab_sees_media_added_elsewhere(self):
        self.page.goto(self.base + '#home')
        other = self.context.new_page()
        other.goto(self.base + '#home')
        expect(other.locator('main')).not_to_contain_text('記録をひらいています')
        self.page.evaluate('async jpeg=>{await mutate(s=>{s.photos.push({id:"from-tab",kind:"image",date:today(),data:jpeg,favorite:false,caption:""});});}', JPEG)
        self.assertEqual(other.evaluate('async()=>(await readState()).photos.map(p=>[p.id,p.data.length])'), [['from-tab', len(JPEG)]])
        other.evaluate('async()=>{await mutate(s=>{s.records.push({id:"t2",type:"note",date:today(),note:"別タブ",createdAt:new Date().toISOString()});});}')
        self.assertEqual(self.page.evaluate('async()=>(await readState()).photos.length'), 1)


if __name__ == '__main__':
    unittest.main()
