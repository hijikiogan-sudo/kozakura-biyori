"""Chewed-object photo album, classification, backup and storage limits."""
import base64
import functools
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import threading
import unittest
from playwright.sync_api import sync_playwright, expect
from test_timer import QuietHandler


class ChewedAlbumTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root=str(Path(__file__).resolve().parents[1])
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=root))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright=sync_playwright().start()
        cls.browser=cls.playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.playwright.stop()
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def setUp(self):
        self.context=self.browser.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo',accept_downloads=True)
        self.page=self.context.new_page();self.errors=[];self.external=[]
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.on('request',lambda request:self.external.append(request.url) if request.url.startswith(('http:','https:')) and not request.url.startswith(self.base) else None)
        self.page.goto(self.base+'#behavior')
        expect(self.page.locator('.behavior-tile')).to_have_count(12)
        self.dialog=self.page.locator('#dialog')
        self.image=self.page.evaluate("() => {const c=document.createElement('canvas');c.width=80;c.height=60;const x=c.getContext('2d');x.fillStyle='#f0d9b0';x.fillRect(0,0,80,60);return c.toDataURL('image/png').split(',')[1];}")

    def tearDown(self):
        self.context.close();self.assertEqual(self.errors,[]);self.assertEqual(self.external,[])

    def add_photo(self,subject='教科書'):
        self.page.get_by_role('button',name='かじった物を写真で残す',exact=True).click()
        self.dialog.get_by_label('かじった物',exact=True).fill(subject)
        self.dialog.locator('textarea[name=caption]').fill('表紙の角がかじられていました')
        self.dialog.locator('input[name=photo]').set_input_files({'name':'book.png','mimeType':'image/png','buffer':base64.b64decode(self.image)})
        expect(self.dialog.locator('.chewed-preview')).to_be_visible()
        self.dialog.get_by_role('button',name='かじり跡を保存',exact=True).click()

    def photos(self):
        return self.page.evaluate('(async()=> (await readState()).photos)()')

    def test_create_edit_backup_restore_and_offline_album(self):
        order=self.page.locator('.behavior-tile').evaluate_all('(nodes)=>nodes.map(node=>node.getAttribute("aria-label").replace(/を記録$/, ""))')
        self.assertEqual(order,['ご飯を食べる','水を飲む','羽づくろい','鳴く','くちばしギョリギョリ','よく遊ぶ','よく寝ている','甘える','噛む','紙ちぎり','水浴び','落ち着かない'])
        self.page.get_by_role('button',name='かじった物を写真で残す',exact=True).click()
        self.dialog.get_by_label('かじった物',exact=True).fill('教科書')
        self.dialog.get_by_role('button',name='かじり跡を保存',exact=True).click()
        expect(self.page.locator('#toast')).to_have_text('かじり跡の写真を1枚選んでください')
        self.page.locator('#close-dialog').click()
        self.add_photo();expect(self.dialog).not_to_be_visible()
        photos=self.photos();self.assertEqual(len(photos),1)
        self.assertEqual(photos[0]['subject'],'教科書');self.assertEqual(photos[0]['category'],'chewed')
        self.assertEqual(self.page.evaluate('(async()=> (await readState()).records.length)()'),0)
        self.page.get_by_role('button',name='アルバムを見る',exact=True).click()
        expect(self.page.locator('#main h1')).to_have_text('かじり跡アルバム')
        self.page.locator('.photo-open').click()
        self.dialog.get_by_label('かじった物',exact=True).fill('国語の教科書')
        self.dialog.locator('textarea[name=caption]').fill('思い出として残します')
        self.dialog.get_by_role('button',name='アルバムの情報を保存',exact=True).click()
        expect(self.dialog).not_to_be_visible()
        self.page.reload();self.page.get_by_role('button',name='かじり跡',exact=True).click()
        expect(self.page.locator('.photo-card')).to_contain_text('国語の教科書')
        self.page.goto(self.base+'#backup')
        with self.page.expect_download() as event:self.page.get_by_role('button',name='バックアップを書き出す',exact=True).click()
        data=json.loads(Path(event.value.path()).read_text());self.assertEqual(data['data']['photos'][0]['subject'],'国語の教科書')
        self.page.evaluate('(async()=>{await mutate(s=>s.photos=[]);render();})()')
        self.page.locator('input[name=backup]').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':json.dumps(data,ensure_ascii=False).encode()})
        self.page.locator('#confirm-ok').click();expect(self.page.locator('#toast')).to_have_text('バックアップを復元しました')
        expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了',timeout=30000)
        self.page.wait_for_function('navigator.serviceWorker.controller!==null');self.context.set_offline(True)
        self.page.goto(self.base+'#album');self.page.get_by_role('button',name='かじり跡',exact=True).click()
        self.page.reload();self.page.get_by_role('button',name='かじり跡',exact=True).click()
        expect(self.page.locator('.photo-card')).to_contain_text('国語の教科書')
        self.page.locator('.photo-open').click()
        expect(self.dialog.locator('textarea[name=caption]')).to_have_value('思い出として残します')
        self.page.wait_for_function('document.querySelector("#dialog .detail-media").naturalWidth>0')

    def test_classify_existing_photo_favorite_and_unclassify_without_duplication(self):
        self.page.evaluate("(async()=>{const c=document.createElement('canvas');c.width=20;c.height=20;await addMedia(c.toDataURL('image/jpeg'),'image');})()")
        self.page.goto(self.base+'#album');self.page.locator('.photo-open').click()
        self.dialog.get_by_label('かじり跡アルバムに入れる',exact=True).check()
        self.dialog.get_by_label('かじった物',exact=True).fill('紙')
        self.dialog.get_by_role('button',name='アルバムの情報を保存',exact=True).click();expect(self.dialog).not_to_be_visible()
        photo_id=self.photos()[0]['id'];self.assertEqual(len(self.photos()),1)
        self.page.get_by_role('button',name='かじり跡',exact=True).click();expect(self.page.locator('.photo-card')).to_have_count(1)
        self.page.get_by_role('button',name='お気に入りにする',exact=True).click()
        expect(self.page.get_by_role('button',name='お気に入りを解除',exact=True)).to_be_visible()
        self.page.get_by_role('button',name='お気に入り',exact=True).click();expect(self.page.locator('.photo-card')).to_have_count(1)
        self.page.locator('.photo-open').click();self.dialog.get_by_label('かじり跡アルバムに入れる',exact=True).uncheck()
        self.dialog.get_by_role('button',name='アルバムの情報を保存',exact=True).click();expect(self.dialog).not_to_be_visible()
        self.page.get_by_role('button',name='かじり跡',exact=True).click();expect(self.page.locator('.photo-card')).to_have_count(0)
        self.assertEqual(self.photos()[0]['id'],photo_id);self.assertEqual(len(self.photos()),1)
        self.page.get_by_role('button',name='写真',exact=True).click();expect(self.page.locator('.photo-card')).to_have_count(1)

    def test_shared_photo_limit_and_deletion_preserve_ordinary_album(self):
        self.page.evaluate("(async()=>{const c=document.createElement('canvas');c.width=10;c.height=10;await mutate(s=>s.photos=Array.from({length:99},(_,i)=>({id:'old-'+i,date:today(),kind:'image',favorite:false,caption:'通常の写真',data:c.toDataURL('image/jpeg')})));render();})()")
        self.add_photo();expect(self.dialog).not_to_be_visible();self.assertEqual(len(self.photos()),100)
        self.add_photo('ティッシュ箱');expect(self.page.locator('#toast')).to_contain_text('上限：アルバムは100件までです。')
        self.assertEqual(len(self.photos()),100);self.page.locator('#close-dialog').click()
        self.page.get_by_role('button',name='アルバムを見る',exact=True).click();self.page.locator('.photo-open').click()
        self.dialog.get_by_role('button',name='アルバムから削除',exact=True).click();self.page.locator('#confirm-ok').click()
        expect(self.dialog).not_to_be_visible();self.assertEqual(len(self.photos()),99)
        self.assertTrue(all(photo['caption']=='通常の写真' for photo in self.photos()))


if __name__=='__main__':unittest.main()
