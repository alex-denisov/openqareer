import './services/schemaRuntime';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './App.css';
import '@fontsource/onest/cyrillic-400.css';
import '@fontsource/onest/cyrillic-500.css';
import '@fontsource/onest/cyrillic-600.css';
import '@fontsource/onest/cyrillic-700.css';
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-500.css';
import '@fontsource/onest/latin-600.css';
import '@fontsource/onest/latin-700.css';
import './features/site/publicSite.css';
import './features/site/landingHome.css';
import './features/site/countryFitPage.css';
import './features/shell/session-gate.css';
import './features/desktopNotify/desktopNotificationService';
import { loadAuthPages } from './features/site/authPagesLoader';
import { captureEmbeddedLandingStats } from './features/site/embeddedLandingStats';
import { isTauriEnvironment } from './services/desktop/desktopBridge';
import { installExternalLinkInterceptor } from './services/desktop/externalLinkInterceptor';
import { openExternalLink } from './services/desktop/openExternalLink';
import { installTitleTooltips } from './services/desktop/titleTooltips';

document.documentElement.dataset.release = import.meta.env.VITE_OPENQAREER_RELEASE || 'local';

if (isTauriEnvironment()) {
  installExternalLinkInterceptor(document, openExternalLink);
  installTitleTooltips(document);
}

captureEmbeddedLandingStats();

const root = document.getElementById('root');
if (!root) throw new Error('openqareer root mount point is missing');

function mountApp() {
  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

if (!isTauriEnvironment() && ['/login', '/signup'].includes(window.location.pathname)) {
  // Keep the styled, disabled server form until its lazy module AND CSS are
  // ready. Otherwise createRoot commits an empty Suspense fallback in between.
  void loadAuthPages().then(mountApp);
} else {
  mountApp();
}

if (isTauriEnvironment()) {
  // B359: one updater for the window; «Сегодня» shows its strip.
  void import('./features/appUpdate/useDesktopUpdater').then(({ desktopUpdater }) =>
    desktopUpdater.start(),
  );
}
