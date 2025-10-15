from util import *

TargetAmounts = {
    Items.Hay: 100000,
    Items.Wood: 500000,
    Items.Carrot: 100000,
    Items.Pumpkin: 100000,
    # try keep power above this amount,
    # or in other words, plant sunflower need this amount of power
    # also for large operations that may spend many power before next loop finding power outage
    Items.Power: 1000,
    Items.Weird_Substance: 100000,
    Items.Cactus: 100000,
}

RetainWaterAmount = 100 # set this to a large number to disable watering
RetainFertilizerAmount = 100
postproceess_ground = get_postproceess_ground(
    RetainWaterAmount, RetainFertilizerAmount, TargetAmounts[Items.Weird_Substance])

# initial collect
# assumption: for now plants grow really fast than drown scan the full farmland
# TODO consider merge with pumpkin workflow or harvest sunflower workflow's scan
def collect_current_entities():
    current_entities = {} # position (x, y) to entity type
    def initial_collect(coordinate):
        current_entities[coordinate] = get_entity_type()
    foreach_with(initial_collect)
    # quick_print(current_entities)
    return current_entities

# this is not available for now
CurrentProductLevels = {
    Items.Hay: 32,
    Items.Wood: 32,
    Items.Carrot: 32,
    Items.Pumpkin: 8,
    Items.Power: 1, # no upgrade for this
    Items.Cactus: 2,
}
# by including planted entities, select which entity need most
# note this does not count larget pumpkin, this automatically considers dead pumpkin as empty
# return item type | 'large-pumpkin' | 'harvest-sunflower' | 'sort-cactus', if no requirement, 'halt'
def select_workflow(current_entities):

    pumpkin_count = 0 # pumpkin or dead_pumpkin
    sunflower_count = 0
    cactus_count = 0
    for position in get_all_coordinates():
        if current_entities[position] in (Entities.Pumpkin, Entities.Dead_Pumpkin):
            pumpkin_count += 1
        if current_entities[position] == Entities.Sunflower:
            sunflower_count += 1
        if current_entities[position] == Entities.Cactus:
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

    result_item, result_amount = 'halt', 0
    for item in PlantItems:
        current_amount = num_items(item)
        for position in get_all_coordinates():
            if current_entities[position] != None and EntityToItem[current_entities[position]] == item:
                current_amount += CurrentProductLevels[item]
                if current_entities[position] == Entities.Tree:
                    current_amount += CurrentProductLevels[item] * 4
        if TargetAmounts[item] - current_amount > result_amount:
            result_item, result_amount = item, TargetAmounts[item] - current_amount
    return result_item

# grass grows too fast to navigate through the field to plant
def grass_workflow(_context):
    # move to 3,3 to increase the possibility that it accidentally meets companion requirement
    move_to((3, 3))
    while num_items(Items.Hay) < TargetAmounts[Items.Hay]:
        if get_entity_type() in (None, Entities.Dead_Pumpkin) or can_harvest() and harvest():
            till_for(Entities.Grass)
            plant(Entities.Grass)
            postproceess_ground()
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
            result_entities[coordinate] = entity
        # else do nothing
    foreach_with(action)
    # cannot know pumpkin
    if entity == Entities.Carrot:
        return ('known-entities-and-state', result_entities, Items.Carrot)
    if entity == Entities.Pumpkin:
        return ('known-state', 'large-pumpkin')
    if entity == Entities.Sunflower:
        return ('known-entities-and-state', result_entities, 'harvest-sunflower')
    if entity == Entities.Cactus:
        return ('known-entities-and-state', result_entities, 'sort-cactus')

def is_tree_ok():
    for direction in Directions:
        move(direction)
        if get_entity_type() == Entities.Tree:
            move(OppositeDirection[direction])
            return False
        move(OppositeDirection[direction])
    return True
# plant tree when no sibling is tree
# TODO if full field is wood, can use fixed positions for tree, which is (x + y) % 2 == 0
def wood_workflow(_context):
    result_entities = {}
    def action(coordinate):
        if get_entity_type() in (None, Entities.Dead_Pumpkin) or can_harvest() and harvest():
            till_for(Entities.Tree) # both support soil
            if is_tree_ok():
                plant(Entities.Tree)
                result_entities[coordinate] = Entities.Tree
            else:
                plant(Entities.Bush)
                result_entities[coordinate] = Entities.Bush
            postproceess_ground()
        # else do nothing
    foreach_with(action)
    return ('known', result_entities)

# merge complete field into one large pumpkin
def large_pumpkin_workflow(_context):
    dead_positions = [] # array of coordinates
    def collect(coordinate):
        global dead_positions
        if get_entity_type() == Entities.Pumpkin:
            pass
        # TODO does this workflow need check empty?
        elif get_entity_type() in (None, Entities.Dead_Pumpkin):
            dead_positions.append(coordinate)
        else:
            # harvest other entities
            while not can_harvest():
                do_a_flip()
            harvest()
    foreach_with(collect)
    while len(dead_positions) != 0:
        # dead position may again be dead position, so scan through them
        for position in dead_positions:
            move_to(position)
            if get_entity_type() == Entities.Pumpkin and can_harvest():
                new_dead_positions = []
                for other_position in dead_positions:
                    if position != other_position:
                        new_dead_positions.append(other_position)
                dead_positions = new_dead_positions
            elif get_entity_type() == Entities.Dead_Pumpkin:
                till_for(Entities.Pumpkin)
                plant(Entities.Pumpkin)
                postproceess_ground()
            # else growing
    harvest() # complete!
    return ('empty',)

# harvest sunflower in piece amount order, this workflow does not plant
def harvest_sunflower_workflow(_context):
    piece_counts = {} # position => count, only for positions with entity = sunflower
    def collect(coordinate):
        global piece_counts
        if get_entity_type() == Entities.Sunflower:
            piece_counts[coordinate] = measure()
    foreach_with(collect)

    # note len(dict) available, del dict[key] no, so cannot len, use []=0 here
    # TODO no need to count everytime
    def get_remaining_sunflowers():
        count = 0
        # note this for in get key, dict.items is not available here
        for position in piece_counts:
            if piece_counts[position] != 0:
                count += 1
        return count
    # harvest all should make things easier
    while get_remaining_sunflowers() > 0:
        max_position, max_piece_count = None, 0
        for position in piece_counts:
            if piece_counts[position] > max_piece_count:
                max_position, max_piece_count = position, piece_counts[position]
        move_to(max_position)
        if can_harvest():
            harvest()
            piece_counts[max_position] = 0
        else:
            do_a_flip() # for now I think wait until can harvest is more performant
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

# the workflow functions
# accept a parameter as workflow context, for now, context[0] is workflow name (the item or workflow name)
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
}

# main loop
change_hat(Hats.Cactus_Hat)
current_entities_indication = None
workflow_name_indication = None
while True:
    if workflow_name_indication != None:
        workflow_name = workflow_name_indication
    else:
        if current_entities_indication != None:
            current_entities = current_entities_indication
        else:
            current_entities = collect_current_entities()
        workflow_name = select_workflow(current_entities)
    if workflow_name == 'halt':
        break
    workflow_result = Workflows[workflow_name]((workflow_name,))
    if workflow_result != None and len(workflow_result) > 0 and workflow_result[0] == 'empty':
        current_entities_indication = {}
        for position in get_all_coordinates():
            current_entities_indication[position] = None
    elif workflow_result != None and len(workflow_result) > 1 and workflow_result[0] == 'known':
        current_entities_indication = workflow_result[1]
    elif workflow_result != None and len(workflow_result) > 1 and workflow_result[0] == 'known-state':
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
