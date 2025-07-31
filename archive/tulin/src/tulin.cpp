#include <vector>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <cstring>
#include <algorithm>
#include <time.h>
#include <fmt/format.h>

#define dprintf(...) printf(__VA_ARGS__)

using direction_t = uint8_t;
constexpr const direction_t L = 1;
constexpr const direction_t R = 2;
constexpr const direction_t F = 3; // final

using state_t = uint16_t; // max=10000
using symbol_t = char;

struct rule_t {
    state_t before_state;
    symbol_t input_symbol;
    state_t after_state;
    symbol_t output_symbol;
    direction_t direction;

    rule_t(state_t s0, symbol_t c0, state_t s1, symbol_t c1, direction_t direction)
        : before_state(s0), input_symbol(c1), after_state(s1), output_symbol(c1), direction(direction)
    {
    }
};

template<> struct fmt::formatter<rule_t> {
    constexpr auto parse(format_parse_context& ctx) -> decltype(ctx.end()) {
        return ctx.end();
    }
    template<typename FormatContext>
    auto format(const rule_t& self, FormatContext& ctx) const -> decltype(ctx.out()) {
        return fmt::format_to(ctx.out(), "{{{0}}}{1},{{{2}}}{3},{4}",
            self.before_state, self.input_symbol, self.after_state, self.output_symbol, self.direction == L ? 'L' : self.direction == R ? 'R' : '-');
    }
};

struct machine_t {
    // state count is not important, or allow all numbers in uint16_t
    // symbol count is not important, symbols are fixed one length letter
    std::vector<state_t> accept_states;
    std::vector<state_t> reject_states;
    std::vector<rule_t> rules;

    auto is_accept(state_t state) const -> bool {
        return std::find(this->accept_states.begin(), this->accept_states.end(), state) != this->accept_states.end();
    }
    auto is_reject(state_t state) const -> bool {
        return std::find(this->reject_states.begin(), this->accept_states.end(), state) != this->reject_states.end();
    }
};

template<> struct fmt::formatter<machine_t> {
    constexpr auto parse(format_parse_context& ctx) -> decltype(ctx.end()) {
        return ctx.end();
    }
    template<typename FormatContext>
    auto format(const machine_t& self, FormatContext& ctx) const -> decltype(ctx.out()) {
        fmt::format_to(ctx.out(), "machine:\n");
        fmt::format_to(ctx.out(), "  accept: [{}]\n", fmt::join(self.accept_states, ", "));
        fmt::format_to(ctx.out(), "  reject: [{}]\n", fmt::join(self.reject_states, ", "));
        for (auto i = 0; i < self.rules.size(); ++i) {
            if (i < 80) {
                fmt::format_to(ctx.out(), "  #{}: {}\n", i, self.rules[i]);
            }
        }
        if (self.rules.size() > 80) {
            fmt::format_to(ctx.out(), "  and {} more rules...\n", self.rules.size() - 80);
        }
        return ctx.out();
    }
};

struct find_iter {
    const machine_t& machine;
    // 1 for normal, 2 for final
    // normal does not accept F, final does not care about output symbol (update: and after_state)
    uint8_t iter_type;
    state_t after_state;
    size_t current_index; // next to be inspected rule

    find_iter(machine_t& machine, uint8_t iter_type, state_t s1)
        : machine(machine), iter_type(iter_type), after_state(s1), current_index(0)
    {
    }
    static auto for_final(machine_t& machine) -> find_iter {
        return find_iter{machine, 2, 42};
    }
    static auto for_normal(machine_t& machine, state_t after_state) -> find_iter {
        return find_iter{machine, 1, after_state};
    }

    // return rule index, -1 for not found
    auto next() -> size_t {
        do {
            if (current_index == machine.rules.size()) {
                return -1;
            }
            if (iter_type == 1
                && machine.rules[current_index].direction != F
                && machine.rules[current_index].after_state == after_state
            ) {
                current_index += 1;
                return current_index - 1;
            } else if (iter_type == 2
                && machine.is_accept(machine.rules[current_index].after_state)
            ) {
                current_index += 1;
                return current_index - 1;
            }
            current_index += 1;
        } while (1);
    } 
};

