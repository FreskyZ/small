#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

// yet another turing machine related algorithm practice problem
// this program takes a turing machine configuration as input and try find a haltable table input
// the convert tulin.c to tulin.cpp is not completed yet, it may be completed in near future or far future
//
// the directory name is tulin because it looks a lot better than turing
// this script is imported from another repository, which is mainly devloped in Jan 2023

#define dprintf(...) printf(__VA_ARGS__)

enum move {
    accept_or_reject = 0,
    L = 1,
    R = 2,
};

struct rule {
    int before_state;
    char input_symbol;
    int after_state;
    char output_symbol;
    enum move move;
};

void new_rule(struct rule* rule, int before_state, char input_symbol, int after_state, char output_symbol, enum move move) {
    rule->before_state = before_state;
    rule->input_symbol = input_symbol;
    rule->after_state = after_state;
    rule->output_symbol = output_symbol;
    rule->move = move;
}
void dprint_rule(struct rule* rule) {
    dprintf("{%d}%c,{%d}%c,%c",
        rule->before_state, rule->input_symbol,
        rule->after_state, rule->output_symbol, rule->move == L ? 'L' : rule->move == R ? 'R' : '-');
}

struct machine {
    int state_count;
    int accept_state_count;
    int* accept_states;
    int reject_state_count;
    int* reject_states;
    int symbol_count;
    const char* symbols;
    int rule_count;
    struct rule* rules;
};

void drop_machine(struct machine* machine) {
    free(machine->accept_states);
    if (machine->reject_state_count > 0) {
        free(machine->reject_states);
    }
    free(machine->rules);
}

void dprint_machine(struct machine* machine) {
    dprintf("machine:\n");
    dprintf("  accept: [");
    for (int i = 0; i < machine->accept_state_count; ++i) {
        if (i != 0) {
            dprintf(", ");
        }
        dprintf("%d", machine->accept_states[i]);
    }
    dprintf("]\n  reject: [");
    for (int i = 0; i < machine->reject_state_count; ++i) {
        if (i != 0) {
            dprintf(", ");
        }
        dprintf("%d", machine->reject_states[i]);
    }
    dprintf("]\n");
    for (int i = 0; i < machine->rule_count; ++i) {
        dprintf("  #%d: ", i);
        dprint_rule(&machine->rules[i]);
        dprintf("\n");
    }
}

int is_accept(struct machine* machine, int state) {
    for (int i = 0; i < machine->accept_state_count; ++i) {
        if (machine->accept_states[i] == state) {
            return 1;
        }
    }
    return 0;
}
int is_reject(struct machine* machine, int state) {
    for (int i = 0; i < machine->reject_state_count; ++i) {
        if (machine->reject_states[i] == state) {
            return 1;
        }
    }
    return 0;
}

struct find_iter {
    struct machine* machine;
    // 1 for normal, 2 for final
    // normal does not accept accept_or_reject, final does not care about output symbol (update: and after_state)
    int iter_type;
    int after_state;
    char output_symbol;
    int current_index; // next to be inspected rule
};

void find_rules(struct find_iter* iter, struct machine* machine, int after_state, char output_symbol) {
    iter->machine = machine;
    iter->iter_type = 1;
    iter->after_state = after_state;
    iter->output_symbol = output_symbol;
    iter->current_index = 0;
}
void find_final_rules(struct find_iter* iter, struct machine* machine) {
    iter->machine = machine;
    iter->iter_type = 2;
    iter->after_state = 42;
    iter->output_symbol = '#';
    iter->current_index = 0;
}

// return rule index, -1 for not found
int find_next_rule(struct find_iter* iter) {
    do {
        if (iter->current_index == iter->machine->rule_count) {
            return -1;
        }
        if (iter->iter_type == 1
            && iter->machine->rules[iter->current_index].move != accept_or_reject
            && iter->machine->rules[iter->current_index].after_state == iter->after_state
            && iter->machine->rules[iter->current_index].output_symbol == iter->output_symbol
        ) {
            iter->current_index += 1;
            return iter->current_index - 1;
        } else if (iter->iter_type == 2
            && is_accept(iter->machine, iter->machine->rules[iter->current_index].after_state)
        ) {
            iter->current_index += 1;
            return iter->current_index - 1;
        }
        iter->current_index += 1;
    } while (1);
}

const int TAPE_LENGTH = 65536;
const int INIT_HEAD = 32767;
const char NONE_SYMBOL = '#';
const int MAX_APPLY_COUNT = 1024;

struct shadow_cell {
    char original_symbol;
    short position;
};

// reverse running machine instance
struct instance {
    struct machine* machine;
    char* tape;
    int shadow_cell_top; // next to be push position
    struct shadow_cell* shadow_cells; // recover from cover, not into #, first 2 byte is head position, 3rd byte is original char
    int head;
    int state;
    int rule_history_count;
    int* rule_history; // rule index
};

void new_instance(struct instance* instance, struct machine* machine) {
    instance->machine = machine;
    instance->tape = malloc(TAPE_LENGTH);
    memset(instance->tape, NONE_SYMBOL, TAPE_LENGTH);
    instance->shadow_cell_top = 0;
    instance->shadow_cells = malloc(65536 * sizeof(struct shadow_cell));
    instance->head = INIT_HEAD;
    instance->state = 42;
    instance->rule_history_count = 0;
    instance->rule_history = malloc(MAX_APPLY_COUNT * sizeof(int));
}

void drop_instance(struct instance* instance) {
    free(instance->tape);
    free(instance->shadow_cells);
    free(instance->rule_history);
}

void dprint_tape(struct instance* instance) {
    dprintf("...");
    for (int i = 0; i < TAPE_LENGTH; ++i) {
        if (instance->tape[i] != '#') {
            if (i == instance->head) {
                dprintf("[{%d}", instance->state);
            }
            if (i == INIT_HEAD) {
                dprintf("(");
            }
            dprintf("%c", instance->tape[i]);
            if (i == INIT_HEAD) {
                dprintf(")");
            }
            if (i == instance->head) {
                dprintf("]");
            }
        }
    }
    dprintf("...\n");
}

// return 1 for success
int solve_instance(struct instance* instance) {

    // iterator stack index corresponds to rule history stack
    struct find_iter* iterators = malloc(MAX_APPLY_COUNT * sizeof(struct find_iter));
    find_final_rules(&iterators[0], instance->machine);

    do {
        int next_rule_index = find_next_rule(&iterators[instance->rule_history_count]);
        dprintf("step#%d rule#%d\n", instance->rule_history_count, next_rule_index);
        if (next_rule_index == -1) {
            if (instance->rule_history_count == 0) {
                dprintf("  no answer at last\n");
                free(iterators);
                return 0;
            }
            instance->rule_history_count -= 1;
            if (instance->rule_history_count == 0) {
                // recover to step 0 is recover to nothing
                instance->state = iterators[0].after_state;
                instance->tape[instance->head] = '#';
                dprintf("  no answer for depth#1, recover to nothing\n");
            } else {
                // reverse reverse apply, which is apply
                struct rule* rev_rule = &instance->machine->rules[instance->rule_history[instance->rule_history_count]];
                instance->state = rev_rule->after_state;
                instance->tape[instance->head] = '#';

                int recover_from_shadow = 0;
                for (int i = 0; i < instance->shadow_cell_top; ++i) {
                    if ((int)instance->shadow_cells[i].position == instance->head) {
                        recover_from_shadow = 1;
                        instance->tape[instance->head] = instance->shadow_cells[i].original_symbol;
                    }
                    // in this case, linked list is better
                    if (recover_from_shadow && i < instance->shadow_cell_top - 1) {
                        instance->shadow_cells[i].position = instance->shadow_cells[i + 1].position;
                        instance->shadow_cells[i].original_symbol = instance->shadow_cells[i + 1].original_symbol;
                    }
                }
                instance->head += rev_rule->move == L ? -1 : 1;
                instance->tape[instance->head] = rev_rule->output_symbol;
                dprintf("  no answer for depth#%d, recover: ", instance->rule_history_count + 1);
                dprint_tape(instance);
            }
            continue;
        }

        struct rule* next_rule = &instance->machine->rules[next_rule_index];
        dprintf("  rule: ");
        dprint_rule(next_rule);
        dprintf("\n");
        int next_head = instance->head + (next_rule->move == L ? 1 : next_rule->move == R ? -1 : 0);
        if (instance->tape[next_head] != NONE_SYMBOL && instance->tape[next_head] != next_rule->output_symbol) {
            dprintf("  output conflict: ");
            dprint_tape(instance);
            continue;
        }
        instance->head = next_head;
        if (instance->tape[instance->head] != '#') {
            instance->shadow_cells[instance->shadow_cell_top].position = instance->head;
            instance->shadow_cells[instance->shadow_cell_top].original_symbol = instance->tape[instance->head];
            instance->shadow_cell_top += 1;
        }
        instance->tape[instance->head] = next_rule->input_symbol;
        instance->state = next_rule->before_state;
        instance->rule_history[instance->rule_history_count] = next_rule_index;
        instance->rule_history_count += 1;
        if (instance->state == 0) {
            dprintf("  resolve ok\n");
            free(iterators);
            return 1;
        } else if (instance->rule_history_count >= MAX_APPLY_COUNT) {
            dprintf("  step overflow!\n");
            free(iterators);
            return 0;
        } else {
            dprintf("  continue: ");
            dprint_tape(instance);
            find_rules(&iterators[instance->rule_history_count], instance->machine, instance->state, instance->tape[instance->head]);
        }
    } while (1);
}

