import fs from 'node:fs/promises';
import JSONBig from 'json-bigint';

// download item and recipe data and format

// open https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=6
// open devtools, find this request
// const response = await fetch('https://zonai.skland.com/web/v1/wiki/item/catalog?typeMainId=1&typeSubId=6');
// and then find this request have strict server side validation
// why do you have strict server side validation for a wiki site?
// manually copy response content in devtool and paste it here

const rawWikiItems = JSON.parse(await fs.readFile('data/raw-wiki-items.json', 'utf-8'));
// for now only name and cover is needed
const itemAndCovers: { name: string, cover: string }[] = rawWikiItems.data.catalog[0].typeSub[0].items.map(i => ({
    name: i.name,
    // TODO consider reduce dimension and store as data url
    cover: i.brief.cover,
}));

// this wiki site use very strange backend data structure and is not able to be understand by human or ai
// there is a look like game data but look like not up to date repo https://github.com/XiaBei-cy/EndfieldData
// it is ok for now because no recipe update since game release

const fileContents: string[] = await Promise.all([
    fs.readFile('data/I18nTextTable_CN.json', 'utf-8'),
    fs.readFile('data/ItemTable.json', 'utf-8'),
    fs.readFile('data/FactoryBuildingTable.json', 'utf-8'),
    fs.readFile('data/FactoryMachineCraftTable.json', 'utf-8'),
]);

// NOTE this simple solution does not handle all types of contents in these complex files, you have to parse
// const fixedFileContents = fileContents.map(c => c
//     // failed to exclude already in double quote numbers
//     .replaceAll(/(-?\d+)\b/g,(match, capture) => Number.isSafeInteger(capture) ? match : `"${capture}"`)
//     // so replace ""-?\d+"" back
//     .replaceAll(/""-?\d+""/g, match => match.substring(1, match.length - 1)));
// const parseWithBigInt = (text: string) => JSON.parse(text, (key, value) => !isNaN(value) && !Number.isSafeInteger(value) ? BigInt(value) : value);

const rawText = JSONBig.parse(fileContents[0]) as Record<string, string>;

const rawItems = JSONBig.parse(fileContents[1]) as {
    [id: string]: {
        id: string, // internal item id
        name: { id: string }, // id in i18n table
        desc: { id: string }, // id in i18n table, main description
        decoDesc: { id: string }, // id in i18n table, additional description
    },
};
interface Item {
    id: string,
    name: string, // name for human
    desc: string[], // main desc and additional desc for human
    cover: string, // from wiki
}
const items: Item[] = [];
for (const rawItem of Object.values(rawItems)) {
    const name = rawText[rawItem.name.id.toString()];
    if (typeof name == 'undefined' || name.length == 0) {
        // missing names seems not important for now
        // NOTE if game data updated, check again
        // // where do you put these names?
        // console.log('missing item name', rawItem.id);
        continue;
    }
    const cover = itemAndCovers.find(c => c.name == name)?.cover;
    if (typeof cover == 'undefined') {
        // missing item cover should mean that is not important
        // TODO this list is too long, I think no missing item in final result should be enough
        // console.log('missing item cover', rawItem.id);
        continue;
    }
    const desc = rawText[rawItem.desc.id.toString()];
    const decoDesc = rawText[rawItem.decoDesc.id.toString()];
    if (typeof desc == 'undefined' || desc.length == 0 || typeof decoDesc == 'undefined' || decoDesc.length == 0) {
        // for now this list includes
        // item_settlement_exp definitely means local exp, which is not important here
        // sysbp_tundra_* and sysbp_wulin_* these names have display name same as non prefix, investigate later
        // NOTE if game data updated, check again
        // // where do you put these strings?
        // console.log('missing item desc', rawItem.id);
        continue;
    }
    // TODO handle bottle with liquid
    items.push({ id: rawItem.id, name, desc: [desc, decoDesc], cover });
}
// negative direction check
for (const itemAndCover of itemAndCovers) {
    if (!items.find(i => i.name == itemAndCover.name)) {
        // for now this list include local exp and a few upgrade material, which are not important
        // NOTE if game data updated, check again
        // console.log(`wiki item ${itemAndCover.name} not found`);
    }
}
// console.log(items);

