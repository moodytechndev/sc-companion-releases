using System;
using System.Runtime.InteropServices;
using System.Threading;

class KeyHook {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);

    static void Main(string[] args) {
        int vk = args.Length > 0 ? Convert.ToInt32(args[0], 16) : 0x2D; // default: VK_INSERT
        bool wasDown = false;
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        while (true) {
            bool isDown = (GetAsyncKeyState(vk) & 0x8000) != 0;
            if (isDown && !wasDown) {
                Console.WriteLine("TOGGLE");
                Console.Out.Flush();
            }
            wasDown = isDown;
            Thread.Sleep(30);
        }
    }
}
