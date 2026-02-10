package storage

import (
	"strings"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// stringToEntityType converts a string to pbv1.EntityType (case-insensitive)
func stringToEntityType(s string) pbv1.EntityType {
	switch strings.ToLower(s) {
	case "unit":
		return pbv1.EntityType_ENTITY_TYPE_UNIT
	case "vehicle":
		return pbv1.EntityType_ENTITY_TYPE_VEHICLE
	default:
		return pbv1.EntityType_ENTITY_TYPE_UNKNOWN
	}
}

// stringToSide converts a string to pbv1.Side (case-insensitive)
func stringToSide(s string) pbv1.Side {
	switch strings.ToUpper(s) {
	case "WEST":
		return pbv1.Side_SIDE_WEST
	case "EAST":
		return pbv1.Side_SIDE_EAST
	case "GUER", "INDEPENDENT":
		return pbv1.Side_SIDE_GUER
	case "CIV", "CIVILIAN":
		return pbv1.Side_SIDE_CIV
	case "GLOBAL":
		return pbv1.Side_SIDE_GLOBAL
	default:
		return pbv1.Side_SIDE_UNKNOWN
	}
}

// entityTypeToString converts a pbv1.EntityType to string
func entityTypeToString(t pbv1.EntityType) string {
	switch t {
	case pbv1.EntityType_ENTITY_TYPE_UNIT:
		return "unit"
	case pbv1.EntityType_ENTITY_TYPE_VEHICLE:
		return "vehicle"
	default:
		return "unknown"
	}
}

// sideToString converts a pbv1.Side to string
func sideToString(s pbv1.Side) string {
	switch s {
	case pbv1.Side_SIDE_WEST:
		return "WEST"
	case pbv1.Side_SIDE_EAST:
		return "EAST"
	case pbv1.Side_SIDE_GUER:
		return "GUER"
	case pbv1.Side_SIDE_CIV:
		return "CIV"
	case pbv1.Side_SIDE_GLOBAL:
		return "GLOBAL"
	default:
		return "UNKNOWN"
	}
}

// sideIndexToString converts a side index to side string
// Old extension uses BIS_fnc_sideID: -1=global, 0=EAST, 1=WEST, 2=RESISTANCE, 3=CIVILIAN
func sideIndexToString(idx int) string {
	switch idx {
	case 0:
		return "EAST"
	case 1:
		return "WEST"
	case 2:
		return "GUER"
	case 3:
		return "CIV"
	case -1:
		return "GLOBAL"
	default:
		return ""
	}
}
