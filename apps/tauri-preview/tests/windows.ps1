param([int]$AppProcessId, [string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class PreviewWindows {
  public delegate bool Visit(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Visit cb, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int limit);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int key);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  public static List<IntPtr> Find(uint process) {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, p) => {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      var title = new StringBuilder(256);
      GetWindowText(hwnd, title, 256);
      if (owner == process && IsWindowVisible(hwnd) && title.ToString().StartsWith("GameShare")) found.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$states = @(foreach($handle in [PreviewWindows]::Find([uint32]$AppProcessId)) {
  $title = [System.Text.StringBuilder]::new(256)
  [void][PreviewWindows]::GetWindowText($handle, $title, 256)
  $name = $title.ToString()
  $isTile = $name -match ' [1-3]$'
  $rect = New-Object PreviewWindows+Rect
  [void][PreviewWindows]::GetWindowRect($handle, [ref]$rect)
  if ($Action -eq 'move' -and $name.EndsWith(' 1')) {
    if (-not [PreviewWindows]::MoveWindow($handle, $rect.left + 18, $rect.top + 12, $rect.right - $rect.left + 38, $rect.bottom - $rect.top + 20, $true)) {
      throw 'MoveWindow failed'
    }
    [void][PreviewWindows]::GetWindowRect($handle, [ref]$rect)
  }
  if ($Action -eq 'restore' -and -not $isTile) { [void][PreviewWindows]::ShowWindow($handle, 9) }
  [pscustomobject]@{
    title = $name
    tile = $isTile
    topmost = [bool]([PreviewWindows]::GetWindowLong($handle, -20) -band 8)
    resize = [bool]([PreviewWindows]::GetWindowLong($handle, -16) -band 0x40000)
    minimized = [PreviewWindows]::IsIconic($handle)
    bounds = @($rect.left, $rect.top, ($rect.right - $rect.left), ($rect.bottom - $rect.top))
  }
})
ConvertTo-Json -Compress -InputObject $states
