Set oShell = CreateObject("WScript.Shell")
Set oFSO  = CreateObject("Scripting.FileSystemObject")
oShell.CurrentDirectory = oFSO.GetParentFolderName(WScript.ScriptFullName)
oShell.Run """node_modules\electron\dist\electron.exe"" .", 0, False
