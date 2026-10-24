"""Phase 3 uses isolated synthetic data; never a real user's IndexedDB."""
import base64
import json
from pathlib import Path
import unittest
from playwright.sync_api import expect
import test_timer


class Phase3UXTests(unittest.TestCase):
    setUpClass=classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass=classmethod(test_timer.TimerTests.tearDownClass.__func__)
    tearDown=test_timer.TimerTests.tearDown

    def setUp(self):
        test_timer.TimerTests.setUp(self)
        self.page.goto(self.base+'#backup')
        video='data:video/mp4;base64,'+base64.b64encode((Path(__file__).parent/'fixtures/bird-color.mp4').read_bytes()).decode()
        self.page.evaluate('''async video=>{
            const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
            window.syntheticPhoto=canvas.toDataURL('image/jpeg');
            await mutate(s=>{
                s.profile.name='現在の合成プロフィール';s.profile.photo=syntheticPhoto;
                s.records=[{id:'current-water',type:'water',date:today(),time:'08:00',note:'消してはいけない現在の記録',createdAt:new Date().toISOString()}];
                s.photos=[{id:'current-photo',kind:'image',date:today(),data:syntheticPhoto,favorite:true,caption:'現在の写真'},
                    {id:'current-chewed',kind:'image',date:today(),data:syntheticPhoto,favorite:false,caption:'現在のかじり跡',category:'chewed',subject:'合成の紙'},
                    {id:'current-video',kind:'video',date:today(),data:video,favorite:false,caption:'現在の動画'}];
                s.timer={date:today(),startedAt:Date.now()-60000,durationSeconds:900};
            });render();
        }''',video)
        self.video=video

    def snapshot(self):
        return self.page.evaluate('async()=>JSON.stringify(await readState())')

    def incoming(self,version=2):
        raw=self.page.evaluate('()=>({app:APP,version:2,exportedAt:new Date().toISOString(),data:M.blank()})')
        raw['version']=version
        data=raw['data'];data['profile']['name']='ファイルの合成プロフィール'
        data['records']=[{'id':'imported-water','type':'water','date':'2026-10-20','time':'09:00','note':'ファイル内の記録','createdAt':'2026-10-20T00:00:00Z'}]
        data['photos']=[{'id':'imported-image','kind':'image','date':'2026-10-20','data':self.page.evaluate('syntheticPhoto'),'favorite':False,'caption':'ファイル内の写真'},
            {'id':'imported-video','kind':'video','date':'2026-10-20','data':self.video,'favorite':True,'caption':'ファイル内の動画'}]
        if version==1:
            raw.pop('exportedAt');data['profile'].pop('cover')
            for key in ['timerActions','birdAppearance','behaviorOrder','behaviorOrderVersion']:
                data['settings'].pop(key,None)
        return raw

    def select_backup(self,raw):
        self.page.locator('input[name=backup]').set_input_files({'name':'合成バックアップ.json','mimeType':'application/json','buffer':json.dumps(raw,ensure_ascii=False).encode()})

    def test_preview_separates_media_and_cancel_keeps_everything(self):
        before=self.snapshot();self.select_backup(self.incoming())
        expect(self.page.locator('#restore-preview')).to_be_visible()
        expect(self.page.locator('#confirm-title')).to_be_focused()
        self.assertEqual(self.page.locator('#confirm-dialog').evaluate('(n)=>n.scrollTop'),0)
        cancel=self.page.locator('#confirm-cancel').bounding_box()
        self.assertLessEqual(cancel['y']+cancel['height'],self.page.viewport_size['height'])
        self.page.screenshot(path='/tmp/phase3-restore-preview-top.png')
        rows=self.page.locator('.restore-comparison tbody tr')
        expect(rows.filter(has=self.page.get_by_role('rowheader',name='写真',exact=True))).to_contain_text('2枚')
        expect(rows.filter(has=self.page.get_by_role('rowheader',name='動画',exact=True))).to_contain_text('1本')
        expect(self.page.locator('#restore-preview')).to_contain_text('計測中の時間は記録されません')
        self.assertEqual(self.snapshot(),before)
        expect(self.page.locator('input[name=backup]')).to_be_disabled()
        self.page.locator('#confirm-cancel').click()
        expect(self.page.locator('input[name=backup]')).to_be_enabled()
        self.assertEqual(self.snapshot(),before)
        self.select_backup(self.incoming());expect(self.page.locator('#restore-preview')).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('input[name=backup]')).to_be_enabled()
        self.assertEqual(self.snapshot(),before)
        self.page.screenshot(path='/tmp/phase3-backup.png',full_page=True)

    def test_v1_and_v2_restore_preserve_media_and_records(self):
        for version in [1,2]:
            with self.subTest(version=version):
                raw=self.incoming(version);self.select_backup(raw)
                expect(self.page.locator('#restore-preview')).to_be_visible()
                self.page.locator('#confirm-ok').click()
                expect(self.page.locator('#toast')).to_have_text('バックアップを復元しました')
                expect(self.page.locator('input[name=backup]')).to_be_enabled()
                restored=json.loads(self.snapshot())
                self.assertEqual(restored['profile']['name'],raw['data']['profile']['name'])
                self.assertEqual(restored['records'],raw['data']['records'])
                self.assertEqual(restored['photos'],[{**p,'birdId':restored['activeBirdId']} for p in raw['data']['photos']])
                self.assertIsNone(restored['timer'])
                self.assertEqual(restored['settings']['timerActions']['intervalSeconds'],30)
        self.page.evaluate("()=>{void askConfirm('普通の確認です');}")
        expect(self.page.locator('#confirm-message')).to_have_text('普通の確認です')
        expect(self.page.locator('#confirm-ok')).to_have_text('実行する')
        self.page.locator('#confirm-cancel').click()

    def test_invalid_files_do_not_open_restore_or_change_data(self):
        before=self.snapshot()
        invalid=self.incoming();invalid['data']['records'][0]['type']='invalid'
        for raw in [{'app':'wrong','version':2,'data':{}},invalid]:
            self.select_backup(raw)
            expect(self.page.locator('input[name=backup]')).to_be_enabled()
            expect(self.page.locator('#confirm-dialog')).not_to_be_visible()
            self.assertEqual(self.snapshot(),before)
        self.page.locator('input[name=backup]').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{bad json'})
        expect(self.page.locator('#toast')).to_have_text('JSONファイルを読み込めませんでした。')
        self.assertEqual(self.snapshot(),before)
        self.page.evaluate('async()=>{await importBackup({size:41*1024*1024});}')
        expect(self.page.locator('#toast')).to_have_text('40MB以下のバックアップを選んでください。')
        self.assertEqual(self.snapshot(),before)

    def test_confirmation_refuses_a_concurrent_change_and_storage_failure(self):
        self.select_backup(self.incoming())
        expect(self.page.locator('#restore-preview')).to_be_visible()
        other=self.context.new_page();other.goto(self.base+'#records')
        other.evaluate("async()=>{await mutate(s=>s.records[0].note='別画面で保存した記録');}")
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('#toast')).to_contain_text('確認中にデータが更新されました')
        self.assertEqual(json.loads(self.snapshot())['records'][0]['note'],'別画面で保存した記録')
        other.close()
        before=self.snapshot();self.select_backup(self.incoming())
        expect(self.page.locator('#restore-preview')).to_be_visible()
        self.page.evaluate("()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};}")
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('#toast')).to_contain_text('空き容量が足りず')
        expect(self.page.locator('input[name=backup]')).to_be_enabled()
        self.assertEqual(self.snapshot(),before)
        self.page.evaluate('()=>{IDBObjectStore.prototype.put=window.originalPut;}')

    def test_offline_export_and_restore_and_double_export_guard(self):
        expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了')
        self.page.evaluate('''async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));}''')
        self.context.set_offline(True)
        before=json.loads(self.snapshot())
        downloads=[];self.page.on('download',lambda download:downloads.append(download))
        self.page.evaluate('''()=>{window.originalRead=readState;const gate=new Promise(resolve=>window.releaseExport=resolve);readState=async()=>{await gate;return originalRead();};window.firstExport=exportBackup();void exportBackup();}''')
        expect(self.page.locator('#toast')).to_contain_text('終わってから')
        with self.page.expect_download() as download:
            self.page.evaluate('window.releaseExport()')
        self.page.evaluate('async()=>{await window.firstExport;readState=window.originalRead;}')
        raw=json.loads(Path(download.value.path()).read_text())
        self.assertEqual(len(downloads),1)
        self.assertEqual(raw['version'],3)
        self.assertEqual(raw['data']['records'],before['records']);self.assertEqual(raw['data']['photos'],before['photos'])
        expect(self.page.locator('#backup-last-operation')).to_contain_text('保存完了を示すものではありません')
        expect(self.page.locator('#toast')).to_contain_text('保存先で保存完了を確認')
        self.page.reload();expect(self.page.locator('#backup-last-operation strong')).not_to_have_text('まだ書き出していません')
        self.select_backup(raw);expect(self.page.locator('#restore-preview')).to_be_visible()
        self.page.locator('#confirm-ok').click();expect(self.page.locator('#toast')).to_have_text('バックアップを復元しました')
        self.assertEqual(json.loads(self.snapshot())['photos'],before['photos'])

    def test_export_marker_failure_is_not_reported_as_a_saved_backup(self):
        self.page.evaluate("()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};}")
        with self.page.expect_download():
            self.page.get_by_role('button',name='バックアップを書き出す',exact=True).click()
        expect(self.page.locator('#toast')).to_contain_text('書き出し日時を保存できませんでした')
        self.assertIsNone(json.loads(self.snapshot())['lastBackup'])
        self.page.evaluate('()=>{IDBObjectStore.prototype.put=window.originalPut;}')

    def test_notification_steps_use_saved_schedules_and_do_not_claim_registration(self):
        self.page.goto(self.base+'#reminders')
        export=self.page.get_by_role('button',name='カレンダー用ファイルを書き出す',exact=True)
        expect(export).to_be_disabled()
        self.page.locator('.reminder-setting.type-water').get_by_role('button',name='朝夕（8時・18時）にする').click()
        expect(export).to_be_disabled()
        self.page.get_by_role('button',name='予定を保存',exact=True).click()
        expect(export).to_be_enabled()
        expect(self.page.locator('#calendar-export-summary')).to_contain_text('水替え 08:00・18:00')
        self.page.locator('[name=water-time-0]').fill('10:00')
        with self.page.expect_download() as download:export.click()
        ics=Path(download.value.path()).read_text()
        self.assertIn('T080000',ics);self.assertNotIn('T100000',ics)
        expect(self.page.locator('#reminder-step-2')).to_contain_text('追加完了をアプリから確認することはできません')
        expect(self.page.locator('#reminder-step-3')).to_contain_text('集中モード')
        expect(self.page.locator('#main')).not_to_contain_text('登録済み')
        self.page.screenshot(path='/tmp/phase3-notifications.png',full_page=True)

    def test_small_screens_and_large_text_keep_comparison_and_settings_readable(self):
        for route in ['backup','reminders','settings']:
            self.page.goto(self.base+'#'+route)
            for width in (320,390,402):
                self.page.set_viewport_size({'width':width,'height':874})
                for size in ('14px','28px'):
                    self.page.evaluate('(size)=>document.documentElement.style.fontSize=size',size)
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.page.evaluate("document.documentElement.style.fontSize='14px'")
        self.page.goto(self.base+'#backup');self.select_backup(self.incoming())
        expect(self.page.locator('#restore-preview')).to_be_visible()
        for width in (320,402):
            self.page.set_viewport_size({'width':width,'height':874})
            self.page.evaluate("document.documentElement.style.fontSize='28px'")
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assertTrue(self.page.locator('#confirm-dialog').evaluate('(n)=>n.scrollWidth<=n.clientWidth'))
        self.page.evaluate("document.documentElement.style.fontSize='14px'")
        self.page.screenshot(path='/tmp/phase3-restore-preview.png',full_page=True)
        self.page.locator('#confirm-cancel').click()
