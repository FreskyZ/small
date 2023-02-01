import sys
from math import sqrt
from fractions import Fraction

# ford tree approximation
# https://www.bilibili.com/video/av217721014/
#
# most interest input, if you forget, is `fordtree.py "(sqrt(5)-1)/2"`

def findpath(target: Fraction):
    print(f'process {target}')
    results = []
    left = Fraction(0, 1)
    right = Fraction(1, 1)
    iteration = 0
    sqrt5 = Fraction(sqrt(5))
    while True:
        iteration += 1
        if iteration == 10000:
            print('max iteration exceed')
            break # prevent infinite loop if logic error
        middle = Fraction(left.numerator + right.numerator, left.denominator + right.denominator)
        difference = abs(target - middle)
        if difference < Fraction(1, middle.denominator * middle.denominator) / sqrt5:
            results.append(middle)
            print(f'[{iteration}] {middle}: diff {float(difference)}')
        if middle == target:
            break
        elif middle > target:
            right = middle
        else:
            left = middle

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: ft.py VALUE')
        exit(1)
    findpath(Fraction(eval(sys.argv[1])))
