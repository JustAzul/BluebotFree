const SteamUser = require('steam-user');
const config = require('../config/main.js');
const async = require('async');
const moment = require('moment');
const {Log, formatNumber} = require('azul-tools');
const helper = require('./helpers.js');

module.exports = Inventory;

function Inventory(community, client) {

	this.community = community;
	this.client = client;

	this.apiKey = null;
	this.loading = 0;

	this.CurrentKeys = [];
	this.AvailableSets = {};
};

Inventory.prototype.haveSets = function () {
	return Object.values(this.AvailableSets).reduce((prevVal, set) => {
		return prevVal + set.length;
	}, 0);
}

Inventory.prototype.HaveKeys = function () {
	return this.CurrentKeys.length;
}

Inventory.prototype.isInventoryloaded = function (callback) {
	callback(Object.keys(this.AvailableSets).length + this.HaveKeys());
}

Inventory.prototype.Load = function (force, callback) {
	const startedTime = helper.Now();
	this.isInventoryloaded(isInvLoaded => {
		if (!isInvLoaded || force) {
			Log("Loading Bot Inventory..");
			this.loading++;
			this.client.setPersona(SteamUser.EPersonaState.Busy);

			const LoadInventories = {
				"TF2": callback => {
					this.loadTF2Inventory(err => {
						if (err) {
							if (err.message.toLowerCase().indexOf("failure") == -1) {
								return setTimeout(() => {
									LoadInventories["TF2"](callback);
								}, moment.duration(5, 'seconds'));
							}

							throw Error("This account doesn't have a TF2 Inventory");
						}

						callback(null, true);
					});
				},
				"SteamInventory": callback => {
					this.loadInventory(err => {
						if (err) {
							Log.Error(err.message);
							return setTimeout(() => {
								LoadInventories["SteamInventory"](callback);
							}, moment.duration(5, 'seconds'));
						}
						callback(null, true)
					});
				}
			}

			async.parallel(LoadInventories, () => {
				this.loading--;
				Log.Debug(`Inventory loaded in ${moment().diff(startedTime, 'seconds', true)} seconds!`, false, config.DebugLogs);
				if (callback) callback(true);
			})

		} else if (callback) callback(0);
	});
}

Inventory.prototype.loadInventory = function (callback) {
	let self = this;
	this.getUserInventoryContents(this.client.steamID, 753, 6, true, (err, items) => {
		if (err) {
			if (callback) callback(err);
		} else {
			let InventoryCardsGame = {};

			let cards = items.filter(item => {
				if (item.getTag("item_class").internal_name == "item_class_2" && item.getTag("cardborder").internal_name == "cardborder_0") return item;
			});

			cards.forEach(item => {
				let appid = item.market_hash_name.split("-")[0];
				if (!InventoryCardsGame[appid]) InventoryCardsGame[appid] = {};
				if (!InventoryCardsGame[appid][item.market_hash_name]) InventoryCardsGame[appid][item.market_hash_name] = [];
				InventoryCardsGame[appid][item.market_hash_name].push(item);
			});

			const loginfo = `Found ${formatNumber(cards.length)} cards on inventory!`;
			Log(loginfo);

			self.UpdateSets(InventoryCardsGame, sets => {
				Log(`Found ${formatNumber(sets)} card sets !`);
				if (callback) callback();
			});
		}
	});
}

Inventory.prototype.loadTF2Inventory = function (callback) {
	this.return_CustomerTFKeys(this.client.steamID, (err, keys) => {
		if (err) {
			if (callback) callback(err);
		} else {
			this.CurrentKeys = keys;
			Log(`Found ${keys.length} TF Keys!`);
			if (callback) callback();
		}
	});
}

Inventory.prototype.return_CustomerTFKeys = function (sid64, callback) {
	this.getUserInventoryContents(sid64, 440, 2, true, (err, items) => {
		if (err) return callback(err);

		items = items.filter(item => item.market_hash_name.indexOf("Mann Co. Supply Crate Key") > -1);
		callback(null, items.map(item => item.assetid));
	});
}

