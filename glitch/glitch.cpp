#include <ctime>
#include <Windows.h>
#include <cstdint>

// https://www.zhihu.com/question/35763438/answer/64431201
// this source has gone, so I assume this code is written by me and ok to open source
// it's kind of hard to describe what does this do, just run it, does not work on non gdi windows

constexpr long WIDTH = 80;
constexpr uint32_t FREQUENCY = 80;

int __stdcall wWinMain(HINSTANCE, HINSTANCE, wchar_t*, int32_t)
{
    srand(static_cast<unsigned int>(time(nullptr)));
    while (true)
    {
        POINT point;
        GetCursorPos(&point);
        auto hWnd = WindowFromPoint(point);
        auto hdc = GetDC(hWnd);
        ScreenToClient(hWnd, &point);
        RECT rect{};
        rect.top = point.y - WIDTH;
        rect.left = point.x - WIDTH;
        rect.right = point.x + WIDTH;
        rect.bottom = point.y + WIDTH;
        auto brush = CreateSolidBrush(RGB(rand() % 256, rand() % 256, rand() % 256));
        FillRect(hdc, &rect, brush);
        ReleaseDC(hWnd, hdc);
        DeleteObject(brush);
        Sleep(FREQUENCY);
    }
}
