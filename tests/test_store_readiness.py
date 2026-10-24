"""App Store readiness: policy pages, data deletion, theme and vet export. Synthetic data only."""
import unittest
from playwright.sync_api import expect
import test_timer


class StoreReadinessTests(unittest.TestCase):
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

    def open(self, route):
        self.page.goto(self.base + '#' + route)
        expect(self.page.locator('main')).not_to_contain_text('記録をひらいています')

    def test_about_links_to_privacy_policy_and_support(self):
        self.open('about')
        self.page.get_by_role('link', name='プライバシーポリシー').click()
        expect(self.page.get_by_role('heading', name='プライバシーポリシー', level=1)).to_be_visible()
        self.page.get_by_role('link', name='サポート・よくある質問').click()
        expect(self.page.get_by_role('heading', name='サポート', level=1)).to_be_visible()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_delete_all_data_clears_records_media_and_timer(self):
        self.open('backup')
        self.page.evaluate('''async()=>{const c=document.createElement('canvas');c.width=4;c.height=4;const jpeg=c.toDataURL('image/jpeg');
            await mutate(s=>{s.profile.name='合成の愛鳥';s.profile.photo=jpeg;s.photos=[{id:'p1',kind:'image',date:today(),data:jpeg,favorite:false,caption:''}];
              s.records=[{id:'r1',type:'note',date:today(),note:'合成メモ',createdAt:new Date().toISOString()}];s.timer={date:today(),startedAt:Date.now(),durationSeconds:0};});render();}''')
        self.page.get_by_role('button', name='すべてのデータを削除').click()
        self.page.locator('#confirm-cancel').click()
        self.assertEqual(self.page.evaluate('async()=>(await readState()).records.length'), 1)
        self.page.get_by_role('button', name='すべてのデータを削除').click()
        self.page.get_by_role('button', name='すべて削除する').click()
        expect(self.page.locator('#toast')).to_contain_text('すべて削除しました')
        self.assertEqual(self.page.evaluate('location.hash'), '#home')
        state = self.page.evaluate('async()=>{const s=await readState();return [s.profile.name,s.profile.photo,s.photos.length,s.records.length,s.timer];}')
        self.assertEqual(state, ['', None, 0, 0, None])
        media = self.page.evaluate('''()=>new Promise(ok=>{const tx=db.transaction('media');const r=tx.objectStore('media').count();tx.oncomplete=()=>ok(r.result);})''')
        self.assertEqual(media, 0)


if __name__ == '__main__':
    unittest.main()
