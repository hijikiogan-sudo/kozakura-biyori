"""Phase 1 acceptance tests with synthetic, isolated local data only."""
import functools,shutil,threading,unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from datetime import datetime,timezone,timedelta
from playwright.sync_api import sync_playwright,expect
from test_timer import QuietHandler

class Phase1UXTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(Path(__file__).resolve().parents[1])))
  threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base=f'http://127.0.0.1:{cls.server.server_port}/'
  cls.p=sync_playwright().start();cls.browser=cls.p.chromium.launch(executable_path=shutil.which('chromium'))
 @classmethod
 def tearDownClass(cls):
  cls.browser.close();cls.p.stop();cls.server.shutdown();cls.server.server_close()
 def setUp(self):
  self.ctx=self.browser.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo',locale='ja-JP')
  self.page=self.ctx.new_page();self.errors=[];self.page.on('pageerror',lambda e:self.errors.append(str(e)))
  self.page.goto(self.base);expect(self.page.locator('#main h1')).to_be_visible()
 def tearDown(self):
  self.ctx.close();self.assertEqual(self.errors,[])
 def records(self):return self.page.evaluate('(async()=> (await readState()).records)()')
 def seed_record(self):
  self.page.evaluate("""async()=>{await mutate(s=>{
   s.profile.name='テストの愛鳥';
   s.records.push({id:'old-water',type:'water',date:M.addDays(today(),-1),time:'08:00',note:'過去のお世話',createdAt:new Date().toISOString()});
  });render();}""")
 def test_one_tap_double_tap_undo_and_explicit_additional_record(self):
  self.seed_record();before=self.records()
  self.page.get_by_role('button',name='水替えを記録',exact=True).evaluate('(b)=>{b.click();b.click();}')
  expect(self.page.get_by_role('button',name='水替えは実施済み',exact=True)).to_be_disabled()
  expect(self.page.locator('#confirm-dialog')).not_to_be_visible()
  expect(self.page.locator('#toast')).to_have_text('記録しました')
  self.assertEqual(len(self.records()),2)
  self.page.get_by_role('button',name='水替えをもう1回記録',exact=True).click()
  self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible()
  self.assertEqual(len(self.records()),3)
  self.page.get_by_role('button',name='直前の記録を取り消す',exact=True).click()
  expect(self.page.locator('#toast')).to_have_text('直前の記録を取り消しました')
  self.assertEqual(len(self.records()),2);self.assertEqual(self.records()[1 if self.records()[0]['id']!='old-water' else 0],before[0])
  self.assertEqual(self.page.evaluate('state.profile.name'),'テストの愛鳥')
 def test_schedule_slots_complete_independently_and_undo_restores_only_target(self):
  self.page.evaluate("""async()=>{await mutate(s=>s.settings.reminders.water={enabled:true,startDate:today(),interval:1,time:'08:00',extraTimes:['18:00']});render();}""")
  self.page.get_by_role('button',name='08:00の水替えを記録',exact=True).click()
  expect(self.page.get_by_role('button',name='08:00の水替えは実施済み',exact=True)).to_be_disabled()
  self.page.get_by_role('button',name='18:00の水替えを記録',exact=True).click()
  expect(self.page.get_by_role('button',name='18:00の水替えは実施済み',exact=True)).to_be_disabled()
  self.page.get_by_role('button',name='直前の記録を取り消す',exact=True).click()
  expect(self.page.get_by_role('button',name='18:00の水替えを記録',exact=True)).to_be_enabled()
  expect(self.page.get_by_role('button',name='08:00の水替えは実施済み',exact=True)).to_be_disabled()
  self.assertEqual([r['careSlot'] for r in self.records()],['08:00'])
 def test_storage_failure_has_no_success_or_undo_and_allows_retry(self):
  self.seed_record();before=self.records()
  self.page.evaluate("""()=>{window.realPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};}""")
  self.page.get_by_role('button',name='水替えを記録',exact=True).click()
  expect(self.page.locator('#toast')).to_contain_text('空き容量が足りず')
  expect(self.page.locator('#undo-action')).not_to_be_visible()
  self.assertEqual(self.records(),before)
  self.page.evaluate('()=>{IDBObjectStore.prototype.put=window.realPut;}')
  self.page.get_by_role('button',name='水替えを記録',exact=True).click()
  expect(self.page.get_by_role('button',name='水替えは実施済み',exact=True)).to_be_disabled()
  self.assertEqual(len(self.records()),2)
 def test_undo_refuses_a_record_edited_in_another_context(self):
  self.page.get_by_role('button',name='掃除を記録',exact=True).click()
  expect(self.page.get_by_role('button',name='掃除は実施済み',exact=True)).to_be_disabled()
  self.page.evaluate("async()=>{await mutate(s=>s.records[0].note='別の画面で編集した内容');}")
  self.page.get_by_role('button',name='直前の記録を取り消す',exact=True).click()
  expect(self.page.locator('#toast')).to_contain_text('編集されています')
  self.assertEqual(self.records()[0]['note'],'別の画面で編集した内容')
 def test_two_tabs_cannot_duplicate_the_first_care_record(self):
  other=self.ctx.new_page();other.goto(self.base);expect(other.locator('#main h1')).to_be_visible()
  self.page.evaluate("()=>{window.write=quickCareRecord('water',today());}")
  other.evaluate("async()=>{await quickCareRecord('water',today());}")
  self.page.evaluate('async()=>{await window.write;}')
  self.assertEqual(len(self.records()),1);other.close()
 def test_health_requires_explicit_choices_and_today_is_edited(self):
  self.page.get_by_role('button',name='記録する',exact=True).click()
  form=self.page.locator('#dialog form')
  for key in ['appetite','droppings','activity']:expect(form.locator('[name='+key+']')).to_have_value('')
  self.page.get_by_role('button',name='記録を保存',exact=True).click();self.assertEqual(self.records(),[])
  form.locator('[name=appetite]').select_option('いつもどおり');form.locator('[name=droppings]').select_option('気になる')
  self.page.get_by_role('button',name='記録を保存',exact=True).click();self.assertEqual(self.records(),[])
  form.locator('[name=activity]').select_option('少なめ');self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible();self.assertEqual(len(self.records()),1)
  self.page.get_by_role('button',name='今日の記録を編集',exact=True).click()
  expect(self.page.locator('#dialog [name=droppings]')).to_have_value('気になる')
  self.page.locator('#dialog [name=droppings]').select_option('多め');self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.locator('#dialog')).not_to_be_visible();self.assertEqual(len(self.records()),1);self.assertEqual(self.records()[0]['droppings'],'多め')
  data=self.page.evaluate('M.validateBackup({app:APP,version:2,data:state})');self.assertEqual(data['records'],self.records())
 def test_saving_form_prevents_double_submission_and_close_until_commit(self):
  self.page.goto(self.base+'#records');self.page.evaluate("()=>{selectedDate=today();recordForm('note');}")
  self.page.locator('#dialog textarea').fill('保存中の合成メモ')
  self.page.evaluate("""()=>{const original=mutate;const gate=new Promise(resolve=>window.releaseSave=resolve);mutate=async fn=>{await gate;return original(fn);};}""")
  self.page.get_by_role('button',name='記録を保存',exact=True).click()
  expect(self.page.get_by_role('button',name='保存中…',exact=True)).to_be_disabled()
  expect(self.page.locator('#close-dialog')).to_be_disabled();self.page.keyboard.press('Escape');expect(self.page.locator('#dialog')).to_be_visible()
  self.page.locator('#dialog form').evaluate('(form)=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))')
  self.assertEqual(self.records(),[]);self.page.evaluate('()=>{window.releaseSave();}')
  expect(self.page.locator('#dialog')).not_to_be_visible();self.assertEqual(len(self.records()),1)
 def test_legacy_health_and_graph_values_are_unchanged(self):
  result=self.page.evaluate("""()=>{
    const values=['少なめ','いつもどおり','多め','気になる'];const raw=M.blank();
    raw.records=values.map((v,i)=>({id:'old-health-'+i,type:'health',date:M.addDays(today(),i-3),time:'08:00',createdAt:new Date().toISOString(),note:'昔の記録',appetite:v,droppings:v,activity:v}));
    const a=M.validateBackup({app:APP,version:1,data:raw}),b=M.validateBackup({app:APP,version:2,data:raw});
    return {raw:raw.records,a:a.records,b:b.records,graph:M.chartData(a.records,'droppings',7).map(d=>d.value)};
  }""")
  owned=[{**r,'birdId':'bird-1'} for r in result['raw']];self.assertEqual(result['a'],owned);self.assertEqual(result['b'],owned);self.assertEqual(result['graph'],[1,2,3,None])
 def test_offline_care_and_undo_preserve_records(self):
  expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了')
  self.page.evaluate("""async()=>{if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));}""")
  self.ctx.set_offline(True);self.page.get_by_role('button',name='ご飯替えを記録',exact=True).click()
  expect(self.page.get_by_role('button',name='ご飯替えは実施済み',exact=True)).to_be_disabled()
  self.page.get_by_role('button',name='直前の記録を取り消す',exact=True).click();expect(self.page.get_by_role('button',name='ご飯替えを記録',exact=True)).to_be_enabled()
  self.page.reload();self.assertEqual(self.records(),[])
 def test_timer_banner_elapsed_and_cross_tab_confirmation_safety(self):
  self.page.goto(self.base+'#timer');self.page.get_by_role('button',name='放鳥をはじめる',exact=True).click()
  expect(self.page.get_by_role('button',name='放鳥を終了',exact=True)).to_be_visible()
  self.page.goto(self.base+'#home');expect(self.page.locator('#active-timer')).to_contain_text('放鳥は計測中')
  self.page.locator('#active-timer').click();expect(self.page.locator('#timer-elapsed')).to_contain_text('経過')
  self.page.get_by_role('button',name='放鳥を終了',exact=True).evaluate('(b)=>{b.click();b.click();}')
  expect(self.page.locator('#confirm-dialog')).to_be_visible()
  self.page.evaluate('async()=>{await mutate(s=>s.timer.startedAt+=10);}')
  target=self.page.evaluate('state.timer.startedAt');self.page.locator('#confirm-ok').click()
  expect(self.page.locator('#toast')).to_contain_text('別の画面で変更')
  self.assertEqual(self.records(),[]);self.assertEqual(self.page.evaluate('state.timer.startedAt'),target)
 def test_readable_labels_touch_targets_and_small_screens(self):
  for width in [320,390]:
   self.page.set_viewport_size({'width':width,'height':844});self.page.goto(self.base+'#home')
   for selector,min_size in [('.bottom-nav a',12),('.action-tile strong',14),('.health-cell span',12),('.care-check small',12)]:
    for node in self.page.locator(selector).all():self.assertGreaterEqual(node.evaluate('(n)=>parseFloat(getComputedStyle(n).fontSize)'),min_size)
   for selector in ['.bottom-nav a','.action-tile','.care-check','.header-tools button']:
    for node in self.page.locator(selector).all():self.assertGreaterEqual(node.bounding_box()['height'],44)
   for route in ['home','records','calendar','care','timer','reminders','health','weight','album','behavior','appearance','settings','backup']:
    self.page.goto(self.base+'#'+route);self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,route))
   self.page.goto(self.base+'#calendar')
   for day in self.page.locator('.calendar-day').all():
    self.assertGreaterEqual(day.bounding_box()['width'],43.9);self.assertGreaterEqual(day.bounding_box()['height'],44)
   self.page.goto(self.base+'#home');self.page.evaluate("document.documentElement.style.fontSize='28px'")
   self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   self.page.evaluate("document.documentElement.style.fontSize=''")
  for route in ['home','care','timer','calendar']:
   self.page.goto(self.base+'#'+route);self.page.screenshot(path='/tmp/kozabota-phase1-'+route+'.png',full_page=True)
