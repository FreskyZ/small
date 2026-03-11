import fs from 'node:fs/promises';

// 明日方舟：终末地 基质规划
// weapon and attributes from weapon.json from autobrowser project

// put progress before other things to make it easy to find and change
// // do I need to frequently change it?
// // yes, if you frequently change it, it's better to put it at top,
// // if you rarely change it, it's better to put it at top to make it easier to find
const AllProgress: { name: string, progress: [number, number, number] }[] = [
    { name: '宏愿', progress: [3, 2, 1] },
];

// you call 重度能量淤积点 protocol space? 
// this information is not available on wiki site, so manually collect
interface ProtocolSpace {
    name: string,
    cat1: string[], // 基础属性, size 5
    cat2: string[], // 附加属性, size 8
    cat3: string[], // 技能属性, size 8
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
}];

interface WeaponData {
    name: string,
    rarity?: number,
    attributes?: string[],
}
const AllWeapons: WeaponData[] = JSON.parse(await fs.readFile('sanity/weapon.json', 'utf-8'));

// Naming Conventions
// - 重度能量淤积点 is protocol space
// - 基础属性 is category 1, 附加属性 is category 2, 技能属性 is category 3
// - 敏捷提升·大 is a weapon attribute, or an attribute, 大，中，小 is attribute strength
// - 敏捷提升 is an attribute kind, 强攻 is an attribute kind, or skill

// ATTENTION HARDCODE fix naming inconsitency
const NameIssues: { correct: string, incorrects: string[] }[] = [
    { correct: '寒冷伤害提升', incorrects: ['寒冷伤害'] }, // TODO is this wiki data error?
    { correct: '法术伤害提升', incorrects: ['法术提升'] },
    { correct: '源石技艺强度提升', incorrects: ['源石技艺提升'] },
    { correct: '终结技充能效率提升', incorrects: ['终结技效率提升'] },
];

const allCat3Strengths: string[] = [];
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
            console.log(`weapon ${weapon.name} attribute ${attribute} is not using ·?`);
            continue;
        } else if (attribute.split('·').length != 2) {
            console.log(`weapon ${weapon.name} attribute ${attribute} have multiple ·?`);
            continue;
        }
    
        let [kind, strength] = attribute.split('·');
        // fix incorrect attribute kind
        const issue = NameIssues.find(i => i.incorrects.includes(kind));
        if (issue) {
            console.log(`fix weapon ${weapon.name} attribute ${attribute} to be ${issue.correct}`);
            kind = issue.correct;
            attribute = `${issue.correct}·${strength}`;
            setAttribute(weapon, attribute);
        }

        if (!kindsFromWeapon[cat - 1].includes(kind)) {
            kindsFromWeapon[cat - 1].push(kind);
        }

        // check data is normal according to current observation
        if (cat == 1 || cat == 2) {
            if (!kind.endsWith('提升')) {
                console.log(`weapon ${weapon.name} attribute ${attribute} does not end with 提升`);
            }
            if (!['大', '中', '小'].includes(strength)) {
                console.log(`weapon ${weapon.name} attribute ${attribute}'s strength part is not using 大中小`);
            }
            if (weapon.rarity == 6 && strength != '大') {
                console.log(`weapon ${weapon.name} is ${weapon.rarity} star but attribute ${attribute}'s strength part ${strength} is not 大`);
            }
            if (weapon.rarity == 5 && strength != '中') {
                console.log(`weapon ${weapon.name} is ${weapon.rarity} star but attribute ${attribute}'s strength part ${strength} is not 中`);
            }
            if (weapon.rarity == 4 && strength != '小') {
                console.log(`weapon ${weapon.name} is ${weapon.rarity} star but attribute ${attribute}'s strength part ${strength} is not 小`);
            }
        } else if (cat == 3) {
            if (kind.length != 2) {
                console.log(`weapon ${weapon.name} attribute ${attribute} is not length 2`);
            }
            // collect cat 3 to see whether they will duplicate, will they?
            // exclude rarity 3, they are really same, ok, rarity 4 also have duplicates
            if (weapon.rarity != 3 && weapon.rarity != 4) {
                if (allCat3Strengths.includes(strength)) {
                    console.log(`weapon ${weapon.name} attribute ${attribute} has duplicate strength`);
                } else {
                    allCat3Strengths.push(strength);
                }
            }
        }
    }
}
// console.log(kindsFromWeapon);

