import pptr from 'puppeteer-core';

// https://pptr.dev/api

// use this to check command line args
// console.log(pptr.defaultArgs({...}));

const browser = await pptr.launch({
    executablePath: '/usr/bin/microsoft-edge',
    args: [
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1920,1080',
    ],
    userDataDir: '/userdata1',
});

console.log(await browser.version());
const page = (await browser.pages())[0];
await page.goto('https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=5', { waitUntil: 'networkidle2' });
// TODO try click this
console.log(await page.$$eval('div.MedicineCard__Title-bfcsTh', nodes => nodes.map(n => n.innerText)));

await browser.close();
