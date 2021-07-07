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

package main

import "C"
import (
	"encoding/json"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"strings"

	"github.com/OCAPv2/OCAP/src/config"
	"github.com/OCAPv2/OCAP/src/ocap"

	_ "github.com/mattn/go-sqlite3"
)

var o *ocap.OCAP

// ResponseWriter Access response to status
type ResponseWriter struct {
	http.ResponseWriter
	status int
}

// WriteHeader Save status code for log
func (res *ResponseWriter) WriteHeader(code int) {
	res.status = code
	res.ResponseWriter.WriteHeader(code)
}

// OperationGet http header filter operation
func OperationGet(w http.ResponseWriter, r *http.Request) {
	ops, err := o.GetByFilter(ocap.OperationFilter{
		MissionName: r.FormValue("name"),
		DateOlder:   r.FormValue("older"),
		DateNewer:   r.FormValue("newer"),
		Type:        r.FormValue("type"),
	})
	if err != nil {
		log.Println(err.Error())
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	err = json.NewEncoder(w).Encode(ops)
	if err != nil {
		log.Println(err.Error())
		return
	}
}

// OperationAdd http header add operation only for server
func OperationAdd(w http.ResponseWriter, r *http.Request) {
	// Check secret variable
	if config.C.Secret != "" && r.FormValue("secret") != config.C.Secret {
		log.Println(r.RemoteAddr, "invalid secret denied access")
		http.Error(w, "invalid secret denied access", http.StatusForbidden)
		return
	}

	// Insert new line in db
	_, err := o.Insert(r, "static/data/")
	if err != nil {
		log.Println(err.Error())
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
}

// StaticHandler write index.html (buffer) or send static file
func StaticHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// send home page
		if r.URL.Path == "/" {
			err := o.RenderIndex(w)
			if err != nil {
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
				log.Println(err.Error())
			}
			return
		}
		// Add Expiration cache 90 days (with code 404, the cache does not work [tested on Google Chrome])
		w.Header().Set("Cache-Control", "public, max-age=7776000")
		// disable directory listings
		if strings.HasSuffix(r.URL.Path, "/") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		// json data already compressed
		if strings.HasPrefix(r.URL.Path, "/data/") {
			r.URL.Path += ".gz"
			w.Header().Set("Content-Encoding", "gzip")
			// Support mozilla
			w.Header().Set("Content-Type", "application/json")
		}
		next.ServeHTTP(w, r)
	})
}

// LoggerRequest writes logs from incoming requests
func LoggerRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		res := ResponseWriter{w, 200}
		next.ServeHTTP(&res, r)
		log.Printf("%s %s %s %v \"%s\" \n", r.RemoteAddr, r.Proto, r.Method, res.status, r.URL)
	})
}

func main() {
	err := config.ReadConfig()
	if err != nil {
		panic(err.Error())
	}

	// Connecting logger file
	if config.C.Logger {
		loggingFile, err := os.OpenFile("ocap.log", os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
		if err != nil {
			panic(err)
		}
		defer loggingFile.Close()
		log.SetOutput(io.MultiWriter(os.Stdout, loggingFile))
	}

	o, err = ocap.New()
	if err != nil {
		panic(err.Error())
	}
	defer o.Close()

	log.Println("=== Starting server ===")

	// Add exception
	// not set header for json files (map.json)
	mime.AddExtensionType(".json", "application/json")

	// Create router
	mux := http.NewServeMux()
	fs := http.FileServer(http.Dir("static"))
	mux.Handle("/", StaticHandler(fs))
	mux.HandleFunc("/api/v1/operations/add", OperationAdd)
	mux.HandleFunc("/api/v1/operations/get", OperationGet)

	http.ListenAndServe(config.C.Listen, LoggerRequest(mux))
}
