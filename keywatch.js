'use strict';
// Watches the Show / Hide key by asking Windows, about every 15 ms, whether that one key is down.
//
// Why not only the Windows hotkey (Electron's globalShortcut)? Star Citizen stops Windows from delivering that kind
// of hotkey while the game has focus, so Insert did nothing in game. Asking whether the key is down still works,
// the same way Discord's push-to-talk reads keys. Only the one key you chose is looked at; nothing is recorded.
//
// One limit remains: Windows hides keys from a normal app while a window that runs as administrator has focus.
// If the game runs as administrator, SC Companion has to as well. status() tells which case this is, so the
// Settings page can say so and offer to restart the app as administrator.
//
// It uses koffi (a small library that lets this file call Windows functions) and only does anything on Windows.

const { execFile } = require('child_process');

let koffi = null, api = null, loadError = '';
function load() {
  if (api || loadError) return api;
  try {
    if (process.platform !== 'win32') throw new Error('Windows only');
    koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll'), advapi32 = koffi.load('advapi32.dll');
    api = {
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      GetCurrentProcess: kernel32.func('void* __stdcall GetCurrentProcess()'),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void* h)'),
      OpenProcessToken: advapi32.func('bool __stdcall OpenProcessToken(void* process, uint32 access, _Out_ void** token)'),
      GetTokenInformation: advapi32.func('bool __stdcall GetTokenInformation(void* token, int info, _Out_ uint32_t* out, uint32 len, _Out_ uint32_t* returned)'),
    };
  } catch (e) { loadError = e.message; api = null; }
  return api;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x8, TokenElevation = 20;

// Does this process run as administrator? true / false, or null when it cannot be told (no rights to look).
function isElevated(pid) {
  const a = load(); if (!a) return null;
  let proc = null, own = false;
  try {
    if (pid == null) { proc = a.GetCurrentProcess(); own = true; }       // a pseudo handle: nothing to close
    else { proc = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid); if (!proc) return null; }
    const tok = [null];
    if (!a.OpenProcessToken(proc, TOKEN_QUERY, tok) || !tok[0]) return null;
    const out = [0], ret = [0];
    const ok = a.GetTokenInformation(tok[0], TokenElevation, out, 4, ret);
    a.CloseHandle(tok[0]);
    return ok ? out[0] !== 0 : null;
  } catch { return null; }
  finally { if (proc && !own) { try { a.CloseHandle(proc); } catch { /* nothing to do */ } } }
}

// the process id of Star Citizen, or null when it is not running
function gamePid() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq StarCitizen.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve(null);
      const m = String(out).match(/"StarCitizen\.exe","(\d+)"/i);
      resolve(m ? parseInt(m[1], 10) : null);
    });
  });
}

// { available, gameRunning, gameElevated, appElevated, blocked }
async function status() {
  const available = !!load();
  const pid = await gamePid();
  const gameElevated = pid == null ? null : isElevated(pid);
  const appElevated = isElevated(null);
  return { available, error: loadError, gameRunning: pid != null, gameElevated, appElevated, blocked: gameElevated === true && appElevated === false };
}

// Calls onPress() each time the key goes from up to down. setKey(vk) changes the key; stop() ends it.
function create(onPress) {
  let vk = 0, timer = null, was = false;
  function tick() {
    const a = api; if (!a || !vk) return;
    let down = false;
    try { down = (a.GetAsyncKeyState(vk) & 0x8000) !== 0; } catch { return; }
    if (down && !was) { try { onPress(); } catch { /* a handler error must not stop the watch */ } }
    was = down;
  }
  return {
    setKey(code) {
      vk = Number(code) || 0;
      was = true;                       // a key already held when it is chosen is not a press
      if (!vk) return false;
      if (!load()) return false;
      if (!timer) timer = setInterval(tick, 15);
      return true;
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}

module.exports = { create, status, isElevated, loadError: () => loadError };
