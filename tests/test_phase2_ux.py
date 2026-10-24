"""Phase 2 acceptance tests; synthetic photos/video and isolated IndexedDB only."""
import base64,functools,shutil,threading,unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from test_timer import QuietHandler

class Phase2UXTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.root=Path(__file__).resolve().parents[1]
  cls.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(cls.root)))
  threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base=f'http://127.0.0.1:{cls.server.server_port}/'
  cls.p=sync_playwright().start();cls.browser=cls.p.chromium.launch(executable_path=shutil.which('chromium'))
 @classmethod
 def tearDownClass(cls):
  cls.browser.close();cls.p.stop();cls.server.shutdown();cls.server.server_close()
 def setUp(self):
  self.ctx=self.browser.new_context(viewport={'width':390,'height':844},locale='ja-JP',timezone_id='Asia/Tokyo');self.page=self.ctx.new_page();self.errors=[];self.external=[]
  self.page.on('pageerror',lambda e:self.errors.append(str(e)))
  self.page.on('request',lambda r:self.external.append(r.url) if r.url.startswith(('http:','https:')) and not r.url.startswith(self.base) else None)
  self.page.clock.install(time=datetime(2026,10,20,tzinfo=timezone.utc));self.page.goto(self.base);expect(self.page.locator('#main h1')).to_be_visible()
 def tearDown(self):
  self.ctx.close();self.assertEqual(self.errors,[]);self.assertEqual(self.external,[])
 def records(self):return self.page.evaluate('(async()=> (await readState()).records)()')
 def photos(self):return self.page.evaluate('(async()=> (await readState()).photos)()')
 def seed_media(self):
  self.page.evaluate("""async()=>{const c=document.createElement('canvas');c.width=32;c.height=32;c.getContext('2d').fillRect(0,0,32,32);const data=c.toDataURL('image/jpeg');await mutate(s=>{s.photos=[{id:'general',kind:'image',date:today(),data,favorite:false,caption:'通常の写真'},{id:'chewed',kind:'image',date:today(),data,favorite:false,caption:'残すメモ',category:'chewed',subject:'合成の紙'}];});render();}""")
 def test_home_merges_care_and_preserves_photo_layout_and_slot_undo(self):
  self.page.evaluate("""async()=>{const c=document.createElement('canvas');c.width=32;c.height=32;await mutate(s=>{s.profile.photo=c.toDataURL('image/jpeg');s.profile.cover={layout:'wide',zoom:1.5,x:25,y:60,comment:'うちの子'};s.settings.reminders.water={enabled:true,startDate:today(),interval:1,time:'08:00',extraTimes:['18:00']};});render();}""")
  before=self.page.evaluate('structuredClone(state.profile)')
  expect(self.page.get_by_role('heading',name='今日のお世話',exact=True)).to_have_count(1)
  expect(self.page.get_by_role('heading',name='今日の予定',exact=True)).to_have_count(0)
  expect(self.page.locator('#home-care-content .care-summary')).to_contain_text('予定 2件')
  expect(self.page.locator('#home-care-content .care-summary')).to_contain_text('未実施 1件・これから 1件')
  self.assertEqual(self.page.locator('.photo-hero').bounding_box()['height'],220)
  self.assertLess(self.page.locator('.health-section').bounding_box()['y'],self.page.locator('#home-care-content').bounding_box()['y'])
  self.page.get_by_role('button',name='08:00の水替えを記録',exact=True).click()
  expect(self.page.locator('.care-summary')).to_contain_text('実施済み 1件')
  self.page.get_by_role('button',name='直前の記録を取り消す',exact=True).click()
  expect(self.page.locator('.care-summary')).to_contain_text('実施済み 0件')
  self.assertEqual(self.page.evaluate('state.profile'),before)
  self.page.screenshot(path='/tmp/kozabota-phase2-home.png',full_page=True)
 def test_weight_decimal_keyboard_previous_measurement_and_updated_views(self):
  self.page.evaluate("""async()=>{await mutate(s=>s.records.push({id:'previous-weight',type:'weight',date:M.addDays(today(),-1),time:'08:00',value:50.5,note:'前回',createdAt:new Date().toISOString()}));}""")
  self.page.goto(self.base+'#weight');self.page.get_by_role('button',name='体重を記録する',exact=True).click()
  value=self.page.locator('#dialog [name=value]');expect(value).to_have_attribute('inputmode','decimal');expect(value).to_have_value('')
  expect(self.page.locator('#weight-previous')).to_contain_text('50.5 g');expect(self.page.locator('#weight-previous')).to_contain_text('2026/10/19')
  self.page.screenshot(path='/tmp/kozabota-phase2-weight-form.png')
  value.fill('51.2');self.page.locator('#dialog [name=note]').fill('今回の測定');self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible();expect(self.page.locator('.latest-weight strong')).to_contain_text('51.2')
  self.page.get_by_role('group',name='体重の表示方法').get_by_role('button',name='一覧',exact=True).click();expect(self.page.locator('.record-list')).to_contain_text('51.2 g')
  self.page.get_by_role('button',name='体重を記録する',exact=True).click();expect(self.page.locator('#weight-previous')).to_contain_text('51.2 g');expect(self.page.locator('#dialog [name=value]')).to_have_value('')
  self.assertEqual(len(self.records()),2)
 def test_behavior_count_undo_and_selected_date_preserve_existing_record(self):
  self.page.evaluate("""async()=>{await mutate(s=>s.records.push({id:'old-behavior',type:'behavior',date:today(),time:'08:00',behavior:'水を飲む',note:'以前の記録',createdAt:new Date().toISOString()}));}""")
  self.page.goto(self.base+'#behavior');tile=self.page.get_by_role('button',name='水を飲むを記録',exact=True);expect(tile).to_contain_text('記録済み 1回')
  tile.evaluate('(b)=>{b.click();b.click();}');expect(self.page.get_by_role('button',name='水を飲むを記録',exact=True)).to_contain_text('記録済み 2回')
  self.page.get_by_role('button',name='直前の記録を取り消す',exact=True).click();expect(self.page.get_by_role('button',name='水を飲むを記録',exact=True)).to_contain_text('記録済み 1回')
  self.assertEqual([r['id'] for r in self.records()],['old-behavior'])
  self.page.get_by_role('button',name='前の日',exact=True).click();expect(self.page.get_by_role('button',name='水を飲むを記録',exact=True)).to_contain_text('未記録');expect(self.page.locator('.behavior-tile')).to_have_count(12)
  self.page.screenshot(path='/tmp/kozabota-phase2-behavior.png',full_page=True)
 def test_calendar_counts_today_selection_and_past_record_add_edit(self):
  self.page.evaluate("""async()=>{await mutate(s=>{for(let i=0;i<2;i++)s.records.push({id:'note-'+i,type:'note',date:today(),time:'08:00',note:'日付の合成メモ',createdAt:new Date().toISOString()});});}""")
  self.page.goto(self.base+'#calendar');today=self.page.evaluate('today()');past=self.page.evaluate('M.addDays(today(),-2)')
  expect(self.page.locator('.calendar-day[aria-current=date] .day-record-count')).to_have_text('2件')
  self.page.locator('.calendar-day[aria-label^="'+past+'"]').click();expect(self.page.locator('.calendar-day.selected .selected-date-mark')).to_have_text('✓')
  self.page.get_by_role('button',name='記録を追加',exact=True).click();self.page.locator('#dialog').get_by_role('button',name='体重',exact=True).click()
  expect(self.page.locator('#dialog [name=date]')).to_have_value(past);self.page.locator('#dialog [name=value]').fill('48.6');self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible();expect(self.page.locator('.calendar-day.selected .day-record-count')).to_have_text('1件')
  self.page.locator('.record-item .icon-button').click();self.page.locator('#dialog [name=value]').fill('49');self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible();self.assertEqual([r['value'] for r in self.records() if r['type']=='weight'],[49])
  self.page.get_by_role('button',name='前の月',exact=True).click();self.page.get_by_role('button',name='今日へ戻る',exact=True).click()
  expect(self.page.locator('.calendar-day.selected')).to_have_attribute('aria-current','date')
  self.page.screenshot(path='/tmp/kozabota-phase2-calendar.png',full_page=True)
 def test_album_categories_favorite_detail_and_classification_keep_original_media(self):
  self.seed_media();before=self.photos();self.page.goto(self.base+'#album');expect(self.page.locator('.photo-card')).to_have_count(1)
  self.page.get_by_role('button',name='かじり跡',exact=True).click();expect(self.page.locator('.photo-card')).to_have_count(1);self.page.locator('.photo-open').click()
  caption=self.page.locator('#dialog [name=caption]');caption.fill('まだ保存していないメモ')
  self.page.locator('#dialog').get_by_role('button',name='お気に入りにする',exact=True).click()
  expect(self.page.locator('#detail-favorite')).to_have_attribute('aria-pressed','true');expect(caption).to_have_value('まだ保存していないメモ')
  self.page.locator('#close-dialog').click();self.assertEqual(self.photos()[1]['caption'],'残すメモ')
  self.page.get_by_role('button',name='お気に入り',exact=True).click();expect(self.page.locator('.photo-card')).to_contain_text('かじり跡')
  self.page.locator('.photo-open').click();self.page.locator('#dialog').get_by_label('かじり跡アルバムに入れる',exact=True).uncheck();self.page.get_by_role('button',name='アルバムの情報を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible();self.page.get_by_role('button',name='写真',exact=True).click();expect(self.page.locator('.photo-card')).to_have_count(2)
  after=self.photos();self.assertEqual([p['id'] for p in after],[p['id'] for p in before]);self.assertEqual([p['data'] for p in after],[p['data'] for p in before])
  self.assertEqual(self.page.evaluate('M.validateBackup({app:APP,version:2,data:state}).photos'),after)
  self.page.screenshot(path='/tmp/kozabota-phase2-album.png',full_page=True)
 def test_visible_add_control_uploads_photo_and_video_and_opens_matching_tab(self):
  self.page.goto(self.base+'#album');expect(self.page.get_by_label('写真・動画を追加',exact=True)).to_have_attribute('type','file')
  image=self.page.evaluate("()=>{const c=document.createElement('canvas');c.width=30;c.height=30;return c.toDataURL('image/png').split(',')[1];}")
  self.page.locator('[name=media]').set_input_files({'name':'synthetic.png','mimeType':'image/png','buffer':base64.b64decode(image)})
  expect(self.page.locator('.album-result-count')).to_have_text('写真 1件')
  self.page.locator('[name=media]').set_input_files(str(self.root/'tests/fixtures/bird-color.mp4'))
  expect(self.page.locator('.album-result-count')).to_have_text('動画 1件');self.assertEqual(len(self.photos()),2)
  self.page.locator('.photo-open').click();self.assertTrue(self.page.locator('#dialog video').evaluate('(video)=>video.controls'))
  self.page.evaluate("async()=>{const video=document.querySelector('#dialog video');if(video.readyState<1)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));}")
  self.assertGreater(self.page.locator('#dialog video').evaluate('(v)=>v.videoWidth'),0)
  self.assertTrue(self.photos()[0]['data'].startswith('data:image/jpeg;base64,'));self.assertTrue(self.photos()[1]['data'].startswith('data:video/mp4;base64,'))
 def test_favorite_failure_does_not_lose_photo_and_retry_deduplicates_click(self):
  self.seed_media();self.page.goto(self.base+'#album');before=self.photos()
  self.page.evaluate("()=>{window.realPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};}")
  self.page.get_by_role('button',name='お気に入りにする',exact=True).click();expect(self.page.locator('#toast')).to_contain_text('空き容量が足りず');self.assertEqual(self.photos(),before)
  self.page.evaluate('()=>{IDBObjectStore.prototype.put=window.realPut;}')
  self.page.get_by_role('button',name='お気に入りにする',exact=True).evaluate('(b)=>{b.click();b.click();}')
  expect(self.page.get_by_role('button',name='お気に入りを解除',exact=True)).to_be_visible();self.assertTrue(self.photos()[0]['favorite']);self.assertEqual(len(self.photos()),2)
 def test_offline_behavior_weight_and_favorite_preserve_backup(self):
  self.seed_media();expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了')
  self.page.evaluate("async()=>{if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));}")
  self.ctx.set_offline(True);self.page.goto(self.base+'#behavior');self.page.get_by_role('button',name='羽づくろいを記録',exact=True).click();expect(self.page.get_by_role('button',name='羽づくろいを記録',exact=True)).to_contain_text('記録済み 1回')
  self.page.goto(self.base+'#album');self.page.get_by_role('button',name='お気に入りにする',exact=True).click();expect(self.page.get_by_role('button',name='お気に入りを解除',exact=True)).to_be_visible()
  self.page.reload();self.assertTrue(self.photos()[0]['favorite']);self.assertEqual(len(self.records()),1)
  self.assertEqual(self.page.evaluate('M.validateBackup({app:APP,version:1,data:state}).records'),self.records())
 def test_illustration_label_and_small_screen_layout_preserve_appearance_choice(self):
  self.page.get_by_role('button',name='イラスト変更',exact=True).click();expect(self.page.locator('#main h1')).to_have_text('イラスト変更');expect(self.page.locator('[name=bird-appearance]')).to_have_count(12)
  self.page.get_by_role('radio',name='ボタンインコ・ブルー',exact=True).check();self.page.get_by_role('button',name='イラストを保存',exact=True).click();expect(self.page.locator('#toast')).to_contain_text('保存しました')
  for width in [320,390]:
   self.page.set_viewport_size({'width':width,'height':844})
   for route in ['home','weight','behavior','calendar','album','appearance']:
    self.page.goto(self.base+'#'+route);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,route))
    self.page.evaluate("document.documentElement.style.fontSize='28px'");self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,route,'large text'));self.page.evaluate("document.documentElement.style.fontSize=''")
  self.assertEqual(self.page.evaluate('state.profile.appearance'),'button-blue')
