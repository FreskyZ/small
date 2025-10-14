# plant entities according to target amount

target_grass = 1000
target_wood = 1000
target_carrot = 1000
retain_water = 1000000 # set this to a large number to disable watering

# move to position 0, 0, return world size by the way
def reset_position():
    while get_pos_x() != 0:
        move(West)
    while get_pos_y() != 0:
        move(South)
    return get_world_size()

# decide by distance from target amount, default to grass
def decide_entity():
    result_entity, result_requirement = Entities.Grass, 0
    wood_requirement = target_wood - num_items(Items.Wood)
    if wood_requirement > result_requirement:
        result_entity, result_requirement = Entities.Bush, wood_requirement
    carrot_requirement = target_carrot - num_items(Items.Carrot)
    if carrot_requirement > result_requirement:
        result_entity, result_requirement = Entities.Carrot, carrot_requirement
    return result_entity

def prepare_ground(entity):
    target_ground = Grounds.Grassland
    if entity == Entities.Carrot:
        target_ground = Grounds.Soil
    if get_ground_type() != target_ground:
        till()

# use water when above retain line
def try_water():
    if get_water() < 1 and num_items(Items.Water) > retain_water:
        use_item(Items.Water)

# foreach block
# action is a function receiving current position x, y
def scan(action):
    size = reset_position()
    for x in range(size):
        for y in range(size):
            action(x, y)
            move(South)
        move(East)

# main loop
while True:
    def action(x, y):
        # always try harvest the block, if harvested something
        if get_entity_type() == None or can_harvest() and harvest():
            target_entity = decide_entity()
            prepare_ground(target_entity)
            plant(target_entity)
            try_water()
    scan(action)
    pet_the_piggy() # breakpoint this line to interrupt a full loop
