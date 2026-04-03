import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import { randomInt } from 'node:crypto';

// 明日方舟：终末地 基质规划
// weapon and attributes from weapon.json from autobrowser project

// put progress before other things to make it easy to find and change
// // do I need to frequently change it?
// // yes, if you frequently change it, it's better to put it at top,
// // if you rarely change it, it's better to put it at top to make it easier to find
interface Progress {
    name: string,
    progress: [number, number, number],
}
const AllProgress: Progress[] = [
    { name: '宏愿', progress: [3, 2, 1] },
    { name: '遗忘', progress: [2, 1, 1] },
    { name: 'J.E.T.', progress: [2, 1, 1] },
    { name: '大雷斑', progress: [1, 1, 2] },
    { name: '沧溟星梦', progress: [1, 1, 2] },
    { name: '熔铸火焰', progress: [2, 1, 2] },
    { name: '钢铁余音', progress: [2, 1, 2] },
    { name: '十二问', progress: [3, 1, 1] },
    { name: '作品：众生', progress: [1, 1, 1] },
    { name: '白夜新星', progress: [1, 1, 1] },
    { name: '热熔切割器', progress: [1, 1, 1] },
    { name: 'O.B.J.尖峰', progress: [3, 1, 1] },
    { name: '骁勇', progress: [1, 2, 1] },
    { name: '显赫声名', progress: [1, 1, 1] },
    { name: 'O.B.J.迅极', progress: [1, 1, 1] },
    { name: '探骊', progress: [1, 1, 1] },
    { name: '终点之声', progress: [1, 1, 1] },
    { name: '同类相食', progress: [1, 1, 1] },
    { name: '艺术暴君', progress: [1, 1, 1] },
    { name: '光荣记忆', progress: [1, 1, 2] },
    { name: '狼之绯', progress: [1, 1, 1] },
    // { name: '', progress: [1, 1, 1] },
];
// NOTE this progress list precisely represent my overall progress
// so cut the progress list in the middle effectively creates test cases for the following sort logic
// AllProgress.splice(15, 100);

// you call a 重度能量淤积点 protocol space? more naming conventions:
// - 基础属性 is category 1, 附加属性 is category 2, 技能属性 is category 3
// - 敏捷提升 is an attribute, 敏捷提升·大 is a weapon attribute, 大，中，小 is attribute strength
// - 切骨·艺术暴论 is a skill attribute, 切骨 is an attribute, 艺术暴论 is a skill

// this information is not available on wiki site, so manually collect
interface ProtocolSpace {
    name: string,
    cat1: string[],
    cat2: string[],
    cat3: string[],
}
const AllSapces: ProtocolSpace[] = [{
    name: '枢纽区',
    cat1: ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升'],
    cat2: ['攻击提升', '灼热伤害提升', '电磁伤害提升', '寒冷伤害提升', '自然伤害提升', '源石技艺提升', '终结技效率提升', '法术伤害提升'],
    cat3: ['强攻', '压制', '追袭', '粉碎', '巧技', '迸发', '流转', '效益'],
}, {
    name: '源石研究园',
    cat1: ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升'],
    cat2: ['攻击提升', '物理伤害提升', '电磁伤害提升', '寒冷伤害提升', '自然伤害提升', '暴击率提升', '终结技效率提升', '法术伤害提升'],
    cat3: ['压制', '追袭', '昂扬', '巧技', '附术', '医疗', '切骨', '效益'],
}, {
    name: '矿脉源区',
    cat1: ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升'],
    cat2: ['生命提升', '物理伤害提升', '灼热伤害提升', '寒冷伤害提升', '自然伤害提升', '暴击率提升', '源石技艺提升', '治疗效率提升'],
    cat3: ['强攻', '压制', '巧技', '残暴', '附术', '迸发', '夜幕', '效益'],
}, {
    name: '供能高地',
    cat1: ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升'],
    cat2: ['攻击提升', '生命提升', '物理伤害提升', '灼热伤害提升', '自然伤害提升', '暴击率提升', '源石技艺提升', '治疗效率提升'],
    cat3: ['追袭', '粉碎', '昂扬', '残暴', '附术', '医疗', '切骨', '流转'],
}, {
    name: '武陵城',
    cat1: ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升'],
    cat2: ['攻击提升', '生命提升', '电磁伤害提升', '寒冷伤害提升', '暴击率提升', '终结技效率提升', '法术伤害提升', '治疗效率提升'],
    cat3: ['强攻', '粉碎', '残暴', '医疗', '切骨', '迸发', '夜幕', '流转'],
}, {
    name: '清波寨',
    cat1: ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升'],
    cat2: ['生命提升', '物理伤害提升', '电磁伤害提升', '寒冷伤害提升', '源石技艺提升', '终结技效率提升', '法术伤害提升', '治疗效率提升'],
    cat3: ['压制', '粉碎', '昂扬', '巧技', '医疗', '切骨', '迸发', '夜幕'],
}];