const rawMachines = JSONBig.parse(fileContents[2]) as {
    [id: string]: {
        id: string, // internal item id
        name: { id: string }, // id in i18n table
        desc: { id: string }, // id in i18n table, main description
        powerConsume: number,
    },
};
interface Machine {
    id: string,
    name: string, // name for human
    desc: string, // desc for human
    power: number,
}
const machines: Machine[] = [];
for (const rawMachine of Object.values(rawMachines)) {
    const name = rawText[rawMachine.name.id.toString()];
    if (typeof name == 'undefined' || name.length == 0) {
        // all of them are name.id=0, not sure what happens
        // NOTE if game data updated, check again
        // console.log('missing machine name', rawMachine);
        continue;
    }
    const desc = rawText[rawMachine.desc.id.toString()];
    if (typeof desc == 'undefined' || desc.length == 0) {
        // none for now
        console.log('missing machine desc', rawMachine);
        continue;
    }
    machines.push({ id: rawMachine.id, name, desc, power: rawMachine.powerConsume });
}
// console.log(machines);

const rawRecipes = JSONBig.parse(fileContents[3]) as {
    [id: string]: {
        id: string, // internal recipe id
        formulaDesc: { id: number }, // this id is in i18n table, recipe display name
        // multiple recipe to same item use different recipe object,
        ingredients: {
            // id is internal item id
            group: { count: number, id: string }[],
        }[],
        // multiple outcome use multiple items in outcomes[0].group,
        outcomes: {
            group: { count: number, id: string }[],
        }[],
        machineId: string,
        progressRound: number, // machine time in seconds
    },
};
interface Recipe {
    id: string,
    name: string,
    machineId: string,
    ingredients: { id: string, count: number }[],
    products: { id: string, count: number }[],
    time: number,
}
const recipes: Recipe[] = [];
for (const raw of Object.values(rawRecipes)) {
    const name = rawText[raw.formulaDesc.id.toString()];
    if (typeof name == 'undefined' || name.length == 0) {
        // none for now
        console.log('missing recipe name', raw);
        continue;
    }
    if (!machines.some(m => m.id == raw.machineId)) {
        // none for now
        console.log('machine id not found', raw);
        continue;
    }
    const ingredients: Recipe['ingredients'] = [];
    if (raw.ingredients.length != 1) {
        // none for now
        console.log('ingredients length not 1', raw);
    }
    for (const ingredient of raw.ingredients[0].group) {
        if (!items.some(i => i.id == ingredient.id)) {
            // none for now
            console.log('ingredient item id not found', raw);
        }
        ingredients.push(ingredient);
    }
    if (ingredients.length == 0) {
        console.log('empty ingredient', raw);
    }
    const products: Recipe['ingredients'] = [];
    if (raw.outcomes.length != 1) {
        // none for now
        console.log('outcomes length not 1', raw);
    }
    for (const product of raw.outcomes[0].group) {
        if (!items.some(i => i.id == product.id)) {
            // none for now
            console.log('product item id not found', raw);
        }
        products.push(product);
    }
    if (products.length == 0) {
        console.log('empty products', raw);
    }
    recipes.push({ id: raw.id, name, machineId: raw.machineId, ingredients, products, time: raw.progressRound });
}
for (const recipe of recipes) {
    let sb = ``;
    for (const ingredient of recipe.ingredients) {
        sb += `${ingredient.count}x${items.find(i => i.id == ingredient.id)?.name} + `;
    }
    sb = sb.substring(0, sb.length - 3);
    sb += ` =>${machines.find(m => m.id == recipe.machineId)?.name}${recipe.time}s=> `;
    for (const product of recipe.products) {
        sb += `${product.count}x${items.find(i => i.id == product.id)?.name} + `;
    }
    sb = sb.substring(0, sb.length - 3);
    sb += ` [${recipe.id}]`;
    // console.log(sb);
}

// filter out item and machine not used in recipe
const filteredItems = items.filter(i => recipes.some(r => r.ingredients.some(r => r.id == i.id) || r.products.some(r => r.id == i.id)));
const filteredMachines = machines.filter(m => recipes.some(r => r.machineId == m.id));

await fs.writeFile('data/recipes.json', JSON.stringify({ items: filteredItems, machines: filteredMachines, recipes }));
