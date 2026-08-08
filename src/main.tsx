import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './App.css';
import './features/shell/career-shell.css';

document.documentElement.dataset.release =
  import.meta.env.VITE_OPENQAREER_RELEASE || 'local';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
