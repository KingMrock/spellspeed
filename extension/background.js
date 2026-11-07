/* DBETTER, GPL-3.0-only. */
(() => {
  'use strict';
  const api = globalThis.browser || chrome;
  const validUser = name => typeof name === 'string' && name.trim() && name.length <= 120 && !/[\x00-\x1f]/.test(name);
  const isDB = url => { try { const u = new URL(url); return u.protocol === 'https:' && ['duelingbook.com', 'www.duelingbook.com'].includes(u.hostname); } catch { return false; } };
  async function message(tab, data) { let timer; try { return await Promise.race([api.tabs.sendMessage(tab, data, { frameId: 0 }), new Promise(resolve => { timer = setTimeout(() => resolve(null), 1800); })]); } finally { clearTimeout(timer); } }
  async function route(username, source) {
    // Querying IDs and messaging our own content scripts needs no tabs or host permission.
    const tabs = (await api.tabs.query({})).filter(t => t.id !== source && !t.discarded);
    const ready = await Promise.all(tabs.map(async tab => {
      try { return (await message(tab.id, { type: 'DBETTER_PROFILE_PROBE' }))?.ready ? tab : null; }
      catch { return null; }
    }));
    for (const tab of ready.filter(Boolean).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))) {
      try {
        const result = await message(tab.id, { type: 'DBETTER_PROFILE_OPEN', username, expires: Date.now() + 1400 });
        if (!result?.opened) continue;
        try { await api.tabs.update(tab.id, { active: true }); if (Number.isInteger(tab.windowId)) await api.windows.update(tab.windowId, { focused: true }); } catch { /* Profile opened even if tab focus was denied. */ }
        return { opened: true };
      } catch { /* A tab may close or start a duel between the probe and click. */ }
    }
    return { opened: false, error: 'Open a signed-in DuelingBook tab with Spellspeed enabled first. It must be outside a duel you are playing and have no unsaved edits.' };
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'DBETTER_PROFILE_REQUEST' || sender.id !== api.runtime.id || sender.frameId !== 0 || !isDB(sender.url) || !validUser(message.username)) return;
    route(message.username, sender.tab?.id).then(respond, () => respond({ opened: false, error: 'Could not open the player profile. Reload your DuelingBook tabs and try again.' }));
    return true;
  });
})();
