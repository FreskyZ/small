import fs from 'node:fs/promises';
import chalkNotTemplate from 'chalk';
import chalk from 'chalk-template';
import JSONBig from 'json-bigint';
import ts from 'typescript';

// this script
// - migrate data from external source to required data structure
// - transpile runtime script hechen.ts to hechen.js
// - read template file index.html
// - merge them into single html file hechen.html

interface ItemData {
    id: string,
    name: string, // name for human
    // special handle seed in some sitations
    // is seed = startsWith('item_plant_') && contains('seed')
    kind?: 'seed',
    desc: string[], // main desc and additional desc for human
}
function collectItems(raw: string, strings: Record<string, string>): ItemData[] {
    const rawItems = JSONBig.parse(raw) as {
        [id: string]: {
            id: string, // internal item id
            name: { id: string }, // id in i18n table
            desc: { id: string }, // id in i18n table, main description
            decoDesc: { id: string }, // id in i18n table, additional description
        },
    };
    const items: ItemData[] = [];
    for (const rawItem of Object.values(rawItems)) {
        const name = strings[rawItem.name.id.toString()];
        if (typeof name == 'undefined' || name.length == 0) {
            // missing names seems not important for now
            // NOTE if game data updated, check again
            // // where do you put these names?
            // console.log('missing item name', rawItem.id);
            continue;
        }
        const desc = strings[rawItem.desc.id.toString()];
        const decoDesc = strings[rawItem.decoDesc.id.toString()];
        if (typeof desc == 'undefined' || desc.length == 0 || typeof decoDesc == 'undefined' || decoDesc.length == 0) {
            // for now this list includes
            // item_settlement_exp definitely means local exp, which is not important here
            // sysbp_tundra_* and sysbp_wulin_* these names have display name same as non prefix, investigate later
            // NOTE if game data updated, check again
            // // where do you put these strings?
            // console.log('missing item desc', rawItem.id);
            continue;
        }
        // runtime script is now relying on id.startsWith('item') for item node, add a check here
        if (!rawItem.id.startsWith('item_')) {
            // a lot of gem_, wpn_ (weapon), achv_ (archive) ids, ignore for now
            // console.log(`unexpected item id, not start with item_`, rawItem.id);
            continue;
        }
        const kind = rawItem.id.startsWith('item_plant_') && rawItem.id.includes('seed') ? 'seed' : undefined;
        items.push({ id: rawItem.id, name, kind, desc: [desc, decoDesc] });
    }

    // fix filled bottle name and description
    // no direct relationship with original bottle item name, e.g. original bottle name is glass_enr not glassenr
    const filledBottleItemIdPrefixes = [
        'item_fbottle_glass_',
        'item_fbottle_glassenr_',
        'item_fbottle_iron_',
        'item_fbottle_ironenr_',
    ];
    const filledBottleLiquidPostfixes = {
        'water': 'item_liquid_water',
        'grass_1': 'item_liquid_plant_grass_1',
        'grass_2': 'item_liquid_plant_grass_2',
        'xiranite': 'item_liquid_xiranite',
    };
    for (const item of items) {
        const prefix = filledBottleItemIdPrefixes.find(prefix => item.id.startsWith(prefix));
        if (prefix) {
            const postfix = item.id.substring(prefix.length);
            if (!(postfix in filledBottleLiquidPostfixes)) {
                console.log('item looks like filled bottle but liquid unknown', item);
                continue;
            }
            const liquidItemId = filledBottleLiquidPostfixes[postfix];
            const liquidName = items.find(i => i.id == liquidItemId)?.name;
            item.desc[0] = `装有${liquidName}的${item.name}。`;
            item.name = `${item.name} (${liquidName})`;
            item.desc[1] = '我问你为什么装有液体的瓶子和原来的瓶子是一个名字，他妈的连描述信息也是一样的？';
        }
    }

    items.sort((a, b) => a.id.localeCompare(b.id));
    return items;
}

interface IconData {
    id: string,
    icon: string,
}
function collectIcons(raw: string, items: ItemData[]): IconData[] {
    // icondata.json handled filled bottle items, put after item name and description handling
    const nameToIcons = JSON.parse(raw) as {
        name: string,
        icon: string, // icon data uri
    }[];
    const icons: IconData[] = [];
    for (const item of items) {
        const icon = nameToIcons.find(c => c.name == item.name)?.icon;
        if (typeof icon == 'undefined') {
            // missing item icon should mean that is not important
            // TODO this list is too long, I think no missing item in final result should be enough
            // console.log('missing item icon', rawItem.id);
            continue;
        }
        icons.push({ id: item.id, icon });
    }
    // negative direction check
    for (const { name } of nameToIcons) {
        if (!items.find(i => i.name == name)) {
            // for now this list include local exp and a few upgrade material, which are not important
            // NOTE if game data updated, check again
            // console.log(`wiki item ${name} not found`);
        }
    }
    return icons;
}

