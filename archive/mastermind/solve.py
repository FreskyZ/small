#!python3
import colorama, math, random, sys

# solver for hit and blow mini game in switch game 51 worldwide classics,
# wiki says this game is called mastermind, so directory is called mastermind
#
# this is actually an information theory problem,
# which is also inspired by 3b1b video about wordle solver:
#    https://www.youtube.com/watch?v=v68zYyaEmEA
#    https://www.youtube.com/watch?v=fRed0Xmc2Wg
#
# this script is imported from another repository, which is mainly devloped in June 2022

BLUE = 1
RED = 2
GREEN = 3
YELLOW = 4
PINK = 5
WHITE = 6
NAMES = ['',
    f'{colorama.Fore.CYAN}BLUE{colorama.Style.RESET_ALL}',
    f'{colorama.Fore.RED}RED{colorama.Style.RESET_ALL}',
    f'{colorama.Fore.GREEN}GREEN{colorama.Style.RESET_ALL}',
    f'{colorama.Fore.YELLOW}YELLOW{colorama.Style.RESET_ALL}',
    f'{colorama.Fore.LIGHTMAGENTA_EX}PINK{colorama.Style.RESET_ALL}',
    f'{colorama.Fore.WHITE}WHITE{colorama.Style.RESET_ALL}',
]
PARSE = { 'B': 1, 'R': 2, 'G': 3, 'Y': 4, 'P': 5, 'W': 6 }

def get_all_combinations(duplicatable):
    combinations = []
    for c1 in range(1, 7):
        for c2 in [v for v in range(1, 7) if duplicatable or v != c1]:
            for c3 in [v for v in range(1, 7) if duplicatable or v not in (c1, c2)]:
                for c4 in [v for v in range(1, 7) if duplicatable or v not in (c1, c2, c3)]:
                    combinations.append((c1, c2, c3, c4))
    return combinations

def generate_combination(duplicatable):
    c1 = random.randint(1, 6)
    c2 = random.randint(1, 6)
    while not duplicatable and c1 == c2:
        c2 = random.randint(1, 6)
    c3 = random.randint(1, 6)
    while not duplicatable and c3 in (c1, c2):
        c3 = random.randint(1, 6)
    c4 = random.randint(1, 6)
    while not duplicatable and c4 in (c1, c2, c3):
        c4 = random.randint(1, 6)
    return (c1, c2, c3, c4)

def get_count(combination, guess):
    # for duplicatable, hit count is still strict answer[i] == guess[i]
    # and after remove all hits, foreach remaining color in guess, 
    # if it is in answer (it cannot be in correct place now), add to blow count
    # note that blow pair is removed after checked, e.g. (answer)RBBR (guess)RRRB is 12 not 13

    hit_count = 0
    after_hit_combination, after_hit_guess = [], []
    for i in range(0, 4):
        if combination[i] == guess[i]:
            hit_count += 1
        else:
            after_hit_combination.append(combination[i])
            after_hit_guess.append(guess[i])

    blow_count = 0
    for c in after_hit_combination:
        if c in after_hit_guess:
            blow_count += 1
            after_hit_guess.remove(c) # list.remove correct removes one first occurance

    return hit_count, blow_count

# most occurance one by one
def greedy_guess(combinations):
    c1 = max([(v, [c[0] for c in combinations].count(v)) for v in range(1, 7)], key=lambda v: v[1])[0]
    combinations = [c for c in combinations if c[0] == c1]
    c2 = max([(v, [c[1] for c in combinations].count(v)) for v in range(1, 7)], key=lambda v: v[1])[0]
    combinations = [c for c in combinations if c[0] == c1 and c[1] == c2]
    c3 = max([(v, [c[2] for c in combinations].count(v)) for v in range(1, 7)], key=lambda v: v[1])[0]
    combinations = [c for c in combinations if c[0] == c1 and c[1] == c2 and c[2] == c3]
    c4 = max([(v, [c[3] for c in combinations].count(v)) for v in range(1, 7)], key=lambda v: v[1])[0]
    return (c1, c2, c3, c4)

