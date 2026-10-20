"""Chart display remains readable without changing data or daily aggregation."""
from datetime import datetime, timezone, timedelta
import unittest
import re
from playwright.sync_api import expect
import test_timer


class Phase4ChartTests(unittest.TestCase):
    setUpClass=classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass=classmethod(test_timer.TimerTests.tearDownClass.__func__)
    tearDown=test_timer.TimerTests.tearDown

    def setUp(self):
        test_timer.TimerTests.setUp(self)
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
        self.page.evaluate('''async()=>{await mutate(s=>{
            const make=(id,type,offset,time,extra)=>({id,type,date:M.addDays(today(),offset),time,note:'合成の記録',createdAt:new Date().toISOString(),...extra});
            s.records=[make('w-a','weight',-4,'08:00',{value:50}),make('w-b','weight',-2,'08:00',{value:50.8}),make('w-c','weight',0,'08:00',{value:50.2}),make('w-d','weight',0,'19:00',{value:51.4}),make('w-old','weight',-60,'08:00',{value:49}),make('f-a','flight',-2,'09:00',{minutes:15}),make('f-b','flight',0,'09:00',{minutes:10.5}),make('f-c','flight',0,'18:00',{minutes:20.5})];
            ['少なめ','いつもどおり','多め','気になる','いつもどおり'].forEach((value,i)=>s.records.push(make('h-'+i,'health',i-4,'10:00',{appetite:value,droppings:value,activity:value})));
        });}''')
        self.before=self.page.evaluate('JSON.stringify(state.records)')
        self.page.evaluate("location.hash='health'")
        expect(self.page.locator('.chart')).to_be_visible()
        self.page.get_by_role('button',name='7日',exact=True).click()

    def values(self):
        return self.page.locator('.chart-point').evaluate_all("nodes=>nodes.map(n=>n.dataset.value)")

    def test_weight_and_flight_keep_daily_values_and_units(self):
        expect(self.page.locator('.chart-caption')).to_have_text('体重（g） · 3日分')
        self.assertEqual(self.values(),['50','50.8','51.4'])
        colors=self.page.locator('.chart polyline').evaluate('(n)=>[getComputedStyle(n).stroke,getComputedStyle(n.closest(".card")).backgroundColor]')
        def luminance(color):
            rgb=[int(value)/255 for value in re.findall(r'\d+',color)[:3]]
            linear=[value/12.92 if value<=.04045 else ((value+.055)/1.055)**2.4 for value in rgb]
            return sum(value*weight for value,weight in zip(linear,[.2126,.7152,.0722]))
        dark,light=sorted(map(luminance,colors))
        self.assertGreaterEqual((light+.05)/(dark+.05),3)
        expect(self.page.locator('.chart-point').last).to_have_attribute('title',self.page.evaluate('today()')+' 51.4 g')
        expect(self.page.locator('.chart-point').last).to_have_css('pointer-events','auto')
        self.page.locator('.chart-data summary').click()
        expect(self.page.locator('.chart-data tbody')).to_contain_text('51.4 g')
        expect(self.page.locator('.chart-data tbody tr')).to_have_count(3)
        self.page.get_by_role('button',name='放鳥',exact=True).click()
        self.assertEqual(self.values(),['15','31'])
        expect(self.page.locator('.chart-caption')).to_have_text('放鳥時間（分） · 2日分')
        self.page.locator('.chart-data summary').click()
        expect(self.page.locator('.chart-data tbody')).to_contain_text('31 分')
        self.assertEqual(self.page.evaluate('JSON.stringify(state.records)'),self.before)

    def test_health_uses_legacy_labels_and_breaks_line_at_attention(self):
        for label in ['食欲','フン','活動量']:
            self.page.get_by_role('button',name=label,exact=True).click()
            self.assertEqual(self.values(),['1','2','3','attention','2'])
            expect(self.page.locator('.chart-y-tick')).to_have_text(['少なめ','いつもどおり','多め'])
            expect(self.page.locator('.chart-attention')).to_have_text('!')
            segments=self.page.locator('.chart polyline').evaluate_all("nodes=>nodes.map(n=>n.getAttribute('points').trim().split(/\\s+/).length)")
            self.assertEqual(segments,[3,1])
            self.page.locator('.chart-data summary').click()
            expect(self.page.locator('.chart-data tbody tr')).to_have_count(5)
            expect(self.page.locator('.chart-data tbody')).to_contain_text('気になる')
            expect(self.page.locator('.chart-data tbody')).not_to_contain_text('正常')
        self.assertEqual(self.page.evaluate('JSON.stringify(state.records)'),self.before)

    def test_labels_and_attention_keep_size_and_do_not_overlap_on_small_screens(self):
        self.page.get_by_role('button',name='フン',exact=True).click()
        self.page.locator('.chart-data summary').click()
        for width in (320,390,402):
            self.page.set_viewport_size({'width':width,'height':874})
            for size in ('14px','28px'):
                self.page.evaluate('(size)=>document.documentElement.style.fontSize=size',size)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                plot=self.page.locator('.chart-plot').bounding_box()
                for tick in self.page.locator('.chart-y-tick').all():
                    self.assertGreaterEqual(tick.evaluate('(n)=>parseFloat(getComputedStyle(n).fontSize)'),12)
                    box=tick.bounding_box();self.assertLessEqual(box['x']+box['width'],plot['x']-3)
                warning=self.page.locator('.chart-attention')
                self.assertGreaterEqual(warning.evaluate('(n)=>parseFloat(getComputedStyle(n).fontSize)'),14)
                box=warning.bounding_box();dates=self.page.locator('.chart-labels').bounding_box()
                self.assertLessEqual(box['y']+box['height'],dates['y']+1)
        self.page.evaluate("document.documentElement.style.fontSize='14px'")
        self.page.screenshot(path='/tmp/phase4-health-chart.png',full_page=True)

    def test_period_selection_and_weight_page_show_existing_records_only(self):
        self.page.get_by_role('button',name='30日',exact=True).click()
        self.assertEqual(self.values(),['50','50.8','51.4'])
        self.page.get_by_role('button',name='3か月',exact=True).click()
        self.assertEqual(self.values(),['49','50','50.8','51.4'])
        self.page.get_by_role('button',name='1年',exact=True).click()
        self.assertEqual(self.values(),['49','50','50.8','51.4'])
        self.page.get_by_role('button',name='7日',exact=True).click()
        self.assertEqual(self.values(),['50','50.8','51.4'])
        self.page.evaluate("location.hash='weight'")
        expect(self.page.locator('.chart-caption')).to_have_text('体重（g） · 3日分')
        self.page.locator('.chart-data summary').click()
        self.page.screenshot(path='/tmp/phase4-weight-chart.png',full_page=True)
        self.assertEqual(self.page.evaluate('JSON.stringify(state.records)'),self.before)

    def test_empty_and_all_attention_records_do_not_invent_numeric_values(self):
        self.page.evaluate("async()=>{await mutate(s=>s.records=s.records.filter(r=>r.type==='health').map(r=>({...r,appetite:'気になる',droppings:'気になる',activity:'気になる'})));chartMetric='droppings';render();}")
        expect(self.page.locator('.chart-attention')).to_have_count(5)
        expect(self.page.locator('.chart polyline')).to_have_count(0)
        self.page.locator('.chart-data summary').click()
        self.assertTrue(all(text=='気になる' for text in self.page.locator('.chart-data tbody td').all_text_contents()))
        self.page.get_by_role('button',name='体重',exact=True).click()
        expect(self.page.locator('.chart')).to_have_count(0)
        expect(self.page.locator('#main')).to_contain_text('この期間の記録がありません')

    def test_offline_graph_and_v1_v2_backup_keep_health_values(self):
        expect(self.page.locator('#offline-status')).to_have_text('オフライン準備完了')
        self.page.evaluate('''async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));}''')
        self.context.set_offline(True);self.page.reload()
        self.page.get_by_role('button',name='フン',exact=True).click()
        expect(self.page.locator('.chart-attention')).to_have_count(1)
        self.page.locator('.chart-data summary').click()
        expect(self.page.locator('.chart-data tbody')).to_contain_text('いつもどおり')
        raw=self.page.evaluate('()=>JSON.stringify(state.records)')
        for version in (1,2):
            restored=self.page.evaluate('(version)=>M.validateBackup({app:APP,version,data:state}).records',version)
            self.assertEqual(restored,self.page.evaluate('state.records'))
        self.assertEqual(raw,self.before)
