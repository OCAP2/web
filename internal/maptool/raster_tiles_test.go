package maptool

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunCmdDir_Success(t *testing.T) {
	err := runCmdDir(context.Background(), t.TempDir(), "true")
	require.NoError(t, err)
}

func TestRunCmdDir_Failure(t *testing.T) {
	err := runCmdDir(context.Background(), t.TempDir(), "false")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "exit status 1")
}