# info entropy in form of (average combination count reduce over answer is even spreaded in these combinations)
def get_info_entropy(combinations, index, debug):
    reductions = 0
    for i, answer in enumerate(combinations):
        if i != index:
            counts = get_count(answer, combinations[index])
            nextstep = [c for c in combinations if get_count(c, combinations[index]) == counts]
            reductions += (math.log(len(combinations)) - math.log(len(nextstep))) / math.log(2)
            if debug:
                print(f'IF GUESS {combinations[index]} AND ANSWER IS {answer} THEN REDUCE {len(combinations) - len(nextstep)}')
    return round(reductions / (len(combinations) - 1), 2)

# assist gaming hosted by others
def assist(duplicatable):
    combinations = get_all_combinations(duplicatable)
    # for i, a in enumerate(combinations):
    #     print(f'{i}: ' + ', '.join(NAMES[c] for c in a))
    print(f'input like RGBY00 ({" ".join(NAMES[1:])})')
    step = 1
    while True:
        onetry = input(f'{step}> ')
        if not onetry or onetry == 'exit':
            break
        guess = [PARSE[c.upper()] for c in onetry[:4]]
        counts = int(onetry[4]), int(onetry[5])
        combinations = [c for c in combinations if get_count(c, guess) == counts]
        for i, a in enumerate(combinations):
            print(f'[{i + 1}] ' + ' '.join(NAMES[c] for c in a))
        recommend = greedy_guess(combinations)
        print('maybe? ' + ' '.join(NAMES[c] for c in recommend))
        if len(combinations) <= 1:
            print('[!] GAME OVER')
            break
        step += 1
    
def host(duplicatable, answer):
    answer = [PARSE[c.upper()] for c in answer] if answer is not None else generate_combination(duplicatable)
    combinations = get_all_combinations(duplicatable)
    # for i, a in enumerate(combinations):
    #     print(f'{i}: ' + ', '.join(NAMES[c] for c in a))
    print(F'input like RGBY ({" ".join(NAMES[1:])})')
    guesses = []
    while True:
        onetry = input(f'{len(guesses) + 1}> ')
        if onetry.startswith('exit'):
            break
        if not onetry or onetry == 'help':
            print(f'> a? (answer SPOILER ALERT)')
            print(f'> p? (current possibilities)')
            print(f'> r? (recommendation)')
            print(f'> v? (advanced recommendation)')
            print(f'> h? (guess history)')
            print(f'> input like RGBY ({" ".join(NAMES[1:])})')
            print(f'> exit')
        elif onetry in ('a?', 'A?'):
            print(' '.join(NAMES[c] for c in answer))
        elif onetry in ('p?', 'P?'):
            for i, a in enumerate(combinations[:100]):
                print(f'[{i + 1}] ' + ' '.join(NAMES[c] for c in a))
            if len(combinations) > 100:
                print(f'[...] {len(combinations) - 100} more')
        elif onetry in ('r?', 'R?'):
            recommend = greedy_guess(combinations)
            print('maybe? ' + ' '.join(NAMES[c] for c in recommend))
        elif onetry in ('v?', 'V?'):
            if len(combinations) > 32 or len(combinations) == 1:
                print('advanced recommendation not available')
            else:
                max_entropy = 0
                max_entropy_combinations = []
                for i, a in enumerate(combinations):
                    entropy = get_info_entropy(combinations, i, False)
                    if entropy > max_entropy:
                        max_entropy = entropy
                        max_entropy_combinations = [a]
                    elif entropy == max_entropy:
                        max_entropy_combinations.append(a)
                    print(f'[{i + 1}] ' + ' '.join(NAMES[c] for c in a) + f' {entropy:.2f}b')
                if len(max_entropy_combinations) < len(combinations):
                    choice = random.choice(max_entropy_combinations)
                    print(f'[RECOMMEND] ' + ' '.join(NAMES[c] for c in choice))
                else:
                    print('[NO RECOMMEND] all same entropy')
        elif onetry in ('vg?', 'VG?'):
            if len(combinations) > 32 or len(combinations) == 1:
                print('advanced recommendation not available')
            else:
                for i, a in enumerate(combinations):
                    entropy = get_info_entropy(combinations, i, True)
                    print(f'[{i + 1}] ' + ' '.join(NAMES[c] for c in a) + f' {entropy:.2f}b')
        elif onetry in ('h?', 'H?'):
            for guess, counts, entropy in guesses:
                print(f'[{counts[0]} HIT {counts[1]} BLOW] ' + ' '.join(NAMES[c] for c in guess) + f' {entropy:.2f}b')
        elif len(onetry) != 4 or any(c for c in onetry if c.upper() not in PARSE):
            print('invalid guess, see help')
        else:
            guess = [PARSE[c.upper()] for c in onetry]
            counts = get_count(answer, guess)
            before_entropy = math.log(len(combinations)) / math.log(2)
            combinations = [c for c in combinations if get_count(c, guess) == counts]
            guess_entropy = before_entropy - math.log(len(combinations)) / math.log(2)
            remaining_entropy = math.log(len(combinations)) / math.log(2)
            guesses.append((guess, counts, guess_entropy))
            if counts[0] == 4:
                print(f'{counts[0]} HIT {counts[1]} BLOW {guess_entropy:.2f}b GAME OVER!')
                break
            else:
                print(f'{counts[0]} HIT {counts[1]} BLOW {guess_entropy:.2f}b REMAINING {remaining_entropy:.2f}b')