// ATTENTION HARDCODE fix naming inconsitency
const NameIssues: { correct: string, errors: string[] }[] = [
    { correct: '寒冷伤害提升', errors: ['寒冷伤害'] }, // this is wiki data error, not in game data error
    { correct: '法术伤害提升', errors: ['法术提升'] },
    { correct: '源石技艺强度提升', errors: ['源石技艺提升'] },
    { correct: '终结技充能效率提升', errors: ['终结技效率提升'] },
];

interface WeaponData {
    name: string,
    rarity?: number,
    attributes?: string[],
}
const AllWeapons: WeaponData[] = JSON.parse(await fs.readFile('sanity/weapon.json', 'utf-8'));

function validate(log: boolean) {
    const info = (content: string) => { if (log) { console.log(content); } };
    const error = (content: string) => { console.log(content); }

    const allSkillNames: string[] = [];
    const kindsFromWeapon: [string[], string[], string[]] = [[], [], []];
    for (const [cat, getAttribute, setAttribute] of [
        // the set method only happens when successfully get, so no need to check again
        [1, w => w.attributes?.length ? w.attributes[0] : null, (w, a) => w.attributes[0] = a],
        // NOTE for 3 star weapons, it only have cat1 and cat3 attributes, so this is checking == 3
        [2, w => w.attributes?.length == 3 ? w.attributes[1] : null, (w, a) => w.attributes[1] = a],
        // and this is using index -1
        [3, w => w.attributes?.length > 1 ? w.attributes.at(-1) : null, (w, a) => w.attributes[w.attributes.length == 2 ? 1 : 2] = a],
    ] as [number, (w: WeaponData) => string, (w: WeaponData, a: string) => void][]) {
        for (const weapon of AllWeapons) {
            let attribute = getAttribute(weapon);
            if (!attribute) { 
                continue;
            } else if (!attribute.includes('·')) {
                error(`weapon ${weapon.name} attribute ${attribute} is not using ·?`);
                continue;
            } else if (attribute.split('·').length != 2) {
                error(`weapon ${weapon.name} attribute ${attribute} have multiple ·?`);
                continue;
            }
        
            let [kind, strength] = attribute.split('·');
            // fix incorrect attribute kind
            const issue = NameIssues.find(i => i.errors.includes(kind));
            if (issue) {
                info(`fix weapon ${weapon.name} attribute ${attribute} to be ${issue.correct}`);
                kind = issue.correct;
                attribute = `${issue.correct}·${strength}`;
                setAttribute(weapon, attribute);
            }

            if (!kindsFromWeapon[cat - 1].includes(kind)) {
                kindsFromWeapon[cat - 1].push(kind);
            }

            // check data is normal according to current observation
            if (cat == 1 || cat == 2) {
                // not important, check for fun
                if (!kind.endsWith('提升')) {
                    info(`weapon ${weapon.name} attribute ${attribute} does not end with 提升`);
                }
                if (!['大', '中', '小'].includes(strength)) {
                    info(`weapon ${weapon.name} attribute ${attribute}'s strength part is not using 大中小`);
                }
                if (weapon.rarity == 6 && strength != '大') {
                    info(`weapon ${weapon.name} is ${weapon.rarity} star but attribute ${attribute}'s strength part ${strength} is not 大`);
                }
                if (weapon.rarity == 5 && strength != '中') {
                    info(`weapon ${weapon.name} is ${weapon.rarity} star but attribute ${attribute}'s strength part ${strength} is not 中`);
                }
                if (weapon.rarity == 4 && strength != '小') {
                    info(`weapon ${weapon.name} is ${weapon.rarity} star but attribute ${attribute}'s strength part ${strength} is not 小`);
                }
            } else if (cat == 3) {
                if (kind.length != 2) {
                    info(`weapon ${weapon.name} attribute ${attribute} is not length 2`);
                }
                // collect cat 3 to see whether they will duplicate, will they?
                // exclude rarity 3, they are really same, ok, rarity 4 also have duplicates
                if (weapon.rarity != 3 && weapon.rarity != 4) {
                    if (allSkillNames.includes(strength)) {
                        info(`weapon ${weapon.name} attribute ${attribute} has duplicate strength`);
                    } else {
                        allSkillNames.push(strength);
                    }
                }
            }
        }
    }
    info(JSON.stringify(kindsFromWeapon));

    const kindsFromSpace: [string[], string[], string[]] = [[], [], []];
    for (const space of AllSapces) {
        if (space.cat1.length != 5) {
            error(`space ${space.name} cat1 length not 5`);
        }
        if (space.cat2.length != 8) {
            error(`space ${space.name} cat2 length not 8`);
        }
        if (space.cat3.length != 8) {
            error(`space ${space.name} cat3 length not 8`);
        }

        for (const [cat, names] of [[1, space.cat1], [2, space.cat2], [3, space.cat3]] as [number, string[]][]) {
            for (let index = 0; index < names.length; index += 1) {
                const issue = NameIssues.find(i => i.errors.includes(names[index]));
                if (issue) {
                    info(`fix space ${space.name} attribute ${names[index]} to be ${issue.correct}`);
                    names[index] = issue.correct;
                }
                if (!kindsFromSpace[cat - 1].includes(names[index])) {
                    kindsFromSpace[cat - 1].push(names[index]);
                }

                // a few similar to weapon validation
                if (cat == 1 || cat == 2) {
                    if (!names[index].endsWith('提升')) {
                        info(`space ${space.name} attribute ${names[index]} does not end with 提升`);
                    }
                } else if (cat == 3) {
                    if (names[index].length != 2) {
                        info(`weapon ${space.name} attribute ${names[index]} is not length 2`);
                    }
                }
            }
        }
    }
    // console.log(kindsFromSpace);

    for (const cat of [1, 2, 3]) {
        const fromWeapon = kindsFromWeapon[cat - 1];
        const fromSpace = kindsFromSpace[cat - 1];
        const fromWeaponButNotFromSpace = fromWeapon.filter(n => !fromSpace.includes(n));
        if (fromWeaponButNotFromSpace.length) {
            error(`category ${cat} existing in weapon but not exist in space: ${fromWeaponButNotFromSpace.join(', ')}`);
        }
        const fromSpaceButNotFromWeapon = fromSpace.filter(n => !fromWeapon.includes(n));
        if (fromSpaceButNotFromWeapon.length) {
            error(`category ${cat} existing in space but not exist in weapon: ${fromSpaceButNotFromWeapon.join(', ')}`);
        }
        info(`cat${cat}(${fromWeapon.length}): ${fromWeapon.join(', ')}`);
    }

    // try check no same name between categories
    for (const [cat1, cat2] of [[1, 2], [2, 3]]) {
        const duplicates = kindsFromSpace[cat1 - 1].filter(n => kindsFromSpace[cat2 - 1].includes(n));
        if (duplicates.length) {
            error(`names appear in both cat${cat1} and cat${cat2}: ${duplicates.join(', ')}`);
        }
    }

    // check all names have appeared multiple times
    // now after confirm no duplicates between categories, you can 
    for (const cat of [1, 2, 3]) {
        const weaponsAllKinds = AllWeapons.flatMap(w => w.attributes ?? []).map(a => a.split('·')[0]);
        const spaceAllNames = AllSapces.flatMap(s => [s.cat1, s.cat2, s.cat3].flat());
        for (const name of kindsFromSpace[cat - 1]) {
            const count = weaponsAllKinds.filter(n => n == name).length;
            // ATTENTION HARDCODE this indicates a typo, but sometimes really happen in real data, so hardcode to skip
            if (count == 1 && !['自然伤害提升', '切骨'].includes(name)) {
                error(`name ${name} only appear in weapons once`);
            }
            const count2 = spaceAllNames.filter(n => n == name).length;
            if (count2 == 1) {
                error(`name ${name} only appear in spaces once`);
            }
            info(`name ${name} times ${count} + ${count2}`);
        }
    }

    for (const progress of AllProgress) {
        const weapon = AllWeapons.find(w => w.name == progress.name);
        if (!weapon) {
            error(`unknown weapon name ${progress.name} in progress`);
            continue;
        }
        if (weapon.rarity != 5 && weapon.rarity != 6) {
            error(`why are you interested in this low rarity weapon ${weapon.name} ${weapon.rarity}?`);
        }
    }
}
validate(false);

