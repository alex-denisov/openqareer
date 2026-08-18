import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './App.css';
import './features/shell/career-shell.css';
import './features/admin/admin-console.css';
import './features/site/landing.css';

document.documentElement.dataset.release =
  import.meta.env.VITE_OPENQAREER_RELEASE || 'local';

const root = document.getElementById('root');
if (!root) throw new Error('openqareer root mount point is missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
