/**
 * main.cjs — process principal Electron de la console Tutti (cible desktop).
 *
 * Emballe l'app web Tutti dans une fenêtre desktop dédiée. Deux vrais gains
 * « natifs » par rapport à un simple onglet navigateur :
 *   1. Autoplay débloqué (`no-user-gesture-required`) → la musique démarre sans
 *      le cirque du geste utilisateur (le pendant desktop du fix mobile).
 *   2. Micro auto-autorisé → la reconnaissance vocale marche sans pop-up.
 * + fenêtre dédiée / plein écran kiosque possible.
 *
 * L'app pointe vers l'app web hébergée (elle a besoin du backend live de toute
 * façon). URL configurable via TUTTI_URL ; défaut = serveur Vite local en dev.
 */
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

// 1) Autoplay sans geste : la console doit pouvoir lancer le son direct.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const APP_URL = process.env.TUTTI_URL || 'http://localhost:5173';

/** @type {BrowserWindow | null} */
let win = null;

// Mode kiosque plein écran pour un poste dédié en salle (TUTTI_KIOSK=1).
const KIOSK = process.env.TUTTI_KIOSK === '1';

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    backgroundColor: '#17120e',
    title: 'Tutti',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Politique d'autoplay au niveau WebContents aussi (ceinture + bretelles).
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // 2) Micro (reconnaissance vocale) auto-accordé pour cette app de confiance.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });

  // Les liens externes (aide, docs) s'ouvrent dans le navigateur système,
  // pas dans la fenêtre de la console.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void win.loadURL(APP_URL);

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Convention macOS : l'app reste active tant que Cmd+Q n'est pas fait.
  if (process.platform !== 'darwin') app.quit();
});
