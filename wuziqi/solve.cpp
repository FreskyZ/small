#include <iostream>
#include <thread>

auto main() -> int {

    std::cout << std::thread::hardware_concurrency() << std::endl;

    uint64_t v = 0;
    uint64_t carry = 0;

    uint32_t white_count = 0;
    uint32_t black_count = 0;
    while (true) {

        // add 1
        v += 1;
        
        // first bit in each 2 bit
        constexpr uint64_t mask1 = 0x5555'5555'5555'5555ULL;
        // second bit in each 2 bit
        constexpr uint64_t mask2 = 0xAAAA'AAAA'AAAA'AAAAULL;

        // both first bit and second bit is 1, stored the result boolean in first bit
        // carry = v & ((v & mask2) >> 1);
        // // mask the overflow bits to be 0
        // v = v & ~(carry & (carry << 1));
        // // add the carry to next bit
        // v += (carry << 2);

        // repeat 25 times
#define LOOP carry = (v & mask1) & ((v & mask2) >> 1); v = (v & ~(carry | (carry << 1))) + (carry << 2);
        LOOP LOOP LOOP LOOP  LOOP LOOP LOOP LOOP
        LOOP LOOP LOOP LOOP  LOOP LOOP LOOP LOOP
        LOOP LOOP LOOP LOOP  LOOP LOOP LOOP LOOP
        LOOP

        // test print
        // for (int i = 48; i >= 0; i -= 2) {
        //     std::cout << ((v >> i) & 3);
        // }
        // std::cout << std::endl;
    
        const uint64_t mask_win[] = {
            0x1FULL,         // row 0
            0x3E0ULL,        // row 1
            0x7C00ULL,       // row 2
            0xF8000ULL,      // row 3
            0x1F00000ULL,    // row 4
            0x108421ULL,     // column 0
            0x210842ULL,     // column 1
            0x421084ULL,     // column 2
            0x842108ULL,     // column 3
            0x1084210ULL,    // column 4
            0x1041041ULL,    // diagno 1
            0x111110ULL      // diagno 2
        };
    
        uint64_t white_board = v & mask1;
        uint64_t white_win = 0
            | ((white_board & mask_win[0]) == mask_win[0])
            | ((white_board & mask_win[1]) == mask_win[1])
            | ((white_board & mask_win[2]) == mask_win[2])
            | ((white_board & mask_win[3]) == mask_win[3])
            | ((white_board & mask_win[4]) == mask_win[4])
            | ((white_board & mask_win[5]) == mask_win[5])
            | ((white_board & mask_win[6]) == mask_win[6])
            | ((white_board & mask_win[7]) == mask_win[7])
            | ((white_board & mask_win[8]) == mask_win[8])
            | ((white_board & mask_win[9]) == mask_win[9])
            | ((white_board & mask_win[10]) == mask_win[10])
            | ((white_board & mask_win[11]) == mask_win[11]);
        uint64_t black_board = (v & mask2) >> 1;
        uint64_t black_win = 0
            | ((black_board & mask_win[0]) == mask_win[0])
            | ((black_board & mask_win[1]) == mask_win[1])
            | ((black_board & mask_win[2]) == mask_win[2])
            | ((black_board & mask_win[3]) == mask_win[3])
            | ((black_board & mask_win[4]) == mask_win[4])
            | ((black_board & mask_win[5]) == mask_win[5])
            | ((black_board & mask_win[6]) == mask_win[6])
            | ((black_board & mask_win[7]) == mask_win[7])
            | ((black_board & mask_win[8]) == mask_win[8])
            | ((black_board & mask_win[9]) == mask_win[9])
            | ((black_board & mask_win[10]) == mask_win[10])
            | ((black_board & mask_win[11]) == mask_win[11]);
    
        white_count += white_win;
        black_count += black_win;

        if (v & 0x4'0000'000LL) { break; }
        // if (v & 0x4'0000'0000'000LL) { break; }
    }

    std::cout << white_count << "," << black_count << "," << white_count + black_count << std::endl;
}