function getCombinations<T>(sequence: T[], length: number): T[][] {
    const result: T[][] = [];
    function backtrack(start: number, current: T[]) {
        // If we've reached the desired length, add to result
        if (current.length == length) {
            result.push([...current]);
            return;
        }
        // Try adding each remaining element
        for (let i = start; i < sequence.length; i++) {
            current.push(sequence[i]);
            backtrack(i + 1, current);
            current.pop(); // Backtrack
        }
    }
    backtrack(0, []);
    return result;
}

// frequently used helper functions
const dedup = <T>(e: T, i: number, a: T[]) => a.indexOf(e) == i;
const displayAttribute = (a: string) => {
    const a1 = a.endsWith('提升') ? a.substring(0, a.length - 2) : a;
    const a2 = a1.endsWith('伤害') ? a1.substring(0, a1.length - 2) : a1;
    return a2
        .replace('主能力', '主能')
        .replace('源石技艺强度', '精通')
        .replace('终结技充能效率', '充能')
        .replace('治疗效率', '治疗')
        .replace('暴击率', '暴击')
}

// change weapon attribute to only have attribute, strengh is not used in planning
for (const weapon of AllWeapons) {
    weapon.attributes = weapon.attributes.map(a => a.split('·')[0]);
}
// only interested in 5/6 star weapons
const notAllWeapons = AllWeapons.filter(w => w.attributes?.length && (w.rarity == 5 || w.rarity == 6));
// it seems that sort all weapons and display them in order is a good way to find whether a newly acquired essence is fit
notAllWeapons.sort((w1, w2) => {
    const p1 = AllProgress.find(p => p.name == w1.name);
    const p2 = AllProgress.find(p => p.name == w2.name);
    if (!p1 && p2) { return -1; }
    if (p1 && !p2) { return 1; }
    if (w1.attributes[0] != w2.attributes[0]) { return w1.attributes[0].localeCompare(w2.attributes[0]); }
    if (w1.attributes[1] != w2.attributes[1]) { return w1.attributes[1].localeCompare(w2.attributes[1]); }
    if (w1.attributes[2] != w2.attributes[2]) { return w1.attributes[2].localeCompare(w2.attributes[2]); }
    return 0;
});
function displayAllWeaponAndProgress() {
    for (const weapon of notAllWeapons) {
        const progress = AllProgress.find(p => p.name == weapon.name);
        const displayProgress = progress ? ` [${progress.progress.join(',')}]` : '';
        console.log(`${weapon.attributes.map(displayAttribute).join(',')}: ${weapon.name}${displayProgress}`);
    }
}