void case_original(struct machine* machine) {
    machine->state_count = 4;
    machine->accept_state_count = 1;
    machine->accept_states = malloc(machine->accept_state_count * sizeof(int));
    machine->accept_states[0] = 3;
    machine->reject_state_count = 0;
    machine->reject_states = NULL;
    machine->symbol_count = 2;
    machine->symbols = "01";
    machine->rule_count = 4;
    machine->rules = aligned_alloc(_Alignof(struct rule), machine->rule_count * sizeof(struct rule));
    new_rule(&machine->rules[0], 0, '0', 1, '1', R);
    new_rule(&machine->rules[1], 1, '1', 2, '1', R);
    new_rule(&machine->rules[2], 2, '1', 2, '1', R);
    new_rule(&machine->rules[3], 2, '0', 3, '1', accept_or_reject);
}

void case_random(struct machine* machine) {
    // it is very hard to make has answer inputs, adjust these values
    machine->state_count = 42;  // 10 to 100
    machine->symbol_count = 12;  // 2 to 26 
    machine->rule_count = 240;  // 1 to 999
    int r_rate = 50;            // 1 to 99

    machine->accept_state_count = random() % 4 + 1;
    machine->accept_states = malloc(machine->accept_state_count * sizeof(int));
    for (int i = 0; i < machine->accept_state_count; ++i) {
        do {
            machine->accept_states[i] = rand() % machine->state_count;
            for (int j = 0; j < i; ++j) {
                if (machine->accept_states[j] == machine->accept_states[i]) {
                    machine->accept_states[i] = -1;
                }
            }
        } while (machine->accept_states[i] == -1);
    }

    machine->reject_state_count = random() % 4 + 1;
    machine->reject_states = malloc(machine->reject_state_count * sizeof(int));
    for (int i = 0; i < machine->reject_state_count; ++i) {
        do {
            machine->reject_states[i] = rand() % machine->state_count;
            for (int j = 0; j < machine->accept_state_count; ++j) {
                if (machine->accept_states[j] == machine->reject_states[i]) {
                    machine->reject_states[i] = -1;
                }
            }
            for (int j = 0; j < i; ++j) {
                if (machine->reject_states[j] == machine->reject_states[i]) {
                    machine->reject_states[i] = -1;
                }
            }
        } while (machine->reject_states[i] == -1);
    }

    machine->symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    machine->rules = aligned_alloc(_Alignof(struct rule), machine->rule_count * sizeof(struct rule));
    for (int i = 0; i < machine->rule_count; ++i) {
        int before_state = i == 0 ? 0 : rand() % machine->state_count;
        int input_symbol = 'A' + rand() % machine->symbol_count;
        int after_state = rand() % machine->state_count;
        if (before_state == 0) {
            while (is_accept(machine, after_state)) {
                after_state = rand() % machine->state_count;
            }
        }
        if (before_state == 0 && is_accept(machine, after_state)) {
            printf("invalid one step rule!");
            exit(1);
        }
        if (i == machine->rule_count - 1) {
            int has_accept = 0;
            for (int j = 0; j < machine->rule_count - 1; ++j) {
                if (is_accept(machine, machine->rules[j].after_state)) {
                    has_accept = 1;
                    break;
                }
            }
            if (!has_accept) {
                after_state = machine->accept_states[0];
            }
        }
        int output_symbol = 'A' + rand() % machine->symbol_count;
        int move = is_accept(machine, after_state) || is_reject(machine, after_state) ? accept_or_reject : rand() % 100 < r_rate ? R : L;
        new_rule(&machine->rules[i], before_state, input_symbol, after_state, output_symbol, move);
    }
}

void case_input(struct machine* machine, int input_index) {
    const char* get_input(int input_index);
    const char* input = get_input(input_index);

    input += 20; // skip fixed head
    machine->state_count = 100;

    machine->accept_state_count = 0;
    machine->accept_states = malloc(10 * sizeof(int));
    do {
        if (*input == ',') {
            input += 2;
        }
        sscanf(input, "%d", &machine->accept_states[machine->accept_state_count]);
        input += machine->accept_states[machine->accept_state_count] >= 10 ? 2 : 1;
        machine->accept_state_count += 1;
    } while (*input != ']');

    input += 13;
    machine->reject_state_count = 0;
    machine->reject_states = malloc(10 * sizeof(int));
    do {
        if (*input == ',') {
            input += 2;
        }
        sscanf(input, "%d", &machine->reject_states[machine->reject_state_count]);
        input += machine->reject_states[machine->reject_state_count] >= 10 ? 2 : 1;
        machine->reject_state_count += 1;
    } while (*input != ']');

    machine->symbol_count = 26;
    machine->symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    input += 1;
    machine->rule_count = 999;
    machine->rules = aligned_alloc(_Alignof(struct rule), machine->rule_count * sizeof(struct rule));
    for (int i = 0; i < machine->rule_count; ++i) {
        if (*input == 0) {
            machine->rule_count = i;
            break;
        }
        input += i >= 100 ? 10 : i >= 10 ? 9 : 8;
        sscanf(input, "%d", &machine->rules[i].before_state);
        input += machine->rules[i].before_state >= 10 ? 3 : 2;
        sscanf(input, "%c", &machine->rules[i].input_symbol);
        input += 3;
        sscanf(input, "%d", &machine->rules[i].after_state);
        input += machine->rules[i].after_state >= 10 ? 3 : 2;
        sscanf(input, "%c", &machine->rules[i].output_symbol);
        input += 2;
        machine->rules[i].move = *input == 'L' ? L : *input == 'R' ? R : accept_or_reject;
        input += 1;
    }
}

// input_method: random | input
// return 0 for no anwser, non 0 for step count
int solve(int solve_index, const char* input_method, int input_index) {
    struct machine machine;
    // case_original(&machine);
    if (strcmp(input_method, "random") == 0) {
        case_random(&machine);
    } else {
        case_input(&machine, input_index);
    }
    dprint_machine(&machine);

    struct instance instance;
    new_instance(&instance, &machine);
    if (!solve_instance(&instance)) {
        printf("no answer (solve#%d)\n", solve_index);
        drop_instance(&instance);
        drop_machine(&machine);
        return 0;
    } else {
        dprintf("answer (solve#%d): ", solve_index);
        dprint_tape(&instance);
        for (int i = instance.rule_history_count - 1; i >= 0; --i) {
            struct rule* rule = &machine.rules[instance.rule_history[i]];
            dprintf("  ");
            if (instance.tape[instance.head] != rule->input_symbol) {
                dprintf("!!incorrect input symbol!! ");
            }
            dprint_rule(rule);
            instance.state = rule->after_state;
            instance.tape[instance.head] = rule->output_symbol;
            instance.head += rule->move == L ? -1 : rule->move == R ? 1 : 0;
            dprintf(" => ");
            dprint_tape(&instance);
        }
        if (instance.head != INIT_HEAD) {
            dprintf("  !!incorrect end head!!\n");
        }
        int step_count = instance.rule_history_count;
        drop_instance(&instance);
        drop_machine(&machine);
        return step_count;
    }
}

