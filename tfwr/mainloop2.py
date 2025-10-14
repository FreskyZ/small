# plant entities according to target amount, array version, support tree

# target grass, wood, carrot
target_items = [2000, 2000, 2000]
retain_water = 1000000 # set this to a large number to disable watering

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
    for i in [(1, Items.Wood, Entities.Bush), (2, Items.Carrot, Entities.Carrot)]:
        target_index, item, entity = i
        requirement = target_items[target_index] - num_items(item)
        if requirement > result_requirement:
            result_entity, result_requirement = entity, requirement
    return result_entity

def prepare_ground(entity):
    target_ground = Grounds.Grassland
    if entity == Entities.Carrot:
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

# main loop
while True:
    def action(x, y):
        # always try harvest the block, if harvested something
        if get_entity_type() == None or (can_harvest() and harvest()):
            prepare_and_plant(decide_entity())
    scan(action)
    pet_the_piggy() # breakpoint this line to interrupt a full loop
