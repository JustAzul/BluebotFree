const {EPersonaState} = require('steam-user');
const config = require('../config/main.js');
const moment = require('moment');
const {Log, formatNumber, sleep} = require('azul-tools');
const {Now, getSetsCount, isSteamCommonError} = require('./helpers.js');
const _SteamSupply = require('./SteamSupply.js');

module.exports = Inventory;

function Inventory(community, client) {

	this.community = community;
	this.client = client;

	this.apiKey = null;
	this.loading = 0;

	this.CurrentKeys = [];
	this.AvailableSets = {};
};

Inventory.prototype.startCatalogLoop = function () {
	Log.Debug(`Starting Steam.supply catalog..`, false, config.DebugLogs);
    return this.CatalogLoop();
}

Inventory.prototype.CatalogLoop = async function () {
	await sleep(moment.duration(15, 'minutes'));
	
	const KeysAmount = this.HaveKeys();
	await _SteamSupply(KeysAmount);
	
    this.CatalogLoop();
}

Inventory.prototype.haveSets = function () {
	return Object.values(this.AvailableSets).reduce((prevVal, set) => prevVal + set.length, 0);
}

Inventory.prototype.HaveKeys = function () {
	return this.CurrentKeys.length;
}

Inventory.prototype.isInventoryloaded = async function () {
	return Object.keys(this.AvailableSets).length + this.HaveKeys();
}

Inventory.prototype.Load = async function (force = false) {
	const startedTime = Now();

	const isInvLoaded = await this.isInventoryloaded();
	if (isInvLoaded || !force) return false;

	Log("Loading Bot Inventory..");
	this.loading++;
	this.client.setPersona(EPersonaState.Busy);

	const Load_Steam = new Promise(resolve => {
		this.loadInventory(err => {
			if (err) return setTimeout(() => {resolve(Load_Steam);}, moment.duration(5, 'seconds'));
			resolve();
		});
	});

	await Promise.all([this.loadTF2Inventory(), Load_Steam]);
	this.loading--;
	Log.Debug(`Inventory loaded in ${moment().diff(startedTime, 'seconds', true)} seconds!`, false, config.DebugLogs);
}

Inventory.prototype.loadInventory = function (callback) {
	this.getUserInventoryContents(this.client.steamID, 753, 6, true, (err, items) => {
		if (err) {
			if (callback) callback(err);
		} else {
			this.OrganizeCards(items).then(({OrganizedInventoryCards, CardAmount}) => {
				Log(`Found ${formatNumber(CardAmount)} cards on inventory!`);
				this.UpdateSets(OrganizedInventoryCards, sets => {
					Log(`Found ${formatNumber(sets)} card sets !`);
					if (callback) callback();
				});
			});	
		}
	});
}

Inventory.prototype.OrganizeCards = async function (SteamInventory = []) {
	let OrganizedInventoryCards = {};

	const Cards = SteamInventory.filter(item => (item.getTag("item_class").internal_name == "item_class_2" && item.getTag("cardborder").internal_name == "cardborder_0"));

	for (let i in Cards) {
		const Card = Cards[i];
		const AppID = Card.market_hash_name.split("-")[0];
		if (!OrganizedInventoryCards[AppID]) OrganizedInventoryCards[AppID] = {};
		if (!OrganizedInventoryCards[AppID][Card.market_hash_name]) OrganizedInventoryCards[AppID][Card.market_hash_name] = [];
		OrganizedInventoryCards[AppID][Card.market_hash_name].push(Card);
	}

	const o = {
		OrganizedInventoryCards: OrganizedInventoryCards,
		CardAmount: Cards.length
	};

	return o;
}

Inventory.prototype.loadTF2Inventory = async function () {
	try {
		this.CurrentKeys = await this.return_CustomerTFKeys(this.client.steamID);
		if (config.SteamSupply.Enabled) _SteamSupply(this.HaveKeys());
		Log(`Found ${keys.length} TF Keys!`);
	} catch (err) {
		return Promise.reject(err);
	}
}

Inventory.prototype.return_CustomerTFKeys = function (SteamID) {
	return new Promise((resolve, reject) => {
		this.getUserInventoryContents(SteamID, 440, 2, true, (err, items) => {
			if (err) {
				if (err.message.toLowerCase().indexOf("failure") == -1) return resolve([]);
				return reject(err);
			}

			items = items.filter(item => item.market_hash_name.indexOf("Mann Co. Supply Crate Key") > -1);
			resolve(items.map(item => item.assetid));
		});
	});
}

Inventory.prototype.checkGamesSetInfo = function (InventoryCardsGame, appIds, callback) {
	if (!appIds.length) return callback();

	this.AvailableSets = {};
	let checked = 0;

	const done = () => {
		checked++;
		if (checked == appIds.length) callback();
	};

	appIds.forEach(appId => {
		this.checkGameSet(InventoryCardsGame, appId, () => {
			done();
		});
	});
}

Inventory.prototype.checkGameSet = function (InventoryCardsGame, GameAppID, callback) {
	getSetsCount(GameAppID).then(SetCount => {
		if (Object.keys(InventoryCardsGame[GameAppID]).length == SetCount) {
			let max = Math.min.apply(Math, Object.values(InventoryCardsGame[GameAppID]).map(card => card.length));

			this.AvailableSets[GameAppID] = [];

			for (let i = 0; i < max; i++) {
				let currentSet = [];

				for (let key in InventoryCardsGame[GameAppID]) {
					currentSet.push(InventoryCardsGame[GameAppID][key][i]);
				}

				this.AvailableSets[GameAppID].push(currentSet);
			}

		}
		callback();
	})
}

