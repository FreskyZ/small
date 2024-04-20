# load synthesis operator data from a mysterious site,
# that site is not convenient to use, so load data and create my own

from typing import NamedTuple, Callable
import json, urllib.request

# step1 download all operators.json
# urllib.request.urlretrieve('http://xingjian.zsawqe.com/json/all/all.json', 'all(raw).json')

# step2 normalize
# with open('all(raw).json') as operators_file:
#     raw_operators = operators_file.read()
#     raw_operators = json.loads(raw_operators)
# rarities = [0, 0, 0, 0, 0, 0, 0, 0] # count group by rarity, validate against another redundent file provided by that site
# operators = []
# for _, operator in raw_operators.items():
#     # print(operator['id'], operator['name'], operator['msg']['CharacterDesignId'], operator['msg']['CharacterDesignName'], operator['msg']['Rarity'])
#     info = operator['msg']
#     info['id'] = int(info['CharacterDesignId'])
#     del info['CharacterDesignId']
#     info['name'] = info['CharacterDesignName']
#     del info['CharacterDesignName']
#     info['rarity'] = info['Rarity']
#     del info['Rarity']
#     info['rarity_level'] = { 'Common': 1, 'Elite': 2, 'Unique': 3, 'Epic': 4, 'Hero': 5, 'Special': 6, 'Legendary': 7 }[info['rarity']]
#     rarities[info['rarity_level']] += 1
#     operators.append(operator['msg'])
# print(rarities)
# with open('all.json', 'w') as operators_file:
#     json.dump(operators, operators_file)

# step3: download synthesis data
# operators: { id, name, rarity_level }[]
# with open('all.json') as f:
#     operators = json.loads(f.read())
# all_recipes = set() # (from1: int, from2: int, to: int)
# for operator in operators:
#     # rarity 1 cannot be synthed, rarity 6 cannot synth or be synthed, rarity 7 cannot synth
#     if operator['rarity_level'] not in (6, 7):
#         print(f'downloading from/{operator["id"]}.json')
#         with urllib.request.urlopen(f'http://xingjian.zsawqe.com/json/from/{operator["id"]}.json') as f:
#             recipes = json.loads(f.read())
#             if 'Prestige' in recipes:
#                 for recipe in recipes['Prestige']:
#                     r = recipe['_attributes']
#                     all_recipes.add((int(r['CharacterDesignId1']), int(r['CharacterDesignId2']), int(r['ToCharacterDesignId'])))
#     if operator['rarity_level'] not in (1, 6):
#         print(f'downloading to/{operator["id"]}.json')
#         with urllib.request.urlopen(f'http://xingjian.zsawqe.com/json/to/{operator["id"]}.json') as f:
#             recipes = json.loads(f.read())
#             if 'Prestige' in recipes:
#                 for recipe in recipes['Prestige']:
#                     r = recipe['_attributes']
#                     all_recipes.add((int(r['CharacterDesignId1']), int(r['CharacterDesignId2']), int(r['ToCharacterDesignId'])))
# with open('craft.json', 'w') as f:
#     json.dump([r for r in all_recipes], f)

# step3.1 dedup recipes
# with open('craft(dup).json') as f:
#     recipes = json.loads(f.read())
# recipes = set((r[0], r[1], r[2]) for r in recipes)
# print(len(recipes))
# with open('craft.json', 'w') as f:
#     json.dump([r for r in recipes], f)

# step 4: use data at command line for now
# with open('craft.json') as f:
#     recipes = json.loads(f.read())
# with open('all.json') as f:
#     operators = json.loads(f.read())
# print(f'operators: {len(operators)}, crafts: {len(recipes)}')
# template = input('> ')
# while template != 'exit' and template != '再见':
#     # ? for querying
#     left, into_name = template.split('=')
#     from1_name, from2_name = left.split('+')
#     from1_name, from2_name, into_name = from1_name.strip(), from2_name.strip(), into_name.strip()
#     # empty for querying
#     from1_ids = [op['id'] for op in operators if from1_name in op['name']] if from1_name != '？' else []
#     from2_ids = [op['id'] for op in operators if from2_name in op['name']] if from2_name != '？' else []
#     into_ids = [op['id'] for op in operators if into_name in op['name']] if into_name != '？' else []
#     matches = [r for r in recipes if (r[0] in from1_ids or not len(from1_ids)) and (r[1] in from2_ids or not len(from2_ids)) and (r[2] in into_ids or not len(into_ids))]
#     if not len(matches):
#         print('not found')
#     else:
#         for from1_id, from2_id, into_id in matches:
#             from1 = next(op for op in operators if op['id'] == from1_id)
#             from2 = next(op for op in operators if op['id'] == from2_id)
#             into = next(op for op in operators if op['id'] == into_id)
#             print(f'{into["name"]}({into["rarity_level"]},{into["SpecialAbilityType"]}) = {from1["name"]}({from1["rarity_level"]},{from1["SpecialAbilityType"]}) + {from2["name"]}({from2["rarity_level"]},{from2["SpecialAbilityType"]})')
#     template = input('> ')

