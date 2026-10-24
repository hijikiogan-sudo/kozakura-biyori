'use strict';
// No OS permissions, network access or native libraries are used by the PWA.
// In the iOS app, native.js supplies the documented, trusted local bridge (window.KozabotaNativeNotifications).
const KozabotaPlatform = (() => {
  const TIMER_NOTIFICATION_ID = 104001;
  const methods = ['getPermission', 'requestPermission', 'replaceTimerNotification', 'cancelTimerNotification'];
  function timerRequest(timer, now = Date.now()) {
    if (!timer || !Number.isSafeInteger(timer.startedAt) || !Number.isSafeInteger(timer.durationSeconds) || timer.durationSeconds <= 0 || timer.durationSeconds > 86400 * 7) return null;
    const deadline = timer.startedAt + timer.durationSeconds * 1000;
    if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > 8640000000000000) return null;
    // Whitelist public copy only. Never pass the state, bird name or photos.
    return {id: TIMER_NOTIFICATION_ID, deadline, title: 'コザボタ日和', body: '放鳥の設定時間になりました。愛鳥を確認してください。', sound: 'default'};
  }
  function createTimerNotifications({bridge = null, now = () => Date.now()} = {}) {
    const available = Boolean(bridge && methods.every(name => typeof bridge[name] === 'function'));
    let status = {state: available ? 'idle' : 'unavailable'};
    let queue = Promise.resolve(), applied = null;
    const enqueue = operation => {
      const result = queue.then(operation).catch(() => {
        applied = null;
        status = {state: 'error'};
        return {...status};
      });
      queue = result;
      return result;
    };
    return {
      available,
      getStatus: () => ({...status}),
      // Only the explicit start/permission button may ask the OS for permission.
      requestPermission() {
        if (!available) return Promise.resolve('unavailable');
        return enqueue(async () => {
          const permission = await bridge.requestPermission();
          status = {state: permission === 'granted' ? 'idle' : 'denied'};
          return permission === 'granted' ? 'granted' : 'denied';
        }).then(result => typeof result === 'string' ? result : 'error');
      },
      sync(timer) {
        if (!available) return Promise.resolve({...status});
        // Snapshot primitives now; queued work must not retain mutable app data.
        const snapshot = timer ? {startedAt: timer.startedAt, durationSeconds: timer.durationSeconds} : null;
        return enqueue(async () => {
          const request = timerRequest(snapshot, now());
          if (!request) {
            if (applied !== 'empty') await bridge.cancelTimerNotification({id: TIMER_NOTIFICATION_ID});
            applied = 'empty';
            status = {state: 'idle'};
          } else if (await bridge.getPermission() !== 'granted') {
            await bridge.cancelTimerNotification({id: TIMER_NOTIFICATION_ID});
            applied = null;
            status = {state: 'denied'};
          } else {
            // Recheck the deadline after an asynchronous permission lookup.
            if (request.deadline <= now()) {
              await bridge.cancelTimerNotification({id: TIMER_NOTIFICATION_ID});
              applied = 'empty';
              status = {state: 'idle'};
            } else {
              if (applied !== request.deadline) await bridge.replaceTimerNotification(request);
              applied = request.deadline;
              status = {state: 'scheduled', deadline: request.deadline};
            }
          }
          return {...status};
        });
      }
    };
  }
  const careMethods = ['getPermission', 'requestPermission', 'replaceCareNotifications'];
  // Care reminders (KozakuraModel.careNotificationPlan). Never asks for permission on its own; an unchanged plan is not resent.
  function createCareNotifications({bridge = null} = {}) {
    const available = Boolean(bridge && careMethods.every(name => typeof bridge[name] === 'function'));
    let status = {state: available ? 'idle' : 'unavailable'};
    let queue = Promise.resolve(), applied = null;
    const enqueue = operation => {
      const result = queue.then(operation).catch(() => {
        applied = null;
        status = {state: 'error'};
        return {...status};
      });
      queue = result;
      return result;
    };
    return {
      available,
      getStatus: () => ({...status}),
      requestPermission() {
        if (!available) return Promise.resolve('unavailable');
        return enqueue(async () => (await bridge.requestPermission()) === 'granted' ? 'granted' : 'denied')
          .then(result => typeof result === 'string' ? result : 'error');
      },
      sync(plan) {
        if (!available) return Promise.resolve({...status});
        // Whitelist the fields the OS needs; the plan never carries names, photos or notes.
        const snapshot = plan.map(({id, at, title, body}) => ({id, at, title, body}));
        const key = JSON.stringify(snapshot);
        return enqueue(async () => {
          const permission = await bridge.getPermission();
          if (permission !== 'granted') {
            applied = null;
            status = {state: permission === 'denied' ? 'denied' : 'prompt'};
            return {...status};
          }
          if (applied !== key) await bridge.replaceCareNotifications(snapshot);
          applied = key;
          status = snapshot.length ? {state: 'scheduled', count: snapshot.length, next: snapshot[0].at} : {state: 'idle'};
          return {...status};
        });
      }
    };
  }
  return {TIMER_NOTIFICATION_ID, timerRequest, createTimerNotifications, createCareNotifications};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = KozabotaPlatform;
