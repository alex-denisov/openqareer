import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './App.css';
import './features/shell/career-shell.css';
import './features/admin/admin-console.css';
import './features/site/landing.css';
import { isTauriEnvironment } from './services/desktop/desktopBridge';
import { installExternalLinkInterceptor } from './services/desktop/externalLinkInterceptor';
import { openExternalLink } from './services/desktop/openExternalLink';
import { installTitleTooltips } from './services/desktop/titleTooltips';

document.documentElement.dataset.release =
  import.meta.env.VITE_OPENQAREER_RELEASE || 'local';

if (isTauriEnvironment()) {
  installExternalLinkInterceptor(document, openExternalLink);
  installTitleTooltips(document);
}

const root = document.getElementById('root');
if (!root) throw new Error('openqareer root mount point is missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