// display all strategies organized in space-cat3/cat2-cat1 with specific ordering rule
interface PairResult {
    spacename: string,
    attribute: string, // selected attribute in cat2 or cat3
    cat1Attributes: string[],
    weapons: WeaponData[], // all weapons in the pair regardless of progress
    numbers: number[], // numbers later used in sorting
}
function score(allProgress: Progress[]): PairResult[] {
    const notHaveProgress = (w: WeaponData) => !allProgress.some(p => p.name == w.name);
    const pairs: PairResult[] = [];
    for (const space of AllSapces) {
        // cat2 and cat3 handling only differ in filter weapon part, so can merge them together
        for (const [cat, weapons] of space.cat2.map<[string, WeaponData[]]>(cat2 => [cat2,
                notAllWeapons.filter(w => space.cat1.includes(w.attributes[0]) && w.attributes[1] == cat2 && space.cat3.includes(w.attributes[2]))])
            .concat(space.cat3.map(cat3 => [cat3,
                notAllWeapons.filter(w => space.cat1.includes(w.attributes[0]) && space.cat2.includes(w.attributes[1]) && w.attributes[2] == cat3)])))
        {
            // remain 6 first, then remain 5, then progress 6, then progress 5
            weapons.sort((w1, w2) => {
                const p1 = allProgress.find(p => p.name == w1.name);
                const p2 = allProgress.find(p => p.name == w2.name);
                if (!p1 && p2) { return -1; }
                if (p1 && !p2) { return 1; }
                if (w1.rarity != w2.rarity) { return w2.rarity - w1.rarity; }
                return w1.name.localeCompare(w2.name);
            });
            // if cat1 is larger than 3, need to split them
            const cat1Attributes = weapons.map(w => w.attributes[0]).filter(dedup);
            if (cat1Attributes.length <= 3) {
                pairs.push({ spacename: space.name, attribute: cat, cat1Attributes, weapons, numbers: [] });
            } else {
                // find all length 3 combinations of cat1set
                for (const combination of getCombinations(cat1Attributes, 3)) {
                    const thisCombinationWeapons = weapons.filter(w => combination.includes(w.attributes[0]));
                    pairs.push({ spacename: space.name, attribute: cat, cat1Attributes: combination, weapons: thisCombinationWeapons, numbers: [] });
                }
            }

        }
    }

    for (const { weapons, numbers } of pairs) {
        if (!weapons.length) {
            numbers.push(0, 0, 0, 0, 0, 0);
        } else {
            // probability is number of cat1-2-3 combinations in the weapon set, then devided by 24
            // e.g. 3 weapons have 3 different cat123 combinations, so they have 3/24 probability,
            //      if 2 weapons are exactly same, they only have 2 different cat123 combinations, so 2/24
            // this is more reasonable then the previous weapon count strategy

            // this combination count don't need to care about whether this pair comes from cat2 or cat3
            // because their cat2/cat3 is same, this does not affect the result combination count
            const remaining6CombinationCount = weapons.filter(w => w.rarity == 6 && notHaveProgress(w)).map(w => w.attributes.join('-')).filter(dedup).length;
            const remainingCombinationCount = weapons.filter(notHaveProgress).map(w => w.attributes.join('-')).filter(dedup).length;
            const totalCombinationCount = weapons.map(w => w.attributes.join('-')).filter(dedup).length;
            const remaining6Count = weapons.filter(w => w.rarity == 6 && notHaveProgress(w)).length;
            const remainingCount = weapons.filter(notHaveProgress).length;
            const totalCount = weapons.length;
            numbers.push(remaining6CombinationCount, remainingCombinationCount, totalCombinationCount, remaining6Count, remainingCount, totalCount);
        }
    }

    // TODO if search for a weapon in process.argv[2], put it at topmost
    // the core operation of "planning" is set priority of the pairs
    pairs.sort((p1, p2) => { 
        // return p2-p1 means larger first, p1-p2 means smaller first,
        // or return negative means p1 before p2, positive means p2 before p1
        // max prob
        if (p1.numbers[0] != p2.numbers[0]) { return p2.numbers[0] - p1.numbers[0]; }
        // max prob include 5
        if (p1.numbers[1] != p2.numbers[1]) { return p2.numbers[1] - p1.numbers[1]; }
        // then complete weapon count
        if (p1.weapons.length != p2.weapons.length) { return p2.weapons.length - p1.weapons.length; }
        // normally by space name and attribute
        if (p1.spacename != p2.spacename) { return p1.spacename.localeCompare(p2.spacename); }
        if (p1.attribute != p2.attribute) { return p1.attribute.localeCompare(p2.attribute); }
        // last regard as same
        return 0;
    });
    return pairs;
}

