// Copyright (C) 2020 Kuzmin Vladimir (aka Dell) (vovakyzmin@gmail.com)
//
// References to "this program" include all files, folders, and subfolders
// bundled with this license file.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

package ocap

import (
	"database/sql"
	"io"
	"net/http"
	"os"
	"path"
	"strconv"
	"time"
)

// Operation Model operation table in db
type Operation struct {
	ID              int64   `json:"id" db:"id"`
	WorldName       string  `json:"world_name" db:"world_name"`
	MissionName     string  `json:"mission_name" db:"mission_name"`
	MissionDuration float64 `json:"mission_duration" db:"mission_duration"`
	Filename        string  `json:"filename" db:"filename"`
	Date            string  `json:"date" db:"date"`
	Type            string  `json:"type" db:"type"`
}

func getOperation(r *http.Request) (op Operation, err error) {
	op = Operation{
		WorldName:   r.FormValue("worldName"),
		MissionName: r.FormValue("missionName"),
		Filename:    r.FormValue("filename"),
		Date:        time.Now().Format("2006-01-02"),
		Type:        r.FormValue("type"),
	}
	op.MissionDuration, err = strconv.ParseFloat(r.FormValue("missionDuration"), 64)
	return op, err
}

// Insert saves the file in compressed form on the server & new row in db
func (o *OCAP) Insert(r *http.Request, dir string) (sql.Result, error) {
	op, err := getOperation(r)
	if err != nil {
		return nil, err
	}

	// get reader file
	reader, _, err := r.FormFile("file")
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	// get writer file
	w, err := os.Create(path.Join(dir, op.Filename+".gz"))
	if err != nil {
		return nil, err
	}
	defer w.Close()

	// copy file
	_, err = io.Copy(w, reader)
	if err != nil {
		return nil, err
	}

	return o.db.Exec(
		`
		INSERT INTO operations (
			world_name, mission_name, mission_duration, filename, date, type
		) VALUES (
			$1, $2, $3, $4, $5, $6
		);
		`,
		op.WorldName,
		op.MissionName,
		op.MissionDuration,
		op.Filename,
		op.Date,
		op.Type,
	)
}

// OperationFilter model for filter operations
type OperationFilter struct {
	MissionName string
	DateOlder   string
	DateNewer   string
	Type        string
}

// GetByFilter get all operations matching the filter
func (o *OCAP) GetByFilter(filter OperationFilter) ([]Operation, error) {
	operations := make([]Operation, 0)
	err := o.db.Select(
		&operations,
		`
		SELECT
			*
		FROM
		    operations
		WHERE
			mission_name LIKE "%" || $2 || "%"
			AND date <= $3
			AND date >= $4
			AND type LIKE "%" || $1;
		`,
		filter.MissionName,
		filter.DateOlder,
		filter.DateNewer,
		filter.Type,
	)
	if err != nil {
		return nil, err
	}

	return operations, nil
}
