class Groups {
	constructor() {
		this.groups = [];
	};

	addGroup(group) {
		this.groups.push(group);
	};

	getGroups() {
		return this.groups;
	};

	removeGroup(group) {
		var index = this.groups.indexOf(group);
		this.groups.splice(index, 1);
	};

	// Find group by name and side
	findGroup(name, side) {
		//console.log("Finding group with name: " + name + ", side: " + side);

		if (this.groups.length == 0) {
			//console.log("Group does not exist (list empty)!");
			return;
		}

		for (let i = 0; i < this.groups.length; i++) {
			var group = this.groups[i];
			//console.log("Comparing with group name: " + group.name + ", side: " + group.side);

			if ((group.getName() == name) && (group.getSide() == side)) {
				//console.log("Group exists!");
				return group;
			}
		}

		//console.log("Group does not exist!");
		return;
	};
}