int main(int argc, char** argv) {
    srand(time(NULL));

    // tulin input, or tulin random, or tulin random 100
    const char* input_method = "random";
    if (argc >= 2) {
        if (strcmp(argv[1], "input") == 0) {
            input_method = "input";
        } else if (strcmp(argv[1], "random") == 0) {
            // nothing
        } else {
            printf("invalid parameter");
            exit(1);
        }
    }

    int input_index = 1;
    int random_count = 1;
    if (strcmp(input_method, "random") == 0) {
        if (argc == 3) {
            random_count = atoi(argv[2]);
            if (random_count == 0) {
                random_count = 100;
            }
        } else {
            random_count = 100;
        }
    } else if (strcmp(input_method, "input") == 0) {
        if (argc == 3) {
            input_index = atoi(argv[2]);
            if (input_index < 1 || input_index > 6) {
                input_index = 6;
            }
        } else {
            input_index = 6;
        }
    }

    for (int solve_index = 0; solve_index < random_count; ++solve_index) {
        if (solve(solve_index, input_method, input_index) > 2) {
            printf("has interest answer!\n");
            break;
        }
    }
}

// function definition at bottom or else scroll through file is hard
// copy from terminal and regex replace \n with \\n\\$1
const char* INPUT1 = "machine:\n\
  accept: [63, 93, 86, 13, 35, 62, 27]\n\
  reject: [40]\n\
  #0: {0}L,{2}I,L\n\
  #1: {72}G,{29}B,L\n\
  #2: {87}F,{51}I,R\n\
  #3: {70}D,{18}F,R\n\
  #4: {62}E,{53}B,R\n\
  #5: {92}C,{37}C,R\n\
  #6: {94}G,{9}I,R\n\
  #7: {88}E,{41}B,L\n\
  #8: {17}E,{78}B,R\n\
  #9: {21}L,{43}H,R\n\
  #10: {2}B,{93}H,-\n\
  #11: {30}H,{99}I,L\n\
  #12: {6}K,{79}I,L\n\
  #13: {27}H,{39}I,L\n\
  #14: {8}B,{53}I,R\n\
  #15: {74}A,{41}K,R\n\
  #16: {33}H,{53}K,R\n\
  #17: {60}F,{48}E,L\n\
  #18: {33}G,{79}I,R\n\
  #19: {78}L,{13}B,-\n\
  #20: {91}J,{77}B,R\n\
  #21: {93}B,{77}B,L\n\
  #22: {43}I,{23}K,R\n\
  #23: {62}H,{70}L,L\n\
  #24: {82}E,{84}A,R\n\
  #25: {0}G,{30}L,L\n\
  #26: {0}L,{37}F,R\n\
  #27: {92}H,{65}C,R\n\
  #28: {55}F,{77}L,R\n\
  #29: {34}F,{19}E,R\n\
  #30: {18}C,{48}C,R\n\
  #31: {0}C,{61}D,L\n\
  #32: {49}D,{32}C,R\n\
  #33: {48}D,{31}J,R\n\
  #34: {56}J,{70}B,R\n\
  #35: {86}D,{49}F,R\n\
  #36: {77}L,{62}F,-\n\
  #37: {29}J,{30}H,R\n\
  #38: {13}B,{67}A,R\n\
  #39: {5}I,{66}E,L\n\
  #40: {31}B,{48}I,R\n\
  #41: {81}A,{50}E,R\n\
  #42: {8}I,{38}H,L\n\
  #43: {16}F,{96}C,R\n\
  #44: {62}L,{85}B,R\n\
  #45: {51}C,{71}J,R\n\
  #46: {63}I,{20}D,R\n\
  #47: {84}A,{13}D,-\n\
  #48: {97}H,{47}J,R\n\
  #49: {82}A,{29}L,R\n\
  #50: {79}E,{26}G,R\n\
  #51: {7}F,{40}C,-\n\
  #52: {29}F,{25}A,R\n\
  #53: {45}E,{67}G,R\n\
  #54: {80}J,{1}L,R\n\
  #55: {27}B,{98}L,R\n\
  #56: {50}I,{82}K,R\n\
  #57: {76}L,{98}C,L\n\
  #58: {96}L,{93}J,-\n\
  #59: {7}L,{18}L,R\n\
  #60: {0}A,{55}F,R\n\
  #61: {62}B,{52}D,R\n\
  #62: {48}G,{86}A,-\n\
  #63: {68}E,{50}A,R\n\
  #64: {48}G,{15}A,R\n\
  #65: {61}B,{53}A,R\n\
  #66: {20}H,{36}E,L\n\
  #67: {58}G,{60}L,R\n\
  #68: {44}H,{66}G,R\n\
  #69: {78}C,{57}F,L\n\
  #70: {41}B,{25}I,R\n\
  #71: {70}J,{95}D,R\n\
  #72: {31}I,{81}I,L\n\
  #73: {79}G,{2}D,R\n\
  #74: {21}L,{5}L,R\n\
  #75: {22}C,{15}I,L\n\
  #76: {10}J,{80}L,L\n\
  #77: {58}J,{3}C,R\n\
  #78: {93}J,{81}C,R\n\
  #79: {69}B,{87}I,L";

const char* INPUT2 = "machine:\n\
  accept: [13, 25, 4, 50, 59, 10, 74, 33, 63]\n\
  reject: [39]\n\
  #0: {0}K,{98}E,L\n\
  #1: {53}F,{68}G,R\n\
  #2: {55}D,{71}J,R\n\
  #3: {97}E,{51}H,L\n\
  #4: {89}A,{4}C,-\n\
  #5: {22}L,{4}F,-\n\
  #6: {0}I,{85}E,R\n\
  #7: {36}I,{42}F,R\n\
  #8: {10}D,{21}B,R\n\
  #9: {93}D,{25}C,-\n\
  #10: {71}J,{1}K,R\n\
  #11: {73}L,{64}I,R\n\
  #12: {21}B,{75}J,L\n\
  #13: {67}L,{70}L,L\n\
  #14: {11}F,{40}C,R\n\
  #15: {9}A,{19}E,R\n\
  #16: {62}A,{47}L,R\n\
  #17: {65}F,{73}C,L\n\
  #18: {0}D,{82}D,R\n\
  #19: {64}G,{31}H,R\n\
  #20: {9}K,{86}J,R\n\
  #21: {13}K,{37}E,R\n\
  #22: {7}G,{15}K,R\n\
  #23: {29}E,{51}H,R\n\
  #24: {88}H,{57}C,L\n\
  #25: {1}C,{76}I,R\n\
  #26: {9}F,{20}E,R\n\
  #27: {17}B,{57}G,L\n\
  #28: {60}K,{92}H,R\n\
  #29: {6}E,{44}B,R\n\
  #30: {98}J,{70}L,R\n\
  #31: {52}A,{53}E,L\n\
  #32: {75}K,{38}L,L\n\
  #33: {85}A,{51}K,R\n\
  #34: {96}C,{88}I,L\n\
  #35: {9}C,{89}J,R\n\
  #36: {53}E,{4}L,-\n\
  #37: {11}H,{28}I,L\n\
  #38: {8}J,{4}C,-\n\
  #39: {3}D,{92}I,R\n\
  #40: {95}G,{93}A,L\n\
  #41: {82}I,{73}L,R\n\
  #42: {15}I,{38}E,R\n\
  #43: {95}H,{16}C,R\n\
  #44: {88}H,{84}J,R\n\
  #45: {86}E,{6}H,R\n\
  #46: {77}K,{35}L,R\n\
  #47: {28}B,{3}B,R\n\
  #48: {34}I,{48}E,L\n\
  #49: {53}L,{84}J,L\n\
  #50: {7}J,{37}L,R\n\
  #51: {41}G,{22}H,R\n\
  #52: {23}F,{87}H,R\n\
  #53: {6}L,{5}F,R\n\
  #54: {53}L,{65}J,R\n\
  #55: {53}G,{43}F,R\n\
  #56: {33}J,{36}G,L\n\
  #57: {2}H,{22}F,R\n\
  #58: {83}A,{92}H,R\n\
  #59: {92}B,{98}F,R\n\
  #60: {95}G,{89}A,R\n\
  #61: {12}J,{62}L,R\n\
  #62: {41}A,{4}C,-\n\
  #63: {15}E,{32}G,R\n\
  #64: {57}B,{54}C,L\n\
  #65: {77}B,{29}K,R\n\
  #66: {26}I,{63}E,-\n\
  #67: {41}L,{36}G,L\n\
  #68: {98}F,{95}D,R\n\
  #69: {99}F,{21}A,R\n\
  #70: {51}L,{63}B,-\n\
  #71: {73}B,{82}H,L\n\
  #72: {12}F,{59}C,-\n\
  #73: {14}C,{71}H,R\n\
  #74: {7}F,{89}B,R\n\
  #75: {85}E,{89}A,R\n\
  #76: {62}A,{76}B,R\n\
  #77: {39}C,{77}B,R\n\
  #78: {80}A,{9}F,R\n\
  #79: {99}L,{89}G,R";


