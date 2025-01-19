# quality calculation in the game factorio

# as of in loop pattern
# assembly machine (or electromagnetic plant or foundry, all called assembly machine below) with quality 1 recipe use speed module or quality module
# and send low quality product to recycler with quality module and use result ingredients to produce corresponding quality level product,
# with quality module on the assembly machine, if result in low quality product, send to recycler again, and finally collect the desired qulity level product

# the most precise calculation involves in infinite series calculation, but in real world,
# recycler returns 25% of the ingredients and highest quality module quality chance is 6.2%,
# which results in at most 31% percent of one-level-higher result in assembly machine (electromagnetic plant have 5 slots)
# and at most 6.2% percent of one-level-higher result in recycler, the number quickly goes down over 1/10000 and is meaningless in real world
# so this implementation will go over likely 10 cycles and claim it as complete

# ignore index 0 to make index match quality level number
_ = 0

# researched level 5
research5 = 0

# quality module quality chance
# I'm currently using quality 4 quality modules and is 4.7% quality chance
# this is currently fixed util I researched the final level
mod = lambda i : i * (0.062 if research5 else 0.047)

# recycle recipe is always at 0.25 rate
recycle_rate = 0.25
# recycler have 4 slots
recycler_chance = mod(4)

# level lower than this is discarded
target_level = 4

# assembly machine and foundry have 4 slots, em plant have 5 slots, centrifuge have 2 slots
assembly_machine_slots = 5
# assembly machines other than assembly machine have builtin productivity
assembly_machine_builtin_productivity = 0.5
# speed module'd quality 1 recipe assembly machine is more commonly used in my current design
assembly_1_use_quality = True
# level 1 assembly machine can have productivity module to produce more products with less ingredients
assembly_1_productivity = 0
# final level of assembly machine does not need quality module, use productivity module to get more
assembly_final_productivity = 0.76 # 0.76

# RECORDED RESULTS:
# standard assembly machine recipe
#    no 5, slot 4, speed 1, target 3, final productivity 0 => 3: 0.0168, 4: 0.0034
#    5, slot 4, speed 1, target 3, fp 0: 3: 0.025557, 4: 0.004839, 5: 0.000114
#    5, slot 4, speed 1, target 5, fp 0 => 5: 0.000177
#    5, slot 4, speed 1, target 5, fp 1 => 5: 0.000354
# centrifuge for nuclear fuel
#    no 5, slot 2, speed 1, target 3, fp 0 => 3: 0.0125, 4: 0.0022
#    no 5, slot 2, speed 1, target 3, fp 0.76 => 3: 0.0125, 4: 0.0029
#    # ??? slot 2 have more level 5 than slot 4?,
#    # because assembly machine have lower chance than recycler, for level 5, that's better leave it to recycler to upgrade level
#    5, slot 2, speed 1, target 3, fp 0: 3: 0.018724, 4: 0.003088, 5: 0.000121
#    5, slot 2, speed 1, target 5, fp 0 => 5: 0.000162
#    5, slot 2, speed 1, target 5, fp 1 => 5: 0.000324
# speed module itself
#    no 5, slot 5, speed 1, target 3, fp 0: 3: 0.018904, 4: 0.004017

