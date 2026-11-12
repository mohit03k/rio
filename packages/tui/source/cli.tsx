#!/usr/bin/env bun
import { render } from 'ink';
import App from './app.js';

render(<App />, { maxFps: 60, exitOnCtrlC: false });
