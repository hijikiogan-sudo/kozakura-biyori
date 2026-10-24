'use strict';
// iOS app bridge (Capacitor). In the browser this file does nothing, so the PWA keeps its calendar/ICS and download flows.
// Notifications are scheduled on the device only; titles and bodies never include the bird's name, photos or records.
(() => {
  const C = window.Capacitor;
  if (!C?.isNativePlatform?.()) return;
  // The app draws under the status bar (viewport-fit=cover); style.css keeps content clear of it under .native.
  document.documentElement.classList.add('native');
  const {LocalNotifications, Filesystem, Share} = C.Plugins;
  const CARE_IDS = [200000, 210000];
  // iOS plays no sound unless one is named; notify.wav is bundled by scripts/build_www.mjs.
  const SOUND = 'notify.wav';
  const permission = display => display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';

  window.KozabotaNativeNotifications = {
    async getPermission() { return permission((await LocalNotifications.checkPermissions()).display); },
    async requestPermission() { return permission((await LocalNotifications.requestPermissions()).display) === 'granted' ? 'granted' : 'denied'; },
    async replaceTimerNotification({id, deadline, title, body}) {
      await LocalNotifications.cancel({notifications: [{id}]});
      if (deadline <= Date.now()) return;
      await LocalNotifications.schedule({notifications: [{id, title, body, sound: SOUND, schedule: {at: new Date(deadline), allowWhileIdle: true}}]});
    },
    async cancelTimerNotification({id}) { await LocalNotifications.cancel({notifications: [{id}]}); },
    // Replaces every pending care reminder with the given plan (see KozakuraModel.careNotificationPlan).
    async replaceCareNotifications(plan) {
      const {notifications} = await LocalNotifications.getPending();
      const stale = notifications.filter(n => n.id >= CARE_IDS[0] && n.id < CARE_IDS[1]).map(n => ({id: n.id}));
      if (stale.length) await LocalNotifications.cancel({notifications: stale});
      const upcoming = plan.filter(n => n.at > Date.now());
      if (upcoming.length) await LocalNotifications.schedule({notifications: upcoming.map(n => ({id: n.id, title: n.title, body: n.body, sound: SOUND, schedule: {at: new Date(n.at), allowWhileIdle: true}}))});
    },
    async pendingCareCount() {
      const {notifications} = await LocalNotifications.getPending();
      return notifications.filter(n => n.id >= CARE_IDS[0] && n.id < CARE_IDS[1]).length;
    }
  };

  // WKWebView ignores <a download>; files go to the share sheet so the user can save them to Files, AirDrop, etc.
  window.KozabotaNativeFiles = {
    async share(content, name) {
      const {uri} = await Filesystem.writeFile({path: name, data: content, directory: 'CACHE', encoding: 'utf8'});
      try { await Share.share({title: name, files: [uri]}); }
      catch (e) { if (!/cancel/i.test(e?.message || '')) throw e; }
    }
  };
})();
