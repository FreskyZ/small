# plant entities according to target amount, dict/set improve
# TODO scan in advance in every loop, change pumpkin workflow entering check to "most blocks are pumpkin"
# this initial scan can also be used for sunflower harvest order handling

# target grass, wood, carrot, pumpkin
target_items = [5000, 5000, 5000, 5000]
retain_water = 200 # set this to a large number to disable watering

# move to position
def move_to(x, y):
    while get_pos_x() != x:
        move(West) # both west and east are ok
    while get_pos_y() != y:
        move(North) # both north and south are ok
    move(South) # work around for a bug that it does not stay at (x, y) but (x, y + 1)

# decide by distance from target amount, default to grass
def decide_entity():
    result_entity, result_requirement = Entities.Grass, target_items[0] - num_items(Items.Hay)
    # target_items array index, item, entity
    for i in [(1, Items.Wood, Entities.Bush), (2, Items.Carrot, Entities.Carrot), (3, Items.Pumpkin, Entities.Pumpkin)]:
        target_index, item, entity = i
        requirement = target_items[target_index] - num_items(item)
        if requirement > result_requirement:
            result_entity, result_requirement = entity, requirement
    return result_entity

def can_block_work():
    if get_entity_type() == None:
        return True
    if get_entity_type() == Entities.Dead_Pumpkin:
        return True
    # always try harvest if can harvest
    if can_harvest() and harvest():
        return True
    return False

def prepare_ground(entity):
    target_ground = Grounds.Grassland
    if entity in [Entities.Carrot, Entities.Pumpkin]:
        target_ground = Grounds.Soil
    if get_ground_type() != target_ground:
        till()

# check entity in 4 sibling position, return True for has
def check_sibling(checking_entity):
    for d in [(South, North), (North, South), (East, West), (West, East)]:
        direction, return_direction = d
        move(direction)
        if get_entity_type() == checking_entity:
            move(return_direction)
            return True
        move(return_direction)
    return False

def prepare_and_plant(entity):
    # try tree when not blocking (no sibling trees)
    if entity == Entities.Bush:
        has_sibling = check_sibling(Entities.Tree)
        if has_sibling == 0:
            entity = Entities.Tree
    prepare_ground(entity)
    plant(entity)
    try_water()

# use water when above retain line
def try_water():
    if get_water() < 1 and num_items(Items.Water) > retain_water:
        use_item(Items.Water)

# foreach block
# action is a function receiving current position x, y
def scan(action):
    move_to(0, 0)
    size = get_world_size()
    for x in range(size):
        for y in range(size):
            action(x, y)
            move(South)
        move(East)

# pumpkin specific workflow, return True for continue
def pumpkin_workflow():
    if decide_entity() == Entities.Pumpkin:
        # and all blocks are pumpkin or dead pumpkin, try to complete the full large pumpkin
        pumpkin_count = 0
        dead_pumpkin_count = 0
        can_harvest_count = 0
        def action(x, y):
            global pumpkin_count
            global dead_pumpkin_count
            global can_harvest_count
            if get_entity_type() == Entities.Pumpkin:
                pumpkin_count += 1
            # sometimes there is empty block, not sure exact reason, count as dead in this workflow
            # update: empty block is caused by harvesting east part of a large pumpkin
            if get_entity_type() == Entities.Dead_Pumpkin or get_entity_type() == None:
                dead_pumpkin_count += 1
            if can_harvest():
                can_harvest_count += 1
        scan(action)
        if pumpkin_count + dead_pumpkin_count == get_world_size() ** 2:
            if dead_pumpkin_count == 0: # complete! harvest
                if can_harvest_count == get_world_size() ** 2:
                    harvest()
                else:
                    return True
            else:
                # if not enough carrot, abort
                if num_items(Items.Carrot) < dead_pumpkin_count:
                    return False
                def action(x, y):
                    if get_entity_type() == Entities.Dead_Pumpkin or get_entity_type() == None:
                        plant(Entities.Pumpkin)
                scan(action)
                return True
    return False

# main loop
while True:
    if pumpkin_workflow():
        continue
    def action(x, y):
        if can_block_work():
            prepare_and_plant(decide_entity())
    scan(action)
    pet_the_piggy() # breakpoint this line to interrupt a full loop