const char* INPUT3 = "machine:\n\
  accept: [98, 22, 4, 11]\n\
  reject: [68, 33, 56]\n\
  #0: {0}K,{32}G,L\n\
  #1: {61}L,{25}A,R\n\
  #2: {67}A,{21}K,L\n\
  #3: {87}G,{25}E,L\n\
  #4: {61}F,{29}B,L\n\
  #5: {3}F,{3}B,R\n\
  #6: {36}C,{88}E,R\n\
  #7: {26}K,{11}H,-\n\
  #8: {50}A,{70}C,R\n\
  #9: {32}G,{36}D,L\n\
  #10: {72}H,{97}G,L\n\
  #11: {78}G,{91}E,R\n\
  #12: {93}G,{1}H,R\n\
  #13: {21}H,{92}H,R\n\
  #14: {47}J,{39}C,R\n\
  #15: {88}C,{70}J,R\n\
  #16: {53}B,{32}K,R\n\
  #17: {20}J,{29}A,R\n\
  #18: {42}F,{27}L,R\n\
  #19: {93}J,{7}F,R\n\
  #20: {18}I,{30}B,R\n\
  #21: {42}G,{57}A,R\n\
  #22: {82}J,{28}L,R\n\
  #23: {48}H,{1}J,R\n\
  #24: {2}I,{60}B,R\n\
  #25: {72}C,{84}A,R\n\
  #26: {9}G,{47}D,R\n\
  #27: {2}B,{6}H,L\n\
  #28: {33}B,{66}B,R\n\
  #29: {86}B,{52}D,R\n\
  #30: {55}J,{67}I,R\n\
  #31: {86}I,{44}D,R\n\
  #32: {7}I,{71}H,R\n\
  #33: {79}J,{8}B,R\n\
  #34: {57}G,{65}L,L\n\
  #35: {78}G,{49}K,R\n\
  #36: {92}J,{43}L,R\n\
  #37: {13}F,{98}C,-\n\
  #38: {20}G,{17}E,R\n\
  #39: {24}H,{20}J,L\n\
  #40: {57}B,{96}L,R\n\
  #41: {72}L,{49}C,R\n\
  #42: {31}H,{56}E,-\n\
  #43: {30}D,{78}I,R\n\
  #44: {28}K,{85}G,L\n\
  #45: {89}I,{0}B,R\n\
  #46: {33}E,{22}D,-\n\
  #47: {53}B,{58}J,R\n\
  #48: {59}D,{80}G,L\n\
  #49: {88}C,{29}H,L\n\
  #50: {77}I,{20}D,R\n\
  #51: {19}K,{98}L,-\n\
  #52: {10}H,{75}E,R\n\
  #53: {97}L,{29}D,L\n\
  #54: {6}H,{52}J,R\n\
  #55: {46}H,{88}E,L\n\
  #56: {96}J,{73}E,R\n\
  #57: {8}J,{96}D,R\n\
  #58: {7}F,{47}H,R\n\
  #59: {23}A,{60}E,L\n\
  #60: {53}K,{51}B,R\n\
  #61: {3}D,{94}L,R\n\
  #62: {43}H,{17}E,R\n\
  #63: {94}J,{40}D,R\n\
  #64: {20}C,{29}L,L\n\
  #65: {7}K,{18}L,R\n\
  #66: {1}J,{56}E,-\n\
  #67: {78}L,{7}K,R\n\
  #68: {51}K,{24}K,R\n\
  #69: {93}C,{9}G,R\n\
  #70: {0}K,{62}D,R\n\
  #71: {81}E,{58}L,R\n\
  #72: {26}F,{12}L,L\n\
  #73: {16}B,{12}I,R\n\
  #74: {94}L,{5}C,R\n\
  #75: {20}H,{23}C,L\n\
  #76: {18}C,{7}E,L\n\
  #77: {59}G,{26}B,L\n\
  #78: {36}D,{11}E,-\n\
  #79: {46}A,{17}I,R";
