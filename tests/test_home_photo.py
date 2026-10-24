"""Homepage layout, framing, comments, and backup regression checks."""
import base64
import functools
from http.server import ThreadingHTTPServer
import json
import re
from pathlib import Path
import shutil
import threading
import unittest
from playwright.sync_api import sync_playwright, expect
from test_timer import QuietHandler


class HomePhotoTests(unittest.TestCase):
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
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Tokyo', accept_downloads=True)
        self.page = self.context.new_page()
        self.errors, self.external = [], []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('request', lambda request: self.external.append(request.url) if request.url.startswith(('http:', 'https:')) and not request.url.startswith(self.base) else None)
        self.page.goto(self.base)
        expect(self.page.locator('#main h1')).to_be_visible()
        self.dialog = self.page.locator('#dialog')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])
        self.assertEqual(self.external, [])

    def edit(self):
        self.page.get_by_role('button', name='プロフィールを編集', exact=True).click()
        expect(self.dialog).to_be_visible()

    def save(self):
        self.dialog.get_by_role('button', name='プロフィールを保存', exact=True).click()
        expect(self.dialog).not_to_be_visible()

    def read_profile(self):
        return self.page.evaluate('(async()=> (await readState()).profile)()')

    def upload_photo(self):
        data = self.page.evaluate("""() => {
          const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
          const ctx=canvas.getContext('2d');
          ['#a2c48d','#f0a79e','#e0c175'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*400,0,400,800);});
          return canvas.toDataURL('image/png').split(',')[1];
        }""")
        self.dialog.locator('input[name=photo]').set_input_files({'name': 'bird.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(data)})
        expect(self.dialog.locator('.cover-preview')).to_have_class(re.compile('has-photo'))

    def set_range(self, name, value):
        self.dialog.locator(f'input[name="{name}"]').evaluate('(el,value)=>{el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));}', value)

    def test_photo_layout_crop_comment_persist_and_cancel(self):
        self.edit()
        self.upload_photo()
        self.dialog.get_by_label('縦長・大きめ', exact=True).check()
        self.set_range('cover-x', 10)
        self.set_range('cover-y', 85)
        self.set_range('cover-zoom', 2)
        comment = 'いつもありがとう\n今日も一緒に♡'
        self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).fill(comment)
        expect(self.dialog.locator('.cover-comment')).to_have_text(comment)
        expect(self.dialog.locator('.cover-preview')).to_have_class(re.compile('cover-portrait'))
        expect(self.dialog.locator('.cover-bird')).to_have_css('object-position', '10% 85%')
        preview_box=self.dialog.locator('.cover-preview').bounding_box()
        self.save()
        home_box=self.page.locator('#main .photo-hero').bounding_box()
        self.assertAlmostEqual(preview_box['width']/preview_box['height'],home_box['width']/home_box['height'],delta=0.01)
        profile = self.read_profile()
        self.assertTrue(profile['photo'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(profile['cover'], {'layout':'portrait','x':10,'y':85,'zoom':2,'comment':comment})
        expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了',timeout=30000)
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')
        self.context.set_offline(True)
        self.page.reload()
        expect(self.page.locator('#main .cover-comment')).to_have_text(comment)
        expect(self.page.locator('#main .cover-bird')).to_have_css('transform', 'matrix(2, 0, 0, 2, 0, 0)')
        self.edit()
        self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).fill('保存しない変更')
        self.dialog.get_by_label('横長・コンパクト', exact=True).check()
        self.page.locator('#close-dialog').click()
        self.assertEqual(self.read_profile(), profile)
        expect(self.page.locator('#main .cover-comment')).to_have_text(comment)

    def test_drag_preview_moves_photo_framing(self):
        self.edit()
        self.upload_photo()
        self.set_range('cover-zoom', 2)
        box = self.dialog.locator('.cover-preview').bounding_box()
        self.page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
        self.page.mouse.down()
        self.page.mouse.move(box['x']+box['width']/2+40, box['y']+box['height']/2+20, steps=4)
        self.page.mouse.up()
        self.assertLess(float(self.dialog.locator('input[name=cover-x]').input_value()), 50)
        self.assertLess(float(self.dialog.locator('input[name=cover-y]').input_value()), 42)
        self.save()
        self.assertLess(self.read_profile()['cover']['x'], 50)

    def test_empty_comment_and_safe_text_at_mobile_widths(self):
        self.edit()
        text = '<img src=x onerror=alert(1)>\nだいすき♡'
        self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).fill(text)
        self.save()
        expect(self.page.locator('#main .cover-comment')).to_have_text(text)
        self.assertEqual(self.page.locator('#main .speech img').count(), 0)
        for width in [320, 390]:
            self.page.set_viewport_size({'width':width,'height':844})
            for layout in ['いつもの形','横長・コンパクト','縦長・大きめ']:
                self.edit()
                self.dialog.get_by_label(layout, exact=True).check()
                self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).fill('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよわを')
                self.assertEqual(self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).get_attribute('maxlength'),'40')
                self.save()
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                self.assertTrue(self.page.locator('#main .speech').evaluate('(el)=>el.scrollHeight<=el.clientHeight'))
        self.edit()
        self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).fill('')
        self.save()
        expect(self.page.locator('#main .speech')).to_have_count(0)

    def test_backup_restore_keeps_customization_and_existing_records(self):
        self.page.evaluate("(async()=>{await mutate(s=>s.records.push({id:'before-customization',type:'note',date:today(),note:'大切な記録',createdAt:new Date().toISOString()}));render();})()")
        self.edit()
        self.upload_photo()
        self.dialog.get_by_label('横長・コンパクト', exact=True).check()
        self.set_range('cover-x', 0)
        self.dialog.get_by_label('吹き出しのフリーコメント', exact=True).fill('いっしょに遊ぼう')
        self.save()
        profile = self.read_profile()
        self.page.goto(self.base+'#backup')
        with self.page.expect_download() as event:
            self.page.get_by_role('button', name='バックアップを書き出す', exact=True).click()
        backup_path = event.value.path()
        data = json.loads(Path(backup_path).read_text())
        self.assertEqual(data['version'], 3)
        self.assertEqual({k: data['data']['birds'][0][k] for k in profile}, profile)
        self.page.evaluate("(async()=>{await mutate(s=>{s.profile=M.blank().profile;s.records=[]});render();})()")
        self.page.locator('input[name=backup]').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':json.dumps(data,ensure_ascii=False).encode()})
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('#toast')).to_have_text('バックアップを復元しました')
        self.assertEqual(self.read_profile(), profile)
        self.assertEqual(self.page.evaluate('(async()=> (await readState()).records.length)()'),1)
        self.page.goto(self.base)
        expect(self.page.locator('#main .cover-comment')).to_have_text('いっしょに遊ぼう')

    def test_unsaved_photo_and_delete_leave_saved_photo_and_album_untouched(self):
        self.edit()
        self.upload_photo()
        self.page.locator('#close-dialog').click()
        self.assertIsNone(self.read_profile()['photo'])
        self.edit()
        self.upload_photo()
        self.save()
        profile = self.read_profile()
        self.page.evaluate("(async()=>{await mutate(s=>s.photos.push({id:'keep-album',date:today(),data:s.profile.photo,kind:'image',favorite:false,caption:'アルバムを残す'}));render();})()")
        self.edit()
        self.dialog.get_by_role('button',name='ホームの写真を削除',exact=True).click()
        self.page.locator('#confirm-ok').click()
        self.page.locator('#close-dialog').click()
        self.assertEqual(self.read_profile(),profile)
        self.edit()
        self.dialog.get_by_role('button',name='ホームの写真を削除',exact=True).click()
        self.page.locator('#confirm-ok').click()
        self.save()
        self.assertIsNone(self.read_profile()['photo'])
        photos=self.page.evaluate('(async()=> (await readState()).photos)()')
        self.assertEqual(len(photos),1)
        self.assertEqual(photos[0]['data'],profile['photo'])


if __name__ == '__main__':
    unittest.main()