# TOPICS
# 1. if I try to discard level 3 in module production, how is it improved
#   but first, 0. add fp 0.76 to module production
#   R: no 5, slot 5, speed 1, target 3, fp 0.76: 3: 0.018904, 4: 0.004637
#   increase level 4 production by 6/10000, that's 2 more in AN HOUR
#   R: no 5, slot 5, speed 1, target 4, fp 0.76: 4: 0.00589
#   based on current 1.24/s level 1 production capibility, that's 20.7/h => 26.3h, without the 84/h level 3 production 
# 2. final final speed module production
#   R: 5, slot 5, speed 1, target 5, fp 1: 5: 0.000369
#   currently I'd expect level 5 tower and level 5 speed module to update speed module level 1 capibility to 2/s
#   comparing to old world's 0.27/s final final speed module production, that's 0.27% (27/10000) of the old world number
# 3. level 1 style
#   R: no 5, slot 4, speed 1, target 3, fp 0.76: 3: 0.016834, 4: 0.004068
#   R: no 5, slot 4, quality 1, target 3, fp 0.76: 3: 0.049969, 4: 0.010265
#   now speed 1 is not an option
# 4. upgrade to quality 1
#   R: 5, slot 4, quality 1, target 5, fp 1: 5: 0.00087
#   R: 5, slot 5, quality 1, target 5, fp 1: 5: 0.001023
#   R: 5, slot 2, quality 1, target 5, fp 1: 5: 0.000573
#   R: no 5, slot 5, quality 1, target 4, fp 0.76: 4: 0.016984
#   for module production, it is literally level 3 production before,
#   **but**, I'm currently using 1 level 1 assembly machine to achieve 1.24/s productivity
#   speed module base recipe is 60s, you need like 20 quality'd machines for that, ground use rate is a lose(
# 5. correction, emplant have 0.5 productivity at all level
#   R: no 5, slot 5, bp 0.5, speed 1, target 3, fp 0:      3: 0.054825, 4: 0.011926 # module production current in game configuration
#   R: no 5, slot 5, bp 0.5, speed 1, target 3, fp 0.76:   3: 0.054825, 4: 0.013813 # add fp
#   R: no 5, slot 5, bp 0.5, quality 1, target 3, fp 0.76: 3: 0.140285, 4: 0.032765 # change to quality 1
#   R: no 5, slot 5, bp 0.5, quality 1, target 4, fp 0.76:              4: 0.048121 # now discard level 3, 626/h + 146/h => 214/h
#                                                                                   # now comparable to old world final speed 972/h

# assembly machine quality chance for each quality level
assembly_chance = [_,
    mod(assembly_machine_slots) if assembly_1_use_quality else 0,
    mod(assembly_machine_slots),
    mod(assembly_machine_slots),
    mod(assembly_machine_slots) if research5 else 0, # when not researched 5, quality module on level 4 is machine is meaningless
    0,
]

if assembly_1_use_quality and assembly_1_productivity:
    raise 'cannot quality and productivity level 1 at the same time'

# all of the following calculations use 1 quality 1 product produce capability as base value,
# produce capability is the in game displayed productivity displayed on the detailed information of an assembly machine
# if you use speed module'd quality 1 recipe assembly machine, all of the product is quality 1,
# if you use quality module'd quality 1 recipe assembly machine, some of the product will be higher quality,
# but they are all 1 quality 1 product produce capibility
# speed is irrelavent here, or you can regard this 1 as 1/s here

# an iteration starts with some amount of ingredients of each quality level
# and all of the ingredients are used by each level of assembly machines and results in multiple levels of product
# and the not needed low level products are recyled in recyler, results in multiple levels of ingredients
# the ingredients here are virtual, and is regarded as balanced if there are multiple ingredients
# in real world seems not balanced, but I have not collected enough information to confirm or disproof

# UPDATE: according to https://wiki.factorio.com/quality,
# for assembly machine quality chance Q, it alway produces 1 - Q same level product,
# while 2 level higher products's 0.1 * Q is actually subtracted from 1 level higher products
# I was expecting 2 level higher product's 0.1 * Q is subtracted from same level products previously
# that results in at least 10% percent more 1 level higher items calculated
# now I find some reason for the calculation mismatch in the game

# input array of length 6, output strip first item and round to 4 decimal places
def display(vs):
    return [round(v, 6) for v in vs[1:]]

# if one iteration produces less than 0.0001, it is regarded as complete
eps = 0.000001

# start with 1 unit of quality level ingredient
iteration = 0
ingredients = [_, 1, 0, 0, 0, 0]
final_products = [_, 0, 0, 0, 0, 0]

