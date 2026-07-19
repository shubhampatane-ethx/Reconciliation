import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './AuthContext';
import './styles.css';

/**
 * Entry point — wraps the entire app in <AuthProvider> so that useAuth()
 * is available everywhere: App.jsx (dashboard gate + header), LoginPage.jsx
 * (login / register forms), and ChatWidget.jsx (auth-gated API calls).
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
