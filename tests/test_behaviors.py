"""Behavior records and legacy backups remain compatible as choices expand."""
import functools
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
import unittest
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright, expect
from test_timer import QuietHandler


class BehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root=str(Path(__file__).resolve().parents[1])
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=root))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright=sync_playwright().start()
        cls.browser=cls.playwright.chromium.launch(executable_path=shutil.which('chromium'),headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.playwright.stop()
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def setUp(self):
        self.context=self.browser.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo')
        self.page=self.context.new_page()
        self.errors=[]
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.goto(self.base+'#behavior')
        expect(self.page.locator('#main h1')).to_have_text('行動の記録')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors,[])

    def test_new_actions_record_actual_behavior_and_survive_reload_and_backup(self):
        names=['ご飯を食べる','水を飲む','くちばしギョリギョリ']
        expect(self.page.locator('.behavior-tile')).to_have_count(12)
        for name in names:
            self.page.get_by_role('button',name=f'{name}を記録',exact=True).click()
            expect(self.page.locator('#toast')).to_have_text('記録しました')
        self.page.reload()
        expect(self.page.locator('.record-list')).to_contain_text('くちばしギョリギョリ')
        records=self.page.evaluate('(async()=> (await readState()).records)()')
        self.assertEqual([r['behavior'] for r in records],names)
        self.assertTrue(all(r['type']=='behavior' for r in records))
        self.assertEqual(self.page.evaluate('(async()=>{const s=await readState();return M.validateBackup({app:APP,version:2,data:s}).records;})()'),records)
        # Existing edit buttons include the record date in their accessible name.
        edit=self.page.locator('.record-item').filter(has_text='くちばしギョリギョリ').locator('button.icon-button')
        edit.click()
        expect(self.page.locator('#dialog select[name=behavior]')).to_have_value('くちばしギョリギョリ')
        self.page.locator('#dialog textarea[name=note]').fill('寝る前のようす')
        self.page.get_by_role('button',name='記録を保存',exact=True).click()
        expect(self.page.locator('#dialog')).not_to_be_visible()
        expect(self.page.locator('.record-list')).to_contain_text('寝る前のようす')

    def test_old_custom_actions_and_mobile_tiles_remain_usable(self):
        self.page.evaluate("(async()=>{await mutate(s=>s.records.push({id:'legacy-behavior',type:'behavior',date:today(),createdAt:new Date().toISOString(),note:'以前の記録',behavior:'大あくび'}));render();})()")
        self.page.reload()
        expect(self.page.locator('.record-list')).to_contain_text('大あくび')
        records=self.page.evaluate('(async()=> (await readState()).records)()')
        self.assertEqual(self.page.evaluate('(async()=>{const s=await readState();return M.validateBackup({app:APP,version:1,data:s}).records;})()'),records)
        for width in [320,390]:
            self.page.set_viewport_size({'width':width,'height':844})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            for tile in self.page.locator('.behavior-tile').all():
                self.assertTrue(tile.evaluate('(el)=>el.scrollWidth<=el.clientWidth'))
        tree=ET.parse(Path(__file__).resolve().parents[1]/'art.svg')
        ids=[el.attrib.get('id') for el in tree.iter() if el.attrib.get('id','').startswith('pose-')]
        self.assertEqual(len(ids),len(set(ids)))
        self.assertTrue(all(f'pose-{i}' in ids for i in range(12)))


if __name__=='__main__':
    unittest.main()
