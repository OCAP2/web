$target = "..\markers\magIcons"
$Pal2PacEPath = "K:\SteamLibrary\steamapps\common\Arma 3 Tools\TexView2"

New-PSDrive -Name "magIcons" -Root $target -PSProvider FileSystem
New-PSDrive -Name "Pal2PacE" -Root $Pal2PacEPath -PSProvider FileSystem
$cfgMagazines = Import-Csv ".\cfgMagazines.csv"


function Convert-RawPAA {
	[CmdletBinding()]
	param (
		[Parameter(Mandatory)]
		[System.IO.FileSystemInfo]
		$File,
		[Parameter(Mandatory)]
		[PSCustomObject]
		$Line
	)

	BEGIN {
		$startLoc = Get-Location
		Set-Location magIcons:
	}

	PROCESS {
		Write-Host "Processing $($file.name) at $($file.FullName)"
		if (Test-Path "temp.paa") {Remove-Item "temp.paa" -Force -EA SilentlyContinue}
		if ((Get-Item $file.name).GetType().Name -eq "DirectoryInfo") {
			return
		}
		Rename-Item $file.name -NewName "temp.paa" | Out-Null
		New-Item -Name $file.name -Type Directory -Force
		Move-Item -Path "temp.paa" -Destination ($file.name + "\temp.paa") -Force -EA SilentlyContinue
		Rename-Item -Path ($file.name + "\temp.paa") -NewName "FFFFFF.paa" -Force -EA SilentlyContinue
		$paaPath = (Get-Item ($file.name + "\FFFFFF.paa")).FullName
		$pngPath = $paaPath -replace 'FFFFFF.paa','FFFFFF.png'
		. Pal2PacE:Pal2PacE.exe $paaPath $pngPath
		# Copy-Item (magIcons:$line.Class + "\FFFFFF.png") (magIcons:$line.Class + "\000000.png")
	}

	END {
		Remove-Item -Path ($file.name + "\FFFFFF.paa") -Force -EA SilentlyContinue
		# Remove-Item $file
		Set-Location $startLoc
	}
}

ForEach ($file in (Get-ChildItem -Path magIcons: -File -Filter '*.paa')) {
	ForEach ($line in $cfgMagazines) {
		if (
			$file.Name -eq ($line.'Icon Path' -split '\\')[-1]
		) {
			try {
				Convert-RawPAA -File $file -Line $line
			} catch {
				Write-Host -ForegroundColor Red "Error processing $($file.name)"
			}
		}
	}
}

ForEach ($file in (Get-ChildItem -Path magIcons: -File -Filter '*.paa')) {
	# Remove-Item $file.FullName -Force -EA SilentlyContinue
}