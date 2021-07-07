<#

	IndigoFox#6290
	2021-05-01

	HOW TO USE

	Install ImageMagick from https://legacy.imagemagick.org/script/download.php
	This is a command-line image processing utility we'll use for this process.


	Grab a marker from the game files. You can find the pbo path using the in-game CfgViewer >> CfgMarkers.

	Extract the PBO and locate the actual image files (PAA). You'll use TexView2 to convert this to a .png file.

	Create a new folder under ocap-web\static\images\markers with the exact marker 'type' name (such as hd_dot).
	Inside of it,
	place the converted .png file. It will be white.

	Rename the file to "FFFFFF.png".

	The Javascript display of the map during playback looks at the marker color that was placed in-game and matches the hex color to the filename of an image under the marker type name. This means we need a hex code file of the matching color.


	Open a new Powershell window in the directory containing your "FFFFFF.png" file,
	and post the below code in. It will automatically process colored markers for each hex code.

#>





Write-Warning "Please open this file in a text editor and read the instructions on how to use it."
Pause
exit




# FOR MAGICONS -- Run in markers/magIcons
# IFA/FOW changes white to "EDEBBA"
$ParentPath = (Get-Location).Path
ForEach ($Folder in (Get-ChildItem -Directory | ForEach-Object FullName)) {
	# $Folder = Get-Location
	Set-Location $Folder
	Copy-Item -Path ".\FFFFFF.png" -Destination ".\EDEBBA.png"
}






