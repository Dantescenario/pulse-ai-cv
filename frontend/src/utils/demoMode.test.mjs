import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Render the actual components with Vite's JSX/CSS loader; effects do not run.
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { default: App } = await server.ssrLoadModule('/src/App.jsx');
  const { default: Navbar } = await server.ssrLoadModule('/src/components/Navbar.jsx');
  const { default: Trainer } = await server.ssrLoadModule('/src/components/VisionTrainer.jsx');
  const initial = renderToStaticMarkup(React.createElement(App));
  assert.match(initial, /Public computer vision demo/);
  assert.match(initial, /Personal workout records are not persisted/);
  assert.doesNotMatch(initial, /Save session/);
  const demoNav = renderToStaticMarkup(React.createElement(Navbar, { demoMode: true }));
  assert.match(demoNav, /Vision Trainer/);
  assert.match(demoNav, /Stats Guide/);
  for (const label of ['Daily Log', 'Targets', 'Nutrition', 'Analytics', 'Profile']) {
    assert.ok(!demoNav.includes(`>${label}<`), `${label} must be hidden in demo navigation`);
  }
  const privateNav = renderToStaticMarkup(React.createElement(Navbar, { demoMode: false }));
  assert.match(privateNav, />Profile</);
  const privateTrainer = renderToStaticMarkup(React.createElement(Trainer, { demoMode: false }));
  assert.match(privateTrainer, /Save session/);
  console.log('Demo frontend checks passed: safe initial render, filtered navigation, save controls and private-mode compatibility');
} finally {
  await server.close();
}
