import fs from 'node:fs/promises';
import npfs from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import ts from 'typescript';

// step 3.1 confirm original voices.json data structure
async function check() {
    const basepath = process.env['THATREPO'] ?? '/thatrepo';

    const rawvoices = JSON.parse(await fs.readFile(path.join(basepath, 'src', 'voices.json'), 'utf-8'));
    const properties1 = Object.entries(rawvoices);
    if (properties1.length != 1 || properties1[0][0] != 'voices') {
        return console.log(`unknown top level structure?`, properties1.map(p => p[0]));
    }
    if (!Array.isArray(rawvoices.voices)) {
        return console.log(`unexpected top level voices type?`);
    }
    // this is all items regardless of category, this is only for check, not complete collect result
    const items: { name: string, path: string, display: string }[] = [];
    for (const category of rawvoices.voices) {
        if (typeof category != 'object') {
            return console.log(`unexpected category value type? ${typeof category}`);
        }
        const properties2 = Object.entries(category).sort((p1, p2) => p1[0].localeCompare(p2[0]));
        if (properties2.length != 3 || properties2[0][0] != 'categoryDescription' || properties2[1][0] != 'categoryName' && properties2[2][0] != 'voiceList') {
            return console.log(`unknown category structure?`, properties2.map(p => p[0]));
        }
        if (typeof category.categoryName != 'string') {
            return console.log(`unexpected categoryName type? ${typeof category.categoryName}`);
        }
        if (typeof category.categoryDescription != 'object') {
            return console.log(`unexpected categoryDescription type? ${typeof category.categoryDescription}`);
        }
        const properties3 = Object.entries(category.categoryDescription);
        if (properties3.length != 1 || properties3[0][0] != 'zh-CN') {
            return console.log(`unknown category.categoryDescription structure?`, category.categoryDescription);
        }
        if (!Array.isArray(category.voiceList)) {
            return console.log(`unexpected voiceList type?`);
        }
        // categoryName will not be used
        // remove whitespace between categorydescription, no need to style here
        const rawcategoryName = category.categoryDescription['zh-CN'];
        if (typeof rawcategoryName != 'string') {
            console.log(`unexpected .categoryDescription.zh-CN?`, typeof rawcategoryName);
        }
        const categoryName = (rawcategoryName as string).replaceAll(' ', '');
        console.log(`${categoryName}, ${category.voiceList.length} items`);
        for (const item of category.voiceList) {
            const properties4 = Object.entries(item).sort((p1, p2) => p1[0].localeCompare(p2[0]));
            if (properties4.length != 3 || properties4[0][0] != 'description' || properties4[1][0] != 'name' && properties4[2][0] != 'path') {
                return console.log(`unknown item structure?`, properties2.map(p => p[0]));
            }
            if (typeof item.name != 'string') {
                return console.log(`unexpected item.name type? ${typeof item.name}`);
            }
            if (typeof item.path != 'string') {
                return console.log(`unexpected item.path type? ${typeof item.path}`);
            }
            if (typeof item.description != 'object') {
                return console.log(`unexpected item.description type? ${typeof item.description}`);
            }
            const properties5 = Object.entries(item.description);
            if (properties5.length != 1 || properties5[0][0] != 'zh-CN') {
                return console.log(`unknown item.description structure?`, item.description);
            }
            const description = item.description['zh-CN'];
            if (typeof description != 'string') {
                return console.log(`unexpected item.description.zh-CN type?`, typeof description);
            }
            // according to source code, name is only used internally, it displays description and plays path, so name is not that important
            if (item.name != description) {
                // RESULT: MANY
                console.log(`   ${item.name}, ${item.path}, ${description}, ${styleText('red', 'error')}: item name != item description!`);
            } else if (item.name + '.mp3' != item.path) {
                // RESULT: 3 EXCEPTIONS
                console.log(`   ${item.name}, ${item.path}, ${description}, ${styleText('red', 'error')}: item.name + .mp3 != item.path!`);
            } else {
                console.log(`   ${item.name}, ${item.path}, ${description}`);
            }
            items.push({ name: item.name, display: description, path: item.path });
        }
    }
    // TODO duplicate check, and path exist check
    if (items.map(i => i.display).filter((e, i, a) => a.indexOf(e) == i).length != items.length) {
        const occurances = items.map(i => i.display).reduce((acc, d) => { d in acc ? acc[d] += 1 : acc[d] = 1; return acc; }, {} as Record<string, number>);
        const duplicates = Object.entries(occurances).filter(([k, v]) => v > 1);
        console.log(`   ${styleText('red', 'error')} duplicate display, ${duplicates.map(d => `${d[0]}x${d[1]}`).join(', ')}`);
    }
    for (const item of items) {
        const filepath = path.join(basepath, 'public', 'voices', item.path);
        if (!npfs.existsSync(filepath)) {
            // RESULT: 1 EXCEPTION
            console.log(`   ${styleText('red', 'error')} item ${item.display} path ${item.path} not found`);
        }
    }
    for (const filename of await fs.readdir(path.join(basepath, 'public', 'voices'))) {
        if (!items.some(i => i.path == filename)) {
            // RESULT: MANY
            // commit spread is not significant, should be random human error add up
            console.log(`   ${styleText('red', 'error')} file ${filename} not found in voices.json`);
        }
    }
}
await check();

