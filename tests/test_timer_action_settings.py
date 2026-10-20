"""Preferences alter the decorative bird, preserving the running timer and data."""
from datetime import datetime, timezone, timedelta
import unittest
from playwright.sync_api import expect
import test_timer


class TimerActionSettingsTests(unittest.TestCase):
    setUpClass = classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass = classmethod(test_timer.TimerTests.tearDownClass.__func__)
    setUp = test_timer.TimerTests.setUp
    tearDown = test_timer.TimerTests.tearDown
    start = test_timer.TimerTests.start

    def open_settings(self):
        self.page.get_by_role('button', name='放鳥アクション設定', exact=True).click()
        expect(self.page.get_by_role('heading', name='放鳥アクション設定', exact=True)).to_be_visible()

    def choose(self, actions):
        for node in self.page.locator('input[name="timer-action"]').all():
            node.set_checked(node.input_value() in actions)

    def save_preferences(self):
        self.page.get_by_role('button', name='アクション設定を保存', exact=True).click()
        expect(self.page.locator('#toast')).to_have_text('アクション設定を保存しました')

    def test_custom_interval_selection_reload_and_offline(self):
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
        self.start()
        timer = self.page.evaluate('JSON.stringify(state.timer)')
        self.open_settings()
        self.choose({'curious','paper'})
        self.page.get_by_label('切り替え間隔（秒）', exact=True).fill('15')
        self.save_preferences()
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','curious')
        self.page.clock.run_for(16000)
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','paper')
        self.page.reload()
        expect(self.page.get_by_label('切り替え間隔（秒）', exact=True)).to_have_value('15')
        self.assertEqual(self.page.locator('input[name="timer-action"]:checked').count(),2)
        self.context.set_offline(True)
        self.page.reload()
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','paper')
        self.assertEqual(self.page.evaluate('JSON.stringify(state.timer)'),timer)
        self.assertEqual(self.page.evaluate('state.records'),[])
        self.page.clock.run_for(15000)
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','curious')

    def test_off_on_remembers_single_action_and_preserves_elapsed(self):
        self.page.clock.pause_at(datetime.now(timezone.utc)+timedelta(seconds=1))
        self.start()
        timer = self.page.evaluate('JSON.stringify(state.timer)')
        self.open_settings()
        self.choose({'paper'})
        self.page.get_by_label('アクションを動かす', exact=True).uncheck()
        self.save_preferences()
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','perch')
        expect(self.page.locator('#active-timer .bird-perch-head')).to_have_css('animation-name','none')
        self.page.clock.run_for(61000)
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','perch')
        expect(self.page.locator('#active-timer-value')).to_have_text('00:01:01')
        self.page.reload()
        expect(self.page.get_by_label('アクションを動かす', exact=True)).not_to_be_checked()
        self.assertEqual(self.page.locator('input[name="timer-action"]:checked').input_value(),'paper')
        self.page.get_by_label('アクションを動かす', exact=True).check()
        self.save_preferences()
        self.page.clock.run_for(61000)
        expect(self.page.locator('#active-timer .active-timer-bird')).to_have_attribute('data-action','paper')
        self.assertEqual(self.page.evaluate('JSON.stringify(state.timer)'),timer)
        self.assertEqual(self.page.evaluate('state.records'),[])

    def test_invalid_selection_and_cancel_do_not_change_saved_preferences(self):
        before=self.page.evaluate('JSON.stringify(state.settings.timerActions)')
        self.open_settings()
        self.choose(set())
        self.page.get_by_role('button', name='アクション設定を保存', exact=True).click()
        expect(self.page.locator('.action-selection-error')).to_be_visible()
        self.assertEqual(self.page.evaluate('JSON.stringify(state.settings.timerActions)'),before)
        self.choose({'hop'})
        self.page.get_by_label('切り替え間隔（秒）', exact=True).fill('0')
        self.page.get_by_role('button', name='アクション設定を保存', exact=True).click()
        self.assertEqual(self.page.evaluate('JSON.stringify(state.settings.timerActions)'),before)
        self.page.get_by_role('button', name='保存せずタイマーへ戻る', exact=True).click()
        expect(self.page.locator('#timer-display')).to_be_visible()
        self.assertEqual(self.page.evaluate('JSON.stringify(state.settings.timerActions)'),before)

    def test_menu_access_preview_and_small_screen(self):
        self.page.evaluate("location.hash='settings'")
        self.page.get_by_role('button', name='放鳥アクション設定', exact=False).click()
        expect(self.page.get_by_role('heading', name='放鳥アクション設定', exact=True)).to_be_visible()
        self.page.get_by_label('首かしげ',exact=True).uncheck()
        self.page.get_by_label('首かしげ',exact=True).check()
        expect(self.page.locator('.timer-action-preview')).to_contain_text('プレビュー：首かしげ')
        for width in (320,390):
            self.page.set_viewport_size({'width':width,'height':844})
            for font in ('14px','28px'):
                self.page.evaluate('(font)=>document.documentElement.style.fontSize=font',font)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        self.page.evaluate("document.documentElement.style.fontSize='14px'")
        self.page.screenshot(path='/tmp/timer-action-settings.png',full_page=True)