interface MachineData {
    id: string,
    name: string, // name for human
    desc: string, // desc for human
    power: number,
    size: [number, number],
}
function collectMachines(raw: string, strings: Record<string, string>): MachineData[] {
    const rawMachines = JSONBig.parse(raw) as {
        [id: string]: {
            id: string, // internal item id
            name: { id: string }, // id in i18n table
            desc: { id: string }, // id in i18n table, main description
            powerConsume: number,
            range: { depth: number, width: number },
        },
    };
    const machines: MachineData[] = [];
    for (const rawMachine of Object.values(rawMachines)) {
        const name = strings[rawMachine.name.id.toString()];
        if (typeof name == 'undefined' || name.length == 0) {
            // all of them are name.id=0, not sure what happens
            // NOTE if game data updated, check again
            // console.log('missing machine name', rawMachine);
            continue;
        }
        const desc = strings[rawMachine.desc.id.toString()];
        if (typeof desc == 'undefined' || desc.length == 0) {
            // none for now
            console.log('missing machine desc', rawMachine);
            continue;
        }
        if (!rawMachine.range?.depth || !rawMachine.range?.width) {
            // non for now
            console.log('missing range', rawMachine);
            continue;
        }
        machines.push({ id: rawMachine.id, name, desc, power: rawMachine.powerConsume, size: [rawMachine.range.depth, rawMachine.range.width] });
    }
    return machines;
}

interface RecipeData {
    id: string,
    name: string,
    // exclude pour in some situations
    // is pour = machineId == 'dismantler_1' && products.length == 2 && one contains('bottle') && one contains('liquid')
    kind?: 'pour',
    machineId: string,
    ingredients: { id: string, count: number }[],
    products: { id: string, count: number }[],
    time: number,
}
function collectRecipes(raw: string, strings: Record<string, string>, items: ItemData[], machines: MachineData[]): RecipeData[] {
    const rawRecipes = JSONBig.parse(raw) as {
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
    const recipes: RecipeData[] = [];
    for (const raw of Object.values(rawRecipes)) {
        const name = strings[raw.formulaDesc.id.toString()];
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
        const ingredients: RecipeData['ingredients'] = [];
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
        const products: RecipeData['ingredients'] = [];
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
        const kind = raw.machineId == 'dismantler_1' && products.length == 2
            && products.some(p => p.id.includes('bottle')) && products.some(p => p.id.includes('liquid')) ? 'pour' : undefined;
        recipes.push({ id: raw.id, name, kind, machineId: raw.machineId, ingredients, products, time: raw.progressRound });
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
    return recipes;
}

function createDataScript(items: ItemData[], machines: MachineData[], recipes: RecipeData[]): string {
    // filter out item and machine not used in recipe

    // JSON.stringify does not have line break option
    // it seems easier to manually format one line per entity (item, icon, machine, recipe)
    let sb = '';
    // now you can directly generate js instead of json
    // if this project is going to have a nginx, this file can be put separately
    sb += 'window["EndfieldRecipes"] = {"items":[\n';
    for (const item of items) {
        sb += JSON.stringify(item);
        sb += ",\n";
    }
    // no indention by design
    sb += '],"machines":[\n';
    for (const machine of machines) {
        sb += JSON.stringify(machine);
        sb += ",\n";
    }
    sb += '],"recipes":[\n';
    for (const recipe of recipes) {
        sb += JSON.stringify(recipe);
        sb += ",\n";
    }
    sb += ']};\n';
    return sb;
}

// icons are very long, put them in another <script>
function createImageScript(icons: IconData[]): string {
    let sb = '';
    sb += "window['EndfieldImages'] = {\n";
    for (const icon of icons) {
        sb += `"${icon.id}": "${icon.icon}",\n`;
    }
    sb += '};\n';
    return sb;
}

// see freskyz/fine script/components/typescript.ts function transpile
// return null for not ok
function transpileRuntimeScript(): string {

    const program = ts.createProgram(['hechen/index.ts'], {
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        noEmitOnError: true,
        strict: false,
        allowUnreachableCode: false,
        allowUnusedLabels: false,
        alwaysStrict: true,
        exactOptionalPropertyTypes: false,
        noFallthroughCaseInSwitch: true,
        noImplicitAny: true,
        noImplicitReturns: true,
        noImplicitThis: true,
        noPropertyAccessFromIndexSignature: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        strictNullChecks: false,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictBuiltinIteratorReturn: true,
        strictPropertyInitialization: false,
        removeComments: true,
        outDir: '/build',
    });

    const files = {};
    const emitResult = program.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });

    let transpileResult = Object.values(files)[0] as string;
    if (typeof transpileResult == 'string') {
        transpileResult = transpileResult.trim();
        if (transpileResult.endsWith('export {};')) {
            transpileResult = transpileResult.substring(0, transpileResult.length - 10).trimEnd();
        }
        transpileResult += '\n';
    }
    
    const diagnostics = emitResult.diagnostics;
    const errorCount = diagnostics.filter(d => d.category == ts.DiagnosticCategory.Error || ts.DiagnosticCategory.Warning).length;
    const normalCount = diagnostics.length - errorCount;

    let summary: string;
    if (normalCount == 0 && errorCount == 0) {
        summary = 'no diagnostic';
    } else if (normalCount != 0 && errorCount == 0) {
        summary = chalk`{yellow ${normalCount}} infos`;
    } else if (normalCount == 0 /* && errorCount != 0 */) {
        summary = chalk`{yellow ${errorCount}} errors`;
    } else /* normalCount != 0 && errorCount != 0 */ {
        summary = chalk`{yellow ${errorCount}} errors and {yellow ${normalCount}} infos`;
    }

    const success = diagnostics.length == 0;
    console.log(`index.js completed with ${summary}`);
    for (const { category, code, messageText, file, start } of diagnostics) {
        const displayColor = {
            [ts.DiagnosticCategory.Warning]: chalkNotTemplate.red,
            [ts.DiagnosticCategory.Error]: chalkNotTemplate.red,
            [ts.DiagnosticCategory.Suggestion]: chalkNotTemplate.green,
            [ts.DiagnosticCategory.Message]: chalkNotTemplate.cyan,
        }[category];
        const displayCode = displayColor(`  TS${code} `);

        let fileAndPosition = '';
        if (file && start) {
            const { line, character: column } = ts.getLineAndCharacterOfPosition(file, start);
            fileAndPosition = chalk`{yellow ${file.fileName}:${line + 1}:${column + 1}} `;
        }

        let flattenedMessage = ts.flattenDiagnosticMessageText(messageText, '\n');
        if (flattenedMessage.includes('\n')) {
            flattenedMessage = '\n' + flattenedMessage;
        }
        console.log(displayCode + fileAndPosition + flattenedMessage);
    }
    return success ? transpileResult : null;
}

