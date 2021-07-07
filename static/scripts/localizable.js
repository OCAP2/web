let _localizable = {
	"players": {
		"ru": "Игроки",
		"en": "Players",
		"de": "Spieler"
	},
	"events": {
		"ru": "События",
		"en": "Events",
		"de": "Events"
	},
	"info": {
		"ru": "Информация",
		"en": "Information",
		"de": "Information"
	},
	"by_killer": {
		"ru": " был убит ",
		"en": " killed by ",
		"de": " getötet durch "
	},
	"connected": {
		"ru": "подключился",
		"en": "connected",
		"de": "verbunden"
	},
	"disconnected": {
		"ru": "отключился",
		"en": "disconnected",
		"de": "getrennt"
	},
	"by_injured": {
		"ru": " был ранен ",
		"en": " injured by ",
		"de": " verwundet durch "
	},
	"shared": {
		"ru": "Поделиться",
		"en": "Shared",
		"de": "Geteilt"
	},
	"copy_link": {
		"ru": "Скопируйте ссылку",
		"en": "Copy link",
		"de": "Link kopieren"
	},
	"close": {
		"ru": "Закрыть",
		"en": "Close",
		"de": "Schließen"
	},
	"filter": {
		"ru": "Фильтр",
		"en": "Filter",
		"de": "Filter"
	},
	"shown": {
		"ru": " показаны",
		"en": " shown",
		"de": " sichtbar"
	},
	"hidden": {
		"ru": " скрыты",
		"en": " hidden",
		"de": " unsichtbar"
	},
	"line_fire": {
		"ru": "Линии выстрелов",
		"en": "Shot lines",
		"de": "Projektilbahnen"
	},
	"nickname": {
		"ru": "Никнеймы игроков и название техники ",
		"en": "Player nicknames and vehicle names",
		"de": "Spieler- und Fahrzeugnamen"
	},
	"markers": {
		"ru": "Маркеры",
		"en": "Markers",
		"de": "Markierungen"
	},
	"event_fire": {
		"ru": "Эвенты попадания",
		"en": "Hit events",
		"de": "Treffer"
	},
	"event_dis-connected": {
		"ru": "Эвенты подключения/отключения",
		"en": "Connects / Disconnects",
		"de": "Verbunden / Getrennt"
	},
	"name_missions": {
		"ru": "Название миссии",
		"en": "Mission name",
		"de": "Name der Mission"
	},
	"something": {
		"ru": "кто-то",
		"en": "something",
		"de": "etwas"
	},
	"select_mission": {
		"ru": "Выбор миссии",
		"en": "Select mission",
		"de": "Wähle Mission"
	},
	"mission": {
		"ru": "Миссия",
		"en": "Mission",
		"de": "Mission"
	},
	"map": {
		"ru": "Карта",
		"en": "Map",
		"de": "Karte"
	},
	"data": {
		"ru": "Дата",
		"en": "Date",
		"de": "Datum"
	},
	"durability": {
		"ru": "Длительность",
		"en": "Duration",
		"de": "Dauer"
	},
	"tag": {
		"ru": "Type",
		"en": "Tag",
		"de": "Tag"
	},
	"list_compilation": {
		"ru": "Составления списка...",
		"en": "List compilation...",
		"de": "Auflisting der Erstellungen..."
	},
	"loading": {
		"ru": "Загрузка...",
		"en": "Loading...",
		"de": "Lädt..."
	},
	"win": {
		"ru": "Победа",
		"en": "Win",
		"de": "Gewonnen"
	},
	"play-pause": {
		"ru": "Воспроизвести/пауза: пробел",
		"en": "Play/pause: space",
		"de": "Start/Pause: Leertaste"
	},
	"show-hide-left-panel": {
		"ru": "Показать/скрыть левую панель: E",
		"en": "Show/Hide left panel: E",
		"de": "Linkes Fenster Anzeigen/Verstecken: E"
	},
	"show-hide-right-panel": {
		"ru": "Показать/скрыть правую панель: R",
		"en": "Show/Hide right panel: R",
		"de": "Rechtes Fenster Anzeigen/Verstecken: R"
	},
	"language": {
		"ru": "Язык:",
		"en": "Language:",
		"de": "Sprache:"
	}
};
let localizableElement = [];
let current_lang = localStorage.getItem("current_lang");
if (current_lang == null) {
	current_lang = (navigator.language || navigator.userLanguage).substr(0, 2);
	localStorage.setItem("current_lang", current_lang);
}
function localizable(elem, lzb, argR = "", argL = "") {
	var id = elem.dataset.lbId || (elem.dataset.lbId = localizableElement.length);
	localizableElement[id] = [elem, lzb, argR, argL];
	var text = _localizable[lzb][current_lang] || _localizable[lzb]["en"] || lzb;
	if (elem.nodeName == "INPUT")
		elem.placeholder = argL + text + argR;
	else
		elem.innerHTML = argL + text + argR;
}
function switchLocalizable(lang) {
	localStorage.setItem("current_lang", lang);
	current_lang = lang;
	localizableElement.forEach(function(item) {
		if (item.length != 0)
			localizable(item[0], item[1], item[2], item[3]);
	});
}
function deleteLocalizable(elem) {
	var id = elem.dataset.lbId;
	if (id != undefined) {
		localizableElement[id] = [];
	}
}
function getLocalizable(lzb) {
	return _localizable[lzb][current_lang] || _localizable[lzb]["en"] || lzb;
}
Array.prototype.slice.call(document.getElementsByTagName("*")).forEach(function(value) {
	if (value.dataset.lb != undefined) {
		localizable(value, value.dataset.lb);
	}
});
