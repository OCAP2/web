package maptoolcli

// runInstall prints platform-specific installation instructions.
func runInstall(args []string, d deps) int {
	_ = args // install takes no flags currently.

	osInfo := detectOS()
	printInstallHelp(d.stdout, osInfo)
	return 0
}
