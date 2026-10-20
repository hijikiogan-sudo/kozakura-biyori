"""Home customization: isolated synthetic records, offline and compatibility checks."""
import unittest
from playwright.sync_api import expect
import test_phase2_ux

class HomeCustomizationTests(unittest.TestCase):
 setUpClass=classmethod(test_phase2_ux.Phase2UXTests.setUpClass.__func__)
 tearDownClass=classmethod(test_phase2_ux.Phase2UXTests.tearDownClass.__func__)
 setUp=test_phase2_ux.Phase2UXTests.setUp
 tearDown=test_phase2_ux.Phase2UXTests.tearDown
 records=test_phase2_ux.Phase2UXTests.records
 def settings_page(self):
  self.page.goto(self.base+'#home-actions');expect(self.page.get_by_role('heading',name='よく使う操作',exact=True)).to_be_visible()
 def choose(self,ids):
  for i in range(4):self.page.locator(f'[name=home-action-{i}]').select_option(ids[i] if i<len(ids) else '')
 def test_selection_order_cancel_duplicates_and_default_reset(self):
  self.settings_page();self.choose(['care','reminders','chewed','note']);self.page.get_by_role('button',name='保存せずホームへ戻る').click()
  expect(self.page.locator('#home-shortcuts button')).to_have_text(['体重記録','行動記録','写真アルバム','カレンダー'])
  self.settings_page();self.choose(['care','care']);self.page.get_by_role('button',name='よく使う操作を保存').click();expect(self.page.get_by_role('alert')).to_contain_text('重複せず')
  self.choose([]);self.page.get_by_role('button',name='よく使う操作を保存').click();expect(self.page.get_by_role('alert')).to_contain_text('1〜4つ')
  self.choose(['care','reminders','chewed','note']);self.page.get_by_role('button',name='よく使う操作を保存').click()
  expect(self.page.locator('#home-shortcuts button')).to_have_text(['お世話記録','お世話の予定','かじり跡','メモを書く'])
  self.page.reload();expect(self.page.locator('#home-shortcuts button')).to_have_count(4)
  self.page.locator('#home-shortcuts button').nth(2).click();expect(self.page.locator('#main h1')).to_contain_text('かじり跡アルバム')
  self.settings_page();self.page.get_by_role('button',name='初期の4つに戻す').click();self.page.get_by_role('button',name='よく使う操作を保存').click()
  expect(self.page.locator('#home-shortcuts button')).to_have_text(['体重記録','行動記録','写真アルバム','カレンダー'])
 def test_every_operation_opens_its_destination(self):
  ids=self.page.evaluate('M.HOME_SHORTCUTS')
  for id in ids:
   self.page.evaluate('(id)=>{state.settings.homeShortcuts=[id];render();}',id)
   self.page.locator('#home-shortcuts button').click()
   if id in ('note','health'):
    expect(self.page.locator('#dialog')).to_be_visible();self.page.locator('#close-dialog').click()
   else:
    expect(self.page).to_have_url(self.base+'#'+('album' if id=='chewed' else id))
   self.page.goto(self.base+'#home')
 def test_latest_uses_actual_date_time_legacy_and_undo(self):
  self.page.evaluate("""async()=>{await mutate(s=>{s.records=[
   {id:'new-water',type:'water',date:today(),time:'08:30',createdAt:'2026-10-19T00:00:00Z',note:''},
   {id:'old-water',type:'water',date:today(),time:'07:00',createdAt:'2026-10-20T00:00:00Z',note:''},
   {id:'old-food',type:'food',date:M.addDays(today(),-1),createdAt:'2026-10-19T10:15:00+09:00',note:''},
   {id:'future-clean',type:'clean',date:M.addDays(today(),1),time:'08:00',createdAt:'2026-10-20T00:00:00Z',note:''}];s.settings.reminders.water={enabled:true,interval:1,startDate:today(),time:'08:00',extraTimes:[]};});render();}""")
  expect(self.page.locator('[data-care-type=water]')).to_contain_text('今日 08:30')
  expect(self.page.locator('[data-care-type=food]')).to_contain_text('昨日 10:15')
  expect(self.page.locator('[data-care-type=clean]')).to_contain_text('まだ記録がありません')
  before=self.records();self.page.get_by_role('button',name='掃除を記録',exact=True).click();expect(self.page.locator('[data-care-type=clean]')).to_contain_text('今日 09:00')
  self.page.get_by_role('button',name='直前の記録を取り消す').click();expect(self.page.locator('[data-care-type=clean]')).to_contain_text('まだ記録がありません');self.assertEqual(self.records(),before)
  self.page.evaluate("async()=>{await save(s=>s.records=s.records.filter(r=>r.id!=='new-water'),null);}")
  expect(self.page.locator('[data-care-type=water]')).to_contain_text('今日 07:00')
  self.page.evaluate("async()=>{await save(s=>s.records.find(r=>r.id==='old-water').time='06:25',null);}")
  expect(self.page.locator('[data-care-type=water]')).to_contain_text('今日 06:25')
 def test_offline_backup_restore_keeps_customization_and_records(self):
  self.page.evaluate("""async()=>{await mutate(s=>{s.settings.homeShortcuts=['timer','care'];s.records=[{id:'old',type:'clean',date:'2026-10-17',time:'15:45',note:'保持する記録',createdAt:'2026-10-17T06:45:00Z'}];});render();}""")
  self.page.evaluate("async()=>{await navigator.serviceWorker.ready;await caches.match(location.href.split('#')[0]);}")
  self.ctx.set_offline(True);self.page.reload();expect(self.page.locator('#home-shortcuts button')).to_have_text(['放鳥タイマー','お世話記録'])
  expect(self.page.locator('[data-care-type=clean]')).to_contain_text('2026/10/17 15:45')
  for version in (1,2):
   self.page.evaluate("""version=>{window.restoreTask=importBackup(new File([JSON.stringify({app:APP,version,data:state})],'test.json',{type:'application/json'}));}""",version)
   expect(self.page.locator('#confirm-dialog')).to_be_visible();self.page.locator('#confirm-ok').click();self.page.evaluate('async()=>{await window.restoreTask;}')
   self.assertEqual(self.page.evaluate('state.settings.homeShortcuts'),['timer','care']);self.assertEqual(self.records()[0]['note'],'保持する記録')
 def test_small_screen_and_large_text_keep_tap_targets(self):
  self.page.evaluate("state.settings.homeShortcuts=['reminders','timer','breeding','album'];render();")
  for width in (320,390,402):
   self.page.set_viewport_size({'width':width,'height':874})
   for font in ('14px','28px'):
    self.page.evaluate('(font)=>document.documentElement.style.fontSize=font',font)
    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    for button in self.page.locator('#home-shortcuts button').all():
     box=button.bounding_box();self.assertGreaterEqual(box['width'],44);self.assertGreaterEqual(box['height'],44)
  self.page.evaluate("document.documentElement.style.fontSize='14px'");self.page.set_viewport_size({'width':402,'height':874})
  self.page.screenshot(path='/tmp/home-customization.png',full_page=True)
