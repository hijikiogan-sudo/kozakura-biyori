"""iOS app behaviour with a fake Capacitor runtime injected before the page loads. Synthetic data only.

This checks native.js and the app's use of it. It does not prove that iOS delivers notifications; that needs the simulator or a device.
"""
from datetime import datetime
import json
import unittest
from playwright.sync_api import expect
import test_timer

FAKE_CAPACITOR = '''
window.__native={permission:'prompt',pending:[],files:[],shared:0};
const N=window.__native;
window.Capacitor={isNativePlatform:()=>true,Plugins:{
  LocalNotifications:{
    async checkPermissions(){return {display:N.permission};},
    async requestPermissions(){N.permission='granted';return {display:'granted'};},
    async schedule({notifications}){for(const n of notifications){N.pending=N.pending.filter(p=>p.id!==n.id);N.pending.push({id:n.id,title:n.title,body:n.body,at:n.schedule.at.getTime()});}},
    async cancel({notifications}){const ids=new Set(notifications.map(n=>n.id));N.pending=N.pending.filter(p=>!ids.has(p.id));},
    async getPending(){return {notifications:N.pending.map(({id,title,body})=>({id,title,body}))};}
  },
  Filesystem:{async writeFile({path,data}){N.files.push({path,data});return {uri:'file:///cache/'+path};}},
  Share:{async share(){N.shared++;return {};}}
}};
'''


class IOSBridgeTests(unittest.TestCase):
    setUpClass = classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass = classmethod(test_timer.TimerTests.tearDownClass.__func__)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Tokyo')
        self.context.add_init_script(FAKE_CAPACITOR)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        # 07:00 local time, so today's 08:00 and 18:00 slots are still ahead.
        self.page.clock.install(time=datetime.fromisoformat('2026-10-24T07:00:00+09:00'))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def open(self, route):
        self.page.goto(self.base + '#' + route)
        expect(self.page.locator('main')).not_to_contain_text('記録をひらいています')

    def native(self):
        return self.page.evaluate('window.__native')

    def care_pending(self):
        return sorted((n for n in self.native()['pending'] if 200000 <= n['id'] < 210000), key=lambda n: n['at'])

    def save_food_reminder(self):
        self.open('reminders')
        main = self.page.locator('main')
        expect(main).not_to_contain_text('カレンダーへ予定を登録')
        expect(self.page.locator('#care-notification-status')).to_contain_text('予定を保存すると、通知を許可するか確認します')
        food = self.page.locator('fieldset.type-food')
        food.get_by_label('予定を有効にする').check()
        food.get_by_label('時刻1').fill('08:00')
        food.get_by_label('時刻2（任意）').fill('18:00')
        self.page.get_by_role('button', name='予定を保存').click()
        expect(self.page.locator('#care-notification-status')).to_contain_text('件のお知らせを端末に予約しています')

    def test_saving_reminders_asks_permission_once_and_schedules_care_notifications(self):
        self.save_food_reminder()
        self.assertEqual(self.native()['permission'], 'granted')
        pending = self.care_pending()
        self.assertEqual(len(pending), 28)
        self.assertEqual([p['body'] for p in pending[:2]], ['ご飯替えの時間です（08:00）', 'ご飯替えの時間です（18:00）'])
        self.assertTrue(all(p['title'] == 'コザボタ日和' for p in pending))
        expect(self.page.locator('#care-notification-status')).to_contain_text('28件')

    def test_recording_care_early_cancels_that_slot(self):
        self.save_food_reminder()
        first = self.care_pending()[0]
        self.page.evaluate("async()=>{await mutate(s=>{s.records.push({id:'early-food',type:'food',date:today(),time:'07:30',note:'',createdAt:new Date().toISOString()});});}")
        self.page.wait_for_timeout(100)
        pending = self.care_pending()
        self.assertNotIn(first['id'], [p['id'] for p in pending])
        self.assertEqual(len(pending), 27)

    def test_disabling_reminders_cancels_everything(self):
        self.save_food_reminder()
        self.page.locator('fieldset.type-food').get_by_label('予定を有効にする').uncheck()
        self.page.get_by_role('button', name='予定を保存').click()
        expect(self.page.locator('#care-notification-status')).to_contain_text('有効な予定がないため')
        self.assertEqual(self.care_pending(), [])

    def test_countdown_schedules_and_cancel_removes_timer_notification(self):
        self.page.evaluate("window.__native.permission='granted'")
        self.open('timer')
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        self.page.get_by_role('button', name='放鳥をはじめる', exact=True).click()
        expect(self.page.locator('#native-timer-status')).to_contain_text('予約しました')
        timer = [n for n in self.native()['pending'] if n['id'] == 104001]
        self.assertEqual(len(timer), 1)
        self.assertEqual(timer[0]['body'], '放鳥の設定時間になりました。愛鳥を確認してください。')
        self.page.get_by_role('button', name='記録せず取り消す', exact=True).click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.get_by_role('button', name='放鳥をはじめる', exact=True)).to_be_visible()
        self.page.wait_for_timeout(100)
        self.assertEqual([n for n in self.native()['pending'] if n['id'] == 104001], [])

    def test_ios_screens_do_not_point_to_the_calendar_workaround(self):
        self.open('settings')
        main = self.page.locator('main')
        expect(main).to_contain_text('ご飯替え・水替え・掃除をiPhoneに通知')
        expect(main).not_to_contain_text('カレンダー登録')
        expect(main).not_to_contain_text('印刷/PDF')
        self.open('reminders')
        expect(main).not_to_contain_text('カレンダー')
        self.open('timer')
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        expect(main).to_contain_text('アプリを閉じていてもiPhoneの通知でお知らせします')
        expect(main).not_to_contain_text('カレンダー')
        expect(self.page.locator('html')).to_have_class('native')

    def test_files_go_to_share_sheet_and_print_is_hidden(self):
        self.open('backup')
        self.page.get_by_role('button', name='バックアップを書き出す').click()
        expect(self.page.locator('#toast')).to_contain_text('バックアップファイルを作成しました')
        native = self.native()
        self.assertEqual(native['shared'], 1)
        self.assertEqual(native['files'][0]['path'], 'kozakura-biyori-2026-10-24.json')
        self.assertEqual(json.loads(native['files'][0]['data'])['app'], 'kozakura-biyori')
        self.assertTrue(self.page.evaluate('async()=>Boolean((await readState()).lastBackup)'))
        self.page.evaluate("async()=>{await mutate(s=>{s.records.push({id:'w',type:'weight',date:today(),value:48,note:'',createdAt:new Date().toISOString()});});}")
        self.open('report')
        expect(self.page.get_by_role('button', name='印刷・PDF')).to_have_count(0)
        self.page.get_by_role('button', name='CSVで書き出す').click()
        expect(self.page.locator('#toast')).to_contain_text('CSVファイルを作成しました')
        self.assertEqual(self.native()['files'][-1]['path'], 'kozakura-biyori-records-2026-10-24.csv')
        expect(self.page.locator('#offline-status')).to_have_text('オフラインで利用できます')


if __name__ == '__main__':
    unittest.main()
