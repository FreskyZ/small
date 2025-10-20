from util import *

# context[0] is env, env[0] is absolute coordinate of position zero, env[1] is size
# context[1] is required amount
def work(context):
    # for now assuming size is >= 6
    # move to 2,2 to fit in companion
    move_to((2, 2))
    till_for(Entities.Grass)
    while num_items(Items.Hay) < context[1]:
        if can_harvest():
            harvest()
            plant(Entities.Grass)
            
while True:
    move_to((3, 3))
    if get_water() < 0.5:
        use_item(Items.Water)
    companion_entity, companion_position = get_companion()
    move_to(companion_position)
    if can_harvest():
        harvest()
    if get_entity_type() != None:
        till()
        till()
    plant(companion_entity)
    move_to((3, 3))
    before_amount = num_items(Items.Hay)
    while not can_harvest():
        pass
    harvest()
    harvest_amount = num_items(Items.Hay) - before_amount
    if harvest_amount != 640:
        print('harvest amount not 640:', harvest_amount, companion_entity, companion_position)
        while True:
            do_a_flip()
