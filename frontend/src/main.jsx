import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import { AuthProvider } from './AuthContext';
import './styles.css';

// Automatically send ngrok warning bypass header on every Axios API request
axios.defaults.headers.common['ngrok-skip-browser-warning'] = '69420';

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
