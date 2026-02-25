package server

import "context"

// GetBlacklist returns the blacklisted player entity IDs for an operation.
func (r *RepoOperation) GetBlacklist(ctx context.Context, operationID int64) ([]int, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT player_entity_id FROM marker_blacklist WHERE operation_id = ? ORDER BY player_entity_id`,
		operationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// AddBlacklist adds a player entity ID to the marker blacklist for an operation.
// The operation is idempotent — duplicate inserts are ignored.
func (r *RepoOperation) AddBlacklist(ctx context.Context, operationID int64, playerEntityID int) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO marker_blacklist (operation_id, player_entity_id) VALUES (?, ?)`,
		operationID, playerEntityID)
	return err
}

// RemoveBlacklist removes a player entity ID from the marker blacklist for an operation.
func (r *RepoOperation) RemoveBlacklist(ctx context.Context, operationID int64, playerEntityID int) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM marker_blacklist WHERE operation_id = ? AND player_entity_id = ?`,
		operationID, playerEntityID)
	return err
}
