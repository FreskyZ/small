from util import *

TargetAmounts = {
    Items.Hay: 100000,
    Items.Wood: 1000000,
    Items.Carrot: 100000,
    Items.Pumpkin: 600000,
    Items.Weird_Substance: 200000,
    Items.Cactus: 600000,
    Items.Gold: 0,
    # try keep power above this amount,
    # or in other words, plant sunflower need this amount of power
    # also for large operations that may spend many power before next loop finding power outage
    Items.Power: 2000,
}

RetainWaterAmount = 100 # set this to a large number to disable watering
RetainFertilizerAmount = 100
postproceess_ground = get_postproceess_ground(
    RetainWaterAmount, RetainFertilizerAmount, TargetAmounts[Items.Weird_Substance])

# initial collect
# assumption: for now plants grow really fast than drown scan the full farmland
# return position (x, y) to (get_entity_type(), can_harvest(), measure())
def collect_current_entities():
    current_entities = {} # position (x, y) to entity type
    def initial_collect(coordinate):
        current_entities[coordinate] = (get_entity_type(), can_harvest(), measure())
    foreach_with(initial_collect)
    return current_entities

# this is not available for now
CurrentProductLevels = {
    Items.Hay: 2 ** (num_unlocked(Unlocks.Grass) - 1),
    Items.Wood: 2 ** (num_unlocked(Unlocks.Trees) - 1),
    Items.Carrot: 2 ** (num_unlocked(Unlocks.Carrots) - 1),
    Items.Pumpkin: 2 ** (num_unlocked(Unlocks.Pumpkins) - 1),
    Items.Power: 1, # no upgrade for this
    Items.Cactus: 2 ** (num_unlocked(Unlocks.Cactus) - 1),
}
# by including planted entities, select which entity need most
# note this does not count larget pumpkin, this automatically considers dead pumpkin as empty
# return item type | 'large-pumpkin' | 'harvest-sunflower' | 'sort-cactus', if no requirement, 'halt'
def select_workflow(current_entities):

    pumpkin_count = 0 # pumpkin or dead_pumpkin
    sunflower_count = 0
    cactus_count = 0
    for position in get_all_coordinates():
        if current_entities[position][0] in (Entities.Pumpkin, Entities.Dead_Pumpkin):
            pumpkin_count += 1
        if current_entities[position][0] == Entities.Sunflower:
            sunflower_count += 1
        if current_entities[position][0] == Entities.Cactus:
            cactus_count += 1

    # comparing to day1, current workflow will always full plant, so check for full is enougth
    if pumpkin_count == get_world_size() ** 2:
        return 'large-pumpkin'
    # sunflower workflow is decided by more than 10 sunflowers
    if sunflower_count >= 10:
        return 'harvest-sunflower' # use this to distinguish "not enough power" normal sunflower workflow
    # similar to pumpkin condition
    if cactus_count == get_world_size() ** 2:
        return 'sort-cactus'

    # power should not share same unit as normal plant items, it has higher priority
    if num_items(Items.Power) < TargetAmounts[Items.Power]:
        return Items.Power
    # gold does not need count current entities
    if num_items(Items.Gold) < TargetAmounts[Items.Gold]:
        return Items.Gold

    result_item, result_amount = 'halt', 0
    for item in PlantItems:
        current_amount = num_items(item)
        for position in get_all_coordinates():
            if current_entities[position][0] != None and EntityToItem[current_entities[position][0]] == item:
                current_amount += CurrentProductLevels[item]
                if current_entities[position][0] == Entities.Tree:
                    current_amount += CurrentProductLevels[item] * 4
        if TargetAmounts[item] - current_amount > result_amount:
            result_item, result_amount = item, TargetAmounts[item] - current_amount
    return result_item

# grass grows too fast to navigate through the field to plant
def grass_workflow(_context):
    # move to 3,3 to increase the possibility that it accidentally meets companion requirement
    move_to((3, 3))
    till_for(Entities.Grass)
    while num_items(Items.Hay) < TargetAmounts[Items.Hay]:
        if get_entity_type() in (None, Entities.Dead_Pumpkin) or can_harvest() and harvest():
            plant(Entities.Grass)
            # postproceess_ground() # seems no need postprocess
        if num_items(Items.Power) < TargetAmounts[Items.Power]:
            break # break when power outage
        # do_a_flip()

