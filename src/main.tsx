import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './App.css';
import './features/workspace/setup.css';
import './features/workspace/workspace.css';
import './features/evidence/evidence.css';
import './features/opportunity/opportunity.css';
import './features/action/action.css';
import './features/outcome/outcome.css';
import './features/coach/coach-workspace.css';
import './features/coach/coach.css';
import './features/coach/assessment.css';
import './features/coach/market.css';

document.documentElement.dataset.release =
  import.meta.env.VITE_OPENQAREER_RELEASE || 'local';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
