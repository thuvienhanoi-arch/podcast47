import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.addEventListener('error', (event) => {
  if (event.message.includes('Cannot set property fetch')) {
    event.preventDefault();
  }
});

Object.defineProperty(window, 'fetch', {
  writable: true,
  value: window.fetch
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
