import React from 'react';
import ReactDOM from 'react-dom/client';
import * as PIXI from 'pixi.js';
import App from './App';
import './styles.css';

window.PIXI = PIXI;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
