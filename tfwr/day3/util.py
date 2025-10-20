
# east, west, north, south is too not intuitive
Top = North
Right = East
Bottom = South
Left = West
Directions = [Top, Right, Bottom, Left]
OppositeDirection = {
    Top: Bottom,
    Right: Left,
    Bottom: Top,
    Left: Right,
}

# ??? this game use left bottom as 0, 0 ???
def move_to(target):
    size = get_world_size()
    x, y = get_pos_x(), get_pos_y()
    target_x, target_y = target

    if x > target_x:
        if x - target_x <= target_x + size - x:
            for i in range(x - target_x):
                move(Left)
        else:
            for i in range(target_x + size - x):
                move(Right)
    elif x < target_x:
        if target_x - x <= x + size - target_x:
            for i in range(target_x - x):
                move(Right)
        else:
            for i in range(x + size - target_x):
                move(Left)

    if y > target_y:
        if y - target_y <= target_y + size - y:
            for i in range(y - target_y):
                move(Bottom)
        else:
            for i in range(target_y + size - y):
                move(Top)
    elif y < target_y:
        if target_y - y <= y + size - target_y:
            for i in range(target_y - y):
                move(Top)
        else:
            for i in range(y + size - target_y):
                move(Bottom)

# get as [(0, 0), (0, 1), ..., (7, 7)] etc.
def get_all_coordinates():
    size = get_world_size()
    result = []
    for x in range(size):
        for y in range(size):
            result.append((x, y))
    return result

# foreach block
# this actually moves drown around comparing to the virtual get_all_coordinates
# action is a function receiving current position (x, y)
def foreach_with(action):
    move_to((0, 0))
    size = get_world_size()
    for x in range(size):
        for y in range(size):
            action((x, y))
            move(Top)
        move(Right)

# prefer soil to avoid grass
RequiredGrounds = {
    Entities.Grass: Grounds.Grassland,
    Entities.Bush: Grounds.Soil,
    Entities.Carrot: Grounds.Soil,
    Entities.Pumpkin: Grounds.Soil,
    Entities.Tree: Grounds.Soil,
    Entities.Sunflower: Grounds.Soil,
    Entities.Cactus: Grounds.Soil,
}

PlantItems = [
    Items.Hay,
    Items.Wood,
    Items.Carrot,
    Items.Pumpkin,
    Items.Cactus,
]
EntityToItem = {
    Entities.Grass: Items.Hay,
    Entities.Bush: Items.Wood,
    Entities.Tree: Items.Wood,
    Entities.Carrot: Items.Carrot,
    Entities.Pumpkin: Items.Pumpkin,
    Entities.Dead_Pumpkin: None,
    Entities.Sunflower: Items.Power,
    Entities.Cactus: Items.Cactus,
}

def till_for(entity):
    if get_ground_type() != RequiredGrounds[entity]:
        till()

def get_postproceess_ground(retain_water, retain_fertilizer, target_weird):
    def f():
        # water loses faster when water level is higher, for now I try to keep 0.5-0.75
        while get_water() < 0.5 and num_items(Items.Water) > retain_water:
            use_item(Items.Water)
        # for now, try randomly use fertilizer
        # for now, if need weird substance, use 0.5, else use 0.99
        if num_items(Items.Fertilizer) > retain_fertilizer:
            need_more_weird = num_items(Items.Weird_Substance) < target_weird
            if need_more_weird and random() > 0.5 or not need_more_weird and random() > 0.99:
                use_item(Items.Fertilizer)
    return f

def clear_except_hat():
    move_to((0, 0))
    def action(p):
        if get_ground_type() == Grounds.Grassland:
            till()
        elif get_ground_type() == Grounds.Soil:
            till()
            till()
    foreach_with(action)
    print('cleared!')
