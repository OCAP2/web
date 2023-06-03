package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

type MockContext struct {
	param string
	echo.Context
}

func (c *MockContext) Param(_ string) string {
	return c.param
}

func Test_cleanPath(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()

	tests := []struct {
		path    string
		want    string
		wantErr bool
	}{
		{"", "/", false},
		{"images/favicon.png", "/images/favicon.png", false},
		{"/images/favicon.png", "", true},
		{"//images/favicon.png", "", true},
		{"//../../images/favicon.png", "", true},
	}
	for _, tt := range tests {
		c := &MockContext{
			param:   tt.path,
			Context: e.NewContext(req, rec),
		}
		got, err := paramPath(c, tt.path)
		if (err != nil) != tt.wantErr {
			t.Errorf("cleanPath(%s) error = %v, wantErr %v", tt.path, err, tt.wantErr)
			return
		}
		if got != tt.want {
			t.Errorf("cleanPath(%s) = %v, want %v", tt.path, got, tt.want)
		}
	}
}
