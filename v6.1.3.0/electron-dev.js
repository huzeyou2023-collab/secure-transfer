#!/usr/bin/env node

// Launch Electron properly (without ELECTRON_RUN_AS_NODE which some environments set)
const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.NODE_ENV = 'development';

const child = spawn(electron, [path.resolve(__dirname, '..')], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
