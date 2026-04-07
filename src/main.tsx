import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { seedDatabase } from './db';
import './theme.css';

seedDatabase().catch(console.error);

registerSW({ immediate: true });

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/night-stack">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
