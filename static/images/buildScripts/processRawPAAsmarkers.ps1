$target = "..\markers"
$Pal2PacEPath = "K:\SteamLibrary\steamapps\common\Arma 3 Tools\TexView2"

New-PSDrive -Name "markers" -Root $target -PSProvider FileSystem
New-PSDrive -Name "Pal2PacE" -Root $Pal2PacEPath -PSProvider FileSystem
$cfgMarkers = Import-Csv ".\cfgMarkers.csv"


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
		Set-Location markers:
	}

	PROCESS {
		Write-Host "Processing $($file.name) at $($file.FullName)"
		if (Test-Path "temp.paa") { Remove-Item "temp.paa" -Force -EA SilentlyContinue }
		if ((Get-Item $file.name).GetType().Name -eq "DirectoryInfo") {
			return
		}
		Copy-Item $file.name -Destination ".\temp.paa" -Force
		New-Item -Name $line.class -Type Directory -Force
		Copy-Item -Path "temp.paa" -Destination ($line.class + "\temp.paa") -Force -EA SilentlyContinue
		Rename-Item -Path ($line.class + "\temp.paa") -NewName "FFFFFF.paa" -Force -EA SilentlyContinue
		$paaPath = (Get-Item ($line.class + "\FFFFFF.paa")).FullName
		$pngPath = $paaPath -replace 'FFFFFF.paa', 'FFFFFF.png'
		. Pal2PacE:Pal2PacE.exe $paaPath $pngPath
		# Copy-Item (markers:$line.Class + "\FFFFFF.png") (markers:$line.Class + "\000000.png")
	}

	END {
		Remove-Item -Path ($line.class + "\FFFFFF.paa") -Force -EA SilentlyContinue
		# Remove-Item $file
		Set-Location $startLoc
	}
}

ForEach ($file in (Get-ChildItem -Path markers: -File -Filter '*.paa')) {
	ForEach ($line in $cfgMarkers) {
		if (
			$file.Name -eq ($line.'Icon Path' -split '\\')[-1]
		) {
			try {
				Convert-RawPAA -File $file -Line $line
			} catch {
				Write-Host -ForegroundColor Red "Error processing $($file.name)"
				Write-Host $PSItem
			}
		}
	}
}

ForEach ($file in (Get-ChildItem -Path markers: -File -Filter '*.paa')) {
	# Remove-Item $file.FullName -Force -EA SilentlyContinue
}