const kindsFromSpace: [string[], string[], string[]] = [[], [], []];
for (const space of AllSapces) {
    if (space.cat1.length != 5) {
        console.log(`space ${space.name} cat1 length not 5`);
    }
    if (space.cat2.length != 8) {
        console.log(`space ${space.name} cat2 length not 8`);
    }
    if (space.cat3.length != 8) {
        console.log(`space ${space.name} cat3 length not 8`);
    }

    for (const [cat, names] of [[1, space.cat1], [2, space.cat2], [3, space.cat3]] as [number, string[]][]) {
        for (let index = 0; index < names.length; index += 1) {
            const issue = NameIssues.find(i => i.incorrects.includes(names[index]));
            if (issue) {
                console.log(`fix space ${space.name} attribute ${names[index]} to be ${issue.correct}`);
                names[index] = issue.correct;
            }
            if (!kindsFromSpace[cat - 1].includes(names[index])) {
                kindsFromSpace[cat - 1].push(names[index]);
            }

            // a few similar to weapon validation
            if (cat == 1 || cat == 2) {
                if (!names[index].endsWith('提升')) {
                    console.log(`space ${space.name} attribute ${names[index]} does not end with 提升`);
                }
            } else if (cat == 3) {
                if (names[index].length != 2) {
                    console.log(`weapon ${space.name} attribute ${names[index]} is not length 2`);
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
        console.log(`category ${cat} existing in weapon but not exist in space: ${fromWeaponButNotFromSpace.join(', ')}`);
    }
    const fromSpaceButNotFromWeapon = fromSpace.filter(n => !fromWeapon.includes(n));
    if (fromSpaceButNotFromWeapon.length) {
        console.log(`category ${cat} existing in space but not exist in weapon: ${fromSpaceButNotFromWeapon.join(', ')}`);
    }
    console.log(`cat${cat}(${fromWeapon.length}):`, fromWeapon.join(', '));
}

// try check no same name between categories
for (const [cat1, cat2] of [[1, 2], [2, 3]]) {
    const duplicates = kindsFromSpace[cat1 - 1].filter(n => kindsFromSpace[cat2 - 1].includes(n));
    if (duplicates.length) {
        console.log(`names appear in both cat${cat1} and cat${cat2}: ${duplicates.join(', ')}`);
    }
}

// check all names have appeared multiple times
// now after confirm no duplicates between categories, you can 
for (const cat of [1, 2, 3]) {
    const weaponsAllKinds = AllWeapons.flatMap(w => w.attributes ?? []).map(a => a.split('·')[0]);
    const spaceAllNames = AllSapces.flatMap(s => [s.cat1, s.cat2, s.cat3].flat());
    for (const name of kindsFromSpace[cat - 1]) {
        const count = weaponsAllKinds.filter(n => n == name).length;
        if (count == 1) {
            console.log(`!!name ${name} only appear in weapons once`);
        }
        const count2 = spaceAllNames.filter(n => n == name).length;
        if (count2 == 1) {
            console.log(`!!name ${name} only appear in spaces once`);
        }
        // console.log(`name ${name} times ${count} + ${count2}`);
    }
}

for (const progress of AllProgress) {
    const weapon = AllWeapons.find(w => w.name == progress.name);
    if (!weapon) {
        console.log(`unknown weapon name ${progress.name} in progress`);
        continue;
    }
    if (weapon.rarity != 5 && weapon.rarity != 6) {
        console.log(`why are you interested in this low rarity weapon ${weapon.name} ${weapon.rarity}?`);
    }
}

// seems validation ends here

// first, try generate full plan
// all 5/6 weapons not listed in progress is need to acquire essence

// complete plan, regardless of progress,
// try make have-progress only reduces priority
const allRequiredWeapons = AllWeapons.filter(w => w.rarity == 5 || w.rarity == 6);
// group by skill
const groups = allRequiredWeapons.reduce<Record<string, WeaponData[]>>(
    (acc, w) => { (acc[w.attributes[2].split('·')[0]] ??= []).push(w); return acc; }, {});
for (const [skill, weapons] of Object.entries(groups)) {
    // then group by space
    const spaceGroups = weapons.reduce<Record<string, WeaponData[]>>((acc, w) => {
        const spaces = AllSapces.filter(s => 
            s.cat1.includes(w.attributes[0].split('·')[0])
            && s.cat2.includes(w.attributes[1].split('·')[0])
            && s.cat3.includes(w.attributes[2].split('·')[0]));
    
        // see how many space-weapon pairs are skill match but rejected by cat1 and cat2
        const skillMatchSpaces = AllSapces.filter(s => s.cat3.includes(w.attributes[2].split('·')[0]));
        const rejectedSpaces = skillMatchSpaces.filter(s => !spaces.some(f => f.name == s.name));
        // console.log(`weapon ${w.name} is rejected by cat1 and cat2 in ${rejectedSpaces.map(s => s.name)}`);

        spaces.forEach(s => (acc[s.name] ??= []).push(w));
        return acc;
    }, {});
    for (const [spacename, weapons] of Object.entries(spaceGroups)) {
        const cat1set = weapons.map(w => w.attributes[0].split('·')[0]).filter((e, i, a) => a.indexOf(e) == i);
        console.log(`${spacename}-${skill}(${weapons.length}): ${weapons.map(w => w.name)}, cat1set: ${cat1set}`);
    }
}