const int TAPE_LENGTH = 65536;
const int INIT_HEAD = 32767;
const char NONE_SYMBOL = '#';
const int MAX_APPLY_COUNT = 124;

struct shadow_cell {
    char original_symbol;
    short position;
};

struct solve_context {
    machine_t& machine;
    char* tape;
    int shadow_cell_top; // next to be push position
    struct shadow_cell* shadow_cells; // recover from cover, not into #, first 2 byte is head position, 3rd byte is original char
    int head;
    int state;
    int rule_history_count;
    int* rule_history; // rule index

    solve_context(machine_t& machine): machine(machine) {
        tape = (char*)malloc(TAPE_LENGTH);
        memset(tape, NONE_SYMBOL, TAPE_LENGTH);
        shadow_cell_top = 0;
        shadow_cells = (struct shadow_cell*)malloc(65536 * sizeof(struct shadow_cell));
        head = INIT_HEAD;
        state = 42;
        rule_history_count = 0;
        rule_history = (int*)malloc(MAX_APPLY_COUNT * sizeof(int));
    }
    ~solve_context() {
        free(tape);
        free(shadow_cells);
        free(rule_history);
    }
};

// print tape
template<> struct fmt::formatter<solve_context> {
    constexpr auto parse(format_parse_context& ctx) -> decltype(ctx.end()) {
        return ctx.end();
    }
    template<typename FormatContext>
    auto format(const solve_context& self, FormatContext& ctx) const -> decltype(ctx.out()) {
        fmt::format_to(ctx.out(), "...");
        for (int i = 0; i < TAPE_LENGTH; ++i) {
            if (self.tape[i] != '#') {
                if (i == self.head) {
                    fmt::format_to(ctx.out(), "[{{{}}}", self.state);
                }
                if (i == INIT_HEAD) {
                    fmt::format_to(ctx.out(), "(");
                }
                fmt::format_to(ctx.out(), "{}", self.tape[i]);
                if (i == INIT_HEAD) {
                    fmt::format_to(ctx.out(), ")");
                }
                if (i == self.head) {
                    fmt::format_to(ctx.out(), "]");
                }
            }
        }
        return fmt::format_to(ctx.out(), "...");
    }
};