# simple plant for carrot, pumpkin, sunflower and cactus
PlainPlants = {
    Items.Carrot: Entities.Carrot,
    Items.Pumpkin: Entities.Pumpkin,
    Items.Power: Entities.Sunflower,
    Items.Cactus: Entities.Cactus,
}
def plain_workflow(context):
    entity = PlainPlants[context[0]]
    result_entities = {}
    def action(coordinate):
        if get_entity_type() in (None, Entities.Dead_Pumpkin) or can_harvest() and harvest():
            till_for(entity)
            plant(entity)
            postproceess_ground()
            # assumption: for now everything grows very fast and can regard as can harvest at next loop
            result_entities[coordinate] = (entity, True, measure())
        else:
            result_entities[coordinate] = (get_entity_type(), can_harvest(), measure())
    foreach_with(action)
    # cannot know pumpkin
    if entity == Entities.Carrot:
        # no known state for carrot, or else this is infinite carrot
        # pumpkin, sunflower and cactus have known state to use harvest workflow, carrot does not have that
        return ('known', result_entities)
    if entity == Entities.Pumpkin:
        return ('known-state', 'large-pumpkin')
    if entity == Entities.Sunflower:
        return ('known-entities-and-state', result_entities, 'harvest-sunflower')
    if entity == Entities.Cactus:
        return ('known-entities-and-state', result_entities, 'sort-cactus')

# plant tree when no sibling is tree
def wood_workflow(_context):
    result_entities = {}
    def action(coordinate):
        if get_entity_type() in (None, Entities.Dead_Pumpkin) or can_harvest() and harvest():
            till_for(Entities.Tree) # both support soil
            if (coordinate[0] + coordinate[1]) % 2 == 0:
                plant(Entities.Tree)
                result_entities[coordinate] = (Entities.Tree, True, None)
            else:
                plant(Entities.Bush)
                result_entities[coordinate] = (Entities.Bush, True, None)
            postproceess_ground()
        # else do nothing
    foreach_with(action)
    return ('known', result_entities)

# merge complete field into one large pumpkin
def large_pumpkin_workflow(context):
    dead_positions = [] # array of coordinates
    # context[1] is entities witch is position => (entity type, can harvest, measure)
    for position in get_all_coordinates():
        if context[1][position][0] == Entities.Dead_Pumpkin:
            dead_positions.append(position)
    recovered_positions = []
    while len(dead_positions) != len(recovered_positions):
        # dead position may again be dead position, so scan through them
        for position in dead_positions:
            if position not in recovered_positions:
                move_to(position)
                if get_entity_type() == Entities.Pumpkin and can_harvest():
                    recovered_positions.append(position)
                elif get_entity_type() == Entities.Dead_Pumpkin:
                    till_for(Entities.Pumpkin)
                    plant(Entities.Pumpkin)
                    postproceess_ground()
                # else growing
    harvest() # complete!
    return ('empty',)

# harvest sunflower in piece amount order, this workflow does not plant
def harvest_sunflower_workflow(context):
    # context[1] is entities witch is position => (entity type, can harvest, measure)
    # this is unexpectedly simple
    for piece in range(15, 6, -1):
        for position in get_all_coordinates():
            if context[1][position][2] == piece:
                move_to(position)
                harvest()
    return ('empty',)

