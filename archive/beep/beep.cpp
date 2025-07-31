#include <vector>

// using primitive multimedia(?) function to play mysterious music
// first found in Aug 17, 2016
// update in Feb, 2023 to make it moderner

// prevent include <Windows.h>
#pragma comment (lib, "kernel32.lib")
extern "C" __declspec(dllimport) int __stdcall Beep(uint32_t frequency, uint32_t duration);

auto main() -> int
{
    static const std::vector<std::tuple<uint32_t, uint32_t>> music
    {
        {392, 375}, {392, 125}, {440, 500}, {392, 500}, {523, 500}, {494, 1000},
        {392, 375}, {392, 125}, {440, 500}, {392, 500}, {587, 500}, {523, 1000},
        {392, 375}, {392, 125}, {784, 500}, {659, 500}, {523, 500}, {494, 1000}, {440, 1000},
        {698, 375}, {698, 125}, {659, 500}, {523, 500}, {587, 500}, {523, 1000}
    };
    for (const auto& [freq, duration] : music)
    {
        Beep(freq, duration);
    }
}
