param([string]$Title)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$window = New-Object System.Windows.Forms.Form
$window.Text = $Title
$window.Size = New-Object System.Drawing.Size(540, 340)
$window.StartPosition = 'Manual'
$window.Location = New-Object System.Drawing.Point(8, 8)
$label = New-Object System.Windows.Forms.Label
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.Font = New-Object System.Drawing.Font('Segoe UI', 28)
$window.Controls.Add($label)
$start = [Diagnostics.Stopwatch]::StartNew()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 33
$timer.Add_Tick({
    $label.Text = 'GameShare Capture Fixture ' + $start.ElapsedMilliseconds
    $label.BackColor = [Drawing.Color]::FromArgb([int]($start.ElapsedMilliseconds % 210), 110, 215)
})
$timer.Start()
[System.Windows.Forms.Application]::Run($window)
$timer.Dispose()
$window.Dispose()
