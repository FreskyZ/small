# basic: plant specified entity to all blocks, in a 3x3 farm

while True:
	for i in range(3):
		for j in range(3):
			if can_harvest():
				if harvest():
					# while get_ground_type() != Grounds.Soil:
                    #    till()
					plant(Entities.Bush)
			move(South)
		move(East)
	pass
pet_the_piggy()