while True:
    iteration += 1
    print(f'iteration#{iteration}')
    print(f'   input {display(ingredients)}')

    products = [_, 0, 0, 0, 0, 0]
    if not research5:
        # level 1 assembly machine
        products[1] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[1]) * (1 + assembly_1_productivity)
        products[2] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.9
        products[3] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.09
        products[4] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.01
        # level 2 assembly machine
        products[2] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[2])
        products[3] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.9
        products[4] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.1
        # level 3 assembly machine
        products[3] += ingredients[3] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[3])
        products[4] += ingredients[3] * (1 + assembly_machine_builtin_productivity) * assembly_chance[3]
        # level 4 assembly machine
        products[4] += ingredients[4] * (1 + assembly_machine_builtin_productivity) * (1 + assembly_final_productivity)
    else:
        # level 1 assembly machine
        products[1] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[1]) * (1 + assembly_1_productivity)
        products[2] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.9
        products[3] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.09
        products[4] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.009
        products[5] += ingredients[1] * (1 + assembly_machine_builtin_productivity) * assembly_chance[1] * 0.001
        # level 2 assembly machine
        products[2] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[2])
        products[3] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.9
        products[4] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.09
        products[5] += ingredients[2] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.01
        # level 3 assembly machine
        products[3] += ingredients[3] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[3])
        products[4] += ingredients[3] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.9
        products[5] += ingredients[3] * (1 + assembly_machine_builtin_productivity) * assembly_chance[2] * 0.1
        # level 4 assembly machine
        products[4] += ingredients[4] * (1 + assembly_machine_builtin_productivity) * (1 - assembly_chance[4])
        products[5] += ingredients[4] * (1 + assembly_machine_builtin_productivity) * assembly_chance[4]
        # level 5 assembly machine
        products[5] = ingredients[5] * (1 + assembly_machine_builtin_productivity) * (1 + assembly_final_productivity)

    complete = products[1] < eps and products[2] < eps and products[3] < eps and products[4] < eps and products[5] < eps
    print(f'   product {display(products)}{' (complete)' if complete else ''}')
    
    # recycle low level product,
    ingredients = [_, 0, 0, 0, 0, 0]

    if not research5:
        if target_level > 1: # level 1 recycle
            ingredients[1] += products[1] * recycle_rate * (1 - recycler_chance)
            ingredients[2] += products[1] * recycle_rate * recycler_chance * 0.9
            ingredients[3] += products[1] * recycle_rate * recycler_chance * 0.09
            ingredients[4] += products[1] * recycle_rate * recycler_chance * 0.01
            products[1] = 0
        if target_level > 2: # level 2 recycle
            ingredients[2] += products[2] * recycle_rate * (1 - recycler_chance)
            ingredients[3] += products[2] * recycle_rate * recycler_chance * 0.9
            ingredients[4] += products[2] * recycle_rate * recycler_chance * 0.1
            products[2] = 0
        if target_level > 3: # level 3 recycle
            ingredients[3] += products[3] * recycle_rate * (1 - recycler_chance)
            ingredients[4] += products[3] * recycle_rate * recycler_chance * 0.1
            products[3] = 0
        if target_level > 4:
            raise 'cannot discard level 4 when not researched level 5, that\'s nothing'
    else:
        if target_level > 1: # level 1 recycle
            ingredients[1] += products[1] * recycle_rate * (1 - recycler_chance)
            ingredients[2] += products[1] * recycle_rate * recycler_chance * 0.9
            ingredients[3] += products[1] * recycle_rate * recycler_chance * 0.09
            ingredients[4] += products[1] * recycle_rate * recycler_chance * 0.009
            ingredients[5] += products[1] * recycle_rate * recycler_chance * 0.001
            products[1] = 0
        if target_level > 2: # level 2 recycle
            ingredients[2] += products[2] * recycle_rate * (1 - recycler_chance)
            ingredients[3] += products[2] * recycle_rate * recycler_chance * 0.9
            ingredients[4] += products[2] * recycle_rate * recycler_chance * 0.09
            ingredients[5] += products[2] * recycle_rate * recycler_chance * 0.01
            products[2] = 0
        if target_level > 3: # level 3 recycle
            ingredients[3] += products[3] * recycle_rate * (1 - recycler_chance)
            ingredients[4] += products[3] * recycle_rate * recycler_chance * 0.09
            ingredients[5] += products[3] * recycle_rate * recycler_chance * 0.01
            products[3] = 0
        if target_level > 4: # level 4 recycle
            ingredients[4] += products[4] * recycle_rate * (1 - recycler_chance)
            ingredients[5] += products[4] * recycle_rate * recycler_chance * 0.1
            products[4] = 0

    print(f'   recycle {display(ingredients)}')

    final_products = [final_products[i] + products[i] for i in range(6)]
    print(f'   final product {display(final_products)}')

    if complete or iteration >= 20:
        break

report = 'R: '
report += '5, ' if research5 else 'no 5, '
report += f'slot {assembly_machine_slots}, bp {assembly_machine_builtin_productivity}, '
report += 'quality 1, ' if assembly_1_use_quality else 'speed 1, '
report += f'target {target_level}, '
report += f'fp {assembly_final_productivity}: '
for i in range(1, 6):
    if final_products[i] > eps:
        report += f'{i}: {round(final_products[i], 6)}, '
report = report[:-2]
print(report)
