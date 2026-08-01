import math, sys

# the overall goal is implementing a nonogram game web page with
# randomly generated board, an automatic solver with entropy analyzation attempts

# ai suggest to determine difficulty of a randomly generated board:
# - Run the virtual solver and count the number of advanced techniques used.
# Multiply that by the average line entropy.
# Add a small "frustration penalty" if the first 5 moves don't reveal any obvious cells.
# Then, they playtest the puzzle with real humans to fine-tune that score into a 1-to-5 star rating.

# 1. for a 10x10 board, the board have 100 cells,
#    every cell has 2 possibilities, that is 2^100 possibilities or literally 100 bit of information
#    for numbers like [4, 5], it leaves only one possibility which is 0bit and we say this number combination has 10b information
#    for numbers like [1, 1], it has 36 possibilities, we say this have (10 - log2(36)) bits of information
#    first, iterate through all possibilities and get their numcomb, calculate its information

# set this to 30x30 is oom, not cpu overheat
board_size = int(sys.argv[1]) if len(sys.argv) > 1 else 10
numcombs = {}
for i in range(0, 2 ** board_size):
    line = f'{i:010b}' # 010b amazingly works
    numbers = []
    current_length = 0
    for c in line:
        if c == '1':
            current_length += 1
        else:
            if current_length:
                numbers.append(current_length)
                current_length = 0
    if current_length:
        numbers.append(current_length)
    # print(f'{line}: {numbers}')
    # you already get each numcomb's possibility count by group by numbers
    numcomb = ','.join(str(n) for n in numbers)
    if numcomb in numcombs:
        numcombs[numcomb].append(line)
    else:
        numcombs[numcomb] = [line]

# total information amount, for avg
total_amount = 0
# for a randomly generated board, the spread of numcombs is exactly the number of possibilities
total_weighted_amount = 0
# group by floor
spread = {}
for numcomb, possibilities in numcombs.items():
    # by the way, empty str (no numbers) is 10b
    # print(f'{numcomb:10} {', '.join(possibilities[:5])}')
    info_amount = board_size - math.log2(len(possibilities))
    # print(f'{numcomb:10}: {info_amount}b')
    total_amount += info_amount
    total_weighted_amount += info_amount * len(possibilities)
    category = math.floor(info_amount)
    if category in spread:
        spread[category] += 1
    else:
        spread[category] = 1

# pct: 5 is 67%, 10 is 63%, 15 is 60%, 20 is 58.79%, 24 is 57.84%, 25 is 57.64%
print(f'avg amount {total_amount / len(numcombs)}b')
print(f'wtd avg amount {total_weighted_amount / (2 ** board_size)}b')
print(f'wtd avg amount pct {total_weighted_amount / (2 ** board_size) / board_size * 100}%')
# by the way, 21x21 has 10000+ different combinations that have full info amount,
#             25x25 has 75000+ (total kind of combination is like <200000)
for cat, count in spread.items():
    print(f'{cat:>2}b+: {count}')

# UPDATE ai says the wtd avg amount pct limit is 0.5, that is one number combination have 0.5x size bits of information,
# while there is 2x size number combinations, they exactly add up to 1 to correctly provide *the same amount of* the information to solve a board
# the same amount only mean same amount, this does not forbid you construct a set of clue to not provide enough information
#
# - for a inifinite long random binary string, about half characters are 0 and half characters are 1
# - the number combinations are run length encoding of 1s
# - average run length is 2, sum(k = 1 to inf, k / 2 ** k) = 2
# - average information of one number is 0.5b
# - average count of numbers in a number combination is 1/4 of size
# - result in an average 0.5 x size of information in an infinitely sized board
#
# TODO still not quite understand, although not quite understand yet,
# but as the clues take the 1s part in a full run length encoding of all 0s and 1s, it only take half of the information, so result should be half
#
# N for board size
# S for sum of the numbers in a clue
# m for count of the numbers in a clue
# combination(s-1, m-1) is count of ways to choose exact numbers
# combination(n-s+1, m) is count of ways to distribute the 0s between 1s
# for a specific (s, m), the information amount is (n - log2(combination(n-s+1, m)))
# this specific (s, m) have combination(s-1, m-1) kind of clues,
# each clue have combination(n-s+1, m) weights, number of specific binary strings
# multiply these 3 to get total information of this (s, m)
# iterate s from 0 to n, m from 1 to s, devide result sum by (n * (2 ** n)) is the result percentage
#
# TODO you can confirm this by checking with small numbers
