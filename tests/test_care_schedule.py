"""Care schedule setup, completion, backup, calendar export and offline UI."""
import functools,json,shutil,threading,unittest
from pathlib import Path
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
from test_timer import QuietHandler

class CareScheduleTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  root=str(Path(__file__).resolve().parents[1]);cls.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=root));threading.Thread(target=cls.server.serve_forever,daemon=True).start()
  cls.base=f'http://127.0.0.1:{cls.server.server_port}/';cls.p=sync_playwright().start();cls.browser=cls.p.chromium.launch(executable_path=shutil.which('chromium'))
 @classmethod
 def tearDownClass(cls):
  cls.browser.close();cls.p.stop();cls.server.shutdown();cls.server.server_close()
 def setUp(self):
  self.ctx=self.browser.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo');self.page=self.ctx.new_page();self.errors=[];self.page.on('pageerror',lambda e:self.errors.append(str(e)))
  self.page.clock.install(time=datetime(2026,10,20,tzinfo=timezone.utc)) # 2026-10-20 00:00 UTC, 09:00 Tokyo
  self.page.goto(self.base+'#reminders');expect(self.page.get_by_role('button',name='予定を保存',exact=True)).to_be_visible()
 def tearDown(self):
  self.ctx.close();self.assertEqual(self.errors,[])
 def configure(self):
  for kind in ['food','water']:
   self.page.locator('.reminder-setting.type-'+kind).get_by_role('button',name='朝夕（8時・18時）にする').click()
  self.page.get_by_role('button',name='予定を保存',exact=True).click()
  expect(self.page.locator('#toast')).to_contain_text('予定を保存しました')
 def test_setup_two_daily_times_record_backup_export_and_offline(self):
  self.configure();self.page.goto(self.base+'#home')
  expect(self.page.locator('#care-schedule-list li')).to_have_count(4)
  self.page.get_by_role('button',name='08:00の水替えを記録',exact=True).click();self.page.locator('#confirm-ok').click()
  expect(self.page.get_by_role('button',name='08:00の水替えは実施済み',exact=True)).to_be_disabled()
  expect(self.page.get_by_role('button',name='18:00の水替えを記録',exact=True)).to_be_enabled()
  self.page.reload();expect(self.page.get_by_role('button',name='08:00の水替えは実施済み',exact=True)).to_be_disabled()
  data=self.page.evaluate('M.validateBackup({app:APP,version:2,data:state})')
  self.assertEqual(data['records'][0]['careSlot'],'08:00');self.assertEqual(data['settings']['reminders']['water']['extraTimes'],['18:00'])
  self.page.goto(self.base+'#reminders')
  with self.page.expect_download() as event:self.page.get_by_role('button',name='カレンダー用ファイルを書き出す',exact=True).click()
  ics=Path(event.value.path()).read_text();self.assertEqual(ics.count('BEGIN:VEVENT'),4);self.assertIn('TRIGGER:PT0S',ics)
  expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了')
  self.ctx.set_offline(True);self.page.goto(self.base+'#home');self.page.reload()
  expect(self.page.get_by_role('button',name='08:00の水替えは実施済み',exact=True)).to_be_disabled()
 def test_intervals_future_record_guard_and_mobile_form(self):
  self.configure();self.page.locator('[name=water-interval]').select_option('2')
  self.page.get_by_role('button',name='予定を保存',exact=True).click();expect(self.page.get_by_text('水替え：2日おき',exact=False)).to_be_visible();self.page.reload()
  self.page.locator('[aria-label="表示する日"]').fill('2026-10-21')
  expect(self.page.locator('#care-schedule-list li')).to_have_count(2)
  self.assertTrue(all(button.is_disabled() for button in self.page.locator('#care-schedule-list button').all()))
  self.page.locator('[aria-label="表示する日"]').fill('2026-10-22');expect(self.page.locator('#care-schedule-list li')).to_have_count(4)
  for width in [320,390]:
   self.page.set_viewport_size({'width':width,'height':844});self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  self.page.screenshot(path='/tmp/kozabota-care-schedule.png',full_page=True)
 def test_duplicate_times_do_not_overwrite_saved_settings(self):
  self.configure();self.page.locator('[name=water-time-1]').fill('08:00')
  self.page.get_by_role('button',name='予定を保存',exact=True).click();expect(self.page.locator('#toast')).to_contain_text('重複しない時刻')
  self.assertEqual(self.page.evaluate('state.settings.reminders.water.extraTimes'),['18:00'])
