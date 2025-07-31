#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>
#include <math.h>
#include "victim.h"

// a ranged guess problem from algorithm practice from my friend's teacher
// I'm not authurized to open source the include victim.h and victim.so so they are not git tracked
//
// the not included files are actually simple
// 2 not same random numbers are choosen, called x and y,
// and you are allowed to call a calculation function which takes a buffer as input
// and the function calculates a * *transmute<int*>(&buffer[x]) + b * *transmute<int*>(&buffer[y]) + c as output
// a, b and c also unknown, the goal of this problem is to infer value of a, b and c with minimal calculation count,
// the difference from normal dichotomy guess game is that
// there are 2 unknown values, and each of them affect 4 bytes (4 positions) instead of one
//
// you can also find part of this logic in v2 and v3 rust implementations
//
// this script is imported from another repository, which is mainly devloped in Nov 2022

#define SIZE 1024
#define DEBUG 0
#define TRY_NAIVE 1
#define EARLY_SEED 1

#if DEBUG
#define printd(...) printf(__VA_ARGS__)
#else
#define printd(...)
#endif

char data[SIZE];
int debugapply = 1;
// memset [left, right) to value and return invocation result
double apply(int left, int right, char value) {
    static char* filename = "input.bin";
    if (left == right) {
        double ithinkresult = apply(left + 1, left + 4, value);
        printd("invalid invocation left = right = %d", right, ithinkresult);
        exit(2);
    }
    memset(data + left, value, right - left);
    FILE* file = fopen(filename, "w");
    fwrite(data, 1, SIZE, file);
    fclose(file);
    memset(data, 0, SIZE);
    double result = f(filename);
    if (debugapply) {
        printd("[%d,%d)=%d: %lf\n", left, right, value, result);
    }
    return result;
}

double c;
double sign_last_result;
// significant: return not 0 for not apply result not c
int sign(int left, int right) {
    sign_last_result = apply(left, right, 1) - c;
    return fabs(sign_last_result) < 1e-4 ? 0 : 1;
}
// nosign is more readable then !sign
int nosign(int left, int right) {
    sign_last_result = apply(left, right, 1) - c;
    return fabs(sign_last_result) < 1e-4 ? 1 : 0;
}

// after complex may be 2 range part, find 1 range is similar
double find_single(int left, int right, const char* variable_name) {
    while (1) {
        int middle = (left + right) / 2;
        if (sign(left, middle)) {
            right = middle;
            if (left + 1 == right) {
                printd("%s found %d\n", variable_name, left);
                return sign_last_result;
            }
        } else {
            left = middle;
            if (left + 1 == right) {
                printd("%s found %d\n", variable_name, left);
                sign(left, left + 1); // the last result is for previous left, need to use new left to apply again
                return sign_last_result;
            }
        }
    }
}

int main () {

#if DEBUG && EARLY_SEED
    // print seed in advance, or else error abort cannot see seed
    time_t seed = time(NULL);
    // time_t seed = 1669427337;
    debug_mode(seed);
    printf("seed: %ld\n", seed);
#endif

    init();
    c = apply(0, SIZE, 0);

#if DEBUG && TRY_NAIVE
    debugapply = 0;
    printd("naive solution: ");
    for (int i = 0; i < SIZE; ++i) {
        if (sign(i, i + 1)) {
            printd("%d,", i);
        }
    }
    printd("\n");
    debugapply = 1;
#endif

    // make sure a != -b
    if (nosign(0, SIZE)) {
        printd("a=-b, when will this happen?\n");
        return 1;
    }

    int left = 0, middle = SIZE / 2, right = SIZE;
    while (1) {
        middle = (left + right) / 2;
        if (nosign(left, middle)) {
            // pos_x and pos_y must not be in this range
            left = middle;
            continue;
        }
        if (nosign(middle, right)) {
            // pos_x and pos_y must not be in this range, even include [middle-3, middle)
            right = middle - 3;
            continue;
        }
        printd("both side is not c: %d,%d,%d\n", left, middle, right);
        break;
    }

    double a, b;
    if (left + 8 == right) {
        a = sign(left, left + 1);
        b = sign(left + 4, left + 5);
        printd("pos_x = %d, pos_y = %d exact match, will this happen?\n", left, left + 4);
    } else {
        // note that s and t does not overlap, so at most one of them is cross border
        if (nosign(left, middle - 3)) {
            printd("pos_x at border, pos_y at right\n");
            int pos_x;
            for (int i = 0; i < 3; ++i) {
                if (sign(middle - 3 + i, middle - 2 + i)) {
                    a = sign_last_result;
                    pos_x = middle - 3 + i;
                    printd("pos_x = %d\n", pos_x);
                    break;
                }
            }
            b = find_single(pos_x + 4, right, "pos_y");
        } else if (nosign(middle + 3, right)) {
            printd("pos_x at left, pos_y at border\n");
            int pos_y;
            for (int i = 0; i < 3; ++i) {
                if (sign(middle - 3 + i, middle - 2 + i)) {
                    b = sign_last_result;
                    pos_y = middle - 3 + i;
                    printd("pos_y = %d\n", pos_y);
                    break;
                }
            }
            a = find_single(left, pos_y - 4, "pos_x");
        } else {
            printd("pos_x and pos_y in their own range [%d,%d) and [%d,%d)\n", left, middle-3, middle, right);
            a = find_single(left, middle - 3, "pos_x");
            b = find_single(middle, right, "pos_y");
        }
    }

    printd("a = %lf, b = %lf\n", a, b);
    check_ans(a, b, c, 0);
}
