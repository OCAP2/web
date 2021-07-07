Write-Host "Use" -NoNewline
Write-Host -ForegroundColor Cyan " getCfgMarkers.sqf " -NoNewline
Write-Host "in Arma 3 to export the contents of CfgMarkers to a '^' separated CSV."
Write-Host "You'll need Killzone Kid's debug_console extension in your A3 root."
Write-Host "http://killzonekid.com/arma-console-extension-debug_console-dll-v3-0/"
Write-Host ""
Write-Host "Then, move the latest debug file from your A3 root to this directory."
Write-Host "Ensure no other files with the 'debug_console' prefix are present."

Pause
Write-Host `n`n
Write-Host "Attempting to import data..."

$debugOutput = Get-ChildItem -File -Filter 'debug_console*'
if ($null -eq $debugOutput) {
	Write-Warning "No files with prefix 'debug_console' found in working directory!"
	pause
	return
} else {
	$file = $debugOutput | Select-Object -First 1 | ForEach-Object FullName
	$cfgMarkers = Import-Csv $file -Delimiter '^'
	Start-Sleep 1
	Remove-Item $file -Force
}

$cfgMarkers | Export-Csv ".\cfgMarkers.csv" -NoTypeInformation

Write-Host `n`n
Write-Host -ForegroundColor Cyan "cfgMarkers.csv " -NoNewline
Write-Host "has been created."
Write-Host "Locate the vanilla or mod PBOs and extract them to grab the raw .paa files for each of the rows in the CSV."
Write-Host "Copy each .paa to " -NoNewline
Write-Host -ForegroundColor Yellow "\ocap-web\static\images\markers" -NoNewline
Write-Host ".`n"
Write-Host "When complete, run " -NoNewline
Write-Host -ForegroundColor Cyan "processRawPAAsmarkers.ps1" -NoNewline
Write-Host "."
Pause