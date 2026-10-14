import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { reactNoScripts, restrictReactScripts } from "./react-no-scripts.mjs";

assert.throws(() => restrictReactScripts("changed upstream source"), /audit/);
const { outputFiles } = await build({
  stdin: { contents: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync, preinit, preinitModule } from 'react-dom';
window.verify = () => {
 const errors = [];
 const host = document.createElement('div'); document.body.appendChild(host);
 const root = createRoot(host, { onUncaughtError: error => errors.push(error.message) });
 flushSync(() => root.render(React.createElement('button', null, 'Normal UI')));
 if (host.textContent !== 'Normal UI') throw new Error('Normal rendering broken');
 flushSync(() => root.render(React.createElement('script', null, 'window.unexpected = true')));
 try { flushSync(() => root.render(React.createElement('script', {src:'https://example.invalid/script.js', async:true}))); } catch(error) { errors.push(error.message); }
 for (const run of [() => preinit('https://example.invalid/preinit.js', {as:'script'}), () => preinitModule('https://example.invalid/module.js')]) {
   try {run();} catch(error) {errors.push(error.message);}
 }
 return errors;
};`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', plugins: [reactNoScripts], define: { 'process.env.NODE_ENV': '"production"' }
});
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
try {
 dom.window.eval(outputFiles[0].text);
 const errors = dom.window.verify();
 assert.equal(errors.length, 4);
 assert.ok(errors.every(message => message.includes('does not support runtime script')));
 assert.equal(dom.window.document.querySelectorAll('script').length, 0);
 assert.equal(dom.window.unexpected, undefined);
 console.log('React script policy: normal rendering passed; inline, external, preinit and module scripts blocked.');
} finally { dom.window.close(); }
