import './Selection.css';
import {useEffect, useState} from "react";

const INITIAL_FILTER = {
	newer: "2017-06-01",
	older: "2099-01-01"
};

function Selection({onSelect}) {
	const [replays, setReplays] = useState([]);
	const [filter, setFilter] = useState(INITIAL_FILTER);

	useEffect(() => {
		fetch("/api/v1/operations?" + new URLSearchParams(filter))
			.then(r => r.json())
			.then(r => setReplays(r));
	}, []);

	function renderTable() {
		return replays.map((replay) => {
			return (
				<tr key={replay.id} onClick={() => onSelect(replay)}>
					<td>{replay.filename}</td>
					<td>{replay.world_name}</td>
					<td>{replay.date}</td>
					<td>{replay.mission_duration}</td>
					<td>{replay.tag}</td>
				</tr>
			)
		})
	}

	return (
		<div className="selectionModal">
			<div className="selectionDialog">
				<div className="selectionHeader">Select mission</div>
				<div className="selectionFilter">TODO</div>
				<div className="selectionBody">
					<table>
						<thead>
							<tr>
								<th>Mission</th>
								<th>Map</th>
								<th>Date</th>
								<th>Duration</th>
								<th>Tag</th>
							</tr>
						</thead>
						<tbody>
						{renderTable()}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

export default Selection;
