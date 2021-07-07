// fetch ^-separated file of CfgMarkers
_classes = ("true" configClasses (ConfigFile >> "CfgMagazines"));
_classes = [_classes, [], {configName _x}, "ASCEND"] call BIS_fnc_sortBy;
"debug_console" callExtension ("X");
_export = "Class^Name^Icon Path";
"debug_console" callExtension (_export + "~0000");
{
	"debug_console" callExtension (configName _x + "^" + getText (_x >> "name") + "^" + getText (_x >> "picture") + "^" + "~0000");
	
} forEach _classes;
"debug_console" callExtension ("A");