Inventory.prototype.checkGamesSetInfo = function (InventoryCardsGame, appIds, callback) {
	let self = this;
	if (!appIds.length) return callback();

	self.AvailableSets = {};
	let checked = 0,
		done = () => {
			checked++;
			if (checked == appIds.length) callback();
		};

	appIds.forEach(appId => {
		self.checkGameSet(InventoryCardsGame, appId, () => {
			done();
		});
	});
}

Inventory.prototype.checkGameSet = function (InventoryCardsGame, GameAppID, callback) {
	helper.getSetsCount(GameAppID).then(SetCount => {
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
		if (err) {
			callback(err);
			return;
		}

		items = items.filter(item => {
			if (item.getTag("item_class").internal_name == "item_class_2" && item.getTag("cardborder").internal_name == "cardborder_0") {
				return item;
			}
		});

		let customer_sets = [],
			customer_cards = {};

		items.forEach(card => {
			const appid = card.market_hash_name.split("-")[0];
			if (!customer_cards[appid]) customer_cards[appid] = {};
			if (!customer_cards[appid][card.market_hash_name]) customer_cards[appid][card.market_hash_name] = [];
			customer_cards[appid][card.market_hash_name].push(card);
		});

		for (let appid in customer_cards) {
			const SetCount = await helper.getSetsCount(appid);

			if (Object.keys(customer_cards[appid]).length == SetCount) {

				let customerHave = Math.min.apply(Math, Object.values(customer_cards[appid]).map(card => card.length)),
					botHave = this.AvailableSets[appid] ? this.AvailableSets[appid].length : 0,
					limit = permit ? (config.maxStock + permit) : config.maxStock,
					falt = limit - botHave;

				customerHave = !ignore ? ((falt > 0) ? (Math.min(...[falt, customerHave])) : 0) : customerHave;

				for (let i = 0; i < customerHave; i++) {
					let currentCustomerSet = []

					for (let card in customer_cards[appid]) {
						currentCustomerSet.push(customer_cards[appid][card][i]);
					}

					customer_sets.push(currentCustomerSet);
				}
			}

		}

		callback(null, customer_sets);
	});
}

Inventory.prototype.getUserBadges = function (target, compare, mode, callback) {
	this.client._apiRequest("GET", "IPlayerService", "GetBadges", 1, {
		"steamid": target,
		"key": this.apiKey
	}, (err, r) => {

		if (err) {
			if (helper.isSteamCommonError(err.message)) {
				Log.Debug(`Failed to request #${target} badges, its a steam commom error, so trying again..`, false, config.DebugLogs);

				setTimeout(() => {
					this.getUserBadges(...arguments);
				}, moment.duration(2, 'seconds'));

				return;
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
	let self = this;
	if (compare) {
		self.getUserBadges(target, compare, mode, (err, badge) => {
			if (err) callback(err); 
			else {
				let toSend = [],
					need = () => max - toSend.length;

				for (let appid in self.AvailableSets) {
					let available_qty = 0;
					available_qty += Math.min(...[self.AvailableSets[appid].length, (badge[appid] != null ? badge[appid] : mode)]);

					if (available_qty && need()) {
						for (let i = 0; i < available_qty; i++) {
							if (need()) {
								toSend.push(self.AvailableSets[appid][i]);
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

		for (let appid in self.AvailableSets) {
			let available_qty = Math.min(...[self.AvailableSets[appid].length, 5]);

			if (available_qty && need()) {
				for (let i = 0; i < available_qty; i++) {
					if (need()) {
						toSend.push(self.AvailableSets[appid][i]);
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

		if (helper.isSteamCommonError(err.message)) {
			Log.Debug(`Failed to request #${target} inventory, its a steam commom error, so trying again..`, false, config.DebugLogs);

			setTimeout(() => {
				this.getUserInventoryContents(...arguments);
			}, moment.duration(2, 'seconds'));

			return;
		}

		callback(err);
	});
}