function minifycss(originalContent: string) {
    // as my simple css is very regular that only contain plain rules .*\s\{attribute*\} and plain attributes .*:\s.*;
    // so can use simple string manipulation operation to minify

    let b = '';
    let previousCommentEndPosition = -2;
    let commentStartPosition = originalContent.indexOf('/*');
    while (commentStartPosition >= 0) {
        const commentEndPosition = originalContent.indexOf('*/', commentStartPosition);
        b += originalContent.substring(previousCommentEndPosition + 2, commentStartPosition);
        previousCommentEndPosition = commentEndPosition;
        commentStartPosition = originalContent.indexOf('/*', commentEndPosition);
    }
    b += originalContent.substring(previousCommentEndPosition + 2);
    originalContent = b;

    b = '';
    let previousRightBracePosition = -1;
    let leftBracePosition = originalContent.indexOf('{');
    while (leftBracePosition >= 0) {
        const rightBracePosition = originalContent.indexOf('}', leftBracePosition);
        // selector
        b += originalContent.substring(previousRightBracePosition + 1, leftBracePosition).trim();
        b += '{';
        const ruleContent = originalContent.substring(leftBracePosition + 1, rightBracePosition).trim();
        // every unwanted whitespace characters are around colon and semicolon, so...
        const trimmed1 = ruleContent.split(':').map(p => p.trim()).join(':');
        const trimmed2 = trimmed1.split(';').map(p => p.trim()).join(';');
        b += trimmed2;
        b += '}\n';

        previousRightBracePosition = rightBracePosition;
        leftBracePosition = originalContent.indexOf('{', rightBracePosition);
    }
    return b.trim();
}

async function handleMakePage() {

    // amazingly you need meta charset to make jajp characters work in html source code
    let template = await fs.readFile('index.html', 'utf-8');

    // template = template.replace('<div id="summary-container"></div>', summaryContainerElement);

    const styles = await fs.readFile('index.css', 'utf-8');
    template = template.replace('<style></style>', `<style>\n${minifycss(styles)}\n  </style>`);

    const scripts = await fs.readFile('index.ts', 'utf-8');
    const { config: tsconfig } = ts.parseConfigFileTextToJson("tsconfig.json", await fs.readFile('tsconfig.json', 'utf-8'));
    // oh basic transpile is so simple
    const transpileResult = ts.transpile(scripts, tsconfig.compilerOptions);
    template = template.replace('<script></script>', `<script type="module">\n${transpileResult.trim()}\n  </script>`);

    console.log(`write index.html`);
    await fs.writeFile('mikibutt.html', template);
}

// await handleMakePage();