const char* INPUT4 = "machine:\n\
  accept: [31, 59, 12, 42, 79]\n\
  reject: [74, 62]\n\
  #0: {0}G,{91}A,L\n\
  #1: {36}G,{55}L,L\n\
  #2: {99}I,{72}E,R\n\
  #3: {98}K,{25}C,R\n\
  #4: {13}F,{13}K,R\n\
  #5: {72}G,{67}L,L\n\
  #6: {93}J,{26}F,R\n\
  #7: {67}B,{44}G,R\n\
  #8: {85}J,{16}K,R\n\
  #9: {11}A,{28}B,R\n\
  #10: {89}G,{51}K,R\n\
  #11: {76}L,{79}L,-\n\
  #12: {78}D,{88}A,L\n\
  #13: {25}B,{64}G,L\n\
  #14: {39}D,{31}E,-\n\
  #15: {11}B,{58}H,R\n\
  #16: {86}A,{59}H,-\n\
  #17: {66}D,{77}D,R\n\
  #18: {4}K,{34}L,R\n\
  #19: {74}L,{22}E,L\n\
  #20: {39}C,{22}G,R\n\
  #21: {5}C,{53}G,R\n\
  #22: {28}H,{42}A,-\n\
  #23: {6}F,{6}B,L\n\
  #24: {33}A,{3}H,R\n\
  #25: {86}A,{17}B,R\n\
  #26: {69}G,{34}L,R\n\
  #27: {16}J,{73}G,R\n\
  #28: {19}H,{94}K,R\n\
  #29: {34}I,{31}E,-\n\
  #30: {90}C,{78}C,L\n\
  #31: {21}J,{24}C,R\n\
  #32: {89}F,{79}H,-\n\
  #33: {19}K,{3}H,R\n\
  #34: {28}B,{25}D,R\n\
  #35: {19}F,{78}F,R\n\
  #36: {61}C,{80}L,R\n\
  #37: {30}E,{49}H,R\n\
  #38: {91}J,{42}I,-\n\
  #39: {64}B,{95}H,R\n\
  #40: {30}C,{13}A,R\n\
  #41: {13}A,{71}G,R\n\
  #42: {77}A,{87}D,R\n\
  #43: {30}H,{31}H,-\n\
  #44: {8}G,{11}I,L\n\
  #45: {5}E,{8}H,L\n\
  #46: {23}I,{6}C,R\n\
  #47: {38}G,{46}L,R\n\
  #48: {77}J,{2}F,R\n\
  #49: {81}C,{83}A,L\n\
  #50: {94}J,{87}G,R\n\
  #51: {31}L,{33}I,L\n\
  #52: {9}H,{18}E,R\n\
  #53: {4}K,{19}G,R\n\
  #54: {45}L,{59}D,-\n\
  #55: {29}A,{81}H,R\n\
  #56: {73}I,{94}K,R\n\
  #57: {0}H,{63}J,R\n\
  #58: {14}K,{90}E,R\n\
  #59: {60}E,{1}L,R\n\
  #60: {46}I,{74}J,-\n\
  #61: {76}H,{21}F,R\n\
  #62: {21}G,{90}D,R\n\
  #63: {38}H,{88}B,L\n\
  #64: {53}A,{96}I,R\n\
  #65: {81}K,{94}J,L\n\
  #66: {26}A,{74}G,-\n\
  #67: {39}D,{30}K,R\n\
  #68: {39}B,{78}C,R\n\
  #69: {93}L,{53}I,R\n\
  #70: {74}K,{77}K,R\n\
  #71: {57}J,{24}D,R\n\
  #72: {97}L,{73}C,R\n\
  #73: {28}F,{64}G,R\n\
  #74: {21}C,{68}D,R\n\
  #75: {84}E,{3}B,R\n\
  #76: {74}A,{3}L,L\n\
  #77: {46}A,{35}G,R\n\
  #78: {83}H,{3}E,R\n\
  #79: {36}A,{34}A,L\n\
  #80: {30}K,{93}C,R\n\
  #81: {65}K,{70}E,L\n\
  #82: {78}K,{92}F,R\n\
  #83: {74}L,{62}K,-\n\
  #84: {53}K,{93}F,R\n\
  #85: {1}G,{45}G,L\n\
  #86: {98}F,{75}I,R\n\
  #87: {25}B,{95}E,R\n\
  #88: {15}E,{98}F,R\n\
  #89: {31}D,{58}L,R\n\
  #90: {68}I,{32}F,L\n\
  #91: {42}L,{48}L,R\n\
  #92: {93}J,{42}A,-\n\
  #93: {65}A,{45}L,R\n\
  #94: {9}C,{86}F,R\n\
  #95: {99}F,{68}H,R\n\
  #96: {31}F,{12}L,-\n\
  #97: {73}K,{89}D,L\n\
  #98: {37}H,{50}G,R\n\
  #99: {92}K,{14}A,R\n\
  #100: {81}H,{9}H,R\n\
  #101: {10}E,{24}E,R\n\
  #102: {39}I,{55}E,R\n\
  #103: {2}G,{82}D,R\n\
  #104: {75}I,{84}J,R\n\
  #105: {33}J,{16}H,R\n\
  #106: {16}A,{24}B,L\n\
  #107: {49}D,{3}G,R\n\
  #108: {79}F,{27}C,L\n\
  #109: {32}J,{4}C,R\n\
  #110: {29}G,{65}G,R\n\
  #111: {31}L,{93}I,L\n\
  #112: {82}E,{30}D,L\n\
  #113: {29}E,{32}B,R\n\
  #114: {68}E,{52}L,L\n\
  #115: {50}L,{40}G,L\n\
  #116: {24}H,{92}B,R\n\
  #117: {63}J,{48}E,R\n\
  #118: {98}D,{93}I,R\n\
  #119: {86}G,{58}G,R\n\
  #120: {45}K,{7}B,L\n\
  #121: {58}L,{17}C,R\n\
  #122: {15}H,{40}D,R\n\
  #123: {42}H,{93}C,R\n\
  #124: {18}F,{22}D,R\n\
  #125: {72}B,{31}D,-\n\
  #126: {20}K,{28}K,R\n\
  #127: {29}E,{92}A,R\n\
  #128: {95}J,{33}K,L\n\
  #129: {93}G,{71}E,R\n\
  #130: {14}H,{6}D,R\n\
  #131: {70}I,{42}D,-\n\
  #132: {12}F,{43}K,R\n\
  #133: {54}E,{34}G,R\n\
  #134: {14}I,{12}L,-\n\
  #135: {54}G,{29}H,L\n\
  #136: {52}L,{12}G,-\n\
  #137: {62}H,{77}A,R\n\
  #138: {58}D,{64}G,R\n\
  #139: {8}E,{58}K,R\n\
  #140: {44}I,{50}H,L\n\
  #141: {62}G,{95}A,R\n\
  #142: {94}E,{96}F,L\n\
  #143: {14}D,{12}E,-\n\
  #144: {4}B,{2}D,R\n\
  #145: {72}D,{77}I,L\n\
  #146: {43}J,{38}E,R\n\
  #147: {49}B,{29}D,R\n\
  #148: {29}L,{42}G,-\n\
  #149: {3}L,{95}B,R\n\
  #150: {7}J,{26}I,R\n\
  #151: {57}B,{39}B,R\n\
  #152: {24}K,{6}J,R\n\
  #153: {18}F,{25}L,L\n\
  #154: {89}L,{20}I,R\n\
  #155: {26}H,{16}J,R\n\
  #156: {39}I,{86}F,L\n\
  #157: {1}L,{25}B,R\n\
  #158: {88}J,{6}L,R\n\
  #159: {83}B,{19}I,L\n\
  #160: {10}F,{60}K,R\n\
  #161: {26}E,{96}C,L\n\
  #162: {69}F,{61}L,R\n\
  #163: {5}E,{26}C,R\n\
  #164: {98}L,{70}I,R\n\
  #165: {81}H,{35}A,R\n\
  #166: {24}C,{97}J,L\n\
  #167: {95}L,{56}L,R\n\
  #168: {37}E,{91}C,R\n\
  #169: {94}L,{28}A,L\n\
  #170: {81}G,{57}I,R\n\
  #171: {27}B,{14}G,R\n\
  #172: {14}L,{4}L,R\n\
  #173: {0}K,{43}J,R\n\
  #174: {52}K,{66}D,R\n\
  #175: {86}B,{0}G,R\n\
  #176: {86}H,{31}H,-\n\
  #177: {51}C,{74}E,-\n\
  #178: {24}J,{26}C,L\n\
  #179: {82}B,{8}K,R\n\
  #180: {3}H,{18}L,L\n\
  #181: {84}D,{87}C,R\n\
  #182: {87}A,{58}G,L\n\
  #183: {41}F,{87}D,R\n\
  #184: {76}L,{37}C,R\n\
  #185: {17}A,{71}F,R\n\
  #186: {87}I,{66}B,L\n\
  #187: {56}J,{42}H,-\n\
  #188: {12}D,{34}I,L\n\
  #189: {60}E,{38}G,R\n\
  #190: {90}K,{48}B,R\n\
  #191: {2}H,{40}C,R\n\
  #192: {69}A,{41}J,L\n\
  #193: {46}I,{34}H,L\n\
  #194: {81}D,{22}I,R\n\
  #195: {71}I,{88}J,R\n\
  #196: {60}L,{0}E,R\n\
  #197: {23}G,{0}D,R\n\
  #198: {6}E,{69}L,L\n\
  #199: {47}J,{26}G,L\n\
  #200: {9}L,{36}H,L\n\
  #201: {40}K,{12}A,-\n\
  #202: {63}C,{41}L,L\n\
  #203: {53}I,{2}E,R\n\
  #204: {18}E,{42}K,-\n\
  #205: {45}J,{40}F,L\n\
  #206: {66}L,{22}L,L\n\
  #207: {10}G,{78}C,R\n\
  #208: {90}H,{27}A,R\n\
  #209: {94}L,{77}G,R\n\
  #210: {97}G,{20}K,R\n\
  #211: {74}L,{49}K,R\n\
  #212: {87}A,{43}C,R\n\
  #213: {38}E,{69}A,L\n\
  #214: {33}C,{6}F,L\n\
  #215: {30}L,{78}D,R\n\
  #216: {80}J,{56}I,R\n\
  #217: {65}K,{54}C,R\n\
  #218: {71}C,{77}G,R\n\
  #219: {89}I,{88}G,R\n\
  #220: {63}E,{82}F,R\n\
  #221: {61}H,{64}L,R\n\
  #222: {54}H,{16}D,L\n\
  #223: {99}A,{5}J,R\n\
  #224: {50}I,{48}I,L\n\
  #225: {64}B,{95}F,L\n\
  #226: {20}E,{71}C,R\n\
  #227: {28}H,{89}J,R\n\
  #228: {0}H,{29}A,R\n\
  #229: {4}H,{90}C,R\n\
  #230: {85}I,{45}F,R\n\
  #231: {36}K,{65}I,R\n\
  #232: {45}I,{71}I,R\n\
  #233: {9}B,{26}L,R\n\
  #234: {32}H,{93}K,R\n\
  #235: {56}C,{35}G,L\n\
  #236: {56}D,{45}C,R\n\
  #237: {89}G,{67}H,L\n\
  #238: {22}A,{34}B,R\n\
  #239: {97}L,{21}H,R";
