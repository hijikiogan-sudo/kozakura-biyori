"""Browser regression checks. Run: python3 -m unittest discover -s tests -v"""
import functools
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
import unittest

from playwright.sync_api import sync_playwright, expect


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class TimerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = str(Path(__file__).resolve().parents[1])
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=shutil.which('chromium'), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Tokyo')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(self.base + '#timer')
        expect(self.page.locator('#timer-display')).to_be_visible()
        self.page.clock.install()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def start(self):
        self.page.get_by_role('button', name='放鳥をはじめる', exact=True).click()
        expect(self.page.get_by_role('button', name='放鳥を終了', exact=True)).to_be_visible()

    def records(self):
        return self.page.evaluate('(async () => (await readState()).records)()')

    def test_countup_and_reload(self):
        expect(self.page.locator('#timer-display')).to_have_text('00:00:00')
        self.start()
        self.page.clock.fast_forward(65000)
        expect(self.page.locator('#timer-display')).to_have_text('00:01:05')
        self.page.reload()
        expect(self.page.locator('#timer-display')).to_have_text('00:01:05')
        expect(self.page.locator('#timer-status')).to_have_text('放鳥中')

    def test_countdown_presets_and_custom_validation(self):
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        expect(self.page.locator('#timer-display')).to_have_text('00:15:00')
        for minutes, text in [(30, '00:30:00'), (60, '01:00:00'), (15, '00:15:00')]:
            self.page.get_by_role('button', name=f'{minutes}分', exact=True).click()
            expect(self.page.locator('#timer-display')).to_have_text(text)
        field = self.page.get_by_label('放鳥時間（分）', exact=True)
        for invalid in ['', '0', '1.5', '1441']:
            field.fill(invalid)
            self.page.get_by_role('button', name='放鳥をはじめる', exact=True).click()
            self.assertIsNone(self.page.evaluate('state.timer'))
        field.fill('2')
        expect(self.page.locator('#timer-display')).to_have_text('00:02:00')
        self.start()
        self.page.clock.fast_forward(1000)
        expect(self.page.locator('#timer-display')).to_have_text('00:01:59')

    def test_countdown_completion_keeps_actual_elapsed_record(self):
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        self.start()
        self.page.clock.fast_forward(60000)
        expect(self.page.locator('#timer-display')).to_have_text('00:14:00')
        self.page.reload()
        expect(self.page.locator('#timer-display')).to_have_text('00:14:00')
        self.page.clock.fast_forward(840000)
        expect(self.page.locator('#timer-display')).to_have_text('00:00:00')
        expect(self.page.locator('#timer-status')).to_have_text('設定時間になりました')
        expect(self.page.locator('#timer-complete')).to_be_visible()
        self.assertEqual(self.records(), [])
        self.page.clock.fast_forward(120000)
        expect(self.page.locator('#timer-display')).to_have_text('00:00:00')
        self.page.get_by_role('button', name='放鳥を終了', exact=True).click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.get_by_role('button', name='放鳥をはじめる', exact=True)).to_be_visible()
        records = self.records()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['type'], 'flight')
        self.assertEqual(records[0]['minutes'], 17)
        elapsed_minutes = (records[0]['endedAt'] - records[0]['startedAt']) / 60000
        self.assertAlmostEqual(elapsed_minutes, 17, delta=0.1)

    def test_legacy_active_timer_and_cancel(self):
        self.page.evaluate("(async () => {await mutate(s => s.timer={startedAt:Date.now()-90000,date:today()});render();})()")
        expect(self.page.locator('#timer-display')).to_have_text('00:01:30')
        self.page.reload()
        expect(self.page.locator('#timer-status')).to_have_text('放鳥中')
        expect(self.page.locator('#timer-display')).to_have_text('00:01:30')
        self.page.get_by_role('button', name='記録せず取り消す', exact=True).click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.get_by_role('button', name='放鳥をはじめる', exact=True)).to_be_visible()
        self.assertEqual(self.records(), [])
        self.assertIsNone(self.page.evaluate('state.timer'))

    def test_offline_countdown(self):
        expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了', timeout=30000)
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        self.page.get_by_role('button', name='30分', exact=True).click()
        self.start()
        self.context.set_offline(True)
        self.page.clock.fast_forward(300000)
        self.page.reload()
        expect(self.page.locator('#timer-display')).to_have_text('00:25:00')
        self.page.clock.fast_forward(1500000)
        expect(self.page.locator('#timer-complete')).to_be_visible()
        self.page.get_by_role('button', name='放鳥を終了', exact=True).click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.get_by_role('button', name='放鳥をはじめる', exact=True)).to_be_visible()
        self.assertEqual(self.records()[0]['minutes'], 30)

    def test_calendar_export_keeps_original_deadline_and_disables_after_expiry(self):
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        self.page.get_by_role('button', name='30分', exact=True).click()
        self.start()
        timer=self.page.evaluate('state.timer')
        self.page.clock.fast_forward(300000)
        self.page.reload()
        button=self.page.get_by_role('button',name='終了のお知らせ用ファイルを書き出す',exact=True)
        with self.page.expect_download() as event:
            button.click()
        content=Path(event.value.path()).read_bytes().decode().replace('\r\n ','')
        expected=datetime.fromtimestamp((timer['startedAt']+timer['durationSeconds']*1000)/1000,timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        self.assertIn('DTSTART:'+expected+'\r\n',content)
        self.assertIn('TRIGGER:PT0S',content)
        self.assertNotIn('RRULE:',content)
        expect(self.page.locator('#toast')).to_contain_text('カレンダーへ追加')
        self.page.clock.fast_forward(1500000)
        expect(button).to_be_disabled()

    def test_completion_sound_and_notice_work_on_other_app_routes_once(self):
        self.page.get_by_role('button',name='カウントダウン',exact=True).click()
        self.start()
        expect(self.page.locator('#timer-audio-status')).to_contain_text('準備できました')
        self.page.evaluate("() => {window.__tones=0;const createTone=timerAudioContext.createOscillator.bind(timerAudioContext);timerAudioContext.createOscillator=()=>{window.__tones++;return createTone();};}")
        self.assertEqual(self.page.evaluate('window.__tones'),0)
        self.page.goto(self.base+'#home')
        self.page.clock.fast_forward(900000)
        expect(self.page.locator('#toast')).to_have_text('放鳥の設定時間になりました。愛鳥を確認してください。')
        self.assertEqual(self.page.evaluate('window.__tones'),3)
        self.page.clock.fast_forward(5000)
        self.assertEqual(self.page.evaluate('window.__tones'),3)
        self.assertEqual(self.records(),[])

    def test_audio_failure_does_not_block_timer_and_test_button_can_reenable_sound(self):
        self.page.get_by_role('button',name='カウントダウン',exact=True).click()
        self.page.evaluate('window.AudioContext=undefined;window.webkitAudioContext=undefined;')
        self.start()
        self.page.get_by_role('button',name='終了音を試す',exact=True).click()
        expect(self.page.locator('#toast')).to_contain_text('音を再生できません')
        self.assertIsNotNone(self.page.evaluate('state.timer'))
        self.page.reload()
        self.page.get_by_role('button',name='終了音を試す',exact=True).click()
        expect(self.page.locator('#timer-audio-status')).to_contain_text('準備できました')
        expect(self.page.locator('#toast')).to_contain_text('終了音を鳴らしました')


if __name__ == '__main__':
    unittest.main()
