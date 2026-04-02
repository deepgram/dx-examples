'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const { DeepgramClient } = require('@deepgram/sdk');

if (!process.env.DEEPGRAM_API_KEY) {
  console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
  console.error('Copy .env.example to .env and add your API key.');
  process.exit(1);
}

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

let overlayWindow = null;
let tray = null;
let dgConnection = null;

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 600,
    height: 160,
    x: Math.floor((require('electron').screen.getPrimaryDisplay().workAreaSize.width - 600) / 2),
    y: require('electron').screen.getPrimaryDisplay().workAreaSize.height - 180,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'index.html'));

  // Click-through when not hovering interactive elements.
  // The renderer sends 'set-ignore-mouse' to toggle this.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createTray() {
  // 16×16 transparent icon — enough for a tray indicator
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Deepgram Live Transcription');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Overlay', click: () => overlayWindow && overlayWindow.show() },
    { label: 'Hide Overlay', click: () => overlayWindow && overlayWindow.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// ── Deepgram live connection ────────────────────────────────────────────────
async function startDeepgramConnection() {
  if (dgConnection) return;

  dgConnection = await deepgram.listen.v1.connect({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1500,
    punctuate: true,
  });

  dgConnection.on('open', () => {
    console.log('[deepgram] Connection opened');
    if (overlayWindow) overlayWindow.webContents.send('dg-status', 'connected');
  });

  dgConnection.on('error', (err) => {
    console.error('[deepgram] Error:', err.message);
    if (overlayWindow) overlayWindow.webContents.send('dg-status', 'error');
  });

  dgConnection.on('close', () => {
    console.log('[deepgram] Connection closed');
    dgConnection = null;
    if (overlayWindow) overlayWindow.webContents.send('dg-status', 'disconnected');
  });

  dgConnection.on('message', (data) => {
    try {
      const transcript = data?.channel?.alternatives?.[0]?.transcript;
      if (transcript && overlayWindow) {
        overlayWindow.webContents.send('transcript', {
          text: transcript,
          is_final: data.is_final,
        });
      }
    } catch {}
  });

  dgConnection.connect();
  await dgConnection.waitForOpen();
}

function stopDeepgramConnection() {
  if (!dgConnection) return;
  try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
  try { dgConnection.close(); } catch {}
  dgConnection = null;
}

// ── IPC handlers ────────────────────────────────────────────────────────────
ipcMain.on('audio-data', (_event, buffer) => {
  if (dgConnection) {
    try { dgConnection.sendBinary(Buffer.from(buffer)); } catch {}
  }
});

ipcMain.on('start-transcription', () => {
  startDeepgramConnection();
});

ipcMain.on('stop-transcription', () => {
  stopDeepgramConnection();
});

ipcMain.on('set-ignore-mouse', (_event, ignore) => {
  if (overlayWindow) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createOverlayWindow();
  createTray();

  // Ctrl+Shift+T toggles overlay visibility
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopDeepgramConnection();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { startDeepgramConnection, stopDeepgramConnection };
