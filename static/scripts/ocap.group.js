class Group {
	constructor(name, side) {
		this.name = name;
		this.side = side;
		this.units = [];
		this.element = null; // DOM element associated with this group
	}

	getSide() {
		return this.side;
	};

	getName() {
		return this.name;
	};

	getUnits() {
		return this.units;
	};

	setElement(el) {
		this.element = el;
	};

	getElement() {
		return this.element;
	};

	getSize() {
		return this.units.length;
	};

	getUnits() {
		return this.units;
	};

	getUnit(unit) {
		return this.units[this.units.indexOf(unit)];
	};

	// Add unit to group (if not already added)
	addUnit(unit) {
		if (this.units.indexOf(unit) != -1) { return }

		var wasEmpty = this.isEmpty();
		this.units.push(unit);

		if (wasEmpty) {
			this.makeElement(); // Make element for group
			groups.addGroup(this); // Add self to groups list
		}

		// Make element for unit too
		unit.makeElement(this.getElement());
	};

	updateUnit(unit) {
		var index = this.units.indexOf(unit);
		if (index == -1) { return }
		this.units.splice(index, 1);

		console.log(this.name + ": update " + unit.GetName());
	}

	// Remove unit from group (if not already removed)
	removeUnit(unit) {
		var index = this.units.indexOf(unit);
		if (index == -1) { return }

		this.units.splice(index, 1);

		//console.log(this.name + ": removed " + unit.getName() + ". Remaining: " + this.getSize());

		// Handle what to do if group empty
		if (this.isEmpty()) {
			groups.removeGroup(this); // Remove self from global groups object
			this.removeElement();
		}

		// Remove element for unit too
		unit.removeElement();
	};

	// Remove element from UI groups list
	removeElement() {
		this.element.parentElement.removeChild(this.element);
		this.setElement(null);
	};

	makeElement() { // Make and add element to UI groups list
		var targetList;

		switch (this.getSide()) {
			case "WEST":
				countWest++;
                ui.listWest.style.display = 'block';
				targetList = ui.listWest;
				break;
			case "EAST":
				countEast++;
                ui.listEast.style.display = 'block';
				targetList = ui.listEast;
				break;
			case "GUER":
				countGuer++;
                ui.listGuer.style.display = 'block';
				targetList = ui.listGuer;
				break;
			case "CIV":
				countCiv++;
                ui.listCiv.style.display = 'block';
				targetList = ui.listCiv;
				break;
			default:
				countCiv++;
                ui.listCiv.style.display = 'block';
				targetList = ui.listCiv;
		}

		// Create DOM element
		var liGroup = document.createElement("li");
		liGroup.className = "liGroup";
		liGroup.textContent = this.getName();
		var group = this;
		//liGroup.addEventListener("click", function() {console.log(group.getUnits())});
		this.setElement(liGroup);
		targetList.appendChild(liGroup);
	};

	isEmpty() {
		return this.units.length == 0;
	};
}
