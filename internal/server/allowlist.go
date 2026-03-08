package server

import "context"

// GetAllowlist returns all Steam IDs in the allowlist.
func (r *RepoOperation) GetAllowlist(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT steam_id FROM steam_allowlist ORDER BY steam_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// AddToAllowlist adds a Steam ID to the allowlist.
// The operation is idempotent — duplicate inserts are ignored.
func (r *RepoOperation) AddToAllowlist(ctx context.Context, steamID string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO steam_allowlist (steam_id) VALUES (?)`,
		steamID)
	return err
}

// RemoveFromAllowlist removes a Steam ID from the allowlist.
func (r *RepoOperation) RemoveFromAllowlist(ctx context.Context, steamID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM steam_allowlist WHERE steam_id = ?`,
		steamID)
	return err
}

// IsOnAllowlist checks whether a Steam ID is on the allowlist.
func (r *RepoOperation) IsOnAllowlist(ctx context.Context, steamID string) (bool, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM steam_allowlist WHERE steam_id = ?`,
		steamID).Scan(&count)
	return count > 0, err
}