function displayStategy(pairs: PairResult[], allProgress: Progress[], limit: number = 10) {
    console.log('------------------------------');
    for (const [pair, pairIndex] of pairs.map((p, i) => [p, i] as const)) {
        if (pairIndex >= limit) { break; }
        const { spacename, attribute, weapons, cat1Attributes, numbers } = pair;
        if (weapons.length) {
            const placeDisplay = styleText('white', `${spacename}:${displayAttribute(attribute)}:${cat1Attributes.map(displayAttribute).join(',')}`);
            const mainNumberDisplay = styleText('yellow', numbers[0].toString());
            const numbersDisplay = styleText('gray', 'prob ') + mainNumberDisplay + styleText('gray', `/${numbers[1]}/${numbers[2]}/24 count ${numbers[3]}/${numbers[4]}/${numbers[5]}`);
            console.log(`${placeDisplay}: ${numbersDisplay}`);

            let sb = '  ';
            for (const weapon of weapons) {
                // rarity gray, progress gray, normal weapon name white, highlight weapon name green
                const progress = allProgress.find(p => p.name == weapon.name); 
                sb += styleText(progress ? 'gray' : 'green', weapon.name);
                sb += styleText(`gray`, `(${weapon.rarity})`);
                sb += progress ? styleText(`gray`, `[${progress.progress.join(',')}]`) : '';
                sb += `, `;
            }
            sb = sb.substring(0, sb.length - 2);
            console.log(sb);
        } else {
            // console.log(`${spacename}:${attribute}: no`);
        }
    }
}

