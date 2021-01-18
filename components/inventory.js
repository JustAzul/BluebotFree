const {EPersonaState} = require('steam-user');
const config = require('../config/main.js');
const moment = require('moment');
const {Log, formatNumber, sleep} = require('azul-tools');
const {Now, getSetsCount, isSteamCommonError} = require('./helpers.js');
const _SteamSupply = require('./SteamSupply.js');
const GetBadges = require('./GetBadges.js');

module.exports = Inventory;

function Inventory(community, client) {

	this.community = community;
	this.client = client;

	this.apiKey = null;
	this.CumulativeLoads = 0;

	this.CurrentKeys = [];

	this.AvailableSets = {};
	this.SetsAmount = 0;
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
	return parseInt(this.SetsAmount);
}

Inventory.prototype.HaveKeys = function () {
	return parseInt(this.CurrentKeys.length);
}

Inventory.prototype.isInventoryloaded = async function () {
	return (this.haveSets() + this.HaveKeys()) > 0;
}

Inventory.prototype.Load = async function (ForceLoad = false) {
	
	const isInvLoaded = await this.isInventoryloaded();
	if (!ForceLoad && isInvLoaded) return false;

	Log("Loading Bot Inventory..");
	
	this.CumulativeLoads++;
	this.client.setPersona(EPersonaState.Busy);
	
	await Promise.all([this.loadTF2Inventory(), this.loadInventory()]);
	this.CumulativeLoads--;
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

Inventory.prototype.parseSets = async function (OrganizeCards = {}) {
	let Parsed = {};
	let ParsedAmount = 0;

	const ParseSet = async (AppID, i) => {
		ParsedSet = [];

		for (let key in OrganizeCards[AppID]) {
			ParsedSet.push(OrganizeCards[AppID][key][i]);
		}

		return ParsedSet;
	}

	for (let AppID in OrganizeCards) {

		const SetCount = await getSetsCount(AppID);
		if (Object.keys(OrganizeCards[AppID]).length !== SetCount) continue;

		const max = Math.min.apply(Math, Object.values(OrganizeCards[AppID]).map(card => card.length));
		Parsed[AppID] = [];

		for (let i = 0; i < max; i++) {
			const currentSet = await ParseSet(AppID, i);
			Parsed[AppID].push(currentSet);
			ParsedAmount++;
		}
	}

	const o = {
		CardSets: Parsed,
		Amount: ParsedAmount
	};

	return o;
};

Inventory.prototype.loadInventory = async function () {
	try {
		const {Contents} = await this.getUserInventoryContents(this.client.steamID, 753, 6, true);
		const {OrganizedInventoryCards, CardAmount} = await this.OrganizeCards(Contents);			
		const {Amount, CardSets} = await this.parseSets(OrganizedInventoryCards);
	
		Log(`Found ${formatNumber(CardAmount)} cards, and ${formatNumber(Amount)} card sets on inventory!`);
	
		this.AvailableSets = CardSets;
		this.SetsAmount = Amount;
	} catch (err) {
		throw err;
	}
}

Inventory.prototype.loadTF2Inventory = async function () {
	try {
		this.CurrentKeys = await this.return_CustomerTFKeys(this.client.steamID);
		if (config.SteamSupply.Enabled) _SteamSupply(this.HaveKeys());
		Log(`Found ${this.CurrentKeys.length} TF Keys!`);
	} catch (err) {
		throw err;
	}
}

Inventory.prototype.return_CustomerTFKeys = async function (SteamID) {
	try {
		const {Contents} = await this.getUserInventoryContents(SteamID, 440, 2, true);
		const Keys = Contents.filter(item => item.market_hash_name.indexOf("Mann Co. Supply Crate Key") > -1);
		return (Keys.map(item => item.assetid));
	} catch (err) {
		if (err.message.toLowerCase().indexOf("failure") === -1) return [];
		throw err;
	}
}

Inventory.prototype.getToOffer_TF_Keys = async function (Amout = 0) {
	return this.getToOfferKeys(this.CurrentKeys, Amout);
}

Inventory.prototype.getToOfferSets = function (Keys, qty, callback) {
	let send = [];

	for (let b = 0; b < qty; b++) {
		send.push(Keys[b]);
	}

	callback(send);
}

Inventory.prototype.getToOfferKeys = async function (KeysArray = [], Amount = 0) {
	let ToSendArray = [];

	const ItemTemplate = {
		"appid": 440,
		"contextid": 2,
		"amount": 1
	};

	for (const i = 0; i < Amount; i++) {
		
		const o = {
			"assetid": KeysArray[i],
			...ItemTemplate
		};

		ToSendArray.push(o);
	}

	return ToSendArray;
}

Inventory.prototype.getCustomerSets = async function (SteamID, IgnoreLimit = false, callback) {
	
	try {
		const {Contents} = await this.getUserInventoryContents(SteamID, 753, 6, true);
		const {OrganizedInventoryCards} = await this.OrganizeCards(Contents);			
		const {CardSets} = await this.parseSets(OrganizedInventoryCards);
			
		let CustomerSets = [];
	
		for (let AppID in CardSets) {
			const BotStock = this.AvailableSets.hasOwnProperty(AppID) ? this.AvailableSets[AppID].length : 0;
			const CustomerStock = CardSets[AppID].length;
			const Limit = IgnoreLimit ? CustomerStock : Math.min((CustomerStock - BotStock), config.maxStock);
	
			if (Limit <= 0) continue;
	
			const toPush = CardSets[AppID].splice(0, Limit);
			CustomerSets.push(...toPush);
		}
	
		return CustomerSets
	} catch(err){
		throw err
	}	

}

Inventory.prototype.getUserBadges = async function (SteamID, Compare = false, CollectorMode = false) {
	try {
		const {badges, player_xp, player_level} = await GetBadges(SteamID.toString(), this.apiKey);

		const Result = {
			"player_xp": player_xp,
			"player_level": player_level
		};

		if (!Compare) {
			delete badges;
			if (!player_level) throw new Error("empty");
			return Result;
		}

		if(!badges || badges.length === 0) throw new Error("empty");

		let Badges = {};

		for(const i in badges) {
			const {appid, level, border_color} = badges[i];
			if (!appid || border_color !== 0) continue;

			const CanGet = CollectorMode ? (level ? 0 : 1) : (5 - level);
			Badges[appid] = Math.max(CanGet < 0 ? 0 : CanGet, 0);
		}

		const o = {
			"Badges": Badges,
			...Result
		};

		return o;

	} catch(err) {
		throw err;
	}
}

Inventory.prototype.getAvailableSetsForCustomer = async function (SteamID, Compare = true, CollectorMode = false, MaxSetsToSend = 5) {
	
	const ParseSets = async (Badges = {}, MaxToParse = 5, perBadgeLimit = 0) => {
		let ResultArray = [];

		const ParseSetsFromArray = async (AppID, Amount = 0) => {
			let ParsedArray = [];

			for (let i = 0; i < Amount; i++) {
				const Sets = this.AvailableSets[AppID][i];
				ParsedArray.push(...Sets);
			}

			return ParsedArray;
		};

		for (const AppID in this.AvailableSets) {
			let CanParse = Math.min(this.AvailableSets[AppID].length, perBadgeLimit);
			if (Badges.hasOwnProperty(AppID)) CanParse -= Badges[AppID];
			
			if (CanParse <= 0) continue;			
			const Parsed = await ParseSetsFromArray(Math.min(CanParse, MaxToParse));
			
			ResultArray.push(...Parsed);
			MaxToParse -= CanParse;

			if(MaxToParse === 0) break;
		}

		return ResultArray;
	};

	if(!Compare) return ParseSets({}, MaxSetsToSend, CollectorMode ? 1 : 5);	
	const {Badges} = await this.getUserBadges(SteamID, true, CollectorMode);
	return ParseSets(Badges, MaxSetsToSend, CollectorMode ? 1 : 5);
}

Inventory.prototype.getUserInventoryContents = function () {
	return new Promise((resolve, reject) => {
		this.community.getUserInventoryContents(...arguments, (err, inventory) => {
			if (err) {
				if (isSteamCommonError(err.message)) return setTimeout(() => {resolve(this.getUserInventoryContents(...arguments));}, moment.duration(5, 'seconds'));
				return reject(err);
			}
			
			const o = {
				Contents: inventory,
				Count: inventory.length
			};

			resolve(o);
		});
	});	
}
