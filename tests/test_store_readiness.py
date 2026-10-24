"""App Store readiness: policy pages, data deletion, theme and vet export. Synthetic data only."""
import subprocess
import sys
from pathlib import Path
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

    def test_dark_css_is_generated_from_current_style_css(self):
        root = Path(__file__).resolve().parents[1]
        before = (root / 'dark.css').read_text(encoding='utf-8')
        subprocess.run([sys.executable, '-I', str(root / 'scripts/generate_dark_css.py')], check=True)
        self.assertEqual((root / 'dark.css').read_text(encoding='utf-8'), before, 'Run scripts/generate_dark_css.py after changing style.css')

    def test_dark_mode_follows_system_setting(self):
        backgrounds = {}
        for scheme in ('light', 'dark'):
            self.page.emulate_media(color_scheme=scheme)
            self.open('home')
            backgrounds[scheme] = self.page.evaluate("getComputedStyle(document.querySelector('.app-shell')).backgroundColor")
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.assertNotEqual(backgrounds['light'], backgrounds['dark'])
        self.assertEqual(self.page.evaluate("getComputedStyle(document.documentElement).colorScheme"), 'dark')

    def test_vet_report_page_prints_and_exports_csv(self):
        self.open('settings')
        self.page.evaluate('''async()=>{await mutate(s=>{s.profile.name='合成の愛鳥';s.records=[{id:'w1',type:'weight',date:today(),value:48,note:'',createdAt:new Date().toISOString()},
            {id:'h1',type:'health',date:today(),appetite:'少なめ',droppings:'いつもどおり',activity:'いつもどおり',note:'合成の観察',createdAt:new Date().toISOString()}];});render();}''')
        self.page.get_by_role('button', name='受診用レポート').click()
        main = self.page.locator('main')
        expect(main).to_contain_text('合成の愛鳥の記録')
        expect(main).to_contain_text('48 g')
        expect(main).to_contain_text('「いつもどおり」以外：1件')
        with self.page.expect_download() as info:
            self.page.get_by_role('button', name='CSVで書き出す').click()
        content = Path(info.value.path()).read_text(encoding='utf-8-sig')
        self.assertIn('体重,48 g', content)
        self.assertIn('合成の観察', content)
        self.page.emulate_media(media='print')
        self.page.evaluate("dispatchEvent(new Event('beforeprint'))")
        expect(self.page.locator('.bottom-nav')).to_be_hidden()
        expect(self.page.get_by_role('button', name='CSVで書き出す')).to_be_hidden()
        self.assertTrue(self.page.locator('main details').evaluate('d=>d.open'))


if __name__ == '__main__':
    unittest.main()
