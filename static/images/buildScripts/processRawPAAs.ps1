ForEach ($file in (Get-ChildItem -File | ForEach-Object name)) {
	New-Item -Path ".\magIcons" -Name "${file}" -Type Directory -Force
	Copy-Item -Path ".\$file" -Destination ".\magIcons\${file}" -Force -EA SilentlyContinue
	Rename-Item -Path ".\magIcons\${file}\${file}" -NewName "FFFFFF.paa" -Force -EA SilentlyContinue
	. "K:\SteamLibrary\steamapps\common\Arma 3 Tools\TexView2\Pal2PacE.exe" ".\magIcons\${file}\FFFFFF.paa" ".\magIcons\${file}\FFFFFF.png"
	Remove-Item -Path ".\magIcons\${file}\*.paa" -Force -EA SilentlyContinue
}