int solve_impl(solve_context& ctx) {
    std::vector<find_iter> iterators; // iterator stack index corresponds to rule history stack
    iterators.push_back(find_iter::for_final(ctx.machine));

    do {
        int next_rule_index = iterators[ctx.rule_history_count].next();
        dprintf("step#%d rule#%d\n", ctx.rule_history_count, next_rule_index);
        fmt::print("  (iterator: type={}, after_state={}, current_index={})\n",
            iterators[ctx.rule_history_count].iter_type, iterators[ctx.rule_history_count].after_state, iterators[ctx.rule_history_count].current_index);
        if (ctx.rule_history_count >= MAX_APPLY_COUNT || next_rule_index == -1) {
            if (ctx.rule_history_count == 0) {
                dprintf("  no answer at last\n");
                return 0;
            } else if (ctx.rule_history_count > MAX_APPLY_COUNT) {
                fmt::print("step overflow, but rollback\n");
            }
            ctx.rule_history_count -= 1;
            iterators.pop_back();
            if (ctx.rule_history_count == 0) {
                // recover to step 0 is recover to nothing
                ctx.state = iterators[0].after_state;
                ctx.tape[ctx.head] = '#';
                dprintf("  no answer for depth#1, recover to nothing\n");
            } else {
                // reverse reverse apply, which is apply
                rule_t* rev_rule = &ctx.machine.rules[ctx.rule_history[ctx.rule_history_count]];
                ctx.state = rev_rule->after_state;
                ctx.tape[ctx.head] = '#';

                int recover_from_shadow = 0;
                for (int i = 0; i < ctx.shadow_cell_top; ++i) {
                    if ((int)ctx.shadow_cells[i].position == ctx.head) {
                        recover_from_shadow = 1;
                        ctx.tape[ctx.head] = ctx.shadow_cells[i].original_symbol;
                    }
                    // in this case, linked list is better
                    if (recover_from_shadow && i < ctx.shadow_cell_top - 1) {
                        ctx.shadow_cells[i].position = ctx.shadow_cells[i + 1].position;
                        ctx.shadow_cells[i].original_symbol = ctx.shadow_cells[i + 1].original_symbol;
                    }
                }
                ctx.head += rev_rule->direction == L ? -1 : 1;
                ctx.tape[ctx.head] = rev_rule->output_symbol;
                fmt::print("  no answer for depth#{}, recover: {}\n", ctx.rule_history_count + 1, ctx);
            }
            continue;
        }

        rule_t* next_rule = &ctx.machine.rules[next_rule_index];
        dprintf("  rule: ");
        fmt::print("{}", *next_rule);
        dprintf("\n");
        int next_head = ctx.head + (next_rule->direction == L ? 1 : next_rule->direction == R ? -1 : 0);
        if (ctx.tape[next_head] != NONE_SYMBOL && ctx.tape[next_head] != next_rule->output_symbol) {
            fmt::print("  output conflict: {}\n", ctx);
            continue;
        }
        ctx.head = next_head;
        if (ctx.tape[ctx.head] != '#') {
            ctx.shadow_cells[ctx.shadow_cell_top].position = ctx.head;
            ctx.shadow_cells[ctx.shadow_cell_top].original_symbol = ctx.tape[ctx.head];
            ctx.shadow_cell_top += 1;
        }
        ctx.tape[ctx.head] = next_rule->input_symbol;
        ctx.state = next_rule->before_state;
        ctx.rule_history[ctx.rule_history_count] = next_rule_index;
        ctx.rule_history_count += 1;
        if (ctx.state == 0) {
            dprintf("  resolve ok\n");
            return 1;
        } else {
            fmt::print("  continue: {}\n", ctx);
            // TODO ATTENTION here cannot provide expect output symbol, check that is covered by output symbol check before
            iterators.push_back(find_iter::for_normal(ctx.machine, ctx.state));
        }
    } while (1);
}
auto make_random_machine() -> machine_t {
    // it is very hard to make has answer inputs, adjust these values
    constexpr auto state_count = 42;  // 10 to 100
    constexpr auto symbol_count = 12; // 2 to 26
    constexpr auto rule_count = 240;  // 1 to 999
    constexpr auto right_rate = 50;   // 1 to 99

    machine_t self; // default construction seems ok

    auto accept_state_count = random() % 4 + 1;
    self.accept_states.reserve(accept_state_count);
    for (auto i = 0; i < accept_state_count; ++i) {
        state_t accept_state = 0;
        do {
            accept_state = static_cast<state_t>(rand() % state_count);
        } while (self.is_accept(accept_state));
        self.accept_states.push_back(accept_state);
    }

    auto reject_state_count = random() % 4 + 1;
    self.reject_states.reserve(reject_state_count);
    for (auto i = 0; i < reject_state_count; ++i) {
        state_t reject_state = 0;
        do {
            reject_state = static_cast<state_t>(rand() % state_count);
        } while (self.is_accept(reject_state) || self.is_reject(reject_state));
        self.reject_states.push_back(reject_state);
    }

    self.rules.reserve(240);
    for (auto i = 0; i < rule_count; ++i) {
        auto before_state = static_cast<state_t>(i == 0 ? 0 : rand() % state_count);
        auto input_symbol = 'A' + rand() % symbol_count;
        auto after_state = static_cast<state_t>(rand() % state_count);
        if (before_state == 0) {
            do {
                after_state = static_cast<state_t>(rand() % state_count);
            } while (self.is_accept(after_state));
        }
        if (i == rule_count - 1 && !self.is_accept(after_state)) {
            if (std::find_if(self.rules.begin(), self.rules.end(), [&self](const rule_t& rule) { return self.is_accept(rule.after_state); }) == self.rules.end()) {
                after_state = self.accept_states[0];
            }
        }
        auto output_symbol = 'A' + rand() % symbol_count;
        auto direction = self.is_accept(after_state) || self.is_reject(after_state) ? F : rand() % 100 < right_rate ? R : L;
        self.rules.push_back(rule_t(before_state, input_symbol, after_state, output_symbol, direction));
    }

    return self;
}