# step 4 alternative: more complex queries directly write here
# class Operator(NamedTuple):
#     name: str
#     rarity: int
#     ability: str
# class Recipe(NamedTuple):
#     f1: Operator
#     f2: Operator
#     to: Operator
# with open('all.json') as f:
#     operators = json.loads(f.read())
# with open('craft.json') as f:
#     recipes = json.loads(f.read())
#     recipes.sort(key=lambda r: (r[2], r[0], r[1]))
# operators = { op['id']: Operator(op['name'], op['rarity_level'], op['SpecialAbilityType']) for op in operators }
# recipes = [Recipe(operators[r[0]], operators[r[1]], operators[r[2]]) for r in recipes]
# print(f'{len(operators)} operators, {len(recipes)} recipes')

# def query(title: str, predicate: Callable[[Recipe], bool]):
#     print(title + ': ', end='')
#     matches = [r for r in recipes if predicate(r)]
#     if len(matches):
#         print()
#         for m in matches:
#             print(f'{m.to.name}({m.to.rarity},{m.to.ability}) = {m.f1.name}({m.f1.rarity},{m.f1.ability}) + {m.f2.name}({m.f2.rarity},{m.f2.ability})')
#         print(f'{len(matches)} matches')
#     else:
#         print('not found')

# query('count of 7', lambda r: r.to.rarity == 7) # RESULT: 5929
# query('7 not from 5', lambda r: r.to.rarity == 7 and (r.f1.rarity != 5 or r.f2.rarity != 5)) # RESULT: NO
# query('5 not from 4', lambda r: r.to.rarity == 5 and (r.f1.rarity != 4 or r.f2.rarity != 4)) # RESULT: NO
# query('4 not from 3', lambda r: r.to.rarity == 4 and (r.f1.rarity != 3 or r.f2.rarity != 3)) # RESULT: NO
# query('to rare 7 fire', lambda r: r.to.name == '银河炼金术士')
# query('to set fire', lambda r: r.to.ability == 'SetFire')

# query('my operators', lambda r: r.to.name == '银河炼金术士' and (r.f1.name == '石头人' or r.f2.name == '石头人'))
# query('my operators', lambda r: r.f1.name == '简小姐' or r.f2.name == '简小姐')

# expr = input('> ')
# while expr != '再见':
#     query('custom', lambda r: eval(expr))
#     expr = input('> ')

# step 5: minimize 2 files to use in website, before: 571kb + 298kb, after: 23kb + 181kb

with open('all.json') as f:
    operators = json.loads(f.read())
with open('craft.json') as f:
    recipes = json.loads(f.read())

skill_map = [
    (0, "None", "无"),
    (1, 'DeductReload', '系统骇入'),
    (2, "HealSelfHp", "紧急自救"),
    (3, "HealSameRoomCharacters", "天降甘霖"),
    (4,  "AddReload", "紧急加速"),
    (5, "DamageToRoom", "超级拆迁"),
    (6, "HealRoomHp", "紧急修复"),
    (7, "DamageToSameRoomCharacters", "毒气"),
    (8, "DamageToCurrentEnemy", "致命一击"),
    (9, "FireWalk", "烈焰足迹"),
    (10, "Freeze", "冻结冲击"),
    (11, "Bloodlust", "血之渴望"),
    (12, "SetFire", "纵火"),
    (13, "ProtectRoom", "静电护盾"),
    (14, "Invulnerability", "相位闪现"),
]
def map_skill(name):
    return next(s for s in skill_map if s[1] == name)[0]
min_operators = [{ k: v for k, v in {
    'id': op['id'],
    'name': op['name'],
    'rarity': op['rarity_level'],
    'skill': map_skill(op['SpecialAbilityType']),
}.items() if v } for op in operators]
min_operators.sort(key=lambda op: op['id'])
min_recipes = {}
for from1, from2, target in recipes:
    if target not in min_recipes:
        min_recipes[target] = []
    min_recipes[target].append((from1, from2) if from1 <= from2 else (from2, from1))

with open('operators.json', 'w') as f:
    json.dump(min_operators, f, ensure_ascii=False, separators=(',', ':'))
with open('recipes.json', 'w') as f:
    json.dump([{ 'target': target, 'recipes': ingredients } for target, ingredients in min_recipes.items()], f, separators=(',', ':'))
