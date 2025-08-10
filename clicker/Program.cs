using System;
using System.Runtime.InteropServices;
using System.Threading;

// a super standalone auto clicker with no 3rd party dependencies and run directly with `dotnet run` on windows

public class Program {

    // first register class + create window
    [StructLayout(LayoutKind.Sequential)]
    private struct WNDCLASS {
        public uint style;
        public WndProcDelegate lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
    }

    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);
    [DllImport("user32.dll")]
    private static extern ushort RegisterClass(ref WNDCLASS lpWndClass);
    [DllImport("user32.dll")]
    private static extern IntPtr CreateWindowEx(
        uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    // then message loop
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT {
        public int x;
        public int y;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }
    
    private const uint WM_CREATE = 0x0001;
    private const uint WM_HOTKEY = 0x0312;

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    // then hotkey
    private const uint VK_F6 = 0x75;
    private const uint MOD_NONE = 0x0000; // No modifier
    private const uint MOD_CONTROL = 0x0002;

    private const int HOTKEY_ID_START = 1;
    private const int HOTKEY_ID_EXIT = 2;

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    
    // after so many years manually write these definitions for many times, I finally can hand it over to ai
    private const uint INPUT_MOUSE = 0;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT {
        public uint type;
        public MOUSEINPUT mi;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    private void Setup() {

        var instance = GetModuleHandle(null);
        // Register window class
        var wc = new WNDCLASS {
            hInstance = instance,
            lpfnWndProc = WndProc,
            lpszClassName = "AutoClickerWindow",
        };
        if (RegisterClass(ref wc) == 0) {
            Console.WriteLine("Failed to register window class.");
            return;
        }

        // Create window
        var hwnd = CreateWindowEx(0, "AutoClickerWindow", "AutoClicker", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        if (hwnd == IntPtr.Zero) {
            Console.WriteLine("Failed to create window.");
            return;
        }

        var inputs = new INPUT[2];
        // Mouse down
        inputs[0].type = INPUT_MOUSE;
        inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        // Mouse up
        inputs[1].type = INPUT_MOUSE;
        inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
        var messageThread = new Thread(() => {
            while (true) {
                if (enabled) {
                    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
                }
                // ATTENTION click interval is here
                Thread.Sleep(50);
            }
        });
        messageThread.IsBackground = true;
        messageThread.Start();

        Console.WriteLine("Press F6 to start/stop auto-clicking. Press Ctrl+F6 to exit.");

        while (GetMessage(out var msg, IntPtr.Zero, 0, 0) != 0) {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }

    private bool enabled = false;
    private IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam) {

        if (msg == WM_CREATE) {
            if (!RegisterHotKey(hWnd, HOTKEY_ID_START, MOD_NONE, VK_F6)) {
                Console.WriteLine("Failed to register hotkey.");
                return new IntPtr(-1); // Return -1 to indicate failure
            }
            if (!RegisterHotKey(hWnd, HOTKEY_ID_EXIT, MOD_CONTROL, VK_F6)) {
                Console.WriteLine("Failed to register Ctrl+F6 hotkey.");
            }
            return IntPtr.Zero;
        } else if (msg == WM_HOTKEY && wParam.ToInt32() == HOTKEY_ID_START) {
            enabled = !enabled;
            Console.WriteLine(enabled ? "Auto-clicking started." : "Auto-clicking stopped.");
            return IntPtr.Zero;
        } else if (msg == WM_HOTKEY && wParam.ToInt32() == HOTKEY_ID_EXIT) {
            Console.WriteLine("Exiting program...");
            Environment.Exit(0);
            return IntPtr.Zero;
        }

        return DefWindowProc(hWnd, msg, wParam, lParam);
    }

    public static void Main(string[] args) {
        new Program().Setup();
    }
}