# FOR GENERAL COLORIZED MARKERS
$ParentPath = (Get-Location).Path
workflow Convert-IconsToColored {
	[CmdletBinding()]
	param (
		[Parameter()]
		[Array]
		$Folders
	)
	foreach -parallel ($Folder In $Folders) {
		inlineScript {
		
			$TargetColors = @(
				"000000",
				"0000FF",
				"004C99",
				"008000",
				"00CC00",
				"660080",
				"678B9B",
				"800000",
				"804000",
				"808080",
				"809966",
				"ADBF83",
				"B040A7",
				"B13339",
				"B29900",
				"D96600",
				"D9D900",
				"E60000",
				"F08231",
				"FF4C66",
				"FFFFFF",
				"261C1C",
				"BA3B2B",
				"523836",
				"D6960D",
				"E0C91A",
				"A39947",
				"528C3D",
				"404F9C",
				"EDB8C9",
				"EDEBBA",
				"5A595A",
				"B21A00",
				"009900",
				"1A1AE6",
				"CC9900",
				"CCCCCC"
			)
			# $Folder = Get-Location
			$Folder = $using:Folder
			Set-Location $Folder
			Write-Host "Processing $Folder"
			$FolderName = (Get-Item (Get-Location).Path).Name


			# Don't touch markers that have unique colors such as flags or colored icons that will only ever be white.
			# We also don't need to do anything with folders that have .svg files in them, as those are system-related.
			if (
				$null -ne (Get-ChildItem -File -Filter "*.svg") -or
				$FolderName -match 'flag_' -or
				$FolderName -match 'faction_' -or
				$FolderName -in @(
					"moduleCoverMap",
					"safeStart",
					"magIcons",
					"objectMarker",
					"ellipse",
					"rectangle",
					"RedCrystal",
					"loc_CivilDefense",
					"loc_CulturalProperty",
					"loc_DangerousForces",
					"magIcons"
				)
			) {
				# do nothing
			} elseif ($FolderName.Length -ge 4) {

				# This is for markers with white (FFFFFF) inner color and black borders, such as the vanilla INFANTRY markers.
				# Basically, anything that isn't all one color and needs special processing only on the default 'white' with transparency.
				if (
					$FolderName.Substring(0, 2) -in @("b_", "o_", "n_", "c_", "u_") -or
					$FolderName.Substring(0, 4) -in @("LIB_n", "LIB_g", "LIB_n", "LIB_o") -or
					$FolderName -match 'loc_Power' -or
					$FolderName -match 'respawn' -or
					$FolderName -in @(
						"loc_BusStop",
						"loc_Church",
						"loc_Frame",
						"loc_FuelStation",
						"loc_Hospital",
						"loc_Lighthouse",
						"loc_Quay",
						"loc_SafetyZone",
						"loc_Transmitter",
						"loc_WaterTower"
					)
				) {
					ForEach ($ColorHex in $TargetColors) {
						if ($ColorHex -eq "000000") {
							switch ($FolderName.Substring(0, 2)) {
								"o_" {
									Start-Process cmd -ArgumentList @(
										"/c",
										"magick",
										"FFFFFF.png +write mpr:img",
										"-alpha off -fuzz 75% -fill ""#800000"" -opaque ""#FFFFFF""",
										"( mpr:img -alpha extract )",
										"-alpha off -compose copy_opacity -composite",
										"000000.png"
									) -NoNewWindow -Wait
								}
								"b_" {
									Start-Process cmd -ArgumentList @(
										"/c",
										"magick",
										"FFFFFF.png +write mpr:img",
										"-alpha off -fuzz 75% -fill ""#004C99"" -opaque ""#FFFFFF""",
										"( mpr:img -alpha extract )",
										"-alpha off -compose copy_opacity -composite",
										"000000.png"
									) -NoNewWindow -Wait
								}
								"n_" {
									Start-Process cmd -ArgumentList @(
										"/c",
										"magick",
										"FFFFFF.png +write mpr:img",
										"-alpha off -fuzz 75% -fill ""#008000"" -opaque ""#FFFFFF""",
										"( mpr:img -alpha extract )",
										"-alpha off -compose copy_opacity -composite",
										"000000.png"
									) -NoNewWindow -Wait
								}
								"c_" {
									Start-Process cmd -ArgumentList @(
										"/c",
										"magick",
										"FFFFFF.png +write mpr:img",
										"-alpha off -fuzz 75% -fill ""#660080"" -opaque ""#FFFFFF""",
										"( mpr:img -alpha extract )",
										"-alpha off -compose copy_opacity -composite",
										"000000.png"
									) -NoNewWindow -Wait
								}

								Default { Copy-Item ".\FFFFFF.png" ".\000000.png" }
							}
						} elseif ($ColorHex -ne "FFFFFF") {
							Start-Process cmd -ArgumentList @(
								"/c",
								"magick",
								"FFFFFF.png +write mpr:img",
								"-alpha off -fuzz 75% -fill ""#$ColorHex"" -opaque ""#FFFFFF""",
								"( mpr:img -alpha extract )",
								"-alpha off -compose copy_opacity -composite",
								"$ColorHex.png"
							) -NoNewWindow -Wait
						}
					}
				}
			}
			# 	} else {
			# 		# Otherwise, we'll just colorize it all, keeping the contrast of black and white but tinting the entire icon because there's no border to worry about.
			# 		ForEach ($ColorHex in $TargetColors) {
			# 			if ($ColorHex -ne "FFFFFF") {

			# 				Start-Process cmd -ArgumentList @(
			# 					"/c",
			# 					"magick",
			# 					"FFFFFF.png +write mpr:img",
			# 					"-alpha off -fuzz 75% -fill ""#$ColorHex"" -opaque ""#FFFFFF"" -colorize 100%",
			# 					"( mpr:img -alpha extract )",
			# 					"-alpha off -compose copy_opacity -composite",
			# 					"$ColorHex.png"
			# 				) -NoNewWindow -Wait
			# 			}
			# 		}
			# 	}
			# } else {
	
			# 	# Otherwise, we'll just colorize it all, keeping the contrast of black and white but tinting the entire icon because there's no border to worry about.
			# 	ForEach ($ColorHex in $TargetColors) {
			# 		if ($ColorHex -ne "FFFFFF") {

			# 			Start-Process cmd -ArgumentList @(
			# 				"/c",
			# 				"magick",
			# 				"FFFFFF.png +write mpr:img",
			# 				"-alpha off -fuzz 75% -fill ""#$ColorHex"" -opaque ""#FFFFFF"" -colorize 100%",
			# 				"( mpr:img -alpha extract )",
			# 				"-alpha off -compose copy_opacity -composite",
			# 				"$ColorHex.png"
			# 			) -NoNewWindow -Wait
			# 		}
			# 	}
			# }
		}
	}
}
Convert-IconsToColored -Folders (Get-ChildItem -Path "..\markers" -Directory | ForEach-Object FullName)