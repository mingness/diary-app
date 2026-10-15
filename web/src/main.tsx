import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { ToastProvider } from './components/Toast.js';
import { I18nProvider } from './i18n/index.js';
import { applyAppearance, cachedAppearance } from './lib/appearance.js';
import { captureInstallOffer } from './lib/install.js';
import { createQueryClient } from './lib/query.js';
import './styles/tokens.css';
import './styles/base.css';

// Before the first render, so the page never flashes at the wrong size or in the wrong theme.
applyAppearance(cachedAppearance());
// The browser offers installing early, before any screen could listen for it.
captureInstallOffer();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
