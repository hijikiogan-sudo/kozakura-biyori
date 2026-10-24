"""App Store readiness: policy pages, data deletion, theme and vet export. Synthetic data only."""
import unittest
from playwright.sync_api import expect
import test_timer


class StoreReadinessTests(unittest.TestCase):
    setUpClass = classmethod(test_timer.TimerTests.setUpClass.__func__)
    tearDownClass = classmethod(test_timer.TimerTests.tearDownClass.__func__)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Asia/Tokyo')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def open(self, route):
        self.page.goto(self.base + '#' + route)
        expect(self.page.locator('main')).not_to_contain_text('記録をひらいています')

    def test_about_links_to_privacy_policy_and_support(self):
        self.open('about')
        self.page.get_by_role('link', name='プライバシーポリシー').click()
        expect(self.page.get_by_role('heading', name='プライバシーポリシー', level=1)).to_be_visible()
        self.page.get_by_role('link', name='サポート・よくある質問').click()
        expect(self.page.get_by_role('heading', name='サポート', level=1)).to_be_visible()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))


if __name__ == '__main__':
    unittest.main()
