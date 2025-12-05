import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode is disabled here because p5.js instance mode + MediaPipe initialization 
  // can be tricky with double-firing effects in development, though it is handled in the code.
  // We keep it strictly to ensure stability for this specific demo interaction.
  <React.Fragment>
    <App />
  </React.Fragment>
);