async function createPage() {
    // the wiki site use very strange backend data structure and is not able to be understand by human or ai
    // there is a look like game data but look like not up to date repo https://github.com/XiaBei-cy/EndfieldData
    // it is ok for now because no recipe update since last major version (I mean major game content update, or minor version in semver)
    const fileContents = await Promise.all([
        fs.readFile('backup/I18nTextTable_CN.json', 'utf-8'),
        fs.readFile('backup/ItemTable.json', 'utf-8'),
        fs.readFile('backup/FactoryBuildingTable.json', 'utf-8'),
        fs.readFile('backup/FactoryMachineCraftTable.json', 'utf-8'),
        fs.readFile('tmp/icon-table.json', 'utf-8'),
        fs.readFile('hechen/index.css', 'utf-8'),
        fs.readFile('hechen/index.html', 'utf-8'),
    ]);

    // NOTE these files contains larger than safe int numbers, v8 JSON.parse does not handle this
    //      and the following workaround does not handle these files correctly, the only correct way is manually parse or import a package
    // const fixedFileContents = fileContents.map(c => c
    //     .replaceAll(/(-?\d+)\b/g,(match, capture) => Number.isSafeInteger(capture) ? match : `"${capture}"`)
    //     .replaceAll(/""-?\d+""/g, match => match.substring(1, match.length - 1)));
    // const parseWithBigInt = (text: string) => JSON.parse(text, (key, value) => !isNaN(value) && !Number.isSafeInteger(value) ? BigInt(value) : value);
    const strings = JSONBig.parse(fileContents[0]) as Record<string, string>;

    const allItems = collectItems(fileContents[1], strings);
    const allMachines = collectMachines(fileContents[2], strings);
    const recipes = collectRecipes(fileContents[3], strings, allItems, allMachines);
    
    // reverse filter out not used items and machines that not recorded in recipes
    const items = allItems.filter(i => recipes.some(r => r.ingredients.some(r => r.id == i.id) || r.products.some(r => r.id == i.id)));
    const machines = allMachines.filter(m => recipes.some(r => r.machineId == m.id));
    const datascript = createDataScript(items, machines, recipes);

    const icons = collectIcons(fileContents[4], items);
    const imagescript = createImageScript(icons);

    const runtimescript = transpileRuntimeScript();
    if (!runtimescript) {
        return;
    }
    const page = fileContents[6]
        .replace('<style></style>', `<style>${fileContents[5]}  </style>`)
        .replace('<script src="data.js"></script>', `<script>${datascript}    </script>`)
        .replace('<script src="image.js"></script>', `<script>${imagescript}    </script>`)
        .replace('<script src="hechen.js"></script>', `<script type="module">\n${runtimescript}</script>`);
    await fs.writeFile('hechen/hechen.html', page);
    console.log(`hechen.html completed`)
}
createPage();
