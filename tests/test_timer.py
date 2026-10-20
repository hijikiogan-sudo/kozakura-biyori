"""Browser regression checks. Run: python3 -m unittest discover -s tests -v"""
import functools
from datetime import datetime, timezone, timedelta
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

    def test_active_card_large_reading_and_stable_animation(self):
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
        self.start()
        self.page.evaluate("location.hash='home'")
        banner = self.page.locator('#active-timer')
        expect(banner).to_be_visible()
        expect(banner).to_contain_text('経過')
        self.assertGreaterEqual(self.page.locator('#active-timer-value').evaluate('(n)=>parseFloat(getComputedStyle(n).fontSize)'), 32)
        self.page.evaluate("window.testBird=document.querySelector('.active-timer-bird')")
        self.page.clock.fast_forward(65000)
        expect(self.page.locator('#active-timer-value')).to_have_text('00:01:05')
        self.assertTrue(self.page.evaluate("window.testBird===document.querySelector('.active-timer-bird')"))
        for width in (320, 390):
            self.page.set_viewport_size({'width': width, 'height': 844})
            for font in ('14px', '28px'):
                self.page.evaluate('(font)=>document.documentElement.style.fontSize=font', font)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                self.assertTrue(self.page.locator('#active-timer-value').evaluate('(n)=>n.getBoundingClientRect().height<=parseFloat(getComputedStyle(n).lineHeight)+2'))
        self.page.screenshot(path='/tmp/flight-timer-large-text.png', full_page=True)
        self.page.evaluate("document.documentElement.style.fontSize='14px'")
        self.page.screenshot(path='/tmp/flight-timer.png', full_page=True)
        self.page.reload()
        expect(self.page.locator('#active-timer-value')).to_have_text('00:01:05')
        banner.click()
        expect(self.page.locator('#timer-display')).to_be_visible()
        expect(banner).to_be_hidden()

    def test_active_card_countdown_and_selected_bird(self):
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
        self.page.evaluate("(async()=>{await save(s=>s.settings.birdAppearance='button-blue','')})()")
        self.page.get_by_role('button', name='カウントダウン', exact=True).click()
        self.start()
        self.page.evaluate("location.hash='home'")
        expect(self.page.locator('#active-timer-label')).to_have_text('残り')
        expect(self.page.locator('.active-timer-bird')).to_have_attribute('data-appearance', 'button-blue')
        self.page.emulate_media(reduced_motion='reduce')
        self.assertEqual(self.page.locator('.flight-wing').evaluate('(n)=>getComputedStyle(n).animationName'), 'none')
        self.page.clock.fast_forward(15*60000)
        expect(self.page.locator('#active-timer-value')).to_have_text('00:00:00')
        expect(self.page.locator('#active-timer')).to_have_class('active-timer finished')
        expect(self.page.locator('#active-timer-detail')).to_contain_text('設定時間に到達')
        self.assertEqual(self.records(), [])
        self.page.clock.fast_forward(60000)
        expect(self.page.locator('#active-timer-detail')).to_contain_text('00:16:00')

    def test_bird_actions_cycle_without_changing_timer(self):
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
        self.start()
        self.page.evaluate("location.hash='home'")
        expect(self.page.locator('.bird-action')).to_have_count(3)
        for name, milliseconds in [('fly', 4000), ('perch', 12000), ('preen', 20000)]:
            self.page.evaluate("""(milliseconds)=>{
                document.querySelector('.active-timer-bird').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=milliseconds;});
            }""", milliseconds)
            expect(self.page.locator('.bird-action-'+name)).to_have_css('opacity', '1')
            for other in {'fly', 'perch', 'preen'}-{name}:
                expect(self.page.locator('.bird-action-'+other)).to_have_css('opacity', '0')
            self.page.locator('#active-timer').screenshot(path='/tmp/timer-bird-'+name+'.png')
        expect(self.page.locator('#active-timer-value')).to_have_text('00:00:00')
        self.assertEqual(self.records(), [])
        self.page.emulate_media(reduced_motion='reduce')
        expect(self.page.locator('.bird-action-perch')).to_have_css('opacity', '1')
        for selector in ['.bird-action', '.bird-preen-head', '.flight-bob', '.flight-wing']:
            for node in self.page.locator(selector).all():
                expect(node).to_have_css('animation-name', 'none')

    def test_countup_and_reload(self):
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
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
        self.page.evaluate("""async () => {
            if (navigator.serviceWorker.controller) return;
            await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
        }""")
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


    def install_native_bridge(self, permission='granted', fail=False):
        import json
        script = """(() => {
          window.nativeCalls=[];
          const permission=PERMISSION, fail=FAIL;
          window.KozabotaNativeNotifications={
            async getPermission(){return permission;},
            async requestPermission(){nativeCalls.push(['permission']);return permission;},
            async replaceTimerNotification(request){if(fail)throw Error('OS failure');nativeCalls.push(['replace',request]);},
            async cancelTimerNotification(request){nativeCalls.push(['cancel',request]);}
          };
        })();""".replace('PERMISSION',json.dumps(permission)).replace('FAIL',json.dumps(fail))
        self.page.add_init_script(script)
        self.page.reload()
        expect(self.page.locator('#timer-display')).to_be_visible()

    def test_native_bridge_start_restore_and_cancel_without_changing_timer_data(self):
        self.install_native_bridge()
        self.page.get_by_role('button',name='カウントダウン',exact=True).click()
        self.start()
        expect(self.page.locator('#native-timer-status')).to_contain_text('端末に予約しました')
        requests=self.page.evaluate("nativeCalls.filter(c=>c[0]==='replace').map(c=>c[1])")
        timer=self.page.evaluate('state.timer')
        self.assertEqual(requests[0]['deadline'],timer['startedAt']+timer['durationSeconds']*1000)
        self.assertEqual(set(requests[0]),{'id','deadline','title','body','sound'})
        self.assertEqual(self.page.evaluate("nativeCalls.filter(c=>c[0]==='permission').length"),1)
        self.page.reload()
        expect(self.page.locator('#native-timer-status')).to_contain_text('端末に予約しました')
        self.assertEqual(self.page.evaluate("nativeCalls.find(c=>c[0]==='replace')[1].deadline"),requests[0]['deadline'])
        self.assertEqual(self.page.evaluate("nativeCalls.filter(c=>c[0]==='permission').length"),0)
        self.page.get_by_role('button',name='記録せず取り消す',exact=True).click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.get_by_role('button',name='放鳥をはじめる',exact=True)).to_be_visible()
        self.page.wait_for_function("nativeCalls.at(-1)[0]==='cancel'")
        self.assertEqual(self.records(),[])

    def test_native_denial_and_schedule_failure_do_not_prevent_recording(self):
        for permission,fail,message in [('denied',False,'許可されていません'),('granted',True,'できませんでした')]:
            with self.subTest(permission=permission):
                self.install_native_bridge(permission,fail)
                self.page.get_by_role('button',name='カウントダウン',exact=True).click()
                self.start()
                expect(self.page.locator('#native-timer-status')).to_contain_text(message)
                self.page.clock.fast_forward(60000)
                self.page.get_by_role('button',name='放鳥を終了',exact=True).click()
                self.page.locator('#confirm-ok').click()
                expect(self.page.get_by_role('button',name='放鳥をはじめる',exact=True)).to_be_visible()
        self.assertEqual(len(self.records()),2)

if __name__ == '__main__':
    unittest.main()
