const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = fs.readFileSync('dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
dom.window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.log('Error: ' + msg, error);
};
dom.window.document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded');
});
setTimeout(() => console.log('Done'), 5000);