const char* INPUT5 = "machine:\n\
  accept: [31, 59, 12, 42, 79]\n\
  reject: [74, 62]\n\
  #0: {0}G,{91}A,L\n\
  #1: {36}G,{55}L,L\n\
  #2: {99}I,{72}E,R\n\
  #3: {98}K,{25}C,R\n\
  #4: {13}F,{13}K,R\n\
  #5: {72}G,{67}L,L\n\
  #6: {93}J,{26}F,R\n\
  #7: {67}B,{44}G,R\n\
  #8: {85}J,{16}K,R\n\
  #9: {11}A,{28}B,R\n\
  #10: {89}G,{51}K,R\n\
  #11: {76}L,{79}L,-\n\
  #12: {78}D,{88}A,L\n\
  #13: {25}B,{64}G,L\n\
  #14: {39}D,{31}E,-\n\
  #15: {11}B,{58}H,R\n\
  #16: {86}A,{59}H,-\n\
  #17: {66}D,{77}D,R\n\
  #18: {4}K,{34}L,R\n\
  #19: {74}L,{22}E,L\n\
  #20: {39}C,{22}G,R\n\
  #21: {5}C,{53}G,R\n\
  #22: {28}H,{42}A,-\n\
  #23: {6}F,{6}B,L\n\
  #24: {33}A,{3}H,R\n\
  #25: {86}A,{17}B,R\n\
  #26: {69}G,{34}L,R\n\
  #27: {16}J,{73}G,R\n\
  #28: {19}H,{94}K,R\n\
  #29: {34}I,{31}E,-\n\
  #30: {90}C,{78}C,L\n\
  #31: {21}J,{24}C,R\n\
  #32: {89}F,{79}H,-\n\
  #33: {19}K,{3}H,R\n\
  #34: {28}B,{25}D,R\n\
  #35: {19}F,{78}F,R\n\
  #36: {61}C,{80}L,R\n\
  #37: {30}E,{49}H,R\n\
  #38: {91}J,{42}I,-\n\
  #39: {64}B,{95}H,R\n\
  #40: {30}C,{13}A,R\n\
  #41: {13}A,{71}G,R\n\
  #42: {77}A,{87}D,R\n\
  #43: {30}H,{31}H,-\n\
  #44: {8}G,{11}I,L\n\
  #45: {5}E,{8}H,L\n\
  #46: {23}I,{6}C,R\n\
  #47: {38}G,{46}L,R\n\
  #48: {77}J,{2}F,R\n\
  #49: {81}C,{83}A,L\n\
  #50: {94}J,{87}G,R\n\
  #51: {31}L,{33}I,L\n\
  #52: {9}H,{18}E,R\n\
  #53: {4}K,{19}G,R\n\
  #54: {45}L,{59}D,-\n\
  #55: {29}A,{81}H,R\n\
  #56: {73}I,{94}K,R\n\
  #57: {0}H,{63}J,R\n\
  #58: {14}K,{90}E,R\n\
  #59: {60}E,{1}L,R\n\
  #60: {46}I,{74}J,-\n\
  #61: {76}H,{21}F,R\n\
  #62: {21}G,{90}D,R\n\
  #63: {38}H,{88}B,L\n\
  #64: {53}A,{96}I,R\n\
  #65: {81}K,{94}J,L\n\
  #66: {26}A,{74}G,-\n\
  #67: {39}D,{30}K,R\n\
  #68: {39}B,{78}C,R\n\
  #69: {93}L,{53}I,R\n\
  #70: {74}K,{77}K,R\n\
  #71: {57}J,{24}D,R\n\
  #72: {97}L,{73}C,R\n\
  #73: {28}F,{64}G,R\n\
  #74: {21}C,{68}D,R\n\
  #75: {84}E,{3}B,R\n\
  #76: {74}A,{3}L,L\n\
  #77: {46}A,{35}G,R\n\
  #78: {83}H,{3}E,R\n\
  #79: {36}A,{34}A,L\n\
  #80: {30}K,{93}C,R\n\
  #81: {65}K,{70}E,L\n\
  #82: {78}K,{92}F,R\n\
  #83: {74}L,{62}K,-\n\
  #84: {53}K,{93}F,R\n\
  #85: {1}G,{45}G,L\n\
  #86: {98}F,{75}I,R\n\
  #87: {25}B,{95}E,R\n\
  #88: {15}E,{98}F,R\n\
  #89: {31}D,{58}L,R\n\
  #90: {68}I,{32}F,L\n\
  #91: {42}L,{48}L,R\n\
  #92: {93}J,{42}A,-\n\
  #93: {65}A,{45}L,R\n\
  #94: {9}C,{86}F,R\n\
  #95: {99}F,{68}H,R\n\
  #96: {31}F,{12}L,-\n\
  #97: {73}K,{89}D,L\n\
  #98: {37}H,{50}G,R\n\
  #99: {92}K,{14}A,R\n\
  #100: {81}H,{9}H,R\n\
  #101: {10}E,{24}E,R\n\
  #102: {39}I,{55}E,R\n\
  #103: {2}G,{82}D,R\n\
  #104: {75}I,{84}J,R\n\
  #105: {33}J,{16}H,R\n\
  #106: {16}A,{24}B,L\n\
  #107: {49}D,{3}G,R\n\
  #108: {79}F,{27}C,L\n\
  #109: {32}J,{4}C,R\n\
  #110: {29}G,{65}G,R\n\
  #111: {31}L,{93}I,L\n\
  #112: {82}E,{30}D,L\n\
  #113: {29}E,{32}B,R\n\
  #114: {68}E,{52}L,L\n\
  #115: {50}L,{40}G,L\n\
  #116: {24}H,{92}B,R\n\
  #117: {63}J,{48}E,R\n\
  #118: {98}D,{93}I,R\n\
  #119: {86}G,{58}G,R\n\
  #120: {45}K,{7}B,L\n\
  #121: {58}L,{17}C,R\n\
  #122: {15}H,{40}D,R\n\
  #123: {42}H,{93}C,R\n\
  #124: {18}F,{22}D,R\n\
  #125: {72}B,{31}D,-\n\
  #126: {20}K,{28}K,R\n\
  #127: {29}E,{92}A,R\n\
  #128: {95}J,{33}K,L\n\
  #129: {93}G,{71}E,R\n\
  #130: {14}H,{6}D,R\n\
  #131: {70}I,{42}D,-\n\
  #132: {12}F,{43}K,R\n\
  #133: {54}E,{34}G,R\n\
  #134: {14}I,{12}L,-\n\
  #135: {54}G,{29}H,L\n\
  #136: {52}L,{12}G,-\n\
  #137: {62}H,{77}A,R\n\
  #138: {58}D,{64}G,R\n\
  #139: {8}E,{58}K,R\n\
  #140: {44}I,{50}H,L\n\
  #141: {62}G,{95}A,R\n\
  #142: {94}E,{96}F,L\n\
  #143: {14}D,{12}E,-\n\
  #144: {4}B,{2}D,R\n\
  #145: {72}D,{77}I,L\n\
  #146: {43}J,{38}E,R\n\
  #147: {49}B,{29}D,R\n\
  #148: {29}L,{42}G,-\n\
  #149: {3}L,{95}B,R\n\
  #150: {7}J,{26}I,R\n\
  #151: {57}B,{39}B,R\n\
  #152: {24}K,{6}J,R\n\
  #153: {18}F,{25}L,L\n\
  #154: {89}L,{20}I,R\n\
  #155: {26}H,{16}J,R\n\
  #156: {39}I,{86}F,L\n\
  #157: {1}L,{25}B,R\n\
  #158: {88}J,{6}L,R\n\
  #159: {83}B,{19}I,L\n\
  #160: {10}F,{60}K,R\n\
  #161: {26}E,{96}C,L\n\
  #162: {69}F,{61}L,R\n\
  #163: {5}E,{26}C,R\n\
  #164: {98}L,{70}I,R\n\
  #165: {81}H,{35}A,R\n\
  #166: {24}C,{97}J,L\n\
  #167: {95}L,{56}L,R\n\
  #168: {37}E,{91}C,R\n\
  #169: {94}L,{28}A,L\n\
  #170: {81}G,{57}I,R\n\
  #171: {27}B,{14}G,R\n\
  #172: {14}L,{4}L,R\n\
  #173: {0}K,{43}J,R\n\
  #174: {52}K,{66}D,R\n\
  #175: {86}B,{0}G,R\n\
  #176: {86}H,{31}H,-\n\
  #177: {51}C,{74}E,-\n\
  #178: {24}J,{26}C,L\n\
  #179: {82}B,{8}K,R\n\
  #180: {3}H,{18}L,L\n\
  #181: {84}D,{87}C,R\n\
  #182: {87}A,{58}G,L\n\
  #183: {41}F,{87}D,R\n\
  #184: {76}L,{37}C,R\n\
  #185: {17}A,{71}F,R\n\
  #186: {87}I,{66}B,L\n\
  #187: {56}J,{42}H,-\n\
  #188: {12}D,{34}I,L\n\
  #189: {60}E,{38}G,R\n\
  #190: {90}K,{48}B,R\n\
  #191: {2}H,{40}C,R\n\
  #192: {69}A,{41}J,L\n\
  #193: {46}I,{34}H,L\n\
  #194: {81}D,{22}I,R\n\
  #195: {71}I,{88}J,R\n\
  #196: {60}L,{0}E,R\n\
  #197: {23}G,{0}D,R\n\
  #198: {6}E,{69}L,L\n\
  #199: {47}J,{26}G,L\n\
  #200: {9}L,{36}H,L\n\
  #201: {40}K,{12}A,-\n\
  #202: {63}C,{41}L,L\n\
  #203: {53}I,{2}E,R\n\
  #204: {18}E,{42}K,-\n\
  #205: {45}J,{40}F,L\n\
  #206: {66}L,{22}L,L\n\
  #207: {10}G,{78}C,R\n\
  #208: {90}H,{27}A,R\n\
  #209: {94}L,{77}G,R\n\
  #210: {97}G,{20}K,R\n\
  #211: {74}L,{49}K,R\n\
  #212: {87}A,{43}C,R\n\
  #213: {38}E,{69}A,L\n\
  #214: {33}C,{6}F,L\n\
  #215: {30}L,{78}D,R\n\
  #216: {80}J,{56}I,R\n\
  #217: {65}K,{54}C,R\n\
  #218: {71}C,{77}G,R\n\
  #219: {89}I,{88}G,R\n\
  #220: {63}E,{82}F,R\n\
  #221: {61}H,{64}L,R\n\
  #222: {54}H,{16}D,L\n\
  #223: {99}A,{5}J,R\n\
  #224: {50}I,{48}I,L\n\
  #225: {64}B,{95}F,L\n\
  #226: {20}E,{71}C,R\n\
  #227: {28}H,{89}J,R\n\
  #228: {0}H,{29}A,R\n\
  #229: {4}H,{90}C,R\n\
  #230: {85}I,{45}F,R\n\
  #231: {36}K,{65}I,R\n\
  #232: {45}I,{71}I,R\n\
  #233: {9}B,{26}L,R\n\
  #234: {32}H,{93}K,R\n\
  #235: {56}C,{35}G,L\n\
  #236: {56}D,{45}C,R\n\
  #237: {89}G,{67}H,L\n\
  #238: {22}A,{34}B,R\n\
  #239: {97}L,{21}H,R";