# sort and harvest, this workflow does not plant
# this only happens when already full plant cactus
def sort_cactus_workflow(_context):
    values = {} # position => size
    def collect(coordinate):
        global values
        values[coordinate] = measure()
    foreach_with(collect)
    # the solution is bubble unsorted items in both direction
    size = get_world_size()
    # first bubble to bottom inside all columns, then bubble to left inside all rows
    for x in range(size):
        for y in range(size):
            cx, cy = x, y
            move_to((x, y))
            while cy > 0 and values[(cx, cy)] < values[(cx, cy - 1)]:
                swap(Bottom)
                move(Bottom)
                values[(cx, cy)], values[(cx, cy - 1)] = values[(cx, cy - 1)], values[(cx, cy)]
                cy -= 1
    for y in range(size):
        for x in range(size):
            cx, cy = x, y
            move_to((x, y))
            while cx > 0 and values[(cx, cy)] < values[(cx - 1, cy)]:
                swap(Left)
                move(Left)
                values[(cx, cy)], values[(cx - 1, cy)] = values[(cx - 1, cy)], values[(cx, cy)]
                cx -= 1
    # not sure whether this sort is ok, validate
    for x in range(size):
        for y in range(size):
            if x < size - 1 and values[(x, y)] > values[(x + 1, y)]:
                while True:
                    do_a_flip()
                    print("not sorted at ", x, ",", y, ", right direction")
            if y < size - 1 and values[(x, y)] > values[(x, y + 1)]:
                while True:
                    do_a_flip()
                    print("not sorted at ", x, ",", y, ", top direction")
    harvest() # complete!
    return ('empty',)

def maze_workflow(context):
    move_to((0, 0))
    if can_harvest():
        harvest()
    till_for(Entities.Bush)
    plant(Entities.Bush)
    while not can_harvest():
        pass
    size = get_world_size()
    use_item(Items.Weird_Substance, size * 2 ** (num_unlocked(Unlocks.Mazes) - 1))
    treasure_position = measure()
    walls = [] # list of (coordinate, direction), wall is at direction of coordinate
    

# the workflow functions
# accept a parameter as workflow context, for now,
#    context[0] is workflow name (the item or workflow name)
#    context[1] is current entities
# return a result, for now,
#    result[0] == 'empty' indicating field empty
#    result[0] == 'known' will provide a known current_entities at result[1]
#    result[0] == 'known-state' will provide a workflow_name at result[1]
#    result[0] == 'known-entities-and-state' will provide a known current_entities at [1] and known workflow_name at [2]
Workflows = {
    Items.Hay: grass_workflow,
    Items.Wood: wood_workflow,
    Items.Carrot: plain_workflow,
    Items.Pumpkin: plain_workflow,
    'large-pumpkin': large_pumpkin_workflow,
    Items.Power: plain_workflow, # sunflower itself is normal workflow
    'harvest-sunflower': harvest_sunflower_workflow,
    Items.Cactus: plain_workflow,
    'sort-cactus': sort_cactus_workflow,
    Items.Gold: maze_workflow,
}

# main loop
change_hat(Hats.Cactus_Hat)
current_entities_indication = None
workflow_name_indication = None
while True:
    if current_entities_indication != None:
        current_entities = current_entities_indication
    else:
        current_entities = collect_current_entities()
    if workflow_name_indication != None:
        workflow_name = workflow_name_indication
    else:
        workflow_name = select_workflow(current_entities)
    if workflow_name == 'halt':
        break
    workflow_result = Workflows[workflow_name]((workflow_name, current_entities))
    if workflow_result != None and len(workflow_result) > 0 and workflow_result[0] == 'empty':
        current_entities_indication = {}
        for position in get_all_coordinates():
            current_entities_indication[position] = (None, False, None)
        workflow_name_indication = None
    elif workflow_result != None and len(workflow_result) > 1 and workflow_result[0] == 'known':
        current_entities_indication = workflow_result[1]
        workflow_name_indication = None
    elif workflow_result != None and len(workflow_result) > 1 and workflow_result[0] == 'known-state':
        current_entities_indication = None
        workflow_name_indication = workflow_result[1]
    elif workflow_result != None and len(workflow_result) > 1 and workflow_result[0] == 'known-entities-and-state':
        current_entities_indication = workflow_result[1]
        workflow_name_indication = workflow_result[2]
    else:
        current_entities_indication = None
        workflow_name_indication = None
    pet_the_piggy()

while True:
    do_a_flip()
    pet_the_piggy()
    print('no requirement!')
