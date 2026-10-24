"""Multi-bird: switching, per-bird records and photos, flights with several birds, premium lock. Synthetic data only."""
import json
from pathlib import Path
import unittest
from playwright.sync_api import expect
import test_timer

JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDAoMDBQNDAsLDBkSEw8UHR8eHRwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9k='

TWO_BIRDS = '''async()=>{await mutate(s=>{
  s.birds[0].name='ぴぴ';
  s.birds.push(M.newBird('bird-2',{name:'もも',appearance:'button-blue'}));
  s.records=[
    {id:'w1',type:'weight',date:today(),time:'08:00',value:48,note:'',createdAt:new Date().toISOString(),birdId:'bird-1'},
    {id:'w2',type:'weight',date:today(),time:'08:05',value:52,note:'',createdAt:new Date().toISOString(),birdId:'bird-2'},
    {id:'f-both',type:'flight',date:today(),time:'09:00',minutes:30,note:'',createdAt:new Date().toISOString(),birdIds:['bird-1','bird-2']},
    {id:'water',type:'water',date:today(),time:'07:00',note:'',createdAt:new Date().toISOString()}];
});render();}'''


class MultiBirdTests(unittest.TestCase):
    setUpClass = classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass = classmethod(test_timer.TimerTests.tearDownClass.__func__)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Tokyo')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.open('home')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def open(self, route):
        self.page.goto(self.base + '#' + route)
        expect(self.page.locator('main')).not_to_contain_text('記録をひらいています')

    def state(self, expr):
        return self.page.evaluate(f'async()=>{{const s=await readState();return {expr};}}')

    def test_one_bird_has_no_switcher_and_second_bird_is_locked(self):
        expect(self.page.locator('.bird-bar')).to_have_count(0)
        self.open('birds')
        self.page.get_by_role('button', name='新しい子を追加（プレミアム）').click()
        expect(self.page.locator('#dialog')).to_contain_text('2羽目からはプレミアム')
        self.assertEqual(self.state('s.birds.length'), 1)

    def test_premium_adds_a_bird_and_switching_changes_what_is_shown(self):
        self.page.evaluate("window.KozabotaPremium={unlocked:true}")
        self.page.evaluate(TWO_BIRDS)
        self.open('weight')
        bar = self.page.locator('.bird-bar')
        expect(bar.get_by_role('button')).to_have_count(2)
        expect(self.page.locator('main')).to_contain_text('48')
        expect(self.page.locator('main')).not_to_contain_text('52 g')
        bar.get_by_role('button', name='もも').click()
        expect(self.page.locator('#toast')).to_contain_text('ももの記録を表示しています')
        expect(self.page.locator('main')).to_contain_text('52')
        self.assertEqual(self.state('[s.activeBirdId,s.profile.name]'), ['bird-2', 'もも'])
        # A shared flight shows for both birds; care tasks are shared by the household.
        self.open('records')
        expect(self.page.locator('main')).to_contain_text('30 分')
        expect(self.page.locator('main')).to_contain_text('水替え')
        # Records added now belong to the bird on screen.
        self.page.evaluate("async()=>{await mutate(s=>s.records.push({id:'n-new',type:'note',date:today(),note:'ももの合成メモ',createdAt:new Date().toISOString()}));}")
        self.assertEqual(self.state("s.records.find(r=>r.id==='n-new').birdId"), 'bird-2')
        # Adding a third bird opens its profile.
        self.open('birds')
        self.page.get_by_role('button', name='新しい子を追加', exact=True).click()
        expect(self.page.locator('#dialog')).to_contain_text('うちの子のプロフィール')
        self.assertEqual(self.state('s.birds.length'), 3)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_timer_and_form_record_flights_for_the_chosen_birds(self):
        self.page.evaluate(TWO_BIRDS)
        self.open('timer')
        field = self.page.locator('fieldset.bird-choices')
        expect(field).to_contain_text('一緒に放鳥する子')
        field.get_by_label('もも').check()
        self.page.get_by_role('button', name='放鳥をはじめる', exact=True).click()
        expect(self.page.get_by_role('button', name='放鳥を終了', exact=True)).to_be_visible()
        self.assertEqual(self.state('s.timer.birdIds'), ['bird-1', 'bird-2'])
        self.page.get_by_role('button', name='放鳥を終了', exact=True).click()
        self.page.locator('#confirm-ok').click()
        expect(self.page.get_by_role('button', name='放鳥をはじめる', exact=True)).to_be_visible()
        self.assertEqual(self.state("s.records.filter(r=>r.type==='flight'&&r.note==='放鳥タイマーから記録').map(r=>r.birdIds)"), [['bird-1', 'bird-2']])
        # The manual form requires at least one bird.
        self.page.evaluate("recordForm('flight')")
        dialog = self.page.locator('#dialog')
        dialog.locator('[name=minutes]').fill('12')
        dialog.get_by_label('ぴぴ').uncheck()
        dialog.get_by_role('button', name='記録を保存').click()
        expect(self.page.locator('#toast')).to_contain_text('1羽以上選んでください')
        dialog.get_by_label('もも').check()
        dialog.get_by_role('button', name='記録を保存').click()
        expect(dialog).not_to_be_visible()
        self.assertEqual(self.state("s.records.filter(r=>r.type==='flight'&&r.minutes===12).map(r=>r.birdIds)"), [['bird-2']])

    def test_photos_are_per_bird_and_deleting_a_bird_removes_only_its_data(self):
        self.page.evaluate(TWO_BIRDS)
        self.page.evaluate('async jpeg=>{await mutate(s=>{s.birds[1].photo=jpeg;s.photos=[{id:"p1",kind:"image",date:today(),data:jpeg,favorite:false,caption:"",birdId:"bird-1"},{id:"p2",kind:"image",date:today(),data:jpeg,favorite:false,caption:"",birdId:"bird-2"}];});render();}', JPEG)
        self.open('album')
        expect(self.page.locator('.album-grid figure, .photo-card')).to_have_count(1)
        self.open('birds')
        self.page.get_by_role('button', name='ももを削除').click()
        self.page.get_by_role('button', name='削除する').click()
        expect(self.page.locator('#toast')).to_contain_text('ももを削除しました')
        self.assertEqual(self.state('s.birds.map(b=>b.id)'), ['bird-1'])
        self.assertEqual(self.state('s.records.map(r=>r.id).sort()'), ['f-both', 'w1', 'water'])
        self.assertEqual(self.state("s.records.find(r=>r.id==='f-both').birdIds"), ['bird-1'])
        self.assertEqual(self.state('s.photos.map(p=>p.id)'), ['p1'])
        media = self.page.evaluate('''()=>new Promise(ok=>{const tx=db.transaction('media');const r=tx.objectStore('media').getAllKeys();tx.oncomplete=()=>ok(r.result.sort());})''')
        self.assertEqual(media, ['photo:p1'])
        expect(self.page.locator('.bird-bar')).to_have_count(0)

    def test_backup_v3_round_trips_birds_and_rejects_unknown_owners(self):
        self.page.evaluate(TWO_BIRDS)
        self.open('backup')
        with self.page.expect_download() as event:
            self.page.get_by_role('button', name='バックアップを書き出す', exact=True).click()
        data = json.loads(Path(event.value.path()).read_text())
        self.assertEqual(data['version'], 3)
        self.assertEqual([b['name'] for b in data['data']['birds']], ['ぴぴ', 'もも'])
        self.assertNotIn('profile', data['data'])
        self.page.evaluate("async()=>{await mutate(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,M.blank());});render();}")
        self.page.locator('input[name=backup]').set_input_files({'name': 'backup.json', 'mimeType': 'application/json', 'buffer': json.dumps(data, ensure_ascii=False).encode()})
        expect(self.page.locator('#restore-preview')).to_contain_text('2羽（ぴぴ・もも）')
        self.page.locator('#confirm-ok').click()
        expect(self.page.locator('#toast')).to_have_text('バックアップを復元しました')
        self.assertEqual(self.state('s.birds.map(b=>b.name)'), ['ぴぴ', 'もも'])
        self.assertEqual(self.state("s.records.find(r=>r.id==='w2').birdId"), 'bird-2')
        bad = json.loads(json.dumps(data))
        bad['data']['records'][0]['birdId'] = 'missing-bird'
        message = self.page.evaluate('raw=>{try{M.validateBackup(raw);return "ok";}catch(e){return e.message;}}', bad)
        self.assertIn('記録した子がバックアップにいません', message)


if __name__ == '__main__':
    unittest.main()
