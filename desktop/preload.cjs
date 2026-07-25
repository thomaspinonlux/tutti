/**
 * preload.cjs — pont sécurisé entre Electron et l'app web.
 *
 * Expose un marqueur minimal que lit `frontend/src/lib/platform.ts`
 * (`isElectron()`) pour brancher la bonne implémentation à l'exécution. On
 * n'expose RIEN d'autre (contextIsolation actif) : pas d'accès Node au renderer.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__TUTTI_DESKTOP__', {
  platform: 'electron',
  version: process.versions.electron,
});