displayAllWeaponAndProgress();
displayStategy(score(AllProgress), AllProgress, 100);

// total count estimate, seems only can by monte carlo
// by always choosing the topmost place, and randomly generate 3 essences, display result game count
function simulate(initialProgress: Progress[]) {
    let gameCount = 0;
    let foodCount = 0;
    const currentProgress = [...initialProgress];
    while (currentProgress.length != notAllWeapons.length) {
        const plan = score(currentProgress)[0];
        gameCount += 1;
        // console.log(`#${gameCount}(${currentProgress.length}/${notAllWeapons.length}): ` +
        //     `goto ${plan.spacename}:${displayAttribute(plan.attribute)}:${plan.cat1Attributes.map(displayAttribute).join(',')}`);
        const space = AllSapces.find(s => s.name == plan.spacename);
        // if cat1 does not length 3, filling whatever reamin from remaining cat1s
        const cat1pool = plan.cat1Attributes.length == 3 ? plan.cat1Attributes
            : plan.cat1Attributes.concat(...new Array(3 - plan.cat1Attributes.length).fill(0).map(_ => space.cat1.filter(c => !plan.cat1Attributes.includes(c))[0]));
        const fix2 = space.cat2.includes(plan.attribute);
        const cat23pool = fix2 ? space.cat3 : space.cat2;
        // console.log(`  cat1pool ${cat1pool} cat23pool ${cat23pool}`);
        let sb = '  ';
        for (const [pullAttribute1, pullAttribute23] of [1, 2, 3].map(_ => [cat1pool[randomInt(3)], cat23pool[randomInt(8)]])) {
            const ding = notAllWeapons.filter(w => !currentProgress.some(p => p.name == w.name))
                .find(w => w.attributes[0] == pullAttribute1
                    && w.attributes[1] == (fix2 ? plan.attribute : pullAttribute23)
                    && w.attributes[2] == (fix2 ? pullAttribute23 : plan.attribute));
            if (ding) {
                currentProgress.push({ name: ding.name, progress: [1, 1, 1] });
            } else {
                foodCount += 1;
            }
            const displayPull = `${displayAttribute(pullAttribute1)}-${displayAttribute(pullAttribute23)}-${displayAttribute(plan.attribute)}`;
            const displayDing = ding ? styleText('cyanBright', `!!${ding.name}`) : '';
            sb += `${displayPull}${displayDing}, `;
        }
        sb = sb.substring(0, sb.length - 2);
        // console.log(sb);
        if (gameCount > 1000) { console.log('>1000??'); displayStategy(score(currentProgress), currentProgress); break; }
    }
    console.log(`game count ${gameCount} food count ${foodCount}`);
    return gameCount;
}

// TODO node essence.ts weapon(s) w1,w2,w3 space s1 attribute 附术 limit 10 simulate 100

// let totalGameCount = 0;
// for (const _ of new Array(100).fill(0)) {
//     totalGameCount += simulate(AllProgress);
// }
// console.log(`avg ${totalGameCount / 100}`);
