const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('dist/index.html', 'utf8');

// The bundle is a module, so we have to configure JSDOM appropriately.
// Or we can just load the javascript and execute it using vm?
// Actually JSDOM can execute scripts if given the right paths.
const dom = new JSDOM(html, { 
    runScripts: "dangerously", 
    resources: "usable",
    url: "http://localhost:8000/"
});

dom.window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.log('Error caught by onerror:', msg, error);
};

dom.window.addEventListener('error', (event) => {
  console.log('Error event:', event.error);
});

dom.window.addEventListener('unhandledrejection', (event) => {
  console.log('Unhandled rejection:', event.reason);
});

setTimeout(() => {
  console.log('Done waiting. Root HTML:', dom.window.document.getElementById('root').innerHTML);
}, 3000);
