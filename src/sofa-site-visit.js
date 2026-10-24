'use strict';

function openRecoverySite({ openWindow, record = () => {}, focusApp = () => {},
  watchPage = () => () => {}, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  const visit = openWindow();
  const page = visit.window.webContents;
  return new Promise((resolve) => {
    let interacted = false, finished = false, resolved = false, status = 0, readyTimer = null;
    let apiReady = false, stopWatching = () => {};
    const touch = () => { interacted = true; };
    const mouse = (_event, input) => { if (input.type !== 'mouseMove') touch(); };
    const navigation = (_event, url, code) => {
      status = code;
      let path = '/'; try { path = new URL(url).pathname; } catch { /* Keep a safe path. */ }
      record({ type: 'site', at: new Date(now()).toISOString(), status: code, path });
    };
    const finish = (restored) => {
      if (finished) return;
      finished = true;
      cancel(deadline); cancel(readyTimer);
      stopWatching();
      page.removeListener('before-input-event', touch);
      page.removeListener('before-mouse-event', mouse);
      page.removeListener('did-navigate', navigation);
      page.removeListener('destroyed', closed);
      // Preserve an existing window or one the user has started interacting with.
      if (restored && visit.created && !interacted && !visit.window.isDestroyed()) {
        visit.window.close();
        focusApp();
      }
    };
    const complete = (ready, reason) => {
      if (resolved) return;
      resolved = true;
      cancel(deadline); cancel(readyTimer);
      resolve({ ready, reason, finish });
    };
    const closed = () => complete(false, 'window_closed');
    const deadline = schedule(() => complete(false, 'page_timeout'), 30_000);
    page.on('before-input-event', touch);
    page.on('before-mouse-event', mouse);
    page.on('did-navigate', navigation);
    page.once('destroyed', closed);
    const inspectPage = () => {
      if (page.isDestroyed()) { complete(false, 'window_closed'); return; }
      const needsUser = /just a moment|verify|captcha|challenge|access denied|forbidden|doğrula|robot/i.test(page.getTitle());
      const sameSite = (() => { try { return new URL(page.getURL()).origin === 'https://www.sofascore.com'; } catch { return false; } })();
      complete(sameSite && status < 400 && !needsUser, needsUser || status >= 400 ? 'verification_required' : sameSite ? null : 'unexpected_page');
    };
    stopWatching = watchPage(page, (response) => {
      if (resolved || apiReady) return;
      apiReady = true;
      record({ type: 'site', at: new Date(now()).toISOString(), ...response, reason: 'json_response_ready' });
    });
    Promise.resolve(visit.loaded).then(() => {
      if (resolved) return;
      // HTML 200 alone does not mean the session is ready. Prefer a successful
      // public JSON response as diagnostic evidence, but allow normal startup
      // ten seconds before the single check even if that response arrives early.
      // Verification controls remain untouched.
      readyTimer = schedule(inspectPage, 10_000);
    }, () => complete(false, 'page_load_error'));
  });
}

module.exports = { openRecoverySite };