const char* INPUT6 = "machine:\n\
  accept: [7, 22]\n\
  reject: [11, 2, 0, 21]\n\
  #0: {0}K,{0}H,-\n\
  #1: {3}I,{7}L,-\n\
  #2: {15}I,{12}D,R\n\
  #3: {18}C,{18}E,L\n\
  #4: {17}H,{12}F,R\n\
  #5: {40}G,{33}C,L\n\
  #6: {2}C,{3}F,L\n\
  #7: {1}F,{10}I,R\n\
  #8: {32}L,{20}I,L\n\
  #9: {39}B,{27}H,L\n\
  #10: {20}K,{40}H,L\n\
  #11: {26}L,{7}J,-\n\
  #12: {7}K,{17}I,L\n\
  #13: {39}B,{13}C,L\n\
  #14: {15}A,{29}I,L\n\
  #15: {32}D,{14}D,L\n\
  #16: {27}A,{12}B,R\n\
  #17: {41}B,{41}K,R\n\
  #18: {15}E,{31}I,R\n\
  #19: {3}J,{7}E,-\n\
  #20: {21}K,{30}E,R\n\
  #21: {20}L,{22}J,-\n\
  #22: {11}B,{19}C,L\n\
  #23: {32}H,{22}B,-\n\
  #24: {20}C,{16}D,L\n\
  #25: {8}E,{23}A,R\n\
  #26: {9}F,{1}A,R\n\
  #27: {31}I,{21}E,-\n\
  #28: {5}B,{37}K,L\n\
  #29: {15}E,{34}J,L\n\
  #30: {12}C,{36}I,R\n\
  #31: {33}H,{12}H,R\n\
  #32: {34}K,{14}D,R\n\
  #33: {0}D,{37}B,L\n\
  #34: {5}A,{30}F,L\n\
  #35: {18}A,{37}K,L\n\
  #36: {13}F,{3}A,L\n\
  #37: {10}D,{37}I,L\n\
  #38: {0}H,{19}A,L\n\
  #39: {23}A,{41}H,L\n\
  #40: {30}K,{30}A,R\n\
  #41: {15}K,{31}E,L\n\
  #42: {2}E,{22}A,-\n\
  #43: {26}D,{14}D,R\n\
  #44: {34}G,{26}F,R\n\
  #45: {38}A,{33}B,L\n\
  #46: {10}G,{21}B,-\n\
  #47: {10}J,{8}F,R\n\
  #48: {40}K,{29}E,R\n\
  #49: {9}E,{38}G,R\n\
  #50: {17}D,{9}E,L\n\
  #51: {12}I,{6}G,L\n\
  #52: {11}A,{22}D,-\n\
  #53: {21}D,{0}L,-\n\
  #54: {17}F,{3}H,L\n\
  #55: {32}A,{25}L,L\n\
  #56: {21}J,{33}B,R\n\
  #57: {40}F,{32}K,R\n\
  #58: {36}F,{34}J,L\n\
  #59: {14}A,{36}J,L\n\
  #60: {9}J,{16}E,L\n\
  #61: {29}A,{20}H,R\n\
  #62: {33}C,{35}E,R\n\
  #63: {15}I,{30}J,L\n\
  #64: {11}J,{5}K,L\n\
  #65: {20}E,{35}H,L\n\
  #66: {27}I,{33}B,R\n\
  #67: {41}H,{29}A,L\n\
  #68: {25}J,{32}G,R\n\
  #69: {18}H,{9}E,L\n\
  #70: {37}K,{32}H,L\n\
  #71: {31}H,{34}E,R\n\
  #72: {28}H,{7}B,-\n\
  #73: {9}A,{19}I,R\n\
  #74: {37}C,{6}C,L\n\
  #75: {22}D,{2}A,-\n\
  #76: {40}L,{5}L,R\n\
  #77: {35}G,{39}A,R\n\
  #78: {29}I,{40}E,R\n\
  #79: {5}J,{17}L,L\n\
  #80: {13}J,{3}H,R\n\
  #81: {5}F,{8}A,R\n\
  #82: {18}E,{41}F,L\n\
  #83: {18}E,{20}B,R\n\
  #84: {32}G,{41}F,L\n\
  #85: {7}E,{6}G,L\n\
  #86: {14}L,{11}K,-\n\
  #87: {0}A,{19}E,L\n\
  #88: {14}I,{18}A,L\n\
  #89: {39}E,{41}C,L\n\
  #90: {12}D,{1}K,R\n\
  #91: {30}F,{12}J,L\n\
  #92: {34}F,{41}E,R\n\
  #93: {13}C,{14}J,R\n\
  #94: {15}F,{0}D,-\n\
  #95: {11}F,{31}C,R\n\
  #96: {1}B,{32}C,L\n\
  #97: {41}G,{1}E,R\n\
  #98: {22}B,{17}H,L\n\
  #99: {1}J,{16}H,R\n\
  #100: {7}G,{38}A,R\n\
  #101: {28}J,{20}D,R\n\
  #102: {40}C,{34}L,L\n\
  #103: {5}C,{32}G,R\n\
  #104: {13}I,{11}E,-\n\
  #105: {15}H,{29}E,L\n\
  #106: {10}D,{34}K,R\n\
  #107: {2}H,{26}K,R\n\
  #108: {39}B,{21}F,-\n\
  #109: {36}C,{31}D,R\n\
  #110: {19}J,{36}C,L\n\
  #111: {5}G,{40}F,R\n\
  #112: {20}C,{14}L,L\n\
  #113: {22}B,{37}J,R\n\
  #114: {17}K,{40}H,L\n\
  #115: {9}F,{38}C,L\n\
  #116: {29}K,{9}L,L\n\
  #117: {36}J,{21}C,-\n\
  #118: {0}G,{10}I,L\n\
  #119: {31}H,{15}D,L\n\
  #120: {0}E,{8}F,L\n\
  #121: {25}L,{16}A,L\n\
  #122: {13}I,{24}L,R\n\
  #123: {4}H,{1}B,L\n\
  #124: {33}H,{33}H,R\n\
  #125: {27}B,{27}A,R\n\
  #126: {16}L,{6}G,L\n\
  #127: {13}C,{9}A,L\n\
  #128: {2}F,{1}D,L\n\
  #129: {10}L,{15}A,L\n\
  #130: {26}J,{5}D,R\n\
  #131: {36}G,{32}J,R\n\
  #132: {28}H,{40}C,R\n\
  #133: {6}I,{24}B,L\n\
  #134: {24}D,{29}F,L\n\
  #135: {13}C,{25}E,L\n\
  #136: {1}K,{3}A,L\n\
  #137: {4}L,{24}G,L\n\
  #138: {21}I,{14}F,L\n\
  #139: {30}L,{11}G,-\n\
  #140: {34}L,{34}L,L\n\
  #141: {14}C,{41}E,L\n\
  #142: {27}K,{27}A,L\n\
  #143: {31}B,{10}A,R\n\
  #144: {2}B,{20}J,R\n\
  #145: {37}A,{7}E,-\n\
  #146: {41}F,{8}K,R\n\
  #147: {12}C,{21}C,-\n\
  #148: {25}H,{39}I,R\n\
  #149: {24}I,{35}I,L\n\
  #150: {1}A,{19}J,R\n\
  #151: {40}G,{26}J,L\n\
  #152: {33}C,{9}C,L\n\
  #153: {7}E,{26}J,L\n\
  #154: {38}I,{19}G,R\n\
  #155: {6}E,{23}D,L\n\
  #156: {41}E,{29}H,L\n\
  #157: {36}D,{24}J,R\n\
  #158: {35}K,{12}I,L\n\
  #159: {27}E,{33}D,L\n\
  #160: {26}A,{14}D,L\n\
  #161: {35}I,{14}I,L\n\
  #162: {1}I,{0}E,-\n\
  #163: {31}G,{22}K,-\n\
  #164: {24}L,{6}J,R\n\
  #165: {19}G,{27}C,L\n\
  #166: {16}J,{23}E,R\n\
  #167: {37}A,{11}E,-\n\
  #168: {8}G,{1}D,R\n\
  #169: {15}D,{9}I,L\n\
  #170: {31}K,{32}H,L\n\
  #171: {3}J,{29}H,L\n\
  #172: {29}J,{38}J,R\n\
  #173: {36}K,{20}A,R\n\
  #174: {7}A,{2}A,-\n\
  #175: {10}F,{19}L,R\n\
  #176: {21}B,{19}H,L\n\
  #177: {6}D,{16}J,L\n\
  #178: {36}B,{6}D,L\n\
  #179: {1}E,{16}A,R\n\
  #180: {10}C,{6}D,R\n\
  #181: {10}H,{13}D,R\n\
  #182: {3}A,{17}C,L\n\
  #183: {30}D,{20}L,R\n\
  #184: {39}F,{12}I,L\n\
  #185: {33}J,{15}F,L\n\
  #186: {14}I,{3}G,R\n\
  #187: {35}E,{40}E,R\n\
  #188: {32}B,{15}I,L\n\
  #189: {0}I,{11}I,-\n\
  #190: {1}D,{16}E,L\n\
  #191: {16}J,{41}B,L\n\
  #192: {2}H,{18}K,L\n\
  #193: {36}J,{26}I,L\n\
  #194: {30}H,{28}G,L\n\
  #195: {34}C,{2}A,-\n\
  #196: {29}I,{30}I,L\n\
  #197: {26}K,{8}F,R\n\
  #198: {26}D,{35}J,R\n\
  #199: {8}L,{31}F,R\n\
  #200: {7}F,{16}A,L\n\
  #201: {10}C,{17}E,L\n\
  #202: {3}J,{19}J,R\n\
  #203: {11}G,{31}A,R\n\
  #204: {20}C,{13}I,R\n\
  #205: {8}E,{18}C,L\n\
  #206: {6}D,{22}K,-\n\
  #207: {38}L,{30}C,L\n\
  #208: {14}B,{24}F,L\n\
  #209: {13}G,{15}B,R\n\
  #210: {31}F,{34}B,L\n\
  #211: {4}E,{0}A,-\n\
  #212: {23}G,{6}J,R\n\
  #213: {28}H,{34}I,L\n\
  #214: {24}E,{7}F,-\n\
  #215: {32}E,{17}K,R\n\
  #216: {31}L,{28}I,R\n\
  #217: {19}K,{6}F,R\n\
  #218: {5}K,{35}L,R\n\
  #219: {18}B,{38}B,L\n\
  #220: {26}A,{10}B,L\n\
  #221: {21}H,{15}H,L\n\
  #222: {32}I,{21}G,-\n\
  #223: {2}F,{37}G,L\n\
  #224: {17}B,{3}D,L\n\
  #225: {0}L,{35}I,R\n\
  #226: {16}L,{8}L,R\n\
  #227: {3}K,{11}I,-\n\
  #228: {32}A,{14}I,R\n\
  #229: {33}G,{32}A,R\n\
  #230: {3}K,{5}I,L\n\
  #231: {24}G,{24}F,R\n\
  #232: {20}E,{8}L,L\n\
  #233: {41}D,{1}D,R\n\
  #234: {28}J,{6}E,R\n\
  #235: {36}H,{16}I,L\n\
  #236: {4}L,{34}J,L\n\
  #237: {15}D,{12}H,R\n\
  #238: {1}H,{34}D,L\n\
  #239: {33}I,{2}C,-";
const char* get_input(int input_index) {
    const char* INPUTS[] = {"", INPUT1, INPUT2, INPUT3, INPUT4, INPUT5, INPUT6};
    return INPUTS[input_index];
}
