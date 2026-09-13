Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = "C:\Users\lanej\OneDrive - Moody Technical and Development Solutions LLC\Clients\SC-Companion"
oShell.Run """node_modules\electron\dist\electron.exe"" .", 0, False