def autoonce(duplicatable):
    answer = generate_combination(duplicatable)
    combinations = get_all_combinations(duplicatable)

    step = 1
    guess = None
    while True:
        if step == 1:
            guess = (2, 2, 1, 1)
        # elif step == 2:
        #     guess = (3, 3, 4, 4)
        elif len(combinations) == 1:
            guess = combinations[0]
        else:
            max_entropy = 0
            max_entropy_combinations = []
            for i, a in enumerate(combinations):
                entropy = get_info_entropy(combinations, i, False)
                if entropy > max_entropy:
                    max_entropy = entropy
                    max_entropy_combinations = [a]
                elif entropy == max_entropy:
                    max_entropy_combinations.append(a)
            guess = random.choice(max_entropy_combinations)
        counts = get_count(answer, guess)
        before_entropy = math.log(len(combinations)) / math.log(2)
        combinations = [c for c in combinations if get_count(c, guess) == counts]
        guess_entropy = before_entropy - math.log(len(combinations)) / math.log(2)
        remaining_entropy = math.log(len(combinations)) / math.log(2)
        guess_display = ' '.join(NAMES[c] for c in guess)
        if counts[0] == 4:
            print(f'{step}> {guess_display}')
            print(f'   {counts[0]} HIT {counts[1]} BLOW {guess_entropy:.2f}b GAME OVER!')
            break
        else:
            print(f'{step}> {guess_display}')
            print(f'   {counts[0]} HIT {counts[1]} BLOW {guess_entropy:.2f}b -> {remaining_entropy:.2f}b')
        step += 1

if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'assist':
        assist(len(sys.argv) == 3 and sys.argv[2] == 'dup')
    elif len(sys.argv) >= 2 and sys.argv[1] == 'host':
        host(len(sys.argv) >= 3 and sys.argv[2] == 'dup', sys.argv[3] if len(sys.argv) == 4 else None)
    elif len(sys.argv) >= 2 and sys.argv[1] == 'auto':
        autoonce(len(sys.argv) >= 3 and sys.argv[2] == 'dup')
    else:
        print('hab.py assist [dup] or hab.py host dup/nodup [answer]')
