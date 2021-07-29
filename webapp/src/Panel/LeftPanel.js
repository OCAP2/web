import "./LeftPanel.css";
import {useState} from "react";

function LeftPanel() {
	const [activeSide, setActiveSide] = useState("west");

	function switchSide(e, side) {
		e.preventDefault();
		e.stopPropagation();

		setActiveSide(side);
	}

	return (
		<div className="panel left">
			<div className="title">Players</div>
			<div className="units"></div>
			<div className="sideSelector">
				<div className={"west " + (activeSide === "west" ? "selected" : "")} onClick={(e) => switchSide(e, "west")}>BLUFOR</div>
				<div className={"east " + (activeSide === "east" ? "selected" : "")} onClick={(e) => switchSide(e, "east")}>OPFOR</div>
				<div className={"guer " + (activeSide === "guer" ? "selected" : "")} onClick={(e) => switchSide(e, "guer")}>IND</div>
				<div className={"civ " + (activeSide === "civ" ? "selected" : "")} onClick={(e) => switchSide(e, "civ")}>CIV</div>
			</div>
		</div>
	);
}

export default LeftPanel;
