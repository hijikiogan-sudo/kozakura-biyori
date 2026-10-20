"""A running page keeps its old code until the user safely reloads it."""
import functools
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import re
import threading
import unittest
from playwright.sync_api import sync_playwright, expect
from test_timer import QuietHandler


ROOT = Path(__file__).resolve().parents[1]
CURRENT = re.search(r"const APP_VERSION = '([^']+)'", (ROOT/'app.js').read_text()).group(1)
parts = CURRENT.split('.')
FUTURE = '.'.join(parts[:2]+[str(int(parts[2])+1)])


class UpdateHandler(QuietHandler):
    def do_GET(self):
        name = self.path.split('?')[0].lstrip('/') or 'index.html'
        if self.server.future and name in {'sw.js', 'app.js', 'index.html'}:
            data = (Path(self.directory)/name).read_bytes().replace(CURRENT.encode(), FUTURE.encode())
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript' if name.endswith('.js') else 'text/html')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


class AppUpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=shutil.which('chromium'), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        root = str(Path(__file__).resolve().parents[1])
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(UpdateHandler, directory=root))
        self.server.future = False
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.context = self.browser.new_context(viewport={'width':390, 'height':844}, timezone_id='Asia/Tokyo')
        self.page = self.context.new_page()
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/#home')
        expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了')
        self.page.evaluate('''async()=>{
            await navigator.serviceWorker.ready;
            if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
            await mutate(s=>{
                s.profile.name='更新テスト';
                s.timer={startedAt:Date.now()-61000,date:today()};
                s.records.push({id:'update-water',type:'water',date:today(),time:'08:00',note:'保存済みの記録',createdAt:new Date().toISOString()});
            });render();
        }''')

    def tearDown(self):
        self.context.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def upgrade(self):
        self.server.future = True
        self.page.evaluate('async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();}')
        expect(self.page.locator('#app-update')).to_be_visible(timeout=20000)
        expect(self.page.locator('#app-update')).to_contain_text('v'+FUTURE)

    def test_installed_update_requires_reload_and_keeps_timer_and_records(self):
        before = self.page.evaluate('JSON.stringify(state)')
        self.upgrade()
        # This reproduces the cause: activation alone leaves the old page running.
        expect(self.page.locator('.site-footer')).to_contain_text('v'+CURRENT)
        self.assertEqual(self.page.evaluate('JSON.stringify(state)'), before)
        self.page.get_by_role('button', name='更新して開き直す', exact=True).click()
        expect(self.page.locator('.site-footer')).to_contain_text('v'+FUTURE)
        expect(self.page.locator('#active-timer-start')).to_be_visible()
        expect(self.page.locator('.bird-action-preen')).to_be_visible()
        self.assertEqual(self.page.evaluate('JSON.stringify(state)'), before)
        expect(self.page.locator('#app-update')).to_be_hidden()

    def test_update_does_not_discard_pending_write_or_open_dialog(self):
        self.upgrade()
        self.page.evaluate('pendingWrites=1')
        self.page.get_by_role('button', name='更新して開き直す', exact=True).click()
        expect(self.page.locator('#toast')).to_have_text('保存が終わってから更新してください。')
        self.page.evaluate("pendingWrites=0;document.querySelector('#dialog').showModal()")
        self.page.evaluate("document.querySelector('#app-update button').click()")
        expect(self.page.locator('#toast')).to_contain_text('入力内容を保存し')
        expect(self.page.locator('.site-footer')).to_contain_text('v'+CURRENT)
        expect(self.page.locator('#dialog')).to_be_visible()