auto parse_machine(const char* file_name) -> machine_t {
    auto file = fopen(file_name, "r");
    fseek(file, 0, SEEK_END);
    auto file_size = ftell(file);
    fseek(file, 0, SEEK_SET);
    auto original_input = new char[file_size];
    fread(original_input, 1, file_size, file);
    auto input = original_input;

    machine_t self; // default construction seems ok
    input += 20;    // skip fixed head
    do {
        if (*input == ',') {
            input += 2;
        }
        state_t accept_state;
        sscanf(input, "%hd", &accept_state);
        input += fmt::format("{}", accept_state).size();
        self.accept_states.push_back(accept_state);
    } while (*input != ']');

    input += 13;
    if (*input == ']') {
        input += 1;
    } else {
        do {
            if (*input == ',') {
                input += 2;
            }
            state_t reject_state;
            sscanf(input, "%hd", &reject_state);
            input += fmt::format("{}", reject_state).size();
            self.reject_states.push_back(reject_state);
        } while (*input != ']');
    }

    // input += 2; // input10000
    input += 9;
    self.rules.reserve(240);
    do {
        self.rules.push_back(rule_t(0, '#', 0, '#', F));
        auto& rule = self.rules[self.rules.size() - 1];
        sscanf(input, "%hd", &rule.before_state);
        input += fmt::format("{}", rule.before_state).size() + 1;
        sscanf(input, "%c", &rule.input_symbol);
        input += 3;
        sscanf(input, "%hd", &rule.after_state);
        input += fmt::format("{}", rule.after_state).size() + 1;
        sscanf(input, "%c", &rule.output_symbol);
        input += 2;
        rule.direction = *input == 'L' ? L : *input == 'R' ? R : F;
        // fmt::print("read rule: #{}: {}\n", self.rules.size() - 1, rule);
        // input += 3; // input10000
        input += fmt::format("{}", self.rules.size()).size() + 8; // temp for input 10000
    } while (input < original_input + file_size);

    delete[] original_input;
    return self;
}

// input_file is nullptr for random, or else input file name
int solve(int solve_index, const char* input_file) {
    machine_t machine = input_file == nullptr ? make_random_machine() : parse_machine(input_file);
    fmt::print("{}", machine);

    solve_context ctx{machine};
    if (!solve_impl(ctx)) {
        fmt::print("no answer (solve#{})\n", solve_index);
        return 0;
    } else {
        fmt::print("answer (solve#{}): {}\n", solve_index, ctx);
        for (int i = ctx.rule_history_count - 1; i >= 0; --i) {
            rule_t* rule = &machine.rules[ctx.rule_history[i]];
            dprintf("  ");
            if (ctx.tape[ctx.head] != rule->input_symbol) {
                dprintf("!!incorrect input symbol!! ");
            }
            fmt::print("{}", *rule);
            ctx.state = rule->after_state;
            ctx.tape[ctx.head] = rule->output_symbol;
            ctx.head += rule->direction == L ? -1 : rule->direction == R ? 1 : 0;
            fmt::print(" => {}\n", ctx);
        }
        if (ctx.head != INIT_HEAD) {
            dprintf("  !!incorrect end head!!\n");
        }
        int step_count = ctx.rule_history_count;
        return step_count;
    }
}

int main(int argc, char** argv) {
    srand(time(NULL));

    for (int solve_index = 0; solve_index < (argc >= 2 ? 1 : 100); ++solve_index) {
        if (solve(solve_index, argc >= 2 ? argv[1] : nullptr) > 2) {
            fmt::print("has interest answer!\n");
            break;
        }
    }
}
