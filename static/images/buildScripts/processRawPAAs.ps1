ForEach ($file in (Get-ChildItem -File | ForEach-Object name)) {
	. "K:\SteamLibrary\steamapps\common\Arma 3 Tools\TexView2\Pal2PacE.exe" $file ($file -replace '.paa', '.png')
	Remove-Item -Path $file -Force -EA SilentlyContinue
}