Inventory.prototype.UpdateSets = function (InventoryCardsGame, callback) {
	this.checkGamesSetInfo(InventoryCardsGame, Object.keys(InventoryCardsGame), () => {
		callback(this.haveSets());
	});
}

Inventory.prototype.getToOffer_TF_Keys = function (qty, callback) {
	this.getToOfferKeys(this.CurrentKeys, qty, 440, send => {
		callback(send);
	});
}

Inventory.prototype.getToOfferSets = function (Keys, qty, callback) {
	let send = [];

	for (let b = 0; b < qty; b++) {
		send.push(Keys[b]);
	}

	callback(send);
}

Inventory.prototype.getToOfferKeys = function (Keys, qty, appid, callback) {
	let send = [];

	for (let b = 0; b < qty; b++) {
		send.push({
			appid: appid,
			contextid: 2,
			amount: 1,
			assetid: Keys[b]
		});
	}

	callback(send);
}

Inventory.prototype.getCustomerSets = function (ignore, sid64, callback, permit) {
	this.getUserInventoryContents(sid64, 753, 6, true, async (err, items) => {
		if (err) return callback(err);
		
		const {OrganizedInventoryCards:CustomerCards} = await this.OrganizeCards(items);
		let CustomerSets = [];

		for (let AppID in CustomerCards) {
			const SetCount = await getSetsCount(AppID);

			if (Object.keys(CustomerCards[AppID]).length === SetCount) {

				let customerHave = Math.min.apply(Math, Object.values(CustomerCards[AppID]).map(card => card.length)),
					botHave = this.AvailableSets[AppID] ? this.AvailableSets[AppID].length : 0,
					limit = permit ? (config.maxStock + permit) : config.maxStock,
					falt = limit - botHave;

				customerHave = !ignore ? ((falt > 0) ? (Math.min(...[falt, customerHave])) : 0) : customerHave;

				for (let i = 0; i < customerHave; i++) {
					let currentCustomerSet = []

					for (let card in CustomerCards[AppID]) {
						currentCustomerSet.push(CustomerCards[AppID][card][i]);
					}

					CustomerSets.push(currentCustomerSet);
				}
			}

		}
		callback(null, CustomerSets);
	});
}

Inventory.prototype.getUserBadges = function (target, compare, mode, callback) {
	this.client._apiRequest("GET", "IPlayerService", "GetBadges", 1, {
		"steamid": target,
		"key": this.apiKey
	}, (err, r) => {

		if (err) {
			if (isSteamCommonError(err.message)) {
				Log.Debug(`Failed to request #${target} badges, its a steam commom error, so trying again..`, false, config.DebugLogs);
				return setTimeout(() => {this.getUserBadges(...arguments);}, moment.duration(2, 'seconds'));
			}

			return callback(err);
		}

		if (!compare) {
			if (!r.response.player_level) {
				const o = {
					message: "empty"
				};

				return callback(o);
			}

			return callback(null, {}, parseInt(r.response.player_level), parseInt(r.response.player_xp));
		}

		const badges = r.response.badges;
		if (badges && Object.keys(badges)) {
			let badge = {};

			for (let key in badges) {
				const current_badge = badges[key],
					appid = current_badge.appid,
					lvl = parseInt(current_badge.level);
				if (appid && current_badge.border_color == 0) {
					badge[appid] = (mode == 1) ? (lvl ? 0 : 1) : (5 - lvl);
					badge[appid] = badge[appid] < 0 ? null : badge[appid];
				}
			}

			return callback(null, badge, parseInt(r.response.player_level), parseInt(r.response.player_xp));
		}

		const o = {
			message: "empty"
		};

		return callback(o);
	});
}

Inventory.prototype.getAvailableSetsForCustomer = function (target, compare, mode, max, callback) {
	if (compare) {
		this.getUserBadges(target, compare, mode, (err, badge) => {
			if (err) callback(err); 
			else {
				let toSend = [],
					need = () => max - toSend.length;

				for (let appid in this.AvailableSets) {
					let available_qty = 0;
					available_qty += Math.min(...[this.AvailableSets[appid].length, (badge[appid] != null ? badge[appid] : mode)]);

					if (available_qty && need()) {
						for (let i = 0; i < available_qty; i++) {
							if (need()) {
								toSend.push(this.AvailableSets[appid][i]);
								if (!need()) {
									break;
								}
							}
						}
					}
				}
				callback(null, toSend);
			}
		});
	} else {
		let toSend = [],
			need = () => max - toSend.length;

		for (let appid in this.AvailableSets) {
			let available_qty = Math.min(...[this.AvailableSets[appid].length, 5]);

			if (available_qty && need()) {
				for (let i = 0; i < available_qty; i++) {
					if (need()) {
						toSend.push(this.AvailableSets[appid][i]);
						if (!need()) {
							break;
						}
					}
				}
			}
		}
		callback(null, toSend);
	}
}

Inventory.prototype.getUserInventoryContents = function (a, b, c, d, callback) {
	this.community.getUserInventoryContents(a, b, c, d, (err, ...items) => {
		if (!err) return callback(null, ...items);

		if (isSteamCommonError(err.message)) {
			Log.Debug(`Failed to request #${target} inventory, its a steam commom error, so trying again..`, false, config.DebugLogs);

			setTimeout(() => {
				this.getUserInventoryContents(...arguments);
			}, moment.duration(2, 'seconds'));

			return;
		}

		callback(err);
	});
}
