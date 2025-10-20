from util import move_to

def test_move_to():
    # do a flip to make it easier to see
    # note: this dsl does not allow bare expr statement?
    # move to corner, this should use wrapping
    a = move_to((0, 0)), do_a_flip()
    a = move_to((0, 7)), do_a_flip()
    a = move_to((7, 7)), do_a_flip()
    a = move_to((7, 0)), do_a_flip()
    # normal move
    a = move_to((7, 1)), do_a_flip()
    a = move_to((7, 2)), do_a_flip()
    a = move_to((6, 2)), do_a_flip()
    a = move_to((6, 1)), do_a_flip()
    # normal diagnal move
    a = move_to((5, 3)), do_a_flip()
    a = move_to((3, 5)), do_a_flip()
    # wrapping diagnal move
    a = move_to((0, 0)), do_a_flip()
    a = move_to((6, 6)), do_a_flip()
test_move_to()

# make sure wrapping move takes same time as normal move
# RESULT: ok, same
def test_speed():
    move_to(0, 0)
    for i in range(0, 100):
        # move_to(0, 7)
        # move_to(0, 0)
        move_to(0, 1)
        move_to(0, 2)
